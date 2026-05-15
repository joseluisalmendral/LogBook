/**
 * Idempotent markdown block insertion and removal.
 *
 * Markers (byte-exact):
 *   start: <!-- logbook:generated start v=N -->
 *   end:   <!-- logbook:generated end -->
 *
 * Invariant: bytes outside the matched block span are preserved verbatim.
 */

// Re-export error types from json-string-patch for symmetry; S6 re-exports from errors.ts.
export { AnchorAmbiguousError } from "./json-string-patch.js";

/**
 * Finder regex — matches any v=N start marker. Captures: [1]=version [2]=body.
 * Flags: g (global), s flag equivalent via [\s\S] since we need dotall.
 */
const BLOCK_RE =
  /<!--\s*logbook:generated start v=(\d+)\s*-->([\s\S]*?)<!--\s*logbook:generated end\s*-->/g;

function makeStartMarker(version: number): string {
  return `<!-- logbook:generated start v=${version} -->`;
}

const END_MARKER = "<!-- logbook:generated end -->";

function countMatches(input: string): number {
  BLOCK_RE.lastIndex = 0;
  let count = 0;
  while (BLOCK_RE.exec(input) !== null) count++;
  return count;
}

// ---------------------------------------------------------------------------
// AnchorAmbiguousError (local alias — the import above re-exports it)
// ---------------------------------------------------------------------------

import { AnchorAmbiguousError as _AmbiguousError } from "./json-string-patch.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface UpsertMarkdownBlockResult {
  /** Updated file content. */
  next: string;
  /** True if a leading `\n` was prepended before the block (non-empty, no trailing newline). */
  addedLeadingNewline: boolean;
  /** Whether the block was appended (new) or replaced (existing). */
  mode: "appended" | "replaced";
}

/**
 * Insert or replace the logbook generated block in `input`.
 *
 * - 0 matches: append the block at end of file. Adds a leading `\n` if the
 *   file is non-empty and does not already end with `\n`.
 * - 1 match: replace the existing block in-place. Surrounding bytes untouched.
 * - 2+ matches: throws AnchorAmbiguousError.
 */
export function upsertMarkdownBlock(
  input: string,
  content: string,
  opts: { markerVersion: number }
): UpsertMarkdownBlockResult {
  const { markerVersion } = opts;
  const startMarker = makeStartMarker(markerVersion);
  const block = `${startMarker}\n${content}\n${END_MARKER}`;

  const matchCount = countMatches(input);

  if (matchCount >= 2) {
    throw new _AmbiguousError(
      `Found ${matchCount} logbook:generated blocks; expected 0 or 1`
    );
  }

  if (matchCount === 0) {
    // Append
    const needsLeadingNewline = input !== "" && !input.endsWith("\n");
    const prefix = needsLeadingNewline ? "\n" : "";
    const next = `${input}${prefix}${block}\n`;
    return {
      next,
      addedLeadingNewline: needsLeadingNewline,
      mode: "appended",
    };
  }

  // Exactly 1 match — replace
  BLOCK_RE.lastIndex = 0;
  const match = BLOCK_RE.exec(input);
  if (!match) {
    throw new Error("Internal: countMatches said 1 but exec found none");
  }

  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;

  const next =
    input.slice(0, matchStart) + block + input.slice(matchEnd);

  return { next, addedLeadingNewline: false, mode: "replaced" };
}

/**
 * Remove the logbook generated block from `input`.
 *
 * - 0 matches: returns input unchanged (idempotent).
 * - 1 match: removes the block and adjusts surrounding newlines to restore
 *   byte-identity when paired with upsertMarkdownBlock.
 * - 2+ matches: throws AnchorAmbiguousError.
 *
 * @param addedLeadingNewline Pass the value recorded during upsert. When true,
 *   the `\n` immediately preceding the block is also removed (it was added by
 *   upsert because the file didn't end with `\n`).
 */
export function removeMarkdownBlock(
  input: string,
  opts: { markerVersion: number; addedLeadingNewline?: boolean }
): string {
  const { addedLeadingNewline = false } = opts;

  const matchCount = countMatches(input);

  if (matchCount === 0) {
    return input; // idempotent
  }

  if (matchCount >= 2) {
    throw new _AmbiguousError(
      `Found ${matchCount} logbook:generated blocks; cannot remove`
    );
  }

  BLOCK_RE.lastIndex = 0;
  const match = BLOCK_RE.exec(input);
  if (!match) {
    throw new Error("Internal: countMatches said 1 but exec found none");
  }

  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;

  // Determine what to remove:
  // The block itself spans [matchStart, matchEnd).
  // upsertMarkdownBlock always appended a trailing \n after the block when
  // mode=appended. When mode=replaced, the trailing \n was already in the
  // source (outside our span) so we don't touch it.
  //
  // For restored byte-identity:
  //   - mode=appended on empty: block + \n was appended → remove block + trailing \n
  //   - mode=appended on non-empty (no trailing \n): \n + block + \n → remove \n + block + \n
  //   - mode=appended on non-empty (had trailing \n): block + \n appended → remove block + \n
  //   - mode=replaced: only the block bytes were replaced → remove exactly the block bytes,
  //     leaving surrounding bytes (including newlines outside) intact.
  //
  // We can distinguish appended vs replaced by: addedLeadingNewline is only set
  // during appended mode. But we also need to know whether we're in appended or
  // replaced mode from other context.
  //
  // Strategy: since this function doesn't receive "mode", we infer from position:
  //   - If matchEnd === input.length OR matchEnd === input.length - 1 (trailing \n), we were appended.
  //   - Otherwise we were replaced (block is in the middle).
  //
  // More robust: look at what's immediately after the match:
  //   - If there is a \n right after the match end, it was put there by upsert (trailing newline
  //     of the block). Remove it.
  //   - Then if addedLeadingNewline, also remove the \n before the match.

  let removeStart = matchStart;
  let removeEnd = matchEnd;

  // Determine appended vs replaced mode.
  //
  // upsert appended mode writes: original + [leading\n] + block + "\n"
  //   The regex does NOT include that trailing \n. So in appended mode,
  //   matchEnd points at a \n followed by end-of-string.
  //
  // upsert replaced mode writes: prefix + block + suffix_unchanged
  //   In this case matchEnd points at whatever was already after the original
  //   block — that could also be a \n, but it belongs to the file.
  //
  // Reliable signal for appended mode: the block is at the very end of the
  // file (matchEnd + 1 === input.length with a \n at matchEnd, or
  // matchEnd === input.length with no trailing \n — but the latter can't
  // happen since we always append a \n).
  //
  // addedLeadingNewline is only set during appended mode, so it is sufficient
  // for the "original had no trailing newline" case. The remaining appended
  // case is "original had a trailing newline" — here addedLeadingNewline=false
  // but matchEnd + 1 === input.length && input[matchEnd] === '\n'.

  const hasTrailingNewlineAtEnd =
    matchEnd < input.length &&
    input[matchEnd] === "\n" &&
    matchEnd + 1 === input.length;

  const isAppendedMode = addedLeadingNewline || hasTrailingNewlineAtEnd;

  if (isAppendedMode && input[matchEnd] === "\n") {
    // Remove the trailing \n we added during appended mode
    removeEnd = matchEnd + 1;
  }

  if (addedLeadingNewline) {
    // Remove the leading \n that was prepended before the block
    if (removeStart > 0 && input[removeStart - 1] === "\n") {
      removeStart -= 1;
    }
  }

  return input.slice(0, removeStart) + input.slice(removeEnd);
}
