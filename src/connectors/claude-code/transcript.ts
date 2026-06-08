/**
 * transcript.ts — Claude Code session transcript scraper.
 *
 * Reads new bytes from the Claude Code session transcript at Stop hook time and
 * converts assistant turns into logbook EventInputs.
 *
 * Key design decisions (from design doc):
 *   - ADR-2: UserPromptSubmit hook is authoritative for user_prompt events.
 *     Transcript scraper SKIPS user lines entirely.
 *   - ADR-3: Scrape only at Stop hook, not via polling.
 *   - ADR-4: Sub-agent fallback via sub-agents/ folder scanning.
 *   - ADR-8: 5MB delta cap to bound p95 latency.
 *
 * Pure functions (pathToEncoded, transcriptPath, subagentsDir, transcriptLineToEvents)
 * are exported for unit testing. I/O is encapsulated in readTranscriptNewLines and
 * runTranscriptScraper.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { appendEvent } from "../../store/index.js";
import { readState, writeState } from "../../core/state.js";
import type { ProjectPaths } from "../../core/paths.js";
import type { AgentQuestionPayload, EventInput } from "../../types/event.js";
import { redact } from "../../redact/redactor.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hard cap on delta bytes read per Stop hook fire. Protects p95 < 200ms during
 * LIVE capture — large transcripts are skipped at hook time so the Stop hook
 * never blocks the editor.
 *
 * Offline, no-latency-budget commands (`logbook present`, `logbook build`) set
 * `LOGBOOK_MAX_DELTA_BYTES` to a much higher value so big sessions (6–12 MB
 * transcripts) are fully parsed — without this, their `/rename` titles, user
 * prompts, and messages are never read. Resolved per-call so a process can
 * raise the cap mid-run.
 */
const DEFAULT_MAX_DELTA_BYTES = 5_000_000; // 5 MB
function resolveMaxDeltaBytes(): number {
  const raw = process.env["LOGBOOK_MAX_DELTA_BYTES"];
  if (typeof raw === "string" && raw.trim()) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_MAX_DELTA_BYTES;
}

/**
 * Slice-23 backfill: textual content prefixes that Claude Code emits as
 * `type:"user"` transcript entries but which are NOT real user-typed prompts.
 * These wrap slash-commands, attachments, and local command output. The
 * UserPromptSubmit hook also skips them, so we filter consistently.
 */
const NON_REAL_USER_PROMPT_PREFIXES = [
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-",
  "<attachment>",
  "<user-attachment>",
  "<session-end>",
  "<system-reminder>",
] as const;

/** Slice-23: heuristic — is this transcript content a real user-typed prompt? */
export function isLikelyRealUserPrompt(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  for (const prefix of NON_REAL_USER_PROMPT_PREFIXES) {
    if (t.startsWith(prefix)) return false;
  }
  return true;
}

