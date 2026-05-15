import { describe, it, expect } from "vitest";
import { normalizeClaudeEvent } from "../../src/normalize/event.js";
import type { RawClaudeHookPayload, NormalizeContext } from "../../src/normalize/event.js";

function makeCtx(overrides: Partial<NormalizeContext> = {}): NormalizeContext {
  let counter = 0;
  return {
    sessionId: "test-session-01",
    now: () => "2026-05-15T20:00:00.000Z",
    ulid: () => `01TESTULID${String(counter++).padStart(16, "0")}`,
    ...overrides,
  };
}

describe("normalizeClaudeEvent — kind mapping", () => {
  it("maps hook_event_name PreToolUse → kind tool_use", () => {
    const raw: RawClaudeHookPayload = { hook_event_name: "PreToolUse" };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.kind).toBe("tool_use");
  });

  it("maps hook_event_name PostToolUse → kind tool_result", () => {
    const raw: RawClaudeHookPayload = { hook_event_name: "PostToolUse" };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.kind).toBe("tool_result");
  });

  it("maps hook_event_name Stop → kind system", () => {
    const raw: RawClaudeHookPayload = { hook_event_name: "Stop" };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.kind).toBe("system");
  });

  it("maps hook_event_name SubagentStop → kind system", () => {
    const raw: RawClaudeHookPayload = { hook_event_name: "SubagentStop" };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.kind).toBe("system");
  });

  it("maps hook_event_name SessionStart → kind system", () => {
    const raw: RawClaudeHookPayload = { hook_event_name: "SessionStart" };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.kind).toBe("system");
  });

  it("maps unknown hook_event_name → kind hook_event", () => {
    const raw: RawClaudeHookPayload = { hook_event_name: "Unknown" };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.kind).toBe("hook_event");
  });

  it("maps undefined hook_event_name → kind hook_event", () => {
    const raw: RawClaudeHookPayload = {};
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.kind).toBe("hook_event");
  });
});

describe("normalizeClaudeEvent — session and trace fields", () => {
  it("sets sessionId from ctx.sessionId", () => {
    const raw: RawClaudeHookPayload = {};
    const event = normalizeClaudeEvent(raw, makeCtx({ sessionId: "my-session-id" }));
    expect(event.sessionId).toBe("my-session-id");
  });

  it("sets traceId equal to sessionId (iter1: trace == session)", () => {
    const raw: RawClaudeHookPayload = {};
    const event = normalizeClaudeEvent(raw, makeCtx({ sessionId: "trace-sess" }));
    expect(event.traceId).toBe("trace-sess");
    expect(event.sessionId).toBe("trace-sess");
  });

  it("sets spanId from ctx.ulid()", () => {
    const raw: RawClaudeHookPayload = {};
    const event = normalizeClaudeEvent(raw, makeCtx({ ulid: () => "SPAN-ULID-FIXED" }));
    // id and spanId both use ulid; id is first call, spanId second
    expect(event.spanId).toBe("SPAN-ULID-FIXED");
  });
});

describe("normalizeClaudeEvent — payload mapping", () => {
  it("sets payload.tool_name from raw.tool_name", () => {
    const raw: RawClaudeHookPayload = { hook_event_name: "PreToolUse", tool_name: "Read" };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.payload.tool_name).toBe("Read");
  });

  it("sets payload.tool_args from raw.tool_args", () => {
    const raw: RawClaudeHookPayload = { tool_args: { file_path: "/x.ts" } };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.payload.tool_args).toEqual({ file_path: "/x.ts" });
  });

  it("sets payload.tool_response from raw.tool_response", () => {
    const raw: RawClaudeHookPayload = { tool_response: "some output" };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.payload.tool_response).toBe("some output");
  });

  it("sets payload.text from tool_response when it is a plain string", () => {
    const raw: RawClaudeHookPayload = { tool_response: "text output" };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.payload.text).toBe("text output");
  });

  it("does NOT set payload.text when tool_response is an object", () => {
    const raw: RawClaudeHookPayload = { tool_response: { success: true } };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.payload.text).toBeUndefined();
  });

  it("sets payload.raw to the full original payload", () => {
    const raw: RawClaudeHookPayload = { hook_event_name: "PreToolUse", tool_name: "Read" };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.payload.raw).toEqual(raw);
  });
});

describe("normalizeClaudeEvent — meta field", () => {
  it("sets meta.hook to the original hook_event_name", () => {
    const raw: RawClaudeHookPayload = { hook_event_name: "PreToolUse" };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.meta?.["hook"]).toBe("PreToolUse");
  });

  it("includes unknown top-level fields in meta", () => {
    const raw: RawClaudeHookPayload = {
      hook_event_name: "PostToolUse",
      custom_field: "extra-value",
    };
    const event = normalizeClaudeEvent(raw, makeCtx());
    expect(event.meta?.["custom_field"]).toBe("extra-value");
  });
});

describe("normalizeClaudeEvent — fixed fields", () => {
  it("sets provider to claude-code", () => {
    const event = normalizeClaudeEvent({}, makeCtx());
    expect(event.provider).toBe("claude-code");
  });

  it("sets model to undefined (not provided by hooks)", () => {
    const event = normalizeClaudeEvent({}, makeCtx());
    expect(event.model).toBeUndefined();
  });

  it("sets redacted to false initially", () => {
    const event = normalizeClaudeEvent({}, makeCtx());
    expect(event.redacted).toBe(false);
  });

  it("sets schemaVersion to 3", () => {
    const event = normalizeClaudeEvent({}, makeCtx());
    expect(event.schemaVersion).toBe(3);
  });

  it("sets timestamp from ctx.now()", () => {
    const event = normalizeClaudeEvent({}, makeCtx({ now: () => "2026-01-01T00:00:00.000Z" }));
    expect(event.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });
});
