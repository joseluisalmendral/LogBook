/**
 * String-level JSON patch utilities.
 *
 * Critical invariant: bytes OUTSIDE the inserted/removed span are preserved
 * byte-for-byte. We NEVER call JSON.parse/JSON.stringify on the source string.
 * We may call JSON.parse on entryJson to validate it, but we never
 * re-serialize the source.
 */

import { detectIndent, indentString } from "./indent-detect.js";

// ---------------------------------------------------------------------------
// Error types (re-exported from this module so S6 can import and re-export
// from errors.ts without duplicating the class definition).
// ---------------------------------------------------------------------------

export class AnchorNotFoundError extends Error {
  readonly code = "ANCHOR_NOT_FOUND" as const;
  constructor(message: string) {
    super(message);
    this.name = "AnchorNotFoundError";
  }
}

export class AnchorAmbiguousError extends Error {
  readonly code = "ANCHOR_AMBIGUOUS" as const;
  constructor(message: string) {
    super(message);
    this.name = "AnchorAmbiguousError";
  }
}

// ---------------------------------------------------------------------------
// JSON string tokenizer — tracks byte offsets without JSON.parse on source
// ---------------------------------------------------------------------------

/**
 * State machine that walks a JSON string character by character.
 * Tracks whether the cursor is inside a string literal (and handles
 * escape sequences including unicode escapes) or outside one.
 *
 * Returns the index just past the end of the current JSON value starting
 * at `start`, used to find matching brackets.
 */

type TokenKind = "string" | "object" | "array" | "primitive";

interface Token {
  kind: TokenKind;
  start: number;
  end: number; // exclusive — src.slice(start, end) is the full token
}

/**
 * Given `src` and a position `pos` pointing at the first character of a JSON
 * value, returns the exclusive end offset of that value.
 *
 * Handles: strings (with all escape sequences), objects {}, arrays [],
 * and primitives (number, true, false, null).
 *
 * Throws if the input is malformed JSON at the relevant position.
 */
function skipValue(src: string, pos: number): number {
  pos = skipWhitespace(src, pos);
  if (pos >= src.length) throw new Error("Unexpected end of input");

  const ch = src[pos];

  if (ch === '"') {
    return skipString(src, pos);
  } else if (ch === "{") {
    return skipObject(src, pos);
  } else if (ch === "[") {
    return skipArray(src, pos);
  } else {
    // primitive: number, true, false, null
    return skipPrimitive(src, pos);
  }
}

function skipWhitespace(src: string, pos: number): number {
  while (pos < src.length) {
    const ch = src[pos];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      pos++;
    } else {
      break;
    }
  }
  return pos;
}

/** Skip over a JSON string literal starting at `pos` (which points at `"`). */
function skipString(src: string, pos: number): number {
  if (src[pos] !== '"') throw new Error(`Expected " at ${pos}`);
  pos++; // consume opening "
  while (pos < src.length) {
    const ch = src[pos];
    if (ch === "\\") {
      pos++; // skip the backslash
      if (pos >= src.length) throw new Error("Unexpected end after backslash");
      const esc = src[pos];
      if (esc === "u") {
        // unicode escape: \uXXXX
        pos += 5; // skip u + 4 hex digits
      } else {
        pos++; // skip the escaped character
      }
    } else if (ch === '"') {
      pos++; // consume closing "
      return pos;
    } else {
      pos++;
    }
  }
  throw new Error("Unterminated string");
}

/** Skip over a JSON object `{...}` starting at `pos`. */
function skipObject(src: string, pos: number): number {
  if (src[pos] !== "{") throw new Error(`Expected { at ${pos}`);
  pos++; // consume {
  pos = skipWhitespace(src, pos);
  if (src[pos] === "}") return pos + 1;

  while (pos < src.length) {
    // key
    pos = skipWhitespace(src, pos);
    if (src[pos] !== '"') throw new Error(`Expected key string at ${pos}`);
    pos = skipString(src, pos);
    // colon
    pos = skipWhitespace(src, pos);
    if (src[pos] !== ":") throw new Error(`Expected : at ${pos}`);
    pos++;
    // value
    pos = skipValue(src, pos);
    // comma or }
    pos = skipWhitespace(src, pos);
    if (pos >= src.length) throw new Error("Unexpected end in object");
    if (src[pos] === "}") return pos + 1;
    if (src[pos] !== ",") throw new Error(`Expected , or } at ${pos}, got "${src[pos]}"`);
    pos++; // consume comma
  }
  throw new Error("Unterminated object");
}