/** Slice-23: stable hash of a user-prompt body, used for hook↔scraper dedup. */
export function userPromptHash(text: string): string {
  return crypto.createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

/**
 * Normalize a Claude Code `/rename` custom title for display.
 *
 * Claude Code often persists the value wrapped in a single layer of literal
 * double quotes (e.g. `"\"l16-fase6\""` → `l16-fase6`), but some renames are
 * stored unquoted (e.g. `prueba-skill-audit`). Strip ONE matched layer of
 * surrounding double quotes and trim; never touch interior quotes.
 */
export function normalizeCustomTitle(raw: string): string {
  let t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Slice-26: scan events.jsonl once and return the dedup keys for every
 * tool_result event already on disk for this session.
 *
 * Two parallel sets are returned so the scraper can dedup robustly across
 * two real failure modes:
 *
 *   1. `toolUseIds` — primary key. Used when both sides carry a real
 *      `toolu_*` id. Reliable for all events captured after the slice-26
 *      redactor exception that exempts `toolu_*` from entropy redaction.
 *
 *   2. `fingerprints` — secondary key for LEGACY events written before the
 *      redactor exception, where the tool_use_id was already shredded to
 *      `[REDACTED:high-entropy]` and can never be recovered. Fingerprint =
 *      `${tool_name}|${timestamp_truncated_to_second}`. The hook timestamp
 *      and the transcript timestamp drift by ~10 ms; truncation to seconds
 *      collapses them. Collisions require Claude to fire the same tool
 *      twice in the same second of the same session — astronomically rare.
 *
 * Empty sets on missing / unreadable file. Same failure-safe contract as
 * `loadExistingUserPromptHashes`.
 */
export async function loadExistingToolUseIds(
  eventsJsonlPath: string,
  sessionId: string,
): Promise<{ toolUseIds: Set<string>; fingerprints: Set<string> }> {
  const toolUseIds = new Set<string>();
  const fingerprints = new Set<string>();
  let content: string;
  try {
    content = await fs.promises.readFile(eventsJsonlPath, "utf8");
  } catch {
    return { toolUseIds, fingerprints };
  }
  for (const line of content.split("\n")) {
    if (!line) continue;
    if (!line.includes(`"tool_result"`)) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (parsed["kind"] !== "tool_result") continue;
    if (parsed["sessionId"] !== sessionId) continue;
    const payload = parsed["payload"] as Record<string, unknown> | undefined;
    const raw = payload?.["raw"] as Record<string, unknown> | undefined;
    const id = raw?.["tool_use_id"];
    // Only treat the id as a real key when it's NOT the redactor placeholder.
    // Otherwise the secondary fingerprint takes over.
    if (typeof id === "string" && id && !id.startsWith("[REDACTED:")) {
      toolUseIds.add(id);
    }
    const toolName =
      typeof raw?.["tool_name"] === "string"
        ? (raw["tool_name"] as string)
        : "";
    const ts = typeof parsed["timestamp"] === "string" ? (parsed["timestamp"] as string) : "";
    if (toolName && ts) {
      fingerprints.add(toolFingerprint(toolName, ts));
    }
  }
  return { toolUseIds, fingerprints };
}

/** Slice-26: deterministic dedup fingerprint for tool_result events. */
export function toolFingerprint(toolName: string, timestamp: string): string {
  // Truncate to second. Wall-clock drift between PostToolUse hook (fires
  // after tool completion) and the transcript tool_result write is ~10 ms;
  // seconds is the right granularity.
  const tsSec = timestamp.slice(0, 19); // "2026-05-24T03:26:00"
  return `${toolName}|${tsSec}`;
}

/**
 * Slice-23: scan events.jsonl once and return the set of (sessionId-scoped)
 * user_prompt text hashes that have already been written by the
 * UserPromptSubmit hook. The scraper consults this set BEFORE synthesizing
 * a user_prompt from a transcript line so we never duplicate.
 *
 * Reading the entire events.jsonl is O(N) over the project's event log. For
 * typical projects this is well under 100 ms and runs at Stop hook time
 * (within the 200 ms p95 budget). If the file is missing or unreadable,
 * returns an empty set (worst case: a few duplicate user_prompts on first
 * scrape, deduped by content hash in any subsequent run).
 */
export async function loadExistingUserPromptHashes(
  eventsJsonlPath: string,
  sessionId: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  let content: string;
  try {
    content = await fs.promises.readFile(eventsJsonlPath, "utf8");
  } catch {
    return out; // file missing or unreadable → empty set is safe
  }
  for (const line of content.split("\n")) {
    if (!line) continue;
    if (!line.includes(`"user_prompt"`)) continue; // fast prefilter
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (parsed["kind"] !== "user_prompt") continue;
    if (parsed["sessionId"] !== sessionId) continue;
    const payload = parsed["payload"] as Record<string, unknown> | undefined;
    let text: string | undefined;
    if (typeof payload?.["text"] === "string") {
      text = payload["text"] as string;
    } else {
      // Hook event shape: payload.raw.prompt or payload.prompt
      const raw = payload?.["raw"] as Record<string, unknown> | undefined;
      if (typeof raw?.["prompt"] === "string") text = raw["prompt"] as string;
      else if (typeof payload?.["prompt"] === "string") text = payload["prompt"] as string;
    }
    if (!text) continue;
    out.add(userPromptHash(text));
  }
  return out;
}

/**
 * Scan events.jsonl once and return the set of normalized custom titles
 * already persisted as `session_rename` events for this session.
 *
 * Claude Code re-emits the `custom-title` transcript line on every flush, so a
 * single `/rename` appears dozens of times. This loader lets the scraper write
 * ONE `session_rename` event per distinct title and skip the rest across runs.
 *
 * Failure-safe: missing/unreadable file → empty set.
 */
export async function loadExistingRenameTitles(
  eventsJsonlPath: string,
  sessionId: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  let content: string;
  try {
    content = await fs.promises.readFile(eventsJsonlPath, "utf8");
  } catch {
    return out;
  }
  for (const line of content.split("\n")) {
    if (!line) continue;
    if (!line.includes(`"session_rename"`)) continue; // fast prefilter
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (parsed["sessionId"] !== sessionId) continue;
    const payload = parsed["payload"] as Record<string, unknown> | undefined;
    if (payload?.["entryType"] !== "session_rename") continue;
    const title =
      typeof payload?.["customTitle"] === "string"
        ? (payload["customTitle"] as string)
        : "";
    if (title) out.add(title);
  }
  return out;
}

/**
 * teaching-faithful: true when a `session_context` event already exists for
 * this session in events.jsonl. The SessionStart attachments live at the head
 * of the transcript, so they normally arrive in the first delta — but on a
 * re-scrape (or a compact-injected second SessionStart) we must not emit a
 * duplicate. One session_context per session.
 *
 * Failure-safe: missing/unreadable file → false (emit).
 */
export async function sessionHasContextEvent(
  eventsJsonlPath: string,
  sessionId: string,
): Promise<boolean> {
  let content: string;
  try {
    content = await fs.promises.readFile(eventsJsonlPath, "utf8");
  } catch {
    return false;
  }
  for (const line of content.split("\n")) {
    if (!line) continue;
    if (!line.includes(`"session_context"`)) continue; // fast prefilter
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (parsed["sessionId"] !== sessionId) continue;
    if (parsed["kind"] === "session_context") return true;
  }
  return false;
}

/** Maximum number of cursor entries in transcriptCursors before LRU prune. */
const MAX_CURSOR_ENTRIES = 500;

/** export-replan P2 R-9: agent_question `notes` are truncated at 4 KB before persistence. */
const AGENT_QUESTION_NOTES_MAX_BYTES = 4096;

// ---------------------------------------------------------------------------
// Claude Code transcript line types
// ---------------------------------------------------------------------------

export interface ClaudeTranscriptContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result" | string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

export interface ClaudeTranscriptLine {
  type:
    | "user"
    | "assistant"
    | "attachment"
    | "last-prompt"
    | "permission-mode"
    | "file-history-snapshot"
    | "custom-title"
    | string; // forward-compat
  uuid?: string;
  /** Set on `type: "custom-title"` lines — the session's `/rename` value. */
  customTitle?: string;
  parentUuid?: string | null;
  timestamp?: string;
  sessionId?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: {
    role?: "user" | "assistant";
    content?: string | ClaudeTranscriptContentBlock[];
  };
  attachment?: { type?: string; hookEvent?: string; [k: string]: unknown };
  agentId?: string;
  promptId?: string;
  requestId?: string;
  /** Role/purpose label observed on sub-agent transcript lines (e.g. "sdd-propose"). */
  attributionAgent?: string;
}

export interface TranscriptReadResult {
  /** All parsed lines from the delta (post-filtering done by caller). */
  lines: ClaudeTranscriptLine[];
  /** Updated byte-offset after reading. */
  newCursor: number;
  /** False when the transcript file did not exist. */
  filePresent: boolean;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Convert an absolute project root path to the encoded directory name used by
 * Claude Code under ~/.claude/projects/.
 *
 * Algorithm (empirically verified against Claude Code v2.1.148 on real filesystem):
 *   1. Replace every char not in [A-Za-z0-9] with "-" (dots and underscores also replaced).
 *   2. Collapse consecutive dashes (defensive).
 *
 * The leading "/" becomes the leading "-", giving the observed prefix.
 * Example: "/Users/joseluis.fernandez/Documents/CONSTRUCCION FORMACION IA B2B/LogBook-repo"
 *       → "-Users-joseluis-fernandez-Documents-CONSTRUCCION-FORMACION-IA-B2B-LogBook-repo"
 * Verified by checking ~/.claude/projects/ on the development machine.
 */
export function pathToEncoded(absoluteProjectRoot: string): string {
  return absoluteProjectRoot
    .replace(/[^A-Za-z0-9]/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Build the absolute path to the main session JSONL file.
 * ~/.claude/projects/<encoded>/<sessionId>.jsonl
 */
export function transcriptPath(
  homeDir: string,
  encoded: string,
  sessionId: string,
): string {
  return path.join(homeDir, ".claude", "projects", encoded, `${sessionId}.jsonl`);
}

/**
 * Build the absolute path to the sub-agents directory for a session.
 * ~/.claude/projects/<encoded>/<sessionId>/subagents/
 */
export function subagentsDir(
  homeDir: string,
  encoded: string,
  sessionId: string,
): string {
  return path.join(homeDir, ".claude", "projects", encoded, sessionId, "subagents");
}

// ---------------------------------------------------------------------------
// I/O: incremental transcript reading
// ---------------------------------------------------------------------------

/**
 * Read new lines from a transcript file starting at cursorByteOffset.
 *
 * Performance contract (p95 < 200ms):
 *   - stat-first: if file size <= cursor, returns immediately (zero work).
 *   - Reads ONLY the delta bytes, not the full file.
 *   - Delta > 5MB: advance cursor without parsing; emit no lines (ADR-8).
 *   - Missing file: returns filePresent=false (degrade silently).
 */
export async function readTranscriptNewLines(
  filePath: string,
  cursorByteOffset: number,
): Promise<TranscriptReadResult> {
  // Check file existence + size first.
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { lines: [], newCursor: cursorByteOffset, filePresent: false };
    }
    throw err;
  }

  const fileSize = stat.size;

  // No new bytes: common case (Stop fires twice in fast succession).
  if (fileSize <= cursorByteOffset) {
    return { lines: [], newCursor: cursorByteOffset, filePresent: true };
  }

  const deltaBytes = fileSize - cursorByteOffset;

  // ADR-8: delta cap — advance cursor without parsing to protect latency.
  // Default 5 MB (hook budget); offline commands raise it via env so large
  // sessions are parsed in full.
  const maxDeltaBytes = resolveMaxDeltaBytes();
  if (deltaBytes > maxDeltaBytes) {
    if (process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
      process.stderr.write(
        `[logbook] transcript delta too large (${deltaBytes} bytes > ${maxDeltaBytes}), skipping parse\n`,
      );
    }
    return { lines: [], newCursor: fileSize, filePresent: true };
  }

  // Read only the delta.
  const buffer = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = fs.createReadStream(filePath, {
      start: cursorByteOffset,
      end: fileSize - 1,
    });
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });

  const lines: ClaudeTranscriptLine[] = [];
  let skipped = 0;

  for (const rawLine of buffer.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as ClaudeTranscriptLine;
      lines.push(parsed);
    } catch {
      skipped++;
      // Degrade silently — schema drift is expected across Claude Code versions.
    }
  }

  if (skipped > 0 && process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
    process.stderr.write(`[logbook] transcript: skipped ${skipped} unparseable lines\n`);
  }

  return { lines, newCursor: fileSize, filePresent: true };
}

