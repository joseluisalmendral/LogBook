/**
 * Integration test: logbook_decision MCP tool handler (T8a).
 *
 * Exercises the full dispatcher pipeline:
 *   rate-limit → payload size → valibot strict → path-confine (n/a) →
 *   audit-before-effect → redact → handler (JSONL + SQLite)
 *
 * Note on ADR generation: logbook_decision in T8a writes JSONL + SQLite only.
 * ADR file generation is wired in T9 (temporal coupling — see T8a/T9 boundary
 * in apply-progress). The integration test asserts JSONL + SQLite presence but
 * does NOT assert an ADR file in logbook/decisions/.
 *
 * Audit-before-effect contract: the events.jsonl file MUST contain BOTH a
 * `mcp.tool_call` audit event AND the `manual.decision` event, AND the audit
 * event's `ts` MUST precede or equal the decision event's `ts`.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
const SERVER_BUNDLE = join(PROJECT_ROOT, "dist", "mcp", "server.cjs");

// Build once before all tests if the bundle is not already present.
// mcp-boot.test.ts also builds; to avoid parallel build races (clean: true wipes dist),
// we only build here if no bundle exists yet. In CI, pnpm build runs before the test suite.
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

/** Create a fresh isolated project dir that passes resolveProjectRoot. */
function makeTmpProject(): string {
  const dir = join(
    tmpdir(),
    `logbook-test-decision-${randomBytes(6).toString("hex")}`,
  );
  mkdirSync(join(dir, ".logbook"), { recursive: true });
  // Presence of package.json makes resolveProjectRoot happy.
  require("node:fs").writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "test-proj", version: "0.0.0" }),
  );
  return dir;
}

/**
 * Spawn the server, perform the MCP handshake, run `fn`, then SIGTERM.
 * `fn` receives a sendAndReceive helper that sends one JSON-RPC request and
 * returns the parsed response.
 */
async function withServer(
  cwd: string,
  fn: (
    send: (msg: object) => Promise<unknown>,
    sendNoReply: (msg: object) => void,
  ) => Promise<void>,
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
    // MCP initialize handshake.
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

    if (!proc.killed && proc.exitCode !== 0) {
      const stderr = stderrChunks.map((c) => c.toString()).join("");
      if (stderr) process.stderr.write(`[server stderr]\n${stderr}\n`);
    }
  }
}

/** Read all events.jsonl lines as parsed objects. */
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

describe("mcp-tool-decision", () => {
  it("valid logbook_decision call: returns { id }, writes JSONL + SQLite, audit-before-effect", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_decision",
          arguments: {
            title: "Use SQLite as event store",
            why: "Low overhead, no external process",
            status: "Proposed",
          },
        },
      });

      // 1. Response has content[0].text with JSON containing `id`.
      const resp = response as {
        result?: { content?: Array<{ type: string; text: string }> };
      };
      expect(resp.result).toBeDefined();
      const content = resp.result?.content?.[0];
      expect(content?.type).toBe("text");
      const resultObj = JSON.parse(content?.text ?? "{}") as { id?: string };
      expect(resultObj.id).toBeDefined();
      expect(typeof resultObj.id).toBe("string");
      expect(resultObj.id!.length).toBeGreaterThan(0);

      const decisionId = resultObj.id!;

      // 2. JSONL has both audit event and decision event (Shape-A).
      const events = readEvents(dir);
      type ShapeA = { kind?: string; payload?: Record<string, unknown>; timestamp?: string; id?: string };
      const auditEvent = events.find(
        (e) => (e as ShapeA).kind === "system" &&
               (e as ShapeA).payload?.["entryType"] === "mcp_audit" &&
               (e as ShapeA).payload?.["tool"] === "logbook_decision",
      ) as ShapeA | undefined;
      const decisionEvent = events.find(
        (e) => (e as ShapeA).kind === "user_entry" &&
               (e as ShapeA).payload?.["entryType"] === "decision" &&
               (e as ShapeA).id === decisionId,
      ) as ShapeA | undefined;

      expect(auditEvent).toBeDefined();
      expect(decisionEvent).toBeDefined();

      // 3. Audit-before-effect: audit timestamp <= decision timestamp.
      const auditTs = new Date(auditEvent!.timestamp!).getTime();
      const decisionTs = new Date(decisionEvent!.timestamp!).getTime();
      expect(auditTs).toBeLessThanOrEqual(decisionTs);

      // 4. Decision event has title in payload (Shape-A).
      expect(decisionEvent!.payload?.["title"]).toBe("Use SQLite as event store");

      // 5. SQLite has a row in the decisions table.
      // We verify indirectly by checking the DB file exists.
      const dbPath = join(dir, ".logbook", "index.sqlite");
      expect(existsSync(dbPath)).toBe(true);
    });
  }, 60_000);

  it("extra field in input → JSON-RPC -32600 (valibot strict rejects unknown fields)", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_decision",
          arguments: {
            title: "Some decision",
            UNKNOWN_FIELD: "should be rejected",
          },
        },
      });

      const resp = response as {
        error?: { code?: number; message?: string };
      };
      expect(resp.error).toBeDefined();
      expect(resp.error?.code).toBe(-32600);
    });
  }, 60_000);

  it("oversized input (>8KB) → JSON-RPC -32002", async () => {
    const dir = makeTmpProject();
    // Create a payload that exceeds 8KB when JSON-serialized.
    const oversizedTitle = "x".repeat(9000);

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_decision",
          arguments: { title: oversizedTitle },
        },
      });

      const resp = response as {
        error?: { code?: number };
        result?: unknown;
      };
      expect(resp.error).toBeDefined();
      expect(resp.error?.code).toBe(-32002);
    });
  }, 60_000);

  it("title exceeding 500 chars → JSON-RPC -32600 (valibot maxLength)", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_decision",
          arguments: { title: "a".repeat(501) },
        },
      });

      const resp = response as { error?: { code?: number } };
      expect(resp.error).toBeDefined();
      expect(resp.error?.code).toBe(-32600);
    });
  }, 60_000);

  it("unknown tool name → JSON-RPC -32601", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "logbook_does_not_exist", arguments: {} },
      });

      const resp = response as { error?: { code?: number } };
      expect(resp.error).toBeDefined();
      expect(resp.error?.code).toBe(-32601);
    });
  }, 60_000);
});
