/**
 * Unit tests for the four-slot session_id resolver in ingestClaudePayload.
 *
 * Priority order (Req 2.1):
 *   opts.sessionId > parsed.session_id > process.env.LOGBOOK_SESSION_ID > ulidFn()
 *
 * Strategy: call ingestClaudePayload() with a real temp project dir (minimal setup)
 * so we exercise the actual resolver code path without relying on a built CLI.
 * Each test verifies which sessionId ends up in the returned IngestResult by
 * reading the written JSONL line.
 *
 * extractValidSessionId edge cases are tested here indirectly via the resolver.
 */

import { describe, it, expect, afterEach, afterAll, beforeAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We import ingestClaudePayload directly (unit test — no build required).
import { ingestClaudePayload } from "../../src/connectors/claude-code/ingest.js";

// ---------------------------------------------------------------------------
// Temp project setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lb-resolver-unit-"));
  // Minimal project markers so resolveProjectRoot() succeeds.
  writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }) + "\n");
  mkdirSync(join(tmpDir, ".logbook"), { recursive: true });
  // State file — needed so readState() doesn't crash.
  writeFileSync(
    join(tmpDir, ".logbook", "state.json"),
    JSON.stringify({ disabled: false }) + "\n",
  );
  // Point process.cwd() to our temp dir for resolveProjectRoot() to find it.
  vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterAll(() => {
  vi.restoreAllMocks();
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Clean env between tests to avoid bleed.
let savedLogbookSessionId: string | undefined;
afterEach(() => {
  if (savedLogbookSessionId === undefined) {
    delete process.env["LOGBOOK_SESSION_ID"];
  } else {
    process.env["LOGBOOK_SESSION_ID"] = savedLogbookSessionId;
  }
  savedLogbookSessionId = undefined;
});

function setEnvSessionId(val: string): void {
  savedLogbookSessionId = process.env["LOGBOOK_SESSION_ID"];
  process.env["LOGBOOK_SESSION_ID"] = val;
}

function clearEnvSessionId(): void {
  savedLogbookSessionId = process.env["LOGBOOK_SESSION_ID"];
  delete process.env["LOGBOOK_SESSION_ID"];
}

/** Read the last JSONL line from the events file and parse it. */
function readLastEvent(): Record<string, unknown> | undefined {
  const eventsPath = join(tmpDir, "logbook", "evidence", "events.jsonl");
  if (!existsSync(eventsPath)) return undefined;
  const lines = readFileSync(eventsPath, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  if (lines.length === 0) return undefined;
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
}

/** Build a minimal PostToolUse payload string. */
function makePayload(sessionId?: string): string {
  const base: Record<string, unknown> = {
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_args: { command: "echo" },
    tool_response: { output: "ok" },
  };
  if (sessionId !== undefined) base["session_id"] = sessionId;
  return JSON.stringify(base);
}

// ---------------------------------------------------------------------------
// Priority slot tests
// ---------------------------------------------------------------------------

describe("session_id resolver — priority order (Req 2.1)", () => {
  it("slot 1 (opts.sessionId) wins over payload session_id", async () => {
    clearEnvSessionId();
    const result = await ingestClaudePayload({
      stdinPayload: makePayload("payload-id"),
      sessionId: "opts-id",
      ulid: () => "ULID-FALLBACK",
    });
    expect(result.written).toBe(true);
    const event = readLastEvent();
    expect(event?.["sessionId"]).toBe("opts-id");
  });

  it("slot 2 (payload session_id) wins over env when opts absent", async () => {
    clearEnvSessionId();
    const result = await ingestClaudePayload({
      stdinPayload: makePayload("payload-uuid-123"),
      ulid: () => "ULID-FALLBACK",
    });
    expect(result.written).toBe(true);
    const event = readLastEvent();
    expect(event?.["sessionId"]).toBe("payload-uuid-123");
  });

  it("slot 3 (env LOGBOOK_SESSION_ID) wins over ULID when payload has no session_id", async () => {
    setEnvSessionId("env-session-99");
    const result = await ingestClaudePayload({
      stdinPayload: makePayload(), // no session_id in payload
      ulid: () => "ULID-FALLBACK",
    });
    expect(result.written).toBe(true);
    const event = readLastEvent();
    expect(event?.["sessionId"]).toBe("env-session-99");
  });

  it("slot 4 (ulidFn) fires when all other slots are absent", async () => {
    clearEnvSessionId();
    const result = await ingestClaudePayload({
      stdinPayload: makePayload(), // no session_id
      ulid: () => "PREDICTABLE-ULID",
    });
    expect(result.written).toBe(true);
    const event = readLastEvent();
    expect(event?.["sessionId"]).toBe("PREDICTABLE-ULID");
  });
});

// ---------------------------------------------------------------------------
// extractValidSessionId edge cases (via resolver)
// ---------------------------------------------------------------------------

describe("session_id resolver — extractValidSessionId edge cases", () => {
  it("ignores empty string session_id in payload (falls through to ULID)", async () => {
    clearEnvSessionId();
    const result = await ingestClaudePayload({
      stdinPayload: makePayload(""),
      ulid: () => "ULID-EMPTY-STRING",
    });
    expect(result.written).toBe(true);
    const event = readLastEvent();
    expect(event?.["sessionId"]).toBe("ULID-EMPTY-STRING");
  });

  it("ignores whitespace-only session_id in payload (falls through to ULID)", async () => {
    clearEnvSessionId();
    const result = await ingestClaudePayload({
      stdinPayload: makePayload("   "),
      ulid: () => "ULID-WHITESPACE",
    });
    expect(result.written).toBe(true);
    const event = readLastEvent();
    expect(event?.["sessionId"]).toBe("ULID-WHITESPACE");
  });

  it("ignores oversized session_id (> 128 chars) and falls through to ULID", async () => {
    clearEnvSessionId();
    const oversized = "x".repeat(129);
    const result = await ingestClaudePayload({
      stdinPayload: makePayload(oversized),
      ulid: () => "ULID-OVERSIZED",
    });
    expect(result.written).toBe(true);
    const event = readLastEvent();
    expect(event?.["sessionId"]).toBe("ULID-OVERSIZED");
  });

  it("accepts session_id exactly at the 128-char limit", async () => {
    clearEnvSessionId();
    const exactly128 = "a".repeat(128);
    const result = await ingestClaudePayload({
      stdinPayload: makePayload(exactly128),
      ulid: () => "ULID-SHOULD-NOT-FIRE",
    });
    expect(result.written).toBe(true);
    const event = readLastEvent();
    expect(event?.["sessionId"]).toBe(exactly128);
  });

  it("accepts valid UUID-format session_id from payload", async () => {
    clearEnvSessionId();
    const uuid = "abc12345-dead-beef-0000-000000000001";
    const result = await ingestClaudePayload({
      stdinPayload: makePayload(uuid),
      ulid: () => "ULID-SHOULD-NOT-FIRE",
    });
    expect(result.written).toBe(true);
    const event = readLastEvent();
    expect(event?.["sessionId"]).toBe(uuid);
  });

  it("handles non-string session_id in payload (number) by falling to ULID", async () => {
    clearEnvSessionId();
    // Inject a numeric session_id via raw JSON
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      session_id: 42,
      tool_name: "Bash",
      tool_args: { command: "echo" },
      tool_response: { output: "ok" },
    });
    const result = await ingestClaudePayload({
      stdinPayload: payload,
      ulid: () => "ULID-NON-STRING",
    });
    expect(result.written).toBe(true);
    const event = readLastEvent();
    expect(event?.["sessionId"]).toBe("ULID-NON-STRING");
  });
});
