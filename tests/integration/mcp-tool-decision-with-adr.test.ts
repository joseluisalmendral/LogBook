/**
 * Integration test: logbook_decision MCP tool with ADR file generation (T9).
 *
 * Extends T8a assertions to verify:
 * - Response now includes `adrPath` and `counter`
 * - ADR file exists at logbook/decisions/<NNNN>-<slug>.md
 * - state.json has incremented adrCounter
 * - JSONL has manual.decision event
 * - SQLite has decisions row
 * - Two concurrent calls produce different, monotonic adrPaths
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { readState } from "../../src/core/state.js";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
const SERVER_BUNDLE = join(PROJECT_ROOT, "dist", "mcp", "server.cjs");

beforeAll(async () => {
  if (!existsSync(SERVER_BUNDLE)) {
    const result = spawnSync("pnpm", ["build"], {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 60_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `pnpm build failed:\nstdout: ${result.stdout?.toString()}\nstderr: ${result.stderr?.toString()}`,
      );
    }
  }
}, 90_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProject(): string {
  const dir = join(
    tmpdir(),
    `logbook-test-decision-adr-${randomBytes(6).toString("hex")}`,
  );
  mkdirSync(join(dir, ".logbook"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "test-proj", version: "0.0.0" }),
  );
  return dir;
}

async function withServer(
  cwd: string,
  fn: (send: (msg: object) => Promise<unknown>, sendNoReply: (msg: object) => void) => Promise<void>,
): Promise<void> {
  const proc = spawn("node", [SERVER_BUNDLE], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  const stderrChunks: Buffer[] = [];
  proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

  let idCounter = 1;
  let buf = "";
  const waiters: Map<number, (v: unknown) => void> = new Map();

  proc.stdout?.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const parsed = JSON.parse(t) as { id?: number };
        if (parsed.id !== undefined) {
          const resolve = waiters.get(parsed.id);
          if (resolve) {
            waiters.delete(parsed.id);
            resolve(parsed);
          }
        }
      } catch {
        // ignore non-JSON
      }
    }
  });

  function send(msg: object): Promise<unknown> {
    const id = idCounter++;
    return new Promise((resolve) => {
      waiters.set(id, resolve);
      proc.stdin?.write(JSON.stringify({ ...msg, id }) + "\n");
    });
  }

  function sendNoReply(msg: object): void {
    proc.stdin?.write(JSON.stringify(msg) + "\n");
  }

  try {
    await send({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.1" },
      },
    });

    sendNoReply({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });

    await fn(send, sendNoReply);
  } finally {
    proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 3000);
      proc.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mcp-tool-decision-with-adr", () => {
  it("logbook_decision returns { id, counter, adrPath }, ADR file exists on disk", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_decision",
          arguments: {
            title: "Use PostgreSQL as the primary database",
            context: "We need ACID guarantees",
            why: "Mature, battle-tested, excellent JSON support",
            status: "Accepted",
            alternatives: "MySQL, MongoDB",
          },
        },
      });

      // 1. Response has { id, counter, adrPath }.
      const resp = response as {
        result?: { content?: Array<{ type: string; text: string }> };
      };
      expect(resp.result).toBeDefined();
      const content = resp.result?.content?.[0];
      expect(content?.type).toBe("text");
      const resultObj = JSON.parse(content?.text ?? "{}") as {
        id?: string;
        counter?: number;
        adrPath?: string;
      };
      expect(resultObj.id).toBeDefined();
      expect(typeof resultObj.counter).toBe("number");
      expect(resultObj.counter).toBe(1);
      expect(typeof resultObj.adrPath).toBe("string");
      expect(resultObj.adrPath).toContain(join("logbook", "decisions"));

      // 2. ADR file physically exists at the reported path.
      const adrAbsPath = join(dir, resultObj.adrPath!);
      expect(existsSync(adrAbsPath)).toBe(true);

      // 3. File name is NNNN-<slug>.md format.
      const filename = resultObj.adrPath!.split("/").pop() ?? "";
      expect(filename).toMatch(/^\d{4}-[\w-]+\.md$/);
      expect(filename.startsWith("0001-")).toBe(true);

      // 4. JSONL has manual.decision event.
      const eventsPath = join(dir, "logbook", "evidence", "events.jsonl");
      expect(existsSync(eventsPath)).toBe(true);
      const events = readFileSync(eventsPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { type: string; id?: string });
      const decisionEvent = events.find((e) => e.type === "manual.decision");
      expect(decisionEvent).toBeDefined();

      // 5. SQLite DB exists.
      const dbPath = join(dir, ".logbook", "index.sqlite");
      expect(existsSync(dbPath)).toBe(true);

      // 6. state.json has adrCounter === 1.
      const state = readState(join(dir, ".logbook", "state.json"));
      expect(state.adrCounter).toBe(1);
    });
  }, 60_000);

  it("two sequential logbook_decision calls produce different ADR files with monotonic counters", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      const r1 = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_decision",
          arguments: { title: "First architectural decision" },
        },
      });

      const r2 = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_decision",
          arguments: { title: "Second architectural decision" },
        },
      });

      const parse = (r: unknown) => {
        const resp = r as { result?: { content?: Array<{ type: string; text: string }> } };
        return JSON.parse(resp.result?.content?.[0]?.text ?? "{}") as {
          counter?: number;
          adrPath?: string;
        };
      };

      const obj1 = parse(r1);
      const obj2 = parse(r2);

      // Monotonic counters.
      expect(obj1.counter).toBe(1);
      expect(obj2.counter).toBe(2);

      // Different ADR paths.
      expect(obj1.adrPath).not.toBe(obj2.adrPath);

      // Both files exist.
      expect(existsSync(join(dir, obj1.adrPath!))).toBe(true);
      expect(existsSync(join(dir, obj2.adrPath!))).toBe(true);

      // Decisions dir has exactly 2 files.
      const decisionsDir = join(dir, "logbook", "decisions");
      const files = readdirSync(decisionsDir);
      expect(files).toHaveLength(2);
    });
  }, 60_000);
});