// ---------------------------------------------------------------------------
// Line → EventInput mapping
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Skill invocation detector (B3)
// ---------------------------------------------------------------------------

/**
 * Regex that matches skill SKILL.md paths anchored to .claude/skills/.
 *
 * Pattern: matches paths under .claude/skills/ that end EXACTLY with /SKILL.md.
 * Case-sensitive, anchored. Must NOT match paths that do not end with SKILL.md.
 *
 * B3-R4: only matches .claude/skills/{star}{star}/SKILL.md (not context.md or other files).
 * B3-R5: only triggered for tool_use.Read blocks, never Edit/Write.
 *
 * Examples that MATCH:
 *   .claude/skills/react-patterns/SKILL.md
 *   /abs/path/.claude/skills/sdd-apply/SKILL.md
 *   .claude/skills/deep/nested/skill/SKILL.md
 *
 * Examples that DO NOT match:
 *   .claude/skills/react-patterns/context.md  (not SKILL.md)
 *   skills/SKILL.md                            (not under .claude/skills/)
 */
const SKILL_PATH_RE = /(?:^|\/)\.claude\/skills\/(?:.+\/)SKILL\.md$/;

/**
 * Detect if a tool_use Read block's file path is a skill SKILL.md read.
 * Returns the skill name (directory before SKILL.md) or null if no match.
 *
 * B3-R3: skillName is derived from the directory name immediately containing SKILL.md.
 */
export function detectSkillRead(filePath: string): { skillName: string; skillPath: string } | null {
  if (!SKILL_PATH_RE.test(filePath)) return null;

  // Extract the directory name before SKILL.md.
  const parts = filePath.replace(/\\/g, "/").split("/");
  // parts last element is "SKILL.md"; element before that is the skill directory name.
  const skillName = parts.length >= 2 ? parts[parts.length - 2]! : "unknown";
  return { skillName, skillPath: filePath };
}

// ---------------------------------------------------------------------------
// AskUserQuestion pairing — agent_question synthesis (export-replan P2)
// ---------------------------------------------------------------------------

/**
 * Raw question shape inside an AskUserQuestion `tool_use.input.questions[i]`.
 *
 * The Claude Code transcript stores the original question payload verbatim.
 * Fields are best-effort; missing values fall back to empty strings.
 */
interface AskUserQuestionInput {
  question?: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label?: string; description?: string }>;
}

interface PendingAskRecord {
  toolUseId: string;
  askedAt: string;
  questions: AskUserQuestionInput[];
}

/**
 * Parsed answer for a single question inside a tool_result block.
 *
 * `chosen` is `string[]` only when the original question declared `multiSelect: true`;
 * the scraper coerces single-select answers to a plain string.
 */
interface ParsedAnswer {
  question: string;
  chosen: string | string[];
  notes?: string;
}

/**
 * Truncate a string to at most `maxBytes` UTF-8 bytes. Appends a deterministic
 * marker `…[truncated N bytes]` describing how many bytes were dropped.
 *
 * Pure function — used for `notes` capping per R-9.
 */
function truncateUtf8(input: string, maxBytes: number): string {
  const buf = Buffer.from(input, "utf8");
  if (buf.byteLength <= maxBytes) return input;
  const droppedBytes = buf.byteLength - maxBytes;
  // Slice on the byte boundary then re-decode; the marker is plain ASCII so it
  // does not push us past `maxBytes` for downstream readers that care about
  // shape, only about overall string length growth.
  const head = buf.slice(0, maxBytes).toString("utf8");
  return `${head}…[truncated ${droppedBytes} bytes]`;
}

/**
 * Coerce a `tool_result.content` field into a flat string for parsing.
 * Claude Code stores tool_result content as a string OR an array of
 * `{ type: "text", text: string }` blocks. We tolerate both.
 */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (
        block !== null &&
        typeof block === "object" &&
        !Array.isArray(block) &&
        (block as Record<string, unknown>)["type"] === "text" &&
        typeof (block as Record<string, unknown>)["text"] === "string"
      ) {
        parts.push((block as Record<string, unknown>)["text"] as string);
      }
    }
    return parts.join("\n");
  }
  return "";
}

/**
 * Parse the rendered answer block emitted by AskUserQuestion.
 *
 * Claude Code's tool_result body for AskUserQuestion looks like:
 *
 *   Your questions have been answered:
 *   "Question A text" = "Choice A1"
 *   "Question B text" = "Choice B2"
 *
 *   Annotations:
 *   "Question A text": "free-text notes here"
 *
 * The parser is intentionally lenient — fields that are missing simply
 * produce `undefined` and the caller falls back to `<unanswered>`.
 *
 * Exported for unit tests.
 */
export function parseAskAnswerBlock(text: string): {
  answers: Map<string, string | string[]>;
  notes: Map<string, string>;
} {
  const answers = new Map<string, string | string[]>();
  const notes = new Map<string, string>();

  // Match `"<question>" = "<choice>"` OR `"<question>"="<choice>"`.
  // Allows escaped quotes via a non-greedy inner pattern; Claude Code does not
  // emit escaped quotes in practice but we tolerate them just in case.
  const ANSWER_RE = /"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"/g;

  let m: RegExpExecArray | null;
  while ((m = ANSWER_RE.exec(text)) !== null) {
    const q = m[1] ?? "";
    const choice = m[2] ?? "";
    if (!q) continue;
    // Multi-select answers may be repeated for the same question. Coerce to
    // array if we see a second entry for the same key.
    const existing = answers.get(q);
    if (existing === undefined) {
      answers.set(q, choice);
    } else if (Array.isArray(existing)) {
      existing.push(choice);
    } else {
      answers.set(q, [existing, choice]);
    }
  }

  // Match `"<question>": "<notes>"` for the annotations block. Use a separate
  // regex to keep ordering independent of the answer block layout.
  const NOTES_RE = /"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  while ((m = NOTES_RE.exec(text)) !== null) {
    const q = m[1] ?? "";
    const n = m[2] ?? "";
    if (!q || !n) continue;
    notes.set(q, n);
  }

  return { answers, notes };
}

/**
 * Sanitize a free-text `notes` field via the Gitleaks redactor and truncate
 * to AGENT_QUESTION_NOTES_MAX_BYTES.
 *
 * Returns `undefined` when input is empty or whitespace-only so the payload
 * field can be omitted entirely.
 */
