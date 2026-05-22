/**
 * Shared anchor-detection helpers used by all concrete ArtifactInstallers.
 *
 * This module does NOT make per-kind decisions — it provides primitives that
 * installers call. Each ArtifactInstaller<A> owns its own detect() logic and
 * delegates the low-level scanning here.
 *
 * Two functions are exported:
 *  - scanForAnchor(): given file content + AnchorSpec + expected hash,
 *    classify whether our anchor is present and whether the content still matches.
 *  - findExistingLogbookEntry(): linear scan over the manifest to find a
 *    matching artifact for a given file_path + anchor.
 */

import { sha256 } from "../util/hash.js";
import type { AnchorSpec, ManifestArtifact, Manifest } from "../types/manifest.js";

export interface AnchorScanResult {
  /** True if the anchor target was found in the file content. */
  present: boolean;
  /**
   * True if the anchor is present AND its content hash still matches the expected hash.
   * Always false when present === false.
   */
  contentMatchesHash: boolean;
}

// ---------------------------------------------------------------------------
// Variant-specific finders
// ---------------------------------------------------------------------------

/**
 * json_field variant: search for `"idField":"idValue"` presence using a
 * simple regex. The hash is compared against sha256 of the JSON value string
 * (the literal bytes from the file that form the entry).
 *
 * We do NOT re-serialize: we search for the idValue literal in the raw file
 * bytes and, if found, compute the hash of the raw string returned.
 * This is intentionally simple — precise hash accounting belongs to the
 * concrete installer's install() which controls what bytes it writes.
 */
function scanJsonField(
  fileContent: string,
  anchor: Extract<AnchorSpec, { type: "json_field" }>,
  expectedHash: string
): AnchorScanResult {
  const { idValue } = anchor;

  // Quick text search: does the idValue string appear literally in the file?
  // We check for `"idValue"` surrounded by typical JSON boundaries.
  const escaped = idValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`"${escaped}"`, "g");

  if (!pattern.test(fileContent)) {
    return { present: false, contentMatchesHash: false };
  }

  // The id is present. Now compute whether the surrounding object bytes
  // match the expectedHash. We take a best-effort approach: find the
  // outermost JSON object that contains this idValue and hash its raw bytes.
  // If that hash matches expectedHash → content is intact.
  const hash = computeJsonFieldHash(fileContent, idValue);
  if (hash === null) {
    // Found the id string but could not extract a bounded object span.
    // Treat as present but hash unknown.
    return { present: true, contentMatchesHash: false };
  }

  return { present: true, contentMatchesHash: hash === expectedHash };
}

/**
 * Find and hash the innermost JSON object containing the given idValue literal.
 *
 * Strategy: locate the idValue string literal in the file, then walk backwards
 * to find the opening `{` and forward to find the matching `}`. Return
 * sha256 of the extracted bytes.
 *
 * Returns null if the span cannot be reliably determined.
 */