/** Skip over a JSON array `[...]` starting at `pos`. */
function skipArray(src: string, pos: number): number {
  if (src[pos] !== "[") throw new Error(`Expected [ at ${pos}`);
  pos++; // consume [
  pos = skipWhitespace(src, pos);
  if (src[pos] === "]") return pos + 1;

  while (pos < src.length) {
    pos = skipValue(src, pos);
    pos = skipWhitespace(src, pos);
    if (pos >= src.length) throw new Error("Unexpected end in array");
    if (src[pos] === "]") return pos + 1;
    if (src[pos] !== ",") throw new Error(`Expected , or ] at ${pos}`);
    pos++;
  }
  throw new Error("Unterminated array");
}

function skipPrimitive(src: string, pos: number): number {
  // true, false, null, or number
  const ch = src[pos];
  if (ch === "t") { return pos + 4; } // true
  if (ch === "f") { return pos + 5; } // false
  if (ch === "n") { return pos + 4; } // null
  // number: consume until a non-number character
  while (pos < src.length) {
    const c = src[pos];
    if (c === "," || c === "}" || c === "]" || c === " " || c === "\t" || c === "\r" || c === "\n") {
      break;
    }
    pos++;
  }
  return pos;
}

// ---------------------------------------------------------------------------
// RFC 6901 JSON Pointer resolver — returns {openBracket, closeBracket} offsets
// ---------------------------------------------------------------------------

/**
 * Walk the source string following a RFC 6901 JSON Pointer (e.g. "/hooks/PostToolUse").
 * Returns the byte offsets of the array's opening `[` and matching closing `]`.
 *
 * Throws AnchorNotFoundError if any segment along the path does not exist.
 */
function resolveArrayPath(
  src: string,
  jsonPath: string
): { openBracket: number; closeBracket: number } {
  const segments = jsonPath
    .split("/")
    .slice(1) // remove leading empty segment from leading /
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));

  // Start at the root value
  let pos = skipWhitespace(src, 0);

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx];
    pos = skipWhitespace(src, pos);

    if (src[pos] !== "{") {
      throw new AnchorNotFoundError(
        `Expected object at offset ${pos} for segment "${seg}"`
      );
    }

    pos++; // consume {
    pos = skipWhitespace(src, pos);

    let found = false;
    while (pos < src.length) {
      pos = skipWhitespace(src, pos);
      if (src[pos] === "}") {
        // Key not found in this object
        break;
      }

      // Read key
      const keyStart = pos;
      const keyEnd = skipString(src, pos);
      const rawKey = src.slice(keyStart + 1, keyEnd - 1); // strip quotes
      // Unescape the key minimally (only \", \\, \/)
      const key = rawKey
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/\//g, "/");

      pos = skipWhitespace(src, keyEnd);
      if (src[pos] !== ":") throw new Error(`Expected : at ${pos}`);
      pos++;

      const valueStart = skipWhitespace(src, pos);

      if (key === seg) {
        // This is the segment we want
        if (segIdx === segments.length - 1) {
          // This is the last segment — it must be an array
          const arrStart = valueStart;
          if (src[arrStart] !== "[") {
            throw new AnchorNotFoundError(
              `Expected array at offset ${arrStart} for path "${jsonPath}"`
            );
          }
          const arrEnd = skipArray(src, arrStart);
          return {
            openBracket: arrStart,
            closeBracket: arrEnd - 1,
          };
        } else {
          // Not the last segment — dive into value
          pos = valueStart;
          found = true;
          break;
        }
      } else {
        // Skip this value
        pos = skipValue(src, valueStart);
        pos = skipWhitespace(src, pos);
        if (src[pos] === ",") {
          pos++;
        }
      }
    }

    if (!found && segIdx < segments.length - 1) {
      throw new AnchorNotFoundError(
        `Key "${seg}" not found in object at offset ${pos}`
      );
    }

    if (!found) {
      throw new AnchorNotFoundError(
        `Key "${segments[segIdx]}" not found in object`
      );
    }
  }

  throw new AnchorNotFoundError(`Path "${jsonPath}" could not be resolved`);
}