function sanitizeNotes(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const redacted = redact(trimmed).redacted;
  return truncateUtf8(redacted, AGENT_QUESTION_NOTES_MAX_BYTES);
}

/**
 * Scan a batch of transcript lines for AskUserQuestion `tool_use` calls and
 * pair them with their matching `tool_result` blocks. Emit one
 * `agent_question` EventInput per question in each AskUserQuestion call.
 *
 * Algorithm (PASSIVE — runs at READ path only, INV-1):
 *   1. Walk lines in order. For each assistant tool_use with name
 *      "AskUserQuestion", store an entry keyed by tool_use_id.
 *   2. For each user/assistant tool_result whose tool_use_id matches an
 *      open entry, parse the answer block and emit N events.
 *   3. After the walk, any open entries (orphan tool_use) become events
 *      with `chosen: "<unanswered>"` and a stderr warning.
 *   4. Orphan tool_results (no matching tool_use in this batch) are ignored;
 *      they belong to a tool_use seen in an earlier scraping window.
 *
 * Exported for unit tests.
 */
export function extractAgentQuestionEvents(
  lines: ClaudeTranscriptLine[],
  sessionId: string,
): EventInput[] {
  const pending = new Map<string, PendingAskRecord>();
  const events: EventInput[] = [];

  for (const line of lines) {
    // Sidechain / meta / non-message lines cannot carry AskUserQuestion blocks.
    if (line.isMeta === true || line.isSidechain === true) continue;
    const content = line.message?.content;
    if (!content || typeof content === "string" || !Array.isArray(content)) continue;

    for (const block of content) {
      // --- Open: assistant tool_use AskUserQuestion ---
      if (
        line.type === "assistant" &&
        block.type === "tool_use" &&
        block.name === "AskUserQuestion"
      ) {
        const input = block.input;
        if (input === null || typeof input !== "object" || Array.isArray(input)) continue;
        const rawQuestions = (input as Record<string, unknown>)["questions"];
        if (!Array.isArray(rawQuestions)) continue;
        // Find a stable id for the tool_use call. Claude Code stores it as
        // `id` on the tool_use block (mirrors the Anthropic API shape).
        const blockAsRecord = block as unknown as Record<string, unknown>;
        const toolUseId =
          typeof blockAsRecord["id"] === "string"
            ? (blockAsRecord["id"] as string)
            : "";
        if (!toolUseId) continue;
        pending.set(toolUseId, {
          toolUseId,
          askedAt: typeof line.timestamp === "string" ? line.timestamp : "",
          questions: rawQuestions as AskUserQuestionInput[],
        });
        continue;
      }

      // --- Close: tool_result for an open AskUserQuestion ---
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        const open = pending.get(block.tool_use_id);
        if (open === undefined) continue; // orphan tool_result — ignore
        const resultText = toolResultText(block.content);
        const { answers, notes } = parseAskAnswerBlock(resultText);

        emitForCall(events, open, answers, notes, sessionId);
        pending.delete(block.tool_use_id);
      }
    }
  }

  // Orphan tool_use entries — emit unanswered events so the export still
  // surfaces the fork moment (R-25 visual state (b) handles dimmed options).
  for (const open of pending.values()) {
    if (process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
      process.stderr.write(
        `[logbook] transcript: orphan AskUserQuestion tool_use (id=${open.toolUseId}); emitting unanswered events\n`,
      );
    }
    emitForCall(events, open, new Map(), new Map(), sessionId);
  }

  return events;
}

/**
 * Emit one EventInput per question in an AskUserQuestion call.
 *
 * Match each `question.question` text against the parsed answers map by EXACT
 * key first, then by substring (lenient fallback). When no match is found the
 * event still fires with `chosen: "<unanswered>"` so downstream filters keep
 * the count of "questions asked" correct.
 */
function emitForCall(
  out: EventInput[],
  call: PendingAskRecord,
  answers: Map<string, string | string[]>,
  notes: Map<string, string>,
  sessionId: string,
): void {
  for (let i = 0; i < call.questions.length; i++) {
    const q = call.questions[i] ?? {};
    const questionText = typeof q.question === "string" ? q.question : "";

    // Match strategy: exact key, then substring search across known keys.
    let chosen: string | string[] | undefined = answers.get(questionText);
    let matchedKey = questionText;
    if (chosen === undefined && questionText) {
      for (const [key, value] of answers.entries()) {
        if (key.includes(questionText) || questionText.includes(key)) {
          chosen = value;
          matchedKey = key;
          break;
        }
      }
    }
    if (chosen === undefined) {
      if (process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
        process.stderr.write(
          `[logbook] transcript: no answer match for question="${questionText.slice(0, 80)}"\n`,
        );
      }
      chosen = "<unanswered>";
    }

    // Coerce chosen to string[] only when the question was declared multi-select.
    const multiSelect = q.multiSelect === true;
    if (multiSelect && !Array.isArray(chosen)) chosen = [chosen as string];
    if (!multiSelect && Array.isArray(chosen)) chosen = chosen.join(", ");

    const rawNotes = notes.get(matchedKey) ?? notes.get(questionText);
    const sanitizedNotes = sanitizeNotes(rawNotes);

    const options = Array.isArray(q.options)
      ? q.options.map((o) => ({
          label: typeof o.label === "string" ? o.label : "",
          description: typeof o.description === "string" ? o.description : "",
        }))
      : [];

    const payload: AgentQuestionPayload = {
      question: questionText,
      header: typeof q.header === "string" ? q.header : "",
      options,
      multiSelect,
      chosen,
      askedAt: call.askedAt,
      toolUseId: call.toolUseId,
      questionIndex: i,
    };
    if (sanitizedNotes !== undefined) payload.notes = sanitizedNotes;

    out.push({
      kind: "agent_question",
      sessionId,
      payload: payload as unknown as Record<string, unknown>,
      ...(call.askedAt !== "" && { timestamp: call.askedAt }),
    });
  }
}

// ---------------------------------------------------------------------------
// SessionStart hook injection (session_context)
// ---------------------------------------------------------------------------

/** Max bytes of injected text we keep on a session_context event. */
const SESSION_CONTEXT_TEXT_CAP = 4000;

/** Heuristic markers used to summarize which hooks injected context. */
function summarizeInjectedHooks(text: string): string {
  const parts: string[] = [];
  if (/engram\b/i.test(text) && /persistent memory|active protocol/i.test(text)) {
    parts.push("engram protocol");
  } else if (/engram\b/i.test(text)) {
    parts.push("engram");
  }
  if (/logbook/i.test(text)) parts.push("LogBook memory");
  if (/vercel/i.test(text) && /session context/i.test(text)) parts.push("Vercel context");
  if (parts.length === 0) return "startup context injected at session start";
  return `injected at startup: ${parts.join(" + ")}`;
}

/**
 * teaching-faithful: scan the transcript delta for SessionStart hook
 * injections and emit AT MOST ONE `session_context` event per session.
 *
 * Claude Code records each hook's output as a `type: "attachment"` line whose
 * `attachment.type === "hook_success"` and `attachment.hookEvent ===
 * "SessionStart"` (the `hookName` is e.g. "SessionStart:startup" /
 * "SessionStart:compact"). The injected text lives in `attachment.content`
 * (preferred) or `attachment.stdout`. Several SessionStart attachments fire per
 * session (engram protocol, LogBook memory, Vercel context, a "<persisted-
 * output>Output too large" placeholder). We concatenate the non-empty ones,
 * dedup identical bodies, cap the total at SESSION_CONTEXT_TEXT_CAP bytes, and
 * note when a placeholder was seen.
 *
 * Returns `[]` when no SessionStart injection appears in the delta. PASSIVE per
 * INV-1 — synthesis at the READ path only, no hook-semantics change.
 */
