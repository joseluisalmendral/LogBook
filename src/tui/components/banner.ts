/**
 * Banner — animated LogBook header for the TUI shell.
 *
 * Renders the 8-line mixed-case ANSI Shadow banner with a small "hacker"
 * line-reveal animation (one row every 80ms ≈ 640ms total).
 *
 * Visual style:
 *   - Banner body (rows 1-7): bold cyan over the default background.
 *     Hacker-terminal feel without going so dark that it loses contrast.
 *   - Last line (subtitle "captain's log · vX.Y.Z"): dim default color
 *     so the version line reads as caption, not as title.
 *
 * Performance:
 *   - One setInterval, eight ticks, then `clearInterval` on completion
 *     OR on unmount via `useEffect` cleanup.
 *   - Each tick triggers a single setState → Ink re-renders the affected
 *     rows only. Total cost: ~8 frames over 640ms — negligible.
 *   - Animation is skipped automatically when:
 *       • NODE_ENV === "test"            (vitest, snapshots)
 *       • LOGBOOK_NO_ANIMATION === "1"   (CI, accessibility, --no-anim)
 *       • props.skipAnimation === true   (explicit caller opt-out)
 *
 * @see src/tui/banner.ts  Canonical banner bytes + version substitution.
 */

import React from "react";
import { Box, Text } from "ink";
import { renderBannerLines, BANNER_LINES } from "../banner.js";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Milliseconds between each line reveal. 80ms × 8 lines = 640ms total. */
export const BANNER_ANIMATION_STEP_MS = 80;

/** Total number of lines in the banner (matches BANNER_LINES.length). */
export const BANNER_LINE_COUNT = BANNER_LINES.length;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BannerProps {
  /** Override version string. Defaults to package.json version. */
  version?: string;
  /**
   * Force-skip the typing animation. Useful for tests and explicit callers
   * that want the banner to appear instantly.
   *
   * Animation is also skipped when NODE_ENV=test or LOGBOOK_NO_ANIMATION=1.
   */
  skipAnimation?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decide whether to skip the typing animation. Pure function so tests can
 * exercise the env-var branches without mounting the component.
 */
export function shouldSkipBannerAnimation(opts: {
  skipAnimation?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (opts.skipAnimation === true) return true;
  const env = opts.env ?? process.env;
  if (env["LOGBOOK_NO_ANIMATION"] === "1") return true;
  if (env["NODE_ENV"] === "test") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Banner component
// ---------------------------------------------------------------------------

export function Banner(props: BannerProps): React.ReactElement {
  const skip = shouldSkipBannerAnimation({
    ...(props.skipAnimation !== undefined ? { skipAnimation: props.skipAnimation } : {}),
  });

  // Initial revealed count: full when skipping, 1 when animating (first
  // line is shown immediately so the user sees something on frame zero).
  const [revealed, setRevealed] = React.useState<number>(
    skip ? BANNER_LINE_COUNT : 1,
  );

  React.useEffect(() => {
    if (skip) return;

    const timer = setInterval(() => {
      setRevealed((n) => {
        const next = n + 1;
        if (next >= BANNER_LINE_COUNT) {
          clearInterval(timer);
          return BANNER_LINE_COUNT;
        }
        return next;
      });
    }, BANNER_ANIMATION_STEP_MS);

    return (): void => {
      clearInterval(timer);
    };
  }, [skip]);

  const lines = renderBannerLines(props.version);
  const visible = lines.slice(0, revealed);
  const lastIdx = lines.length - 1;

  return React.createElement(
    Box,
    { flexDirection: "column" },
    ...visible.map((line, idx) => {
      const isSubtitle = idx === lastIdx;
      return React.createElement(
        Text,
        {
          key: idx,
          ...(isSubtitle
            ? { dimColor: true }
            : { color: "cyan" as const, bold: true }),
        },
        line,
      );
    }),
  );
}
