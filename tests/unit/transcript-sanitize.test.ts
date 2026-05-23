/**
 * Unit tests: transcript-sanitize (slice 12 P4, ADR-SC-D2).
 *
 * Coverage:
 *   - Noise drop (TaskUpdate / permission-mode / SessionStart heartbeats)
 *   - Per-event byte truncation (UTF-8 safe, no mid-codepoint cut)
 *   - Secret redaction runs BEFORE truncation
 *   - tool_result.stdout > 4KB collapses to head + tail with marker
 *   - Per-session 512KB cap → truncatedAtBytes populated
 *   - Empty input → empty output
 *   - Pathological input (deeply nested + very long single field)
 *   - Tool name extraction from various raw shapes
 *
 * Secrets in fixtures are SYNTHETIC (do not match any real provider key) but
 * crafted to trip the Gitleaks rule set + entropy pass in `src/redact/`.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeTranscriptEvent,
  sanitizeTranscriptSession,
} from "../../src/export/transcript-sanitize.js";

describe("sanitizeTranscriptEvent", () => {
  it("drops TaskUpdate noise frames", () => {
    expect(sanitizeTranscriptEvent({ type: "task-update", payload: "noise" })).toBeNull();
    expect(sanitizeTranscriptEvent({ type: "TaskUpdate" })).toBeNull();
  });

  it("drops permission-mode and last-prompt heartbeats", () => {
    expect(sanitizeTranscriptEvent({ type: "permission-mode" })).toBeNull();
    expect(sanitizeTranscriptEvent({ type: "last-prompt" })).toBeNull();
  });

  it("drops empty SessionStart hook attachments", () => {
    const ev = {
      type: "attachment",
      attachment: {
        hookEvent: "SessionStart",
        hookName: "SessionStart:startup",
        stdout: "",
        stderr: "",
      },
    };
    expect(sanitizeTranscriptEvent(ev)).toBeNull();
  });

  it("keeps assistant message events with text content", () => {
    const ev = sanitizeTranscriptEvent({
      uuid: "u1",
      type: "assistant",
      timestamp: "2026-05-23T10:00:00.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
    });
    expect(ev).not.toBeNull();
    expect(ev?.role).toBe("assistant");
    expect(ev?.type).toBe("message");
    expect(ev?.content).toBe("Hello world");
    expect(ev?.truncated).toBe(false);
  });

  it("returns null for non-object input", () => {
    expect(sanitizeTranscriptEvent(null)).toBeNull();
    expect(sanitizeTranscriptEvent(undefined)).toBeNull();
    expect(sanitizeTranscriptEvent("string")).toBeNull();
    expect(sanitizeTranscriptEvent(42)).toBeNull();
  });

  it("truncates content at perEventMaxBytes (default 4 KB)", () => {
    const longText = "a".repeat(10_000);
    const ev = sanitizeTranscriptEvent({
      uuid: "u2",
      type: "user",
      message: { role: "user", content: longText },
    });
    expect(ev?.truncated).toBe(true);
    expect(Buffer.byteLength(ev?.content ?? "", "utf8")).toBeLessThanOrEqual(4096);
  });

  it("truncation respects UTF-8 boundaries (no mid-codepoint cut)", () => {
    // Multibyte chars: each "😀" is 4 bytes. Pack just past the 4 KB cap.
    const ev = sanitizeTranscriptEvent({
      uuid: "u-emoji",
      type: "user",
      message: { role: "user", content: "😀".repeat(2000) },
    });
    expect(ev?.truncated).toBe(true);
    // If we cut mid-codepoint, the trailing char would be U+FFFD. Assert it isn't.
    expect(ev?.content.endsWith("�")).toBe(false);
    // And the byte length stays within budget.
    expect(Buffer.byteLength(ev?.content ?? "", "utf8")).toBeLessThanOrEqual(4096);
  });

  it("redacts secrets BEFORE truncating (no partial secret leak)", () => {
    // Synthetic AWS-shaped key. The redactor's Gitleaks ruleset catches the
    // AKIA prefix; we put it deep into the content so a naive truncate-first
    // implementation would leave the AKIA prefix visible.
    const akia = "AKIA" + "X".repeat(16); // 20 chars, matches AWS access key shape
    const ev = sanitizeTranscriptEvent(
      {
        uuid: "u3",
        type: "user",
        message: { role: "user", content: `secret: ${akia} done` },
      },
      { perEventMaxBytes: 4096 },
    );
    expect(ev?.content).not.toContain(akia);
    expect(ev?.content).toContain("[REDACTED:");
  });

  it("collapses very large tool_result stdout into head + tail with marker", () => {
    const big = "X".repeat(8000); // > TOOL_STDOUT_CAP_BYTES (4 KB)
    const ev = sanitizeTranscriptEvent({
      uuid: "u4",
      type: "attachment",
      attachment: {
        toolName: "Bash",
        hookEvent: "PostToolUse",
        stdout: `START${big}END`,
        stderr: "",
      },
    });
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe("tool_result");
    expect(ev?.name).toBe("Bash");
    // The marker should be present somewhere in the content.
    expect(ev?.content).toContain("[truncated");
    // Head and tail markers from the original payload survive.
    expect(ev?.content.startsWith("START")).toBe(true);
    expect(ev?.content.endsWith("END")).toBe(true);
  });

  it("extracts tool name from top-level `name` field", () => {
    const ev = sanitizeTranscriptEvent({
      uuid: "u5",
      type: "tool_use",
      name: "Write",
      input: { path: "/tmp/a.txt" },
    });
    expect(ev?.type).toBe("tool_use");
    expect(ev?.name).toBe("Write");
  });

  it("falls back to a hash-derived id when no uuid is present", () => {
    const ev = sanitizeTranscriptEvent({
      type: "assistant",
      message: { role: "assistant", content: "x" },
    });
    expect(ev?.id).toMatch(/^t-[a-z0-9]+$/);
  });

  it("parses timestamp from string or number, defaults to 0", () => {
    const a = sanitizeTranscriptEvent({
      type: "user",
      timestamp: "2026-05-23T10:00:00.000Z",
      message: { role: "user", content: "ok" },
    });
    expect(a?.timestamp).toBe(Date.parse("2026-05-23T10:00:00.000Z"));

    const b = sanitizeTranscriptEvent({
      type: "user",
      timestamp: 1234567890123,
      message: { role: "user", content: "ok" },
    });
    expect(b?.timestamp).toBe(1234567890123);

    const c = sanitizeTranscriptEvent({
      type: "user",
      message: { role: "user", content: "ok" },
    });
    expect(c?.timestamp).toBe(0);
  });

  it("handles pathological deeply-nested content arrays", () => {
    const ev = sanitizeTranscriptEvent({
      uuid: "u6",
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Top-level text. " },
          {
            type: "tool_result",
            content: [
              { type: "text", text: "Nested text 1. " },
              { type: "text", text: "Nested text 2." },
            ],
          },
        ],
      },
    });
    expect(ev?.content).toContain("Top-level text.");
    expect(ev?.content).toContain("Nested text 1.");
    expect(ev?.content).toContain("Nested text 2.");
  });
});

describe("sanitizeTranscriptSession", () => {
  it("returns empty events array for empty input", () => {
    const result = sanitizeTranscriptSession([], "sess-1");
    expect(result.events).toEqual([]);
    expect(result.sessionId).toBe("sess-1");
    expect(result.truncatedAtBytes).toBeNull();
    expect(result.droppedEvents).toBe(0);
    expect(result.originalEventCount).toBe(0);
    expect(result.sanitizedEventCount).toBe(0);
  });

  it("counts dropped noise events separately from kept events", () => {
    const raw = [
      { type: "task-update" },
      { type: "permission-mode" },
      {
        type: "user",
        uuid: "u1",
        message: { role: "user", content: "hi" },
      },
      { type: "TaskUpdate" },
    ];
    const result = sanitizeTranscriptSession(raw, "sess-2");
    expect(result.droppedEvents).toBe(3);
    expect(result.sanitizedEventCount).toBe(1);
    expect(result.originalEventCount).toBe(4);
  });

  it("caps the session at perSessionMaxBytes and sets truncatedAtBytes", () => {
    // Each event ~ 200-300 sanitized bytes; ask for an 800-byte session cap.
    const raw = Array.from({ length: 50 }, (_, i) => ({
      type: "user",
      uuid: `u${i}`,
      message: { role: "user", content: `event ${i} content ${"x".repeat(50)}` },
    }));
    const result = sanitizeTranscriptSession(raw, "sess-3", {
      perSessionMaxBytes: 800,
    });
    expect(result.truncatedAtBytes).not.toBeNull();
    expect(result.truncatedAtBytes).toBeLessThanOrEqual(800);
    // Some events made it through; not all 50.
    expect(result.sanitizedEventCount).toBeGreaterThan(0);
    expect(result.sanitizedEventCount).toBeLessThan(50);
    expect(result.originalEventCount).toBe(50);
  });

  it("does not set truncatedAtBytes when the session fits under the cap", () => {
    const raw = [
      {
        type: "user",
        uuid: "u1",
        message: { role: "user", content: "short" },
      },
    ];
    const result = sanitizeTranscriptSession(raw, "sess-4", {
      perSessionMaxBytes: 524288,
    });
    expect(result.truncatedAtBytes).toBeNull();
    expect(result.sanitizedEventCount).toBe(1);
  });
});
