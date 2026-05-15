/**
 * Append and remove exact line blocks in text files (.gitignore-like).
 *
 * All operations are string-only — no file I/O. Byte-identity is preserved
 * for bytes outside the appended/removed span.
 *
 * CRLF limitation: line-set uses LF for joined line content. Appending into
 * a CRLF file produces mixed newlines. This is documented as a known iter1
 * limitation — .gitignore is LF-only by convention.
 */

// Re-export error types for use by callers and S6 errors.ts.
export { AnchorNotFoundError } from "./json-string-patch.js";
import { AnchorNotFoundError } from "./json-string-patch.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AppendLinesInput {
  source: string;
  /** Each line WITHOUT its trailing newline. */
  lines: string[];
}

export interface AppendLinesResult {
  next: string;
  /** True if a `\n` was prepended because source did not end with one. */
  addedLeadingNewline: boolean;
  /** True if a trailing `\n` was appended after the last line. Always true. */
  trailingNewlineAdded: boolean;
}

/**
 * Append `lines` to the end of `source`.
 *
 * - Empty source: result = lines.join("\n") + "\n"
 * - Source ends with \n: result = source + lines.join("\n") + "\n"
 * - Source does not end with \n: result = source + "\n" + lines.join("\n") + "\n"
 */
export function appendLines(input: AppendLinesInput): AppendLinesResult {
  const { source, lines } = input;
  const block = lines.join("\n") + "\n";

  if (source === "") {
    return {
      next: block,
      addedLeadingNewline: false,
      trailingNewlineAdded: true,
    };
  }

  if (source.endsWith("\n")) {
    return {
      next: source + block,
      addedLeadingNewline: false,
      trailingNewlineAdded: true,
    };
  }

  return {
    next: source + "\n" + block,
    addedLeadingNewline: true,
    trailingNewlineAdded: true,
  };
}

export interface RemoveLinesInput {
  source: string;
  lines: string[];
  /** Pass the value from the corresponding appendLines call. */
  addedLeadingNewline?: boolean;
  /** Pass the value from the corresponding appendLines call. Always true when set by appendLines. */
  trailingNewlineAdded?: boolean;
}

/**
 * Remove the contiguous block `lines.join("\n")` from `source`, restoring
 * byte-identity to the pre-append state.
 *
 * Throws AnchorNotFoundError if the block is not found.
 */
export function removeLines(input: RemoveLinesInput): string {
  const {
    source,
    lines,
    addedLeadingNewline = false,
    trailingNewlineAdded = false,
  } = input;

  const block = lines.join("\n");
  const idx = source.indexOf(block);

  if (idx === -1) {
    throw new AnchorNotFoundError(
      `Line block not found in source: ${block.slice(0, 60)}...`
    );
  }

  let removeStart = idx;
  let removeEnd = idx + block.length;

  // Remove the trailing \n that appendLines added after the block
  if (trailingNewlineAdded) {
    if (removeEnd < source.length && source[removeEnd] === "\n") {
      removeEnd++;
    }
  }

  // Remove the leading \n that appendLines prepended before the block
  if (addedLeadingNewline) {
    if (removeStart > 0 && source[removeStart - 1] === "\n") {
      removeStart--;
    }
  }

  return source.slice(0, removeStart) + source.slice(removeEnd);
}
