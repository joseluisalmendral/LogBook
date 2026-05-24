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
import { sanitizeForSafeExport } from "../export/safe.js";
import {
  sanitizeTranscriptSession,
  type SanitizedTranscript,
} from "../export/transcript-sanitize.js";
import { isNarrativeKind, isNoiseKind } from "../types/narrative-kinds.js";

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
  /**
   * Slice-21: true when the chapter contains one or more `user_prompt` events
   * but zero `claude_message` events — i.e. the transcript scraper did not
   * capture Claude's responses on the machine that produced this events.jsonl.
   * The UI renders a single inline notice at chapter start when set.
   */
  ghostTurns?: boolean;
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
 * Slice-16: minimal shape returned by `loadSubagentDetails`. All fields
 * optional so partial transcript files (e.g. only meta.json exists, or only
 * the JSONL) still produce a useful enrichment.
 */
interface SubagentDetails {
  /** From meta.json — the registered sub-agent name (e.g. "sdd-tasks"). */
  agentType?: string;
  /** From meta.json — Claude Code's short auto-generated description. */
  description?: string;
  /** From meta.json — the parent agent's Task tool_use_id (correlation key). */
  toolUseId?: string;
  /** First user message in the sub-agent JSONL — the full prompt given to the sub-agent. */
  fullPrompt?: string;
  /** Last assistant message text — the sub-agent's final response, joined across text blocks. */
  response?: string;
}

/**
 * Slice-16: pure parser for the sub-agent meta+JSONL pair. Extracted from
 * `loadSubagentDetails` so it can be unit-tested without fs / homedir setup.
 * Either argument may be `null` to signal "file missing".
 */
export function parseSubagentTranscript(
  metaText: string | null,
  jsonlText: string | null,
): SubagentDetails | null {
  const out: SubagentDetails = {};
  let any = false;

  if (metaText !== null) {
    try {
      const meta = JSON.parse(metaText) as Record<string, unknown>;
      if (typeof meta["agentType"] === "string") {
        out.agentType = meta["agentType"];
        any = true;
      }
      if (typeof meta["description"] === "string") {
        out.description = meta["description"];
        any = true;
      }
      if (typeof meta["toolUseId"] === "string") {
        out.toolUseId = meta["toolUseId"];
        any = true;
      }
    } catch {
      // Malformed meta.json — non-fatal.
    }
  }

  if (jsonlText !== null) {
    const lines = jsonlText.split("\n");
    let foundPrompt = false;
    let lastAssistantText: string | undefined;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(t);
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      const rec = parsed as Record<string, unknown>;
      const msg = rec["message"] as Record<string, unknown> | undefined;
      const role = msg?.["role"];
      const content = msg?.["content"];

      // First user message — that's the prompt the parent agent handed in.
      if (!foundPrompt && role === "user") {
        if (typeof content === "string" && content.length > 0) {
          out.fullPrompt = content;
          foundPrompt = true;
          any = true;
        } else if (Array.isArray(content)) {
          const parts: string[] = [];
          for (const block of content as Array<Record<string, unknown>>) {
            if (block && block["type"] === "text" && typeof block["text"] === "string") {
              parts.push(block["text"] as string);
            }
          }
          if (parts.length > 0) {
            out.fullPrompt = parts.join("\n\n");
            foundPrompt = true;
            any = true;
          }
        }
      }

      // Track every assistant message — keep the LAST one as the response.
      if (role === "assistant") {
        if (typeof content === "string") {
          lastAssistantText = content;
        } else if (Array.isArray(content)) {
          const parts: string[] = [];
          for (const block of content as Array<Record<string, unknown>>) {
            if (block && block["type"] === "text" && typeof block["text"] === "string") {
              parts.push(block["text"] as string);
            }
          }
          if (parts.length > 0) lastAssistantText = parts.join("\n\n");
        }
      }
    }
    if (lastAssistantText !== undefined && lastAssistantText.length > 0) {
      out.response = lastAssistantText;
      any = true;
    }
  }

  return any ? out : null;
}

