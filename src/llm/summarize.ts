/**
 * LLM-backed summarization module (T8).
 *
 * Exports:
 *   summarizeMilestone({ router, paths, milestoneId }) — milestone summary
 *   summarizeProject({ router, paths })                — full project arc summary
 *
 * Both functions:
 *   1. Read events from events.jsonl via readContext()
 *   2. Build system + user prompts from event data
 *   3. Call router.call() (injectable — never real LLM in tests)
 *   4. On ok=true: write Markdown to evidence/summaries/<id>.md atomically
 *   5. On ok=false: return { ok:false, error: <message> } — no throw
 *
 * Output directory: <paths.dataDir>/evidence/summaries/
 *
 * Atomic write: tmp + renameSync (consistent with iter1/iter2 file IO conventions).
 * Returns missing events.jsonl as ok=false (does NOT throw).
 */

import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectPaths } from "../core/paths.js";
import type { LlmProviderRouter } from "../types/llm.js";
import { readContext, type RenderEvent } from "../generate/render-context.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SummarizeOptions {
  router: LlmProviderRouter;
  paths: ProjectPaths;
}

export interface SummarizeMilestoneResult {
  ok: boolean;
  summaryPath?: string;
  bytes?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You produce concise didactic summaries from project event logs. " +
  "Output at most 500 words. Use Markdown. Lead with a one-sentence overview, " +
  "then list decisions made, errors fixed, and lessons learned.";

const MAX_TOKENS = 1500;
const TEMPERATURE = 0.2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write content atomically using tmp-file + rename (same pattern as providers/set.ts). */
function atomicWrite(filePath: string, content: string): number {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  const buf = Buffer.from(content, "utf-8");
  writeFileSync(tmp, buf);
  renameSync(tmp, filePath);
  return buf.byteLength;
}

/**
 * Format a list of events into a readable bullet list for the LLM prompt.
 * Keeps it compact: type, ts, and the most informative field (title / summary / text).
 */
function formatEventsForPrompt(events: RenderEvent[]): string {
  if (events.length === 0) return "(no events)";
  return events
    .map((e) => {
      const label = e["title"] ?? e["summary"] ?? e["text"] ?? e["name"] ?? "";
      return `- [${e.type}] ${e.ts} — ${label}`;
    })
    .join("\n");
}

/** Build the summaries output path for a given ID. */
function summaryPath(paths: ProjectPaths, id: string): string {
  return join(paths.dataDir, "evidence", "summaries", `${id}.md`);
}

// ---------------------------------------------------------------------------
// summarizeMilestone
// ---------------------------------------------------------------------------

/**
 * Summarize a specific milestone (or 'last') from events.jsonl.
 *
 * milestoneId='last' → resolves to the most recent manual.milestone event.
 * milestoneId=<id>   → looks up that specific milestone event id.
 *
 * Returns ok=false (no throw) when:
 *   - events.jsonl is missing or unreadable
 *   - no milestones found (milestoneId='last')
 *   - specified milestoneId not found
 *   - router returns ok=false
 */
export async function summarizeMilestone(
  opts: SummarizeOptions & { milestoneId: string }
): Promise<SummarizeMilestoneResult> {
  const { router, paths, milestoneId } = opts;

  // 1. Read events
  let ctx: Awaited<ReturnType<typeof readContext>>;
  try {
    ctx = await readContext(paths);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read events.jsonl: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Resolve milestone
  let resolvedMilestone: RenderEvent | undefined;
  let resolvedId: string;

  if (milestoneId === "last") {
    // Pick the milestone with the latest ts
    resolvedMilestone = ctx.milestones.at(-1);
    if (resolvedMilestone === undefined) {
      return { ok: false, error: "No milestones found in events.jsonl" };
    }
    resolvedId = resolvedMilestone.id;
  } else {
    resolvedMilestone = ctx.milestones.find((m) => m.id === milestoneId);
    if (resolvedMilestone === undefined) {
      return {
        ok: false,
        error: `No milestone with id '${milestoneId}' found in events.jsonl`,
      };
    }
    resolvedId = milestoneId;
  }

  // 3. Gather context: all events up to and including this milestone's ts
  const milestoneTs = resolvedMilestone.ts;
  const contextEvents = ctx.all.filter((e) => e.ts <= milestoneTs);

  // 4. Build prompt
  const milestoneTitle = resolvedMilestone["title"] ?? resolvedId;
  const userPrompt = [
    `Summarize milestone: "${milestoneTitle}" (id: ${resolvedId}, closed at ${milestoneTs})`,
    "",
    "Events during this milestone phase:",
    formatEventsForPrompt(contextEvents),
    "",
    "Focus on: decisions made, errors encountered + fixes, lessons learned, overall arc.",
  ].join("\n");

  // 5. Call router
  const callResult = await router.call({
    task: "summarize.milestone",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: MAX_TOKENS,
    temperature: TEMPERATURE,
  });

  if (!callResult.ok || callResult.text === undefined) {
    const errCode = callResult.error?.code ?? "call_failed";
    const errMsg = callResult.error?.message ?? "Router returned ok=false";
    return { ok: false, error: `${errCode}: ${errMsg}` };
  }

  // 6. Write output file atomically
  const outPath = summaryPath(paths, resolvedId);
  const bytes = atomicWrite(outPath, callResult.text);

  return { ok: true, summaryPath: outPath, bytes };
}

// ---------------------------------------------------------------------------
// summarizeProject
// ---------------------------------------------------------------------------

/**
 * Summarize the full project arc from events.jsonl.
 *
 * Groups events by milestone (or uses the full event log if no milestones exist).
 * Writes summary to evidence/summaries/project.md.
 *
 * Returns ok=false (no throw) when:
 *   - events.jsonl is missing or unreadable
 *   - router returns ok=false
 */
export async function summarizeProject(
  opts: SummarizeOptions
): Promise<SummarizeMilestoneResult> {
  const { router, paths } = opts;

  // 1. Read events
  let ctx: Awaited<ReturnType<typeof readContext>>;
  try {
    ctx = await readContext(paths);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read events.jsonl: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Build milestone-grouped summary
  const milestoneBlocks: string[] = [];

  if (ctx.milestones.length > 0) {
    let prevTs = "";
    for (const milestone of ctx.milestones) {
      const milestoneEvents = ctx.all.filter(
        (e) => e.ts > prevTs && e.ts <= milestone.ts
      );
      milestoneBlocks.push(
        `### Milestone: ${milestone["title"] ?? milestone.id} (${milestone.ts})\n` +
          formatEventsForPrompt(milestoneEvents)
      );
      prevTs = milestone.ts;
    }
    // Events after the last milestone
    const lastMs = ctx.milestones.at(-1)!;
    const tail = ctx.all.filter((e) => e.ts > lastMs.ts);
    if (tail.length > 0) {
      milestoneBlocks.push(
        `### Post-last-milestone events\n${formatEventsForPrompt(tail)}`
      );
    }
  } else {
    milestoneBlocks.push(
      `### All events (no milestones defined)\n${formatEventsForPrompt(ctx.all)}`
    );
  }

  // 3. Build prompt
  const totalDecisions = ctx.decisions.length;
  const totalErrors = ctx.errors.length;
  const totalLessons = ctx.lessons.length;

  const userPrompt = [
    "Summarize the project arc — all milestones, decisions, errors fixed, and lessons learned.",
    "",
    `Stats: ${ctx.milestones.length} milestones, ${totalDecisions} decisions, ` +
      `${totalErrors} errors, ${totalLessons} lessons.`,
    "",
    milestoneBlocks.join("\n\n"),
  ].join("\n");

  // 4. Call router
  const callResult = await router.call({
    task: "summarize.project",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: MAX_TOKENS,
    temperature: TEMPERATURE,
  });

  if (!callResult.ok || callResult.text === undefined) {
    const errCode = callResult.error?.code ?? "call_failed";
    const errMsg = callResult.error?.message ?? "Router returned ok=false";
    return { ok: false, error: `${errCode}: ${errMsg}` };
  }

  // 5. Write output file atomically
  const outPath = summaryPath(paths, "project");
  const bytes = atomicWrite(outPath, callResult.text);

  return { ok: true, summaryPath: outPath, bytes };
}
