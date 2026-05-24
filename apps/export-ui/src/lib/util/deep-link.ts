/*
 * deep-link.ts — pure builders + detectors for slice-12 Bucket C.
 *
 * Honors spec R-60..R-64 and INV-19 (no claude:// or warp://claude-resume
 * fabrication). All exports are pure functions and SSR-safe (no DOM, no
 * navigator, no window access).
 *
 * Coverage matrix:
 *   - detectSha          → R-61 (commit short SHA detection inside prose)
 *   - detectFilePath     → R-63 + ADR-SC-C2 (file paths in rendered text)
 *   - detectSessionId    → R-64 + INV-19 (session-id detection in inspector)
 *   - buildFileUri       → R-62 (vscode://file/ universal default)
 *   - buildResumeCommand → R-64 (clipboard payload "claude --resume <id>")
 *   - buildWarpTabUri    → R-64 (warp://action/new_tab?path=<root>)
 *   - selectionParam     → P3 lands the convention; P5/P7 wire routing
 *   - linkifyText        → R-63 (file-path wrapping in HTML for SubAgent body)
 *
 * Per INV-19: NO `claude://` URI scheme; NO `warp://claude-resume`.
 * The clipboard-paste pattern (R-64) is the substitute.
 */

// ---------------------------------------------------------------------------
// Regex constants (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Git SHA detection: 7-40 lowercase hex chars on word boundaries.
 * Matches both short (7+) and full (40) SHAs without leading prose.
 */
export const SHA_REGEX = /\b[0-9a-f]{7,40}\b/g;

/**
 * UUID v1-v5-ish detection (also matches Claude/Anthropic session-id shape).
 * Case-insensitive; emits canonical positions.
 */
export const SESSION_ID_REGEX =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * File-path detection per ADR-SC-C2.
 *
 * Captures three groups: (1) the path, (2) optional :line, (3) optional :col.
 * Filter rule applied in detectFilePath: the path must contain at least one
 * directory separator (`/` or `\`) OR end in a recognized code extension to
 * avoid false positives on bare filenames or sentences ending in a dot.
 *
 * Anchored with a leading whitespace / line-start / boundary char so URLs
 * (http://, https://, file:///) do NOT match — the leading `:` of `https:` is
 * a non-allowed leader.
 */
export const FILE_PATH_REGEX =
  /(?:^|[\s(`'"])((?:\.{1,2}\/|\/|[A-Za-z]:[\\/])?[\w.\-/\\]+\.[a-zA-Z]{1,6})(?::(\d+)(?::(\d+))?)?/g;

/**
 * Known code-ish extensions used to accept bare filenames (no separator) as
 * paths. Conservative on purpose — `prose.md` in a sentence WILL be linked,
 * but that is the desired behavior in event bodies and tool inputs.
 */
const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "go",
  "rs",
  "py",
  "rb",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "lua",
  "vim",
  "md",
  "mdx",
  "txt",
  "json",
  "yml",
  "yaml",
  "toml",
  "ini",
  "env",
  "html",
  "css",
  "scss",
  "sass",
  "less",
  "svelte",
  "vue",
  "astro",
  "sql",
  "graphql",
  "proto",
]);

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

/**
 * Detect all 7-40 char hex SHAs in `text`.
 * Returns a de-duplicated, in-order list of matches.
 */
export function detectSha(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(SHA_REGEX)) {
    const sha = m[0];
    if (sha && !seen.has(sha)) {
      seen.add(sha);
      out.push(sha);
    }
  }
  return out;
}

export interface DetectedFilePath {
  path: string;
  line?: number;
  col?: number;
}

/**
 * Detect file paths in `text`. Filter rule keeps quality high:
 *   - Path with `/` or `\` separator → always accepted.
 *   - Bare filename → accepted only if extension is in CODE_EXTENSIONS.
 *
 * Returns de-duplicated entries keyed by `path:line:col` shape.
 */
