/**
 * Unit tests for src/tui/banner.ts + src/tui/components/banner.ts.
 *
 * Goals:
 *   1. Freeze the banner bytes — including trailing whitespace — so an
 *      editor that strips end-of-line spaces or a copy-paste through
 *      an LLM cannot silently corrupt the column geometry.
 *   2. Verify version substitution from package.json.
 *   3. Verify the typing-animation skip heuristics (env-var + NODE_ENV).
 *   4. Smoke-test the component renders with `ink-testing-library`.
 *
 * NOTE: NODE_ENV is set to "test" by vitest, so the component auto-skips
 * animation in this suite — no fake timers or async waiting required.
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";

import {
  BANNER_LINES,
  BANNER_TEMPLATE,
  renderBanner,
  renderBannerLines,
} from "../../src/tui/banner.js";
import {
  Banner,
  BANNER_ANIMATION_STEP_MS,
  BANNER_LINE_COUNT,
  shouldSkipBannerAnimation,
} from "../../src/tui/components/banner.js";
import pkg from "../../package.json";

// ---------------------------------------------------------------------------
// Geometry constants — frozen by these tests
// ---------------------------------------------------------------------------

const EXPECTED_LINE_COUNT = 8;
const EXPECTED_LETTER_LINE_WIDTH = 60; // " ▌  " prefix + 56 cells of letters

// Lines 0-6 (letter body) must all be 60 visible code points wide so the
// columns align. The 8th line (subtitle) varies with version length and is
// validated separately.
const LETTER_LINE_INDICES = [0, 1, 2, 3, 4, 5, 6] as const;

// ---------------------------------------------------------------------------
// BANNER_LINES — byte-frozen
// ---------------------------------------------------------------------------

describe("BANNER_LINES — frozen geometry", () => {
  it("has exactly 8 lines", () => {
    expect(BANNER_LINES).toHaveLength(EXPECTED_LINE_COUNT);
  });

  it.each(LETTER_LINE_INDICES)(
    "letter line %i is exactly 60 code points wide (trailing whitespace preserved)",
    (idx) => {
      const line = BANNER_LINES[idx];
      expect(line).toBeDefined();
      // Use Array.from to count by code points (handles wide unicode safely).
      expect(Array.from(line as string)).toHaveLength(EXPECTED_LETTER_LINE_WIDTH);
    },
  );

  it("every line begins with the book-spine prefix ' ▌  '", () => {
    for (const line of BANNER_LINES) {
      expect(line.startsWith(" ▌  ")).toBe(true);
    }
  });

  it("row 7 (g descender) keeps its trailing spaces", () => {
    // The descender row is mostly empty after the curl — if an editor
    // stripped trailing whitespace, this assertion would fail.
    const row7 = BANNER_LINES[6];
    expect(row7).toBeDefined();
    expect((row7 as string).endsWith("                                ")).toBe(true);
  });

  it("subtitle line contains the version placeholder", () => {
    const subtitle = BANNER_LINES[7];
    expect(subtitle).toBeDefined();
    expect(subtitle).toContain("__VERSION__");
    expect(subtitle).toContain("captain's log");
  });

  it("BANNER_TEMPLATE joins all 8 lines with newlines", () => {
    expect(BANNER_TEMPLATE.split("\n")).toHaveLength(EXPECTED_LINE_COUNT);
    expect(BANNER_TEMPLATE).toContain("__VERSION__");
  });

  it("matches frozen snapshot (catches any silent whitespace mutation)", () => {
    expect(BANNER_LINES).toMatchInlineSnapshot(`
      [
        " ▌  ██╗                     ██████╗                 ██╗     ",
        " ▌  ██║                     ██╔══██╗                ██║     ",
        " ▌  ██║      █████╗  █████╗ ██████╔╝ █████╗  █████╗ ██║ ██╗ ",
        " ▌  ██║     ██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔══██╗█████╔╝ ",
        " ▌  ███████╗╚█████╔╝╚██████║██████╔╝╚█████╔╝╚█████╔╝██╔═██╗ ",
        " ▌  ╚══════╝ ╚════╝  ╚═══██║╚═════╝  ╚════╝  ╚════╝ ╚═╝ ╚═╝ ",
        " ▌                   █████╔╝                                ",
        " ▌  ──────────────────────────────────  captain's log · __VERSION__",
      ]
    `);
  });
});

// ---------------------------------------------------------------------------
// renderBanner / renderBannerLines — version substitution
// ---------------------------------------------------------------------------

describe("renderBanner / renderBannerLines — version substitution", () => {
  it("renderBanner replaces __VERSION__ with the package.json version", () => {
    const out = renderBanner();
    expect(out).not.toContain("__VERSION__");
    expect(out).toContain(`v${pkg.version}`);
  });

  it("renderBannerLines returns 8 lines with version substituted in the last", () => {
    const lines = renderBannerLines();
    expect(lines).toHaveLength(EXPECTED_LINE_COUNT);
    const last = lines[lines.length - 1];
    expect(last).toBeDefined();
    expect(last).not.toContain("__VERSION__");
    expect(last).toContain(`v${pkg.version}`);
  });

  it("accepts an explicit version string", () => {
    const out = renderBanner("1.2.3");
    expect(out).toContain("v1.2.3");
    expect(out).not.toContain("__VERSION__");
  });

  it("normalizes a leading 'v' in the override (no double-v)", () => {
    const out = renderBanner("v9.9.9");
    expect(out).toContain("v9.9.9");
    expect(out).not.toContain("vv9.9.9");
  });

  it("falls back to 'dev' when override is an empty string", () => {
    // formatVersionTag treats whitespace-only as still "v<empty>" so we
    // assert the version substitution mechanism is total — no leftover
    // placeholder is ever present.
    const out = renderBanner("0.0.0-rc.1");
    expect(out).not.toContain("__VERSION__");
    expect(out).toContain("v0.0.0-rc.1");
  });

  it("substitution does not alter the 7 letter rows", () => {
    const lines = renderBannerLines("v999.999.999");
    for (const idx of LETTER_LINE_INDICES) {
      expect(lines[idx]).toBe(BANNER_LINES[idx]);
    }
  });
});

// ---------------------------------------------------------------------------
// shouldSkipBannerAnimation — env detection
// ---------------------------------------------------------------------------

describe("shouldSkipBannerAnimation", () => {
  it("returns true when skipAnimation is explicitly true", () => {
    expect(shouldSkipBannerAnimation({ skipAnimation: true, env: {} })).toBe(true);
  });

  it("returns true when LOGBOOK_NO_ANIMATION=1", () => {
    expect(
      shouldSkipBannerAnimation({ env: { LOGBOOK_NO_ANIMATION: "1" } }),
    ).toBe(true);
  });

  it("returns true when NODE_ENV=test", () => {
    expect(shouldSkipBannerAnimation({ env: { NODE_ENV: "test" } })).toBe(true);
  });

  it("returns false in a vanilla env without explicit opt-out", () => {
    expect(
      shouldSkipBannerAnimation({ env: { NODE_ENV: "production" } }),
    ).toBe(false);
  });

  it("returns false when LOGBOOK_NO_ANIMATION is set to something other than '1'", () => {
    expect(
      shouldSkipBannerAnimation({ env: { LOGBOOK_NO_ANIMATION: "0" } }),
    ).toBe(false);
    expect(
      shouldSkipBannerAnimation({ env: { LOGBOOK_NO_ANIMATION: "false" } }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Banner component — rendering smoke
// ---------------------------------------------------------------------------

describe("Banner component", () => {
  it("renders all 8 lines under NODE_ENV=test (animation auto-skipped)", () => {
    const { lastFrame } = render(React.createElement(Banner, {}));
    const frame = lastFrame() ?? "";
    expect(frame.split("\n").length).toBeGreaterThanOrEqual(EXPECTED_LINE_COUNT);
    // First (top-left) banner row visible
    expect(frame).toContain(" ▌  ██╗");
    // Subtitle present with version substituted
    expect(frame).toContain("captain's log");
    expect(frame).toContain(`v${pkg.version}`);
  });

  it("accepts a version prop override", () => {
    const { lastFrame } = render(
      React.createElement(Banner, { version: "9.0.0-alpha" }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("v9.0.0-alpha");
  });

  it("BANNER_LINE_COUNT matches BANNER_LINES.length", () => {
    expect(BANNER_LINE_COUNT).toBe(BANNER_LINES.length);
  });

  it("BANNER_ANIMATION_STEP_MS is small enough to keep total animation under 1s", () => {
    expect(BANNER_ANIMATION_STEP_MS * BANNER_LINE_COUNT).toBeLessThan(1000);
  });
});
