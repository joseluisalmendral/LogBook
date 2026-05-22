/**
 * Unit tests for collectBundle — reads docs, ADRs, and teaching scripts
 * from disk and returns a structured BundleContents object.
 *
 * Strict TDD — these tests are written before the implementation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import type { ProjectPaths } from "../../src/core/paths.js";

// Lazy import so TypeScript resolves types; implementation doesn't exist yet.
// We import the module under test after fixtures are in place.
import { collectBundle } from "../../src/export/instructor-pack.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDataDir(): { dataDir: string; cleanup: () => void } {
  const tmp = fs.realpathSync(os.tmpdir());
  const dataDir = path.join(
    tmp,
    `lb-bundle-test-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(path.join(dataDir, "docs"), { recursive: true });

  return {
    dataDir,
    cleanup: () => {
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function fakePaths(dataDir: string): ProjectPaths {
  return {
    root: dataDir,
    logbookDir: path.join(dataDir, ".logbook"),
    manifestPath: path.join(dataDir, ".logbook", "install-manifest.json"),
    configPath: path.join(dataDir, ".logbook", "config.json"),
    providersPath: path.join(dataDir, ".logbook", "providers.json"),
    statePath: path.join(dataDir, ".logbook", "state.json"),
    indexDbPath: path.join(dataDir, ".logbook", "index.sqlite"),
    backupsDir: path.join(dataDir, ".logbook", "backups"),
    dataDir,
    evidenceDir: path.join(dataDir, "evidence"),
    eventsJsonl: path.join(dataDir, "evidence", "events.jsonl"),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectBundle", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanups) fn();
    cleanups.length = 0;
  });

  it("returns all sections when all docs + ADRs + teaching scripts are present", async () => {
    const { dataDir, cleanup } = makeTmpDataDir();
    cleanups.push(cleanup);

    // Core docs
    fs.writeFileSync(
      path.join(dataDir, "docs", "index.md"),
      "# Project Index\n\nSome content.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "docs", "timeline.md"),
      "# Timeline\n\nSome events.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "docs", "errors-and-lessons.md"),
      "# Errors and Lessons\n\nSome lessons.\n"
    );

    // ADRs
    fs.mkdirSync(path.join(dataDir, "decisions"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "decisions", "0001-use-vite.md"),
      "# Use Vite\n\nDecision to use Vite.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "decisions", "0002-use-typescript.md"),
      "# Use TypeScript\n\nDecision to use TypeScript.\n"
    );

    // Teaching scripts
    fs.mkdirSync(path.join(dataDir, "teaching-scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "teaching-scripts", "session-01.md"),
      "# Session 01\n\nTeaching content.\n"
    );

    const bundle = await collectBundle(fakePaths(dataDir));

    expect(bundle.overview).toHaveLength(3);
    expect(bundle.adrs).toHaveLength(2);
    expect(bundle.teachingScripts).toHaveLength(1);
  });

  it("returns overview and adrs when teaching-scripts dir is missing", async () => {
    const { dataDir, cleanup } = makeTmpDataDir();
    cleanups.push(cleanup);

    fs.writeFileSync(
      path.join(dataDir, "docs", "index.md"),
      "# Project Index\n\nContent.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "docs", "timeline.md"),
      "# Timeline\n\nContent.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "docs", "errors-and-lessons.md"),
      "# Errors and Lessons\n\nContent.\n"
    );
    fs.mkdirSync(path.join(dataDir, "decisions"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "decisions", "0001-use-react.md"),
      "# Use React\n\nDecision.\n"
    );
    // No teaching-scripts dir

    const bundle = await collectBundle(fakePaths(dataDir));

    expect(bundle.overview).toHaveLength(3);
    expect(bundle.adrs).toHaveLength(1);
    expect(bundle.teachingScripts).toHaveLength(0);
  });

  it("throws with a clear message when index.md is missing", async () => {
    const { dataDir, cleanup } = makeTmpDataDir();
    cleanups.push(cleanup);

    // Only create timeline and errors — no index.md
    fs.writeFileSync(
      path.join(dataDir, "docs", "timeline.md"),
      "# Timeline\n\nContent.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "docs", "errors-and-lessons.md"),
      "# Errors and Lessons\n\nContent.\n"
    );

    await expect(collectBundle(fakePaths(dataDir))).rejects.toThrow(
      /run `logbook build` first/i
    );
  });

  it("sorts ADRs by filename (0001 before 0002)", async () => {
    const { dataDir, cleanup } = makeTmpDataDir();
    cleanups.push(cleanup);

    fs.writeFileSync(
      path.join(dataDir, "docs", "index.md"),
      "# Project Index\n\nContent.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "docs", "timeline.md"),
      "# Timeline\n\nContent.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "docs", "errors-and-lessons.md"),
      "# Errors and Lessons\n\nContent.\n"
    );
    fs.mkdirSync(path.join(dataDir, "decisions"), { recursive: true });

    // Write in reverse order to confirm sorting
    fs.writeFileSync(
      path.join(dataDir, "decisions", "0002-second.md"),
      "# Second Decision\n\nContent.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "decisions", "0001-first.md"),
      "# First Decision\n\nContent.\n"
    );

    const bundle = await collectBundle(fakePaths(dataDir));

    expect(bundle.adrs[0]?.id).toBe("0001-first");
    expect(bundle.adrs[1]?.id).toBe("0002-second");
  });

  it("overview sections have correct ids and titles from first heading", async () => {
    const { dataDir, cleanup } = makeTmpDataDir();
    cleanups.push(cleanup);

    fs.writeFileSync(
      path.join(dataDir, "docs", "index.md"),
      "# My Project Index\n\nContent.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "docs", "timeline.md"),
      "# Project Timeline\n\nContent.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "docs", "errors-and-lessons.md"),
      "# Errors and Lessons\n\nContent.\n"
    );

    const bundle = await collectBundle(fakePaths(dataDir));

    const indexSection = bundle.overview.find((s) => s.id === "index");
    expect(indexSection).toBeDefined();
    expect(indexSection?.title).toBe("My Project Index");

    const timelineSection = bundle.overview.find((s) => s.id === "timeline");
    expect(timelineSection).toBeDefined();
    expect(timelineSection?.title).toBe("Project Timeline");
  });

  it("ADR id is derived from filename stem (lowercase, hyphenated)", async () => {
    const { dataDir, cleanup } = makeTmpDataDir();
    cleanups.push(cleanup);

    fs.writeFileSync(
      path.join(dataDir, "docs", "index.md"),
      "# Project Index\n\nContent.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "docs", "timeline.md"),
      "# Timeline\n\nContent.\n"
    );
    fs.writeFileSync(
      path.join(dataDir, "docs", "errors-and-lessons.md"),
      "# Errors and Lessons\n\nContent.\n"
    );
    fs.mkdirSync(path.join(dataDir, "decisions"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "decisions", "0001-use-vite.md"),
      "# Use Vite\n\nContent.\n"
    );

    const bundle = await collectBundle(fakePaths(dataDir));

    expect(bundle.adrs[0]?.id).toBe("0001-use-vite");
  });
});