export function extractSessionContextEvents(
  lines: ClaudeTranscriptLine[],
  sessionId: string,
): EventInput[] {
  const seenBodies = new Set<string>();
  const collected: string[] = [];
  let sawPlaceholder = false;
  let firstTs: string | undefined;
  let total = 0;

  for (const line of lines) {
    if (line.type !== "attachment") continue;
    const a = line.attachment;
    if (!a || a.type !== "hook_success" || a.hookEvent !== "SessionStart") continue;

    const content = typeof a["content"] === "string" ? (a["content"] as string) : "";
    const stdout = typeof a["stdout"] === "string" ? (a["stdout"] as string) : "";
    const text = (content || stdout).trim();
    if (!text) continue;

    if (/<persisted-output>|output too large/i.test(text)) {
      sawPlaceholder = true;
      // Keep going — a sibling attachment may carry the real body.
    }
    const key = text.slice(0, 200);
    if (seenBodies.has(key)) continue;
    seenBodies.add(key);

    if (!firstTs && typeof line.timestamp === "string") firstTs = line.timestamp;

    if (total < SESSION_CONTEXT_TEXT_CAP) {
      collected.push(text);
      total += text.length;
    }
  }

  if (collected.length === 0) return [];

  let body = collected.join("\n\n---\n\n");
  let truncated = false;
  if (body.length > SESSION_CONTEXT_TEXT_CAP) {
    body = body.slice(0, SESSION_CONTEXT_TEXT_CAP);
    truncated = true;
  }

  const summary = summarizeInjectedHooks(body);
  const payload: Record<string, unknown> = {
    summary,
    text: body,
    truncated,
    placeholder: sawPlaceholder,
  };

  return [
    {
      kind: "session_context",
      sessionId,
      payload,
      ...(firstTs && { timestamp: firstTs }),
    },
  ];
}

// ---------------------------------------------------------------------------
// Line → EventInput mapping
// ---------------------------------------------------------------------------

/**
 * Slice-26 backfill: pair tool_use blocks (assistant lines) with their
 * matching tool_result blocks (user lines) using `tool_use_id` as the
 * join key, and emit `tool_result` events whose shape matches what the
 * PostToolUse hook produces. This lets the scraper RECOVER tool calls the
 * hook missed (close-too-fast scenario) and ENABLES future hook-removal
 * without losing tool detail.
 *
 * Event shape (matches PostToolUse exactly so downstream code is unchanged):
 *   {
 *     kind: "tool_result",
 *     timestamp: <tool_result line timestamp>,
 *     sessionId,
 *     payload: {
 *       raw: { tool_name, tool_input, tool_response, tool_use_id, agent_id?, is_error? }
 *     }
 *   }
 *
 * Options:
 *   - `excludedToolUseIds`: dedup against tool_results already in events.jsonl
 *     (the PostToolUse hook captured them live). Skip emission for any
 *     `tool_use_id` in this set.
 *   - `agentId`: when scraping a sub-agent transcript, stamp every emitted
 *     event with `payload.raw.agent_id = agentId` so the slice 14/15/16
 *     enrichment pipeline (which filters child tools by raw.agent_id) keeps
 *     working without modification.
 *
 * PASSIVE per INV-1: pure transform over already-persisted transcript data.
 */
export function extractToolEvents(
  lines: ClaudeTranscriptLine[],
  sessionId: string,
  options: {
    excludedToolUseIds?: Set<string>;
    /** Secondary fingerprint set (toolFingerprint values) — used to dedup
     *  legacy events whose tool_use_id was shredded by the pre-slice-26
     *  redactor. See `loadExistingToolUseIds` for the contract. */
    excludedFingerprints?: Set<string>;
    agentId?: string;
  } = {},
): EventInput[] {
  // Stage 1: scan for tool_use blocks (assistant side) and remember the
  //          name + input keyed by id. We can't emit tool_result yet — we
  //          need the matching user-side tool_result block first.
  type PendingCall = {
    toolName: string;
    toolInput: unknown;
    callTimestamp?: string;
  };
  const pending = new Map<string, PendingCall>();

  // Stage 2: walk lines linearly. Each tool_use opens a pending slot; each
  // tool_result closes it (and emits). Skipped lines (meta / sidechain /
  // non-message) don't interrupt the pairing because tool_use_id is a
  // globally unique anchor across the whole transcript.
  const out: EventInput[] = [];
  const excluded = options.excludedToolUseIds;
  const excludedFp = options.excludedFingerprints;
  const stampAgentId = options.agentId;

  for (const line of lines) {
    if (line.isMeta === true) continue;
    // Skip sidechain only for the MAIN transcript (caller decides). When
    // we scrape sub-agent transcripts directly we pass their own lines,
    // which are not flagged sidechain in the sub-agent's own file.
    if (line.isSidechain === true && !stampAgentId) continue;

    const content = line.message?.content;
    if (!content || typeof content === "string" || !Array.isArray(content)) {
      continue;
    }

    for (const block of content) {
      // Assistant tool_use → cache the call so we can pair it later.
      if (line.type === "assistant" && block.type === "tool_use") {
        const blockRec = block as unknown as Record<string, unknown>;
        const id = typeof blockRec["id"] === "string" ? (blockRec["id"] as string) : "";
        if (!id) continue;
        const name = typeof block.name === "string" ? block.name : "";
        pending.set(id, {
          toolName: name,
          toolInput: block.input,
          ...(typeof line.timestamp === "string" && { callTimestamp: line.timestamp }),
        });
        continue;
      }

      // User tool_result → emit if not already in dedup set.
      if (line.type === "user" && block.type === "tool_result") {
        const blockRec = block as unknown as Record<string, unknown>;
        const toolUseId =
          typeof blockRec["tool_use_id"] === "string"
            ? (blockRec["tool_use_id"] as string)
            : "";
        if (!toolUseId) continue;
        if (excluded?.has(toolUseId)) {
          pending.delete(toolUseId);
          continue;
        }
        const call = pending.get(toolUseId);
        // Secondary dedup against the fingerprint set so legacy events
        // whose tool_use_id was redacted (pre-slice-26 capture) still
        // collide and we don't emit a duplicate.
        if (excludedFp && call) {
          const fp = toolFingerprint(call.toolName, line.timestamp ?? "");
          if (excludedFp.has(fp)) {
            pending.delete(toolUseId);
            continue;
          }
        }
        // Even if the call info is missing (e.g. tool_use was in a chunk
        // before our cursor), we still emit so the event isn't lost —
        // tool_name + input will be empty and the UI degrades gracefully.
        const toolResponse =
          (blockRec["content"] ?? null) as unknown;
        const isError =
          typeof blockRec["is_error"] === "boolean"
            ? (blockRec["is_error"] as boolean)
            : false;

        const toolName = call?.toolName ?? "";
        const raw: Record<string, unknown> = {
          tool_name: toolName,
          tool_input: call?.toolInput ?? null,
          tool_response: toolResponse,
          tool_use_id: toolUseId,
        };
        if (stampAgentId) raw["agent_id"] = stampAgentId;
        if (isError) raw["is_error"] = true;

        // Slice-26: mirror the PostToolUse hook's persisted shape — it puts
        // `tool_name` and `tool_response` at the payload top-level in addition
        // to inside `raw`. render-context.normalizeEvent reads top-level
        // `tool_name` to derive `type = tool_result.<lowercased-name>`. If we
        // omit it the type collapses to bare "tool_result" and downstream
        // display (toolDisplayNameOf, summarizeToolInput) falls back to
        // "tool" — exactly the bug observed on the first slice-26 dry run.
        const payload: Record<string, unknown> = { raw };
        if (toolName) {
          payload["tool_name"] = toolName;
        }
        payload["tool_response"] = toolResponse;

        const ev: EventInput = {
          kind: "tool_result",
          sessionId,
          payload,
          ...(typeof line.timestamp === "string" && { timestamp: line.timestamp }),
          // Hook events also stamp these at top-level so meta lookups
          // (e.g. event.meta.tool_name from downstream consumers) work.
          meta: {
            tool_name: toolName,
            ...(toolUseId && { tool_use_id: toolUseId }),
          },
        };
        out.push(ev);
        pending.delete(toolUseId);
      }
    }
  }

  return out;
}

