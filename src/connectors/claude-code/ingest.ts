/**
 * Full ingest pipeline for Claude Code hook payloads.
 *
 * Sequence:
 *   1. Resolve project root and paths.
 *   2. Read state.json — bail early if disabled (fast path).
 *   3. Parse stdin payload (best-effort; never throws).
 *   4. Resolve session id.
 *   5. Normalize raw payload → Event.
 *   6. Build EventInput and call appendEvent — redaction covers the full event
 *      (payload AND meta) inside appendEvent. No local redactDeep needed.
 *   7. Return result with written/redacted flags.
 */

import { normalizeClaudeEvent } from "../../normalize/event.js";
import type { RawClaudeHookPayload } from "../../normalize/event.js";
import { appendEvent } from "../../store/index.js";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState, writeState } from "../../core/state.js";
import { generateUlid } from "../../util/ulid.js";
import { buildSessionStartSummary } from "../../hooks/session-start.js";
import { getGitSha } from "../../connectors/git.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestOptions {
  /** Raw stdin content (JSON string or JSONL one-liner). */
  stdinPayload: string;
  /** Session id override. Falls back to env LOGBOOK_SESSION_ID, then generated ULID. */
  sessionId?: string;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
  /** Injectable ULID generator for deterministic tests. */
  ulid?: () => string;
  /**
   * Set to true when stdin was cut off by the 150ms timeout (i.e. the read
   * window expired before stdin reached EOF). appendEvent will then set
   * meta.truncated = true on the stored event, independently of parse_error.
   *
   * Truth table (meta flags on stored event):
   *   stdin OK   + JSON OK  → neither flag
   *   stdin OK   + JSON fail → parse_error: true
   *   timedOut   + JSON OK  → truncated: true
   *   timedOut   + JSON fail → truncated: true, parse_error: true
   */
  stdinTruncated?: boolean;
}

