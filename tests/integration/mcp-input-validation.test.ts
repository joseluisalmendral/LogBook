/**
 * Integration test: MCP input validation pipeline (T8b).
 *
 * Exercises the dispatcher's validation steps (steps 2–4 in the pipeline):
 *  - Oversized payload (>8192 bytes) → -32002 payload_too_large
 *  - Extra fields on any tool → -32600 invalid_input (valibot strict)
 *  - Missing required fields → -32600 invalid_input
 *  - Type mismatch → -32600 invalid_input
 *  - Title > 500 chars → -32600 invalid_input (valibot maxLength)
 *  - Unknown tool → -32601 method_not_found
 *
 * Path traversal note: no T8 tool (T8a or T8b) declares pathFields, so the
 * path-confinement step (-32001) is not exercised by any T8 tool. This is
 * documented in apply-progress as "path-confine pipeline exists but no T8 tool
 * exercises it; T11 generate may." If a future tool adds pathFields, add a test here.
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
    `logbook-test-validation-${randomBytes(6).toString("hex")}`,
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
  fn: (send: (msg: object) => Promise<unknown>) => Promise<void>,
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
        // ignore
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

  try {
    // Handshake
    await send({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.1" },
      },
    });
    proc.stdin?.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n",
    );

    await fn(send);
  } finally {
    proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 3000);
      proc.once("exit", () => { clearTimeout(t); resolve(); });
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mcp-input-validation", () => {
  it("oversized payload (>8KB) → -32002 payload_too_large", async () => {
    const dir = makeTmpProject();
    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_lesson",
          arguments: { text: "x".repeat(9000) },
        },
      });
      const resp = response as { error?: { code?: number; message?: string } };
      expect(resp.error).toBeDefined();
      expect(resp.error?.code).toBe(-32002);
    });
  }, 30_000);

  it("extra unknown field → -32600 (valibot strict)", async () => {
    const dir = makeTmpProject();
    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_lesson",
          arguments: { text: "valid text", unknown_field: 42 },
        },
      });
      const resp = response as { error?: { code?: number } };
      expect(resp.error).toBeDefined();
      expect(resp.error?.code).toBe(-32600);
    });
  }, 30_000);

  it("missing required field → -32600", async () => {
    const dir = makeTmpProject();
    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_lesson",
          arguments: {},
        },
      });
      const resp = response as { error?: { code?: number } };
      expect(resp.error).toBeDefined();
      expect(resp.error?.code).toBe(-32600);
    });
  }, 30_000);

  it("type mismatch (text is number) → -32600", async () => {
    const dir = makeTmpProject();
    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_lesson",
          arguments: { text: 42 },
        },
      });
      const resp = response as { error?: { code?: number } };
      expect(resp.error).toBeDefined();
      expect(resp.error?.code).toBe(-32600);
    });
  }, 30_000);

  it("title > 500 chars → -32600 (valibot maxLength)", async () => {
    const dir = makeTmpProject();
    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_lesson",
          arguments: { text: "x".repeat(501) },
        },
      });
      const resp = response as { error?: { code?: number } };
      expect(resp.error).toBeDefined();
      expect(resp.error?.code).toBe(-32600);
    });
  }, 30_000);

  it("unknown tool name → -32601 method_not_found", async () => {
    const dir = makeTmpProject();
    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "nonexistent_tool", arguments: {} },
      });
      const resp = response as { error?: { code?: number } };
      expect(resp.error).toBeDefined();
      expect(resp.error?.code).toBe(-32601);
    });
  }, 30_000);
});
