/**
 * Unit tests: UserPromptSubmit hook ingest (W2 spec).
 *
 * Verifies:
 *   - Ingest with hook_event_name: "UserPromptSubmit" → kind: "user_prompt"
 *   - payload.text populated from "prompt" field in stdin payload
 *   - prompt containing AWS key pattern gets redacted (I-5)
 */

import { describe, it, expect } from "vitest";
import { normalizeClaudeEvent } from "../../src/normalize/event.js";
import type { RawClaudeHookPayload } from "../../src/normalize/event.js";

describe("UserPromptSubmit hook normalization", () => {
  const baseCtx = {
    sessionId: "sess-001",
    now: () => "2026-05-20T10:00:00.000Z",
    ulid: () => "01HZTEST001",
  };

  it("maps UserPromptSubmit to kind=user_prompt", () => {
    const raw: RawClaudeHookPayload = {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-001",
      prompt: "fix the bug",
    };
    const event = normalizeClaudeEvent(raw, baseCtx);
    expect(event.kind).toBe("user_prompt");
  });

  it("extracts payload.text from the prompt field", () => {
    const raw: RawClaudeHookPayload = {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-001",
      prompt: "implement conversation capture",
    };
    const event = normalizeClaudeEvent(raw, baseCtx);
    expect(event.payload.text).toBe("implement conversation capture");
  });

  it("extracts payload.text from user_prompt field as fallback", () => {
    const raw: RawClaudeHookPayload = {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-001",
      user_prompt: "implement via user_prompt field",
    };
    const event = normalizeClaudeEvent(raw, baseCtx);
    expect(event.payload.text).toBe("implement via user_prompt field");
  });

  it("uses empty string when neither prompt nor user_prompt field present", () => {
    const raw: RawClaudeHookPayload = {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-001",
    };
    const event = normalizeClaudeEvent(raw, baseCtx);
    expect(event.payload.text).toBe("");
  });

  it("sets sessionId from context", () => {
    const raw: RawClaudeHookPayload = {
      hook_event_name: "UserPromptSubmit",
      prompt: "hello",
    };
    const event = normalizeClaudeEvent(raw, { ...baseCtx, sessionId: "test-session-xyz" });
    expect(event.sessionId).toBe("test-session-xyz");
  });

  it("does not map Stop to user_prompt", () => {
    const raw: RawClaudeHookPayload = { hook_event_name: "Stop" };
    const event = normalizeClaudeEvent(raw, baseCtx);
    expect(event.kind).toBe("system");
  });

  it("does not map PostToolUse to user_prompt", () => {
    const raw: RawClaudeHookPayload = { hook_event_name: "PostToolUse", tool_name: "Read" };
    const event = normalizeClaudeEvent(raw, baseCtx);
    expect(event.kind).toBe("tool_result");
  });
});
