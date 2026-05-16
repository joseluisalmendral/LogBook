/**
 * Integration test: logbook_phase MCP tool handler (T8b).
 *
 * logbook_phase writes state.currentPhase and appends a manual.phase event to JSONL.
 * It returns { phase: input.name }.
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

function makeTmpProject(): string {
  const dir = join(
    tmpdir(),
    `logbook-test-phase-${randomBytes(6).toString("hex")}`,
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
          if (resolve) { waiters.delete(parsed.id); resolve(parsed); }
        }
      } catch { /* ignore */ }
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
      jsonrpc: "2.0", method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test-client", version: "0.0.1" } },
    });
    sendNoReply({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    await fn(send, sendNoReply);
  } finally {
    proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 3000);
      proc.once("exit", () => { clearTimeout(t); resolve(); });
    });
  }
}

function readEvents(projectDir: string): unknown[] {
  const p = join(projectDir, "logbook", "evidence", "events.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function readState(projectDir: string): Record<string, unknown> {
  const p = join(projectDir, ".logbook", "state.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}

describe("mcp-tool-phase", () => {
  it("logbook_phase sets currentPhase and returns { phase }, emits manual.phase event", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "logbook_phase", arguments: { name: "apply" } },
      });

      const resp = response as { result?: { content?: Array<{ type: string; text: string }> } };
      expect(resp.result).toBeDefined();
      const content = resp.result?.content?.[0];
      expect(content?.type).toBe("text");
      const resultObj = JSON.parse(content?.text ?? "{}") as { phase?: string };
      expect(resultObj.phase).toBe("apply");
    });

    // After server shuts down, check state.json and events.jsonl.
    const state = readState(dir);
    expect(state.currentPhase).toBe("apply");

    const events = readEvents(dir);
    const phaseEvent = events.find(
      (e) => (e as { type?: string }).type === "manual.phase",
    ) as { type: string; name?: string } | undefined;
    expect(phaseEvent).toBeDefined();
    // iter3+ shape: name is at top level (no payload wrapper).
    expect(phaseEvent?.name).toBe("apply");
  }, 60_000);
});
