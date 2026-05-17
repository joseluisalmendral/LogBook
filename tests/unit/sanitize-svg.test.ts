/**
 * Unit tests for sanitizeSvg() (S2.1 / D4).
 *
 * Verifies that SVG output from mmdc is sanitized before being inlined:
 * - <script> elements are stripped (XSS prevention)
 * - <foreignObject> elements are stripped
 * - <link> elements are stripped
 * - <style> with @import is stripped
 * - <image href="http..."> is stripped
 * - <image xlink:href="http..."> is stripped
 * - <a href="https://..."> has href stripped (text preserved)
 * - style="...url(https://...)..." attributes are stripped
 * - @font-face with external src is stripped
 * - Valid SVG content is preserved unchanged
 * - assertNoExternalRefs throws if external URL survives sanitization
 *
 * RED phase: written before implementation (strict TDD S2.1).
 */

import { describe, it, expect } from "vitest";
import { sanitizeSvg } from "../../src/export/safe.js";
import { assertNoExternalRefs } from "../../src/export/sanitize-links.js";

describe("sanitizeSvg (S2.1 / D4)", () => {
  it("strips <script>...</script> elements (any case)", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g><script>alert(1)</script><rect width="10" height="10"/></g></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert(1)");
    expect(result).toContain("<rect");
  });

  it("strips <SCRIPT> (uppercase) elements", () => {
    const svg = `<svg><SCRIPT type="text/javascript">evil()</SCRIPT><circle r="5"/></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("SCRIPT");
    expect(result).not.toContain("evil()");
    expect(result).toContain("<circle");
  });

  it("strips <foreignObject>...</foreignObject> elements (including nested content)", () => {
    const svg = `<svg><foreignObject width="100" height="100"><iframe src="https://evil.com"/></foreignObject><rect/></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("foreignObject");
    expect(result).not.toContain("<iframe");
    expect(result).toContain("<rect");
  });

  it("strips <link> elements", () => {
    const svg = `<svg><link rel="stylesheet" href="//evil.com/a.css"/><g><text>hello</text></g></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("<link");
    expect(result).toContain("<text>hello</text>");
  });

  it("strips @import inside <style> blocks", () => {
    const svg = `<svg><style>@import url("https://fonts.googleapis.com/css2?family=Roboto"); rect { fill: blue; }</style><rect/></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("@import");
    expect(result).not.toContain("fonts.googleapis.com");
    // style block survives; only @import line removed
    expect(result).toContain("fill: blue");
  });

  it("strips @font-face with external url() inside <style>", () => {
    const svg = `<svg><style>@font-face { font-family: 'Evil'; src: url(https://cdn.evil.com/font.woff2); } text { font-size: 14px; }</style><text/></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("@font-face");
    expect(result).not.toContain("cdn.evil.com");
    expect(result).toContain("font-size: 14px");
  });

  it("strips <image href=\"https://...\"> elements", () => {
    const svg = `<svg><image href="https://tracker.example.com/pixel.png" width="1" height="1"/><rect/></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("https://tracker.example.com");
    expect(result).toContain("<rect");
  });

  it("strips <image xlink:href=\"http://...\"> elements", () => {
    const svg = `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="http://evil.org/img.jpg"/><circle r="5"/></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("http://evil.org");
    expect(result).toContain("<circle");
  });

  it("strips external href from <a> elements (preserves text content)", () => {
    const svg = `<svg><a href="https://external.com/page"><text>click me</text></a></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("https://external.com");
    expect(result).toContain("click me");
  });

  it("strips style attribute containing url(https://...)", () => {
    const svg = `<svg><rect style="fill:url(https://evil.com/pattern.svg)" width="10" height="10"/></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("https://evil.com");
    // The element itself survives (just the style attr is removed)
    expect(result).toContain("<rect");
  });

  it("preserves valid benign SVG content unchanged", () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
      `<g fill="blue"><rect x="10" y="10" width="80" height="80"/></g>` +
      `<text x="50" y="55" text-anchor="middle">Hello</text>` +
      `</svg>`;
    const result = sanitizeSvg(svg);
    expect(result).toBe(svg);
  });

  it("is idempotent: sanitizeSvg(sanitizeSvg(x)) === sanitizeSvg(x)", () => {
    const svg = `<svg><script>bad()</script><image href="https://evil.com/p.png"/><rect/></svg>`;
    const once = sanitizeSvg(svg);
    const twice = sanitizeSvg(once);
    expect(once).toBe(twice);
  });

  it("assertNoExternalRefs throws if sanitized SVG still has external URL", () => {
    // This tests the defense-in-depth contract described in D4.
    // We craft an SVG that bypasses sanitizeSvg (not realistic) but has a URL.
    const smuggled = `<svg><text>https://evil.com/tracker</text></svg>`;
    // assertNoExternalRefs should throw on any http(s):// URL in text
    expect(() => assertNoExternalRefs(smuggled)).toThrow(/external/i);
  });
});
