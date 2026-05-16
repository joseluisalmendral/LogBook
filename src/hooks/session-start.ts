/**
 * session-start.ts — Build the ≤120-token SessionStart memory summary.
 *
 * Design §6 (iter4 T4.3):
 *   When Claude Code fires hook_event_name="SessionStart", the hook dispatcher
 *   calls buildSessionStartSummary() and writes the result to stdout.
 *   Claude Code injects stdout from SessionStart hooks into the agent context.
 *
 * Algorithm:
 *   1. readState(paths.statePath) → phase, session, sessionLabel
 *   2. readContext(paths) → last decision title, error/fix counts
 *   3. Count open errors: manual.error events with no matching manual.fix.errorId
 *   4. Count review queue: state.warnings.length (pending non-fatal issues)
 *   5. Build summary text ≤480 chars (≤120 tokens via chars/4)
 *   6. Trim "Recent" portion if needed to stay within budget
 *   7. Return { summary, tokens, overBudget }
 *
 * The summary format (≤480 chars):
 *   LogBook context: phase=<X>, session=<Y> ("<label>"). Recent: <title>. Open errors: <N>. Review queue: <M> items.
 *
 * Token budget: 120 tokens = 480 chars (chars / 4 = tokens, ceiling).
 *
 * NEVER throws — always returns a valid result. Errors degrade to "—".
 */

import { readState } from "../core/state.js";
import { readContext } from "../generate/render-context.js";
import type { ProjectPaths } from "../core/paths.js";
import type { RenderEvent } from "../generate/render-context.js";

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface SessionStartSummaryInput {
  paths: ProjectPaths;
}

export interface SessionStartSummaryResult {
  /** The text to print to stdout (injected into agent context by Claude Code). */
  summary: string;
  /** Estimated token count: Math.ceil(summary.length / 4). */
  tokens: number;
  /** True if tokens > 120 after trimming — should never happen in practice. */
  overBudget: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHARS = 480; // 480 chars ≈ 120 tokens (chars/4 ceiling)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count open errors: manual.error events with no matching manual.fix.errorId.
 *
 * A "fix" closes an error when:
 *   - The fix event has errorId field (top-level or in payload) matching an error event id.
 */
function countOpenErrors(errors: RenderEvent[], fixes: RenderEvent[]): number {
  // Collect fixed error ids from fix events
  const fixedIds = new Set<string>();
  for (const fix of fixes) {
    // errorId may be at top level or in payload
    const errorIdTopLevel = fix["errorId"];
    const errorIdInPayload =
      fix["payload"] !== null &&
      typeof fix["payload"] === "object" &&
      !Array.isArray(fix["payload"])
        ? (fix["payload"] as Record<string, unknown>)["errorId"]
        : undefined;

    const errorId = errorIdTopLevel ?? errorIdInPayload;
    if (typeof errorId === "string" && errorId.length > 0) {
      fixedIds.add(errorId);
    }
  }

  // Open errors = errors whose id is NOT in fixedIds
  return errors.filter((e) => !fixedIds.has(e.id)).length;
}

/**
 * Truncate a string to fit within maxChars, appending "..." if truncated.
 */
function truncateTo(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars - 3) + "...";
}

/**
 * Build the summary text. If it exceeds MAX_CHARS, trim the Recent portion.
 */
function buildSummaryText(opts: {
  phase: string;
  sessionPart: string;
  recentTitle: string;
  openErrors: number;
  reviewQueue: number;
}): string {
  const { phase, sessionPart, recentTitle, openErrors, reviewQueue } = opts;

  // Full summary attempt
  const full = `LogBook context: phase=${phase}, session=${sessionPart}. Recent: ${recentTitle}. Open errors: ${openErrors}. Review queue: ${reviewQueue} items.`;

  if (full.length <= MAX_CHARS) return full;

  // Trim strategy: shorten the Recent title to fit
  const prefix = `LogBook context: phase=${phase}, session=${sessionPart}. Recent: `;
  const suffix = `. Open errors: ${openErrors}. Review queue: ${reviewQueue} items.`;
  const available = MAX_CHARS - prefix.length - suffix.length;

  let trimmedTitle: string;
  if (available <= 3) {
    // No room for title at all — omit Recent portion
    const withoutRecent = `LogBook context: phase=${phase}, session=${sessionPart}. Open errors: ${openErrors}. Review queue: ${reviewQueue} items.`;
    if (withoutRecent.length <= MAX_CHARS) return withoutRecent;
    // Last resort: truncate the whole thing hard
    return withoutRecent.slice(0, MAX_CHARS);
  }

  trimmedTitle = truncateTo(recentTitle, available);
  const trimmed = `${prefix}${trimmedTitle}${suffix}`;

  // Final guard — should not happen but defensive
  if (trimmed.length > MAX_CHARS) return trimmed.slice(0, MAX_CHARS);
  return trimmed;
}

// ---------------------------------------------------------------------------
// Public implementation
// ---------------------------------------------------------------------------

export async function buildSessionStartSummary(
  input: SessionStartSummaryInput,
): Promise<SessionStartSummaryResult> {
  const { paths } = input;

  // 1. Read state — never throws; returns defaults on any failure.
  let phase = "—";
  let sessionPart = "—";
  let reviewQueue = 0;

  try {
    const state = readState(paths.statePath);
    phase = state.currentPhase ?? "—";

    // Build session display: prefer sessionLabel; fall back to first 8 chars of session id.
    if (state.sessionLabel) {
      sessionPart = `"${state.sessionLabel}"`;
    } else if (state.session) {
      sessionPart = state.session.slice(0, 8);
    } else {
      sessionPart = "—";
    }

    reviewQueue = state.warnings?.length ?? 0;
  } catch {
    // State read failed — use defaults already set above.
  }

  // 2. Read events context — never throws; returns empty buckets on any failure.
  let recentTitle = "—";
  let openErrors = 0;

  try {
    const ctx = await readContext(paths);

    // Last decision title (decisions are sorted ascending, so last = most recent).
    const lastDecision = ctx.decisions[ctx.decisions.length - 1];
    if (lastDecision?.title) {
      recentTitle = String(lastDecision.title);
    }

    // Count open errors
    openErrors = countOpenErrors(ctx.errors, ctx.fixes);
  } catch {
    // Context read failed — use defaults already set above.
  }

  // 3. Build summary text with trim strategy if needed.
  const summary = buildSummaryText({ phase, sessionPart, recentTitle, openErrors, reviewQueue });

  // 4. Compute tokens.
  const tokens = Math.ceil(summary.length / 4);
  const overBudget = tokens > 120;

  return { summary, tokens, overBudget };
}
