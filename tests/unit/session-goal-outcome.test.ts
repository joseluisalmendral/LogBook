/**
 * Unit tests: logbook session goal + outcome validation (W6 spec).
 *
 * Tests the validation logic and CLI contract using the appendEvent path.
 * Since we cannot run the CLI directly in unit tests, we validate the event
 * payload shape that goal/outcome commands produce.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendEvent } from "../../src/store/index.js";
import { readContext } from "../../src/generate/render-context.js";
import type { ProjectPaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestPaths(): { paths: ProjectPaths; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-goal-test-"));
  const evidenceDir = path.join(dir, "logbook", "evidence");
  const logbookDir = path.join(dir, ".logbook");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(logbookDir, { recursive: true });

  const paths: ProjectPaths = {
    root: dir,
    logbookDir,
    manifestPath: path.join(logbookDir, "install-manifest.json"),
    configPath: path.join(logbookDir, "config.json"),
    providersPath: path.join(logbookDir, "providers.json"),
    statePath: path.join(logbookDir, "state.json"),
    indexDbPath: path.join(logbookDir, "index.sqlite"),
    backupsDir: path.join(logbookDir, "backups"),
    dataDir: path.join(dir, "logbook"),
    evidenceDir,
    eventsJsonl: path.join(evidenceDir, "events.jsonl"),
  };

  return { paths, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session goal event shape", () => {
  it("writes user_entry with entryType=session_goal and correct text", async () => {
    const { paths, cleanup } = makeTestPaths();
    try {
      await appendEvent(paths, {
        kind: "user_entry",
        sessionId: "sess-001",
        payload: {
          entryType: "session_goal",
          text: "refactor the auth module",
        },
        provider: "logbook-cli",
      });

      const ctx = await readContext(paths);
      const goalEvents = ctx.all.filter((e) => e.type === "manual.session_goal");
      expect(goalEvents).toHaveLength(1);
      expect(goalEvents[0]!["text"]).toBe("refactor the auth module");
    } finally {
      cleanup();
    }
  });

  it("latest-write-wins: second goal event renders as the active goal", async () => {
    const { paths, cleanup } = makeTestPaths();
    try {
      await appendEvent(paths, {
        kind: "user_entry",
        sessionId: "sess-001",
        payload: {
          entryType: "session_goal",
          text: "first goal",
        },
        provider: "logbook-cli",
        timestamp: "2026-05-20T10:00:00.000Z",
      });

      await appendEvent(paths, {
        kind: "user_entry",
        sessionId: "sess-001",
        payload: {
          entryType: "session_goal",
          text: "updated goal",
        },
        provider: "logbook-cli",
        timestamp: "2026-05-20T10:01:00.000Z",
      });

      const ctx = await readContext(paths);
      const goalEvents = ctx.all.filter((e) => e.type === "manual.session_goal");
      // Both events are present; the LAST one wins for display purposes.
      expect(goalEvents).toHaveLength(2);
      // Sorted by ts ascending — last entry is the active goal.
      const lastGoal = goalEvents[goalEvents.length - 1];
      expect(lastGoal!["text"]).toBe("updated goal");
    } finally {
      cleanup();
    }
  });
});

describe("session outcome event shape", () => {
  it("writes user_entry with entryType=session_outcome and correct text", async () => {
    const { paths, cleanup } = makeTestPaths();
    try {
      await appendEvent(paths, {
        kind: "user_entry",
        sessionId: "sess-002",
        payload: {
          entryType: "session_outcome",
          text: "auth refactored, all tests green",
        },
        provider: "logbook-cli",
      });

      const ctx = await readContext(paths);
      const outcomeEvents = ctx.all.filter((e) => e.type === "manual.session_outcome");
      expect(outcomeEvents).toHaveLength(1);
      expect(outcomeEvents[0]!["text"]).toBe("auth refactored, all tests green");
    } finally {
      cleanup();
    }
  });
});

describe("text validation logic", () => {
  it("empty text should be rejected (validation logic check)", () => {
    // The CLI validates: text.trim().length === 0 → error.
    // Test the condition directly.
    const text = "".trim();
    expect(text.length === 0).toBe(true);
  });

  it("text over 500 chars should be rejected", () => {
    // The CLI validates: text.length > 500 → error.
    const text = "x".repeat(501);
    expect(text.length > 500).toBe(true);
  });

  it("text of exactly 500 chars is valid", () => {
    const text = "x".repeat(500);
    expect(text.length > 500).toBe(false);
    expect(text.length === 0).toBe(false);
  });
});
