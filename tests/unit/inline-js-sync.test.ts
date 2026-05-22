/**
 * Sync gatekeeper: assert that src/export/inline-js.ts is byte-identical
 * to assets/export/inline.js (ADR-28, IJ-8).
 *
 * If this test fails, run:
 *   python3 scripts/sync-inline-js.py
 * then commit both files.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "pathe";
import { INLINE_JS } from "../../src/export/inline-js.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

describe("inline-js sync gatekeeper", () => {
  it("INLINE_JS constant is byte-identical to assets/export/inline.js", () => {
    const assetPath = join(ROOT, "assets", "export", "inline.js");
    const assetContent = readFileSync(assetPath, "utf8");

    // The constant is a template literal wrapping the raw JS content.
    // It must equal the file content verbatim.
    expect(INLINE_JS).toBe(assetContent);
  });
});
