/**
 * Teaching-script generator (T12).
 *
 * LLM-backed pedagogical script generator. Reads milestones + decisions +
 * errors + fixes + lessons from events.jsonl, builds a structured prompt,
 * calls the injectable LLM router, and writes the result to:
 *
 *   <paths.dataDir>/teaching-scripts/<milestoneId>.md
 *
 * The output is wrapped in a `<!-- logbook:teaching-script start v=1 -->`
 * ... `<!-- logbook:teaching-script end -->` block, consistent with the
 * idempotency pattern established in iter2 (upsertGeneratedBlock / blocks.ts).
 *
 * All writes are atomic (tmp + rename). The function never throws past the
 * caller — all errors are returned as { ok: false, error: string }.
 *
 * Decision T12.D1: standalone `logbook teaching-script <milestone-id|last>`
 * command — cleaner separation from `logbook build` (deterministic-only).
 */

import { mkdirSync, writeFileSync, renameSync, statSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectPaths } from "../core/paths.js";
import type { LlmProviderRouter } from "../types/llm.js";
import { readContext, type RenderEvent } from "./render-context.js";
import { upsertMarkdownBlock } from "../util/markdown-block.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TeachingScriptInput {
  router: LlmProviderRouter;
  paths: ProjectPaths;
  /** Milestone id, or "last" for most recent manual.milestone event. */
  milestoneId: string | "last";
  /** Output directory override. Default: <paths.dataDir>/teaching-scripts. */
  outDir?: string;
}

export interface TeachingScriptResult {
  ok: boolean;
  /** Absolute path to the generated file (populated when ok=true). */
  filePath?: string;
  /** Byte length of the written file (populated when ok=true). */
  bytes?: number;
  /** Human-readable error description (populated when ok=false). */
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MARKER_NAME = "logbook:teaching-script";
const MARKER_VERSION = 1;
const MAX_TOKENS = 2500;
const TEMPERATURE = 0.3;

const SYSTEM_PROMPT =
  "You write pedagogical scripts for instructors teaching software construction. " +
  "Format: Markdown. " +
  "Sections: Overview, Key decisions (with rationale), Common pitfalls (errors and fixes), " +
  "Lessons to emphasize, Discussion prompts. " +
  "Tone: concrete and didactic. " +
  "Audience: students learning by doing. " +
  "≤1500 words.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function atomicWrite(filePath: string, content: string): number {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, filePath);
  return statSync(filePath).size;
}

function formatEventsCompact(events: RenderEvent[]): string {
  if (events.length === 0) return "(none)";
  return events
    .map((e) => {
      const label =
        (e["title"] as string | undefined) ??
        (e["summary"] as string | undefined) ??
        (e["text"] as string | undefined) ??
        "";
      const extra =
        (e["rationale"] as string | undefined) ??
        (e["description"] as string | undefined) ??
        "";
      return extra ? `- ${label} (${extra})` : `- ${label}`;
    })
    .join("\n");
}

/** Filter events in the time window [startTs, endTs] (endTs inclusive). */
function filterWindow(events: RenderEvent[], startTs: string, endTs: string): RenderEvent[] {
  return events.filter((e) => e.ts > startTs && e.ts <= endTs);
}

// ---------------------------------------------------------------------------
// generateTeachingScript
// ---------------------------------------------------------------------------

/**
 * Generate a pedagogical teaching script for a milestone.
 *
 * Returns ok=false (no throw) when:
 *   - events.jsonl is missing or unreadable
 *   - no milestones found (milestoneId="last")
 *   - specified milestoneId not found
 *   - router returns ok=false
 */
export async function generateTeachingScript(
  input: TeachingScriptInput
): Promise<TeachingScriptResult> {
  const { router, paths, milestoneId, outDir } = input;

  // 1. Read all events via render-context
  let ctx: Awaited<ReturnType<typeof readContext>>;
  try {
    ctx = await readContext(paths);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read events.jsonl: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Resolve the target milestone
  let resolvedMilestone: RenderEvent | undefined;
  let resolvedId: string;

  if (milestoneId === "last") {
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

  // 3. Gather pedagogical context within the milestone window
  const milestoneTs = resolvedMilestone.ts;

  // Find previous milestone end timestamp to bound the window
  const milestoneIndex = ctx.milestones.findIndex((m) => m.id === resolvedId);
  const prevMilestoneTs =
    milestoneIndex > 0 ? ctx.milestones[milestoneIndex - 1]!.ts : "";

  const decisionsInWindow = filterWindow(ctx.decisions, prevMilestoneTs, milestoneTs);
  const errorsInWindow = filterWindow(ctx.errors, prevMilestoneTs, milestoneTs);
  const fixesInWindow = filterWindow(ctx.fixes, prevMilestoneTs, milestoneTs);
  const lessonsInWindow = filterWindow(ctx.lessons, prevMilestoneTs, milestoneTs);

  const milestoneTitle =
    (resolvedMilestone["title"] as string | undefined) ?? resolvedId;
  const milestoneDescription =
    (resolvedMilestone["description"] as string | undefined) ?? "";

  // 4. Build structured prompt for the LLM
  const contextPayload = {
    milestone: {
      id: resolvedId,
      title: milestoneTitle,
      description: milestoneDescription,
      date: milestoneTs,
    },
    decisions: decisionsInWindow.map((e) => ({
      title: (e["title"] as string | undefined) ?? "",
      rationale: (e["rationale"] as string | undefined) ?? "",
    })),
    errors_and_fixes: errorsInWindow.map((err) => {
      const relatedFix = fixesInWindow.find((f) => f.ts >= err.ts);
      return {
        error: (err["title"] as string | undefined) ?? "",
        fix: relatedFix
          ? ((relatedFix["summary"] as string | undefined) ?? "")
          : "(no fix recorded)",
      };
    }),
    lessons: lessonsInWindow.map((e) => (e["text"] as string | undefined) ?? ""),
    stats: {
      decisions: decisionsInWindow.length,
      errors: errorsInWindow.length,
      lessons: lessonsInWindow.length,
    },
  };

  const userPrompt = [
    `Generate a teaching script for milestone: "${milestoneTitle}" (id: ${resolvedId})`,
    "",
    "Pedagogical context (JSON):",
    JSON.stringify(contextPayload, null, 2),
  ].join("\n");

  // 5. Call the LLM router
  const callResult = await router.call({
    task: "generate.teaching-script",
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

  // 6. Compose the final Markdown using the idempotent upsert pattern
  const outputDir = outDir ?? join(paths.dataDir, "teaching-scripts");
  const filePath = join(outputDir, `${resolvedId}.md`);

  // Read existing content (if any) to preserve outside-marker content
  let existing = "";
  try {
    existing = readFileSync(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return {
        ok: false,
        error: `Failed to read existing file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    // File doesn't exist — start from empty string
  }

  const { next: finalContent } = upsertMarkdownBlock(existing, callResult.text, {
    markerName: MARKER_NAME,
    markerVersion: MARKER_VERSION,
  });

  // 7. Write atomically
  const bytes = atomicWrite(filePath, finalContent);

  return { ok: true, filePath, bytes };
}
