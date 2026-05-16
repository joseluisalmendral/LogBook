/**
 * Integration tests for `logbook ingest codex`.
 *
 * Requires a built CLI at dist/cli/index.cjs.
 * Codex payloads arrive via stdin (JSON or JSONL).
 *
 * Note: unlike ingest otel, ingest codex reads from stdin — no path-confine.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const ROOT = path.resolve(__dirname, "../../");
const CLI = path.join(ROOT, "dist/cli/index.cjs");
const HOOK_CJS = path.join(ROOT, "dist/connectors/claude-code/hook.cjs");

function runIngestCodex(
  stdinPayload: string,
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, "ingest", "codex"], {
    cwd,
    input: stdinPayload,
    encoding: "utf8",
    env: {
      ...process.env,
      LOGBOOK_HOOK_PATH: HOOK_CJS,
    },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readEventsJsonl(cwd: string): Record<string, unknown>[] {
  const eventsPath = path.join(cwd, "logbook", "evidence", "events.jsonl");
  if (!fs.existsSync(eventsPath)) return [];
  return fs
    .readFileSync(eventsPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("I-Codex — ingest codex stdin", () => {
  let tmp: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);
    }

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-icodex-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-codex-project", version: "0.0.1" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    const initResult = spawnSync("node", [CLI, "init", "--preset", "minimal", "--yes"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_CJS },
    });
    if ((initResult.status ?? 1) !== 0) {
      throw new Error(`init failed: ${initResult.stderr}`);
    }
  });

  // -------------------------------------------------------------------------
  // Happy path: single JSON payload
  // -------------------------------------------------------------------------

  it("exits 0 for a valid tool_call payload", () => {
    const payload = JSON.stringify({ event_type: "tool_call", tool: "Read", model: "codex" });
    const result = runIngestCodex(payload, tmp);
    expect(result.code).toBe(0);
  });

  it("outputs JSON with ingested and redacted fields", () => {
    const payload = JSON.stringify({ event_type: "tool_call", tool: "Read", model: "codex" });
    const result = runIngestCodex(payload, tmp);
    const json = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(typeof json["ingested"]).toBe("number");
    expect(typeof json["redacted"]).toBe("number");
  });

  it("ingested=1 for a single valid payload", () => {
    const payload = JSON.stringify({ event_type: "tool_call", tool: "Write", model: "codex" });
    const result = runIngestCodex(payload, tmp);
    const json = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(json["ingested"]).toBe(1);
  });

  it("events.jsonl has an event with provider=codex after ingest", () => {
    const payload = JSON.stringify({ event_type: "tool_call", tool: "Read", model: "codex" });
    runIngestCodex(payload, tmp);
    const events = readEventsJsonl(tmp);
    const codexEvent = events.find((e) => e["provider"] === "codex");
    expect(codexEvent).toBeDefined();
  });

  it("persisted event has correct kind=tool_use for event_type=tool_call", () => {
    const before = readEventsJsonl(tmp).length;
    const payload = JSON.stringify({ event_type: "tool_call", tool: "Read" });
    runIngestCodex(payload, tmp);
    const events = readEventsJsonl(tmp);
    const newEvent = events[events.length - 1];
    expect(newEvent?.["kind"]).toBe("tool_use");
  });

  // -------------------------------------------------------------------------
  // JSONL stdin: multiple events on separate lines
  // -------------------------------------------------------------------------

  it("handles two-event JSONL stdin and ingests both", () => {
    const line1 = JSON.stringify({ event_type: "tool_call", tool: "Read" });
    const line2 = JSON.stringify({ event_type: "tool_result", tool: "Read" });
    const before = readEventsJsonl(tmp).length;
    const result = runIngestCodex(line1 + "\n" + line2, tmp);
    expect(result.code).toBe(0);
    const after = readEventsJsonl(tmp).length;
    expect(after - before).toBe(2);
  });

  it("JSONL mode reports ingested=2 in JSON output", () => {
    const line1 = JSON.stringify({ event_type: "tool_call", tool: "Edit" });
    const line2 = JSON.stringify({ event_type: "tool_result", tool: "Edit" });
    const result = runIngestCodex(line1 + "\n" + line2, tmp);
    const json = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(json["ingested"]).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Malformed / non-JSON stdin — must exit 0 and write a degraded error event
  // -------------------------------------------------------------------------

  it("exits 0 for completely invalid JSON stdin", () => {
    const result = runIngestCodex("not json at all", tmp);
    expect(result.code).toBe(0);
  });

  it("writes a degraded error event to JSONL on invalid JSON", () => {
    const before = readEventsJsonl(tmp).length;
    runIngestCodex("this is not json {{{{", tmp);
    const after = readEventsJsonl(tmp).length;
    // A degraded error event must be written — never drop the parse failure silently
    expect(after).toBeGreaterThan(before);
  });

  it("degraded error event has kind=error", () => {
    runIngestCodex("bad json input", tmp);
    const events = readEventsJsonl(tmp);
    const errEvent = events.slice().reverse().find((e) => e["kind"] === "error");
    expect(errEvent).toBeDefined();
  });

  it("ingested=1 in JSON output after invalid JSON (degraded event)", () => {
    const result = runIngestCodex("invalid json payload", tmp);
    const json = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    // Degraded error event counts as ingested
    expect(json["ingested"]).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Empty stdin — exit 0 silently, no append
  // -------------------------------------------------------------------------

  it("exits 0 for empty stdin", () => {
    const result = runIngestCodex("", tmp);
    expect(result.code).toBe(0);
  });

  it("appends nothing to JSONL for empty stdin", () => {
    const before = readEventsJsonl(tmp).length;
    runIngestCodex("", tmp);
    const after = readEventsJsonl(tmp).length;
    expect(after).toBe(before);
  });

  // -------------------------------------------------------------------------
  // Disabled state — exit 0, no append
  // -------------------------------------------------------------------------

  it("exits 0 when state.disabled=true", () => {
    // Disable first
    spawnSync("node", [CLI, "disable"], { cwd: tmp, encoding: "utf8" });
    const payload = JSON.stringify({ event_type: "tool_call", tool: "Read" });
    const result = runIngestCodex(payload, tmp);
    expect(result.code).toBe(0);
    // Re-enable
    spawnSync("node", [CLI, "enable"], { cwd: tmp, encoding: "utf8" });
  });

  it("appends nothing when state.disabled=true", () => {
    spawnSync("node", [CLI, "disable"], { cwd: tmp, encoding: "utf8" });
    const before = readEventsJsonl(tmp).length;
    const payload = JSON.stringify({ event_type: "tool_call", tool: "Read" });
    runIngestCodex(payload, tmp);
    const after = readEventsJsonl(tmp).length;
    expect(after).toBe(before);
    spawnSync("node", [CLI, "enable"], { cwd: tmp, encoding: "utf8" });
  });

  // -------------------------------------------------------------------------
  // Redaction: payload containing an AWS secret key → redacted=true in JSONL
  // -------------------------------------------------------------------------

  it("exits 0 when payload contains a secret key", () => {
    // AWS-like key pattern triggers redaction
    const payload = JSON.stringify({
      event_type: "tool_call",
      tool: "Read",
      message: "AKIAIOSFODNN7EXAMPLE secret value here",
    });
    const result = runIngestCodex(payload, tmp);
    expect(result.code).toBe(0);
  });

  it("event in JSONL has redacted=true when payload contains a secret key", () => {
    const payload = JSON.stringify({
      event_type: "tool_call",
      tool: "Read",
      message: "AKIAIOSFODNN7EXAMPLE abc123secretkey",
    });
    const before = readEventsJsonl(tmp).length;
    runIngestCodex(payload, tmp);
    const events = readEventsJsonl(tmp);
    const newEvent = events[before];
    expect(newEvent?.["redacted"]).toBe(true);
  });
});
