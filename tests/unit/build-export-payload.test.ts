/**
 * Unit tests: buildExportPayload (export-replan P2, R-11, R-12, R-13, INV-12).
 *
 * Asserts:
 *   - Empty context → minimal valid payload v2.
 *   - Context with decisions/errors/agentQuestions → all bucketed correctly.
 *   - Body sanitization runs (script stripped) on event bodies.
 *   - 5 MB cap triggers oversize flag.
 *   - All 16 top-level fields present (R-13).
 */

import { describe, it, expect } from "vitest";
import {
  buildExportPayload,
  PAYLOAD_CAP_BYTES_FOR_TESTS,
} from "../../src/generate/build-export-payload.js";
import type { RenderContext, RenderEvent } from "../../src/generate/render-context.js";
import type { ProjectPaths } from "../../src/core/paths.js";

function mkPaths(): ProjectPaths {
  return {
    root: "/tmp/fixture-project",
    logbookDir: "/tmp/fixture-project/.logbook",
    manifestPath: "/tmp/fixture-project/.logbook/install-manifest.json",
    configPath: "/tmp/fixture-project/.logbook/config.json",
    providersPath: "/tmp/fixture-project/.logbook/providers.json",
    statePath: "/tmp/fixture-project/.logbook/state.json",
    indexDbPath: "/tmp/fixture-project/.logbook/index.sqlite",
    backupsDir: "/tmp/fixture-project/.logbook/backups",
    dataDir: "/tmp/fixture-project/logbook",
    evidenceDir: "/tmp/fixture-project/logbook/evidence",
    eventsJsonl: "/tmp/fixture-project/logbook/evidence/events.jsonl",
  };
}

function mkCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    latestSessionId: "",
    sessions: [],
    phases: [],
    decisions: [],
    errors: [],
    fixes: [],
    lessons: [],
    resources: [],
    visuals: [],
    milestones: [],
    conversation: [],
    langfuseTraces: [],
    ghAgentRuns: [],
    skillInvocations: [],
    visualDirections: [],
    qaFindings: [],
    agentQuestions: [],
    all: [],
    ...overrides,
  };
}

