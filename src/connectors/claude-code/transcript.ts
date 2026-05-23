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
import { appendEvent } from "../../store/index.js";
import { readState, writeState } from "../../core/state.js";
import type { ProjectPaths } from "../../core/paths.js";
import type { EventInput } from "../../types/event.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on delta bytes read per Stop hook fire. Protects p95 < 200ms. */
const MAX_DELTA_BYTES = 5_000_000; // 5 MB

/** Maximum number of cursor entries in transcriptCursors before LRU prune. */
const MAX_CURSOR_ENTRIES = 500;

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

  // Skip user lines — UserPromptSubmit hook is authoritative for user_prompt (ADR-2).
  if (line.type === "user") {
    return [];
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

  // 3. Map lines → events → persist.
  for (const line of lines) {
    const events = transcriptLineToEvents(line, sessionId);
    for (const eventInput of events) {
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
    if (events.length === 0) skipped++;
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
