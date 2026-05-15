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
