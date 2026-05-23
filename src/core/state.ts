/**
 * Read/write .logbook/state.json — diagnostic state, NOT load-bearing.
 *
 * Design choices:
 * - Writes use tmpfile + rename for atomicity (sync I/O — state writes are
 *   infrequent and blocking briefly here is acceptable; avoids the event-loop
 *   complexity of async rename with signal handling).
 * - Reads always return a valid default on any failure (missing file or
 *   malformed JSON) because state is advisory only; a corrupted state file
 *   must never crash the tool.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface LogBookState {
  version: 1;
  disabled: boolean;
  lastError?: { code: string; message: string; at: string };
  warnings: string[];           // non-fatal issues recorded by hook or doctor
  staleLocksReleased: number;   // counter for ops observability
  /** Current session id (set by `logbook start` or the MCP phase tool). */
  session?: string;
  /** Human-readable label for the current session (set by `logbook start --label` or `logbook session rename`). */
  sessionLabel?: string;
  /** Active phase name (set by `logbook phase` or `logbook_phase` MCP tool). */
  currentPhase?: string;
  /** Monotonic ADR counter; incremented atomically on each decision capture. */
  adrCounter?: number;
  /** Optional cache: last built SessionStart summary string. iter4 — rebuilt on each hook call, not used for caching in iter4. */
  lastSummary?: string;
  /**
   * Cached git HEAD SHA captured at SessionStart (v1.1 S2.3).
   * Set once per session by the SessionStart hook; subsequent hook events
   * read from this cached value (0ms, no subprocess). Manual commands call
   * getGitSha() fresh at invocation time.
   */
  gitSha?: string;
  /**
   * ISO8601 timestamp when gitSha was last captured (v1.1 S2.3).
   * Stored alongside gitSha so callers can detect session boundaries.
   */
  gitShaCapturedAt?: string;
  /**
   * Per-session byte cursor into the Claude Code transcript file.
   * Key = sessionId; value = byte offset already consumed by the scraper.
   * Also stores per-subagent cursors with key = "<sessionId>:sub:<agentId>".
   * Forward-compat: missing field treated as {} (no cursors).
   * Capped at 500 entries (LRU prune by ULID timestamp prefix).
   */
  transcriptCursors?: Record<string, number>;
}

export function defaultState(): LogBookState {
  return {
    version: 1,
    disabled: false,
    warnings: [],
    staleLocksReleased: 0,
  };
}

/**
 * Read state from disk. Returns defaultState() if the file is missing or
 * contains malformed JSON — state must never block the tool from running.
 */
export function readState(statePath: string): LogBookState {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    if (!raw.trim()) return defaultState();
    return JSON.parse(raw) as LogBookState;
  } catch {
    return defaultState();
  }
}

/**
 * Write state atomically via tmpfile + rename.
 *
 * Ensures the parent directory exists before writing. The tmpfile approach
 * guarantees readers always see a complete file or the previous version,
 * never a partial write.
 */
export function writeState(statePath: string, state: LogBookState): void {
  const dir = path.dirname(statePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = `${statePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, statePath);
}
