/**
 * Unit tests: commits-doc remote URL → link generation (ADR-21, CD-1).
 *
 * Verifies that:
 *   - SSH remote from github.com → clickable link emitted
 *   - HTTPS remote from github.com → clickable link emitted
 *   - No remote → plain SHA fallback
 *   - Non-allowlisted host → plain SHA fallback (buildCommitLink returns undefined)
 *   - gitlab.com and bitbucket.org → clickable links
 */

import { describe, it, expect } from "vitest";
import { buildCommitsDoc } from "../../src/generate/commits-doc.js";
import type { RenderContext } from "../../src/generate/render-context.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const SHA = "abc1234567890abcdef1234567890abcdef123456";

function makeCtx(sha?: string): RenderContext {
  const base = {
    sessions: [],
    phases: [],
    decisions: [],
    errors: [],
    fixes: [],
    lessons: [],
    resources: [],
    visuals: [],
    milestones: [],
    latestSessionId: "",
  };

  if (!sha) {
    return { ...base, all: [] };
  }

  const event = {
    id: "evt-001",
    type: "manual.decision",
    ts: "2024-01-01T10:00:00Z",
    title: "Test decision",
    gitSha: sha,
  };

  return { ...base, all: [event] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildCommitsDoc — remote URL link generation (ADR-21)", () => {
  it("no remote → plain SHA, no link", () => {
    const ctx = makeCtx(SHA);
    const md = buildCommitsDoc(ctx, undefined);
    // Should contain the abbrev but no Markdown link syntax
    expect(md).toContain(SHA.slice(0, 7));
    expect(md).not.toContain("](https://");
  });

  it("github.com HTTPS remote → clickable link", () => {
    const ctx = makeCtx(SHA);
    const md = buildCommitsDoc(ctx, "https://github.com/org/repo.git");
    expect(md).toContain("](https://github.com/org/repo/commit/");
    expect(md).toContain(SHA.slice(0, 7));
  });

  it("github.com SSH remote → clickable link", () => {
    const ctx = makeCtx(SHA);
    const md = buildCommitsDoc(ctx, "git@github.com:org/repo.git");
    expect(md).toContain("](https://github.com/org/repo/commit/");
  });

  it("gitlab.com HTTPS remote → clickable link", () => {
    const ctx = makeCtx(SHA);
    const md = buildCommitsDoc(ctx, "https://gitlab.com/org/repo.git");
    expect(md).toContain("](https://gitlab.com/org/repo/-/commit/");
  });

  it("bitbucket.org HTTPS remote → clickable link", () => {
    const ctx = makeCtx(SHA);
    const md = buildCommitsDoc(ctx, "https://bitbucket.org/org/repo.git");
    expect(md).toContain("](https://bitbucket.org/org/repo/commits/");
  });

  it("unknown host → plain SHA (buildCommitLink returns undefined)", () => {
    const ctx = makeCtx(SHA);
    const md = buildCommitsDoc(ctx, "https://selfhosted.company.com/org/repo.git");
    // No Markdown link should be emitted
    expect(md).not.toContain("](https://");
    expect(md).toContain(SHA.slice(0, 7));
  });

  it("no events with gitSha → empty-state message", () => {
    // visual-replay-redesign Phase 4 (V9) rewrote empty states to Spanish per
    // cognitive-doc-design "lead with the answer" — assert on the lb-empty-state
    // shell + the Spanish lead phrase, not the old English placeholder.
    const ctx = makeCtx(); // no events at all
    const md = buildCommitsDoc(ctx, "https://github.com/org/repo.git");
    expect(md).toContain("lb-empty-state");
    expect(md).toContain("Aún no hay commits");
  });
});
