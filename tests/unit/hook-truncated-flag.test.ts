/**
 * Unit tests: truncated + parse_error meta flags in ingestClaudePayload (PR 3).
 *
 * Truth table (from design Fix 5):
 *
 *   stdin OK   + JSON OK  → neither flag
 *   stdin OK   + JSON fail → parse_error: true
 *   timedOut   + JSON OK  → truncated: true
 *   timedOut   + JSON fail → truncated: true AND parse_error: true
 *
 * Strategy: call ingestClaudePayload() directly with a real temp project dir,
 * then inspect the written JSONL line for the meta flags.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ingestClaudePayload } from "../../src/connectors/claude-code/ingest.js";

// ---------------------------------------------------------------------------
// Temp project setup
// ---------------------------------------------------------------------------

let tmpDir: string;

function eventsJsonlPath(): string {
  return join(tmpDir, "logbook", "evidence", "events.jsonl");
}

function readLastEvent(): Record<string, unknown> {
  const p = eventsJsonlPath();
  if (!existsSync(p)) return {};
  const lines = readFileSync(p, "utf-8").split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lb-truncated-flag-unit-"));
  writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }) + "\n");
  mkdirSync(join(tmpDir, ".logbook"), { recursive: true });
  mkdirSync(join(tmpDir, "logbook", "evidence"), { recursive: true });
  writeFileSync(
    join(tmpDir, ".logbook", "state.json"),
    JSON.stringify({ disabled: false }) + "\n",
  );
  vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_PAYLOAD = JSON.stringify({
  hook_event_name: "PostToolUse",
  session_id: "sess-test-01",
  tool_name: "Bash",
  tool_response: "ok",
});

const MALFORMED_PAYLOAD = "{ NOT VALID JSON {{ end }}";

// ---------------------------------------------------------------------------
// Truth table rows
// ---------------------------------------------------------------------------

describe("hook truncated + parse_error meta flags", () => {
  it("row 1: stdin OK + JSON OK → no truncated, no parse_error flags", async () => {
    await ingestClaudePayload({
      stdinPayload: VALID_PAYLOAD,
      stdinTruncated: false,
    });

    const event = readLastEvent();
    const meta = (event["meta"] ?? {}) as Record<string, unknown>;
    expect(meta["truncated"]).toBeUndefined();
    expect(meta["parse_error"]).toBeUndefined();
  });

  it("row 2: stdin OK + JSON fail → parse_error: true, no truncated", async () => {
    await ingestClaudePayload({
      stdinPayload: MALFORMED_PAYLOAD,
      stdinTruncated: false,
    });

    const event = readLastEvent();
    const meta = (event["meta"] ?? {}) as Record<string, unknown>;
    // parse_error may be set in meta by the degraded-record path
    expect(meta["parse_error"]).toBe(true);
    expect(meta["truncated"]).toBeUndefined();
  });

  it("row 3: timedOut + JSON OK → truncated: true, no parse_error", async () => {
    await ingestClaudePayload({
      stdinPayload: VALID_PAYLOAD,
      stdinTruncated: true,
    });

    const event = readLastEvent();
    const meta = (event["meta"] ?? {}) as Record<string, unknown>;
    expect(meta["truncated"]).toBe(true);
    expect(meta["parse_error"]).toBeUndefined();
  });

  it("row 4: timedOut + JSON fail → both truncated: true AND parse_error: true", async () => {
    await ingestClaudePayload({
      stdinPayload: MALFORMED_PAYLOAD,
      stdinTruncated: true,
    });

    const event = readLastEvent();
    const meta = (event["meta"] ?? {}) as Record<string, unknown>;
    expect(meta["truncated"]).toBe(true);
    expect(meta["parse_error"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spec hard rule: event.meta.api_key with secret is redacted
// ---------------------------------------------------------------------------

describe("hook meta redaction (spec hard rule)", () => {
  it("api_key in unknown top-level field is redacted in stored event", async () => {
    const payloadWithSecret = JSON.stringify({
      hook_event_name: "PostToolUse",
      session_id: "sess-redact-meta",
      tool_name: "Bash",
      tool_response: "ok",
      // This unknown field ends up in event.meta via normalizeClaudeEvent
      api_key: "sk_test_FAKE_AAAA1234567890",
    });

    const result = await ingestClaudePayload({
      stdinPayload: payloadWithSecret,
      stdinTruncated: false,
    });

    expect(result.written).toBe(true);

    const event = readLastEvent();
    const meta = (event["meta"] ?? {}) as Record<string, unknown>;

    // The raw secret must NOT appear in meta.
    const metaStr = JSON.stringify(meta);
    expect(metaStr).not.toContain("sk_test_FAKE_AAAA1234567890");
    // A redaction marker must be present.
    expect(metaStr).toContain("[REDACTED:");
    // The event-level redacted flag must be true.
    expect(event["redacted"]).toBe(true);
  });
});
