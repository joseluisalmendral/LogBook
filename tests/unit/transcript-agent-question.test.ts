/**
 * Unit tests: extractAgentQuestionEvents + parseAskAnswerBlock
 * (export-replan P2, spec R-6 to R-10, S-9, S-10, S-11, S-16, AG-5).
 *
 * Asserts:
 *   - Single-question call → 1 event with correct chosen value.
 *   - 4-question call → 4 events with sequential indices.
 *   - "Other" + notes → notes captured + sanitized + size-capped.
 *   - Notes >4 KB → truncated with marker.
 *   - Secret-bearing notes → redacted before persistence.
 *   - Orphan tool_use (no matching tool_result) → emits unanswered event.
 *   - PASSIVE rule: extractor is a pure transform, no side effects.
 */

import { describe, it, expect } from "vitest";
import {
  extractAgentQuestionEvents,
  parseAskAnswerBlock,
} from "../../src/connectors/claude-code/transcript.js";
import type { ClaudeTranscriptLine } from "../../src/connectors/claude-code/transcript.js";

const SESSION_ID = "sess-aq-001";

function askToolUseLine(
  toolUseId: string,
  questions: Array<{
    question: string;
    header?: string;
    multiSelect?: boolean;
    options?: Array<{ label: string; description: string }>;
  }>,
  timestamp = "2026-05-23T10:00:00.000Z",
): ClaudeTranscriptLine {
  return {
    type: "assistant",
    timestamp,
    uuid: `assistant-${toolUseId}`,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          name: "AskUserQuestion",
          // The Claude Code transcript carries `id` on the tool_use block.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ id: toolUseId } as any),
          input: { questions },
        },
      ],
    },
  };
}

function toolResultLine(
  toolUseId: string,
  resultText: string,
  timestamp = "2026-05-23T10:00:05.000Z",
): ClaudeTranscriptLine {
  return {
    type: "user",
    timestamp,
    uuid: `user-result-${toolUseId}`,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: resultText,
        },
      ],
    },
  };
}

describe("parseAskAnswerBlock", () => {
  it("parses single-question answer", () => {
    const text = `Your questions have been answered:\n"Pick a color" = "Blue"`;
    const { answers } = parseAskAnswerBlock(text);
    expect(answers.get("Pick a color")).toBe("Blue");
  });

  it("parses multi-question answer block", () => {
    const text = `
Your questions have been answered:
"Q1" = "A1"
"Q2" = "A2"
"Q3" = "A3"
`;
    const { answers } = parseAskAnswerBlock(text);
    expect(answers.size).toBe(3);
    expect(answers.get("Q1")).toBe("A1");
    expect(answers.get("Q3")).toBe("A3");
  });

  it("parses annotations / notes block", () => {
    const text = `
Your questions have been answered:
"Color" = "Other"

Annotations:
"Color": "I prefer teal"
`;
    const { answers, notes } = parseAskAnswerBlock(text);
    expect(answers.get("Color")).toBe("Other");
    expect(notes.get("Color")).toBe("I prefer teal");
  });
});

