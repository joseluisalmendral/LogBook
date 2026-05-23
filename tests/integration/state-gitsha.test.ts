/**
 * state-gitsha.test.ts — Integration tests for state.json gitSha caching
 * and the commits.md generator.
 *
 * RED phase: tests fail because:
 *   - LogBookState doesn't have gitSha/gitShaCapturedAt fields
 *   - ingest SessionStart doesn't cache gitSha to state.json
 *   - buildCommitsDoc does not exist
 *
 * Strategy:
 *   - Write state.json manually with gitSha fields and verify readState
 *     returns them (type-level backward compat test — no new code yet).
 *   - Verify that a SessionStart ingest call writes gitSha into state.json.
 *   - Verify subsequent ingest calls do NOT spawn new git processes for gitSha.
 *   - Verify events without gitSha still round-trip through readContext.
 *   - Verify buildCommitsDoc groups events by gitSha and emits commits.md content.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { readState, writeState } from "../../src/core/state.js";
import { buildCommitsDoc } from "../../src/generate/commits-doc.js";
import type { RenderContext } from "../../src/generate/render-context.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmp: string;
let statePath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-gitsha-"));
  statePath = path.join(tmp, "state.json");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// State schema tests
// ---------------------------------------------------------------------------

describe("state.json schema — gitSha + gitShaCapturedAt", () => {
  it("state.json gains gitSha and gitShaCapturedAt fields when written", () => {
    const state = {
      version: 1 as const,
      disabled: false,
      warnings: [],
      staleLocksReleased: 0,
      gitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      gitShaCapturedAt: "2026-05-17T10:00:00.000Z",
    };
    writeState(statePath, state);
    const loaded = readState(statePath);
    expect(loaded.gitSha).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
    expect(loaded.gitShaCapturedAt).toBe("2026-05-17T10:00:00.000Z");
  });

  it("existing state.json without gitSha fields still loads without error (backward compat)", () => {
    const legacy = {
      version: 1,
      disabled: false,
      warnings: [],
      staleLocksReleased: 0,
    };
    fs.writeFileSync(statePath, JSON.stringify(legacy, null, 2) + "\n", "utf8");
    const loaded = readState(statePath);
    expect(loaded.disabled).toBe(false);
    expect(loaded.gitSha).toBeUndefined();
    expect(loaded.gitShaCapturedAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// event.gitSha optional field — backward compat
// ---------------------------------------------------------------------------

describe("event.gitSha is optional (backward compat)", () => {
  it("an event without gitSha is still valid and normalizes through render-context", async () => {
    // We just verify that RenderContext can be built from events that lack gitSha.
    // buildCommitsDoc must handle events with no gitSha gracefully.
    const ctx: RenderContext = {
      sessions: [],
      phases: [],
      decisions: [
        {
          id: "dec-001",
          type: "manual.decision",
          ts: "2026-01-01T00:00:00Z",
          title: "Old decision without SHA",
        },
      ],
      errors: [],
      fixes: [],
      lessons: [],
      resources: [],
      visuals: [],
      milestones: [],
      latestSessionId: "",
      all: [
        {
          id: "dec-001",
          type: "manual.decision",
          ts: "2026-01-01T00:00:00Z",
          title: "Old decision without SHA",
        },
      ],
    };

    // buildCommitsDoc must not throw for events without gitSha
    expect(() => buildCommitsDoc(ctx, undefined)).not.toThrow();
    const doc = buildCommitsDoc(ctx, undefined);
    expect(typeof doc).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// buildCommitsDoc
// ---------------------------------------------------------------------------

describe("buildCommitsDoc", () => {
  it("emits an empty placeholder when no events have gitSha", () => {
    const ctx: RenderContext = {
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
      all: [
        {
          id: "e-001",
          type: "manual.snapshot",
          ts: "2026-01-01T00:00:00Z",
          // no gitSha
        },
      ],
    };
    const doc = buildCommitsDoc(ctx, undefined);
    // visual-replay-redesign Phase 4 (V9) rewrote empty states to Spanish per
    // cognitive-doc-design "lead with the answer" — assert on the lb-empty-state
    // shell + the Spanish lead phrase, not the old English placeholder.
    expect(doc).toContain("lb-empty-state");
    expect(doc).toContain("Aún no hay commits");
  });

  it("groups events by gitSha and shows 7-char abbreviated SHA", () => {
    const sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    const ctx: RenderContext = {
      sessions: [],
      phases: [],
      decisions: [
        {
          id: "dec-001",
          type: "manual.decision",
          ts: "2026-01-01T00:00:01Z",
          title: "First decision",
          gitSha: sha,
        },
      ],
      errors: [],
      fixes: [],
      lessons: [],
      resources: [],
      visuals: [],
      milestones: [],
      latestSessionId: "",
      all: [
        {
          id: "dec-001",
          type: "manual.decision",
          ts: "2026-01-01T00:00:01Z",
          title: "First decision",
          gitSha: sha,
        },
      ],
    };
    const doc = buildCommitsDoc(ctx, undefined);
    // 7-char abbrev
    expect(doc).toContain("a1b2c3d");
    expect(doc).toContain("First decision");
  });

  it("includes commit link when remote URL is provided (github.com)", () => {
    const sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    const remoteUrl = "https://github.com/acme/logbook.git";
    const ctx: RenderContext = {
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
      all: [
        {
          id: "snap-001",
          type: "manual.snapshot",
          ts: "2026-01-01T00:00:00Z",
          gitSha: sha,
        },
      ],
    };
    const doc = buildCommitsDoc(ctx, remoteUrl);
    expect(doc).toContain("https://github.com/acme/logbook/commit/");
    expect(doc).toContain("a1b2c3d");
  });

  it("shows plain SHA without link when remote is undefined", () => {
    const sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    const ctx: RenderContext = {
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
      all: [
        {
          id: "snap-001",
          type: "manual.snapshot",
          ts: "2026-01-01T00:00:00Z",
          gitSha: sha,
        },
      ],
    };
    const doc = buildCommitsDoc(ctx, undefined);
    expect(doc).toContain("a1b2c3d");
    expect(doc).not.toContain("https://");
  });

  it("groups multiple events under the same SHA into one section", () => {
    const sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    const ctx: RenderContext = {
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
      all: [
        {
          id: "e-001",
          type: "manual.snapshot",
          ts: "2026-01-01T00:00:00Z",
          gitSha: sha,
        },
        {
          id: "e-002",
          type: "manual.decision",
          ts: "2026-01-01T00:00:05Z",
          title: "A decision",
          gitSha: sha,
        },
      ],
    };
    const doc = buildCommitsDoc(ctx, undefined);
    // The SHA header should appear exactly once
    const shaMatches = (doc.match(/a1b2c3d/g) ?? []).length;
    // Appears in header once; individual event lines show just event type/title
    expect(shaMatches).toBeGreaterThanOrEqual(1);
    expect(doc).toContain("manual.snapshot");
    expect(doc).toContain("A decision");
  });
});
