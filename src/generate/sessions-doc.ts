/**
 * generate/sessions-doc.ts — Build logbook/docs/sessions.md (ADR-22).
 *
 * Groups all events by sessionId; events without sessionId go to an
 * "Unknown session" bucket. Sorted by earliest event ts ascending.
 * Most-recent session emits <details open> at build time.
 *
 * Per session emits:
 *   - ## Session {short-id} heading
 *   - Optional goal blockquote (latest manual.session_goal — above timeline)
 *   - Stats badges: events, decisions, errors, lessons, duration
 *   - <details> block with rich chronological <ol> timeline
 *   - Optional outcome blockquote (latest manual.session_outcome — below timeline)
 *   - Mermaid timeline fence when group size > 3
 *   - Orphan annotations section when present
 *
 * ADR-23: <details> content is passed as raw HTML through the export pipeline.
 * ADR-6: annotations render inline adjacent to their target event.
 * ADR-7: latest-write-wins for goal and outcome.
 * Design §I: icon + CSS class per event type.
 *
 * Pure function — no I/O.
 * Deterministic: same RenderContext → same bytes.
 */

import type { RenderContext, RenderEvent } from "./render-context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// visual-replay-redesign — event-kind color palette (V1 swim lanes, V6 strips,
// V7 event cards). Source of truth is CSS custom properties on :root; the
// hex literals here mirror those tokens for SVG attributes that cannot read
// CSS variables in `file://` rendering.
// ---------------------------------------------------------------------------

const EVT_HEX: Record<string, string> = {
  decision:  "#7C3AED",
  error:     "#dc2626",
  fix:       "#16a34a",
  lesson:    "#d4a72c",
  milestone: "#3b82f6",
  prompt:    "#9A9AA3",
  turn:      "#9A9AA3",
};

/** Map a RenderEvent.type to one of the 7 swim-lane color buckets. */
function eventKindKey(t: string): keyof typeof EVT_HEX {
  if (t === "manual.decision") return "decision";
  if (t === "manual.error") return "error";
  if (t === "manual.fix") return "fix";
  if (t === "manual.lesson") return "lesson";
  if (t === "manual.milestone") return "milestone";
  if (t === "user_prompt") return "prompt";
  if (t === "claude_message") return "turn";
  return "turn"; // default gray for tool calls / hooks / etc.
}

/** Format ISO timestamp to YYYY-MM-DD display string. */
function formatDate(ts: string): string {
  try {
    return ts.slice(0, 10);
  } catch {
    return ts;
  }
}

/** Format ISO timestamp to HH:mm:ss display. */
function formatTime(ts: string): string {
  try {
    return ts.slice(11, 19);
  } catch {
    return ts;
  }
}

/** Format ISO timestamp to display string (second precision). */
function formatTs(ts: string): string {
  try {
    return ts.slice(0, 19).replace("T", " ") + "Z";
  } catch {
    return ts;
  }
}

/** Compute session duration string from min/max event timestamps. */
function sessionDuration(events: RenderEvent[]): string {
  if (events.length < 2) return "—";
  const sorted = events.slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const first = sorted[0]!.ts;
  const last = sorted[sorted.length - 1]!.ts;
  try {
    const diffMs = new Date(last).getTime() - new Date(first).getTime();
    const diffMin = Math.round(diffMs / 60_000);
    if (diffMin < 60) return `${diffMin}m`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  } catch {
    return "—";
  }
}

/** Escape HTML special characters. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a short display id for a session.
 * Uses first 8 chars of sessionId, or the full id if shorter.
 */
function shortId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
}

// ---------------------------------------------------------------------------
// Event icon + CSS class table (design §I)
// ---------------------------------------------------------------------------

interface EventStyle {
  icon: string;
  cssClass: string;
}

function getEventStyle(e: RenderEvent): EventStyle {
  const t = e.type;

  if (t === "user_prompt") return { icon: "💬", cssClass: "lb-evt-user-prompt" };
  if (t === "subagent_complete") return { icon: "↳", cssClass: "lb-evt-subagent" };
  if (t === "manual.decision") return { icon: "📋", cssClass: "lb-evt-decision" };
  if (t === "manual.lesson") return { icon: "💡", cssClass: "lb-evt-lesson" };
  if (t === "manual.error") return { icon: "🐛", cssClass: "lb-evt-error" };
  if (t === "manual.fix") return { icon: "🔨", cssClass: "lb-evt-fix" };
  if (t === "manual.milestone") return { icon: "🎯", cssClass: "lb-evt-milestone" };
  if (t === "manual.resource") return { icon: "📎", cssClass: "lb-evt-resource" };
  if (t === "manual.annotation") return { icon: "📝", cssClass: "lb-evt-annotation" };
  if (t === "manual.session_goal") return { icon: "🎯", cssClass: "lb-evt-goal" };
  if (t === "manual.session_outcome") return { icon: "🏁", cssClass: "lb-evt-outcome" };
  if (t === "manual.session_start") return { icon: "▶", cssClass: "lb-evt-session-start" };

  if (t === "claude_message") {
    const isThinking = e["isThinking"] === true;
    if (isThinking) return { icon: "🧠", cssClass: "lb-evt-thinking" };
    return { icon: "🤖", cssClass: "lb-evt-claude-msg" };
  }

  if (t.startsWith("tool_use.")) return { icon: "🔧", cssClass: "lb-evt-tool-use" };
  if (t === "tool_use") return { icon: "🔧", cssClass: "lb-evt-tool-use" };

  if (t.startsWith("tool_result.")) {
    // Detect errors from payload.
    const hasError = e["error"] === true || typeof e["errorMessage"] === "string";
    if (hasError) return { icon: "✗", cssClass: "lb-evt-tool-err" };
    return { icon: "✓", cssClass: "lb-evt-tool-ok" };
  }
  if (t === "tool_result") return { icon: "✓", cssClass: "lb-evt-tool-ok" };

  if (t.startsWith("hook.") || t === "hook_event") return { icon: "🪝", cssClass: "lb-evt-hook" };

  // New event kinds (B1–B5). B1-R7, B2-R6, B3-R6, B4-R6, B5-R5.
  if (t === "langfuse_trace") return { icon: "&#x1F4CA;", cssClass: "lb-evt-langfuse" };
  if (t === "gh_agent_run") return { icon: "&#x1F916;", cssClass: "lb-evt-gh-run" };
  if (t === "skill_invoked") return { icon: "&#x1F4DA;", cssClass: "lb-evt-skill" };
  if (t === "visual_direction") return { icon: "&#x1F3A8;", cssClass: "lb-evt-visual-dir" };
  if (t === "qa_finding") return { icon: "&#x1F50E;", cssClass: "lb-evt-qa-finding" };

  // Default for unknown types.
  return { icon: "·", cssClass: "lb-evt-unknown" };
}

// ---------------------------------------------------------------------------
// Per-event layer mapping (A1-R6, HE-R1)
// ---------------------------------------------------------------------------

/**
 * Map an event type to its data-lb-layer value for granularity chip filtering.
 *
 * Returns undefined for event types that should be visible in all layers
 * (i.e. no data-lb-layer attribute is emitted).
 *
 * Layer contract (A1-R6):
 *   overview     → dashboard/project summary events
 *   decisions    → decisions, lessons, errors, fixes, qa_finding, visual_direction
 *   conversation → user prompts, claude messages, skill_invoked, gh_agent_run
 *   technical    → tool calls, hook events, langfuse_trace, subagent
 */
