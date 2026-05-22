/**
 * Static guard: appendJsonl import boundary enforcement.
 *
 * This test enforces the architectural rule that appendJsonl MUST NOT be
 * imported directly outside src/store/, with the single annotated exception
 * of src/mcp/tools/suggest.ts (pending-suggestions.jsonl, NOT events.jsonl).
 *
 * PR 1 (complete): established the boundary.
 * PR 2 (complete): all CLI commands migrated to appendEvent.
 * PR 3 (complete): all MCP tools, audit, review, and ingest commands migrated.
 *   - Only the annotated suggest.ts exception remains.
 *   - Baseline is now exactly 1 site.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../src");
const STORE_DIR = path.join(SRC_ROOT, "store");

// ---------------------------------------------------------------------------
// Helper: recursively collect all .ts files under a directory
// ---------------------------------------------------------------------------

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

// Pattern that matches any import of appendJsonl or store/jsonl from outside src/store/
const APPENDJSONL_IMPORT_RE = /import\s+.*appendJsonl.*from\s+["'].*store\/jsonl/;

// The annotated exception file path (relative from SRC_ROOT for display only)
const EXCEPTION_FILE = path.join(SRC_ROOT, "mcp", "tools", "suggest.ts");
const EXCEPTION_ANNOTATION = "// EXCEPTION:";

// ---------------------------------------------------------------------------
// 1. src/store/index.ts must NOT export appendJsonl
// ---------------------------------------------------------------------------

describe("store/index.ts public surface", () => {
  it("does NOT export appendJsonl (direct callers must use appendEvent)", () => {
    const indexPath = path.join(STORE_DIR, "index.ts");
    const content = fs.readFileSync(indexPath, "utf8");

    // Check there's no `export { appendJsonl` or `export { ..., appendJsonl, ...`
    // from the store barrel. The internal `import { appendJsonl }` is fine.
    // We match only actual export statements (not comments containing "appendJsonl").
    const exportLines = content
      .split("\n")
      .filter((line) => /^\s*export\s/.test(line) && line.includes("appendJsonl"));

    expect(exportLines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. The annotated exception (suggest.ts) carries the required comment
// ---------------------------------------------------------------------------

describe("suggest.ts exception annotation", () => {
  it("has the // EXCEPTION: comment on or near the appendJsonl import line", () => {
    const content = fs.readFileSync(EXCEPTION_FILE, "utf8");

    // Check either the import line itself or adjacent line has the EXCEPTION annotation.
    const lines = content.split("\n");
    const importLineIdx = lines.findIndex((l) => APPENDJSONL_IMPORT_RE.test(l));

    // suggest.ts is expected to keep its direct appendJsonl import.
    expect(importLineIdx).toBeGreaterThanOrEqual(0);

    // The EXCEPTION comment must appear within 5 lines of the import.
    const window = lines.slice(Math.max(0, importLineIdx - 5), importLineIdx + 5).join("\n");
    expect(window).toContain(EXCEPTION_ANNOTATION);
  });
});

// ---------------------------------------------------------------------------
// 3. PR 3 baseline: exactly 1 appendJsonl import site outside src/store/
//    (only the annotated suggest.ts exception).
// ---------------------------------------------------------------------------

describe("appendJsonl direct import sites outside src/store/ (PR 3 baseline: exactly 1)", () => {
  it("has exactly 1 remaining site (suggest.ts annotated exception)", () => {
    const allSrcFiles = collectTsFiles(SRC_ROOT);
    const outsideStoreSites: string[] = [];

    for (const file of allSrcFiles) {
      // Skip src/store/ itself — it's allowed to import from ./jsonl.
      if (file.startsWith(STORE_DIR + path.sep) || file === STORE_DIR) continue;

      const content = fs.readFileSync(file, "utf8");
      if (APPENDJSONL_IMPORT_RE.test(content)) {
        outsideStoreSites.push(path.relative(SRC_ROOT, file));
      }
    }

    // PR 3 complete: only suggest.ts should remain.
    const PR3_ALLOWED_SITES = [
      path.join("mcp", "tools", "suggest.ts"), // annotated EXCEPTION — stays
    ];

    const unknownSites = outsideStoreSites.filter((s) => !PR3_ALLOWED_SITES.includes(s));

    expect(unknownSites).toHaveLength(0);
    // Exactly 1 site — any additions are new violations.
    expect(outsideStoreSites).toHaveLength(1);

    // eslint-disable-next-line no-console
    console.info(
      `[guard] appendJsonl import sites outside src/store/: ${outsideStoreSites.length} ` +
        `(1 annotated exception — suggest.ts)`,
    );
  });
});