/**
 * Convert a transcript line to zero or more logbook EventInputs.
 *
 * Filtering rules (from design §C):
 *   - isMeta: skip
 *   - isSidechain: skip (sub-agent body handled separately via subagents/ folder)
 *   - type "last-prompt", "permission-mode", "file-history-snapshot", "attachment": skip
 *   - type "user": skip entirely (UserPromptSubmit hook is authoritative — ADR-2)
 *   - type "assistant" text blocks → claude_message
 *   - type "assistant" thinking blocks → claude_message with isThinking: true
 *   - type "assistant" tool_use blocks → skip (PostToolUse is authoritative)
 *     EXCEPT: tool_use.Read on .claude/skills/{glob}/SKILL.md → also synthesize skill_invoked (B3-R1,R2)
 *
 * PASSIVE (B3-S3, INV-1): skill_invoked synthesis is post-hoc — happens during
 * transcript scraping, NOT at hook time or during live AI execution.
 *
 * Returns [] for all skipped lines.
 */
export function transcriptLineToEvents(
  line: ClaudeTranscriptLine,
  sessionId: string,
  existingUserPromptHashes?: Set<string>,
  existingRenameTitles?: Set<string>,
): EventInput[] {
  // Skip meta / sidechain lines.
  if (line.isMeta === true) return [];
  if (line.isSidechain === true) return [];

  // Claude Code `/rename` marker — persist the custom session title once.
  // The transcript re-emits this line on every flush, so dedup against titles
  // already written for this session (in-batch + cross-run via the loader).
  if (line.type === "custom-title") {
    const titleRaw =
      typeof line.customTitle === "string" ? normalizeCustomTitle(line.customTitle) : "";
    if (!titleRaw) return [];
    if (existingRenameTitles !== undefined && existingRenameTitles.has(titleRaw)) {
      return [];
    }
    return [
      {
        kind: "system",
        sessionId,
        payload: {
          entryType: "session_rename",
          customTitle: titleRaw,
          text: titleRaw,
        },
        ...(line.timestamp !== undefined && { timestamp: line.timestamp }),
      },
    ];
  }

  // Skip known non-content line types.
  if (
    line.type === "last-prompt" ||
    line.type === "permission-mode" ||
    line.type === "file-history-snapshot" ||
    line.type === "attachment"
  ) {
    return [];
  }

  // Slice-23 backfill: emit user_prompt events from transcript when the
  // UserPromptSubmit hook missed them.
  //
  // Original design (ADR-2) made UserPromptSubmit authoritative and skipped
  // user transcript lines to avoid duplicates. In practice this leaves a
  // permanent hole whenever Claude Code is closed before the hook flushes
  // (real regression observed 2026-05-24: 1/3 user prompts missed in a
  // 78-line transcript). The transcript itself always has the data — Claude
  // Code persists it before the hook fires — so synthesizing here with a
  // text-hash dedup against already-captured prompts is safe and complete.
  //
  // The dedup set is passed in by the scraper (runTranscriptScraper) which
  // pre-scans events.jsonl for this session's existing user_prompt hashes.
  // When called without a dedup set (legacy callers / tests), we emit and
  // let downstream dedup decide.
  if (line.type === "user") {
    const content = line.message?.content;
    if (typeof content !== "string") return [];
    if (!isLikelyRealUserPrompt(content)) return [];
    const hash = userPromptHash(content);
    if (existingUserPromptHashes !== undefined && existingUserPromptHashes.has(hash)) {
      return [];
    }
    return [
      {
        kind: "user_prompt",
        sessionId,
        payload: {
          text: content,
          claudeUuid: line.uuid,
          // Flag for downstream observability: this was backfilled from
          // transcript, not captured live by UserPromptSubmit.
          backfilledFromTranscript: true,
        },
        ...(line.timestamp !== undefined && { timestamp: line.timestamp }),
      },
    ];
  }

  // Process assistant lines.
  if (line.type === "assistant") {
    const content = line.message?.content;
    if (!content || typeof content === "string" || !Array.isArray(content)) {
      return [];
    }

    const events: EventInput[] = [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        events.push({
          kind: "claude_message",
          sessionId,
          payload: {
            text: block.text,
            requestId: line.requestId,
            claudeUuid: line.uuid,
          },
          ...(line.timestamp !== undefined && { timestamp: line.timestamp }),
        });
      } else if (block.type === "thinking") {
        // Slice-28: emit thinking events EVEN when the text content is
        // empty. Anthropic encrypts the thinking body in most transcripts
        // — only a signature is exposed — so `block.thinking` is "" for
        // ~99% of real captures. We still want to record the moment so
        // the UI can render a "Claude is reasoning" marker (no leaked
        // content; just a beat that helps the audience follow the pace
        // of the conversation).
        const rawText = typeof block.thinking === "string" ? block.thinking : "";
        const hasText = rawText.trim().length > 0;
        events.push({
          kind: "claude_message",
          sessionId,
          payload: {
            text: hasText ? rawText : "",
            requestId: line.requestId,
            claudeUuid: line.uuid,
            isThinking: true,
            // Flag so the UI can distinguish encrypted/empty from real
            // thinking on the rare sessions where Anthropic does expose
            // the body (e.g. extended-thinking with raw output enabled).
            thinkingEncrypted: !hasText,
          },
          ...(line.timestamp !== undefined && { timestamp: line.timestamp }),
        });
      } else if (block.type === "tool_use" && block.name === "Read") {
        // B3-R1, B3-R2, B3-R5: detect SKILL.md reads in Read tool_use blocks ONLY.
        // PASSIVE (B3-S3): synthesis happens here (read-path), not at hook time.
        const filePathRaw =
          block.input !== null &&
          typeof block.input === "object" &&
          !Array.isArray(block.input)
            ? (block.input as Record<string, unknown>)["file_path"]
            : undefined;

        if (typeof filePathRaw === "string") {
          const detected = detectSkillRead(filePathRaw);
          if (detected !== null) {
            // B3-R3: synthesize skill_invoked at the originating timestamp.
            events.push({
              kind: "skill_invoked",
              sessionId,
              payload: {
                entryType: "skill_invoked",
                skillName: detected.skillName,
                skillPath: detected.skillPath,
              },
              ...(line.timestamp !== undefined && { timestamp: line.timestamp }),
            });
          }
        }
        // tool_use blocks are otherwise skipped (PostToolUse hook is authoritative).
      }
    }
    return events;
  }

  // All other line types: skip.
  return [];
}

