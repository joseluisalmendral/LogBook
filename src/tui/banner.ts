/**
 * LogBook TUI banner — hand-crafted mixed-case ANSI Shadow art.
 *
 * Reads literally "LogBook" with proper case (capital L/B/k-ascender;
 * lowercase o-o-o round; lowercase g with descender). Left book-spine
 * prefix `▌` reinforces the captain's-log metaphor.
 *
 * Trailing whitespace on every line is LOAD-BEARING — it aligns the
 * g descender column on row 7. The fixture-file copy keeps the bytes
 * frozen so editors don't strip them.
 *
 * Layout: 8 lines × 60 chars wide.
 *   rows 1-6  L / o / g / B / o / o / k letterforms
 *   row   7   g descender curl extending below baseline
 *   row   8   separator + "captain's log · v<VERSION>"
 *
 * Version is substituted at render time from package.json so each
 * build's banner advertises the installed release.
 *
 * Reference: engram pattern `logbook/tui/banner` (obs #136). Do NOT
 * have an LLM regenerate this — hallucinated whitespace will break
 * the column geometry.
 */

// resolveJsonModule allows this named import. Using a named import (rather
// than a default import) lets esbuild tree-shake the rest of package.json
// out of the bundle — only the `version` string is inlined.
import { version as PKG_VERSION } from "../../package.json";

const VERSION_PLACEHOLDER = "__VERSION__";

/**
 * The 8 banner lines as a frozen tuple. Trailing whitespace on every
 * line is intentional (column alignment for row 7's descender).
 *
 * The last line contains __VERSION__ as a placeholder; renderBanner /
 * renderBannerLines substitute the actual version string.
 */
export const BANNER_LINES: readonly string[] = Object.freeze([
  " ▌  ██╗                     ██████╗                 ██╗     ",
  " ▌  ██║                     ██╔══██╗                ██║     ",
  " ▌  ██║      █████╗  █████╗ ██████╔╝ █████╗  █████╗ ██║ ██╗ ",
  " ▌  ██║     ██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔══██╗█████╔╝ ",
  " ▌  ███████╗╚█████╔╝╚██████║██████╔╝╚█████╔╝╚█████╔╝██╔═██╗ ",
  " ▌  ╚══════╝ ╚════╝  ╚═══██║╚═════╝  ╚════╝  ╚════╝ ╚═╝ ╚═╝ ",
  " ▌                   █████╔╝                                ",
  " ▌  ──────────────────────────────────  captain's log · __VERSION__",
]);

/** Joined banner with `__VERSION__` placeholder still present. */
export const BANNER_TEMPLATE: string = BANNER_LINES.join("\n");

/**
 * Render the banner as a single string with the version substituted.
 *
 * @param version Optional override. Defaults to the package.json version.
 *                A leading "v" is normalized so callers can pass either.
 */
export function renderBanner(version?: string): string {
  return renderBannerLines(version).join("\n");
}

/**
 * Render the banner as an array of 8 lines with the version substituted.
 * Useful when the caller needs to color or animate per-line.
 */
export function renderBannerLines(version?: string): string[] {
  const tag = formatVersionTag(version ?? PKG_VERSION ?? "dev");
  return BANNER_LINES.map((line) => line.replace(VERSION_PLACEHOLDER, tag));
}

function formatVersionTag(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}