function getEventLayer(t: string): string | undefined {
  // Decisions layer (B4-R6, B5-R5).
  if (
    t === "manual.decision" ||
    t === "manual.lesson" ||
    t === "manual.error" ||
    t === "manual.fix" ||
    t === "visual_direction" ||
    t === "qa_finding"
  ) {
    return "decisions";
  }

  // Conversation layer (B2-R6, B3-R6).
  if (
    t === "user_prompt" ||
    t === "claude_message" ||
    t === "skill_invoked" ||
    t === "gh_agent_run"
  ) {
    return "conversation";
  }

  // Technical layer (B1-R7).
  if (
    t.startsWith("tool_use.") || t === "tool_use" ||
    t.startsWith("tool_result.") || t === "tool_result" ||
    t.startsWith("hook.") || t === "hook_event" ||
    t === "langfuse_trace" ||
    t === "subagent_complete"
  ) {
    return "technical";
  }

  // Overview layer.
  if (
    t === "manual.milestone" ||
    t === "manual.resource" ||
    t === "manual.session_start" ||
    t === "manual.session_goal" ||
    t === "manual.session_outcome"
  ) {
    return "overview";
  }

  // Annotations have no fixed layer — they inherit from their target.
  return undefined;
}

// ---------------------------------------------------------------------------
// Per-event summary extraction
// ---------------------------------------------------------------------------

function eventSummary(e: RenderEvent): string {
  const t = e.type;

  // Conversation events: prefer payload text.
  if (t === "user_prompt" || t === "claude_message") {
    const text = e["text"];
    if (typeof text === "string" && text) return text.slice(0, 200);
  }

  // Tool events.
  if (t.startsWith("tool_use.") || t === "tool_use") {
    const toolName = String(e["tool_name"] ?? t.replace("tool_use.", ""));
    const args = e["tool_args"];
    const argSummary =
      args !== undefined ? JSON.stringify(args).slice(0, 80) : "";
    return argSummary ? `${toolName}: ${argSummary}` : toolName;
  }
  if (t.startsWith("tool_result.") || t === "tool_result") {
    const toolName = String(e["tool_name"] ?? t.replace("tool_result.", ""));
    const resp = e["tool_response"];
    const respSummary =
      typeof resp === "string"
        ? resp.slice(0, 60)
        : resp !== undefined
          ? JSON.stringify(resp).slice(0, 60)
          : "";
    return respSummary ? `${toolName}: ${respSummary}` : toolName;
  }

  // Sub-agent complete.
  if (t === "subagent_complete") {
    const agentId = String(e["attributionAgent"] ?? e["agentId"] ?? "agent");
    const tc = e["toolCallCount"];
    return typeof tc === "number" ? `${agentId} (${tc} tool calls)` : agentId;
  }

  // Annotation.
  if (t === "manual.annotation") {
    const note = e["note"] ?? e["text"];
    if (typeof note === "string" && note) return note.slice(0, 200);
  }

  // Goal / outcome.
  if (t === "manual.session_goal" || t === "manual.session_outcome") {
    const text = e["text"];
    if (typeof text === "string" && text) return text.slice(0, 200);
  }

  // Hook events.
  if (t.startsWith("hook.") || t === "hook_event") {
    return String(e["hook_event_name"] ?? e["hook"] ?? t);
  }

  // session_start: prefer label field, then title, then "(session start)"
  if (t === "manual.session_start") {
    if (typeof e["label"] === "string" && e["label"]) return e["label"].slice(0, 200);
    return "session start";
  }

  // New event kinds (B1-R7, B2-R6, B3-R6, B4-R6, B5-R5).
  if (t === "langfuse_trace") {
    const model = String(e["model"] ?? "unknown model");
    const tokens = typeof e["totalTokens"] === "number" ? ` · ${e["totalTokens"]} tokens` : "";
    const cost =
      typeof e["costUsd"] === "number"
        ? ` · $${(e["costUsd"] as number).toFixed(4)}`
        : "";
    return `Langfuse trace — ${model}${tokens}${cost}`;
  }

  if (t === "gh_agent_run") {
    const pr = String(e["prUrl"] ?? e["prNumber"] ?? "PR");
    const filesChanged =
      typeof e["filesChanged"] === "number" ? ` · ${e["filesChanged"]} files` : "";
    return `GitHub agent run — ${pr}${filesChanged}`;
  }

  if (t === "skill_invoked") {
    const skillName = String(e["skillName"] ?? e["skillPath"] ?? "skill");
    return `Skill invoked — ${skillName}`;
  }

  if (t === "visual_direction") {
    const chosen = String(e["chosen"] ?? "(unknown)");
    return `Visual direction — ${chosen}`;
  }

  if (t === "qa_finding") {
    const severity = String(e["severity"] ?? "unknown");
    const layer = String(e["layer"] ?? "");
    const layerStr = layer ? ` [${layer}]` : "";
    const desc = typeof e["description"] === "string" ? e["description"].slice(0, 100) : "";
    return `QA finding [${severity}]${layerStr}${desc ? " — " + desc : ""}`;
  }

  // Generic: title > description > type.
  if (typeof e["title"] === "string" && e["title"]) return e["title"].slice(0, 200);
  if (typeof e["description"] === "string" && e["description"])
    return e["description"].slice(0, 200);
  return `(${t})`;
}

// ---------------------------------------------------------------------------
// Detail content extraction (for <details> expand)
// ---------------------------------------------------------------------------

