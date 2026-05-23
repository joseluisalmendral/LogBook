/**
 * build-export-payload.ts — Payload v2 builder for the new export UI (export-replan P2).
 *
 * Co-located with `render-context.ts` but in its own file (the design's ADR-3
 * proposed inlining inside render-context, but apply-progress P1 noted the
 * structural-refinement pattern of one-concern-per-file; we follow that).
 *
 * The output is the JSON contract that `apps/export-ui/` consumes at runtime.
 * It is a PURE transform of the RenderContext — no side effects, no writes to
 * `events.jsonl`, no hook semantics changes (INV-1 PASSIVE).
 *
 * Spec references: R-11, R-12, R-13, R-14, R-15, INV-12.
 */

import type { ProjectPaths } from "../core/paths.js";
import type { RenderContext, RenderEvent } from "./render-context.js";
import { renderEventBody } from "./markdown-body.js";

// ---------------------------------------------------------------------------
// Payload v2 types (design §5.1 — co-located with the builder)
// ---------------------------------------------------------------------------

/**
 * Lightweight session summary used for the course-level TOC at the top of
 * payload v2 (design §"Data Architecture"). Avoids carrying every event in
 * `course.sessions` — events live under `chapters[i].events`.
 */
export interface SessionSummary {
  id: string;
  label: string;
  ts: string;
  endTs?: string;
  goal?: string;
  outcome?: string;
}

/** Course-level totals derived at build time for KPI cards in the export. */
export interface CourseTotals {
  sessions: number;
  decisions: number;
  errors: number;
  fixes: number;
  lessons: number;
  milestones: number;
  resources: number;
  visuals: number;
  visualDirections: number;
  skillInvocations: number;
  ghAgentRuns: number;
  qaFindings: number;
  agentQuestions: number;
  commits: number;
}

/**
 * Per-phase reference inside a chapter (design §2 / R-16 PhaseAct component).
 * Phases are the W1/W2/W3 dividers; the chapter `events` array stays the
 * source of truth and PhaseRef just records the boundary `eventId`s.
 */
export interface PhaseRef {
  id: string;
  label: string;
  ts: string;
  startEventId?: string;
  endEventId?: string;
}

/**
 * A "chapter" in the editorial-replay metaphor corresponds to one session.
 * Events are the original RenderEvents from the bucket — the UI renders them
 * via `<TurnRow>` and looks up bodies in the top-level `bodies` map.
 */
export interface Chapter {
  sessionId: string;
  label: string;
  ts: string;
  endTs?: string;
  goal?: string;
  outcome?: string;
  phases: PhaseRef[];
  events: RenderEvent[];
}

/**
 * Payload v2 — the single JSON contract injected into the export HTML via
 * `<script id="lb-data" type="application/json">…</script>`.
 *
 * `version: 2` is locked (R-12). Future evolutions either bump to 3 OR remain
 * additive (the project's invariant per CLAUDE.md).
 */
export interface ExportPayloadV2 {
  version: 2;
  exportedAt: string;
  project: { name: string; root: string; sha: string };
  course: { sessions: SessionSummary[]; totals: CourseTotals };
  chapters: Chapter[];
  decisions: RenderEvent[];
  errors: RenderEvent[];
  fixes: RenderEvent[];
  lessons: RenderEvent[];
  milestones: RenderEvent[];
  resources: RenderEvent[];
  visuals: RenderEvent[];
  visualDirections: RenderEvent[];
  skillInvocations: RenderEvent[];
  ghAgentRuns: RenderEvent[];
  qaFindings: RenderEvent[];
  agentQuestions: RenderEvent[];
  commits: RenderEvent[];
  /** Pre-sanitized HTML keyed by event id. UI renders via `{@html bodies[id]}`. */
  bodies: Record<string, string>;
  /** Pre-rendered mermaid SVG keyed by diagram id. STUB in P2 — P5 wires it. */
  mermaid: Record<string, string>;
}

/**
 * Sidecar fallback envelope returned alongside an over-cap payload (R-14, INV-12).
 *
 * In P2 the sidecar contents themselves are a STUB (null) — P5 wires the
 * actual JSONL write next to the HTML output. Surfacing the flag here lets
 * downstream tests assert the cap-detection logic without depending on the
 * write path.
 */