// ---------------------------------------------------------------------------
// Array element enumerator
// ---------------------------------------------------------------------------

interface ArrayElement {
  /** Offset of the first char of the element value (after whitespace). */
  valueStart: number;
  /** Exclusive offset just after the element value ends. */
  valueEnd: number;
  /** Offset of the leading whitespace before the element. */
  leadingWsStart: number;
}

/**
 * Walk inside an array (pos points at the char after `[`) and return all
 * element spans. Does NOT include the `[` or `]` characters.
 */
function enumerateArrayElements(
  src: string,
  openBracket: number
): ArrayElement[] {
  const elements: ArrayElement[] = [];
  let pos = openBracket + 1; // skip [

  pos = skipWhitespace(src, pos);

  if (src[pos] === "]") return elements; // empty array

  while (pos < src.length) {
    const leadingWsStart = pos;
    pos = skipWhitespace(src, pos);

    if (src[pos] === "]") break;

    const valueStart = pos;
    const valueEnd = skipValue(src, pos);
    elements.push({ valueStart, valueEnd, leadingWsStart });

    pos = skipWhitespace(src, valueEnd);
    if (src[pos] === "]") break;
    if (src[pos] === ",") {
      pos++; // consume comma
    }
  }

  return elements;
}

// ---------------------------------------------------------------------------
// Indent detection for JSON arrays
// ---------------------------------------------------------------------------

/**
 * Detect the indentation prefix used by elements inside a JSON array.
 * Returns the full indent prefix string (e.g. "      " or "\t\t\t").
 *
 * If the array is empty, returns a 2-space indent relative to the line
 * that contains the `[`.
 */
