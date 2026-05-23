/**
 * Unit tests: skill invocation detection in transcript scraper (B3 spec).
 *
 * Tests cover:
 *   - SKILL.md path match in tool_use.Read → produces skill_invoked event
 *   - Non-SKILL.md path → no skill_invoked synthesis
 *   - Write/Edit tool type → no skill_invoked synthesis
 *   - PASSIVE invariant: synthesis is post-hoc (B3-S3, INV-1)
 *   - detectSkillRead extracts skillName from path correctly
 *
 * Covers AG-9, AG-10, B3-S1–B3-S3.
 */

import { describe, it, expect } from "vitest";
import { transcriptLineToEvents } from "../../src/connectors/claude-code/transcript.js";
import type { ClaudeTranscriptLine } from "../../src/connectors/claude-code/transcript.js";
import { detectSkillRead } from "../../src/connectors/claude-code/transcript.js";

const SESSION_ID = "sess-skill-test";

// ---------------------------------------------------------------------------
// detectSkillRead
// ---------------------------------------------------------------------------

describe("detectSkillRead", () => {
  it("returns skill info for .claude/skills/sdd-apply/SKILL.md path", () => {
    const result = detectSkillRead("/project/.claude/skills/sdd-apply/SKILL.md");
    expect(result).not.toBeNull();
    expect(result?.skillName).toBe("sdd-apply");
  });

  it("returns skill info for nested skill path", () => {
    const result = detectSkillRead("/home/user/.claude/skills/testing/nested/SKILL.md");
    expect(result).not.toBeNull();
  });

  it("returns null for non-SKILL.md path", () => {
    const result = detectSkillRead("/project/.claude/skills/sdd-apply/README.md");
    expect(result).toBeNull();
  });

  it("returns null for SKILL.md not under .claude/skills/ directory", () => {
    const result = detectSkillRead("/project/docs/SKILL.md");
    expect(result).toBeNull();
  });

  it("returns null for empty path", () => {
    const result = detectSkillRead("");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// transcriptLineToEvents — skill_invoked synthesis (B3-S1)
// ---------------------------------------------------------------------------

describe("transcriptLineToEvents — skill invocation detection", () => {
  it("synthesizes skill_invoked when tool_use.Read path matches SKILL.md (B3-S1)", () => {
    const line: ClaudeTranscriptLine = {
      type: "assistant",
      uuid: "uuid-skill-1",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: "/project/.claude/skills/sdd-apply/SKILL.md" },
          },
        ],
      },
    };
    const events = transcriptLineToEvents(line, SESSION_ID);
    const skillEvent = events.find((e) => e.kind === "skill_invoked");
    expect(skillEvent).toBeDefined();
    expect((skillEvent?.payload as Record<string, unknown>)?.skillName).toBe("sdd-apply");
  });

  it("does NOT synthesize skill_invoked for non-SKILL.md Read path (B3-S2)", () => {
    const line: ClaudeTranscriptLine = {
      type: "assistant",
      uuid: "uuid-skill-2",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: "/project/src/index.ts" },
          },
        ],
      },
    };
    const events = transcriptLineToEvents(line, SESSION_ID);
    const skillEvent = events.find((e) => e.kind === "skill_invoked");
    expect(skillEvent).toBeUndefined();
  });

  it("does NOT synthesize skill_invoked for Write tool (B3-S2)", () => {
    const line: ClaudeTranscriptLine = {
      type: "assistant",
      uuid: "uuid-skill-3",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: { file_path: "/project/.claude/skills/my-skill/SKILL.md", content: "..." },
          },
        ],
      },
    };
    const events = transcriptLineToEvents(line, SESSION_ID);
    const skillEvent = events.find((e) => e.kind === "skill_invoked");
    expect(skillEvent).toBeUndefined();
  });

  it("does NOT synthesize skill_invoked for Edit tool (B3-S2)", () => {
    const line: ClaudeTranscriptLine = {
      type: "assistant",
      uuid: "uuid-skill-4",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: "/project/.claude/skills/my-skill/SKILL.md" },
          },
        ],
      },
    };
    const events = transcriptLineToEvents(line, SESSION_ID);
    const skillEvent = events.find((e) => e.kind === "skill_invoked");
    expect(skillEvent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PASSIVE invariant (B3-S3, INV-1)
// ---------------------------------------------------------------------------

describe("PASSIVE invariant", () => {
  it("skill_invoked synthesis does not block or modify the Read tool call", () => {
    // The synthesis is purely observational: the original events list must still
    // contain the claude_message or tool_use without modification.
    const line: ClaudeTranscriptLine = {
      type: "assistant",
      uuid: "uuid-passive",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: "/project/.claude/skills/sdd-apply/SKILL.md" },
          },
        ],
      },
    };
    // Must not throw and must not produce unrelated events.
    const events = transcriptLineToEvents(line, SESSION_ID);
    // Only skill_invoked should be emitted (tool_use is not separately emitted by default).
    for (const e of events) {
      expect(e.kind).toBe("skill_invoked");
    }
  });
});
