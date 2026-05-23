/*
 * P2 SubAgentCard structural tests — slice 12 (R-56, R-57, R-58, AG-25).
 *
 * Mount-based component tests for Svelte 5 + jsdom are intentionally deferred
 * (see p4-components header). For P2 we lock the contract structurally:
 *
 *   1. ZERO flip residue (AG-25) — rotateY / backface-visibility / perspective /
 *      transition-behavior / @starting-style / allow-discrete must not appear
 *      anywhere in SubAgentCard.svelte.
 *   2. Compact-row primitives present — class names + data attributes that the
 *      affordance CSS + chevron selector (P1) depend on.
 *   3. Expand mechanism — CSS Grid `grid-template-rows` + clip-path on the
 *      expand-content (R-58 / ADR-SC-B1).
 *   4. Reduced-motion fallback selectors present.
 *
 * This is a SOURCE-level test (read the file as text). Mount-based behavior
 * (click → aria-expanded toggle) is covered by the visual verification.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUB_AGENT_PATH = resolve(__dirname, "../src/lib/components/SubAgentCard.svelte");
const source = readFileSync(SUB_AGENT_PATH, "utf8");

describe("SubAgentCard — flip removal (AG-25)", () => {
  const forbidden = [
    "rotateY",
    "backface-visibility",
    "perspective",
    "transition-behavior",
    "@starting-style",
    "allow-discrete",
  ];

  for (const token of forbidden) {
    it(`does not contain '${token}' — flip implementation must be removed`, () => {
      expect(source).not.toMatch(new RegExp(token.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "i"));
    });
  }
});

describe("SubAgentCard — compact-then-expand structure (R-57, R-58)", () => {
  it("uses a real <button> for the compact toggle, not the slice-10 role=button div", () => {
    // The slice-10 implementation wrapped the toggle in role="button" so a
    // nested <button> (inspector) wouldn't break HTML validity. P2 uses a
    // real <button> at the top level and moves the inspector affordance into
    // the (sibling) expanded region. Forbidding role="button" locks that.
    expect(source).toMatch(/<button[\s\S]*?aria-expanded=\{expanded\}/);
    expect(source).not.toMatch(/role="button"/);
  });

  it("declares aria-expanded + aria-controls on the toggle button (a11y contract)", () => {
    expect(source).toMatch(/aria-expanded=\{expanded\}/);
    expect(source).toMatch(/aria-controls=\{regionId\}/);
  });

  it("renders the expanded region with role='region' for landmark navigation", () => {
    expect(source).toMatch(/role="region"/);
  });

  it("uses data-expanded on the wrap so the P1 chevron selector still rotates", () => {
    expect(source).toMatch(/data-expanded=\{expanded\}/);
  });

  it("declares the colored left-border using --color-subagent (R-57)", () => {
    expect(source).toMatch(/border-left:\s*3px solid var\(--color-subagent\)/);
  });

  it("declares Grid `grid-template-rows: 0fr` → `1fr` expand mechanism (ADR-SC-B1)", () => {
    expect(source).toMatch(/grid-template-rows:\s*0fr/);
    expect(source).toMatch(/grid-template-rows:\s*1fr/);
  });

  it("declares clip-path Kowalski reveal with the spec'd cubic-bezier (R-58)", () => {
    expect(source).toMatch(/clip-path:\s*inset\(0 0 100% 0\)/);
    expect(source).toMatch(/clip-path:\s*inset\(0 0 0 0\)/);
    expect(source).toMatch(/cubic-bezier\(0\.77,\s*0,\s*0\.175,\s*1\)/);
  });

  it("emits the always-visible chevron with the P1 .lb-chevron class", () => {
    expect(source).toMatch(/class="lb-chevron card-chevron"/);
  });
});

describe("SubAgentCard — Moment 1 + reduced-motion (INV-15 M1, R-58, R-59)", () => {
  it("tracks data-in-view for the IntersectionObserver-gated entrance", () => {
    expect(source).toMatch(/data-in-view=\{inView\}/);
    expect(source).toMatch(/new IntersectionObserver/);
  });

  it("disconnects the observer after first intersection (one-shot entrance)", () => {
    expect(source).toMatch(/io\.disconnect\(\)/);
  });

  it("declares a reduced-motion fallback selector that snaps clip-path off", () => {
    expect(source).toMatch(/html\[data-motion="reduced"\]/);
  });
});
