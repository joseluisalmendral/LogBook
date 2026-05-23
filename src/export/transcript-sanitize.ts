/**
 * transcript-sanitize.ts — server-side sanitizer for raw Claude Code transcripts
 * embedded in the single-file HTML export (slice 12, Bucket D, ADR-SC-D2).
 *
 * Contract:
 *   - PASSIVE per INV-1: this module reads JSONL lines that Claude Code already
 *     persisted on disk. It does NOT touch capture/MCP/hook semantics.
 *   - Secret redaction MUST run BEFORE truncation, otherwise truncation could
 *     hide a partial secret mid-token. Reuses `src/redact/redactor.ts` so the
 *     Gitleaks-derived rule set + Shannon entropy pass stay in lockstep with
 *     the rest of the project (no duplicate regexes per CLAUDE.md §31).
 *   - Bytes are measured as UTF-8 byte length (`Buffer.byteLength`), not JS
 *     string length, because the per-event 4KB / per-session 512KB caps from
 *     ADR-SC-D2 are a payload-size promise.
 *
 * Spec references: R-66 (transcript field exists), R-69 partial (sanitize and
 * truncate caps), INV-17 (virtualization budget — sets ceiling), INV-18
 * (register containment — frontend concern, not enforced here).
 *
 * Mirror: `apps/export-ui/src/lib/types.ts` re-exports the *types* (not the
 * code) so the UI bundle can consume `payload.transcripts` without dragging
 * the Node-only `src/redact/*` import graph into Vite.
 */

import { redact } from "../redact/redactor.js";

// ---------------------------------------------------------------------------
// Public types — MUST stay in sync with `apps/export-ui/src/lib/types.ts`.
// ---------------------------------------------------------------------------

/**
 * Roles we surface to the UI. The raw JSONL files use a wider role vocabulary
 * (e.g. "user", "assistant", "system"); attachment / hook events become "tool".
 */
export type SanitizedRole = "user" | "assistant" | "system" | "tool";

/**
 * Event type the UI uses to pick a renderer. Mapped from the raw record's
 * `type` / `message.role` / `attachment` fields by `mapEventKind()`.
 */
export type SanitizedKind =
  | "message"
  | "tool_use"
  | "tool_result"
  | "thinking"
  | "meta";

export interface SanitizedTranscriptEvent {
  /** Stable id — original `uuid` when present, otherwise a derived hash. */
  id: string;
  /** ms epoch — Date.parse() of the original timestamp, or 0 if missing. */
  timestamp: number;
  role: SanitizedRole;
  type: SanitizedKind;
  /** Tool name when type is tool_use / tool_result. */
  name?: string;
  /** UTF-8 truncated and secret-redacted content. */
  content: string;
  /** True if the content field was capped at perEventMaxBytes. */
  truncated: boolean;
  /** Names of fields dropped to fit the per-event byte budget. */
  droppedFields?: string[];
}

export interface SanitizedTranscript {
  sessionId: string;
  events: SanitizedTranscriptEvent[];
  /** Byte position at which the session was capped (null when not hit). */
  truncatedAtBytes: number | null;
  /** Count of noise events dropped (TaskUpdate frames etc.). */
  droppedEvents: number;
  originalEventCount: number;
  sanitizedEventCount: number;
}

export interface SanitizeOpts {
  /** Default: 4096 (4 KB) — per-event content cap after redaction. */
  perEventMaxBytes?: number;
}

