/**
 * Unit test: inline-css-sync (T12).
 *
 * Asserts that the CSS string constant exported by inline-css.ts
 * is byte-identical to assets/export/styles.css.
 *
 * This test prevents drift between the asset file (for documentation/dev)
 * and the bundled constant (for runtime use).
 *
 * Decision T12.D1: CSS is embedded as a string constant in inline-css.ts
 * to avoid bundle-time asset resolution complexity. This test is the
 * synchronization gatekeeper.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { INLINE_CSS } from "../../src/export/inline-css.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const ASSET_PATH = path.join(PROJECT_ROOT, "assets", "export", "styles.css");

describe("inline-css-sync", () => {
  it("assets/export/styles.css exists", () => {
    expect(fs.existsSync(ASSET_PATH)).toBe(true);
  });

  it("INLINE_CSS constant matches assets/export/styles.css byte-for-byte", () => {
    const assetContent = fs.readFileSync(ASSET_PATH, "utf8");
    expect(INLINE_CSS).toBe(assetContent);
  });

  it("INLINE_CSS is a non-empty string", () => {
    expect(typeof INLINE_CSS).toBe("string");
    expect(INLINE_CSS.length).toBeGreaterThan(0);
  });

  it("INLINE_CSS contains expected body rule", () => {
    // Sanity: the constant has at least the body selector
    expect(INLINE_CSS).toContain("body");
    expect(INLINE_CSS).toContain("font-family");
  });

  it("INLINE_CSS contains no external URLs", () => {
    // The CSS must not reference any external fonts or resources
    expect(INLINE_CSS).not.toMatch(/https?:\/\//);
  });
});