describe("buildExportPayload", () => {
  it("produces a minimal valid payload v2 for empty context", async () => {
    const { payload, oversize, sidecar } = await buildExportPayload(
      mkCtx(),
      mkPaths(),
      { exportedAt: "2026-05-23T12:00:00.000Z", gitSha: "deadbeef" },
    );

    expect(payload.version).toBe(2);
    expect(payload.exportedAt).toBe("2026-05-23T12:00:00.000Z");
    expect(payload.project).toEqual({
      name: "fixture-project",
      root: "/tmp/fixture-project",
      sha: "deadbeef",
    });
    expect(payload.chapters).toEqual([]);
    expect(payload.course.sessions).toEqual([]);
    expect(payload.course.totals.sessions).toBe(0);
    expect(payload.bodies).toEqual({});
    expect(payload.mermaid).toEqual({});
    expect(oversize).toBe(false);
    expect(sidecar).toBe(null);
  });

  it("includes all 16 top-level fields per R-13", async () => {
    const { payload } = await buildExportPayload(mkCtx(), mkPaths());
    const requiredKeys = [
      "version",
      "exportedAt",
      "project",
      "course",
      "chapters",
      "decisions",
      "errors",
      "fixes",
      "lessons",
      "milestones",
      "resources",
      "visuals",
      "visualDirections",
      "skillInvocations",
      "ghAgentRuns",
      "qaFindings",
      "agentQuestions",
      "commits",
      "bodies",
      "mermaid",
    ];
    for (const k of requiredKeys) {
      expect(payload).toHaveProperty(k);
    }
  });

  it("buckets decisions, errors, and agentQuestions correctly", async () => {
    const session: RenderEvent = {
      id: "sess-1",
      type: "manual.session_start",
      ts: "2026-05-23T10:00:00.000Z",
      title: "Demo session",
      sessionId: "sess-1",
    };
    const decision: RenderEvent = {
      id: "evt-d1",
      type: "manual.decision",
      ts: "2026-05-23T10:05:00.000Z",
      title: "Pick framework",
      sessionId: "sess-1",
    };
    const error: RenderEvent = {
      id: "evt-e1",
      type: "manual.error",
      ts: "2026-05-23T10:06:00.000Z",
      title: "Build failure",
      sessionId: "sess-1",
    };
    const agentQuestion: RenderEvent = {
      id: "evt-aq1",
      type: "agent_question",
      ts: "2026-05-23T10:07:00.000Z",
      sessionId: "sess-1",
      question: "Pick a color",
      chosen: "Blue",
      multiSelect: false,
      options: [],
      header: "Color",
      askedAt: "2026-05-23T10:07:00.000Z",
      toolUseId: "tu_1",
      questionIndex: 0,
    };

    const all = [session, decision, error, agentQuestion];
    const ctx = mkCtx({
      sessions: [session],
      decisions: [decision],
      errors: [error],
      agentQuestions: [agentQuestion],
      all,
    });

    const { payload } = await buildExportPayload(ctx, mkPaths());
    expect(payload.decisions).toHaveLength(1);
    expect(payload.errors).toHaveLength(1);
    expect(payload.agentQuestions).toHaveLength(1);
    expect(payload.chapters).toHaveLength(1);
    expect(payload.chapters[0]!.sessionId).toBe("sess-1");
    // events bucketed under the chapter by sessionId
    expect(payload.chapters[0]!.events.map((e) => e.id)).toEqual([
      "sess-1",
      "evt-d1",
      "evt-e1",
      "evt-aq1",
    ]);
    expect(payload.course.totals.decisions).toBe(1);
    expect(payload.course.totals.errors).toBe(1);
    expect(payload.course.totals.agentQuestions).toBe(1);
  });

  it("sanitizes event bodies (script stripped, inner HTML only)", async () => {
    const decision: RenderEvent = {
      id: "evt-d1",
      type: "manual.decision",
      ts: "2026-05-23T10:05:00.000Z",
      title: "x",
      sessionId: "sess-1",
      body: "# Heading\n\n<script>alert(1)</script>\n\nSafe paragraph.",
    };
    const ctx = mkCtx({
      decisions: [decision],
      all: [decision],
    });
    const { payload } = await buildExportPayload(ctx, mkPaths());
    const body = payload.bodies["evt-d1"];
    expect(body).toBeDefined();
    expect(body).not.toContain("<script");
    expect(body).not.toContain("alert");
    expect(body).toContain("Safe paragraph");
    expect(body).not.toContain("<html");
  });

  it("populates commitUrl per commit when remoteUrl is a known host (R-60 / ADR-SC-C1)", async () => {
    const commitGh: RenderEvent = {
      id: "evt-c1",
      type: "commit",
      ts: "2026-05-23T11:00:00.000Z",
      sessionId: "sess-1",
      title: "fix(x): y",
      payload: { sha: "abcdef1234567890abcdef1234567890abcdef12" },
    };
    const ctx = mkCtx({ all: [commitGh] });
    const { payload } = await buildExportPayload(ctx, mkPaths(), {
      remoteUrl: "git@github.com:joseluisalmendral/LogBook.git",
    });
    expect(payload.commits).toHaveLength(1);
    const p0 = payload.commits[0]!.payload as Record<string, unknown>;
    expect(p0["commitUrl"]).toBe(
      "https://github.com/joseluisalmendral/LogBook/commit/abcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("leaves commitUrl undefined when no remoteUrl is provided (R-60 graceful)", async () => {
    const commit: RenderEvent = {
      id: "evt-c2",
      type: "commit",
      ts: "2026-05-23T11:00:00.000Z",
      sessionId: "sess-1",
      title: "feat: y",
      payload: { sha: "abcdef1" },
    };
    const ctx = mkCtx({ all: [commit] });
    const { payload } = await buildExportPayload(ctx, mkPaths());
    const p0 = payload.commits[0]!.payload as Record<string, unknown>;
    expect(p0["commitUrl"]).toBeUndefined();
  });

  it("omits payload.transcripts when noTranscripts is true (slice-12 P4 budget gate)", async () => {
    const session: RenderEvent = {
      id: "sess-1",
      type: "manual.session_start",
      ts: "2026-05-23T10:00:00.000Z",
      title: "Demo",
      sessionId: "sess-1",
    };
    const ctx = mkCtx({ sessions: [session as unknown as RenderContext["sessions"][number]] });
    const { payload } = await buildExportPayload(ctx, mkPaths(), {
      noTranscripts: true,
    });
    expect(payload.transcripts).toBeUndefined();
  });

  it("populates payload.transcripts with null for sessions whose JSONL is missing (ADR-SC-D2)", async () => {
    // mkPaths() points at /tmp/fixture-project which has no encoded directory
    // under ~/.claude/projects/, so every session should resolve to null
    // without throwing.
    const session: RenderEvent = {
      id: "sess-missing",
      type: "manual.session_start",
      ts: "2026-05-23T10:00:00.000Z",
      title: "Missing on this machine",
      sessionId: "sess-missing",
    };
    const ctx = mkCtx({ sessions: [session as unknown as RenderContext["sessions"][number]] });
    const { payload } = await buildExportPayload(ctx, mkPaths());
    expect(payload.transcripts).toBeDefined();
    expect(payload.transcripts!["sess-missing"]).toBeNull();
  });

  it("flags oversize when serialized payload exceeds the 5 MB cap (INV-12)", async () => {
    // Build a single event with a body large enough to push the payload past 5 MB.
    const huge = "x".repeat(PAYLOAD_CAP_BYTES_FOR_TESTS + 1024);
    const evt: RenderEvent = {
      id: "evt-big",
      type: "manual.lesson",
      ts: "2026-05-23T10:05:00.000Z",
      title: "huge",
      sessionId: "sess-1",
      body: huge,
    };
    const ctx = mkCtx({
      lessons: [evt],
      all: [evt],
    });
    const { oversize, sidecar } = await buildExportPayload(ctx, mkPaths());
    expect(oversize).toBe(true);
    // P2 stub — sidecar contents are wired in P5.
    expect(sidecar).toBe(null);
  });
});
