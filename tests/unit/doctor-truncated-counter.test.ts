/**
 * Unit tests for countTruncatedLast24h (persistence-truthfulness PR 4).
 *
 * Verifies:
 *  - N truncated events within the last 24h → returns N.
 *  - M events outside the 24h window are not counted.
 *  - Non-truncated events are not counted.
 *  - N=0 → returns 0 (no false positives).
 *  - Missing events.jsonl → returns 0 (graceful degradation).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ProjectPaths } from "../../src/core/paths.js";
import { countTruncatedLast24h } from "../../src/cli/commands/doctor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

function makeTmpPaths(): { paths: ProjectPaths; tmpDir: string } {
  const tmpDir = path.join(
    fs.realpathSync(os.tmpdir()),
    `lb-doctor-trunc-${Math.random().toString(36).slice(2)}`,
  );
  const logbookDir = path.join(tmpDir, ".logbook");
  const evidenceDir = path.join(tmpDir, "logbook", "evidence");
  fs.mkdirSync(logbookDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  tmpDirs.push(tmpDir);

  const paths: ProjectPaths = {
    root: tmpDir,
    logbookDir,
    manifestPath: path.join(logbookDir, "install-manifest.json"),
    configPath: path.join(logbookDir, "config.json"),
    providersPath: path.join(logbookDir, "providers.json"),
    statePath: path.join(logbookDir, "state.json"),
    indexDbPath: path.join(logbookDir, "index.sqlite"),
    backupsDir: path.join(logbookDir, "backups"),
    dataDir: path.join(tmpDir, "logbook"),
    evidenceDir,
    eventsJsonl: path.join(evidenceDir, "events.jsonl"),
  };
  return { paths, tmpDir };
}

/**
 * ISO timestamp N hours ago (negative = in the future, positive = in the past).
 */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/**
 * Write an array of event objects to events.jsonl (one per line).
 * Each event gets a Shape-A timestamp field used by readContext normalization.
 */
function writeEvents(eventsJsonl: string, events: Record<string, unknown>[]): void {
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(eventsJsonl, lines, "utf8");
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("countTruncatedLast24h", () => {
  it("returns 0 when events.jsonl does not exist", async () => {
    const { paths } = makeTmpPaths();
    // Do not create events.jsonl
    const count = await countTruncatedLast24h(paths);
    expect(count).toBe(0);
  });

  it("returns 0 when there are no truncated events at all", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      {
        id: "01AAA",
        kind: "system",
        timestamp: hoursAgo(1),
        ts: hoursAgo(1),
        sessionId: "s1",
        schemaVersion: 3,
        payload: { entryType: "mcp_audit", tool: "Bash", inputHash: "abc" },
        meta: { parse_error: false },
        redacted: false,
      },
    ]);
    const count = await countTruncatedLast24h(paths);
    expect(count).toBe(0);
  });

  it("counts N truncated events within the last 24h", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      // 2 truncated events within 24h
      {
        id: "01TRUNC1",
        kind: "system",
        timestamp: hoursAgo(2),
        ts: hoursAgo(2),
        sessionId: "s1",
        schemaVersion: 3,
        payload: { entryType: "mcp_audit", tool: "Bash", inputHash: "abc" },
        meta: { truncated: true, parse_error: true },
        redacted: false,
      },
      {
        id: "01TRUNC2",
        kind: "system",
        timestamp: hoursAgo(5),
        ts: hoursAgo(5),
        sessionId: "s1",
        schemaVersion: 3,
        payload: { entryType: "mcp_audit", tool: "Bash", inputHash: "def" },
        meta: { truncated: true },
        redacted: false,
      },
      // 1 non-truncated event within 24h — should NOT be counted
      {
        id: "01CLEAN",
        kind: "user_entry",
        timestamp: hoursAgo(3),
        ts: hoursAgo(3),
        sessionId: "s1",
        schemaVersion: 3,
        payload: { entryType: "lesson", title: "test lesson" },
        meta: {},
        redacted: false,
      },
    ]);

    const count = await countTruncatedLast24h(paths);
    expect(count).toBe(2);
  });

  it("does not count truncated events outside the 24h window", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      // 1 truncated event within 24h
      {
        id: "01RECENT",
        kind: "system",
        timestamp: hoursAgo(1),
        ts: hoursAgo(1),
        sessionId: "s1",
        schemaVersion: 3,
        payload: { entryType: "mcp_audit", tool: "Bash", inputHash: "abc" },
        meta: { truncated: true },
        redacted: false,
      },
      // 2 truncated events older than 24h — must NOT be counted
      {
        id: "01OLD1",
        kind: "system",
        timestamp: hoursAgo(25),
        ts: hoursAgo(25),
        sessionId: "s1",
        schemaVersion: 3,
        payload: { entryType: "mcp_audit", tool: "Bash", inputHash: "def" },
        meta: { truncated: true },
        redacted: false,
      },
      {
        id: "01OLD2",
        kind: "system",
        timestamp: hoursAgo(48),
        ts: hoursAgo(48),
        sessionId: "s1",
        schemaVersion: 3,
        payload: { entryType: "mcp_audit", tool: "Bash", inputHash: "ghi" },
        meta: { truncated: true },
        redacted: false,
      },
    ]);

    const count = await countTruncatedLast24h(paths);
    expect(count).toBe(1);
  });

  it("handles events with meta.truncated === false correctly (not counted)", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      {
        id: "01FALSE",
        kind: "system",
        timestamp: hoursAgo(1),
        ts: hoursAgo(1),
        sessionId: "s1",
        schemaVersion: 3,
        payload: { entryType: "mcp_audit", tool: "Bash", inputHash: "abc" },
        meta: { truncated: false },
        redacted: false,
      },
    ]);
    const count = await countTruncatedLast24h(paths);
    expect(count).toBe(0);
  });

  it("handles events with no meta field (not counted)", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      {
        id: "01NOMETA",
        kind: "user_entry",
        timestamp: hoursAgo(1),
        ts: hoursAgo(1),
        sessionId: "s1",
        schemaVersion: 3,
        payload: { entryType: "lesson", title: "no meta" },
        redacted: false,
      },
    ]);
    const count = await countTruncatedLast24h(paths);
    expect(count).toBe(0);
  });

  it("handles legacy flat-shape events (no meta.truncated) without crashing", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      // Legacy CLI flat shape — readContext normalizes these
      {
        id: "01LEGACY",
        type: "manual.lesson",
        ts: hoursAgo(1),
        title: "legacy lesson",
        body: "some content",
      },
    ]);
    const count = await countTruncatedLast24h(paths);
    expect(count).toBe(0);
  });
});
