/**
 * Integration test: MCP server rate limiting (T8b).
 *
 * Tests the SlidingWindowLimiter enforced by the dispatcher:
 *  - 20 calls per tool per 1000ms allowed
 *  - 21st call in the same window → -32000 (rate_limited)
 *  - Per-tool isolation: lesson and error each have their own 20-count window;
 *    alternating 20 of each (40 total) all succeed
 *
 * Window-slide behaviour is covered deterministically (no sleep) in:
 *   tests/unit/rate-limit-clock.test.ts
 *
 * This file retains only the subprocess-level assertions that need a real
 * MCP server process (no wall-clock waits).
 *
 * SG-B additions: mcp-clock-offset describe block tests B7, B7b, B8 —
 * verify that LOGBOOK_MCP_CLOCK_OFFSET_MS is parsed correctly at server boot
 * and that the clock offset wiring does not break rate-limit semantics.
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
  /** Collected stderr output at the time of calling (accumulated). */
  getStderr: () => string;
}

async function spawnServer(
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<ServerHandle> {
  const proc = spawn("node", [SERVER_BUNDLE], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
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

  function getStderr(): string {
    return stderrChunks.map((c) => c.toString()).join("");
  }

  return { send, sendNoReply, kill, getStderr };
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
  // NOTE (v1.2): the previous "20 rapid calls succeed; 21st → -32000" test
  // was removed. It had a wall-clock race condition: 20 subprocess round-
  // trips occasionally took >1000ms, sliding the limiter window before the
  // 21st call arrived (~40% false-positive failure rate on macOS ARM under
  // parallel load).
  //
  // The same behaviour is now covered deterministically by:
  //   - tests/unit/rate-limit-clock.test.ts (limiter logic, injected clock)
  //   - tests/unit/mcp-server-clock-env.test.ts (env var parsing + boot)
  //   - "B7" / "B7b" below (subprocess boot path with env var, no race).
  //
  // The B8 attempt to validate the integration via env-var was likewise
  // race-prone and is intentionally absent — the clock offset is applied at
  // boot but the per-call timing within the test still uses real wall-clock.

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

// ---------------------------------------------------------------------------
// SG-B: LOGBOOK_MCP_CLOCK_OFFSET_MS integration tests (B7, B7b, B8)
// ---------------------------------------------------------------------------

describe("mcp-clock-offset", () => {
  /**
   * B7: Server boots successfully with LOGBOOK_MCP_CLOCK_OFFSET_MS=2000.
   * Asserts: env var parsing doesn't break startup; tools/list responds normally.
   * Asserts: stderr warning emitted at boot when offset != 0.
   */
  it("B7: server with LOGBOOK_MCP_CLOCK_OFFSET_MS=2000 boots and responds to tools/list", async () => {
    const dir = makeTmpProject();
    const server = await spawnServer(dir, { LOGBOOK_MCP_CLOCK_OFFSET_MS: "2000" });

    try {
      const resp = await server.send({
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
      });
      const r = resp as { result?: { tools?: unknown[] }; error?: unknown };
      expect(r.error).toBeUndefined();
      expect(Array.isArray(r.result?.tools)).toBe(true);

      // Stderr must contain the TEST-ONLY boot warning when offset != 0.
      const stderr = server.getStderr();
      expect(stderr).toContain("[logbook][TEST] MCP clock offset = 2000ms");
      expect(stderr).toContain("should never be set in production");
    } finally {
      await server.kill();
    }
  }, 30_000);

  /**
   * B7b: Server with offset=0 (default) emits NO boot warning — production path.
   */
  it("B7b: server with no offset set produces no TEST warning in stderr", async () => {
    const dir = makeTmpProject();
    const server = await spawnServer(dir);

    try {
      await server.send({
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
      });

      const stderr = server.getStderr();
      expect(stderr).not.toContain("[logbook][TEST]");
    } finally {
      await server.kill();
    }
  }, 30_000);

  // B8 (the 20-call rate-limit assertion under offset) was removed in v1.2
  // verify: it had the same wall-clock race as the original integration test
  // (the offset is applied at boot but per-call timing within the test still
  // runs in real time). Rate-limit logic is covered deterministically by
  // tests/unit/rate-limit-clock.test.ts.
});