export interface IngestResult {
  /** Whether a JSONL line was appended. */
  written: boolean;
  /** Whether any redaction rule fired. */
  redacted: boolean;
  /** Human-readable reason when written=false. */
  reason?: string;
  /**
   * For SessionStart events: the summary printed to stdout for agent context injection.
   * Undefined for all other event kinds.
   *
   * Side effects for SessionStart:
   *   (a) JSONL append — audit trail (same as all other events).
   *   (b) stdout summary — injected into the agent context by Claude Code.
   */
  sessionStartSummary?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a candidate session_id from the Claude hook payload (Req 2.1).
 *
 * Rules:
 *   - Must be a string (typeof guard — catches numeric/object schema drift).
 *   - Trimmed value must be non-empty.
 *   - Trimmed length must be ≤ 128 (defensive cap; Claude UUIDs are ~36 chars).
 *
 * Returns the trimmed value on success, undefined on any failure.
 * Never throws — resolver falls through to the next priority slot.
 */
function extractValidSessionId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return undefined;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function ingestClaudePayload(opts: IngestOptions): Promise<IngestResult> {
  const ulidFn = opts.ulid ?? generateUlid;
  const nowFn = opts.now ?? (() => new Date().toISOString());

  // 1. Resolve paths (resolveProjectRoot may throw if no project marker found;
  //    callers on the hook path catch all errors and exit 0).
  const root = resolveProjectRoot();
  const paths = makePaths(root);

  // 2. Check disabled state BEFORE any heavy work (fast exit when disabled).
  const state = readState(paths.statePath);
  if (state.disabled) {
    return { written: false, redacted: false, reason: "disabled" };
  }

  // 3. Parse payload — best-effort, never throws.
  let parsed: RawClaudeHookPayload;
  let jsonParseFailed = false;
  if (!opts.stdinPayload || !opts.stdinPayload.trim()) {
    return { written: false, redacted: false, reason: "empty-stdin" };
  }
  try {
    parsed = JSON.parse(opts.stdinPayload) as RawClaudeHookPayload;
  } catch {
    // Non-JSON input: wrap as a degraded record for forensic logging.
    // hook_event_name is intentionally omitted so mapKind returns "hook_event".
    parsed = { raw_stdin: opts.stdinPayload, parse_error: true };
    jsonParseFailed = true;
  }

  // 4. Resolve session id (priority: test-injection > Claude payload > env > ULID).
  const sessionId =
    opts.sessionId ??
    extractValidSessionId(parsed.session_id) ??
    process.env["LOGBOOK_SESSION_ID"] ??
    ulidFn();

  // 5. Normalize raw payload → Event.
  const event = normalizeClaudeEvent(parsed, {
    sessionId,
    now: nowFn,
    ulid: ulidFn,
  });

  // 6. Build meta flags: truncated and parse_error are independent facts.
  //    Both can be present simultaneously (timeout often causes parse failure).
  const metaFlags: Record<string, unknown> = { ...(event.meta ?? {}) };
  if (opts.stdinTruncated === true) {
    metaFlags["truncated"] = true;
  }
  if (jsonParseFailed) {
    metaFlags["parse_error"] = true;
  }

  // 7. Route through appendEvent — this covers redaction of the FULL event
  //    (payload AND meta) so event.meta.api_key and similar fields are scrubbed.
  //    The local redactDeep helper is removed; appendEvent owns all redaction.
  const { event: storedEvent, redacted: redactedAny } = await appendEvent(paths, {
    id: event.id,
    traceId: event.traceId,
    spanId: event.spanId,
    ...(event.parentId !== undefined && { parentId: event.parentId }),
    timestamp: event.timestamp,
    kind: event.kind,
    sessionId: event.sessionId,
    provider: event.provider,
    ...(event.model !== undefined && { model: event.model }),
    ...(event.phase !== undefined && { phase: event.phase }),
    payload: event.payload as Record<string, unknown>,
    ...(event.tokens !== undefined && { tokens: event.tokens }),
    ...(event.latencyMs !== undefined && { latencyMs: event.latencyMs }),
    meta: metaFlags,
  });

  // 8. SessionStart dispatch — THREE side effects per design §6 + v1.1 S2.3:
  //    (a) JSONL append (audit) — already done in step 7.
  //    (b) stdout summary — print context memory for Claude Code's agent context injection.
  //    (c) gitSha cache — capture HEAD SHA once and persist to state.json.
  //        Subsequent hook events read gitSha from state (0ms, no subprocess).
  //
  //    This branch runs ONLY for SessionStart. All other events skip it.
  //    Never throws — the hook MUST exit 0. Failures degrade silently.
  let sessionStartSummary: string | undefined;
  if (parsed.hook_event_name === "SessionStart") {
    // (c) Capture and cache gitSha — best-effort, silently degrades.
    try {
      const sha = await getGitSha(paths.root);
      if (sha !== undefined) {
        const currentState = readState(paths.statePath);
        currentState.gitSha = sha;
        currentState.gitShaCapturedAt = new Date().toISOString();
        writeState(paths.statePath, currentState);
      }
    } catch {
      // Degrade silently — hook must never exit non-zero.
      if (process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
        process.stderr.write("[logbook] SessionStart gitSha capture failed\n");
      }
    }

    // (b) Build and emit session context summary.
    try {
      const summaryResult = await buildSessionStartSummary({ paths });
      sessionStartSummary = summaryResult.summary;
      process.stdout.write(summaryResult.summary + "\n");
    } catch {
      // Degrade silently — hook must never exit non-zero.
      if (process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
        process.stderr.write("[logbook] SessionStart summary build failed\n");
      }
    }
  }

  // Suppress unused variable warning for storedEvent (used indirectly via side effects).
  void storedEvent;

  return {
    written: true,
    redacted: redactedAny,
    ...(sessionStartSummary !== undefined && { sessionStartSummary }),
  };
}
