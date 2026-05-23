/**
 * Valibot schemas for the 5 new event kinds introduced in ux-granularity-and-capture-gaps.
 *
 * These schemas validate payloads BEFORE writing to JSONL (INV-7).
 * Used by: Stop hook Langfuse block (B1), gh-import CLI (B2),
 *           visual-direction CLI (B4), qa_finding MCP tool (B5).
 * Skill invocation (B3) synthesizes events in the read-path (transcript scraper),
 * but its schema is also defined here for consistency.
 *
 * All schemas use v.strictObject to reject unknown fields (per §31 pattern).
 */

import * as v from "valibot";

// ---------------------------------------------------------------------------
// B1: langfuse_trace — Langfuse trace fetched at Stop hook time
// ---------------------------------------------------------------------------

export const LangfuseTracePayloadSchema = v.strictObject({
  entryType: v.literal("langfuse_trace"),
  /** Langfuse trace ID from the API response. */
  traceId: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  /** Session ID from Langfuse (may differ from logbook sessionId). */
  langfuseSessionId: v.optional(v.string()),
  /** Model name (e.g. "claude-3-7-sonnet-20250219"). */
  model: v.optional(v.string()),
  /** Total cost in USD, formatted as number. */
  totalCost: v.optional(v.number()),
  /** Input token count. */
  inputTokens: v.optional(v.number()),
  /** Output token count. */
  outputTokens: v.optional(v.number()),
});

export type LangfuseTracePayload = v.InferOutput<typeof LangfuseTracePayloadSchema>;

// ---------------------------------------------------------------------------
// B2: gh_agent_run — GitHub claude-code-action PR run import
// ---------------------------------------------------------------------------

export const GhAgentRunPayloadSchema = v.strictObject({
  entryType: v.literal("gh_agent_run"),
  /** GitHub PR URL (e.g. https://github.com/owner/repo/pull/42). */
  prUrl: v.pipe(v.string(), v.url()),
  /** Unique identifier for this agent run (from PR comment metadata). */
  runId: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  /** Summary text from the claude-code-action run. */
  runSummary: v.optional(v.pipe(v.string(), v.maxLength(5000))),
  /** Number of files changed in this run (count). */
  filesChanged: v.optional(v.number()),
  /** PR number. */
  prNumber: v.optional(v.number()),
});

export type GhAgentRunPayload = v.InferOutput<typeof GhAgentRunPayloadSchema>;

// ---------------------------------------------------------------------------
// B3: skill_invoked — Skill SKILL.md read detected in transcript scraper
// ---------------------------------------------------------------------------

export const SkillInvokedPayloadSchema = v.strictObject({
  entryType: v.literal("skill_invoked"),
  /** Skill name derived from the directory containing SKILL.md. */
  skillName: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  /** Full skill path (e.g. .claude/skills/react-patterns/SKILL.md). */
  skillPath: v.pipe(v.string(), v.minLength(1), v.maxLength(1000)),
});

export type SkillInvokedPayload = v.InferOutput<typeof SkillInvokedPayloadSchema>;

// ---------------------------------------------------------------------------
// B4: visual_direction — Visual direction decision logged via CLI
// ---------------------------------------------------------------------------

export const VisualDirectionPayloadSchema = v.strictObject({
  entryType: v.literal("visual_direction"),
  /** Candidate design approaches (parsed from comma-separated CLI input). Must have at least 1. */
  candidates: v.pipe(v.array(v.string()), v.minLength(1)),
  /** The chosen direction from the candidates list. */
  chosen: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  /** Rationale for the chosen direction. */
  rationale: v.pipe(v.string(), v.maxLength(5000)),
});

export type VisualDirectionPayload = v.InferOutput<typeof VisualDirectionPayloadSchema>;

// ---------------------------------------------------------------------------
// B5: qa_finding — QA finding logged via MCP tool
// ---------------------------------------------------------------------------

export const QaFindingSeveritySchema = v.picklist([
  "critical",
  "high",
  "medium",
  "low",
]);

export const QaFindingLayerSchema = v.picklist([
  "seo",
  "geo",
  "perf",
  "a11y",
  "functional",
]);

export type QaFindingSeverity = v.InferOutput<typeof QaFindingSeveritySchema>;
export type QaFindingLayer = v.InferOutput<typeof QaFindingLayerSchema>;

export const QaFindingPayloadSchema = v.strictObject({
  entryType: v.literal("qa_finding"),
  /** Severity level. */
  severity: QaFindingSeveritySchema,
  /** Domain layer this finding applies to. */
  layer: QaFindingLayerSchema,
  /** Human-readable description of the finding. */
  description: v.pipe(v.string(), v.minLength(1), v.maxLength(5000)),
  /** Optional suggested fix. */
  fix: v.optional(v.pipe(v.string(), v.maxLength(5000))),
});

export type QaFindingPayload = v.InferOutput<typeof QaFindingPayloadSchema>;
