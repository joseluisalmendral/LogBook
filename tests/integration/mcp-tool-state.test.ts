/**
 * Integration test: logbook_state MCP tool handler (T8b).
 *
 * logbook_state is READ-ONLY. Its handler body writes nothing.
 * The dispatcher's audit pipeline still writes a `mcp.tool_call` event —
 * that is expected and asserted here. What MUST NOT happen is a `manual.state`
 * event from the tool body itself.
 *
 * Acceptance criteria (from T8b spec):
 *  1. Returns { phase, session, pending } correctly populated from state.json
 *     and pending-suggestions.jsonl.
 *  2. Response stringifies to ≤ 120 chars (≤ 30 tokens budget).
 *  3. Empty state (no currentPhase, no session, no pending file) → { pending: 0 }
 *     (phase and session omitted when absent).
 *  4. No `manual.state` event written by tool body (audit event IS written).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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

function makeTmpProject(options?: {
  state?: Record<string, unknown>;
  pendingSuggestions?: number;
}): string {
  const dir = join(
    tmpdir(),
    `logbook-test-state-${randomBytes(6).toString("hex")}`,
  );
  mkdirSync(join(dir, ".logbook"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "test-proj", version: "0.0.0" }),
  );

  if (options?.state) {
    writeFileSync(
      join(dir, ".logbook", "state.json"),
      JSON.stringify({ version: 1, disabled: false, warnings: [], staleLocksReleased: 0, ...options.state }),
    );
  }

  if (options?.pendingSuggestions && options.pendingSuggestions > 0) {
    mkdirSync(join(dir, "logbook", "evidence"), { recursive: true });
    const lines = Array.from({ length: options.pendingSuggestions }, (_, i) =>
      JSON.stringify({ id: `sug-${i}`, type: "suggestion" }),
    ).join("\n");
    writeFileSync(join(dir, ".logbook", "pending-suggestions.jsonl"), lines + "\n");
  }

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

describe("mcp-tool-state", () => {
  it("returns { phase, session, pending } from state.json with 3 pending suggestions", async () => {
    const dir = makeTmpProject({
      state: { currentPhase: "design", session: "sess-001" },
      pendingSuggestions: 3,
    });

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "logbook_state", arguments: {} },
      });

      const resp = response as { result?: { content?: Array<{ type: string; text: string }> } };
      expect(resp.result).toBeDefined();
      const content = resp.result?.content?.[0];
      expect(content?.type).toBe("text");
      const resultObj = JSON.parse(content?.text ?? "{}") as {
        phase?: string;
        session?: string;
        pending?: number;
      };

      expect(resultObj.phase).toBe("design");
      expect(resultObj.session).toBe("sess-001");
      expect(resultObj.pending).toBe(3);
    });
  }, 60_000);

  it("response stringifies to ≤ 120 chars (≤ 30 token budget)", async () => {
    const dir = makeTmpProject({
      state: { currentPhase: "design", session: "sess-001" },
      pendingSuggestions: 3,
    });

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "logbook_state", arguments: {} },
      });

      const resp = response as { result?: { content?: Array<{ type: string; text: string }> } };
      const text = resp.result?.content?.[0]?.text ?? "";
      const charCount = text.length;
      expect(charCount).toBeLessThanOrEqual(120);
    });
  }, 60_000);

  it("audit event is written (mcp.tool_call) but NO manual.state event from tool body", async () => {
    const dir = makeTmpProject({
      state: { currentPhase: "apply" },
    });

    await withServer(dir, async (send) => {
      await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "logbook_state", arguments: {} },
      });
    });

    const events = readEvents(dir);
    const auditEvents = events.filter(
      (e) => (e as { type?: string }).type === "mcp.tool_call" &&
             (e as { tool?: string }).tool === "logbook_state",
    );
    const manualStateEvents = events.filter(
      (e) => (e as { type?: string }).type === "manual.state",
    );

    // Audit event IS expected (dispatcher always writes audit before tool body).
    expect(auditEvents.length).toBe(1);
    // Tool body must NOT write any event (read-only tool).
    expect(manualStateEvents.length).toBe(0);
  }, 60_000);

  it("empty state (no phase, no session, no pending file) → { pending: 0 }", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "logbook_state", arguments: {} },
      });

      const resp = response as { result?: { content?: Array<{ type: string; text: string }> } };
      expect(resp.result).toBeDefined();
      const content = resp.result?.content?.[0];
      const resultObj = JSON.parse(content?.text ?? "{}") as {
        phase?: string;
        session?: string;
        pending?: number;
      };

      expect(resultObj.phase).toBeUndefined();
      expect(resultObj.session).toBeUndefined();
      expect(resultObj.pending).toBe(0);
    });
  }, 60_000);
});
