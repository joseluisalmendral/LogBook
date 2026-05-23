/**
 * Unit tests: valibot schema validation for all 5 new event kinds (B1-B5).
 *
 * Tests cover:
 *   - Valid payload passes for each of 5 schemas
 *   - Missing required field fails for each schema
 *   - INV-7: unknown fields rejected by strictObject
 *   - entryType discriminant is enforced
 *
 * Covers B1-R4, B2-R4, B3-R3, B4-R3, B5-R1, INV-7.
 */

import { describe, it, expect } from "vitest";
import * as v from "valibot";
import {
  LangfuseTracePayloadSchema,
  GhAgentRunPayloadSchema,
  SkillInvokedPayloadSchema,
  VisualDirectionPayloadSchema,
  QaFindingPayloadSchema,
} from "../../src/events/schemas.js";

// ---------------------------------------------------------------------------
// LangfuseTracePayloadSchema (B1-R4)
// ---------------------------------------------------------------------------

describe("LangfuseTracePayloadSchema", () => {
  const validPayload = {
    entryType: "langfuse_trace" as const,
    traceId: "trace-abc-123",
    model: "claude-3-5-sonnet",
    inputTokens: 1200,
    outputTokens: 450,
    totalCost: 0.0042,
    langfuseSessionId: "lf-sess-001",
  };

  it("accepts valid langfuse_trace payload", () => {
    expect(() => v.parse(LangfuseTracePayloadSchema, validPayload)).not.toThrow();
  });

  it("rejects payload missing required traceId", () => {
    const { traceId: _, ...rest } = validPayload;
    expect(() => v.parse(LangfuseTracePayloadSchema, rest)).toThrow();
  });

  it("rejects payload with wrong entryType discriminant", () => {
    expect(() =>
      v.parse(LangfuseTracePayloadSchema, { ...validPayload, entryType: "wrong_type" })
    ).toThrow();
  });

  it("rejects unknown extra fields (INV-7 strict)", () => {
    expect(() =>
      v.parse(LangfuseTracePayloadSchema, { ...validPayload, unknownField: "bad" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// GhAgentRunPayloadSchema (B2-R4)
// ---------------------------------------------------------------------------

describe("GhAgentRunPayloadSchema", () => {
  const validPayload = {
    entryType: "gh_agent_run" as const,
    prUrl: "https://github.com/owner/repo/pull/42",
    prNumber: 42,
    runId: "run-xyz",
    runSummary: "Updated config files to fix CORS issue",
    filesChanged: 3,
  };

  it("accepts valid gh_agent_run payload with all fields", () => {
    expect(() => v.parse(GhAgentRunPayloadSchema, validPayload)).not.toThrow();
  });

  it("accepts valid gh_agent_run payload with only required fields", () => {
    const minimal = {
      entryType: "gh_agent_run" as const,
      prUrl: "https://github.com/owner/repo/pull/1",
      runId: "run-min",
    };
    expect(() => v.parse(GhAgentRunPayloadSchema, minimal)).not.toThrow();
  });

  it("rejects payload missing required prUrl", () => {
    const { prUrl: _, ...rest } = validPayload;
    expect(() => v.parse(GhAgentRunPayloadSchema, rest)).toThrow();
  });

  it("rejects payload missing required runId", () => {
    const { runId: _, ...rest } = validPayload;
    expect(() => v.parse(GhAgentRunPayloadSchema, rest)).toThrow();
  });

  it("rejects payload with wrong entryType discriminant", () => {
    expect(() =>
      v.parse(GhAgentRunPayloadSchema, { ...validPayload, entryType: "wrong_type" })
    ).toThrow();
  });

  it("rejects unknown extra fields (INV-7 strict)", () => {
    expect(() =>
      v.parse(GhAgentRunPayloadSchema, { ...validPayload, extraField: "bad" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SkillInvokedPayloadSchema (B3-R3)
// ---------------------------------------------------------------------------

describe("SkillInvokedPayloadSchema", () => {
  const validPayload = {
    entryType: "skill_invoked" as const,
    skillName: "sdd-apply",
    skillPath: "/project/.claude/skills/sdd-apply/SKILL.md",
  };

  it("accepts valid skill_invoked payload", () => {
    expect(() => v.parse(SkillInvokedPayloadSchema, validPayload)).not.toThrow();
  });

  it("rejects payload missing required skillName", () => {
    const { skillName: _, ...rest } = validPayload;
    expect(() => v.parse(SkillInvokedPayloadSchema, rest)).toThrow();
  });

  it("rejects payload with wrong entryType discriminant", () => {
    expect(() =>
      v.parse(SkillInvokedPayloadSchema, { ...validPayload, entryType: "wrong_type" })
    ).toThrow();
  });

  it("rejects unknown extra fields (INV-7 strict)", () => {
    expect(() =>
      v.parse(SkillInvokedPayloadSchema, { ...validPayload, unknownField: "bad" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// VisualDirectionPayloadSchema (B4-R3)
// ---------------------------------------------------------------------------

describe("VisualDirectionPayloadSchema", () => {
  const validPayload = {
    entryType: "visual_direction" as const,
    candidates: ["dark-minimal", "light-colorful", "branded"],
    chosen: "dark-minimal",
    rationale: "Aligns with the brand identity and accessibility requirements",
  };

  it("accepts valid visual_direction payload", () => {
    expect(() => v.parse(VisualDirectionPayloadSchema, validPayload)).not.toThrow();
  });

  it("rejects payload missing required chosen field", () => {
    const { chosen: _, ...rest } = validPayload;
    expect(() => v.parse(VisualDirectionPayloadSchema, rest)).toThrow();
  });

  it("rejects payload with empty candidates (B4-R3)", () => {
    expect(() =>
      v.parse(VisualDirectionPayloadSchema, { ...validPayload, candidates: [] })
    ).toThrow();
  });

  it("rejects payload with wrong entryType discriminant", () => {
    expect(() =>
      v.parse(VisualDirectionPayloadSchema, { ...validPayload, entryType: "wrong_type" })
    ).toThrow();
  });

  it("rejects unknown extra fields (INV-7 strict)", () => {
    expect(() =>
      v.parse(VisualDirectionPayloadSchema, { ...validPayload, unknownField: "bad" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// QaFindingPayloadSchema (B5-R1)
// ---------------------------------------------------------------------------

describe("QaFindingPayloadSchema", () => {
  const validPayload = {
    entryType: "qa_finding" as const,
    severity: "high" as const,
    layer: "seo" as const,
    description: "Canonical URL missing on paginated product listings",
    fix: "Add <link rel='canonical'> to all paginated pages",
  };

  it("accepts valid qa_finding payload with all fields", () => {
    expect(() => v.parse(QaFindingPayloadSchema, validPayload)).not.toThrow();
  });

  it("accepts valid qa_finding payload without optional fix", () => {
    const { fix: _, ...rest } = validPayload;
    expect(() => v.parse(QaFindingPayloadSchema, rest)).not.toThrow();
  });

  it("rejects invalid severity value", () => {
    expect(() =>
      v.parse(QaFindingPayloadSchema, { ...validPayload, severity: "urgent" })
    ).toThrow();
  });

  it("rejects invalid layer value", () => {
    expect(() =>
      v.parse(QaFindingPayloadSchema, { ...validPayload, layer: "database" })
    ).toThrow();
  });

  it("rejects payload with wrong entryType discriminant", () => {
    expect(() =>
      v.parse(QaFindingPayloadSchema, { ...validPayload, entryType: "wrong_type" })
    ).toThrow();
  });

  it("rejects unknown extra fields (INV-7 strict)", () => {
    expect(() =>
      v.parse(QaFindingPayloadSchema, { ...validPayload, unknownField: "bad" })
    ).toThrow();
  });
});