// ---------------------------------------------------------------------------
// LRU cursor prune
// ---------------------------------------------------------------------------

/**
 * Prune transcriptCursors to MAX_CURSOR_ENTRIES by evicting the oldest entries.
 *
 * Cursor keys are either:
 *   - sessionId (ULID prefix → time-sortable as string)
 *   - "<sessionId>:sub:<agentId>" (also starts with ULID)
 *
 * We sort by key prefix ascending and evict the oldest half when over limit.
 */
function pruneCursors(cursors: Record<string, number>): Record<string, number> {
  const keys = Object.keys(cursors);
  if (keys.length <= MAX_CURSOR_ENTRIES) return cursors;

  // Sort ascending — oldest ULIDs first.
  keys.sort();
  const evictCount = keys.length - MAX_CURSOR_ENTRIES;
  const toEvict = new Set(keys.slice(0, evictCount));

  const pruned: Record<string, number> = {};
  for (const [k, v] of Object.entries(cursors)) {
    if (!toEvict.has(k)) pruned[k] = v;
  }
  return pruned;
}

// ---------------------------------------------------------------------------
// Main scraper orchestrator
// ---------------------------------------------------------------------------

export interface TranscriptScraperOpts {
  paths: ProjectPaths;
  sessionId: string;
  now?: () => string;
  ulid?: () => string;
}

export interface TranscriptScraperResult {
  written: number;
  skipped: number;
}

/**
 * Run the full transcript scraper pipeline at Stop hook time.
 *
 * Algorithm:
 *   1. Read state.json → get transcriptCursors (default {}).
 *   2. Build encoded path and main transcript path.
 *   3. Read delta from main transcript.
 *   4. Map lines → EventInputs → appendEvent (skips user lines per ADR-2).
 *   5. Scan subagents/ dir for new/updated agent-*.jsonl files.
 *   6. For each agent file: read delta, emit claude_message events + one
 *      subagent_complete event at end-of-scan.
 *   7. Prune cursors + write updated state.
 *   8. Return counters.
 *
 * Never throws — all errors degrade silently (caller should also try/catch).
 */
