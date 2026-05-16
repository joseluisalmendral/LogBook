/**
 * presets-extract.test.ts — Regression guard for buildArtifactsForPreset extraction.
 *
 * TDD Cycle:
 *   RED  → fails when buildArtifactsForPreset is NOT exported from src/core/presets.ts
 *   GREEN → passes after extraction (verbatim move from init.ts)
 *   REFACTOR → no change expected (pure structural refactor)
 *
 * Strategy: snapshot-style comparison of artifact structure (kind, name, file_path,
 * _logbookId) for each preset. We deliberately EXCLUDE volatile fields like `body`
 * and `command` (which contain absolute paths from __dirname) to keep the test
 * deterministic across machines.
 *
 * We sort by _logbookId within each kind group so the comparison is stable even
 * if the insertion order changes (it shouldn't, but this guards against it).
 */

import { describe, test, expect } from "vitest";
import { buildArtifactsForPreset } from "../../src/core/presets.js";
import type { Artifact } from "../../src/types/artifact.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ArtifactSummary = {
  kind: string;
  name?: string;
  file_path?: string;
  hookEvent?: string;
  _logbookId?: string;
};

/**
 * Build a stable sort key for an artifact.
 * gitignore_entry has no _logbookId so we fall back to kind+file_path.
 */
function sortKey(a: ArtifactSummary): string {
  if (a._logbookId !== undefined) return a._logbookId;
  return `${a.kind}:${a.file_path ?? ""}`;
}

/**
 * Extract a stable summary from an artifact list — strips volatile path fields
 * (command, body, args — these contain absolute paths resolved at runtime).
 * Sorted by _logbookId (or kind:file_path fallback) for determinism.
 */