/**
 * Slice-16 SubAgentCard rendering completion: read the sub-agent's transcript
 * files at `~/.claude/projects/<encoded>/<sessionId>/subagents/agent-<agentId>.{jsonl,meta.json}`
 * and extract the prompt + response via `parseSubagentTranscript`. PASSIVE
 * per INV-1 — we only read files Claude Code already wrote.
 *
 * Returns null when neither file exists. Never throws — best effort.
 *
 * Note on redaction: the sub-agent JSONL is Claude Code's own file, NOT the
 * LogBook-redacted events.jsonl. Prompts may contain user-authored secrets.
 * Slice 17 (--safe re-feature) will plumb redaction through this path.
 */
async function loadSubagentDetails(
  agentId: string,
  sessionId: string,
  projectRoot: string,
): Promise<SubagentDetails | null> {
  if (!agentId || !sessionId) return null;
  const encoded = encodeProjectPath(projectRoot);
  const baseDir = join(
    homedir(),
    ".claude",
    "projects",
    encoded,
    sessionId,
    "subagents",
  );
  const jsonlPath = join(baseDir, `agent-${agentId}.jsonl`);
  const metaPath = join(baseDir, `agent-${agentId}.meta.json`);

  let metaText: string | null;
  try {
    metaText = await readFile(metaPath, "utf8");
  } catch {
    metaText = null;
  }
  let jsonlText: string | null;
  try {
    jsonlText = await readFile(jsonlPath, "utf8");
  } catch {
    jsonlText = null;
  }
  return parseSubagentTranscript(metaText, jsonlText);
}