export interface BuildExportPayloadResult {
  payload: ExportPayloadV2;
  /** True when the serialized payload exceeded the 5 MB cap. */
  oversize: boolean;
  /** STUB in P2. P5 will populate this with the JSONL string. */
  sidecar: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** R-14 / INV-12 — inline payload cap. Above this, the export emits a sidecar. */
const PAYLOAD_CAP_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Best-effort body extraction. Different event shapes use different keys. */
function extractBodyMarkdown(event: RenderEvent): string {
  // Try common fields in order of specificity.
  for (const key of ["body", "description", "text", "content"]) {
    const v = (event as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

/** Group conversation events by sessionId for chapter assembly. */
function groupEventsBySession(
  events: RenderEvent[] | undefined,
): Map<string, RenderEvent[]> {
  const groups = new Map<string, RenderEvent[]>();
  if (!events) return groups;
  for (const e of events) {
    const sid =
      typeof (e as Record<string, unknown>)["sessionId"] === "string"
        ? ((e as Record<string, unknown>)["sessionId"] as string)
        : "";
    if (!sid) continue;
    const arr = groups.get(sid) ?? [];
    arr.push(e);
    groups.set(sid, arr);
  }
  return groups;
}

/**
 * Find the project name from `paths.root`. Falls back to "project" when the
 * directory name cannot be derived (e.g. root is "/" — unusual but tolerated).
 */
function projectNameFrom(root: string): string {
  const parts = root.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "project";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build payload v2 from a RenderContext.
 *
 * Pure async function (the only async work is the markdown→html sanitization
 * pass per body). Does not write to disk; does not mutate `ctx`.
 *
 * @param ctx    Already-read RenderContext (from `readContext(paths)`).
 * @param paths  Project paths — used to record `project.root` + name.
 * @param opts   Optional overrides (test injection of `exportedAt` / `gitSha`).
 */
export async function buildExportPayload(
  ctx: RenderContext,
  paths: ProjectPaths,
  opts: { exportedAt?: string; gitSha?: string } = {},
): Promise<BuildExportPayloadResult> {
  // --- Sessions / chapters -------------------------------------------------
  const sessions = ctx.sessions;
  const eventsBySession = groupEventsBySession(ctx.all);

  const sessionSummaries: SessionSummary[] = sessions.map((s) => {
    const id = typeof s["id"] === "string" ? (s["id"] as string) : "";
    const labelRaw =
      typeof s["title"] === "string"
        ? (s["title"] as string)
        : typeof s["label"] === "string"
        ? (s["label"] as string)
        : "";
    const summary: SessionSummary = {
      id,
      label: labelRaw || id || "session",
      ts: s.ts,
    };
    if (typeof s["endTs"] === "string") summary.endTs = s["endTs"] as string;
    if (typeof s["goal"] === "string") summary.goal = s["goal"] as string;
    if (typeof s["outcome"] === "string") summary.outcome = s["outcome"] as string;
    return summary;
  });

  const chapters: Chapter[] = sessions.map((s) => {
    const id = typeof s["id"] === "string" ? (s["id"] as string) : "";
    const labelRaw =
      typeof s["title"] === "string"
        ? (s["title"] as string)
        : typeof s["label"] === "string"
        ? (s["label"] as string)
        : "";
    const chapterEvents = eventsBySession.get(id) ?? [];

    // Phase boundaries (best-effort — phases are filtered into ctx.phases, we
    // pick the ones whose sessionId matches this chapter).
    const phaseEvents = (ctx.phases ?? []).filter((p) => {
      const psid =
        typeof (p as Record<string, unknown>)["sessionId"] === "string"
          ? ((p as Record<string, unknown>)["sessionId"] as string)
          : "";
      return psid === id;
    });
    const phases: PhaseRef[] = phaseEvents.map((p) => {
      const pid = typeof p["id"] === "string" ? (p["id"] as string) : "";
      const plabel =
        typeof p["title"] === "string"
          ? (p["title"] as string)
          : typeof p["label"] === "string"
          ? (p["label"] as string)
          : pid;
      return { id: pid, label: plabel, ts: p.ts };
    });

    const chapter: Chapter = {
      sessionId: id,
      label: labelRaw || id || "session",
      ts: s.ts,
      phases,
      events: chapterEvents,
    };
    if (typeof s["endTs"] === "string") chapter.endTs = s["endTs"] as string;
    if (typeof s["goal"] === "string") chapter.goal = s["goal"] as string;
    if (typeof s["outcome"] === "string") chapter.outcome = s["outcome"] as string;
    return chapter;
  });

  // --- Bodies (sanitized HTML per event) -----------------------------------
  // We render every event that carries a Markdown body. Pre-rendering is an
  // explicit design choice (R-11 + design §5.2) — the runtime UI never
  // re-parses Markdown, eliminating an entire XSS surface.
  const bodies: Record<string, string> = {};
  for (const event of ctx.all ?? []) {
    const eid = typeof event["id"] === "string" ? (event["id"] as string) : "";
    if (!eid) continue;
    const raw = extractBodyMarkdown(event);
    if (!raw) continue;
    try {
      bodies[eid] = await renderEventBody(raw);
    } catch {
      // Render failures degrade silently — the UI shows a blank body rather
      // than crashing the whole export. P5 may surface a banner.
      bodies[eid] = "";
    }
  }

  // --- Mermaid (STUB in P2 — P5 wires the SVG pre-render pipeline) ----------
  // TODO(export-replan P5): extract mermaid blocks from event bodies via
  // `src/export/mermaid.ts` (which is dirty in the working tree until the old
  // shell is gutted) and populate this map keyed by a stable diagramId.
  const mermaid: Record<string, string> = {};

  // --- Buckets (default to empty arrays for the optional context fields) ----
  const decisions = ctx.decisions ?? [];
  const errors = ctx.errors ?? [];
  const fixes = ctx.fixes ?? [];
  const lessons = ctx.lessons ?? [];
  const milestones = ctx.milestones ?? [];
  const resources = ctx.resources ?? [];
  const visuals = ctx.visuals ?? [];
  const visualDirections = ctx.visualDirections ?? [];
  const skillInvocations = ctx.skillInvocations ?? [];
  const ghAgentRuns = ctx.ghAgentRuns ?? [];
  const qaFindings = ctx.qaFindings ?? [];
  const agentQuestions = ctx.agentQuestions ?? [];
  // Commits live in their own bucket per R-13. Until the upstream
  // commit-ingestion pipeline lands an explicit ctx.commits field, we lift
  // them from `ctx.all` by type prefix.
  const commits = (ctx.all ?? []).filter(
    (e) => e.type === "commit" || e.type === "manual.commit",
  );

  const totals: CourseTotals = {
    sessions: sessions.length,
    decisions: decisions.length,
    errors: errors.length,
    fixes: fixes.length,
    lessons: lessons.length,
    milestones: milestones.length,
    resources: resources.length,
    visuals: visuals.length,
    visualDirections: visualDirections.length,
    skillInvocations: skillInvocations.length,
    ghAgentRuns: ghAgentRuns.length,
    qaFindings: qaFindings.length,
    agentQuestions: agentQuestions.length,
    commits: commits.length,
  };

  const payload: ExportPayloadV2 = {
    version: 2,
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    project: {
      name: projectNameFrom(paths.root),
      root: paths.root,
      sha: opts.gitSha ?? "",
    },
    course: { sessions: sessionSummaries, totals },
    chapters,
    decisions,
    errors,
    fixes,
    lessons,
    milestones,
    resources,
    visuals,
    visualDirections,
    skillInvocations,
    ghAgentRuns,
    qaFindings,
    agentQuestions,
    commits,
    bodies,
    mermaid,
  };

  // --- 5 MB cap detection (R-14 / INV-12 / S-12) ---------------------------
  // Serialize once and inspect the byte length. We do NOT trim or strip
  // anything on overflow — the spec mandates a sibling JSONL file written by
  // the CLI; the cap-detection path just hands the caller a flag.
  const serialized = JSON.stringify(payload);
  const oversize = Buffer.byteLength(serialized, "utf8") > PAYLOAD_CAP_BYTES;

  // STUB: P5 will produce the JSONL string from `ctx.all`. For P2 we surface
  // the flag and leave the sidecar field null so callers know they need to
  // emit a sidecar but no contents are precomputed yet.
  const sidecar: string | null = null;

  return { payload, oversize, sidecar };
}

/** Exposed for unit tests to assert the cap-detection threshold. */
export const PAYLOAD_CAP_BYTES_FOR_TESTS = PAYLOAD_CAP_BYTES;