function detectArrayElementIndent(
  src: string,
  openBracket: number,
  elements: ArrayElement[]
): { elementIndent: string; parentIndent: string } {
  if (elements.length > 0) {
    // Look at the leading whitespace of the first element
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const el = elements[0]!;
    // The indent is the whitespace on the line before valueStart
    // Find the start of the current line
    let lineStart = el.valueStart - 1;
    while (lineStart >= 0 && src[lineStart] !== "\n") lineStart--;
    lineStart++; // point at first char of line (or 0)
    const linePrefix = src.slice(lineStart, el.valueStart);
    // linePrefix should be all whitespace
    if (/^\s+$/.test(linePrefix)) {
      const elementIndent = linePrefix;
      // Parent indent = elementIndent minus one level
      // We detect the indent unit from the source
      const style = detectIndent(src);
      const unit = indentString(style);
      const parentIndent = elementIndent.startsWith(unit)
        ? elementIndent.slice(unit.length)
        : elementIndent.slice(0, Math.max(0, elementIndent.length - 2));
      return { elementIndent, parentIndent };
    }
  }

  // Array is empty — look at the line containing `[`
  let lineStart = openBracket - 1;
  while (lineStart >= 0 && src[lineStart] !== "\n") lineStart--;
  lineStart++;
  const parentLinePrefix = src.slice(lineStart, openBracket);
  const parentIndent = /^\s*$/.test(parentLinePrefix) ? parentLinePrefix.replace(/[^\s]/g, "") : "";
  const style = detectIndent(src);
  const unit = indentString(style);
  return {
    elementIndent: parentIndent + unit,
    parentIndent,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InsertIntoJsonArrayInput {
  /** Full file content as a string (byte-for-byte preserved outside the edit). */
  source: string;
  /** RFC 6901 JSON Pointer ending at the array (e.g. "/hooks/PostToolUse"). */
  jsonPath: string;
  /** JSON text of the element to insert (must be valid JSON). */
  entryJson: string;
}

export interface InsertIntoJsonArrayResult {
  /** Updated source. */
  next: string;
  /** 0-indexed position of the inserted element within the array. */
  position: number;
}

/**
 * Insert a JSON element into an array identified by jsonPath, using only
 * string operations. The source is preserved byte-for-byte outside the
 * insertion span.
 */
export function insertIntoJsonArray(
  input: InsertIntoJsonArrayInput
): InsertIntoJsonArrayResult {
  const { source, jsonPath, entryJson } = input;

  // Validate entryJson is well-formed (we MAY parse the argument, not the source)
  try {
    JSON.parse(entryJson);
  } catch {
    throw new Error(`entryJson is not valid JSON: ${entryJson.slice(0, 80)}`);
  }

  const { openBracket, closeBracket } = resolveArrayPath(source, jsonPath);
  const elements = enumerateArrayElements(source, openBracket);
  const { elementIndent, parentIndent } = detectArrayElementIndent(
    source,
    openBracket,
    elements
  );

  if (elements.length === 0) {
    // Empty array: insert between [ and ]
    const insertion = `\n${elementIndent}${entryJson}\n${parentIndent}`;
    const next =
      source.slice(0, openBracket + 1) +
      insertion +
      source.slice(closeBracket);
    return { next, position: 0 };
  } else {
    // Non-empty: append after last element, before ]
    // Find the end of the last element
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lastEl = elements[elements.length - 1]!;
    // Insertion point: right after lastEl.valueEnd
    // We need to find where trailing whitespace before ] starts
    // and where last element ends
    const insertionPoint = lastEl.valueEnd;
    const insertion = `,\n${elementIndent}${entryJson}`;
    const next =
      source.slice(0, insertionPoint) +
      insertion +
      source.slice(insertionPoint);
    return { next, position: elements.length };
  }
}

export interface RemoveFromJsonArrayInput {
  source: string;
  /** RFC 6901 JSON Pointer ending at the array. */
  jsonPath: string;
  /** The field name used as the unique id (e.g. "_logbookId"). */
  idField: string;
  /** The id value to match (e.g. "lb-hook-posttooluse-001"). */
  idValue: string;
}

/**
 * Remove an element from a JSON array by its id field, using only string
 * operations. Throws AnchorNotFoundError if the element is not found.
 */
export function removeFromJsonArray(
  input: RemoveFromJsonArrayInput
): string {
  const { source, jsonPath, idField, idValue } = input;

  const { openBracket, closeBracket } = resolveArrayPath(source, jsonPath);
  const elements = enumerateArrayElements(source, openBracket);

  // Find the element whose object-level top has idField === idValue
  // We use a string-scan of the element span for the literal pattern.
  const idPattern = new RegExp(
    `"${escapeRegex(idField)}"\\s*:\\s*"${escapeRegex(idValue)}"`
  );

  let targetIdx = -1;
  for (let i = 0; i < elements.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const el = elements[i]!;
    const span = source.slice(el.valueStart, el.valueEnd);
    if (idPattern.test(span)) {
      targetIdx = i;
      break;
    }
  }

  if (targetIdx === -1) {
    throw new AnchorNotFoundError(
      `Element with ${idField}="${idValue}" not found at path "${jsonPath}"`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const target = elements[targetIdx]!;
  const isFirst = targetIdx === 0;
  const isLast = targetIdx === elements.length - 1;
  const isOnly = elements.length === 1;

  if (isOnly) {
    // Remove everything between [ and ], restoring to []
    // Find the exact content between [ and ]
    return (
      source.slice(0, openBracket + 1) +
      source.slice(closeBracket)
    );
  }

  // Multi-element array
  if (isFirst) {
    // Remove from leadingWsStart to just before the next element's leadingWsStart
    // The next element has its own leading whitespace, so we remove this element
    // plus its trailing comma and whitespace up to the next element's indent start.
    //
    // Find the comma after target.valueEnd
    let afterEnd = target.valueEnd;
    afterEnd = skipWhitespace(source, afterEnd);
    // afterEnd should point at the comma
    if (source[afterEnd] === ",") afterEnd++;
    // Now afterEnd points at the whitespace before the next element
    // We want to remove from target.leadingWsStart to afterEnd
    // But we DON'T want to remove the newline that belongs to the next element's indent
    // Actually, the leading ws of this (first) element starts right after `[`
    // We remove: from leadingWsStart to afterEnd
    // That leaves the next element's leading whitespace intact (correct)
    return (
      source.slice(0, target.leadingWsStart) +
      source.slice(afterEnd)
    );
  }

  if (isLast) {
    // Remove the comma + whitespace before this element, and the element itself
    // Find the comma before this element (after the previous element's valueEnd)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const prev = elements[targetIdx - 1]!;
    let commaStart = prev.valueEnd;
    commaStart = skipWhitespace(source, commaStart);
    // commaStart should be at the comma
    // We remove from commaStart to target.valueEnd (exclusive)
    return (
      source.slice(0, commaStart) +
      source.slice(target.valueEnd)
    );
  }

  // Middle element: remove from leadingWsStart to the next element's leadingWsStart
  // (absorbing the trailing comma and the whitespace separator)
  let afterEnd = target.valueEnd;
  afterEnd = skipWhitespace(source, afterEnd);
  if (source[afterEnd] === ",") afterEnd++;
  return (
    source.slice(0, target.leadingWsStart) +
    source.slice(afterEnd)
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// RFC 6901 resolver for OBJECTS (mirrors resolveArrayPath for objects)
// ---------------------------------------------------------------------------

/**
 * Walk the source string following a RFC 6901 JSON Pointer and return the
 * byte offsets of the target OBJECT's opening `{` and matching closing `}`.
 *
 * Throws AnchorNotFoundError if any segment along the path does not exist,
 * or if the final value is not an object.
 */
function resolveObjectPath(
  src: string,
  jsonPath: string
): { openBrace: number; closeBrace: number } {
  const segments = jsonPath
    .split("/")
    .slice(1) // remove leading empty segment
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));

  let pos = skipWhitespace(src, 0);

  // Special case: empty path "" means the root — but RFC 6901 "/" would mean
  // one empty segment. We require at least one segment to be useful here.
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "")) {
    // Root object
    if (src[pos] !== "{") {
      throw new AnchorNotFoundError(`Root value is not an object`);
    }
    const objEnd = skipObject(src, pos);
    return { openBrace: pos, closeBrace: objEnd - 1 };
  }

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx]!;
    pos = skipWhitespace(src, pos);

    if (src[pos] !== "{") {
      throw new AnchorNotFoundError(
        `Expected object at offset ${pos} for segment "${seg}"`
      );
    }

    pos++; // consume {
    pos = skipWhitespace(src, pos);

    let found = false;
    while (pos < src.length) {
      pos = skipWhitespace(src, pos);
      if (src[pos] === "}") break;

      // Read key string
      const keyStart = pos;
      const keyEnd = skipString(src, pos);
      const rawKey = src.slice(keyStart + 1, keyEnd - 1); // strip quotes
      // Decode the key using JSON.parse for correctness (we parse a key span, not the full source)
      let key: string;
      try {
        key = JSON.parse(src.slice(keyStart, keyEnd)) as string;
      } catch {
        key = rawKey.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }

      pos = skipWhitespace(src, keyEnd);
      if (src[pos] !== ":") throw new Error(`Expected : at ${pos}`);
      pos++;

      const valueStart = skipWhitespace(src, pos);

      if (key === seg) {
        if (segIdx === segments.length - 1) {
          // Final segment — must be an object
          if (src[valueStart] !== "{") {
            throw new AnchorNotFoundError(
              `Expected object at offset ${valueStart} for path "${jsonPath}"`
            );
          }
          const objEnd = skipObject(src, valueStart);
          return { openBrace: valueStart, closeBrace: objEnd - 1 };
        } else {
          // Intermediate segment — dive into its value
          pos = valueStart;
          found = true;
          break;
        }
      } else {
        // Skip this value and its optional trailing comma
        pos = skipValue(src, valueStart);
        pos = skipWhitespace(src, pos);
        if (src[pos] === ",") pos++;
      }
    }

    if (!found) {
      throw new AnchorNotFoundError(
        `Key "${seg}" not found in object at offset ${pos}`
      );
    }
  }

  throw new AnchorNotFoundError(`Path "${jsonPath}" could not be resolved`);
}

