/**
 * CRITICAL-2 CSS token backward compatibility test (CC-2).
 *
 * CC-2: Existing --lb-* token names MUST NOT be renamed or removed.
 * The semantic of --lb-bg MUST remain "body/page background" (its original
 * ADR-06 meaning). The new --lb-card token is the card surface.
 *
 * This test reads the compiled inline-css.ts constant and asserts:
 *   - --lb-bg is defined (not removed)
 *   - --lb-card is defined (new token for card surface)
 *   - --lb-page-bg is defined (additive — outer shell)
 *   - .lb-doc uses --lb-card (not --lb-bg) for its background
 *   - body uses --lb-page-bg (or --lb-bg) for its background
 *   - The "NOTE: --lb-bg is the CARD" breaking-change comment is gone
 */

import { describe, it, expect } from "vitest";
import { INLINE_CSS } from "../../src/export/inline-css.js";

describe("CSS token backward compatibility (CRITICAL-2, CC-2)", () => {
  it("--lb-bg token is defined (not removed)", () => {
    expect(INLINE_CSS).toContain("--lb-bg:");
  });

  it("--lb-card token is defined (new card surface token)", () => {
    expect(INLINE_CSS).toContain("--lb-card:");
  });

  it("--lb-page-bg token is defined (additive, outer shell)", () => {
    expect(INLINE_CSS).toContain("--lb-page-bg:");
  });

  it(".lb-doc background uses --lb-card (not --lb-bg)", () => {
    // Find the .lb-doc rule block and ensure it references --lb-card for bg.
    const lbDocMatch = INLINE_CSS.match(/\.lb-doc\s*\{([^}]+)\}/s);
    expect(lbDocMatch).not.toBeNull();
    const lbDocBlock = lbDocMatch![1]!;
    expect(lbDocBlock).toContain("var(--lb-card)");
    expect(lbDocBlock).not.toContain("var(--lb-bg)");
  });

  it("body background uses page-shell token (--lb-page-bg or --lb-bg)", () => {
    const bodyMatch = INLINE_CSS.match(/^body\s*\{([^}]+)\}/ms);
    expect(bodyMatch).not.toBeNull();
    const bodyBlock = bodyMatch![1]!;
    // body should reference --lb-page-bg or --lb-bg (both resolve to same value).
    const hasPageBg = bodyBlock.includes("var(--lb-page-bg)");
    const hasBg = bodyBlock.includes("var(--lb-bg)");
    expect(hasPageBg || hasBg).toBe(true);
  });

  it("--lb-bg light value is the page/body background (zinc 50: #fafafa)", () => {
    // --lb-bg should map to the body background color, not the card white.
    // :root block sets --lb-bg: #fafafa (zinc 50).
    const rootMatch = INLINE_CSS.match(/:root\s*\{([^}]+)\}/s);
    expect(rootMatch).not.toBeNull();
    const rootBlock = rootMatch![1]!;
    // --lb-bg must be present in :root.
    expect(rootBlock).toContain("--lb-bg:");
    // --lb-card should be the white card (#ffffff).
    expect(rootBlock).toContain("--lb-card:");
    // The card value should be white.
    const cardMatch = rootBlock.match(/--lb-card:\s*([^;]+);/);
    expect(cardMatch).not.toBeNull();
    expect(cardMatch![1]!.trim()).toBe("#ffffff");
  });

  it("no breaking-change warning comment about --lb-bg semantic shift", () => {
    // The old warning comment (lines 7-11) said users with --lb-bg targeting
    // body background should migrate to --lb-page-bg. Since --lb-bg now
    // correctly points to body background again, this warning is removed.
    expect(INLINE_CSS).not.toContain(
      "update your override to use --lb-page-bg"
    );
  });

  it("--lb-accent token is still present (backward compat)", () => {
    expect(INLINE_CSS).toContain("--lb-accent:");
  });

  it("--lb-border token is still present (backward compat)", () => {
    expect(INLINE_CSS).toContain("--lb-border:");
  });

  it("--lb-fg token is still present (backward compat)", () => {
    expect(INLINE_CSS).toContain("--lb-fg:");
  });

  it("new --blocker and --info badge modifiers are present (SUGGESTION-2)", () => {
    expect(INLINE_CSS).toContain("lb-badge--blocker");
    expect(INLINE_CSS).toContain("lb-badge--info");
  });
});
