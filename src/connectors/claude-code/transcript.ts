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

/** Hard cap on delta bytes read per Stop hook fire. Protects p95 < 200ms. */
const MAX_DELTA_BYTES = 5_000_000; // 5 MB

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
    | string; // forward-compat
  uuid?: string;
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

  // ADR-8: 5MB cap — advance cursor without parsing to protect latency.
  if (deltaBytes > MAX_DELTA_BYTES) {
    if (process.env["LOGBOOK_HOOK_DEBUG"] === "1") {
      process.stderr.write(
        `[logbook] transcript delta too large (${deltaBytes} bytes > ${MAX_DELTA_BYTES}), skipping parse\n`,
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
// Line → EventInput mapping
// ---------------------------------------------------------------------------

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
): EventInput[] {
  // Skip meta / sidechain lines.
  if (line.isMeta === true) return [];
  if (line.isSidechain === true) return [];

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
      } else if (
        block.type === "thinking" &&
        typeof block.thinking === "string" &&
        block.thinking.trim()
      ) {
        events.push({
          kind: "claude_message",
          sessionId,
          payload: {
            text: block.thinking,
            requestId: line.requestId,
            claudeUuid: line.uuid,
            isThinking: true,
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

  // 3. Map lines → events → persist.
  for (const line of lines) {
    const events = transcriptLineToEvents(line, sessionId, existingUserPromptHashes);
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
