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

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProjectPaths } from "../core/paths.js";
import type { RenderContext, RenderEvent } from "./render-context.js";
import { renderEventBody } from "./markdown-body.js";
import { buildCommitLink } from "../connectors/git.js";
import {
  sanitizeTranscriptSession,
  type SanitizedTranscript,
} from "../export/transcript-sanitize.js";

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
  /**
   * Slice-14 Bucket E (seed obs #287 item 5): list of files touched during
   * this chapter, derived from tool_result events for Edit/Write/MultiEdit/Read
   * tool invocations. Build-derived (PASSIVE per INV-1) — no capture changes.
   * Deduped by path; when the same path is touched by multiple actions, the
   * "strongest" wins (write > edit > multi_edit > read).
   */
  filesTouched?: FileTouch[];
}

/**
 * Single file-touch record. `action` indicates the operation strength so the
 * UI can pick an icon and the dedupe step can prefer the strongest signal.
 *
 * Slice-15: `create` is upgraded from `write` when a tool_result.write event
 * is the FIRST mention of a path in chronological order (the file was created
 * during this chapter, not overwritten). Strength order:
 *   create > write > edit > multi_edit > read
 */
export interface FileTouch {
  path: string;
  action: "create" | "write" | "edit" | "multi_edit" | "read";
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
  /**
   * Sanitized raw transcripts keyed by sessionId (slice 12 P4, ADR-SC-D2).
   *
   * `null` indicates the JSONL file exists in payload's session list but the
   * transcript could not be read (missing file, parse failure, machine that
   * never ran the session). The UI must fall back to "Transcript unavailable"
   * for those sessions.
   *
   * Field is optional so older payload consumers (and the budget-gate
   * `--no-transcripts` path) can skip it without a schema break.
   */
  transcripts?: Record<string, SanitizedTranscript | null>;
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

/**
 * Encode a project root path the same way Claude Code does when persisting
 * per-project JSONL transcripts under `~/.claude/projects/<encoded>/`.
 *
 * Convention (verified against the live `~/.claude/projects` directory on a
 * machine that has run Claude Code against this repo):
 *   - Forward slashes (`/`) → `-`
 *   - Spaces             → `-`
 *   - Dots (`.`)         → `-`  (so `joseluis.fernandez` becomes
 *                                 `joseluis-fernandez` in the encoded path)
 *
 * Anything else (alphanumerics, underscores, hyphens) is preserved verbatim.
 * The leading absolute slash becomes a single leading dash.
 *
 * NOTE: the original P4 spec text suggested spaces would be preserved as-is.
 * On the developer's machine the actual directory is
 *   `-Users-joseluis-fernandez-Documents-CONSTRUCCION-FORMACION-IA-B2B-LogBook-repo`
 * — confirming dots, slashes, and spaces ALL collapse to `-`. We follow the
 * observed convention; if a future Claude Code version changes the encoding,
 * this is the single point to update.
 */
function encodeProjectPath(root: string): string {
  return root.replace(/[/\s.]/g, "-");
}

/**
 * Read a session's raw JSONL transcript from Claude Code's per-project
 * directory and run it through `sanitizeTranscriptSession`.
 *
 * Returns `null` (NEVER throws) when the file is missing or the parse fails.
 * Callers treat null as "transcript unavailable" and continue.
 *
 * PASSIVE per INV-1: we only READ files that Claude Code already wrote. No
 * capture-pipeline change, no hook side-effects.
 */
async function loadSanitizedTranscript(
  sessionId: string,
  projectRoot: string,
): Promise<SanitizedTranscript | null> {
  if (!sessionId) return null;
  try {
    const encoded = encodeProjectPath(projectRoot);
    const filePath = join(homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
    const raw = await readFile(filePath, "utf8");
    const lines = raw.split("\n");
    const events: unknown[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {
        // Skip individual malformed lines — don't poison the whole session.
      }
    }
    if (events.length === 0) return null;
    return sanitizeTranscriptSession(events, sessionId);
  } catch {
    return null;
  }
}

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

/**
 * Slice-14 Bucket E: extract a file-touch from a tool_result event when the
 * tool wrote/edited/read a file. Returns null for events that don't touch a
 * file (Bash, WebFetch, MCP tools, etc.). Build-derived from the event shape
 * persisted by the PostToolUse hook — see src/normalize/event.ts.
 *
 * Action mapping (lowercased tool_name → action):
 *   - write       → write
 *   - edit        → edit
 *   - multiedit   → multi_edit
 *   - read        → read
 * Anything else returns null.
 */
function extractFileTouch(event: RenderEvent): FileTouch | null {
  if (typeof event.type !== "string" || !event.type.startsWith("tool_result.")) {
    return null;
  }
  const toolName = (
    typeof (event as Record<string, unknown>)["tool_name"] === "string"
      ? ((event as Record<string, unknown>)["tool_name"] as string)
      : ""
  ).toLowerCase();
  const map: Record<string, FileTouch["action"]> = {
    write: "write",
    edit: "edit",
    multiedit: "multi_edit",
    read: "read",
  };
  const action = map[toolName];
  if (action === undefined) return null;
  const raw = (event as Record<string, unknown>)["raw"] as
    | Record<string, unknown>
    | undefined;
  const toolInput = raw?.["tool_input"] as Record<string, unknown> | undefined;
  const path = toolInput?.["file_path"];
  if (typeof path !== "string" || path.length === 0) return null;
  return { path, action };
}

/**
 * Slice-14 Bucket E + slice-15 create detection: aggregate a list of FileTouch
 * from a chronologically-sorted list of events, deduping by path and keeping
 * the strongest action seen for each path. Strength order:
 *   create > write > edit > multi_edit > read
 *
 * The first tool_result.write event for a previously-unseen path is upgraded
 * from `write` to `create`. This relies on the caller passing events in
 * timestamp ascending order (which render-context guarantees via sortByTs).
 */
const ACTION_STRENGTH: Record<FileTouch["action"], number> = {
  create: 5,
  write: 4,
  edit: 3,
  multi_edit: 2,
  read: 1,
};

function aggregateFileTouches(events: RenderEvent[]): FileTouch[] {
  const seenPaths = new Set<string>();
  const byPath = new Map<string, FileTouch>();
  for (const ev of events) {
    const touch = extractFileTouch(ev);
    if (!touch) continue;
    // First Write on a previously-unseen path = creation, not overwrite.
    if (touch.action === "write" && !seenPaths.has(touch.path)) {
      touch.action = "create";
    }
    seenPaths.add(touch.path);
    const existing = byPath.get(touch.path);
    if (!existing || ACTION_STRENGTH[touch.action] > ACTION_STRENGTH[existing.action]) {
      byPath.set(touch.path, touch);
    }
  }
  // Stable sort: alphabetical by path. Keeps UI rendering deterministic.
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Slice-15 SubAgentCard rendering fix: build the per-tool entry that
 * SubAgentCard.svelte reads off `payload.tools`. Picks the most useful "input"
 * summary string per tool kind so the UI can render something meaningful.
 *
 * Returns null for events that aren't tool_result.* (the conversation bucket
 * also carries claude_message + user_prompt + skill_invoked etc.).
 */
function summarizeToolForSubagent(
  event: RenderEvent,
): { name: string; input: string } | null {
  if (typeof event.type !== "string" || !event.type.startsWith("tool_result.")) {
    return null;
  }
  const rec = event as Record<string, unknown>;
  const toolName =
    typeof rec["tool_name"] === "string"
      ? (rec["tool_name"] as string)
      : "tool";
  const raw = rec["raw"] as Record<string, unknown> | undefined;
  const ti = raw?.["tool_input"] as Record<string, unknown> | undefined;
  // Pick the most identifying field per tool kind. Falls back to a JSON
  // summary capped at 80 chars so the UI never renders a wall of text.
  const candidate =
    ti?.["file_path"] ??
    ti?.["command"] ??
    ti?.["pattern"] ??
    ti?.["url"] ??
    ti?.["query"] ??
    ti?.["prompt"];
  let input: string;
  if (typeof candidate === "string") {
    input = candidate.length > 80 ? `${candidate.slice(0, 77)}...` : candidate;
  } else if (ti !== undefined) {
    const json = JSON.stringify(ti);
    input = json.length > 80 ? `${json.slice(0, 77)}...` : json;
  } else {
    input = "";
  }
  return { name: toolName, input };
}

/**
 * Slice-15 SubAgentCard rendering fix: extract the skill name from a
 * `skill_invoked` event (synthesized by transcript.ts when a Read on
 * `.claude/skills/{glob}/SKILL.md` happens).
 */
function extractSkillName(event: RenderEvent): string | null {
  if (event.type !== "skill_invoked") return null;
  const rec = event as Record<string, unknown>;
  const name = rec["skillName"];
  return typeof name === "string" && name.length > 0 ? name : null;
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
  opts: {
    exportedAt?: string;
    gitSha?: string;
    remoteUrl?: string;
    /**
     * When true, skip the raw-transcript embed entirely. Driven by the
     * `--no-transcripts` CLI flag and the `LOGBOOK_EXPORT_NO_TRANSCRIPTS=1`
     * env var (see budget gate in src/export/html.ts).
     */
    noTranscripts?: boolean;
  } = {},
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

    // Slice-14 Bucket E + slice-15 SubAgentCard rendering fix:
    //
    // The render-context normalize step flattens `event.payload` into the
    // top-level of each event, which means downstream UI components that read
    // `event.payload.X` see undefined on real data (the slice-12 dev-payload
    // works only because it hand-crafts events with nested payload). We
    // re-nest the payload here, restoring the fields SubAgentCard needs.
    //
    // What we bring back / synthesize:
    //   - agentId / toolCallCount / durationMs / attributionAgent: from top-level (post-flatten)
    //   - agent: human-readable display name (attributionAgent ?? agentId)
    //   - filesTouched: aggregated from child tool_result.{edit,write,multiedit,read}
    //   - tools: synthesized list of { name, input } from child tool_result events
    //   - skillsLoaded: skill names from child skill_invoked events
    //
    // Correlation is via `meta.subagentId === payload.agentId`, set by the
    // transcript scraper. PASSIVE per INV-1 — no capture-pipeline changes.
    const enrichedEvents = chapterEvents.map((ev) => {
      if (ev.type !== "subagent_complete") return ev;
      const topLevel = ev as Record<string, unknown>;
      const agentId =
        typeof topLevel["agentId"] === "string"
          ? (topLevel["agentId"] as string)
          : "";
      if (!agentId) return ev;
      // Correlation: sub-agent children carry the sub-agent id in TWO places
      // depending on which writer produced them.
      //   (a) Events synthesized by the transcript scraper (claude_message,
      //       synthesized tool_use, skill_invoked) → `meta.subagentId`.
      //   (b) Events written by the PostToolUse hook (tool_result.*) →
      //       `raw.agent_id` (Claude Code's own payload field).
      // Most of the slice-14/15 file-touch + tool aggregation comes from (b),
      // so missing this path produced empty arrays on real data. Match both.
      const children = chapterEvents.filter((c) => {
        const rec = c as Record<string, unknown>;
        const meta = rec["meta"] as Record<string, unknown> | undefined;
        if (meta?.["subagentId"] === agentId) return true;
        const raw = rec["raw"] as Record<string, unknown> | undefined;
        if (raw?.["agent_id"] === agentId) return true;
        return false;
      });
      const filesTouched = aggregateFileTouches(children);
      // Aggregate tools — every tool_result with the matching subagentId
      // contributes one entry. Order preserved (chronological — render-context
      // sorts ascending), so the UI reads the same order the sub-agent ran.
      const tools = children
        .map(summarizeToolForSubagent)
        .filter((t): t is { name: string; input: string } => t !== null);
      // Aggregate skillsLoaded — skill_invoked events synthesized by the
      // transcript scraper when a sub-agent Reads a SKILL.md. Deduped.
      const skillsLoaded = [
        ...new Set(
          children
            .map(extractSkillName)
            .filter((s): s is string => s !== null),
        ),
      ];

      const existingPayload = (
        topLevel["payload"] as Record<string, unknown> | undefined
      ) ?? {};
      const reNestedPayload: Record<string, unknown> = {
        ...existingPayload,
      };
      for (const key of [
        "agentId",
        "toolCallCount",
        "durationMs",
        "attributionAgent",
      ]) {
        if (topLevel[key] !== undefined && reNestedPayload[key] === undefined) {
          reNestedPayload[key] = topLevel[key];
        }
      }
      // Display name: prefer attributionAgent (semantic — e.g. "sdd-apply"),
      // fall back to the agentId. The UI's SubAgentCard reads `payload.agent`.
      if (reNestedPayload["agent"] === undefined) {
        const display =
          typeof topLevel["attributionAgent"] === "string"
            ? (topLevel["attributionAgent"] as string)
            : agentId;
        reNestedPayload["agent"] = display;
      }
      reNestedPayload["filesTouched"] = filesTouched;
      // Only attach tools/skillsLoaded when synthesis produced something.
      // Empty arrays still write so the SubAgentCard renders a stable shape.
      reNestedPayload["tools"] = tools;
      reNestedPayload["skillsLoaded"] = skillsLoaded;
      return {
        ...ev,
        payload: reNestedPayload,
        filesTouched,
      } as RenderEvent;
    });

    const chapter: Chapter = {
      sessionId: id,
      label: labelRaw || id || "session",
      ts: s.ts,
      phases,
      events: enrichedEvents,
      filesTouched: aggregateFileTouches(enrichedEvents),
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
  //
  // R-60 / ADR-SC-C1 — populate `payload.commitUrl` per commit using the
  // shared `buildCommitLink(remoteUrl, sha)` helper. The remoteUrl is threaded
  // in from `src/generate/index.ts` (single `git remote get-url origin` per
  // build). Unknown hosts / missing remote → leave `commitUrl` undefined; the
  // UI's `<CommitRow>` renders plain `<code>` in that case.
  const rawCommits = (ctx.all ?? []).filter(
    (e) => e.type === "commit" || e.type === "manual.commit",
  );
  const commits: RenderEvent[] = rawCommits.map((e) => {
    const payloadRecord = (e.payload ?? {}) as Record<string, unknown>;
    const sha =
      typeof payloadRecord["sha"] === "string"
        ? (payloadRecord["sha"] as string)
        : "";
    if (!sha) return e;
    const url = buildCommitLink(opts.remoteUrl, sha);
    if (!url) return e;
    return {
      ...e,
      payload: { ...payloadRecord, commitUrl: url },
    };
  });

  // --- Raw transcripts (slice 12 P4, ADR-SC-D2, R-66) ----------------------
  // PASSIVE per INV-1 — we read the JSONL files Claude Code already wrote at
  // `~/.claude/projects/<encoded>/<sessionId>.jsonl`. Missing files (e.g. the
  // session ran on a different machine, or this is a fresh checkout) produce
  // a null entry; the UI's P5 transcript route shows "unavailable" for those.
  //
  // The whole step is wrapped in try/catch at the per-session level so one
  // broken transcript never fails the entire export.
  let transcripts: Record<string, SanitizedTranscript | null> | undefined;
  if (!opts.noTranscripts && sessions.length > 0) {
    transcripts = {};
    await Promise.all(
      sessions.map(async (s) => {
        const sid = typeof s["id"] === "string" ? (s["id"] as string) : "";
        if (!sid) return;
        const t = await loadSanitizedTranscript(sid, paths.root);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        transcripts![sid] = t;
      }),
    );
  }

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
    ...(transcripts !== undefined && { transcripts }),
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