function computeJsonFieldHash(fileContent: string, idValue: string): string | null {
  const needle = `"${idValue}"`;
  const pos = fileContent.indexOf(needle);
  if (pos === -1) return null;

  // Walk backwards from pos to find the opening `{`.
  let depth = 0;
  let start = -1;
  for (let i = pos; i >= 0; i--) {
    const ch = fileContent[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start === -1) return null;

  // Walk forward from start to find the matching `}`.
  depth = 0;
  let end = -1;
  for (let i = start; i < fileContent.length; i++) {
    const ch = fileContent[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  const span = fileContent.slice(start, end + 1);
  return sha256(span);
}

// ---------------------------------------------------------------------------

const MARKDOWN_BLOCK_RE =
  /<!--\s*logbook:generated start v=(\d+)\s*-->([\s\S]*?)<!--\s*logbook:generated end\s*-->/g;

/**
 * markdown_block variant: use the same regex as markdown-block.ts to locate
 * the block. Hashes the entire matched span (start marker + body + end marker).
 */
function scanMarkdownBlock(
  fileContent: string,
  anchor: Extract<AnchorSpec, { type: "markdown_block" }>,
  expectedHash: string
): AnchorScanResult {
  MARKDOWN_BLOCK_RE.lastIndex = 0;

  const matches: Array<{ full: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_BLOCK_RE.exec(fileContent)) !== null) {
    matches.push({ full: match[0] });
  }

  if (matches.length === 0) {
    return { present: false, contentMatchesHash: false };
  }

  if (matches.length > 1) {
    // Ambiguous — two blocks. Treat as not present (cannot safely operate).
    return { present: false, contentMatchesHash: false };
  }

  // Exactly one block found.
  const blockHash = sha256(matches[0]!.full);
  return { present: true, contentMatchesHash: blockHash === expectedHash };
}

// ---------------------------------------------------------------------------

/**
 * json_object_key variant: used by MCPServerInstaller for `.mcp.json` (project root).
 *
 * The anchor records the full RFC 6901 path to the key, e.g. "/mcpServers/logbook-mcp".
 * Detection: scan for the idValue literal inside the file; if found, locate the
 * enclosing object value and compute its canonical-JSON hash.
 *
 * The hash strategy mirrors json_field: we locate the object by idValue, extract the
 * raw span, compute sha256 of that span. This is intentionally identical to scanJsonField
 * because the underlying byte-search algorithm is the same — the type distinction is
 * at the installer level (object-key insertion vs array-item insertion), not at the
 * hash/detect level.
 */
function scanJsonObjectKey(
  fileContent: string,
  anchor: Extract<AnchorSpec, { type: "json_object_key" }>,
  expectedHash: string
): AnchorScanResult {
  const { idValue } = anchor;

  const escaped = idValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`"${escaped}"`, "g");

  if (!pattern.test(fileContent)) {
    return { present: false, contentMatchesHash: false };
  }

  // Locate the innermost object containing the idValue literal and hash it.
  const hash = computeJsonFieldHash(fileContent, idValue);
  if (hash === null) {
    return { present: true, contentMatchesHash: false };
  }

  return { present: true, contentMatchesHash: hash === expectedHash };
}

// ---------------------------------------------------------------------------

/**
 * line_set variant: search for the exact joined line block as a substring.
 * Hash is sha256 of lines.join("\n").
 */
function scanLineSet(
  fileContent: string,
  anchor: Extract<AnchorSpec, { type: "line_set" }>,
  expectedHash: string
): AnchorScanResult {
  const { lines } = anchor;
  const block = lines.join("\n");

  if (!fileContent.includes(block)) {
    return { present: false, contentMatchesHash: false };
  }

  const blockHash = sha256(block);
  return { present: true, contentMatchesHash: blockHash === expectedHash };
}

// ---------------------------------------------------------------------------

/**
 * owned_file variant: used by slash_command installer.
 *
 * The fileContent is the full current content of the file (already read by the caller).
 * The anchor's expected_sha256 is the hash of the content we wrote at install time.
 *
 * Semantics:
 * - File does not exist → present: false, contentMatchesHash: false (caller checks existence first).
 * - File exists with sha256 === expected_sha256 → present: true, contentMatchesHash: true.
 * - File exists with different sha256 → present: false (we don't own this slot anymore),
 *   contentMatchesHash: false.
 *
 * Note: "present" here means "we still own this file at the expected content". If the user
 * modified the file (different hash), we report not-present to signal loss of ownership.
 */
function scanOwnedFile(
  fileContent: string,
  anchor: Extract<AnchorSpec, { type: "owned_file" }>,
  _expectedContentHash: string
): AnchorScanResult {
  const currentHash = sha256(fileContent);
  const matches = currentHash === anchor.expected_sha256;
  return { present: matches, contentMatchesHash: matches };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dispatch to the correct variant scanner based on anchor.type.
 */
export function scanForAnchor(
  fileContent: string,
  anchor: AnchorSpec,
  expectedContentHash: string
): AnchorScanResult {
  switch (anchor.type) {
    case "json_field":
      return scanJsonField(fileContent, anchor, expectedContentHash);
    case "json_object_key":
      return scanJsonObjectKey(fileContent, anchor, expectedContentHash);
    case "markdown_block":
      return scanMarkdownBlock(fileContent, anchor, expectedContentHash);
    case "line_set":
      return scanLineSet(fileContent, anchor, expectedContentHash);
    case "owned_file":
      return scanOwnedFile(fileContent, anchor, expectedContentHash);
  }
}

/**
 * Linear scan of manifest.artifacts. Returns the first artifact whose
 * file_path matches AND whose anchor "targets the same slot" as the
 * provided anchor (variant-specific heuristic).
 *
 * Heuristics by variant:
 * - json_field: same idField + idValue
 * - markdown_block: same start_marker + end_marker
 * - line_set: same lines array content (joined)
 */
export function findExistingLogbookEntry(
  manifest: Manifest,
  filePath: string,
  anchor: AnchorSpec
): ManifestArtifact | null {
  for (const artifact of manifest.artifacts) {
    if (artifact.file_path !== filePath) continue;

    const a = artifact.anchor;
    if (a.type !== anchor.type) continue;

    if (
      anchor.type === "json_field" &&
      a.type === "json_field" &&
      a.idField === anchor.idField &&
      a.idValue === anchor.idValue
    ) {
      return artifact;
    }

    if (
      anchor.type === "json_object_key" &&
      a.type === "json_object_key" &&
      a.idField === anchor.idField &&
      a.idValue === anchor.idValue
    ) {
      return artifact;
    }

    if (
      anchor.type === "markdown_block" &&
      a.type === "markdown_block" &&
      a.start_marker === anchor.start_marker &&
      a.end_marker === anchor.end_marker
    ) {
      return artifact;
    }

    if (
      anchor.type === "line_set" &&
      a.type === "line_set" &&
      a.lines.join("\n") === anchor.lines.join("\n")
    ) {
      return artifact;
    }

    // owned_file: match by file_path only (one owned file per path; the entire file is the artifact).
    if (anchor.type === "owned_file" && a.type === "owned_file") {
      return artifact;
    }
  }

  return null;
}