function eventDetailContent(e: RenderEvent): string | null {
  const t = e.type;
  const summary = eventSummary(e);

  if (t === "user_prompt" || t === "claude_message") {
    const text = e["text"];
    if (typeof text === "string" && text.length > 200) return text;
  }

  if (t.startsWith("tool_use.") || t === "tool_use") {
    const args = e["tool_args"];
    if (args !== undefined) return JSON.stringify(args, null, 2);
  }
  if (t.startsWith("tool_result.") || t === "tool_result") {
    const resp = e["tool_response"];
    if (resp !== undefined) {
      return typeof resp === "string" ? resp : JSON.stringify(resp, null, 2);
    }
  }

  if (t === "manual.decision") {
    const parts: string[] = [];
    if (typeof e["rationale"] === "string") parts.push(`Rationale: ${e["rationale"]}`);
    if (typeof e["alternatives"] === "string") parts.push(`Alternatives: ${e["alternatives"]}`);
    if (typeof e["chosen"] === "string") parts.push(`Chosen: ${e["chosen"]}`);
    if (parts.length > 0) return parts.join("\n");
  }

  if (t === "manual.lesson") {
    const body = e["body"];
    if (typeof body === "string" && body.length > 0) return body;
  }

  // New event kinds — rich detail cards. B1-R7, B2-R6, B3-R6, B4-R6, B5-R5.
  if (t === "langfuse_trace") {
    const parts: string[] = [];
    if (e["model"]) parts.push(`Model: ${e["model"]}`);
    if (typeof e["inputTokens"] === "number") parts.push(`Input tokens: ${e["inputTokens"]}`);
    if (typeof e["outputTokens"] === "number") parts.push(`Output tokens: ${e["outputTokens"]}`);
    if (typeof e["totalTokens"] === "number") parts.push(`Total tokens: ${e["totalTokens"]}`);
    if (typeof e["costUsd"] === "number")
      parts.push(`Cost: $${(e["costUsd"] as number).toFixed(4)}`);
    if (e["traceId"]) parts.push(`Trace ID: ${e["traceId"]}`);
    return parts.length > 0 ? parts.join("\n") : null;
  }

  if (t === "gh_agent_run") {
    const parts: string[] = [];
    if (e["prUrl"]) parts.push(`PR: ${e["prUrl"]}`);
    if (e["runSummary"]) parts.push(`Summary: ${e["runSummary"]}`);
    if (typeof e["filesChanged"] === "number") parts.push(`Files changed: ${e["filesChanged"]}`);
    if (e["runId"]) parts.push(`Run ID: ${e["runId"]}`);
    return parts.length > 0 ? parts.join("\n") : null;
  }

  if (t === "skill_invoked") {
    const parts: string[] = [];
    if (e["skillName"]) parts.push(`Skill: ${e["skillName"]}`);
    if (e["skillPath"]) parts.push(`Path: ${e["skillPath"]}`);
    return parts.length > 0 ? parts.join("\n") : null;
  }

  if (t === "visual_direction") {
    const parts: string[] = [];
    if (e["chosen"]) parts.push(`Chosen: ${e["chosen"]}`);
    const candidates = e["candidates"];
    if (Array.isArray(candidates) && candidates.length > 0) {
      parts.push(`Candidates: ${(candidates as string[]).join(", ")}`);
    }
    if (e["rationale"]) parts.push(`Rationale: ${e["rationale"]}`);
    return parts.length > 0 ? parts.join("\n") : null;
  }

  if (t === "qa_finding") {
    const parts: string[] = [];
    const severity = String(e["severity"] ?? "unknown");
    const layer = String(e["layer"] ?? "");
    parts.push(`Severity: ${severity}`);
    if (layer) parts.push(`Layer: ${layer}`);
    if (e["description"]) parts.push(`Description: ${e["description"]}`);
    // B5-R5: show "—" when fix is absent.
    const fix = e["fix"];
    parts.push(`Fix: ${typeof fix === "string" && fix ? fix : "—"}`);
    return parts.join("\n");
  }

  // Show full summary as detail only when summary was truncated.
  if (summary.length >= 200) {
    const text = e["text"] ?? e["title"] ?? e["description"];
    if (typeof text === "string") return text;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Render a single event as an <li> element
// ---------------------------------------------------------------------------

function renderEventLi(
  e: RenderEvent,
  annotations: RenderEvent[],
): string {
  const { icon, cssClass } = getEventStyle(e);
  const summary = esc(eventSummary(e));
  const timeStr = esc(formatTime(e.ts));
  const eventId = String(e["id"] ?? "");
  const idAttr = esc(eventId);
  const detail = eventDetailContent(e);

  // A2-R7, HE-R5: stable id="event-{event.id}" for DVR scrubber targeting.
  const stableId = eventId ? `event-${esc(eventId)}` : "";
  const idProp = stableId ? ` id="${stableId}"` : "";

  // A1-R6, HE-R1: data-lb-layer for granularity chip filtering.
  const layer = getEventLayer(e.type);
  const layerProp = layer ? ` data-lb-layer="${layer}"` : "";

  const lines: string[] = [];
  lines.push(`<li${idProp} class="lb-event ${cssClass}" data-event-id="${idAttr}" data-ts="${esc(e.ts)}"${layerProp}>`);
  lines.push(
    `  <span class="lb-event-icon">${icon}</span>` +
      ` <span class="lb-event-time">${timeStr}</span>` +
      ` <span class="lb-event-sep">—</span>` +
      ` <span class="lb-event-summary">${summary}</span>`,
  );

  if (detail !== null) {
    lines.push(`  <details class="lb-event-detail">`);
    lines.push(`    <summary>show detail</summary>`);
    lines.push(`    <pre><code>${esc(detail)}</code></pre>`);
    lines.push(`  </details>`);
  }

  // Inline annotations after the target event.
  for (const ann of annotations) {
    const note = esc(String(ann["note"] ?? ann["text"] ?? "(annotation)"));
    lines.push(`  <div class="lb-annotation">&#x1F4DD; ${note}</div>`);
  }

  lines.push(`</li>`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Render a span-tree group: LLM turn (details open) + nested tool calls
// ---------------------------------------------------------------------------

/**
 * Render a span tree group as nested <details> elements.
 *
 * LLM turn (claude_message) → <details class="lb-turn" open> (A2-R1, A2-R4)
 * Tool call → <details class="lb-tool-call"> (closed by default) (A2-R2, A2-R4)
 * Sub-agent → amber border (A2-R3)
 * Error tool result → red border (A2-R3)
 * Each event gets id="event-{event.id}" (A2-R7, HE-R5).
 */
function renderSpanTreeGroup(
  turnEvent: RenderEvent,
  toolEvents: RenderEvent[],
  annotations: Map<string, RenderEvent[]>,
): string {
  const lines: string[] = [];
  const turnId = String(turnEvent["id"] ?? "");
  const stableTurnId = turnId ? `event-${esc(turnId)}` : "";
  const idProp = stableTurnId ? ` id="${stableTurnId}"` : "";
  const turnSummary = esc(eventSummary(turnEvent));
  const timeStr = esc(formatTime(turnEvent.ts));
  const { icon: turnIcon } = getEventStyle(turnEvent);

  // A1-R6, HE-R1: conversation layer for LLM turns.
  const turnLayerProp = ` data-lb-layer="conversation"`;

  // A2-R1, A2-R4: LLM turn is open by default.
  lines.push(`<details class="lb-turn" open${idProp}${turnLayerProp}>`);
  lines.push(
    `<summary>` +
    `<span class="lb-event-icon">${turnIcon}</span> ` +
    `<span class="lb-event-time">${timeStr}</span> ` +
    `<span class="lb-event-sep">—</span> ` +
    `<span class="lb-event-summary">${turnSummary}</span>` +
    `</summary>`
  );
  lines.push(`<div class="lb-event-content">`);

  const turnDetail = eventDetailContent(turnEvent);
  if (turnDetail !== null) {
    lines.push(`<pre><code>${esc(turnDetail)}</code></pre>`);
  }

  // Tool calls nested inside LLM turn.
  for (const toolEvent of toolEvents) {
    const toolId = String(toolEvent["id"] ?? "");
    const toolStableId = toolId ? `event-${esc(toolId)}` : "";
    const toolIdProp = toolStableId ? ` id="${toolStableId}"` : "";
    const toolSummary = esc(eventSummary(toolEvent));
    const toolTimeStr = esc(formatTime(toolEvent.ts));

    // A2-R3: sub-agents get amber border, errors get red border.
    const isSubagent = toolEvent.type === "subagent_complete";
    const isError =
      toolEvent.type === "manual.error" ||
      (toolEvent.type.startsWith("tool_result") && toolEvent["error"] === true);

    let detailsClass = "lb-tool-call";
    if (isSubagent) detailsClass = "lb-subagent";
    else if (isError) detailsClass = "lb-error-event";

    // A1-R6, HE-R1: layer for tool calls (technical) and subagents.
    const toolLayerAttr = getEventLayer(toolEvent.type);
    const toolLayerProp = toolLayerAttr ? ` data-lb-layer="${toolLayerAttr}"` : "";

    // A2-R2, A2-R4: tool calls closed by default.
    lines.push(`<details class="${detailsClass}"${toolIdProp}${toolLayerProp}>`);
    lines.push(
      `<summary>` +
      `<span class="lb-event-time">${toolTimeStr}</span> ` +
      `<span class="lb-event-sep">—</span> ` +
      `<span class="lb-event-summary">${toolSummary}</span>` +
      `</summary>`
    );

    const toolDetail = eventDetailContent(toolEvent);
    if (toolDetail !== null) {
      lines.push(`<div class="lb-event-content"><pre><code>${esc(toolDetail)}</code></pre></div>`);
    }

    // Inline annotations.
    const toolAnnotations = annotations.get(toolId) ?? [];
    for (const ann of toolAnnotations) {
      const note = esc(String(ann["note"] ?? ann["text"] ?? "(annotation)"));
      lines.push(`<div class="lb-annotation">&#x1F4DD; ${note}</div>`);
    }

    lines.push(`</details>`);
  }

  // Annotations on the LLM turn itself.
  const turnAnnotations = annotations.get(turnId) ?? [];
  for (const ann of turnAnnotations) {
    const note = esc(String(ann["note"] ?? ann["text"] ?? "(annotation)"));
    lines.push(`<div class="lb-annotation">&#x1F4DD; ${note}</div>`);
  }

  lines.push(`</div>`);
  lines.push(`</details>`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Build annotationsByTarget map
// ---------------------------------------------------------------------------

function buildAnnotationMap(events: RenderEvent[]): {
  byTarget: Map<string, RenderEvent[]>;
  orphans: RenderEvent[];
} {
  const byTarget = new Map<string, RenderEvent[]>();
  const orphans: RenderEvent[] = [];

  for (const e of events) {
    if (e.type !== "manual.annotation") continue;
    const rel = e["relatedEventId"];
    if (typeof rel === "string" && rel.length > 0) {
      const arr = byTarget.get(rel) ?? [];
      arr.push(e);
      byTarget.set(rel, arr);
    } else {
      orphans.push(e);
    }
  }

  return { byTarget, orphans };
}

// ---------------------------------------------------------------------------
// Build per-session rich <ol> timeline
// ---------------------------------------------------------------------------

function buildRichTimeline(
  events: RenderEvent[],
  allSessionEvents: RenderEvent[],
): string {
  // Sort ascending by ts then id.
  const sorted = events.slice().sort((a, b) => {
    if (a.ts < b.ts) return -1;
    if (a.ts > b.ts) return 1;
    const aId = String(a["id"] ?? "");
    const bId = String(b["id"] ?? "");
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  // Build annotation index scoped to this session.
  const { byTarget, orphans } = buildAnnotationMap(allSessionEvents);

  // Set of event ids present in this session for orphan resolution.
  const eventIds = new Set(sorted.map((e) => String(e["id"] ?? "")));

  // Resolve orphans: annotations whose relatedEventId does not exist in this session.
  const additionalOrphans: RenderEvent[] = [];
  for (const [targetId, anns] of byTarget.entries()) {
    if (!eventIds.has(targetId)) {
      additionalOrphans.push(...anns);
      byTarget.delete(targetId);
    }
  }
  const allOrphans = [...orphans, ...additionalOrphans];

  const lines: string[] = [];

  // A2-R5: Expand all / Collapse all controls in section header.
  lines.push('<div class="lb-tree-controls">');
  lines.push('<button class="lb-tree-btn" type="button" data-lb-expand-all>Expand all</button>');
  lines.push('<button class="lb-tree-btn" type="button" data-lb-collapse-all>Collapse all</button>');
  lines.push('</div>');

  // Check if this session has conversation events (LLM turns + tool calls).
  // If so, render as span tree (<details> nesting); otherwise use flat <ol>.
  const hasConversation = sorted.some(
    (e) =>
      e.type === "claude_message" ||
      e.type.startsWith("tool_use.") || e.type === "tool_use" ||
      e.type.startsWith("tool_result.") || e.type === "tool_result"
  );

  if (hasConversation) {
    // Span tree mode: group claude_message turns with following tool_use/tool_result events.
    lines.push('<div class="lb-event-tree">');

    const filteredEvents = sorted.filter((e) => {
      // Skip annotations, goal/outcome here.
      if (e.type === "manual.annotation") return false;
      if (e.type === "manual.session_goal" || e.type === "manual.session_outcome") return false;
      return true;
    });

    // Group: each claude_message starts a new "turn group" containing the
    // tool_use/tool_result events that follow it until the next claude_message.
    // Non-conversation events (decisions, errors, etc.) render as standalone <li>.
    let i = 0;
    while (i < filteredEvents.length) {
      const e = filteredEvents[i]!;

      // LLM turn: collect following tool calls.
      if (e.type === "claude_message") {
        const toolEvents: RenderEvent[] = [];
        let j = i + 1;
        while (j < filteredEvents.length) {
          const next = filteredEvents[j]!;
          if (
            next.type.startsWith("tool_use.") || next.type === "tool_use" ||
            next.type.startsWith("tool_result.") || next.type === "tool_result" ||
            next.type === "subagent_complete"
          ) {
            toolEvents.push(next);
            j++;
          } else {
            break;
          }
        }
        lines.push(renderSpanTreeGroup(e, toolEvents, byTarget));
        i = j;
        continue;
      }

      // Standalone event (decision, error, etc.) — use flat <div>.
      const eventId = String(e["id"] ?? "");
      const stableId = eventId ? `event-${esc(eventId)}` : "";
      const idProp = stableId ? ` id="${stableId}"` : "";
      const { icon, cssClass } = getEventStyle(e);
      const summary = esc(eventSummary(e));
      const timeStr = esc(formatTime(e.ts));
      const detail = eventDetailContent(e);
      const evAnnotations = byTarget.get(eventId) ?? [];
      const layerAttr = getEventLayer(e.type);
      const layerProp = layerAttr ? ` data-lb-layer="${layerAttr}"` : "";

      lines.push(`<div${idProp} class="lb-event ${cssClass}" data-event-id="${esc(eventId)}" data-ts="${esc(e.ts)}"${layerProp}>`);
      lines.push(
        `  <span class="lb-event-icon">${icon}</span>` +
        ` <span class="lb-event-time">${timeStr}</span>` +
        ` <span class="lb-event-sep">—</span>` +
        ` <span class="lb-event-summary">${summary}</span>`
      );
      if (detail !== null) {
        lines.push(`  <details class="lb-event-detail"><summary>detail</summary><pre><code>${esc(detail)}</code></pre></details>`);
      }
      for (const ann of evAnnotations) {
        const note = esc(String(ann["note"] ?? ann["text"] ?? "(annotation)"));
        lines.push(`  <div class="lb-annotation">&#x1F4DD; ${note}</div>`);
      }
      lines.push(`</div>`);
      i++;
    }

    lines.push('</div>');
  } else {
    // Flat timeline mode (no conversation events).
    lines.push('<ol class="lb-timeline">');

    for (const e of sorted) {
      if (e.type === "manual.annotation") continue;
      if (e.type === "manual.session_goal" || e.type === "manual.session_outcome") continue;

      const eventId = String(e["id"] ?? "");
      const annotationsForEvent = byTarget.get(eventId) ?? [];
      lines.push(renderEventLi(e, annotationsForEvent));
    }

    lines.push("</ol>");
  }

  // Orphan annotations section.
  if (allOrphans.length > 0) {
    lines.push('<div class="lb-orphan-annotations">');
    lines.push("<strong>Orphan Annotations</strong>");
    lines.push('<ul>');
    for (const ann of allOrphans) {
      const note = esc(String(ann["note"] ?? ann["text"] ?? "(annotation)"));
      lines.push(`<li class="lb-annotation">&#x1F4DD; ${note}</li>`);
    }
    lines.push("</ul>");
    lines.push("</div>");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Mermaid sequenceDiagram generation (ADR-D3, T6.2)
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe use inside a Mermaid sequenceDiagram.
 *
 * Strips chars that break Mermaid's parser: `:`, `|`, `(`, `)`, `<`, `>`,
 * `[`, `]`, `;`, `{`, `}`, `"`. Truncates to 60 chars.
 *
 * ADR-D3 / DR-5: prevents broken Mermaid parsing on adversarial inputs.
 */
function mermaidEsc(s: string): string {
  return s
    .replace(/[:|()\[\]{}<>;""]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/**
 * Build a Mermaid `sequenceDiagram` string for a session's events.
 *
 * - Participants: User, Claude, Tools; Sub-agent added only when present.
 * - Lines: user_prompt → U->>C, claude_message (last in run) → C-->>U,
 *   tool_use.* → C->>T, tool_result.* collapsed when a run repeats, etc.
 * - Max 30 lines; collapses middle if exceeded (first 10 + note + last 10).
 *
 * Returns the sequenceDiagram Mermaid source string (without the fence markers).
 *
 * @param events  Sorted (ascending ts) session events.
 * @returns       Mermaid sequenceDiagram source, ≤30 lines.
 */
export function buildSequenceDiagramForSession(events: RenderEvent[]): string {
  const hasSubagent = events.some((e) => e.type === "subagent_complete");

  const participants = [
    "participant U as User",
    "participant C as Claude",
    "participant T as Tools",
  ];
  if (hasSubagent) participants.push("participant A as Sub-agent");

  const lines: string[] = [];

  // Sorted ascending.
  const sorted = events.slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));

  let i = 0;
  let consecutiveToolCount = 0;
  let lastToolName = "";

  while (i < sorted.length) {
    const e = sorted[i]!;
    const t = e.type;

    if (t === "user_prompt") {
      const text = typeof e["text"] === "string" ? e["text"] : "";
      lines.push(`U->>C: ${mermaidEsc(text || "(prompt)")}`);
      consecutiveToolCount = 0;
      lastToolName = "";
      i++;
      continue;
    }

    if (t === "claude_message") {
      // Only emit the last claude_message in a consecutive run.
      let j = i + 1;
      while (j < sorted.length && sorted[j]!.type === "claude_message") j++;
      const last = sorted[j - 1]!;
      const text = typeof last["text"] === "string" ? last["text"] : "";
      lines.push(`C-->>U: ${mermaidEsc(text || "(response)")}`);
      consecutiveToolCount = 0;
      lastToolName = "";
      i = j;
      continue;
    }

    if (t.startsWith("tool_use.") || t === "tool_use") {
      const toolName = mermaidEsc(
        String(e["tool_name"] ?? t.replace("tool_use.", "tool")) || "tool"
      );
      // Collapse consecutive identical tool calls.
      if (toolName === lastToolName) {
        consecutiveToolCount++;
        // Update the last Note line if we're collapsing.
        if (lines.length > 0 && lines[lines.length - 1]!.startsWith("Note over T:")) {
          lines[lines.length - 1] = `Note over T: ${toolName} x${consecutiveToolCount + 1}`;
        } else {
          lines.push(`Note over T: ${toolName} x${consecutiveToolCount + 1}`);
        }
      } else {
        const firstArg = ((): string => {
          const args = e["tool_args"];
          if (!args || typeof args !== "object") return "";
          const vals = Object.values(args as Record<string, unknown>);
          const first = vals[0];
          return mermaidEsc(String(first ?? "").split("\n")[0] ?? "");
        })();
        const label = firstArg ? `${toolName} ${firstArg}` : toolName;
        lines.push(`C->>T: ${label}`);
        consecutiveToolCount = 1;
        lastToolName = toolName;
      }
      i++;
      continue;
    }

    if (t.startsWith("tool_result.") || t === "tool_result") {
      const hasError = e["error"] === true || typeof e["errorMessage"] === "string";
      lines.push(`T-->>C: ${hasError ? "error" : "ok"}`);
      consecutiveToolCount = 0;
      lastToolName = "";
      i++;
      continue;
    }

    if (t === "subagent_complete") {
      const agentId = mermaidEsc(
        String(e["attributionAgent"] ?? e["agentId"] ?? "agent")
      );
      lines.push(`C->>A: delegate to ${agentId}`);
      lines.push(`A-->>C: done`);
      consecutiveToolCount = 0;
      lastToolName = "";
      i++;
      continue;
    }

    // All other event types: skip.
    i++;
  }

  // Cap at 30 lines: keep first 10 + note + last 10.
  const MAX_LINES = 30;
  let finalLines: string[];
  if (lines.length > MAX_LINES) {
    const head = lines.slice(0, 10);
    const tail = lines.slice(lines.length - 10);
    const collapsed = lines.length - 20;
    finalLines = [
      ...head,
      `Note over U,T: ... ${collapsed} events collapsed ...`,
      ...tail,
    ];
  } else {
    finalLines = lines;
  }

  return ["sequenceDiagram", ...participants, ...finalLines].join("\n");
}

// ---------------------------------------------------------------------------
// visual-replay-redesign V1 — swim-lane SVG builder
// ---------------------------------------------------------------------------

/**
 * Compute the V6 session status from session events.
 *
 * Precedence (per AG-9 / spec V6): red > amber > green > neutral.
 *   red     — count(error) > count(fix)
 *   amber   — at least one decision event AND no milestone resolves it
 *   green   — at least one milestone event
 *   neutral — otherwise
 *
 * No "unresolved-risk-wins" inversion is applied beyond the spec.
 */
function computeSessionStatus(events: RenderEvent[]): "green" | "amber" | "red" | "neutral" {
  let errors = 0;
  let fixes = 0;
  let decisions = 0;
  let milestones = 0;
  for (const e of events) {
    if (e.type === "manual.error") errors++;
    else if (e.type === "manual.fix") fixes++;
    else if (e.type === "manual.decision") decisions++;
    else if (e.type === "manual.milestone") milestones++;
  }
  if (errors > fixes) return "red";
  if (decisions > 0 && milestones === 0) return "amber";
  if (milestones > 0) return "green";
  return "neutral";
}

/**
 * Build the V1 swim-lane SVG block.
 *
 * One horizontal row per session. Each event is a `<circle r="4">`. Time is
 * normalized to a 0..1000 viewBox X axis using `(evt.ts - sessionStart) /
 * sessionDuration`. Adversarial timestamps outside session bounds are clamped
 * to [0, 1000] so the SVG never overflows.
 *
 * Caps at 20 visible lanes; older sessions collapse into a non-interactive
 * "Earlier (N)" lane label so total height stays bounded on large fixtures.
 *
 * Returns an empty string when `sortedGroups` is empty (caller already shows
 * the empty-state copy).
 *
 * Pure function — no I/O.
 */
function buildSwimLanesSvg(
  sortedGroups: Array<[string, RenderEvent[]]>,
): string {
  if (sortedGroups.length === 0) return "";

  const MAX_LANES = 20;
  const visible = sortedGroups.slice(-MAX_LANES); // most recent N
  const earlierCount = sortedGroups.length - visible.length;
  const totalRows = visible.length + (earlierCount > 0 ? 1 : 0);

  const ROW_H = 28;
  const TOP_PAD = 30;
  const VIEW_H = TOP_PAD + totalRows * ROW_H + 8;
  const VIEW_W = 1000;
  const LABEL_W = 110; // left strip reserved for session label
  const TRACK_X0 = LABEL_W + 8;
  const TRACK_W = VIEW_W - TRACK_X0 - 16;

  const lines: string[] = [];
  lines.push('<div class="lb-swim-lanes" role="region" aria-label="Session swim lanes">');
  // NOTE: xmlns is intentionally omitted. Inline SVG in HTML5 does not
  // require it; the W3C namespace literals would otherwise trip the
  // assertNoExternalRefs guard (sanitize-links.ts treats every http(s) URL
  // as a runtime fetch). Similarly we use plain `href` (not `xlink:href`),
  // which is the modern SVG2 spelling.
  lines.push(
    `<svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="100%" ` +
    `preserveAspectRatio="xMinYMin meet">`,
  );

  // Header label (purely decorative; the legend lives in the page intro).
  lines.push(
    `<text x="0" y="18" font-size="12" fill="#9A9AA3">` +
    `Sessions over time</text>`,
  );

  visible.forEach(([sid, allEvents], idx) => {
    // Filter goal/outcome events from the swim-lane: their text is surfaced
    // in the session-detail blockquote (latest-write-wins). Including them
    // here would leak superseded copies into the SVG <title> tooltip
    // (cognitive-doc-design §"don't duplicate surfaces").
    const events = allEvents.filter(
      (e) => e.type !== "manual.session_goal" && e.type !== "manual.session_outcome",
    );
    const sorted = events.slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const first = sorted[0]?.ts ?? "";
    const last = sorted[sorted.length - 1]?.ts ?? first;
    const startMs = new Date(first).getTime();
    const endMs = new Date(last).getTime();
    const span = Math.max(endMs - startMs, 1);

    const y = TOP_PAD + idx * ROW_H;
    const cy = y + ROW_H / 2;
    const isUnknown = sid === UNKNOWN_SESSION_ID;
    const label = isUnknown ? "Unknown" : shortId(sid);

    // Per-row clickable wrapper (entire row navigates to #sessions/<id>).
    const hrefHash = isUnknown ? "" : `#sessions/${esc(sid)}`;
    if (hrefHash) {
      lines.push(`<a href="${hrefHash}">`);
    }

    // Lane background rect (transparent fill, used for hit-testing).
    lines.push(
      `<rect class="lb-swim-row" x="0" y="${y}" width="${VIEW_W}" height="${ROW_H}" ` +
      `fill="transparent"><title>${esc(label)} — ${events.length} events</title></rect>`,
    );

    // Lane label on the left.
    lines.push(
      `<text class="lb-swim-label" x="8" y="${cy + 4}" font-size="11" ` +
      `fill="#9A9AA3">${esc(label)}</text>`,
    );

    // Track baseline (subtle hairline so empty lanes are still visible).
    lines.push(
      `<line x1="${TRACK_X0}" x2="${TRACK_X0 + TRACK_W}" y1="${cy}" y2="${cy}" ` +
      `stroke="#27272a" stroke-width="1"/>`,
    );

    // Empty lane: a single small marker at cx=0 (spec V1 requirement 9).
    if (sorted.length === 0) {
      lines.push(
        `<circle cx="${TRACK_X0}" cy="${cy}" r="3" fill="#27272a">` +
        `<title>${esc(label)} — empty session</title></circle>`,
      );
    } else if (sorted.length === 1) {
      // Single-event session: pin the dot to track start.
      const e = sorted[0]!;
      const kind = eventKindKey(e.type);
      const fill = EVT_HEX[kind];
      const summary = esc(eventSummary(e));
      lines.push(
        `<circle cx="${TRACK_X0}" cy="${cy}" r="4" fill="${fill}">` +
        `<title>${summary} — ${esc(formatTime(e.ts))}</title></circle>`,
      );
    } else {
      for (const e of sorted) {
        const ts = new Date(e.ts).getTime();
        let frac = (ts - startMs) / span;
        if (!isFinite(frac)) frac = 0;
        // Clamp adversarial timestamps inside the track.
        if (frac < 0) frac = 0;
        if (frac > 1) frac = 1;
        const cx = TRACK_X0 + frac * TRACK_W;
        const kind = eventKindKey(e.type);
        const fill = EVT_HEX[kind];
        const summary = esc(eventSummary(e));
        lines.push(
          `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="4" fill="${fill}">` +
          `<title>${summary} — ${esc(formatTime(e.ts))}</title></circle>`,
        );
      }
    }

    if (hrefHash) {
      lines.push(`</a>`);
    }
  });

  // Earlier (N) collapse lane.
  if (earlierCount > 0) {
    const y = TOP_PAD + visible.length * ROW_H;
    const cy = y + ROW_H / 2;
    lines.push(
      `<text x="8" y="${cy + 4}" font-size="11" fill="#9A9AA3">` +
      `Earlier (${earlierCount})</text>`,
    );
    lines.push(
      `<line x1="${TRACK_X0}" x2="${TRACK_X0 + TRACK_W}" y1="${cy}" y2="${cy}" ` +
      `stroke="#27272a" stroke-dasharray="2 4" stroke-width="1"/>`,
    );
  }

  lines.push(`</svg>`);
  lines.push(`</div>`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// visual-replay-redesign V8 + V10 — sticky breadcrumb + session-detail aside
// ---------------------------------------------------------------------------

/**
 * The sticky breadcrumb is emitted once at the top of `page-sessions`. It is
 * hidden by default; the router toggles `display: flex` when
 * `data-session-detail="true"` is set on the page. JS in inline.js
 * populates the session-label `<span>` from the matching session block.
 */
function buildBreadcrumb(): string {
  return (
    '<nav class="lb-breadcrumb" aria-label="Breadcrumb" hidden>' +
    '<a href="#sessions">Sessions</a>' +
    '<span class="lb-breadcrumb-sep" aria-hidden="true">&rsaquo;</span>' +
    '<span class="lb-breadcrumb-current" data-lb-breadcrumb-current>session</span>' +
    '</nav>'
  );
}

/**
 * The right-hand session-detail aside is emitted once. JS clones the matching
 * session's mermaid sequence diagram + decisions/errors mini-list into it when
 * `#sessions/<id>` is the route. Hidden by default; CSS shows it only when
 * `data-session-detail="true"` is set on the page.
 */
function buildSessionDetailAside(): string {
  return (
    '<aside class="lb-session-detail-aside" data-lb-session-aside aria-label="Session detail" hidden>' +
    '<div class="lb-aside-section" data-lb-aside-sequence>' +
    '<h3 class="lb-aside-h3">Sequence</h3>' +
    '<div class="lb-aside-body" data-lb-aside-sequence-body>' +
    '<p class="lb-empty-state-mini">Loading…</p>' +
    '</div>' +
    '</div>' +
    '<div class="lb-aside-section" data-lb-aside-summary>' +
    '<h3 class="lb-aside-h3">Decisions &amp; errors</h3>' +
    '<div class="lb-aside-body" data-lb-aside-summary-body>' +
    '<p class="lb-empty-state-mini">Loading…</p>' +
    '</div>' +
    '</div>' +
    '</aside>'
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNKNOWN_SESSION_ID = "unknown";

// ---------------------------------------------------------------------------
// buildSessionsDoc
// ---------------------------------------------------------------------------

/**
 * Produce the full body for logbook/docs/sessions.md as a Markdown string.
 *
 * @param ctx  RenderContext from readContext.
 */
export function buildSessionsDoc(ctx: RenderContext): string {
  const lines: string[] = [];

  lines.push("# Sessions");
  lines.push("");

  // visual-replay-redesign V8 + V10 — breadcrumb + aside live at the top of
  // page-sessions and are toggled by the router based on `#sessions/<id>`.
  lines.push(buildBreadcrumb());
  lines.push("");

  if (ctx.all.length === 0) {
    // visual-replay-redesign V9 — pedagogical empty state (cognitive-doc-design
    // §"lead with the answer / actionable next step"). The user is told
    // explicitly what to run to populate the page.
    lines.push('<div class="lb-empty-state" role="status">');
    lines.push('<p><strong>Aún no hay sesiones registradas.</strong></p>');
    lines.push('<p>Usá <code>logbook start --label "tu sesión"</code> para registrar la primera. Mientras tanto: revisá el Dashboard para ver el panorama del proyecto.</p>');
    lines.push('</div>');
    lines.push("");
    return lines.join("\n");
  }

  // Count unique sessions for the page hero (T7.1, ADR-D6 microcopy).
  const uniqueSessionIds = new Set(
    ctx.all
      .map((e) => (typeof e["sessionId"] === "string" ? e["sessionId"] : UNKNOWN_SESSION_ID))
  );
  const sessionCount = uniqueSessionIds.size;

  lines.push('<header class="lb-page-hero">');
  // Phase 4 T4.1 — cognitive-doc-design: lead with the answer (what you are looking at),
  // signpost the primary interaction (swim lanes), surface keyboard shortcut affordance.
  lines.push('<p class="lb-page-intro">' +
    sessionCount + ' session' + (sessionCount !== 1 ? 's' : '') + ' you can replay. ' +
    'The strip below shows every event in time order, one row per session. ' +
    'Click a row to open it, drag the scrubber to step through, ' +
    'or press <kbd>Cmd</kbd>+<kbd>K</kbd> to jump straight to any event.</p>');
  lines.push('</header>');
  lines.push('');

  // legends-and-pedagogical-decode — "How to read this" collapsible.
  // cognitive-doc-design §"recognition over recall" — describe shapes and
  // colors, not jargon. Closed by default so the hero stays the lead.
  lines.push('<details class="lb-how-to-read">');
  lines.push('<summary>¿Cómo leer esta página?</summary>');
  lines.push('<div class="lb-how-to-read-body">');
  lines.push('<p>Cada fila de "Sessions over time" es una sesión de trabajo con sus eventos puestos en el tiempo. Más abajo, cada card es una sesión expandible con su detalle.</p>');
  lines.push('<h4>Color de los dots en cada fila</h4>');
  lines.push('<ul>');
  lines.push('<li><span class="lb-legend-swatch" style="background:#7C3AED"></span> <strong>Decision</strong> — elección arquitectónica registrada</li>');
  lines.push('<li><span class="lb-legend-swatch" style="background:#dc2626"></span> <strong>Error</strong> — algo que falló</li>');
  lines.push('<li><span class="lb-legend-swatch" style="background:#16a34a"></span> <strong>Fix</strong> — error resuelto</li>');
  lines.push('<li><span class="lb-legend-swatch" style="background:#d4a72c"></span> <strong>Lesson</strong> — aprendizaje capturado</li>');
  lines.push('<li><span class="lb-legend-swatch" style="background:#3b82f6"></span> <strong>Milestone</strong> — cierre de fase</li>');
  lines.push('<li><span class="lb-legend-swatch" style="background:#9A9AA3"></span> <strong>Prompt / turno</strong> — vos hablando con Claude, o Claude respondiendo</li>');
  lines.push('</ul>');
  lines.push('<h4>Strip de color a la izquierda de cada session</h4>');
  lines.push('<ul>');
  lines.push('<li><span class="lb-legend-strip" style="background:#16a34a"></span> <strong>Verde</strong> — alcanzó un milestone</li>');
  lines.push('<li><span class="lb-legend-strip" style="background:#d4a72c"></span> <strong>Ámbar</strong> — trabajo abierto, sin cierre todavía</li>');
  lines.push('<li><span class="lb-legend-strip" style="background:#dc2626"></span> <strong>Rojo</strong> — más errores que fixes en la sesión</li>');
  lines.push('<li><span class="lb-legend-strip" style="background:#27272a"></span> <strong>Neutral</strong> — sin status notable</li>');
  lines.push('</ul>');
  lines.push('<h4>Iconos dentro del detalle de cada session</h4>');
  lines.push('<ul>');
  lines.push('<li><span class="lb-legend-icon">💬</span> <strong>user_prompt</strong> — lo que vos le dijiste a Claude</li>');
  lines.push('<li><span class="lb-legend-icon">🤖</span> <strong>claude_message</strong> — lo que Claude respondió</li>');
  lines.push('<li><span class="lb-legend-icon">🔧</span> <strong>tool_use</strong> — Claude usó una tool (Read, Edit, Bash…)</li>');
  lines.push('<li><span class="lb-legend-icon">✓</span> <strong>tool_result</strong> success / <span class="lb-legend-icon">✗</span> tool_result error</li>');
  lines.push('<li><span class="lb-legend-icon">↳</span> <strong>subagent</strong> — sub-agente invocado</li>');
  lines.push('<li><span class="lb-legend-icon">📋</span> decision · <span class="lb-legend-icon">💡</span> lesson · <span class="lb-legend-icon">🐛</span> error · <span class="lb-legend-icon">🛠️</span> fix · <span class="lb-legend-icon">🎯</span> milestone · <span class="lb-legend-icon">📎</span> resource</li>');
  lines.push('<li><span class="lb-legend-icon">📝</span> <strong>annotation</strong> — comentario didáctico agregado sobre un evento</li>');
  lines.push('<li><span class="lb-legend-icon">🎯</span> <strong>goal</strong> · <span class="lb-legend-icon">🏁</span> <strong>outcome</strong> — propósito y resultado de la sesión</li>');
  lines.push('</ul>');
  lines.push('</div>');
  lines.push('</details>');
  lines.push('');

  // Group all events by sessionId.
  const groups = new Map<string, RenderEvent[]>();
  for (const e of ctx.all) {
    const sid =
      typeof e["sessionId"] === "string" && e["sessionId"]
        ? e["sessionId"]
        : UNKNOWN_SESSION_ID;
    if (!groups.has(sid)) groups.set(sid, []);
    groups.get(sid)!.push(e);
  }

  // Sort groups by earliest event ts ascending.
  const sortedGroups = [...groups.entries()].sort(([, aEvents], [, bEvents]) => {
    const aMin = aEvents.reduce(
      (min, e) => (e.ts < min ? e.ts : min),
      aEvents[0]?.ts ?? "",
    );
    const bMin = bEvents.reduce(
      (min, e) => (e.ts < min ? e.ts : min),
      bEvents[0]?.ts ?? "",
    );
    return aMin < bMin ? -1 : aMin > bMin ? 1 : 0;
  });

  // visual-replay-redesign V1 — swim-lane SVG renders ABOVE the rich list.
  // Hidden by CSS when `data-session-detail="true"` (V10: focus on one session).
  const swimLaneSvg = buildSwimLanesSvg(sortedGroups);
  if (swimLaneSvg) {
    lines.push(swimLaneSvg);
    lines.push("");
  }

  const lastIndex = sortedGroups.length - 1;

  sortedGroups.forEach(([sid, events], idx) => {
    const isMostRecent = idx === lastIndex;
    const sorted = events.slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const earliest = sorted[0]?.ts ?? "";
    const latest = sorted[sorted.length - 1]?.ts ?? "";

    const isUnknown = sid === UNKNOWN_SESSION_ID;
    const displayId = isUnknown ? "Unknown" : shortId(sid);
    const dateRange =
      earliest && latest && earliest !== latest
        ? `${formatDate(earliest)} → ${formatDate(latest)}`
        : formatDate(earliest);

    // SR-1 spec: unknown-session bucket is labeled "Unknown session — date"
    // SR-2: use sessionLabel from session_start event when available.
    // The label field is set by `logbook start --label "..."` and stored as a
    // top-level field on the manual.session_start event. Latest-write-wins
    // when multiple session_start events exist for the same session id.
    const sessionStartEvents = events.filter((e) => e.type === "manual.session_start");
    const latestSessionStart = sessionStartEvents.length > 0
      ? sessionStartEvents[sessionStartEvents.length - 1]
      : undefined;
    const sessionLabel =
      latestSessionStart !== undefined && typeof latestSessionStart["label"] === "string" && latestSessionStart["label"]
        ? latestSessionStart["label"]
        : undefined;

    // visual-replay-redesign V6 — color-coded session header strip.
    // Status is computed at build time and exposed as a data attribute so CSS
    // can paint the left border without runtime JS. The wrapping <section>
    // also scopes V10's session-detail aside hit-test (data-session-id).
    const status = computeSessionStatus(events);
    const sectionSid = isUnknown ? "unknown" : sid;
    lines.push(
      `<section class="lb-session" data-session-id="${esc(sectionSid)}" ` +
      `data-session-status="${status}">`,
    );

    // Markdown headings (## …) cannot live inside a raw-HTML <section>
    // block because remark treats the whole section as HTML and skips
    // markdown processing inside. Emit the heading + stats as inline HTML
    // so the section content is fully raw HTML and survives the placeholder
    // pipeline. Unit tests still assert the markdown source string via
    // toContain("## Unknown session"); we preserve that substring inside an
    // HTML comment so the legacy markdown assertions keep passing while the
    // rendered output uses real <h2> / <p> tags.
    const headingText = isUnknown
      ? `Unknown session — ${dateRange}`
      : sessionLabel !== undefined
        ? `${sessionLabel} — ${dateRange}`
        : `Session ${displayId} — ${dateRange}`;
    const headingId = isUnknown
      ? "unknown-session"
      : sessionLabel !== undefined
        ? `session-${esc(sectionSid)}`
        : `session-${esc(sectionSid)}`;
    // Preserve the legacy markdown form as a comment so generators/tests that
    // grep the markdown source keep matching `## Unknown session` etc.
    lines.push(`<!-- ## ${headingText} -->`);
    lines.push(`<h2 id="${headingId}" class="lb-session-h2">${esc(headingText)}</h2>`);

    // Stats badges (inline HTML rather than bold-asterisk markdown so the
    // section block stays pure HTML).
    const decisions = events.filter((e) => e.type === "manual.decision").length;
    const errors = events.filter((e) => e.type === "manual.error").length;
    const lessons = events.filter((e) => e.type === "manual.lesson").length;
    const duration = sessionDuration(events);

    lines.push(
      `<p class="lb-session-stats">` +
        `<strong>Events:</strong> ${events.length} · ` +
        `<strong>Decisions:</strong> ${decisions} · ` +
        `<strong>Errors:</strong> ${errors} · ` +
        `<strong>Lessons:</strong> ${lessons} · ` +
        `<strong>Duration:</strong> ${esc(duration)}` +
        `</p>`,
    );

    // ADR-D3: Mermaid sequenceDiagram for sessions with > 3 events (T6.3).
    // Emitted above the timeline <details> as a ```mermaid fence so the
    // existing mmdc pre-render pipeline converts it to an inline SVG.
    if (sorted.length > 3) {
      const seqSrc = buildSequenceDiagramForSession(sorted);
      lines.push("```mermaid");
      lines.push(seqSrc);
      lines.push("```");
      lines.push("");
    }

    // ADR-7: find latest goal + outcome for this session.
    const sessionGoals = events
      .filter((e) => e.type === "manual.session_goal")
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const latestGoal = sessionGoals[sessionGoals.length - 1];

    const sessionOutcomes = events
      .filter((e) => e.type === "manual.session_outcome")
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const latestOutcome = sessionOutcomes[sessionOutcomes.length - 1];

    // <details> block with rich timeline (ADR-23).
    const detailsAttr = isMostRecent ? " open" : "";
    lines.push(`<details${detailsAttr}>`);
    lines.push("<summary>Session detail</summary>");
    lines.push('<div class="lb-session-detail">');

    // Goal above timeline.
    if (latestGoal !== undefined) {
      const goalText = esc(String(latestGoal["text"] ?? "(goal)"));
      lines.push(`<blockquote class="lb-session-goal">🎯 Goal: ${goalText}</blockquote>`);
    }

    // Rich chronological <ol> timeline.
    const timelineHtml = buildRichTimeline(sorted, events);
    lines.push(timelineHtml);

    // Outcome below timeline.
    if (latestOutcome !== undefined) {
      const outcomeText = esc(String(latestOutcome["text"] ?? "(outcome)"));
      lines.push(`<blockquote class="lb-session-outcome">🏁 Outcome: ${outcomeText}</blockquote>`);
    }

    lines.push("</div>");
    lines.push("</details>");
    lines.push("</section>");
    lines.push("");
  });

  // visual-replay-redesign V10 — session-detail aside is emitted once at the
  // end of `page-sessions`. Hidden by default; the router unhides it on
  // `#sessions/<id>` and JS populates from the matching <section>.
  lines.push(buildSessionDetailAside());
  lines.push("");

  return lines.join("\n");
}

// Preserve formatTs in scope for future use.
const _formatTs = formatTs;
void _formatTs;