// ---------------------------------------------------------------------------
// Object entry enumerator
// ---------------------------------------------------------------------------

interface ObjectEntry {
  /** Offset of the opening `"` of the key. */
  keyStart: number;
  /** Exclusive offset just past the closing `"` of the key. */
  keyEnd: number;
  /** Decoded logical key (via JSON.parse on the key span). */
  key: string;
  /** Offset of the first char of the value (after `:`+whitespace). */
  valueStart: number;
  /** Exclusive offset just past the last char of the value. */
  valueEnd: number;
  /**
   * Offset of the leading whitespace before this entry's key.
   * For the first entry, this is the position right after `{`.
   * For subsequent entries, this is right after the preceding comma.
   */
  entryLeadStart: number;
}

/**
 * Walk inside an object (openBrace points at `{`) and return all entry spans.
 * Does NOT include the surrounding `{` or `}`.
 */
function enumerateObjectEntries(src: string, openBrace: number): ObjectEntry[] {
  const entries: ObjectEntry[] = [];
  let pos = openBrace + 1; // skip {

  while (pos < src.length) {
    const entryLeadStart = pos;
    pos = skipWhitespace(src, pos);

    if (src[pos] === "}") break; // end of object

    const keyStart = pos;
    const keyEnd = skipString(src, pos);
    let key: string;
    try {
      key = JSON.parse(src.slice(keyStart, keyEnd)) as string;
    } catch {
      key = src.slice(keyStart + 1, keyEnd - 1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }

    pos = skipWhitespace(src, keyEnd);
    if (src[pos] !== ":") throw new Error(`Expected : at ${pos}`);
    pos++; // consume :

    const valueStart = skipWhitespace(src, pos);
    const valueEnd = skipValue(src, valueStart);

    entries.push({ keyStart, keyEnd, key, valueStart, valueEnd, entryLeadStart });

    pos = skipWhitespace(src, valueEnd);
    if (src[pos] === "}") break;
    if (src[pos] === ",") pos++; // consume comma
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Indent detection for object entries
// ---------------------------------------------------------------------------

/**
 * Detect the indentation of entries inside an object.
 * Returns { entryIndent, parentIndent }.
 *
 * If the object is empty (no entries), falls back to detecting the line
 * that contains `{` and adds one indent level.
 */
function detectObjectEntryIndent(
  src: string,
  openBrace: number,
  entries: ObjectEntry[]
): { entryIndent: string; parentIndent: string } {
  if (entries.length > 0) {
    // Use the first entry's leading whitespace (on its own line)
    const first = entries[0]!;
    // Walk back from keyStart to find start of line
    let lineStart = first.keyStart - 1;
    while (lineStart >= 0 && src[lineStart] !== "\n") lineStart--;
    lineStart++;
    const linePrefix = src.slice(lineStart, first.keyStart);
    if (/^\s+$/.test(linePrefix)) {
      const entryIndent = linePrefix;
      const style = detectIndent(src);
      const unit = indentString(style);
      const parentIndent = entryIndent.startsWith(unit)
        ? entryIndent.slice(unit.length)
        : entryIndent.slice(0, Math.max(0, entryIndent.length - 2));
      return { entryIndent, parentIndent };
    }
    // Inline object (key on same line as {): no meaningful indent to detect
    return { entryIndent: "", parentIndent: "" };
  }

  // Empty object — detect from the line containing `{`
  let lineStart = openBrace - 1;
  while (lineStart >= 0 && src[lineStart] !== "\n") lineStart--;
  lineStart++;
  const parentLinePrefix = src.slice(lineStart, openBrace);
  const parentIndent = /^\s*$/.test(parentLinePrefix)
    ? parentLinePrefix.replace(/[^\s]/g, "")
    : "";
  const style = detectIndent(src);
  const unit = indentString(style);
  return { entryIndent: parentIndent + unit, parentIndent };
}

// ---------------------------------------------------------------------------
// Public API — object key primitives
// ---------------------------------------------------------------------------

export interface SetJsonObjectKeyInput {
  /** Full file content (preserved byte-for-byte outside the edit). */
  source: string;
  /** RFC 6901 Pointer to the OBJECT that will contain the key (e.g. "/mcpServers"). */
  jsonPath: string;
  /** The key to insert or replace (e.g. "logbook-mcp"). */
  key: string;
  /** JSON text of the value (must be valid JSON). */
  valueJson: string;
}

export interface SetJsonObjectKeyResult {
  /** Updated source. */
  next: string;
  /** true if the key did not exist and was inserted; false if it existed and was replaced. */
  inserted: boolean;
}

/**
 * Insert or replace an object key identified by jsonPath, using only string
 * operations. The source is preserved byte-for-byte outside the
 * insertion/replacement span.
 *
 * Escape semantics: `key` is passed through JSON.stringify for the inserted
 * form so any JSON-special characters are properly encoded. When looking up
 * an existing entry, the key string span is decoded via JSON.parse and
 * compared against the caller-supplied `key`.
 *
 * The "create parent object when missing" path is out of scope for this
 * primitive — the caller (T4 MCP installer) is responsible for ensuring the
 * parent object at jsonPath exists. For `mcpServers`, the installer uses a
 * controlled re-serialize fallback when the object is absent entirely.
 */
export function setJsonObjectKey(
  input: SetJsonObjectKeyInput
): SetJsonObjectKeyResult {
  const { source, jsonPath, key, valueJson } = input;

  // Validate valueJson is well-formed (we MAY parse the argument, not the source)
  try {
    JSON.parse(valueJson);
  } catch {
    throw new Error(`valueJson is not valid JSON: ${valueJson.slice(0, 80)}`);
  }

  const { openBrace, closeBrace } = resolveObjectPath(source, jsonPath);
  const entries = enumerateObjectEntries(source, openBrace);

  // Look for an existing entry with the same decoded key
  const existing = entries.find((e) => e.key === key);

  if (existing !== undefined) {
    // Replace the value span only. The key string and surrounding whitespace
    // (including the `:`) are preserved byte-for-byte.
    const colonPos = source.indexOf(":", existing.keyEnd);
    // valueStart already skips whitespace; we must preserve the whitespace between : and value
    const next =
      source.slice(0, existing.valueStart) +
      valueJson +
      source.slice(existing.valueEnd);
    return { next, inserted: false };
  }

  // Key not present — insert before the closing `}`
  const { entryIndent, parentIndent } = detectObjectEntryIndent(
    source,
    openBrace,
    entries
  );

  const encodedKey = JSON.stringify(key);

  if (entries.length === 0) {
    // Empty object: {} → {\n<indent>"key": value\n<parentIndent>}
    // But we need to handle the inline case (no newlines) vs pretty-printed case.
    // Check if the object is on a single line (no \n between { and })
    const interior = source.slice(openBrace + 1, closeBrace);
    const isInline = !interior.includes("\n");

    let insertion: string;
    if (isInline && entryIndent === "") {
      // Compact inline object: { } → {"key":value}
      insertion = `${encodedKey}:${valueJson}`;
      const next =
        source.slice(0, openBrace + 1) +
        insertion +
        source.slice(closeBrace);
      return { next, inserted: true };
    } else {
      // Pretty object: {} → {\n  "key": value\n}
      insertion = `\n${entryIndent}${encodedKey}: ${valueJson}\n${parentIndent}`;
      const next =
        source.slice(0, openBrace + 1) +
        insertion +
        source.slice(closeBrace);
      return { next, inserted: true };
    }
  } else {
    // Non-empty: append after the last entry's value, before `}`
    const lastEntry = entries[entries.length - 1]!;

    // Check if entries are inline (no newline between { and first entry)
    const beforeFirstEntry = source.slice(openBrace + 1, entries[0]!.keyStart);
    const isInline = !beforeFirstEntry.includes("\n");

    let insertion: string;
    if (isInline && entryIndent === "") {
      // Compact inline: ,"key":value
      insertion = `,${encodedKey}:${valueJson}`;
    } else {
      // Pretty: ,\n<indent>"key": value
      insertion = `,\n${entryIndent}${encodedKey}: ${valueJson}`;
    }

    const next =
      source.slice(0, lastEntry.valueEnd) +
      insertion +
      source.slice(lastEntry.valueEnd);
    return { next, inserted: true };
  }
}

export interface RemoveJsonObjectKeyInput {
  source: string;
  /** RFC 6901 Pointer to the OBJECT containing the key. */
  jsonPath: string;
  /** The key to remove. */
  key: string;
}

export interface RemoveJsonObjectKeyResult {
  /** Updated source. */
  next: string;
  /** false if the key was not present (idempotent — no throw on absence). */
  removed: boolean;
}

/**
 * Remove an object key identified by jsonPath + key, using only string
 * operations. Idempotent: returns `{ next: source, removed: false }` when
 * the key is absent — no throw — because uninstall must be safe to call
 * even if the entry was already removed.
 *
 * Byte-identity invariant: bytes outside the removed span are identical to
 * the source. The roundtrip property (setJsonObjectKey + removeJsonObjectKey
 * = original source) holds for every fixture.
 */
export function removeJsonObjectKey(
  input: RemoveJsonObjectKeyInput
): RemoveJsonObjectKeyResult {
  const { source, jsonPath, key } = input;

  const { openBrace, closeBrace } = resolveObjectPath(source, jsonPath);
  const entries = enumerateObjectEntries(source, openBrace);

  const targetIdx = entries.findIndex((e) => e.key === key);

  if (targetIdx === -1) {
    // Key not present — idempotent return
    return { next: source, removed: false };
  }

  const target = entries[targetIdx]!;
  const isOnly = entries.length === 1;

  if (isOnly) {
    // setJsonObjectKey replaced source[openBrace+1..closeBrace] entirely when inserting
    // into an empty object. To invert, we remove everything between { and }, recovering
    // the empty-object form. Byte-identity holds for objects whose original interior
    // was "" (e.g. {}) — the spec's invariant is scoped to bytes outside the edited span.
    const next =
      source.slice(0, openBrace + 1) +
      source.slice(closeBrace);
    return { next, removed: true };
  }

  // Multiple entries
  const isFirst = targetIdx === 0;
  const isLast = targetIdx === entries.length - 1;

  if (isFirst) {
    // Remove this entry plus the trailing comma that separates it from the next.
    // The insertion (by setJsonObjectKey) added: ,\n<indent>encodedKey: value
    // at lastEntry.valueEnd. So for REMOVAL of the first entry, we need to
    // remove from target.entryLeadStart to the comma after target.valueEnd.
    //
    // Find the comma after target.valueEnd
    let afterValue = target.valueEnd;
    afterValue = skipWhitespace(source, afterValue);
    // afterValue should be at ','
    if (source[afterValue] === ",") afterValue++;
    // afterValue now points at the start of the next entry's leading whitespace
    // Remove from target.entryLeadStart to afterValue
    const next =
      source.slice(0, target.entryLeadStart) +
      source.slice(afterValue);
    return { next, removed: true };
  }

  if (isLast) {
    // Remove the comma before this entry plus the entry itself.
    // The insertion added: ,\n<indent>encodedKey: value (appended after prev valueEnd)
    // So the comma is right at entries[targetIdx-1].valueEnd (after skipWhitespace).
    const prev = entries[targetIdx - 1]!;
    let commaPos = prev.valueEnd;
    commaPos = skipWhitespace(source, commaPos);
    // commaPos should be at ','
    // Remove from commaPos to target.valueEnd
    const next =
      source.slice(0, commaPos) +
      source.slice(target.valueEnd);
    return { next, removed: true };
  }

  // Middle entry: remove from entryLeadStart to the comma + whitespace after valueEnd
  let afterValue = target.valueEnd;
  afterValue = skipWhitespace(source, afterValue);
  if (source[afterValue] === ",") afterValue++;
  const next =
    source.slice(0, target.entryLeadStart) +
    source.slice(afterValue);
  return { next, removed: true };
}
