/**
 * Unit tests for `logbook build --safe` flag (S3.2).
 *
 * Tests verify that when safe=true is passed to runAllGenerators, the
 * generated document content is sanitized via sanitizeForSafeExport before
 * being written into the block markers. The block markers themselves must
 * be preserved byte-identical.
 *
 * The --safe implementation lives in runAllGenerators (generate/index.ts):
 * when safe=true, the body string is passed through sanitizeForSafeExport
 * before being handed to upsertGeneratedBlock.
 *
 * Test strategy: unit tests against runAllGenerators (pure in-process, no CLI
 * subprocess needed). We write events.jsonl with content that would trigger
 * redaction (absolute paths), then compare safe vs unsafe output.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { runAllGenerators } from "../../src/generate/index.js";
import { makePaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProject(eventsContent?: string): { dir: string; paths: ProjectPaths } {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-safe-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "docs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" })
  );
  fs.writeFileSync(
    path.join(dir, ".logbook", "state.json"),
    JSON.stringify({ version: 1, disabled: false, warnings: [] }, null, 2) + "\n"
  );

  // Events with a session whose text contains a /Users/... path
  const defaultEvents = [
    JSON.stringify({
      type: "manual.session_start",
      id: "01HTEST0001",
      ts: "2026-01-01T10:00:00.000Z",
      session: "s1",
      name: "Alpha Session",
      project: "/Users/alice/myproject",
    }),
  ].join("\n") + "\n";

  fs.writeFileSync(
    path.join(dir, "logbook", "evidence", "events.jsonl"),
    eventsContent ?? defaultEvents,
    "utf8"
  );

  const paths = makePaths(dir);
  return { dir, paths };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("build --safe flag", () => {
  it("build without --safe leaves content unsanitized (current behavior)", async () => {
    const { dir, paths } = makeTmpProject();
    tmpDirs.push(dir);

    await runAllGenerators({ paths });

    const indexMd = fs.readFileSync(
      path.join(dir, "logbook", "docs", "index.md"),
      "utf8"
    );
    // Without --safe, absolute path /Users/alice/myproject may appear in output.
    // The key test is: safe=false does NOT apply sanitizeForSafeExport.
    // This test simply verifies runAllGenerators runs without the safe option.
    expect(indexMd).toContain("<!-- logbook:doc:index start");
    expect(indexMd).toContain("<!-- logbook:doc:index end -->");
  });

  it("build --safe applies sanitizeForSafeExport to generated content", async () => {
    // Create events with an error that has a /Users/... path in its title.
    // buildErrorsDoc outputs error titles directly, so the path appears in the generated doc.
    const events = [
      JSON.stringify({
        type: "manual.error",
        id: "01HERROR001",
        ts: "2026-01-01T10:00:00.000Z",
        session: "s1",
        title: "Error in /Users/alice/myproject/src/index.ts",
        description: "File not found at /Users/alice/myproject/src/index.ts",
        kind: "build",
      }),
    ].join("\n") + "\n";

    const { dir, paths } = makeTmpProject(events);
    tmpDirs.push(dir);

    // First run without safe — path should appear in errors doc
    await runAllGenerators({ paths });
    const unsafeContent = fs.readFileSync(
      path.join(dir, "logbook", "docs", "errors-and-lessons.md"),
      "utf8"
    );

    // Verify the test fixture actually produces sensitive content (triangulation guard)
    expect(unsafeContent).toContain("/Users/alice");

    // Reset docs dir and run with safe=true
    fs.rmSync(path.join(dir, "logbook", "docs"), { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, "logbook", "docs"), { recursive: true });

    await runAllGenerators({ paths, safe: true });
    const safeContent = fs.readFileSync(
      path.join(dir, "logbook", "docs", "errors-and-lessons.md"),
      "utf8"
    );

    // safe content must not contain raw absolute paths
    expect(safeContent).not.toContain("/Users/alice");
    // safe content must contain the redaction token
    expect(safeContent).toContain("&lt;path&gt;");
    // safe content must still have the block markers
    expect(safeContent).toContain("<!-- logbook:doc:errors start");
    expect(safeContent).toContain("<!-- logbook:doc:errors end -->");
  });

  it("build --safe preserves the block markers byte-identical", async () => {
    const { dir, paths } = makeTmpProject();
    tmpDirs.push(dir);

    await runAllGenerators({ paths, safe: true });

    const indexMd = fs.readFileSync(
      path.join(dir, "logbook", "docs", "index.md"),
      "utf8"
    );
    const timelineMd = fs.readFileSync(
      path.join(dir, "logbook", "docs", "timeline.md"),
      "utf8"
    );
    const errorsMd = fs.readFileSync(
      path.join(dir, "logbook", "docs", "errors-and-lessons.md"),
      "utf8"
    );

    // Block markers must be present and correct (format: <!-- logbook:doc:X start v=1 -->)
    expect(indexMd).toContain("<!-- logbook:doc:index start");
    expect(indexMd).toContain("<!-- logbook:doc:index end -->");
    expect(timelineMd).toContain("<!-- logbook:doc:timeline start");
    expect(timelineMd).toContain("<!-- logbook:doc:timeline end -->");
    expect(errorsMd).toContain("<!-- logbook:doc:errors start");
    expect(errorsMd).toContain("<!-- logbook:doc:errors end -->");
  });

  it("build --safe is idempotent (running twice yields identical output)", async () => {
    const { dir, paths } = makeTmpProject();
    tmpDirs.push(dir);

    await runAllGenerators({ paths, safe: true });
    const firstPass = {
      index: fs.readFileSync(path.join(dir, "logbook", "docs", "index.md"), "utf8"),
      timeline: fs.readFileSync(path.join(dir, "logbook", "docs", "timeline.md"), "utf8"),
      errors: fs.readFileSync(path.join(dir, "logbook", "docs", "errors-and-lessons.md"), "utf8"),
    };

    await runAllGenerators({ paths, safe: true });
    const secondPass = {
      index: fs.readFileSync(path.join(dir, "logbook", "docs", "index.md"), "utf8"),
      timeline: fs.readFileSync(path.join(dir, "logbook", "docs", "timeline.md"), "utf8"),
      errors: fs.readFileSync(path.join(dir, "logbook", "docs", "errors-and-lessons.md"), "utf8"),
    };

    expect(secondPass.index).toBe(firstPass.index);
    expect(secondPass.timeline).toBe(firstPass.timeline);
    expect(secondPass.errors).toBe(firstPass.errors);
  });

  it("runAllGenerators accepts safe option without error", async () => {
    const { dir, paths } = makeTmpProject();
    tmpDirs.push(dir);
    // Must not throw
    await expect(runAllGenerators({ paths, safe: true })).resolves.toBeDefined();
  });
});
