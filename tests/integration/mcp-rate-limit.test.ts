/**
 * Integration test: MCP server rate limiting (T8b).
 *
 * Tests the SlidingWindowLimiter enforced by the dispatcher:
 *  - 20 calls per tool per 1000ms allowed
 *  - 21st call in the same window → -32000 (rate_limited)
 *  - Window slides: after 1100ms, a new call succeeds
 *  - Per-tool isolation: lesson and error each have their own 20-count window;
 *    alternating 20 of each (40 total) all succeed
 *
 * Timing note: the sliding window implementation in rate-limit.ts uses timestamps
 * so these tests do rely on wall-clock timing. The 1100ms wait is deliberately
 * conservative (window is 1000ms) to avoid flakiness on slow CI machines.
 * If flakiness is observed, increase to 1500ms.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
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
    `logbook-test-ratelimit-${randomBytes(6).toString("hex")}`,
  );
  mkdirSync(join(dir, ".logbook"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "test-proj", version: "0.0.0" }),
  );
  return dir;
}

interface ServerHandle {
  send: (msg: object) => Promise<unknown>;
  sendNoReply: (msg: object) => void;
  kill: () => Promise<void>;
}

async function spawnServer(cwd: string): Promise<ServerHandle> {
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

  // Perform handshake
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

  async function kill(): Promise<void> {
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

  return { send, sendNoReply, kill };
}

function callLesson(send: ServerHandle["send"], text = "rate limit test"): Promise<unknown> {
  return send({
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: "logbook_lesson", arguments: { text } },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mcp-rate-limit", () => {
  it("20 rapid calls succeed; 21st in same window → -32000 (rate_limited)", async () => {
    const dir = makeTmpProject();
    const server = await spawnServer(dir);

    try {
      // Send all 20 calls; they should all succeed.
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) => callLesson(server.send, `msg-${i}`)),
      );

      for (const resp of responses) {
        const r = resp as { result?: unknown; error?: { code?: number } };
        expect(r.error).toBeUndefined();
        expect(r.result).toBeDefined();
      }

      // 21st call — should be rate limited.
      const response21 = await callLesson(server.send, "msg-21");
      const r21 = response21 as { error?: { code?: number; message?: string } };
      expect(r21.error).toBeDefined();
      expect(r21.error?.code).toBe(-32000);
    } finally {
      await server.kill();
    }
  }, 30_000);

  it("after 1100ms window slides and next call succeeds", async () => {
    const dir = makeTmpProject();
    const server = await spawnServer(dir);

    try {
      // Exhaust the window.
      await Promise.all(
        Array.from({ length: 20 }, (_, i) => callLesson(server.send, `exhaust-${i}`)),
      );

      // Verify limit is hit.
      const rateLimited = await callLesson(server.send, "should-fail");
      const rl = rateLimited as { error?: { code?: number } };
      expect(rl.error?.code).toBe(-32000);

      // Wait for the window to slide past.
      await new Promise((r) => setTimeout(r, 1100));

      // Now the call should succeed.
      const afterWait = await callLesson(server.send, "after-wait");
      const aw = afterWait as { result?: unknown; error?: unknown };
      expect(aw.error).toBeUndefined();
      expect(aw.result).toBeDefined();
    } finally {
      await server.kill();
    }
  }, 15_000);

  it("per-tool isolation: 20 lesson + 20 error calls all succeed (separate windows)", async () => {
    const dir = makeTmpProject();
    const server = await spawnServer(dir);

    try {
      // Interleave 20 lesson and 20 error calls (40 total, <1s).
      const calls: Promise<unknown>[] = [];
      for (let i = 0; i < 20; i++) {
        calls.push(
          server.send({
            jsonrpc: "2.0",
            method: "tools/call",
            params: { name: "logbook_lesson", arguments: { text: `lesson-${i}` } },
          }),
        );
        calls.push(
          server.send({
            jsonrpc: "2.0",
            method: "tools/call",
            params: { name: "logbook_error", arguments: { title: `error-${i}` } },
          }),
        );
      }

      const responses = await Promise.all(calls);
      for (const resp of responses) {
        const r = resp as { result?: unknown; error?: { code?: number } };
        // Each per-tool window is independent — none should be rate-limited.
        expect(r.error).toBeUndefined();
        expect(r.result).toBeDefined();
      }
    } finally {
      await server.kill();
    }
  }, 30_000);
});
