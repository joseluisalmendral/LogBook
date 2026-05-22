/**
 * Unit tests: appendEvent chokepoint contract.
 *
 * Covers:
 * 1. Shape-A output (schemaVersion=3, kind, payload, traceId, redacted boolean)
 *    for each event kind accepted by appendEvent.
 * 2. Secret in payload.body → redacted; redacted=true; structural scalars untouched.
 * 3. Secret in meta.api_key → redacted; redacted=true (regression: meta was being skipped).
 * 4. Number in tokens.in → passes through unchanged (not a string, never redacted).
 * 5. id/traceId/spanId auto-generated when caller omits them.
 * 6. id/traceId/spanId preserved when caller injects them (deterministic test injection).
 * 7. timestamp auto-generated (ISO 8601) when caller omits it.
 * 8. timestamp preserved when caller injects it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { appendEvent } from "../../src/store/index.js";
import type { ProjectPaths } from "../../src/core/paths.js";
import type { EventInput } from "../../src/types/event.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTmpPaths(): { paths: ProjectPaths; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-append-evt-"));
  const logbookDir = path.join(dir, ".logbook");
  const evidenceDir = path.join(dir, "logbook", "evidence");
  fs.mkdirSync(logbookDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  const paths: ProjectPaths = {
    root: dir,
    logbookDir,
    manifestPath: path.join(logbookDir, "install-manifest.json"),
    configPath: path.join(logbookDir, "config.json"),
    providersPath: path.join(logbookDir, "providers.json"),
    statePath: path.join(logbookDir, "state.json"),
    indexDbPath: path.join(logbookDir, "index.sqlite"),
    backupsDir: path.join(logbookDir, "backups"),
    dataDir: path.join(dir, "logbook"),
    evidenceDir,
    eventsJsonl: path.join(evidenceDir, "events.jsonl"),
  };

  return { paths, dir };
}

function readLastLine(eventsJsonl: string): Record<string, unknown> {
  const content = fs.readFileSync(eventsJsonl, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const last = lines[lines.length - 1];
  if (!last) throw new Error("events.jsonl is empty");
  return JSON.parse(last) as Record<string, unknown>;
}

// A fake AWS access key for redaction tests — long enough to trigger rules.
const FAKE_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const REDACTED_MARKER = "[REDACTED:";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let dir: string;
let paths: ProjectPaths;

beforeEach(() => {
  ({ paths, dir } = makeTmpPaths());
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Shape-A output contract
// ---------------------------------------------------------------------------

describe("appendEvent — Shape-A output", () => {
  it("writes schemaVersion=3, kind, payload, traceId, redacted for user_entry kind", async () => {
    const input: EventInput = {
      kind: "user_entry",
      sessionId: "sess-001",
      payload: { entryType: "lesson", title: "Shape A test", body: "plain content" },
    };

    const { event, redacted } = await appendEvent(paths, input);

    expect(event.schemaVersion).toBe(3);
    expect(event.kind).toBe("user_entry");
    expect(event.sessionId).toBe("sess-001");
    expect(typeof event.payload).toBe("object");
    expect(typeof event.traceId).toBe("string");
    expect(typeof event.redacted).toBe("boolean");
    expect(redacted).toBe(false);

    const stored = readLastLine(paths.eventsJsonl);
    expect(stored["schemaVersion"]).toBe(3);
    expect(stored["kind"]).toBe("user_entry");
    expect(stored["redacted"]).toBe(false);
  });

  it("writes schemaVersion=3, kind=system for system events", async () => {
    const input: EventInput = {
      kind: "system",
      sessionId: "sess-002",
      payload: { entryType: "session_start" },
    };

    await appendEvent(paths, input);

    const stored = readLastLine(paths.eventsJsonl);
    expect(stored["schemaVersion"]).toBe(3);
    expect(stored["kind"]).toBe("system");
  });

  it("writes kind=hook_event for hook events", async () => {
    const input: EventInput = {
      kind: "hook_event",
      sessionId: "sess-003",
      payload: { raw: { hook_event_name: "PostToolUse" } },
    };

    await appendEvent(paths, input);

    const stored = readLastLine(paths.eventsJsonl);
    expect(stored["kind"]).toBe("hook_event");
    expect(stored["schemaVersion"]).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 2. Redaction — payload.body secret
// ---------------------------------------------------------------------------

describe("appendEvent — payload redaction", () => {
  it("redacts secret in payload.body; sets redacted=true; stores marker not raw token", async () => {
    const input: EventInput = {
      kind: "user_entry",
      sessionId: "sess-010",
      payload: { entryType: "lesson", body: `leaked=${FAKE_AWS_KEY} end` },
    };

    const { event, redacted } = await appendEvent(paths, input);

    expect(redacted).toBe(true);
    expect(event.redacted).toBe(true);

    const storedBody = (event.payload as Record<string, unknown>)["body"] as string;
    expect(storedBody).not.toContain(FAKE_AWS_KEY);
    expect(storedBody).toContain(REDACTED_MARKER);

    const stored = readLastLine(paths.eventsJsonl);
    const storedPayload = stored["payload"] as Record<string, unknown>;
    expect((storedPayload["body"] as string)).not.toContain(FAKE_AWS_KEY);
    expect((storedPayload["body"] as string)).toContain(REDACTED_MARKER);
  });

  it("does not redact when payload contains no secrets; redacted=false", async () => {
    const input: EventInput = {
      kind: "user_entry",
      sessionId: "sess-011",
      payload: { entryType: "lesson", body: "just a plain lesson body" },
    };

    const { event, redacted } = await appendEvent(paths, input);

    expect(redacted).toBe(false);
    expect(event.redacted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Redaction — meta.api_key secret (regression: meta was skipped)
// ---------------------------------------------------------------------------

describe("appendEvent — meta redaction (regression)", () => {
  it("redacts secret in meta.api_key; sets redacted=true", async () => {
    const input: EventInput = {
      kind: "hook_event",
      sessionId: "sess-020",
      payload: { raw: { hook_event_name: "PostToolUse" } },
      meta: { api_key: FAKE_AWS_KEY, safe_field: "hello" },
    };

    const { event, redacted } = await appendEvent(paths, input);

    expect(redacted).toBe(true);
    expect(event.redacted).toBe(true);
    expect((event.meta!["api_key"] as string)).not.toContain(FAKE_AWS_KEY);
    expect((event.meta!["api_key"] as string)).toContain(REDACTED_MARKER);
    // safe_field is untouched
    expect(event.meta!["safe_field"]).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// 4. Numbers in tokens are not redacted
// ---------------------------------------------------------------------------

describe("appendEvent — tokens pass through unchanged", () => {
  it("does not alter numeric token counts", async () => {
    const input: EventInput = {
      kind: "assistant_response",
      sessionId: "sess-030",
      payload: { text: "response text" },
      tokens: { in: 42, out: 100, total: 142 },
    };

    const { event } = await appendEvent(paths, input);

    expect(event.tokens?.in).toBe(42);
    expect(event.tokens?.out).toBe(100);
    expect(event.tokens?.total).toBe(142);
  });
});

// ---------------------------------------------------------------------------
// 5. Structural scalars are not touched by redaction
// ---------------------------------------------------------------------------

describe("appendEvent — structural scalar whitelist", () => {
  it("does not alter id, traceId, spanId, timestamp, sessionId, kind, schemaVersion", async () => {
    const injectedId = "01INJECTEDID00000000000000";
    const injectedTraceId = "sess-scalar-test";
    const injectedSpanId = "01INJECTEDSPAN0000000000000";
    const injectedTs = "2026-01-01T00:00:00.000Z";

    const input: EventInput = {
      kind: "user_entry",
      sessionId: injectedTraceId,
      payload: { body: `token=${FAKE_AWS_KEY}` },
      id: injectedId,
      traceId: injectedTraceId,
      spanId: injectedSpanId,
      timestamp: injectedTs,
    };

    const { event } = await appendEvent(paths, input);

    // Structural scalars survive redaction intact
    expect(event.id).toBe(injectedId);
    expect(event.traceId).toBe(injectedTraceId);
    expect(event.spanId).toBe(injectedSpanId);
    expect(event.timestamp).toBe(injectedTs);
    expect(event.sessionId).toBe(injectedTraceId);
    expect(event.kind).toBe("user_entry");
    expect(event.schemaVersion).toBe(3);

    // But the secret in payload IS redacted
    expect(event.redacted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. id / traceId / spanId auto-generated when caller omits them
// ---------------------------------------------------------------------------

describe("appendEvent — auto-generated structural fields", () => {
  it("generates non-empty id, traceId, spanId when caller omits them", async () => {
    const input: EventInput = {
      kind: "user_entry",
      sessionId: "sess-autogen",
      payload: { body: "no ids provided" },
    };

    const { event } = await appendEvent(paths, input);

    expect(typeof event.id).toBe("string");
    expect(event.id.length).toBeGreaterThan(0);
    expect(typeof event.traceId).toBe("string");
    expect(event.traceId.length).toBeGreaterThan(0);
    expect(typeof event.spanId).toBe("string");
    expect(event.spanId.length).toBeGreaterThan(0);
    // traceId defaults to sessionId
    expect(event.traceId).toBe("sess-autogen");
  });

  it("generates a valid ISO timestamp when caller omits it", async () => {
    const before = new Date().toISOString();
    const input: EventInput = {
      kind: "user_entry",
      sessionId: "sess-ts",
      payload: {},
    };
    const { event } = await appendEvent(paths, input);
    const after = new Date().toISOString();

    expect(event.timestamp >= before).toBe(true);
    expect(event.timestamp <= after).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. id / traceId / spanId preserved when caller injects them
// ---------------------------------------------------------------------------

describe("appendEvent — deterministic test injection", () => {
  it("preserves caller-injected id, traceId, spanId, timestamp", async () => {
    const injectedId = "01TESTID0000000000000000000";
    const injectedTraceId = "trace-deterministic";
    const injectedSpanId = "01SPANID000000000000000000";
    const injectedTs = "2026-05-22T12:00:00.000Z";

    const input: EventInput = {
      kind: "system",
      sessionId: "sess-inject",
      payload: { entryType: "session_start" },
      id: injectedId,
      traceId: injectedTraceId,
      spanId: injectedSpanId,
      timestamp: injectedTs,
    };

    const { event } = await appendEvent(paths, input);

    expect(event.id).toBe(injectedId);
    expect(event.traceId).toBe(injectedTraceId);
    expect(event.spanId).toBe(injectedSpanId);
    expect(event.timestamp).toBe(injectedTs);
  });
});

// ---------------------------------------------------------------------------
// 8. Return value matches stored JSONL line
// ---------------------------------------------------------------------------

describe("appendEvent — return value consistency", () => {
  it("returned event matches the line written to disk", async () => {
    const input: EventInput = {
      kind: "user_entry",
      sessionId: "sess-roundtrip",
      payload: { entryType: "decision", title: "Use appendEvent everywhere" },
    };

    const { event } = await appendEvent(paths, input);
    const stored = readLastLine(paths.eventsJsonl);

    expect(stored["id"]).toBe(event.id);
    expect(stored["traceId"]).toBe(event.traceId);
    expect(stored["schemaVersion"]).toBe(event.schemaVersion);
    expect(stored["kind"]).toBe(event.kind);
    expect(stored["redacted"]).toBe(event.redacted);
  });
});
