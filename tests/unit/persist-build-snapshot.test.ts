/**
 * Unit tests for src/tui/persist.ts — buildSnapshot function (iter6 T5).
 *
 * TDD Cycle:
 *   RED  → fail: "Cannot find module src/tui/persist.js"
 *   GREEN → implement buildSnapshot so all cases pass
 *
 * Strategy:
 *   - null paths → returns empty snapshot with installed=false
 *   - paths with manifest → installed=true, fields populated
 *   - paths without events.jsonl → recentEvents=[]
 *   - paths with 10 events → recentEvents has last 5
 *   - paths with pending-suggestions.jsonl → pendingReview count
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ProjectPaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Lazy import (so the RED phase fails at runtime, not parse time)
// ---------------------------------------------------------------------------

async function importBuildSnapshot() {
  const mod = await import("../../src/tui/persist.js");
  return mod.buildSnapshot;
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface TmpProject {
  root: string;
  paths: ProjectPaths;
}

function makePaths(root: string): ProjectPaths {
  const logbookDir = path.join(root, ".logbook");
  const evidenceDir = path.join(root, "logbook", "evidence");
  return {
    root,
    logbookDir,
    manifestPath: path.join(logbookDir, "install-manifest.json"),
    configPath: path.join(logbookDir, "config.json"),
    providersPath: path.join(logbookDir, "providers.json"),
    statePath: path.join(logbookDir, "state.json"),
    indexDbPath: path.join(logbookDir, "index.sqlite"),
    backupsDir: path.join(logbookDir, "backups"),
    dataDir: path.join(root, "logbook"),
    evidenceDir,
    eventsJsonl: path.join(evidenceDir, "events.jsonl"),
    decisionsJsonl: path.join(evidenceDir, "decisions.jsonl"),
    errorsJsonl: path.join(evidenceDir, "errors.jsonl"),
    lessonsJsonl: path.join(evidenceDir, "lessons.jsonl"),
  };
}

/** A minimal valid manifest JSON string */
function minimalManifest(preset = "minimal"): string {
  return JSON.stringify({
    version: 1,
    installed_at: "2026-05-16T10:00:00Z",
    preset,
    artifacts: [
      {
        id: "lb-hook-pre",
        kind: "hook",
        file_path: ".claude/hooks/post-tool-use.sh",
      },
    ],
    backups: [],
  }, null, 2) + "\n";
}

/** Create a tmp directory with the full logbook structure */
function createTmpProject(): TmpProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-persist-test-"));
  const paths = makePaths(root);

  // Create directories
  fs.mkdirSync(paths.logbookDir, { recursive: true });
  fs.mkdirSync(paths.evidenceDir, { recursive: true });
  fs.mkdirSync(path.join(root, "logbook"), { recursive: true });

  return { root, paths };
}

/** Write a minimal valid manifest to the tmp project */
function writeManifest(paths: ProjectPaths, preset = "minimal"): void {
  fs.writeFileSync(paths.manifestPath, minimalManifest(preset), "utf8");
}

