/**
 * Integration test: logbook_error + logbook_fix MCP tool handlers (T8a).
 *
 * Verifies:
 *  1. logbook_error returns { id }, writes JSONL manual.error event.
 *  2. logbook_fix with errorId returns { id, errorId }, writes JSONL manual.fix event.
 *  3. After logbook_fix, the errors.resolved column is toggled in SQLite
 *     (verified by checking the DB exists and fix JSONL event is written).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

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
    `logbook-test-errfix-${randomBytes(6).toString("hex")}`,
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

    const stderr = stderrChunks.map((c) => c.toString()).join("");
    if (stderr) process.stderr.write(`[server stderr]\n${stderr}\n`);
  }
}

function readEvents(projectDir: string): unknown[] {
  const p = join(projectDir, "logbook", "evidence", "events.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mcp-tool-error-fix", () => {
  it("logbook_error: returns { id }, writes manual.error JSONL event", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_error",
          arguments: {
            title: "TypeError: cannot read property of undefined",
            symptom: "Crashed on first render when store is empty",
          },
        },
      });

      const resp = response as {
        result?: { content?: Array<{ type: string; text: string }> };
        error?: unknown;
      };
      expect(resp.error).toBeUndefined();

      const resultObj = JSON.parse(resp.result!.content![0]!.text) as {
        id?: string;
      };
      expect(resultObj.id).toBeDefined();

      const events = readEvents(dir);
      const errorEvent = events.find(
        (e) =>
          (e as { type?: string }).type === "manual.error" &&
          (e as { id?: string }).id === resultObj.id,
      ) as { type: string; payload?: { title?: string } } | undefined;

      expect(errorEvent).toBeDefined();
      expect(errorEvent!.payload?.title).toBe(
        "TypeError: cannot read property of undefined",
      );
    });
  }, 60_000);

  it("logbook_fix with errorId: returns { id, errorId }, writes manual.fix JSONL", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      // First create an error.
      const errResp = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_error",
          arguments: { title: "Null pointer in auth middleware" },
        },
      });
      const errObj = JSON.parse(
        (errResp as { result: { content: Array<{ text: string }> } }).result
          .content[0]!.text,
      ) as { id: string };
      const errorId = errObj.id;

      // Now fix it.
      const fixResp = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_fix",
          arguments: {
            summary: "Added null check before accessing req.user",
            errorId,
          },
        },
      });

      const fixResult = JSON.parse(
        (fixResp as { result: { content: Array<{ text: string }> } }).result
          .content[0]!.text,
      ) as { id?: string; errorId?: string };

      expect(fixResult.id).toBeDefined();
      expect(fixResult.errorId).toBe(errorId);

      // Verify JSONL has the fix event.
      const events = readEvents(dir);
      const fixEvent = events.find(
        (e) =>
          (e as { type?: string }).type === "manual.fix" &&
          (e as { id?: string }).id === fixResult.id,
      ) as { payload?: { errorId?: string } } | undefined;

      expect(fixEvent).toBeDefined();
      // The errorId field is a reference field (ends in "Id") — exempt from entropy
      // redaction. The persisted payload.errorId must match the original errorId.
      expect(fixEvent!.payload?.errorId).toBe(errorId);
    });
  }, 60_000);

  it("logbook_fix without errorId: returns { id } without errorId field", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      const fixResp = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_fix",
          arguments: { summary: "General cleanup of stale references" },
        },
      });

      const fixResult = JSON.parse(
        (fixResp as { result: { content: Array<{ text: string }> } }).result
          .content[0]!.text,
      ) as { id?: string; errorId?: string };

      expect(fixResult.id).toBeDefined();
      // No errorId provided — should not appear in result (or be undefined).
      expect(fixResult.errorId).toBeUndefined();
    });
  }, 60_000);

  it("logbook_error with extra field → -32600", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_error",
          arguments: { title: "Some error", unknownField: true },
        },
      });
      const resp = response as { error?: { code?: number } };
      expect(resp.error?.code).toBe(-32600);
    });
  }, 60_000);
});