export async function runTranscriptScraper(
  opts: TranscriptScraperOpts,
): Promise<TranscriptScraperResult> {
  const { paths, sessionId } = opts;

  let written = 0;
  let skipped = 0;

  // 1. Read current state + cursors.
  const state = readState(paths.statePath);

  // Opt-out: if disableTranscript is set in state, skip scraping.
  if ((state as unknown as Record<string, unknown>)["disableTranscript"] === true) {
    return { written: 0, skipped: 0 };
  }

  const cursors: Record<string, number> = { ...(state.transcriptCursors ?? {}) };

  const homeDir = os.homedir();
  const encoded = pathToEncoded(paths.root);

  // 2. Main transcript.
  const mainPath = transcriptPath(homeDir, encoded, sessionId);
  const mainCursor = cursors[sessionId] ?? 0;

  const { lines, newCursor, filePresent } = await readTranscriptNewLines(
    mainPath,
    mainCursor,
  );

  if (!filePresent) {
    // Transcript file missing — record a warning and exit gracefully.
    const freshState = readState(paths.statePath);
    const warnings = freshState.warnings ?? [];
    warnings.push(`transcript not found: ${mainPath}`);
    // Keep warnings array at reasonable size.
    freshState.warnings = warnings.slice(-50);
    writeState(paths.statePath, freshState);
    return { written, skipped };
  }

  // Slice-23: load already-captured user_prompt text hashes for this session
  // (from UserPromptSubmit hook writes) so the scraper can backfill ONLY the
  // ones that the hook missed. Reads events.jsonl once; O(N) over event log.
  // Failure-safe: errors return an empty set → first scrape may emit dupes
  // that subsequent scrapes will catch via hash equality.
  let existingUserPromptHashes = new Set<string>();
  try {
    existingUserPromptHashes = await loadExistingUserPromptHashes(
      paths.eventsJsonl,
      sessionId,
    );
  } catch {
    // empty set already — safe default
  }

  // Load custom-title (/rename) values already persisted for this session so a
  // re-emitted custom-title line never writes a duplicate session_rename event.
  let existingRenameTitles = new Set<string>();
  try {
    existingRenameTitles = await loadExistingRenameTitles(paths.eventsJsonl, sessionId);
  } catch {
    // empty set already — safe default
  }

  // 3. Map lines → events → persist.
  for (const line of lines) {
    const events = transcriptLineToEvents(
      line,
      sessionId,
      existingUserPromptHashes,
      existingRenameTitles,
    );
    for (const eventInput of events) {
      try {
        await appendEvent(paths, {
          ...eventInput,
          provider: "claude-code-transcript",
        });
        written++;
        // Slice-23: keep the dedup set fresh within this batch so two
        // transcript lines with identical prompt text in the same delta
        // (rare but possible — e.g. user copy-pastes same prompt) only
        // emit once.
        if (eventInput.kind === "user_prompt") {
          const payload = eventInput.payload as Record<string, unknown> | undefined;
          const text = typeof payload?.["text"] === "string" ? (payload["text"] as string) : "";
          if (text) existingUserPromptHashes.add(userPromptHash(text));
        }
        if (eventInput.kind === "system") {
          const payload = eventInput.payload as Record<string, unknown> | undefined;
          if (payload?.["entryType"] === "session_rename") {
            const title =
              typeof payload?.["customTitle"] === "string"
                ? (payload["customTitle"] as string)
                : "";
            if (title) existingRenameTitles.add(title);
          }
        }
      } catch {
        skipped++;
      }
    }
    if (events.length === 0) skipped++;
  }

  // 3b. Pair AskUserQuestion tool_use ↔ tool_result and emit agent_question
  // events. Runs over the full delta in one pass so an open call in this
  // window can be matched to its result later in the same window (export-replan
  // P2, R-7, R-8). PASSIVE per INV-1 — synthesis at READ path only.
  try {
    const agentQuestionEvents = extractAgentQuestionEvents(lines, sessionId);
    for (const eventInput of agentQuestionEvents) {
      try {
        await appendEvent(paths, {
          ...eventInput,
          provider: "claude-code-transcript",
        });
        written++;
      } catch {
        skipped++;
      }
    }
  } catch (err) {
    // Synthesis must never break the rest of the scrape. Degrade silently.
    if (process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
      process.stderr.write(
        `[logbook] transcript: agent_question synthesis failed: ${String(err)}\n`,
      );
    }
  }

  // teaching-faithful: synthesize ONE session_context event from the
  // SessionStart hook injections (engram protocol, LogBook memory, …). Dedup
  // across re-scrapes via sessionHasContextEvent. PASSIVE per INV-1.
  try {
    const alreadyHasContext = await sessionHasContextEvent(
      paths.eventsJsonl,
      sessionId,
    );
    if (!alreadyHasContext) {
      const sessionContextEvents = extractSessionContextEvents(lines, sessionId);
      for (const eventInput of sessionContextEvents) {
        try {
          await appendEvent(paths, {
            ...eventInput,
            provider: "claude-code-transcript",
          });
          written++;
        } catch {
          skipped++;
        }
      }
    }
  } catch (err) {
    if (process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
      process.stderr.write(
        `[logbook] transcript: session_context synthesis failed: ${String(err)}\n`,
      );
    }
  }

  // Slice-26: tool_use ↔ tool_result pairing from the main transcript with
  // dedup against PostToolUse hook captures. Backfills tools the hook missed
  // (close-too-fast scenarios) and lays the foundation for hook-removal.
  try {
    const existing = await loadExistingToolUseIds(paths.eventsJsonl, sessionId);
    const toolEvents = extractToolEvents(lines, sessionId, {
      excludedToolUseIds: existing.toolUseIds,
      excludedFingerprints: existing.fingerprints,
    });
    for (const eventInput of toolEvents) {
      try {
        await appendEvent(paths, {
          ...eventInput,
          provider: "claude-code-transcript",
        });
        written++;
        // Keep the dedup sets fresh within this batch.
        const payload = eventInput.payload as Record<string, unknown> | undefined;
        const raw = payload?.["raw"] as Record<string, unknown> | undefined;
        const id = raw?.["tool_use_id"];
        if (typeof id === "string" && id) existing.toolUseIds.add(id);
        const toolName =
          typeof raw?.["tool_name"] === "string" ? (raw["tool_name"] as string) : "";
        const ts =
          typeof eventInput.timestamp === "string" ? (eventInput.timestamp as string) : "";
        if (toolName && ts) existing.fingerprints.add(toolFingerprint(toolName, ts));
      } catch {
        skipped++;
      }
    }
  } catch (err) {
    if (process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
      process.stderr.write(
        `[logbook] transcript: tool synthesis failed: ${String(err)}\n`,
      );
    }
  }

  // Update main cursor.
  cursors[sessionId] = newCursor;

  // 4. Scan sub-agents directory.
  const subDir = subagentsDir(homeDir, encoded, sessionId);
  try {
    const agentFiles = await fs.promises.readdir(subDir);
    const agentJsonls = agentFiles.filter(
      (f) => f.startsWith("agent-") && f.endsWith(".jsonl"),
    );

    for (const agentFile of agentJsonls) {
      // Extract agentId from filename "agent-<agentId>.jsonl".
      const agentId = agentFile.slice("agent-".length, -".jsonl".length);
      const agentFilePath = path.join(subDir, agentFile);
      const agentCursorKey = `${sessionId}:sub:${agentId}`;
      const agentCursor = cursors[agentCursorKey] ?? 0;

      const agentResult = await readTranscriptNewLines(agentFilePath, agentCursor);
      if (!agentResult.filePresent) continue;

      // Track sub-agent stats for subagent_complete event.
      let toolCallCount = 0;
      let attributionAgent: string | undefined;
      let agentStartTs: string | undefined;
      let agentEndTs: string | undefined;
      let hasNewLines = false;

      for (const line of agentResult.lines) {
        hasNewLines = true;

        // Extract attributionAgent from any line that carries it.
        if (typeof line.attributionAgent === "string" && !attributionAgent) {
          attributionAgent = line.attributionAgent;
        }

        // Track timestamps.
        if (line.timestamp) {
          if (!agentStartTs) agentStartTs = line.timestamp;
          agentEndTs = line.timestamp;
        }

        // Map assistant lines as claude_message with subagentId metadata.
        const events = transcriptLineToEvents(line, sessionId);
        for (const eventInput of events) {
          try {
            await appendEvent(paths, {
              ...eventInput,
              provider: "claude-code-transcript",
              meta: {
                ...(eventInput.meta ?? {}),
                subagentId: agentId,
                isSidechain: true,
                ...(attributionAgent !== undefined && { attributionAgent }),
              },
            });
            written++;
          } catch {
            skipped++;
          }
        }

        // Count tool_use blocks in assistant lines for subagent_complete summary.
        if (line.type === "assistant") {
          const content = line.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_use") toolCallCount++;
            }
          }
        }
      }

      // Slice-26: also synthesize tool_result events for the sub-agent's
      // tool calls from its own transcript. Each event is stamped with
      // `raw.agent_id = agentId` so the slice 14/15/16 enrichment that
      // filters child tools by raw.agent_id continues to work.
      try {
        const subDedup = await loadExistingToolUseIds(paths.eventsJsonl, sessionId);
        const subToolEvents = extractToolEvents(agentResult.lines, sessionId, {
          excludedToolUseIds: subDedup.toolUseIds,
          excludedFingerprints: subDedup.fingerprints,
          agentId,
        });
        for (const eventInput of subToolEvents) {
          try {
            await appendEvent(paths, {
              ...eventInput,
              provider: "claude-code-transcript",
              meta: {
                ...(eventInput.meta ?? {}),
                subagentId: agentId,
                isSidechain: true,
                ...(attributionAgent !== undefined && { attributionAgent }),
              },
            });
            written++;
            const payload = eventInput.payload as Record<string, unknown> | undefined;
            const raw = payload?.["raw"] as Record<string, unknown> | undefined;
            const id = raw?.["tool_use_id"];
            if (typeof id === "string" && id) subDedup.toolUseIds.add(id);
            const toolName =
              typeof raw?.["tool_name"] === "string" ? (raw["tool_name"] as string) : "";
            const ts =
              typeof eventInput.timestamp === "string"
                ? (eventInput.timestamp as string)
                : "";
            if (toolName && ts) subDedup.fingerprints.add(toolFingerprint(toolName, ts));
          } catch {
            skipped++;
          }
        }
      } catch (err) {
        if (process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
          process.stderr.write(
            `[logbook] transcript: sub-agent ${agentId} tool synthesis failed: ${String(err)}\n`,
          );
        }
      }

      // Update agent cursor.
      cursors[agentCursorKey] = agentResult.newCursor;

      // Emit one subagent_complete per agent file when we had new content.
      if (hasNewLines && agentResult.lines.length > 0) {
        const durationMs =
          agentStartTs && agentEndTs
            ? new Date(agentEndTs).getTime() - new Date(agentStartTs).getTime()
            : 0;

        try {
          await appendEvent(paths, {
            kind: "subagent_complete",
            sessionId,
            provider: "claude-code-transcript",
            payload: {
              agentId,
              toolCallCount,
              durationMs,
              ...(attributionAgent !== undefined && { attributionAgent }),
            },
            meta: {
              subagentId: agentId,
              isSidechain: true,
              ...(attributionAgent !== undefined && { attributionAgent }),
            },
          });
          written++;
        } catch {
          skipped++;
        }
      }
    }
  } catch (err) {
    // Sub-agent directory may not exist (no sub-agents in session) — not an error.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      if (process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
        process.stderr.write(
          `[logbook] transcript: subagent scan error: ${String(err)}\n`,
        );
      }
    }
  }

  // 5. Prune + write updated cursors.
  const prunedCursors = pruneCursors(cursors);
  const finalState = readState(paths.statePath);
  finalState.transcriptCursors = prunedCursors;
  writeState(paths.statePath, finalState);

  return { written, skipped };
}