/** Write a valid state.json */
function writeState(paths: ProjectPaths, overrides: Record<string, unknown> = {}): void {
  const state = {
    version: 1,
    disabled: false,
    warnings: [],
    staleLocksReleased: 0,
    ...overrides,
  };
  fs.writeFileSync(paths.statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** Generate N event lines as JSONL */
function makeEventLines(n: number): string {
  return Array.from({ length: n }, (_, i) => JSON.stringify({
    ts: `2026-05-16T10:0${i}:00Z`,
    type: "tool_use",
    preview: `Event ${i}`,
  })).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

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

describe("buildSnapshot — null paths (no project root)", () => {
  it("returns installed=false snapshot with null projectRoot", async () => {
    const buildSnapshot = await importBuildSnapshot();
    const snap = await buildSnapshot(null);

    expect(snap.installed).toBe(false);
    expect(snap.projectRoot).toBeNull();
    expect(snap.manifestSize).toBe(0);
    expect(snap.recentEvents).toEqual([]);
    expect(snap.pendingReview).toBe(0);
    expect(snap.adrCount).toBe(0);
    expect(snap.lessonCount).toBe(0);
    expect(snap.budget).toBe(500);
  });

  it("returns zero tokenBreakdown for null paths", async () => {
    const buildSnapshot = await importBuildSnapshot();
    const snap = await buildSnapshot(null);

    expect(snap.tokenBreakdown.skill).toBe(0);
    expect(snap.tokenBreakdown.augmentClaudemd).toBe(0);
    expect(snap.tokenBreakdown.mcpToolDescriptions).toBe(0);
    expect(snap.fixedContextTokens).toBe(0);
  });
});

describe("buildSnapshot — paths with manifest", () => {
  it("returns installed=true when manifest exists", async () => {
    const buildSnapshot = await importBuildSnapshot();
    const tmp = createTmpProject();
    tmpDirs.push(tmp.root);
    writeManifest(tmp.paths, "minimal");

    const snap = await buildSnapshot(tmp.paths);

    expect(snap.installed).toBe(true);
    expect(snap.projectRoot).toBe(tmp.root);
    expect(snap.preset).toBe("minimal");
    expect(snap.manifestSize).toBeGreaterThan(0);
  });

  it("reads disabled flag from state.json", async () => {
    const buildSnapshot = await importBuildSnapshot();
    const tmp = createTmpProject();
    tmpDirs.push(tmp.root);
    writeManifest(tmp.paths);
    writeState(tmp.paths, { disabled: true });

    const snap = await buildSnapshot(tmp.paths);

    expect(snap.disabled).toBe(true);
  });

  it("installed=false when manifest file does not exist", async () => {
    const buildSnapshot = await importBuildSnapshot();
    const tmp = createTmpProject();
    tmpDirs.push(tmp.root);
    // No manifest written

    const snap = await buildSnapshot(tmp.paths);

    expect(snap.installed).toBe(false);
  });
});

describe("buildSnapshot — events.jsonl handling", () => {
  it("recentEvents is empty when events.jsonl does not exist", async () => {
    const buildSnapshot = await importBuildSnapshot();
    const tmp = createTmpProject();
    tmpDirs.push(tmp.root);
    writeManifest(tmp.paths);

    const snap = await buildSnapshot(tmp.paths);

    expect(snap.recentEvents).toEqual([]);
  });

  it("recentEvents returns last 5 when 10 events exist", async () => {
    const buildSnapshot = await importBuildSnapshot();
    const tmp = createTmpProject();
    tmpDirs.push(tmp.root);
    writeManifest(tmp.paths);

    // Write 10 events
    const lines = makeEventLines(10);
    fs.writeFileSync(tmp.paths.eventsJsonl, lines, "utf8");

    const snap = await buildSnapshot(tmp.paths);

    expect(snap.recentEvents).toHaveLength(5);
    // Last event is Event 9 (index 9)
    expect(snap.recentEvents[0]?.type).toBe("tool_use");
  });

  it("recentEvents returns all events when fewer than 5 exist", async () => {
    const buildSnapshot = await importBuildSnapshot();
    const tmp = createTmpProject();
    tmpDirs.push(tmp.root);
    writeManifest(tmp.paths);

    const lines = makeEventLines(3);
    fs.writeFileSync(tmp.paths.eventsJsonl, lines, "utf8");

    const snap = await buildSnapshot(tmp.paths);

    expect(snap.recentEvents).toHaveLength(3);
  });
});

describe("buildSnapshot — pending-suggestions.jsonl", () => {
  it("pendingReview is 0 when file does not exist", async () => {
    const buildSnapshot = await importBuildSnapshot();
    const tmp = createTmpProject();
    tmpDirs.push(tmp.root);
    writeManifest(tmp.paths);

    const snap = await buildSnapshot(tmp.paths);

    expect(snap.pendingReview).toBe(0);
  });

  it("pendingReview counts lines in pending-suggestions.jsonl", async () => {
    const buildSnapshot = await importBuildSnapshot();
    const tmp = createTmpProject();
    tmpDirs.push(tmp.root);
    writeManifest(tmp.paths);

    // Write 3 pending suggestions
    const pendingPath = path.join(tmp.paths.logbookDir, "pending-suggestions.jsonl");
    fs.writeFileSync(pendingPath, '{"id":"1"}\n{"id":"2"}\n{"id":"3"}\n', "utf8");

    const snap = await buildSnapshot(tmp.paths);

    expect(snap.pendingReview).toBe(3);
  });
});

describe("buildSnapshot — error resilience", () => {
  it("does not throw when logbookDir directories are missing", async () => {
    const buildSnapshot = await importBuildSnapshot();
    // Create paths pointing at a completely empty tmp dir (no subdirs)
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-empty-"));
    tmpDirs.push(root);
    const paths = makePaths(root);

    await expect(buildSnapshot(paths)).resolves.toBeDefined();
  });
});