export function detectFilePath(text: string): DetectedFilePath[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const out: DetectedFilePath[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(FILE_PATH_REGEX)) {
    const path = m[1];
    if (!path) continue;
    const hasSeparator = path.includes("/") || path.includes("\\");
    if (!hasSeparator) {
      const dot = path.lastIndexOf(".");
      const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
      if (!CODE_EXTENSIONS.has(ext)) continue;
    }
    const entry: DetectedFilePath = { path };
    if (m[2]) entry.line = Number(m[2]);
    if (m[3]) entry.col = Number(m[3]);
    const key = `${entry.path}:${entry.line ?? ""}:${entry.col ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * Detect session ids in `text`. UUID-shaped tokens only (8-4-4-4-12 hex).
 * Returns a de-duplicated list.
 */
export function detectSessionId(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(SESSION_ID_REGEX)) {
    const id = m[0];
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Build a file-open URI for the user's preferred local editor.
 *
 * Slice 18 introduced a picker (stored in `editorPref` / localStorage). When
 * the picker is set to "vscode" (default), Cursor and Zed inherit via the OS
 * protocol handler. Other editors ship their own schemes:
 *
 *   vscode    → `vscode://file/<path>[:line[:col]]`
 *   cursor    → `cursor://file/<path>[:line[:col]]`
 *   zed       → `zed://file/<path>[:line[:col]]`
 *   intellij  → `idea://open?file=<path>&line=<line>&column=<col>`
 *
 * `absPath` is taken at face value — callers must resolve any project-
 * relative path themselves. For the path-style schemes we do NOT URL-encode
 * the path because they rely on the raw filesystem path (URL encoding would
 * break Windows drive letters). For the IntelliJ `idea://open?` query-string
 * variant we DO encode (it's a real query, not a path).
 *
 * Slice-12-compatibility: the `scheme` parameter is optional. When omitted
 * we read the user pref via `editorPref.get()` at call time so the pref can
 * be changed at runtime and every NEW link reflects the new choice. (Links
 * already rendered into the DOM keep their pre-change scheme until a
 * re-render — same trade-off as any reactive store.)
 */
import { editorPref, type EditorScheme } from "../stores/editor-pref";

export function buildFileUri(
  absPath: string,
  line?: number,
  col?: number,
  scheme?: EditorScheme,
): string {
  const resolved = scheme ?? editorPref.get();
  const hasLine = typeof line === "number" && Number.isFinite(line);
  const hasCol = typeof col === "number" && Number.isFinite(col);

  if (resolved === "intellij") {
    // IntelliJ uses a query-string format. URL-encode the path so spaces /
    // unicode survive the parse on the receiving side.
    let q = `idea://open?file=${encodeURIComponent(absPath)}`;
    if (hasLine) q += `&line=${line}`;
    if (hasLine && hasCol) q += `&column=${col}`;
    return q;
  }

  const tail = hasLine ? `:${line}${hasCol ? `:${col}` : ""}` : "";
  return `${resolved}://file/${absPath}${tail}`;
}

/**
 * Build the clipboard payload string for "Resume in terminal".
 * Output is exactly `claude --resume <sessionId>` — no URI scheme.
 * Per INV-19 + R-64 we copy a CLI command, not a fictional claude:// link.
 */
export function buildResumeCommand(sessionId: string): string {
  return `claude --resume ${sessionId}`;
}

/**
 * Build the Warp deep link that opens a new terminal tab cwd'd at `projectRoot`.
 *
 * The `warp://action/new_tab` action IS real (documented in Warp's launch
 * config docs). The clipboard-paste pattern (R-64) is what bridges the
 * sessionId — there is NO `warp://claude-resume` per INV-19/R-79.
 */
export function buildWarpTabUri(projectRoot: string): string {
  return `warp://action/new_tab?path=${encodeURIComponent(projectRoot)}`;
}

/**
 * Build the URL hash query suffix that P5/P7 will parse for bidirectional
 * card↔raw selection. P3 lands the convention; nothing wires routing yet.
 *
 * Returns `?event=<encoded>`; callers concatenate after the hash path.
 */
export function selectionParam(eventId: string): string {
  return `?event=${encodeURIComponent(eventId)}`;
}

// ---------------------------------------------------------------------------
// HTML escape + linkify (tool-input safe rendering)
// ---------------------------------------------------------------------------

/**
 * Minimal HTML-entity escape. Safe for use in attribute values and text nodes
 * we are about to splat via `{@html ...}` in Svelte. Does NOT attempt full
 * sanitization (we never accept HTML input from the source — only plain text).
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface LinkifyResult {
  html: string;
}

/**
 * Wrap detected file paths in `text` with `<a href="vscode://file/...">` while
 * HTML-escaping everything else. Output is safe to splat via `{@html}`.
 *
 * Detection re-runs FILE_PATH_REGEX over the raw text and slices the string
 * around matches. Non-matched ranges are HTML-escaped. Match groups are also
 * HTML-escaped before being placed inside the anchor's text node — the only
 * un-escaped output is the wrapping `<a>` tag itself.
 *
 * Anchors carry `target="_blank" rel="noopener noreferrer"` per R-79.
 */
export function linkifyText(text: string): LinkifyResult {
  if (typeof text !== "string" || text.length === 0) {
    return { html: "" };
  }

  const parts: string[] = [];
  let cursor = 0;

  // Re-run the regex with explicit lastIndex bookkeeping so we can splice the
  // original string around each match.
  const re = new RegExp(FILE_PATH_REGEX.source, FILE_PATH_REGEX.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const fullMatch = m[0];
    const path = m[1];
    if (!path) continue;

    // Re-apply the same accept filter as detectFilePath().
    const hasSeparator = path.includes("/") || path.includes("\\");
    if (!hasSeparator) {
      const dot = path.lastIndexOf(".");
      const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
      if (!CODE_EXTENSIONS.has(ext)) continue;
    }

    const matchStart = m.index;
    // The first char of fullMatch is the boundary leader (whitespace / paren /
    // backtick / quote) UNLESS the match started at index 0 (^).
    // Find where the captured path starts inside fullMatch.
    const pathOffsetInMatch = fullMatch.indexOf(path);
    const pathStart = matchStart + Math.max(0, pathOffsetInMatch);
    const lineStr = m[2];
    const colStr = m[3];
    const lineSuffix = lineStr
      ? `:${lineStr}${colStr ? `:${colStr}` : ""}`
      : "";
    const pathEnd = pathStart + path.length + lineSuffix.length;

    // Append any prose before the match (HTML-escaped).
    if (pathStart > cursor) {
      parts.push(escapeHtml(text.slice(cursor, pathStart)));
    }

    const line = lineStr ? Number(lineStr) : undefined;
    const col = colStr ? Number(colStr) : undefined;
    const uri = buildFileUri(path, line, col);
    const label = `${path}${lineSuffix}`;
    parts.push(
      `<a href="${escapeHtml(uri)}" target="_blank" rel="noopener noreferrer" data-deep-link="file">${escapeHtml(label)}</a>`,
    );

    cursor = pathEnd;
    // Defensive: advance regex past the consumed range to avoid infinite loops
    // when zero-width matches happen on degenerate inputs.
    if (re.lastIndex <= cursor) re.lastIndex = cursor;
  }

  if (cursor < text.length) {
    parts.push(escapeHtml(text.slice(cursor)));
  }

  return { html: parts.join("") };
}
