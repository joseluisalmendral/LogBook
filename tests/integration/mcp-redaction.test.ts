/**
 * Integration test: MCP redaction pipeline (T8a).
 *
 * Verifies that secrets in tool inputs are redacted in the persisted JSONL
 * events and that the audit event records `redacted: true`.
 *
 * Uses logbook_lesson as the simplest tool with a free-text field.
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
// Helpers (duplicated minimally — T8b will extract to shared fixture)
// ---------------------------------------------------------------------------

function makeTmpProject(): string {
  const dir = join(
    tmpdir(),
    `logbook-test-redaction-${randomBytes(6).toString("hex")}`,
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

describe("mcp-redaction", () => {
  it("AWS access key in logbook_lesson text is redacted in persisted JSONL", async () => {
    const dir = makeTmpProject();

    // A fake AWS access key — matches the aws-access-key-id rule pattern.
    // Pattern: AKIA[0-9A-Z]{16}
    const fakeAwsKey = "AKIAIOSFODNN7EXAMPLE";
    const lessonText = `I accidentally committed ${fakeAwsKey} to the repo.`;

    await withServer(dir, async (send) => {
      const response = await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_lesson",
          arguments: { text: lessonText },
        },
      });

      // Tool should succeed.
      const resp = response as {
        result?: { content?: Array<{ type: string; text: string }> };
        error?: unknown;
      };
      expect(resp.error).toBeUndefined();
      expect(resp.result?.content?.[0]?.type).toBe("text");

      // Parse the result to get the event id.
      const resultObj = JSON.parse(resp.result!.content![0]!.text) as {
        id?: string;
      };
      expect(resultObj.id).toBeDefined();

      const events = readEvents(dir);

      // Find the manual.lesson event.
      const lessonEvent = events.find(
        (e) =>
          (e as { type?: string }).type === "manual.lesson" &&
          (e as { id?: string }).id === resultObj.id,
      ) as { type: string; payload?: { text?: string } } | undefined;

      expect(lessonEvent).toBeDefined();

      // The AWS key must NOT appear in the persisted payload.
      const persistedText = lessonEvent!.payload?.text ?? "";
      expect(persistedText).not.toContain(fakeAwsKey);
      // The redaction marker must be present instead.
      expect(persistedText).toContain("[REDACTED:");

      // Find the audit event for this call.
      const auditEvent = events.find(
        (e) =>
          (e as { type?: string }).type === "mcp.tool_call" &&
          (e as { tool?: string }).tool === "logbook_lesson",
      ) as { type: string; redacted?: boolean } | undefined;

      expect(auditEvent).toBeDefined();
      // Audit event must flag that redaction occurred.
      expect(auditEvent!.redacted).toBe(true);
    });
  }, 60_000);

  it("clean input: audit event has redacted=false", async () => {
    const dir = makeTmpProject();

    await withServer(dir, async (send) => {
      await send({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "logbook_lesson",
          arguments: { text: "Always test before commit." },
        },
      });

      const events = readEvents(dir);
      const auditEvent = events.find(
        (e) =>
          (e as { type?: string }).type === "mcp.tool_call" &&
          (e as { tool?: string }).tool === "logbook_lesson",
      ) as { redacted?: boolean } | undefined;

      expect(auditEvent).toBeDefined();
      expect(auditEvent!.redacted).toBe(false);
    });
  }, 60_000);
});
