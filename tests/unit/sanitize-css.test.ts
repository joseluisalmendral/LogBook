/**
 * Unit tests for sanitizeCss() (S2.4 / D6).
 *
 * Verifies that user-supplied CSS is sanitized before being inlined in HTML:
 * - @import rules are stripped
 * - url(http://...), url(https://...), url(//...) are replaced with url()
 * - < and > characters are stripped (prevents </style><script> escape)
 * - Valid local CSS passes through unchanged
 * - Function is idempotent
 *
 * RED phase: written before implementation.
 */

import { describe, it, expect } from "vitest";
import { sanitizeCss } from "../../src/export/safe.js";

describe("sanitizeCss (S2.4 / D6)", () => {
  it("strips @import url(...) statements", () => {
    const css = `@import url("https://fonts.googleapis.com/css2?family=Roboto");\nbody { color: red; }`;
    const result = sanitizeCss(css);
    expect(result).not.toContain("@import");
    expect(result).toContain("body { color: red; }");
  });

  it("strips bare @import 'path' statements", () => {
    const css = `@import 'normalize.css';\nh1 { font-size: 2rem; }`;
    const result = sanitizeCss(css);
    expect(result).not.toContain("@import");
    expect(result).toContain("h1 { font-size: 2rem; }");
  });

  it("replaces url(https://...) with url()", () => {
    const css = `body { background: url(https://evil.com/tracker.png); }`;
    const result = sanitizeCss(css);
    expect(result).not.toContain("https://evil.com");
    expect(result).toContain("url()");
  });

  it("replaces url(http://...) with url()", () => {
    const css = `div { background-image: url(http://cdn.example.com/image.jpg); }`;
    const result = sanitizeCss(css);
    expect(result).not.toContain("http://cdn.example.com");
    expect(result).toContain("url()");
  });

  it("replaces url(//...) protocol-relative references with url()", () => {
    const css = `body { cursor: url(//evil.org/cursor.cur), auto; }`;
    const result = sanitizeCss(css);
    expect(result).not.toContain("//evil.org");
    expect(result).toContain("url()");
  });

  it("strips < and > characters", () => {
    const css = `body { color: red; } </style><script>alert(1)</script>`;
    const result = sanitizeCss(css);
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
  });

  it("preserves valid local CSS unchanged", () => {
    const css =
      `body { font-family: system-ui, sans-serif; color: #1a1a1a; }\n` +
      `h1 { font-size: 2rem; }\n` +
      `code { background: #f4f4f4; }`;
    const result = sanitizeCss(css);
    expect(result).toBe(css);
  });

  it("is idempotent: applying sanitizeCss twice produces the same result", () => {
    const css = `@import url(https://example.com/font.css); body { color: red; }`;
    const once = sanitizeCss(css);
    const twice = sanitizeCss(once);
    expect(once).toBe(twice);
  });
});
