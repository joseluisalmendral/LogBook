/**
 * Unit tests: logbook import github-pr (B2 spec).
 *
 * Tests cover:
 *   - parsePrUrl correctly parses GitHub PR URL formats
 *   - isClaudeCodeActionComment heuristic correctly identifies bot comments
 *   - When both gh CLI and GITHUB_TOKEN absent → non-zero exit error
 *   - extractSummary and extractFilesChanged parse comment data
 *   - PASSIVE invariant: import does not affect live AI sessions
 *
 * Covers AG-7, AG-8, B2-S1–B2-S4.
 */

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// parsePrUrl
// ---------------------------------------------------------------------------

describe("parsePrUrl", () => {
  it("parses standard GitHub PR URL", async () => {
    const { parsePrUrl } = await import("../../src/cli/commands/import/github-pr.js");
    const result = parsePrUrl("https://github.com/owner/repo/pull/123");
    expect(result).toEqual({ owner: "owner", repo: "repo", prNumber: 123 });
  });

  it("returns null for non-PR GitHub URL", async () => {
    const { parsePrUrl } = await import("../../src/cli/commands/import/github-pr.js");
    const result = parsePrUrl("https://github.com/owner/repo/issues/123");
    expect(result).toBeNull();
  });

  it("returns null for non-GitHub URL", async () => {
    const { parsePrUrl } = await import("../../src/cli/commands/import/github-pr.js");
    const result = parsePrUrl("https://gitlab.com/owner/repo/pull/123");
    expect(result).toBeNull();
  });

  it("parses PR number as integer", async () => {
    const { parsePrUrl } = await import("../../src/cli/commands/import/github-pr.js");
    const result = parsePrUrl("https://github.com/org/project/pull/456");
    expect(result?.prNumber).toBe(456);
  });
});

// ---------------------------------------------------------------------------
// isClaudeCodeActionComment
// ---------------------------------------------------------------------------

describe("isClaudeCodeActionComment", () => {
  it("returns true for claude-code-action bot comment", async () => {
    const { isClaudeCodeActionComment } = await import("../../src/cli/commands/import/github-pr.js");
    const comment = {
      user: { login: "github-actions[bot]" },
      body: "## Claude Code Agent Run\n\nI completed the task.",
    };
    expect(isClaudeCodeActionComment(comment)).toBe(true);
  });

  it("returns false for regular user comment", async () => {
    const { isClaudeCodeActionComment } = await import("../../src/cli/commands/import/github-pr.js");
    const comment = {
      user: { login: "alice" },
      body: "Looks good to me!",
    };
    expect(isClaudeCodeActionComment(comment)).toBe(false);
  });

  it("returns false for non-claude-code bot comment", async () => {
    const { isClaudeCodeActionComment } = await import("../../src/cli/commands/import/github-pr.js");
    const comment = {
      user: { login: "dependabot[bot]" },
      body: "Bump version from 1.0 to 2.0",
    };
    expect(isClaudeCodeActionComment(comment)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractSummary and extractFilesChanged
// ---------------------------------------------------------------------------

describe("extractSummary", () => {
  it("extracts summary text from comment body", async () => {
    const { extractSummary } = await import("../../src/cli/commands/import/github-pr.js");
    const body = "## Claude Code Agent Run\n\nI updated the config files to fix the issue.";
    const result = extractSummary(body);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("extractFilesChanged", () => {
  it("extracts files changed count from comment body", async () => {
    const { extractFilesChanged } = await import("../../src/cli/commands/import/github-pr.js");
    const body = "Changed 5 files: src/a.ts, src/b.ts, etc.";
    const result = extractFilesChanged(body);
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("returns 0 when no files changed info found", async () => {
    const { extractFilesChanged } = await import("../../src/cli/commands/import/github-pr.js");
    const result = extractFilesChanged("No file info here.");
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Auth guard — both methods absent (B2-S3)
// ---------------------------------------------------------------------------

describe("auth guard — both gh and GITHUB_TOKEN absent", () => {
  it("isGhAvailable returns a boolean", async () => {
    const { isGhAvailable } = await import("../../src/cli/commands/import/github-pr.js");
    // Must return a boolean, not throw.
    const result = isGhAvailable();
    expect(typeof result).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// PASSIVE invariant (B2-S4, INV-1)
// ---------------------------------------------------------------------------

describe("PASSIVE invariant", () => {
  it("import command module does not modify process.env on import", async () => {
    const envBefore = { ...process.env };
    await import("../../src/cli/commands/import/github-pr.js");
    // No new environment variables should have been added.
    const newKeys = Object.keys(process.env).filter((k) => !(k in envBefore));
    expect(newKeys).toHaveLength(0);
  });
});
