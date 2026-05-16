/**
 * Unit tests for Codex normalizer: normalizeCodexEvent.
 *
 * Codex payload is forward-compatible — unknown fields pass through to meta.
 * The normalizer must never throw, even on null/undefined/empty input.
 *
 * Tests run against the pure function — no I/O, no side effects.
 */

import { describe, it, expect } from "vitest";
import { normalizeCodexEvent } from "../../src/connectors/codex/normalize.js";
import type { Event } from "../../src/types/event.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<{ sessionId: string; now: () => string; ulid: () => string }>) {
  return {
    sessionId: "test-session-01",
    now: () => "2026-01-01T00:00:00.000Z",
    ulid: () => "01JTEST000000000000000",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Known field mapping
// ---------------------------------------------------------------------------

describe("normalizeCodexEvent — known fields", () => {
  it("sets provider to codex", () => {
    const event = normalizeCodexEvent({ event_type: "tool_call", tool: "Read" }, makeCtx());
    expect(event.provider).toBe("codex");
  });

  it("maps event_type=tool_call to kind=tool_use", () => {
    const event = normalizeCodexEvent({ event_type: "tool_call", tool: "Read" }, makeCtx());
    expect(event.kind).toBe("tool_use");
  });

  it("maps event_type=tool_result to kind=tool_result", () => {
    const event = normalizeCodexEvent({ event_type: "tool_result" }, makeCtx());
    expect(event.kind).toBe("tool_result");
  });

  it("maps event_type=user_message to kind=user_input", () => {
    const event = normalizeCodexEvent({ event_type: "user_message" }, makeCtx());
    expect(event.kind).toBe("user_input");
  });

  it("maps event_type=assistant_message to kind=assistant_response", () => {
    const event = normalizeCodexEvent({ event_type: "assistant_message" }, makeCtx());
    expect(event.kind).toBe("assistant_response");
  });

  it("maps event_type=error to kind=error", () => {
    const event = normalizeCodexEvent({ event_type: "error" }, makeCtx());
    expect(event.kind).toBe("error");
  });

  it("maps event_type=system to kind=system", () => {
    const event = normalizeCodexEvent({ event_type: "system" }, makeCtx());
    expect(event.kind).toBe("system");
  });

  it("maps unknown event_type to kind=hook_event", () => {
    const event = normalizeCodexEvent({ event_type: "some_future_event_type" }, makeCtx());
    expect(event.kind).toBe("hook_event");
  });

  it("uses hook_event when event_type is missing", () => {
    const event = normalizeCodexEvent({ tool: "Write" }, makeCtx());
    expect(event.kind).toBe("hook_event");
  });

  it("extracts model from payload.model when present", () => {
    const event = normalizeCodexEvent({ event_type: "tool_call", model: "codex-v1" }, makeCtx());
    expect(event.model).toBe("codex-v1");
  });

  it("leaves model undefined when not present", () => {
    const event = normalizeCodexEvent({ event_type: "tool_call" }, makeCtx());
    expect(event.model).toBeUndefined();
  });

  it("extracts payload.text from payload.message when string", () => {
    const event = normalizeCodexEvent({ event_type: "user_message", message: "hello" }, makeCtx());
    expect(event.payload.text).toBe("hello");
  });

  it("extracts payload.text from payload.content when string and message absent", () => {
    const event = normalizeCodexEvent({ event_type: "assistant_message", content: "reply" }, makeCtx());
    expect(event.payload.text).toBe("reply");
  });

  it("prefers message over content for payload.text", () => {
    const event = normalizeCodexEvent({ message: "msg", content: "cnt" }, makeCtx());
    expect(event.payload.text).toBe("msg");
  });

  it("maps tool field to payload.tool_name", () => {
    const event = normalizeCodexEvent({ event_type: "tool_call", tool: "Read" }, makeCtx());
    expect(event.payload.tool_name).toBe("Read");
  });

  it("maps tool_args field to payload.tool_args", () => {
    const args = { path: "/foo/bar.ts" };
    const event = normalizeCodexEvent({ event_type: "tool_call", tool: "Read", tool_args: args }, makeCtx());
    expect(event.payload.tool_args).toEqual(args);
  });

  it("maps tool_response field to payload.tool_response", () => {
    const response = { content: "file contents" };
    const event = normalizeCodexEvent({ event_type: "tool_result", tool_response: response }, makeCtx());
    expect(event.payload.tool_response).toEqual(response);
  });
});

// ---------------------------------------------------------------------------
// Unknown fields → meta pass-through
// ---------------------------------------------------------------------------

describe("normalizeCodexEvent — unknown fields into meta", () => {
  it("forwards unknown top-level field to meta", () => {
    const event = normalizeCodexEvent({ event_type: "tool_call", custom_field: "value" }, makeCtx());
    expect(event.meta?.["custom_field"]).toBe("value");
  });

  it("forwards multiple unknown fields", () => {
    const raw = { event_type: "system", alpha: 1, beta: "two", gamma: true };
    const event = normalizeCodexEvent(raw, makeCtx());
    expect(event.meta?.["alpha"]).toBe(1);
    expect(event.meta?.["beta"]).toBe("two");
    expect(event.meta?.["gamma"]).toBe(true);
  });

  it("does not put known fields into meta", () => {
    const event = normalizeCodexEvent({ event_type: "tool_call", model: "m", tool: "T" }, makeCtx());
    expect("event_type" in (event.meta ?? {})).toBe(false);
    expect("model" in (event.meta ?? {})).toBe(false);
    expect("tool" in (event.meta ?? {})).toBe(false);
  });

  it("meta contains codex.event_type key for tracing", () => {
    // event_type is stored in meta under a namespaced key for forward compatibility
    const event = normalizeCodexEvent({ event_type: "tool_call" }, makeCtx());
    expect(event.meta?.["codex.event_type"]).toBe("tool_call");
  });
});

// ---------------------------------------------------------------------------
// Defensive: malformed / degenerate input — must never throw
// ---------------------------------------------------------------------------

describe("normalizeCodexEvent — defensive / malformed input", () => {
  it("handles null input without throwing", () => {
    expect(() => normalizeCodexEvent(null, makeCtx())).not.toThrow();
  });

  it("handles undefined input without throwing", () => {
    expect(() => normalizeCodexEvent(undefined, makeCtx())).not.toThrow();
  });

  it("handles empty object without throwing", () => {
    expect(() => normalizeCodexEvent({}, makeCtx())).not.toThrow();
  });

  it("handles a string input without throwing", () => {
    expect(() => normalizeCodexEvent("not an object", makeCtx())).not.toThrow();
  });

  it("handles a number input without throwing", () => {
    expect(() => normalizeCodexEvent(42, makeCtx())).not.toThrow();
  });

  it("handles array input without throwing", () => {
    expect(() => normalizeCodexEvent([], makeCtx())).not.toThrow();
  });

  it("null input produces kind=error", () => {
    const event = normalizeCodexEvent(null, makeCtx());
    expect(event.kind).toBe("error");
  });

  it("null input produces provider=codex", () => {
    const event = normalizeCodexEvent(null, makeCtx());
    expect(event.provider).toBe("codex");
  });

  it("null input produces a meta.codex.parse_error note", () => {
    const event = normalizeCodexEvent(null, makeCtx());
    expect(event.meta?.["codex.parse_error"]).toBe(true);
  });

  it("non-object input produces a valid Event shape (schemaVersion=3)", () => {
    const event = normalizeCodexEvent("garbage", makeCtx());
    expect(event.schemaVersion).toBe(3);
    expect(typeof event.id).toBe("string");
    expect(typeof event.timestamp).toBe("string");
  });

  it("event.redacted is false by default (redaction runs in CLI wrapper)", () => {
    const event = normalizeCodexEvent({ event_type: "tool_call", tool: "Read" }, makeCtx());
    expect(event.redacted).toBe(false);
  });

  it("uses ctx.sessionId for sessionId and traceId", () => {
    const ctx = makeCtx({ sessionId: "custom-session" });
    const event = normalizeCodexEvent({}, ctx);
    expect(event.sessionId).toBe("custom-session");
    expect(event.traceId).toBe("custom-session");
  });

  it("uses ctx.now() for timestamp", () => {
    const ctx = makeCtx({ now: () => "2030-06-15T12:00:00.000Z" });
    const event = normalizeCodexEvent({}, ctx);
    expect(event.timestamp).toBe("2030-06-15T12:00:00.000Z");
  });

  it("uses ctx.ulid() for event id", () => {
    const ctx = makeCtx({ ulid: () => "ULID-FIXED-ID-001" });
    const event = normalizeCodexEvent({}, ctx);
    expect(event.id).toBe("ULID-FIXED-ID-001");
  });
});