function summarize(artifacts: Artifact[]): ArtifactSummary[] {
  return artifacts
    .map((a) => {
      const summary: ArtifactSummary = { kind: a.kind };
      if ("_logbookId" in a) summary._logbookId = a._logbookId;
      if ("name" in a) summary.name = a.name;
      if ("file_path" in a) summary.file_path = a.file_path;
      if ("hookEvent" in a) summary.hookEvent = a.hookEvent;
      return summary;
    })
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

// ---------------------------------------------------------------------------
// Frozen baselines captured from init.ts before extraction.
// These define the expected artifact shape — do NOT modify these snapshots
// unless the actual preset definition changes.
// ---------------------------------------------------------------------------

const MINIMAL_EXPECTED: ArtifactSummary[] = [
  // gitignore_entry has no _logbookId — sort key: "gitignore_entry:.gitignore"
  { kind: "gitignore_entry", file_path: ".gitignore" },
  { kind: "hook", hookEvent: "PostToolUse", _logbookId: "lb-hook-posttooluse-001" },
].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

const STANDARD_EXPECTED: ArtifactSummary[] = [
  { kind: "augment_claudemd", file_path: "CLAUDE.md", _logbookId: "lb-claudemd-001" },
  { kind: "gitignore_entry", file_path: ".gitignore" },
  { kind: "hook", hookEvent: "PostToolUse", _logbookId: "lb-hook-posttooluse-001" },
  { kind: "mcp_server", name: "logbook-mcp", _logbookId: "lb-mcp-001" },
  { kind: "slash_command", name: "lb-decision", file_path: ".claude/commands/lb-decision.md", _logbookId: "lb-cmd-lb-decision" },
  { kind: "slash_command", name: "lb-error", file_path: ".claude/commands/lb-error.md", _logbookId: "lb-cmd-lb-error" },
  { kind: "slash_command", name: "lb-fix", file_path: ".claude/commands/lb-fix.md", _logbookId: "lb-cmd-lb-fix" },
  { kind: "slash_command", name: "lb-lesson", file_path: ".claude/commands/lb-lesson.md", _logbookId: "lb-cmd-lb-lesson" },
  { kind: "slash_command", name: "lb-milestone", file_path: ".claude/commands/lb-milestone.md", _logbookId: "lb-cmd-lb-milestone" },
  { kind: "slash_command", name: "lb-phase", file_path: ".claude/commands/lb-phase.md", _logbookId: "lb-cmd-lb-phase" },
  { kind: "slash_command", name: "lb-review", file_path: ".claude/commands/lb-review.md", _logbookId: "lb-cmd-lb-review" },
  { kind: "slash_command", name: "lb-status", file_path: ".claude/commands/lb-status.md", _logbookId: "lb-cmd-lb-status" },
  { kind: "skill", name: "logbook-auto-capture", file_path: ".claude/skills/logbook-auto-capture/SKILL.md", _logbookId: "lb-skill-logbook-auto-capture-skill" },
  { kind: "skill", name: "logbook-auto-capture", file_path: ".claude/skills/logbook-auto-capture/reference.md", _logbookId: "lb-skill-logbook-auto-capture-reference" },
].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

const TEACHING_EXPECTED: ArtifactSummary[] = [
  { kind: "augment_claudemd", file_path: "CLAUDE.md", _logbookId: "lb-claudemd-001" },
  { kind: "gitignore_entry", file_path: ".gitignore" },
  { kind: "hook", hookEvent: "PostToolUse", _logbookId: "lb-hook-posttooluse-001" },
  { kind: "hook", hookEvent: "SessionStart", _logbookId: "lb-hook-sessionstart-001" },
  { kind: "mcp_server", name: "logbook-mcp", _logbookId: "lb-mcp-001" },
  { kind: "slash_command", name: "lb-decision", file_path: ".claude/commands/lb-decision.md", _logbookId: "lb-cmd-lb-decision" },
  { kind: "slash_command", name: "lb-error", file_path: ".claude/commands/lb-error.md", _logbookId: "lb-cmd-lb-error" },
  { kind: "slash_command", name: "lb-fix", file_path: ".claude/commands/lb-fix.md", _logbookId: "lb-cmd-lb-fix" },
  { kind: "slash_command", name: "lb-lesson", file_path: ".claude/commands/lb-lesson.md", _logbookId: "lb-cmd-lb-lesson" },
  { kind: "slash_command", name: "lb-milestone", file_path: ".claude/commands/lb-milestone.md", _logbookId: "lb-cmd-lb-milestone" },
  { kind: "slash_command", name: "lb-phase", file_path: ".claude/commands/lb-phase.md", _logbookId: "lb-cmd-lb-phase" },
  { kind: "slash_command", name: "lb-review", file_path: ".claude/commands/lb-review.md", _logbookId: "lb-cmd-lb-review" },
  { kind: "slash_command", name: "lb-status", file_path: ".claude/commands/lb-status.md", _logbookId: "lb-cmd-lb-status" },
  { kind: "skill", name: "logbook-auto-capture", file_path: ".claude/skills/logbook-auto-capture/SKILL.md", _logbookId: "lb-skill-logbook-auto-capture-skill" },
  { kind: "skill", name: "logbook-auto-capture", file_path: ".claude/skills/logbook-auto-capture/reference.md", _logbookId: "lb-skill-logbook-auto-capture-reference" },
  { kind: "statusline", _logbookId: "lb-statusline-001" },
  { kind: "subagent", name: "logbook-curator", file_path: ".claude/subagents/logbook-curator.md", _logbookId: "lb-agent-curator-001" },
  { kind: "subagent", name: "logbook-teacher", file_path: ".claude/subagents/logbook-teacher.md", _logbookId: "lb-agent-teacher-001" },
].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildArtifactsForPreset — extraction regression guard", () => {
  test("minimal: returns exactly 2 artifacts (hook + gitignore_entry)", () => {
    const artifacts = buildArtifactsForPreset("minimal");
    expect(artifacts).toHaveLength(2);
  });

  test("minimal: artifact shape matches frozen baseline", () => {
    const artifacts = buildArtifactsForPreset("minimal");
    expect(summarize(artifacts)).toEqual(MINIMAL_EXPECTED);
  });

  test("standard: returns exactly 14 artifacts", () => {
    const artifacts = buildArtifactsForPreset("standard");
    expect(artifacts).toHaveLength(14);
  });

  test("standard: artifact shape matches frozen baseline", () => {
    const artifacts = buildArtifactsForPreset("standard");
    expect(summarize(artifacts)).toEqual(STANDARD_EXPECTED);
  });

  test("teaching: returns exactly 18 artifacts", () => {
    const artifacts = buildArtifactsForPreset("teaching");
    expect(artifacts).toHaveLength(18);
  });

  test("teaching: artifact shape matches frozen baseline", () => {
    const artifacts = buildArtifactsForPreset("teaching");
    expect(summarize(artifacts)).toEqual(TEACHING_EXPECTED);
  });

  test("full: behaves identically to teaching (alias)", () => {
    const full = buildArtifactsForPreset("full");
    const teaching = buildArtifactsForPreset("teaching");
    expect(summarize(full)).toEqual(summarize(teaching));
    expect(full).toHaveLength(teaching.length);
  });

  test("unknown preset: falls back to minimal (2 artifacts)", () => {
    const artifacts = buildArtifactsForPreset("unknown-preset");
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]!.kind).toBe("hook");
    expect(artifacts[1]!.kind).toBe("gitignore_entry");
  });

  test("gitignore_entry is always LAST in every preset", () => {
    for (const preset of ["minimal", "standard", "teaching", "full"]) {
      const artifacts = buildArtifactsForPreset(preset);
      const last = artifacts[artifacts.length - 1]!;
      expect(last.kind, `${preset}: last artifact must be gitignore_entry`).toBe("gitignore_entry");
    }
  });
});