describe("extractAgentQuestionEvents", () => {
  it("emits exactly 1 event for a single-question AskUserQuestion call (S-9)", () => {
    const lines: ClaudeTranscriptLine[] = [
      askToolUseLine("tu_1", [
        {
          question: "Pick a color",
          header: "Color",
          options: [
            { label: "Red", description: "warm" },
            { label: "Blue", description: "cool" },
          ],
        },
      ]),
      toolResultLine("tu_1", `Your questions have been answered:\n"Pick a color" = "Blue"`),
    ];
    const events = extractAgentQuestionEvents(lines, SESSION_ID);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.kind).toBe("agent_question");
    expect(e.sessionId).toBe(SESSION_ID);
    const p = e.payload as Record<string, unknown>;
    expect(p["question"]).toBe("Pick a color");
    expect(p["chosen"]).toBe("Blue");
    expect(p["multiSelect"]).toBe(false);
    expect(p["questionIndex"]).toBe(0);
    expect(p["toolUseId"]).toBe("tu_1");
  });

  it("emits N events for an N-question call with sequential indices (S-10)", () => {
    const questions = [
      { question: "Q1", options: [{ label: "A", description: "" }] },
      { question: "Q2", options: [{ label: "B", description: "" }] },
      { question: "Q3", options: [{ label: "C", description: "" }] },
      { question: "Q4", options: [{ label: "D", description: "" }] },
    ];
    const lines: ClaudeTranscriptLine[] = [
      askToolUseLine("tu_2", questions),
      toolResultLine(
        "tu_2",
        `Your questions have been answered:
"Q1" = "A1"
"Q2" = "A2"
"Q3" = "A3"
"Q4" = "A4"`,
      ),
    ];
    const events = extractAgentQuestionEvents(lines, SESSION_ID);
    expect(events).toHaveLength(4);
    events.forEach((e, i) => {
      const p = e.payload as Record<string, unknown>;
      expect(p["questionIndex"]).toBe(i);
      expect(p["chosen"]).toBe(`A${i + 1}`);
    });
  });

  it("captures + sanitizes notes when present (S-11)", () => {
    const lines: ClaudeTranscriptLine[] = [
      askToolUseLine("tu_3", [
        {
          question: "How did you discover us?",
          options: [
            { label: "Twitter", description: "" },
            { label: "Other", description: "free text" },
          ],
        },
      ]),
      toolResultLine(
        "tu_3",
        `Your questions have been answered:
"How did you discover us?" = "Other"

Annotations:
"How did you discover us?": "From a friend at work"`,
      ),
    ];
    const events = extractAgentQuestionEvents(lines, SESSION_ID);
    expect(events).toHaveLength(1);
    const p = events[0]!.payload as Record<string, unknown>;
    expect(p["chosen"]).toBe("Other");
    expect(p["notes"]).toBe("From a friend at work");
  });

  it("truncates notes >4 KB with marker (R-9)", () => {
    const longNote = "x".repeat(5000);
    const lines: ClaudeTranscriptLine[] = [
      askToolUseLine("tu_4", [{ question: "Tell us more", options: [] }]),
      toolResultLine(
        "tu_4",
        `Your questions have been answered:\n"Tell us more" = "Other"\n\nAnnotations:\n"Tell us more": "${longNote}"`,
      ),
    ];
    const events = extractAgentQuestionEvents(lines, SESSION_ID);
    const notes = (events[0]!.payload as Record<string, unknown>)["notes"] as string;
    expect(notes.length).toBeLessThan(longNote.length);
    expect(notes).toMatch(/\[truncated \d+ bytes\]/);
  });

  it("redacts secret-bearing notes (S-16, INV-10)", () => {
    // Use a high-entropy 32-char token that the redactor's entropy pass flags.
    // The exact representation depends on the rule set; we assert that the
    // raw secret string does NOT survive into the persisted notes.
    const secret = "AKIAIOSFODNN7EXAMPLEABCDEFGH1234"; // AWS-shaped, 32 chars
    const lines: ClaudeTranscriptLine[] = [
      askToolUseLine("tu_5", [{ question: "Paste config", options: [] }]),
      toolResultLine(
        "tu_5",
        `Your questions have been answered:\n"Paste config" = "Other"\n\nAnnotations:\n"Paste config": "key=${secret}"`,
      ),
    ];
    const events = extractAgentQuestionEvents(lines, SESSION_ID);
    const notes = (events[0]!.payload as Record<string, unknown>)["notes"] as string;
    expect(notes).not.toContain(secret);
    expect(notes).toContain("[REDACTED");
  });

  it("emits unanswered event for orphan tool_use (no matching tool_result)", () => {
    const lines: ClaudeTranscriptLine[] = [
      askToolUseLine("tu_6", [{ question: "Lonely Q", options: [] }]),
      // No tool_result line — the call is orphaned.
    ];
    const events = extractAgentQuestionEvents(lines, SESSION_ID);
    expect(events).toHaveLength(1);
    const p = events[0]!.payload as Record<string, unknown>;
    expect(p["chosen"]).toBe("<unanswered>");
  });

  it("ignores orphan tool_result without matching tool_use", () => {
    const lines: ClaudeTranscriptLine[] = [
      toolResultLine("tu_unknown", `Your questions have been answered:\n"X" = "Y"`),
    ];
    const events = extractAgentQuestionEvents(lines, SESSION_ID);
    expect(events).toHaveLength(0);
  });

  it("coerces chosen to array for multi-select questions", () => {
    const lines: ClaudeTranscriptLine[] = [
      askToolUseLine("tu_7", [
        {
          question: "Pick tags",
          multiSelect: true,
          options: [
            { label: "a", description: "" },
            { label: "b", description: "" },
            { label: "c", description: "" },
          ],
        },
      ]),
      toolResultLine(
        "tu_7",
        `Your questions have been answered:
"Pick tags" = "a"
"Pick tags" = "b"`,
      ),
    ];
    const events = extractAgentQuestionEvents(lines, SESSION_ID);
    const chosen = (events[0]!.payload as Record<string, unknown>)["chosen"];
    expect(Array.isArray(chosen)).toBe(true);
    expect(chosen).toEqual(["a", "b"]);
  });
});
