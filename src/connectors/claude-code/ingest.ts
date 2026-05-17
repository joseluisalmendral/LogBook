/**
 * Full ingest pipeline for Claude Code hook payloads.
 *
 * Sequence:
 *   1. Resolve project root and paths.
 *   2. Read state.json — bail early if disabled (fast path).
 *   3. Parse stdin payload (best-effort; never throws).
 *   4. Resolve session id.
 *   5. Normalize raw payload → Event.
 *   6. Redact string-valued fields recursively (before any persistence).
 *   7. Append the redacted event as a JSONL line.
 */

import { redact } from "../../redact/index.js";
import { normalizeClaudeEvent } from "../../normalize/event.js";
import type { RawClaudeHookPayload } from "../../normalize/event.js";
import { appendJsonl } from "../../store/jsonl.js";
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
 * Recursively walk a value tree and apply redact() to every string.
 * Returns the redacted tree and a boolean indicating whether any hit fired.
 */
function redactDeep(value: unknown): { value: unknown; redactedAny: boolean } {
  if (typeof value === "string") {
    const result = redact(value);
    return { value: result.redacted, redactedAny: result.hits.length > 0 };
  }

  if (Array.isArray(value)) {
    let redactedAny = false;
    const next = value.map((item) => {
      const r = redactDeep(item);
      if (r.redactedAny) redactedAny = true;
      return r.value;
    });
    return { value: next, redactedAny };
  }

  if (value !== null && typeof value === "object") {
    let redactedAny = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = redactDeep(v);
      if (r.redactedAny) redactedAny = true;
      next[k] = r.value;
    }
    return { value: next, redactedAny };
  }

  // Primitives (number, boolean, null, undefined) — pass through unchanged
  return { value, redactedAny: false };
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
  if (!opts.stdinPayload || !opts.stdinPayload.trim()) {
    return { written: false, redacted: false, reason: "empty-stdin" };
  }
  try {
    parsed = JSON.parse(opts.stdinPayload) as RawClaudeHookPayload;
  } catch {
    // Non-JSON input: wrap as a degraded record for forensic logging.
    // hook_event_name is intentionally omitted so mapKind returns "hook_event".
    parsed = { raw_stdin: opts.stdinPayload, parse_error: true };
  }

  // 4. Resolve session id.
  const sessionId =
    opts.sessionId ??
    process.env["LOGBOOK_SESSION_ID"] ??
    ulidFn();

  // 5. Normalize raw payload → Event.
  const event = normalizeClaudeEvent(parsed, {
    sessionId,
    now: nowFn,
    ulid: ulidFn,
  });

  // 6. Redact string-valued fields in the payload tree before persistence.
  //    We walk the payload object recursively so we never write raw secrets to disk.
  const { value: redactedPayload, redactedAny } = redactDeep(event.payload);
  event.payload = redactedPayload as typeof event.payload;
  event.redacted = redactedAny;

  // 7. Serialize and append.
  const line = JSON.stringify(event);
  await appendJsonl(paths.eventsJsonl, line);

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

  return {
    written: true,
    redacted: redactedAny,
    ...(sessionStartSummary !== undefined && { sessionStartSummary }),
  };
}
