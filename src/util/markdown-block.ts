/**
 * Idempotent markdown block insertion and removal.
 *
 * Markers (byte-exact) — default family:
 *   start: <!-- logbook:generated start v=N -->
 *   end:   <!-- logbook:generated end -->
 *
 * Named marker families (T11 extension):
 *   start: <!-- <markerName> start v=N -->
 *   end:   <!-- <markerName> end -->
 *
 * Invariant: bytes outside the matched block span are preserved verbatim.
 * Backward compat: callers that omit `markerName` get `"logbook:generated"`.
 */

// Re-export error types from json-string-patch for symmetry; S6 re-exports from errors.ts.
export { AnchorAmbiguousError } from "./json-string-patch.js";

// ---------------------------------------------------------------------------
// AnchorAmbiguousError (local alias — the import above re-exports it)
// ---------------------------------------------------------------------------

import { AnchorAmbiguousError as _AmbiguousError } from "./json-string-patch.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_MARKER_NAME = "logbook:generated";

/**
 * Escape a string for use as a literal pattern inside a RegExp.
 * Covers all special regex chars: . * + ? ^ $ { } [ ] | ( ) \ /
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a finder regex for the given marker family.
 * Captures: [1]=version [2]=body.
 * Flags: g (global).
 */
function makeBlockRe(markerName: string): RegExp {
  const escaped = escapeRegex(markerName);
  return new RegExp(
    `<!--\\s*${escaped} start v=(\\d+)\\s*-->([\\s\\S]*?)<!--\\s*${escaped} end\\s*-->`,
    "g"
  );
}

function makeStartMarker(markerName: string, version: number): string {
  return `<!-- ${markerName} start v=${version} -->`;
}

function makeEndMarker(markerName: string): string {
  return `<!-- ${markerName} end -->`;
}

function countMatches(input: string, re: RegExp): number {
  re.lastIndex = 0;
  let count = 0;
  while (re.exec(input) !== null) count++;
  return count;
}

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
 * Insert or replace a logbook generated block in `input`.
 *
 * - 0 matches: append the block at end of file. Adds a leading `\n` if the
 *   file is non-empty and does not already end with `\n`.
 * - 1 match: replace the existing block in-place. Surrounding bytes untouched.
 * - 2+ matches: throws AnchorAmbiguousError.
 *
 * @param opts.markerName  Marker family name. Default: `"logbook:generated"`.
 *   Different families are fully independent — each uses its own regex.
 *   Iter1 callers omitting this field keep the default `"logbook:generated"` behavior.
 */
export function upsertMarkdownBlock(
  input: string,
  content: string,
  opts: { markerVersion: number; markerName?: string }
): UpsertMarkdownBlockResult {
  const { markerVersion, markerName = DEFAULT_MARKER_NAME } = opts;
  const re = makeBlockRe(markerName);
  const startMarker = makeStartMarker(markerName, markerVersion);
  const endMarker = makeEndMarker(markerName);
  const block = `${startMarker}\n${content}\n${endMarker}`;

  const matchCount = countMatches(input, re);

  if (matchCount >= 2) {
    throw new _AmbiguousError(
      `Found ${matchCount} ${markerName} blocks; expected 0 or 1`
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
  re.lastIndex = 0;
  const match = re.exec(input);
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
 * @param opts.addedLeadingNewline Pass the value recorded during upsert. When true,
 *   the `\n` immediately preceding the block is also removed (it was added by
 *   upsert because the file didn't end with `\n`).
 * @param opts.markerName  Marker family name. Default: `"logbook:generated"`.
 */
export function removeMarkdownBlock(
  input: string,
  opts: {
    markerVersion: number;
    addedLeadingNewline?: boolean;
    markerName?: string;
  }
): string {
  const { addedLeadingNewline = false, markerName = DEFAULT_MARKER_NAME } = opts;
  const re = makeBlockRe(markerName);

  const matchCount = countMatches(input, re);

  if (matchCount === 0) {
    return input; // idempotent
  }

  if (matchCount >= 2) {
    throw new _AmbiguousError(
      `Found ${matchCount} ${markerName} blocks; cannot remove`
    );
  }

  re.lastIndex = 0;
  const match = re.exec(input);
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

  let removeStart = matchStart;
  let removeEnd = matchEnd;

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