export interface SessionSanitizeOpts extends SanitizeOpts {
  /** Default: 524288 (512 KB) — sum of sanitized event JSON sizes. */
  perSessionMaxBytes?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PER_EVENT_MAX_BYTES = 4096;
const DEFAULT_PER_SESSION_MAX_BYTES = 524288;

/**
 * head + tail size for over-cap `tool_result.stdout` payloads. 512 bytes on
 * each side keeps enough context to identify what the tool did without
 * embedding the full log.
 */
const TOOL_STDOUT_HEAD_TAIL_BYTES = 512;
const TOOL_STDOUT_CAP_BYTES = 4096;

/**
 * Raw event types we treat as "noise" and drop entirely. These are internal
 * progress signals from Claude Code's TaskUpdate stream, plus permission /
 * mode-switch heartbeats. They have no readable content for a course replay.
 *
 * The allowlist (KEEP_TYPES) below is authoritative; anything not on it AND
 * not in `DROP_TYPES` falls through to the meta bucket so we can audit it
 * later without losing the event.
 */
const DROP_TYPES = new Set([
  "task-update",
  "TaskUpdate",
  "permission-mode",
  "last-prompt",
  "heartbeat",
  "summary",
]);

const KEEP_TYPES = new Set([
  "user",
  "assistant",
  "system",
  "tool",
  "tool_use",
  "tool_result",
  "thinking",
  "attachment",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** Truncate a UTF-8 string to N bytes without splitting a code point. */
function truncateUtf8(s: string, maxBytes: number): string {
  if (byteLength(s) <= maxBytes) return s;
  // Walk back from maxBytes until the slice is valid UTF-8.
  const buf = Buffer.from(s, "utf8");
  let cut = Math.min(maxBytes, buf.length);
  // Skip continuation bytes (0x80..0xBF) so we land on a code-point boundary.
  while (cut > 0 && cut < buf.length && (buf[cut]! & 0xc0) === 0x80) cut--;
  return buf.slice(0, cut).toString("utf8");
}

/**
 * For `tool_result.stdout` blocks that exceed `TOOL_STDOUT_CAP_BYTES`, keep
 * a head + tail window with a single inline marker. The head/tail boundaries
 * are byte-safe via `truncateUtf8`.
 */
function headTailTrim(s: string): string {
  const total = byteLength(s);
  if (total <= TOOL_STDOUT_CAP_BYTES) return s;
  const head = truncateUtf8(s, TOOL_STDOUT_HEAD_TAIL_BYTES);
  // Tail: reverse + truncate + reverse keeps us byte-safe without slicing
  // from the right (which could land mid-codepoint).
  const buf = Buffer.from(s, "utf8");
  const tailStart = Math.max(0, buf.length - TOOL_STDOUT_HEAD_TAIL_BYTES);
  const tailBuf = buf.slice(tailStart);
  // Re-anchor: if the tail starts mid-codepoint, advance until valid.
  let off = 0;
  while (off < tailBuf.length && (tailBuf[off]! & 0xc0) === 0x80) off++;
  const tail = tailBuf.slice(off).toString("utf8");
  const dropped = total - byteLength(head) - byteLength(tail);
  return `${head}\n... [truncated ${dropped} bytes] ...\n${tail}`;
}

function stableId(raw: Record<string, unknown>): string {
  for (const k of ["uuid", "id", "messageId", "leafUuid"]) {
    const v = raw[k];
    if (typeof v === "string" && v) return v;
  }
  // Fall back to a fingerprint of the JSON itself — stable across runs.
  const json = JSON.stringify(raw);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return `t-${(h >>> 0).toString(36)}`;
}

function parseTimestamp(raw: Record<string, unknown>): number {
  const ts = raw["timestamp"] ?? raw["ts"] ?? raw["createdAt"];
  if (typeof ts === "string") {
    const t = Date.parse(ts);
    if (!Number.isNaN(t)) return t;
  }
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  return 0;
}

function mapRole(raw: Record<string, unknown>): SanitizedRole {
  const msg = raw["message"];
  if (msg && typeof msg === "object") {
    const r = (msg as Record<string, unknown>)["role"];
    if (r === "user" || r === "assistant" || r === "system") return r;
  }
  const direct = raw["role"];
  if (direct === "user" || direct === "assistant" || direct === "system") return direct;
  return "tool";
}

function mapKind(raw: Record<string, unknown>): SanitizedKind {
  const t = typeof raw["type"] === "string" ? (raw["type"] as string) : "";
  if (t === "thinking") return "thinking";
  if (t === "tool_use") return "tool_use";
  if (t === "tool_result") return "tool_result";
  if (t === "attachment") return "tool_result";
  if (t === "user" || t === "assistant" || t === "system") return "message";
  // assistant messages carrying tool_use content blocks come through as
  // `type: "assistant"` with `message.content[].type = "tool_use"` — surface
  // them as messages; the tool_use blocks live inside content.
  return "meta";
}

function extractToolName(raw: Record<string, unknown>): string | undefined {
  // Direct: tool_use / tool_result records.
  for (const k of ["name", "toolName", "tool"]) {
    const v = raw[k];
    if (typeof v === "string" && v) return v;
  }
  const att = raw["attachment"];
  if (att && typeof att === "object") {
    const a = att as Record<string, unknown>;
    for (const k of ["toolName", "name", "hookName"]) {
      const v = a[k];
      if (typeof v === "string" && v) return v;
    }
  }
  return undefined;
}

/**
 * Coalesce the various places where raw content lives in Claude Code's JSONL
 * format into one string. We avoid embedding the whole record JSON because
 * the per-event byte budget assumes only meaningful text crosses the wire.
 */
function extractContent(
  raw: Record<string, unknown>,
  kind: SanitizedKind,
): { text: string; droppedFields: string[] } {
  const dropped: string[] = [];

  // Message-shaped events: pull message.content (array of blocks) or string.
  const msg = raw["message"];
  if (msg && typeof msg === "object") {
    const m = msg as Record<string, unknown>;
    if (typeof m["content"] === "string") return { text: m["content"], droppedFields: dropped };
    if (Array.isArray(m["content"])) {
      const parts: string[] = [];
      for (const block of m["content"] as unknown[]) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (typeof b["text"] === "string") parts.push(b["text"]);
        else if (typeof b["input"] === "string") parts.push(b["input"]);
        else if (b["input"] && typeof b["input"] === "object") {
          try {
            parts.push(JSON.stringify(b["input"]));
          } catch {
            dropped.push("message.content[].input");
          }
        } else if (typeof b["content"] === "string") parts.push(b["content"]);
        else if (Array.isArray(b["content"])) {
          // tool_result blocks nest another content array.
          for (const sub of b["content"] as unknown[]) {
            if (sub && typeof sub === "object") {
              const s = sub as Record<string, unknown>;
              if (typeof s["text"] === "string") parts.push(s["text"]);
            }
          }
        }
      }
      return { text: parts.join("\n"), droppedFields: dropped };
    }
  }

  // Tool-shaped events at the top level (older JSONL format).
  if (kind === "tool_result") {
    const att = raw["attachment"];
    if (att && typeof att === "object") {
      const a = att as Record<string, unknown>;
      // Apply the special head+tail trim BEFORE the per-event truncate so we
      // do not throw away potentially-useful tail context.
      const stdout = typeof a["stdout"] === "string" ? a["stdout"] : "";
      const stderr = typeof a["stderr"] === "string" ? a["stderr"] : "";
      const stdoutTrim = stdout ? headTailTrim(stdout) : "";
      const stderrTrim = stderr ? headTailTrim(stderr) : "";
      const out = [stdoutTrim, stderrTrim].filter(Boolean).join("\n");
      if (out) return { text: out, droppedFields: dropped };
    }
    const result = raw["result"];
    if (typeof result === "string") return { text: result, droppedFields: dropped };
    if (result && typeof result === "object") {
      try {
        return { text: JSON.stringify(result), droppedFields: dropped };
      } catch {
        dropped.push("result");
      }
    }
  }

  if (kind === "tool_use") {
    const input = raw["input"];
    if (typeof input === "string") return { text: input, droppedFields: dropped };
    if (input && typeof input === "object") {
      try {
        return { text: JSON.stringify(input), droppedFields: dropped };
      } catch {
        dropped.push("input");
      }
    }
  }

  // Generic fallback for unrecognised shapes.
  for (const k of ["content", "text", "summary", "value"]) {
    const v = raw[k];
    if (typeof v === "string") return { text: v, droppedFields: dropped };
  }
  return { text: "", droppedFields: dropped };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize a single raw transcript event.
 *
 * Returns `null` when the event is noise (TaskUpdate / heartbeat / permission
 * mode etc.) and should be dropped entirely. The caller increments a
 * `droppedEvents` counter on null returns.
 *
 * Order of operations (LOCKED):
 *   1. Drop if type is on `DROP_TYPES` allowlist of noise.
 *   2. Extract role / kind / tool name / content from the raw shape.
 *   3. REDACT secrets before any truncation (so partial-token bleed is impossible).
 *   4. Truncate the redacted content to `perEventMaxBytes` (UTF-8 byte-safe).
 *   5. Build the SanitizedTranscriptEvent and return.
 */
export function sanitizeTranscriptEvent(
  rawEvent: unknown,
  opts: SanitizeOpts = {},
): SanitizedTranscriptEvent | null {
  if (!rawEvent || typeof rawEvent !== "object") return null;
  const raw = rawEvent as Record<string, unknown>;
  const perEventMaxBytes = opts.perEventMaxBytes ?? DEFAULT_PER_EVENT_MAX_BYTES;

  const rawType = typeof raw["type"] === "string" ? (raw["type"] as string) : "";
  if (rawType && DROP_TYPES.has(rawType)) return null;

  // attachment events that wrap noise hooks (e.g. SessionStart heartbeats with
  // empty stdout) are dropped too — they carry no readable content.
  if (rawType === "attachment") {
    const att = raw["attachment"];
    if (att && typeof att === "object") {
      const a = att as Record<string, unknown>;
      const hookEvent = a["hookEvent"];
      const hookName = a["hookName"];
      const stdout = a["stdout"];
      const stderr = a["stderr"];
      const noisy =
        hookEvent === "SessionStart" ||
        (typeof hookName === "string" && hookName.startsWith("SessionStart"));
      const empty =
        (typeof stdout !== "string" || stdout.trim() === "") &&
        (typeof stderr !== "string" || stderr.trim() === "");
      if (noisy && empty) return null;
    }
  }

  const kind = mapKind(raw);
  // Anything that mapped to `meta` AND was not on KEEP_TYPES is dropped.
  if (kind === "meta" && (!rawType || !KEEP_TYPES.has(rawType))) return null;

  const role = mapRole(raw);
  const name = extractToolName(raw);
  const { text, droppedFields } = extractContent(raw, kind);

  // Step 3: redact BEFORE truncate (locked order, see header).
  const { redacted } = redact(text);

  // Step 4: byte-safe truncation.
  const truncatedText = truncateUtf8(redacted, perEventMaxBytes);
  const truncated = byteLength(redacted) > perEventMaxBytes;

  const result: SanitizedTranscriptEvent = {
    id: stableId(raw),
    timestamp: parseTimestamp(raw),
    role,
    type: kind,
    content: truncatedText,
    truncated,
  };
  if (name) result.name = name;
  if (droppedFields.length > 0) result.droppedFields = droppedFields;
  return result;
}

/**
 * Sanitize a whole session's worth of raw events. Applies the per-session
 * byte cap by dropping tail events until the JSON-serialised event array is
 * back under the cap.
 *
 * "Tail" = chronologically latest. This is intentional: the head of the
 * transcript carries the goal + early decisions that frame what follows, so
 * losing the end of a long session preserves the most teachable context. We
 * record `truncatedAtBytes` so the UI can render a banner.
 */
export function sanitizeTranscriptSession(
  rawEvents: unknown[],
  sessionId: string,
  opts: SessionSanitizeOpts = {},
): SanitizedTranscript {
  const perSessionMaxBytes = opts.perSessionMaxBytes ?? DEFAULT_PER_SESSION_MAX_BYTES;

  let droppedEvents = 0;
  const events: SanitizedTranscriptEvent[] = [];
  for (const raw of rawEvents) {
    const ev = sanitizeTranscriptEvent(raw, opts);
    if (ev === null) {
      droppedEvents++;
      continue;
    }
    events.push(ev);
  }

  // Per-session cap: walk forward summing byte sizes; cut when we exceed.
  let runningBytes = 0;
  let truncatedAtBytes: number | null = null;
  const capped: SanitizedTranscriptEvent[] = [];
  for (const ev of events) {
    const size = byteLength(JSON.stringify(ev));
    if (runningBytes + size > perSessionMaxBytes) {
      truncatedAtBytes = runningBytes;
      break;
    }
    runningBytes += size;
    capped.push(ev);
  }

  return {
    sessionId,
    events: capped,
    truncatedAtBytes,
    droppedEvents,
    originalEventCount: rawEvents.length,
    sanitizedEventCount: capped.length,
  };
}