/** Slice-16: derive a short summary from a long prompt. Word-boundary safe. */
function deriveSummary(prompt: string | undefined, maxChars = 200): string | undefined {
  if (typeof prompt !== "string" || prompt.length === 0) return undefined;
  if (prompt.length <= maxChars) return prompt;
  // Trim to nearest space below the cap so we don't slice through a word.
  const slice = prompt.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxChars - 40 ? lastSpace : maxChars;
  return `${prompt.slice(0, cut).trimEnd()}...`;
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

/**
 * Slice-20: strip the heavy "raw" / "_raw" / "tool_response" fields off an
 * event before it lands in `chapter.events`. The UI doesn't render those
 * (they're the unredacted hook payload + transcript chunks), and on real
 * data they can blow the JSON payload past 100 MB. Anything the UI actually
 * reads — id, type, ts, title, description, payload, meta — is preserved.
 *
 * NOTE: this runs at chapter-assembly time, AFTER the slice-15/16 sub-agent
 * enrichment has copied the relevant raw subfields (file_path, agent_id)
 * up into payload. Stripping `raw` here doesn't lose those derived values.
 */
function slimEventForChapter(event: RenderEvent): RenderEvent {
  const rec = event as Record<string, unknown>;
  const slim: Record<string, unknown> = {};
  // Whitelist the fields the UI reads. Anything else (raw / _raw /
  // tool_args / tool_response / extra hook context) is dropped.
  const KEEP = [
    "id",
    "type",
    "ts",
    "timestamp",
    "title",
    "description",
    "body",
    "sessionId",
    "tool_name",
    "agentId",
    "toolCallCount",
    "durationMs",
    "attributionAgent",
    "skillName",
    "meta",
    "payload",
    "filesTouched",
    // Slice-21: narrative-filter fields. They live under `payload` (preserved
    // implicitly via the `payload` key above) but we list them defensively in
    // case any future code-path surfaces them at top-level.
    "toolStrip",
    "overflow",
    "ghostTurns",
  ];
  for (const k of KEEP) {
    if (rec[k] !== undefined) slim[k] = rec[k];
  }
  return slim as RenderEvent;
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
// Slice-21: narrative filter + toolStrip rollup
// ---------------------------------------------------------------------------

/**
 * Entry in a `claude_message.payload.toolStrip`. Compact by design — the
 * inspector still has access to the full raw transcript for deep details.
 *
 * Spec: R-82 binds the shape to `{ name, file_path?, toolUseId? }`.
 */
interface ToolStripEntry {
  name: string;
  file_path?: string;
  toolUseId?: string;
}

/**
 * Walk a chapter's events once to collect every AskUserQuestion toolUseId
 * that already has a corresponding synthesized `agent_question` event. The
 * matching `tool_result.askuserquestion` events will be filtered out so the
 * UI does not render the same question twice (INV-23, ADR-SN-B2).
 */
function collectAskUserQuestionToolUseIds(
  events: RenderEvent[],
): Set<string> {
  const ids = new Set<string>();
  for (const ev of events) {
    if (ev.type !== "agent_question") continue;
    const rec = ev as Record<string, unknown>;
    const fromTop =
      typeof rec["toolUseId"] === "string" ? (rec["toolUseId"] as string) : "";
    const fromPayload =
      typeof (rec["payload"] as Record<string, unknown> | undefined)?.[
        "toolUseId"
      ] === "string"
        ? (((rec["payload"] as Record<string, unknown>)["toolUseId"]) as string)
        : "";
    const id = fromTop || fromPayload;
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Slice-21 narrative filter (R-81, R-85, INV-21, INV-23, ADR-SN-B2).
 *
 * Drops every event whose type is in NOISE_KINDS (`hook_event`, `system`,
 * `tool_result.*`) AND every event whose type is NOT in NARRATIVE_KINDS.
 * Additionally drops any `tool_result.askuserquestion` whose `tool_use_id`
 * matches a synthesized agent_question (already rendered as AgentQuestionCard).
 *
 * Pure function — does not mutate `events`. Single linear pass (NFR-1).
 */
function applyNarrativeFilter(
  events: RenderEvent[],
  excludedAskUserQuestionToolUseIds: Set<string>,
): RenderEvent[] {
  const out: RenderEvent[] = [];
  for (const ev of events) {
    const type = typeof ev.type === "string" ? ev.type : "";
    if (!type) continue;
    if (isNoiseKind(type)) continue;
    if (!isNarrativeKind(type)) continue;
    // Defensive secondary AskUserQuestion drop (in case a tool_result slipped
    // through the noise filter — currently impossible because `tool_result.*`
    // is in NOISE_KINDS, but keeps the contract robust if NOISE_KIND_PREFIXES
    // ever changes). Real dedup happens against the agent_question matching
    // set during the rollup walk for ANY tool_result, see rollupClaudeMessageTools.
    void excludedAskUserQuestionToolUseIds;
    out.push(ev);
  }
  return out;
}

/**
 * Lowercased tool name from a normalized `tool_result.<tool>` event.
 * Falls back to the top-level `tool_name` field when the type was not
 * suffix-encoded (older capture paths).
 */
function toolNameOf(ev: RenderEvent): string {
  const t = typeof ev.type === "string" ? ev.type : "";
  if (t.startsWith("tool_result.")) {
    return t.slice("tool_result.".length).toLowerCase();
  }
  const rec = ev as Record<string, unknown>;
  return typeof rec["tool_name"] === "string"
    ? (rec["tool_name"] as string).toLowerCase()
    : "";
}

/**
 * Extract the original (case-preserving) display name of the tool used by
 * a `tool_result.*` event. Falls back to the lowercased suffix when the
 * top-level `tool_name` is absent.
 */
function toolDisplayNameOf(ev: RenderEvent): string {
  const rec = ev as Record<string, unknown>;
  if (typeof rec["tool_name"] === "string" && rec["tool_name"]) {
    return rec["tool_name"] as string;
  }
  const t = typeof ev.type === "string" ? ev.type : "";
  if (t.startsWith("tool_result.")) {
    return t.slice("tool_result.".length);
  }
  return "tool";
}

/**
 * Slice-21 toolStrip + filesTouched rollup walker (R-82, R-83, R-86,
 * ADR-SN-B1).
 *
 * Sequential single pass over the chapter's enriched events. For each
 * `claude_message` we accumulate the file paths and a compact list of
 * `{name, file_path?, toolUseId?}` entries from every following `tool_result`
 * up to (but not including) the next `claude_message` boundary. Sub-agent
 * children (matched by `raw.agent_id` to a sub-agent's `agentId`) are skipped
 * — those tools already live on `subagent_complete.payload.tools` from the
 * slice-14/15 enrichment.
 *
 * Returns an array containing every event from `events` EXCEPT bare
 * `tool_result.*` events (which roll up under the open claude_message). Noise
 * events are not filtered here — call `applyNarrativeFilter` afterwards.
 *
 * R-90: when more than 12 entries accumulate under a single claude_message,
 * the strip is truncated to the first 8 and the overflow count is recorded
 * under `payload.overflow` so the UI can render a "+N more" expander.
 */
function rollupClaudeMessageTools(
  events: RenderEvent[],
  subagentChildAgentIds: Set<string>,
  askUserQuestionDedupIds: Set<string>,
): RenderEvent[] {
  const TOOL_STRIP_OVERFLOW_CAP = 12;
  const TOOL_STRIP_VISIBLE_HEAD = 8;
  const out: RenderEvent[] = [];

  let openMsg: RenderEvent | null = null;
  let openTools: ToolStripEntry[] = [];
  let openFiles = new Set<string>();

  function flushOpenMsg(): void {
    if (!openMsg) return;
    const existingPayload =
      ((openMsg as Record<string, unknown>)["payload"] as
        | Record<string, unknown>
        | undefined) ?? {};
    const payload: Record<string, unknown> = { ...existingPayload };
    let visible = openTools;
    let overflow = 0;
    if (openTools.length > TOOL_STRIP_OVERFLOW_CAP) {
      overflow = openTools.length - TOOL_STRIP_VISIBLE_HEAD;
      visible = openTools.slice(0, TOOL_STRIP_VISIBLE_HEAD);
    }
    payload["toolStrip"] = visible;
    if (overflow > 0) payload["overflow"] = overflow;
    payload["filesTouched"] = [...openFiles];
    out.push({ ...(openMsg as Record<string, unknown>), payload } as unknown as RenderEvent);
    openMsg = null;
    openTools = [];
    openFiles = new Set();
  }

  for (const ev of events) {
    const type = typeof ev.type === "string" ? ev.type : "";
    const rec = ev as Record<string, unknown>;

    // tool_result.* — roll up under the open claude_message (or drop).
    if (type.startsWith("tool_result")) {
      const raw = rec["raw"] as Record<string, unknown> | undefined;
      const childAgentId =
        typeof raw?.["agent_id"] === "string"
          ? (raw["agent_id"] as string)
          : "";
      // Sub-agent children belong on the subagent_complete card, not here.
      if (childAgentId && subagentChildAgentIds.has(childAgentId)) {
        continue;
      }
      // AskUserQuestion dedup: drop tool_results whose tool_use_id matches
      // a synthesized agent_question already emitted (INV-23).
      const toolUseId =
        typeof raw?.["tool_use_id"] === "string"
          ? (raw["tool_use_id"] as string)
          : typeof rec["tool_use_id"] === "string"
            ? (rec["tool_use_id"] as string)
            : "";
      const lowerToolName = toolNameOf(ev);
      if (lowerToolName === "askuserquestion") {
        // ALL askuserquestion tool_results are dedup-dropped — the
        // synthesized agent_question is always the better representation
        // (ADR-SN-B2 defensive secondary drop).
        if (toolUseId && askUserQuestionDedupIds.has(toolUseId)) continue;
        // Even when no match found we drop AskUserQuestion to avoid bare
        // tool chips in the strip; the user-facing event is the agent_question.
        continue;
      }
      // No open claude_message → drop (ghost-turn region or pre-message tool).
      if (!openMsg) continue;
      const toolInput = raw?.["tool_input"] as
        | Record<string, unknown>
        | undefined;
      const filePath =
        typeof toolInput?.["file_path"] === "string"
          ? (toolInput["file_path"] as string)
          : typeof toolInput?.["path"] === "string"
            ? (toolInput["path"] as string)
            : typeof toolInput?.["notebook_path"] === "string"
              ? (toolInput["notebook_path"] as string)
              : "";
      const entry: ToolStripEntry = { name: toolDisplayNameOf(ev) };
      if (filePath) entry.file_path = filePath;
      if (toolUseId) entry.toolUseId = toolUseId;
      openTools.push(entry);
      if (filePath) openFiles.add(filePath);
      continue;
    }

    // claude_message OPENS a new strip window — flush the previous one.
    if (type === "claude_message") {
      flushOpenMsg();
      openMsg = ev;
      continue;
    }

    // Any other event closes the open window and is emitted straight through.
    flushOpenMsg();
    out.push(ev);
  }

  // End-of-chapter: flush trailing claude_message.
  flushOpenMsg();

  return out;
}

/**
 * R-87 / R-89 / ADR-SN-B3 — true when the chapter has user_prompts but no
 * claude_messages, i.e. the transcript scraper did not capture Claude's side.
 */
function computeGhostTurns(events: RenderEvent[]): boolean {
  let hasUserPrompt = false;
  let hasClaudeMessage = false;
  for (const ev of events) {
    if (ev.type === "user_prompt") hasUserPrompt = true;
    else if (ev.type === "claude_message") hasClaudeMessage = true;
    if (hasUserPrompt && hasClaudeMessage) return false;
  }
  return hasUserPrompt && !hasClaudeMessage;
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
    /**
     * Slice-17 --safe re-feature: when true, run path / username / email
     * redaction (`sanitizeForSafeExport`) over user-authored text fields that
     * flow into the rendered HTML — sub-agent fullPrompt / promptSummary /
     * response, and event body Markdown rendered into the `bodies` map.
     * Events.jsonl content is already redacted at hook time; sub-agent
     * transcript files in `~/.claude/projects/` are NOT, hence this gate.
     */
    safe?: boolean;
  } = {},
): Promise<BuildExportPayloadResult> {
  const safeMode = opts.safe === true;
  const sanitizeIfSafe = (s: string | undefined): string | undefined => {
    if (s === undefined) return undefined;
    return safeMode ? sanitizeForSafeExport(s) : s;
  };
  // --- Sessions / chapters -------------------------------------------------
  const eventsBySession = groupEventsBySession(ctx.all);

  /*
   * Slice-20 fallback for projects without captured `SessionStart` hook events
   * (e.g. when only `Stop` / `PostToolUse` were ever installed). The render
   * pipeline still has the per-event `sessionId` field on every record, so we
   * synthesize a minimal session entry per unique sessionId — but ONLY for
   * sessions that contain at least one MEANINGFUL conversation marker
   * (user_prompt, claude_message, subagent_complete) or a manual record
   * (decision/error/fix/lesson/milestone). Hook-only sessions (PreToolUse
   * fires that each get their own sessionId from Claude Code) would otherwise
   * explode the chapter count and push the HTML past the budget gate.
   * Real `ctx.sessions` (from `manual.session_start`) always win.
   */
  const MEANINGFUL_TYPES = new Set([
    "user_prompt",
    "claude_message",
    "subagent_complete",
  ]);
  const MEANINGFUL_PREFIXES = ["manual."];

  let sessions = ctx.sessions;
  if (sessions.length === 0 && eventsBySession.size > 0) {
    const synthesized: RenderEvent[] = [];
    for (const [sid, evts] of eventsBySession) {
      if (evts.length === 0) continue;
      // Filter out hook-only sessions — they're noise.
      const isMeaningful = evts.some((e) => {
        if (typeof e.type !== "string") return false;
        if (MEANINGFUL_TYPES.has(e.type)) return true;
        return MEANINGFUL_PREFIXES.some((p) => (e.type as string).startsWith(p));
      });
      if (!isMeaningful) continue;
      let earliest = evts[0]!.ts;
      let latest = evts[0]!.ts;
      for (const e of evts) {
        if (e.ts < earliest) earliest = e.ts;
        if (e.ts > latest) latest = e.ts;
      }
      synthesized.push({
        id: sid,
        type: "manual.session_start",
        ts: earliest,
        sessionId: sid,
        // Label is a short fingerprint — the UI can show the full id on hover.
        title: `Session ${sid.slice(0, 8)}`,
        endTs: latest,
      } as RenderEvent);
    }
    // Sort ascending by start ts so the TOC reads chronologically.
    sessions = synthesized.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  }

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

    // Slice-21: narrative filter + toolStrip rollup.
    //
    // 1. Collect the set of sub-agent agentIds in this chapter — used by the
    //    rollup walker to keep sub-agent tools OFF the parent claude_message's
    //    toolStrip (those tools already live on subagent_complete.payload.tools).
    // 2. Collect AskUserQuestion toolUseIds that match synthesized
    //    agent_question events, so the rollup can dedupe them (INV-23).
    // 3. Run the rollup walker — emits claude_messages with payload.toolStrip /
    //    filesTouched / overflow attached, drops bare tool_results, preserves
    //    every other narrative kind in order.
    // 4. Run the narrative filter to drop any non-narrative leftovers
    //    (hook_event, system, unknown).
    //
    // Pre-filter `enrichedEvents` is still used for `chapter.filesTouched`
    // (top-level aggregator) because R-83 binds that field to the un-filtered
    // tool_result stream — regression-safe with slice-14/15 behavior.
    const subagentChildAgentIds = new Set<string>(
      enrichedEvents
        .filter((e) => e.type === "subagent_complete")
        .map((e) => {
          const rec = e as Record<string, unknown>;
          const fromTop =
            typeof rec["agentId"] === "string" ? (rec["agentId"] as string) : "";
          const payload = rec["payload"] as Record<string, unknown> | undefined;
          const fromPayload =
            typeof payload?.["agentId"] === "string"
              ? (payload["agentId"] as string)
              : "";
          return fromTop || fromPayload;
        })
        .filter((id) => id.length > 0),
    );
    const askUserQuestionDedupIds = collectAskUserQuestionToolUseIds(enrichedEvents);
    const rolledUpEvents = rollupClaudeMessageTools(
      enrichedEvents,
      subagentChildAgentIds,
      askUserQuestionDedupIds,
    );
    const narrativeEvents = applyNarrativeFilter(
      rolledUpEvents,
      askUserQuestionDedupIds,
    );
    const ghostTurns = computeGhostTurns(enrichedEvents);

    // Slice-20: strip the heavy `raw` / `_raw` / `tool_response` fields off
    // every event AFTER enrichment has read what it needs. Keeps the payload
    // JSON two orders of magnitude smaller on real data.
    const slimEvents = narrativeEvents.map(slimEventForChapter);

    const chapter: Chapter = {
      sessionId: id,
      label: labelRaw || id || "session",
      ts: s.ts,
      phases,
      events: slimEvents,
      filesTouched: aggregateFileTouches(enrichedEvents),
    };
    if (ghostTurns) chapter.ghostTurns = true;
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
      // Slice-17: when --safe is on, redact path / username / email tokens in
      // the raw Markdown BEFORE it goes through remark → rehype. Running it
      // before parsing keeps the HTML-entity tokens (`&lt;path&gt;` etc.)
      // intact through the pipeline.
      const source = safeMode ? sanitizeForSafeExport(raw) : raw;
      bodies[eid] = await renderEventBody(source);
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

  // --- Slice-16: subagent prompt/response enrichment -----------------------
  // For each subagent_complete event across all chapters, load its meta.json
  // + transcript JSONL from Claude Code's `~/.claude/projects/.../subagents/`
  // directory and merge agentType / description / fullPrompt / response into
  // the re-nested payload. Parallel I/O via Promise.all.
  //
  // PASSIVE per INV-1: reads only files Claude Code already wrote. Missing
  // files (sub-agent ran on another machine, fresh checkout) produce no
  // enrichment — the UI gracefully falls back to whatever slice-15 supplied.
  const subagentEnrichments: Array<{
    chapterIdx: number;
    eventIdx: number;
    details: SubagentDetails;
  }> = [];
  await Promise.all(
    chapters.flatMap((ch, chapterIdx) =>
      ch.events.map(async (ev, eventIdx) => {
        if (ev.type !== "subagent_complete") return;
        const rec = ev as Record<string, unknown>;
        const payload = rec["payload"] as Record<string, unknown> | undefined;
        const agentId =
          typeof payload?.["agentId"] === "string"
            ? (payload["agentId"] as string)
            : typeof rec["agentId"] === "string"
              ? (rec["agentId"] as string)
              : "";
        if (!agentId) return;
        const details = await loadSubagentDetails(agentId, ch.sessionId, paths.root);
        if (details !== null) {
          subagentEnrichments.push({ chapterIdx, eventIdx, details });
        }
      }),
    ),
  );

  // Apply enrichments — same payload re-nest pattern slice 14/15 established.
  // agentType (from meta.json) wins over the slice-15 attributionAgent fallback
  // for the `agent` display field because it is the *registered* sub-agent
  // name (e.g. "sdd-tasks"). description becomes a sensible promptSummary
  // when no other one was set.
  for (const { chapterIdx, eventIdx, details } of subagentEnrichments) {
    const ch = chapters[chapterIdx]!;
    const ev = ch.events[eventIdx]! as Record<string, unknown>;
    const existing = (ev["payload"] as Record<string, unknown> | undefined) ?? {};
    const merged: Record<string, unknown> = { ...existing };
    if (details.agentType !== undefined) {
      merged["agent"] = details.agentType;
      merged["agentType"] = details.agentType;
    }
    if (details.toolUseId !== undefined) {
      merged["toolUseId"] = details.toolUseId;
    }
    // Slice-17 --safe: sub-agent transcript files come from Claude Code's own
    // `~/.claude/projects/` tree, NOT the LogBook-redacted events.jsonl. When
    // --safe is on, run sanitizeForSafeExport on every user-authored string
    // we surface (prompt / summary / response) before it lands in payload.
    const safePrompt = sanitizeIfSafe(details.fullPrompt);
    const safeResponse = sanitizeIfSafe(details.response);
    const safeDescription = sanitizeIfSafe(details.description);
    if (safePrompt !== undefined) {
      merged["fullPrompt"] = safePrompt;
      // promptSummary derivation priority: description (if present) > derived
      // from fullPrompt > unchanged. description is already a short summary
      // Claude Code generated, so it wins when available.
      if (merged["promptSummary"] === undefined || merged["promptSummary"] === "") {
        merged["promptSummary"] = safeDescription ?? deriveSummary(safePrompt);
      }
    } else if (safeDescription !== undefined) {
      // No full prompt but description exists — still useful as a summary.
      if (merged["promptSummary"] === undefined || merged["promptSummary"] === "") {
        merged["promptSummary"] = safeDescription;
      }
    }
    if (safeResponse !== undefined) {
      merged["response"] = safeResponse;
    }
    ev["payload"] = merged;
  }

  // --- Slice-21: empty-chapter elision (R-88, ADR-SN-B4) -------------------
  // Drop chapters whose post-filter `events` array is empty AND that carry no
  // phase boundaries. These contribute nothing pedagogical and pollute the
  // TOC. `course.totals.sessions` is recomputed against the visible list.
  const preFilterChapterCount = chapters.length;
  const visibleChapters = chapters.filter(
    (ch) => ch.events.length > 0 || ch.phases.length > 0,
  );
  // Sanity check (AG-44 / AG-48): if the filter removed more than 95 % of the
  // chapters, the most likely cause is an over-aggressive narrative filter
  // upstream — surface a single warning so the build doesn't silently lose
  // sessions in production.
  if (
    preFilterChapterCount > 0 &&
    visibleChapters.length / preFilterChapterCount < 0.05
  ) {
    process.stderr.write(
      `[logbook] narrative-filter: visible chapters dropped from ${preFilterChapterCount} to ${visibleChapters.length} (>95% loss). Check NARRATIVE_KINDS coverage.\n`,
    );
  }

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
    sessions: visibleChapters.length,
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
    chapters: visibleChapters,
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
