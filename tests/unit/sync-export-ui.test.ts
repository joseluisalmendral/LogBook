/**
 * Unit test — scripts/sync-export-ui.ts produces a deterministic, byte-faithful
 * src/export/ui-bundle.ts (P5, AG-12).
 *
 * Verifies:
 *   1. UI_BUNDLE matches the source HTML byte-for-byte (after JSON.parse round-trip)
 *   2. UI_BUNDLE_SHA256 matches a freshly-computed SHA-256 of the source
 *   3. The generated bundle is a valid TypeScript module — exports both constants
 *
 * We do NOT re-run the sync script inside the test; we read the committed
 * artifacts and assert their integrity.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SOURCE = resolve(REPO_ROOT, "apps/export-ui/dist/index.html");
const BUNDLE = resolve(REPO_ROOT, "src/export/ui-bundle.ts");

describe("sync-export-ui — vendored UI bundle (P5 AG-12)", () => {
  it("source dist/index.html exists", () => {
    expect(existsSync(SOURCE)).toBe(true);
  });

  it("generated ui-bundle.ts exists", () => {
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it("UI_BUNDLE round-trips to the source HTML byte-for-byte", () => {
    const html = readFileSync(SOURCE, "utf8");
    const bundleText = readFileSync(BUNDLE, "utf8");
    // Locate the start of the JSON.stringify'd payload and parse from there.
    // We can't use a single regex because non-greedy `.*?` over 150KB+ with
    // embedded escaped quotes can mis-terminate; instead, find the opening
    // delimiter and scan for the matching unescaped closing quote.
    const startMarker = `export const UI_BUNDLE: string = `;
    const startIdx = bundleText.indexOf(startMarker);
    expect(startIdx).toBeGreaterThan(-1);
    const jsonStart = startIdx + startMarker.length;
    expect(bundleText[jsonStart]).toBe('"');
    // Walk to find the closing unescaped quote.
    let i = jsonStart + 1;
    while (i < bundleText.length) {
      const ch = bundleText[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') break;
      i++;
    }
    const jsonString = bundleText.slice(jsonStart, i + 1);
    const parsed = JSON.parse(jsonString);
    expect(parsed).toBe(html);
  });

  it("UI_BUNDLE_SHA256 matches a fresh SHA-256 of the source HTML", () => {
    const html = readFileSync(SOURCE, "utf8");
    const expectedSha = createHash("sha256").update(html, "utf8").digest("hex");
    const bundleText = readFileSync(BUNDLE, "utf8");
    const match = bundleText.match(/export const UI_BUNDLE_SHA256: string = "([0-9a-f]+)";/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(expectedSha);
  });

  it("bundle text mentions the lb-data placeholder so html.ts can inject", () => {
    const bundleText = readFileSync(BUNDLE, "utf8");
    // The placeholder is embedded INSIDE the JSON-stringified payload, so we
    // must look for the escaped form.
    expect(bundleText).toContain('lb-data');
  });
});
