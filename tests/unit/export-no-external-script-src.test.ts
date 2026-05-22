/**
 * Security gate: assert that exported HTML contains no <script src=...>
 * elements (IJ-8, ADR-24).
 *
 * All JS must be inline. Any <script src=...> would indicate a regression
 * that ships an external dependency — breaking the self-contained contract
 * and potentially the security model.
 */

import { describe, it, expect } from "vitest";
import { buildHtmlDocument } from "../../src/export/build-html-document.js";
import { INLINE_CSS } from "../../src/export/inline-css.js";
import { INLINE_JS } from "../../src/export/inline-js.js";

describe("exported HTML — no external script src", () => {
  it("buildHtmlDocument output contains no <script src=", () => {
    const html = buildHtmlDocument(
      "<h1>Test</h1><p>content</p>",
      "Test",
      INLINE_CSS,
      INLINE_JS,
      { version: 1, defaultRange: "all", events: [] }
    );

    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("<script src='");
  });

  it("buildHtmlDocument output contains exactly one inline script block", () => {
    const html = buildHtmlDocument(
      "<h1>Test</h1>",
      "Test",
      INLINE_CSS,
      INLINE_JS,
      {}
    );

    // Count <script> occurrences (without src= attribute).
    // Should be exactly 2: the data block + the inline JS block.
    // The data block is <script type="application/json"...>.
    const scriptMatches = html.match(/<script/gi) ?? [];
    // One data script + one inline JS = 2
    expect(scriptMatches.length).toBe(2);
  });

  it("buildHtmlDocument output with no js arg contains no script block", () => {
    const html = buildHtmlDocument(
      "<p>content</p>",
      "Test",
      INLINE_CSS
    );

    expect(html).not.toContain("<script");
  });

  it("buildHtmlDocument output with only dataJson contains one script block", () => {
    const html = buildHtmlDocument(
      "<p>content</p>",
      "Test",
      INLINE_CSS,
      undefined,
      { test: true }
    );

    const scriptMatches = html.match(/<script/gi) ?? [];
    expect(scriptMatches.length).toBe(1);
  });
});
