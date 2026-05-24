/**
 * Unit tests: transcriptLineToEvents (W3 spec — scraper line mapping).
 *
 * Verifies correct EventInput[] mapping from a fixture of 10 real-observed
 * line types. Asserts:
 *   - isSidechain lines filtered
 *   - isMeta lines filtered
 *   - last-prompt, permission-mode, file-history-snapshot, attachment lines filtered
 *   - user lines skipped (ADR-2)
 *   - assistant text blocks → claude_message
 *   - assistant thinking blocks → claude_message with isThinking: true
 *   - assistant tool_use blocks skipped
 */

import { describe, it, expect } from "vitest";
import { transcriptLineToEvents } from "../../src/connectors/claude-code/transcript.js";
import type { ClaudeTranscriptLine } from "../../src/connectors/claude-code/transcript.js";

const SESSION_ID = "sess-test-001";

describe("transcriptLineToEvents", () => {
  it("skips isMeta lines", () => {
    const line: ClaudeTranscriptLine = {
      type: "user",
      isMeta: true,
      uuid: "uuid-1",
      message: { role: "user", content: "some prompt" },
    };
    expect(transcriptLineToEvents(line, SESSION_ID)).toHaveLength(0);
  });

  it("skips isSidechain lines", () => {
    const line: ClaudeTranscriptLine = {
      type: "assistant",
      isSidechain: true,
      uuid: "uuid-2",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "sub-agent output" }],
      },
    };
    expect(transcriptLineToEvents(line, SESSION_ID)).toHaveLength(0);
  });

  it("skips last-prompt lines", () => {
    const line: ClaudeTranscriptLine = { type: "last-prompt", uuid: "uuid-3" };
    expect(transcriptLineToEvents(line, SESSION_ID)).toHaveLength(0);
  });

  it("skips permission-mode lines", () => {
    const line: ClaudeTranscriptLine = { type: "permission-mode", uuid: "uuid-4" };
    expect(transcriptLineToEvents(line, SESSION_ID)).toHaveLength(0);
  });

  it("skips file-history-snapshot lines", () => {
    const line: ClaudeTranscriptLine = { type: "file-history-snapshot", uuid: "uuid-5" };
    expect(transcriptLineToEvents(line, SESSION_ID)).toHaveLength(0);
  });

  it("skips attachment lines", () => {
    const line: ClaudeTranscriptLine = {
      type: "attachment",
      attachment: { hookEvent: "PostToolUse" },
    };
    expect(transcriptLineToEvents(line, SESSION_ID)).toHaveLength(0);
  });

  it("emits user_prompt for real user lines when not deduped (slice-23 backfill)", () => {
    const line: ClaudeTranscriptLine = {
      type: "user",
      uuid: "uuid-6",
      timestamp: "2026-05-20T10:00:00.000Z",
      message: { role: "user", content: "fix the bug" },
    };
    const events = transcriptLineToEvents(line, SESSION_ID);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("user_prompt");
    expect((events[0]!.payload as Record<string, unknown>)["text"]).toBe("fix the bug");
    expect(
      (events[0]!.payload as Record<string, unknown>)["backfilledFromTranscript"],
    ).toBe(true);
  });

  it("skips user lines when the dedup set already contains the text hash (slice-23)", async () => {
    const { userPromptHash } = await import(
      "../../src/connectors/claude-code/transcript.js"
    );
    const line: ClaudeTranscriptLine = {
      type: "user",
      uuid: "uuid-6b",
      message: { role: "user", content: "fix the bug" },
    };
    const existing = new Set<string>([userPromptHash("fix the bug")]);
    expect(transcriptLineToEvents(line, SESSION_ID, existing)).toHaveLength(0);
  });

  it("skips user lines that are slash-command echoes, not real prompts (slice-23)", () => {
    const echoes = [
      "<command-name>/model</command-name>",
      "<command-message>model</command-message>",
      "<local-command-stdout>Set model to Opus</local-command-stdout>",
      "<attachment>some.png</attachment>",
    ];
    for (const content of echoes) {
      const line: ClaudeTranscriptLine = {
        type: "user",
        uuid: "u-echo",
        message: { role: "user", content },
      };
      expect(transcriptLineToEvents(line, SESSION_ID)).toHaveLength(0);
    }
  });

  it("skips user lines with non-string content (tool_result arrays)", () => {
    const line = {
      type: "user",
      uuid: "uuid-tr",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }],
      },
    } as unknown as ClaudeTranscriptLine;
    expect(transcriptLineToEvents(line, SESSION_ID)).toHaveLength(0);
  });

  it("maps assistant text block to claude_message", () => {
    const line: ClaudeTranscriptLine = {
      type: "assistant",
      uuid: "uuid-7",
      requestId: "req-1",
      timestamp: "2026-05-20T10:00:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "I will fix the render-context bug." }],
      },
    };
    const events = transcriptLineToEvents(line, SESSION_ID);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("claude_message");
    expect((events[0]!.payload as Record<string, unknown>)["text"]).toBe(
      "I will fix the render-context bug.",
    );
    expect((events[0]!.payload as Record<string, unknown>)["isThinking"]).toBeUndefined();
  });

  it("maps assistant thinking block to claude_message with isThinking: true", () => {
    const line: ClaudeTranscriptLine = {
      type: "assistant",
      uuid: "uuid-8",
      timestamp: "2026-05-20T10:01:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "I need to check the synthesis block." }],
      },
    };
    const events = transcriptLineToEvents(line, SESSION_ID);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("claude_message");
    expect((events[0]!.payload as Record<string, unknown>)["isThinking"]).toBe(true);
    expect((events[0]!.payload as Record<string, unknown>)["text"]).toBe(
      "I need to check the synthesis block.",
    );
  });

  it("skips tool_use blocks in assistant lines (PostToolUse is authoritative)", () => {
    const line: ClaudeTranscriptLine = {
      type: "assistant",
      uuid: "uuid-9",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "src/foo.ts" } },
        ],
      },
    };
    expect(transcriptLineToEvents(line, SESSION_ID)).toHaveLength(0);
  });

  it("maps multiple content blocks correctly (text + thinking)", () => {
    const line: ClaudeTranscriptLine = {
      type: "assistant",
      uuid: "uuid-10",
      requestId: "req-2",
      timestamp: "2026-05-20T10:02:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me check the types first." },
          { type: "text", text: "I'll read the event types file." },
          { type: "tool_use", name: "Read", input: { file_path: "src/types/event.ts" } },
        ],
      },
    };
    const events = transcriptLineToEvents(line, SESSION_ID);
    // thinking + text → 2 events; tool_use → skipped
    expect(events).toHaveLength(2);
    expect((events[0]!.payload as Record<string, unknown>)["isThinking"]).toBe(true);
    expect(events[1]!.kind).toBe("claude_message");
    expect((events[1]!.payload as Record<string, unknown>)["isThinking"]).toBeUndefined();
  });

  it("sets sessionId correctly on emitted events", () => {
    const line: ClaudeTranscriptLine = {
      type: "assistant",
      uuid: "uuid-11",
      timestamp: "2026-05-20T10:03:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
      },
    };
    const events = transcriptLineToEvents(line, SESSION_ID);
    expect(events[0]!.sessionId).toBe(SESSION_ID);
  });

  it("skips assistant lines with empty string content", () => {
    const line: ClaudeTranscriptLine = {
      type: "assistant",
      uuid: "uuid-12",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "" }],
      },
    };
    expect(transcriptLineToEvents(line, SESSION_ID)).toHaveLength(0);
  });
});
