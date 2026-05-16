/**
 * Unit tests for src/review/persist.ts (T11).
 *
 * Tests persistReviewDecisions: translates final ReviewState into JSONL appends.
 *
 * TDD Cycle:
 *   RED  → fail with "Cannot find module" (module not yet created)
 *   GREEN → implement src/review/persist.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initialState, reduce } from "../../src/review/flows.js";
import { persistReviewDecisions } from "../../src/review/persist.js";
import type { ReviewItem } from "../../src/types/review.js";
import type { ProjectPaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(id: string, kind: ReviewItem["kind"] = "pending_suggestion"): ReviewItem {
  return {
    id,
    kind,
    ts: `2026-01-01T10:00:00.00${id.slice(-1)}Z`,
    preview: `Preview for ${id}`,
    raw: { id, type: "manual.decision" },
  };
}

function makeTmpPaths(): { tmpDir: string; paths: ProjectPaths } {
  const tmpDir = fs.realpathSync(os.tmpdir());
  const dir = path.join(tmpDir, `lb-persist-test-${Math.random().toString(36).slice(2)}`);
  const logbookDir = path.join(dir, ".logbook");
  const evidenceDir = path.join(dir, "logbook", "evidence");
  fs.mkdirSync(logbookDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "test" }));

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
    decisionsJsonl: path.join(evidenceDir, "decisions.jsonl"),
    errorsJsonl: path.join(evidenceDir, "errors.jsonl"),
    lessonsJsonl: path.join(evidenceDir, "lessons.jsonl"),
  };
  return { tmpDir: dir, paths };
}

function readEvents(paths: ProjectPaths): Record<string, unknown>[] {
  if (!fs.existsSync(paths.eventsJsonl)) return [];
  const lines = fs.readFileSync(paths.eventsJsonl, "utf-8").split("\n");
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("persistReviewDecisions", () => {
  let tmpDir: string;
  let paths: ProjectPaths;

  beforeEach(() => {
    ({ tmpDir, paths } = makeTmpPaths());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns counts: 2 promoted, 1 discarded, 1 skipped", async () => {
    const items = [
      makeItem("A"),
      makeItem("B"),
      makeItem("C"),
      makeItem("D"),
    ];
    let state = initialState(items);
    // Promote A (high)
    state = reduce(state, { type: "promote", teaching: "high" });
    // Promote B (medium) - index auto-advances to B after A
    state = reduce(state, { type: "promote", teaching: "medium" });
    // Discard C
    state = reduce(state, { type: "discard" });
    // Skip D
    state = reduce(state, { type: "skip" });

    const counts = await persistReviewDecisions({ paths, state });

    expect(counts.promoted).toBe(2);
    expect(counts.discarded).toBe(1);
    expect(counts.skipped).toBe(1);
  });

  it("appends manual.promote events for promoted items with correct teachingValue", async () => {
    const items = [makeItem("X"), makeItem("Y")];
    let state = initialState(items);
    state = reduce(state, { type: "promote", teaching: "high" });
    state = reduce(state, { type: "promote", teaching: "low" });

    await persistReviewDecisions({ paths, state });

    const events = readEvents(paths);
    const promotes = events.filter((e) => e["type"] === "manual.promote");
    expect(promotes).toHaveLength(2);

    const promoteX = promotes.find((e) => e["eventId"] === "X");
    const promoteY = promotes.find((e) => e["eventId"] === "Y");

    expect(promoteX).toBeDefined();
    expect(promoteX!["teachingValue"]).toBe("high");

    expect(promoteY).toBeDefined();
    expect(promoteY!["teachingValue"]).toBe("low");
  });

  it("appends manual.discard event for discarded items", async () => {
    const items = [makeItem("Z")];
    let state = initialState(items);
    state = reduce(state, { type: "discard" });

    await persistReviewDecisions({ paths, state });

    const events = readEvents(paths);
    const discards = events.filter((e) => e["type"] === "manual.discard");
    expect(discards).toHaveLength(1);
    expect(discards[0]!["eventId"]).toBe("Z");
  });

  it("does NOT append any event for skipped items", async () => {
    const items = [makeItem("S")];
    let state = initialState(items);
    state = reduce(state, { type: "skip" });

    await persistReviewDecisions({ paths, state });

    const events = readEvents(paths);
    // No events at all for skipped
    const related = events.filter(
      (e) => e["type"] === "manual.promote" || e["type"] === "manual.discard",
    );
    expect(related).toHaveLength(0);
  });

  it("appended manual.promote events have required top-level fields (id, ts, source)", async () => {
    const items = [makeItem("Q")];
    let state = initialState(items);
    state = reduce(state, { type: "promote", teaching: "medium" });

    await persistReviewDecisions({ paths, state });

    const events = readEvents(paths);
    const promote = events.find((e) => e["type"] === "manual.promote");
    expect(promote).toBeDefined();
    expect(typeof promote!["id"]).toBe("string");
    expect(promote!["id"]).not.toBe("");
    expect(typeof promote!["ts"]).toBe("string");
    expect(promote!["source"]).toBe("review-tui");
  });

  it("appended manual.discard events have required top-level fields (id, ts, source)", async () => {
    const items = [makeItem("R")];
    let state = initialState(items);
    state = reduce(state, { type: "discard" });

    await persistReviewDecisions({ paths, state });

    const events = readEvents(paths);
    const discard = events.find((e) => e["type"] === "manual.discard");
    expect(discard).toBeDefined();
    expect(typeof discard!["id"]).toBe("string");
    expect(discard!["id"]).not.toBe("");
    expect(typeof discard!["ts"]).toBe("string");
    expect(discard!["source"]).toBe("review-tui");
  });

  it("handles empty state (no decisions) gracefully — 0 events, returns {promoted:0,discarded:0,skipped:0}", async () => {
    const items = [makeItem("E")];
    const state = initialState(items); // no actions dispatched

    const counts = await persistReviewDecisions({ paths, state });

    expect(counts.promoted).toBe(0);
    expect(counts.discarded).toBe(0);
    expect(counts.skipped).toBe(0);
    expect(readEvents(paths)).toHaveLength(0);
  });

  it("creates events.jsonl if it did not exist before", async () => {
    const items = [makeItem("N")];
    let state = initialState(items);
    state = reduce(state, { type: "promote", teaching: "medium" });

    expect(fs.existsSync(paths.eventsJsonl)).toBe(false);

    await persistReviewDecisions({ paths, state });

    expect(fs.existsSync(paths.eventsJsonl)).toBe(true);
    const events = readEvents(paths);
    expect(events.length).toBeGreaterThan(0);
  });
});
