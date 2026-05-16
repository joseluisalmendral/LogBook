/**
 * Unit tests for loadReviewItems in src/review/flows.ts (T10).
 *
 * Tests the async helper that reads pending-suggestions.jsonl + events.jsonl
 * and builds ReviewItem[] for the TUI.
 *
 * TDD Cycle:
 *   RED  → these tests fail with "Cannot find module" (module not yet created)
 *   GREEN → implement flows.ts so all tests pass
 *   REFACTOR → clean up if needed
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { loadReviewItems } from "../../src/review/flows.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(tmp, `lb-review-load-test-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonl(filePath: string, lines: object[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

let tmpDir: string;
let pendingSuggestionsPath: string;
let eventsJsonlPath: string;

beforeEach(() => {
  tmpDir = makeTmpDir();
  pendingSuggestionsPath = path.join(tmpDir, ".logbook", "pending-suggestions.jsonl");
  eventsJsonlPath = path.join(tmpDir, "logbook", "evidence", "events.jsonl");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Empty / missing files
// ---------------------------------------------------------------------------

describe("loadReviewItems — empty / missing files", () => {
  test("both files missing → returns empty array", async () => {
    const items = await loadReviewItems({ pendingSuggestionsPath, eventsJsonlPath });
    expect(items).toEqual([]);
  });

  test("pending-suggestions.jsonl exists but empty → no pending_suggestion items", async () => {
    fs.mkdirSync(path.dirname(pendingSuggestionsPath), { recursive: true });
    fs.writeFileSync(pendingSuggestionsPath, "", "utf-8");
    const items = await loadReviewItems({ pendingSuggestionsPath, eventsJsonlPath });
    expect(items.filter((i) => i.kind === "pending_suggestion")).toHaveLength(0);
  });

  test("events.jsonl exists but empty → no unclassified_event items", async () => {
    fs.mkdirSync(path.dirname(eventsJsonlPath), { recursive: true });
    fs.writeFileSync(eventsJsonlPath, "", "utf-8");
    const items = await loadReviewItems({ pendingSuggestionsPath, eventsJsonlPath });
    expect(items.filter((i) => i.kind === "unclassified_event")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pending-suggestions.jsonl
// ---------------------------------------------------------------------------

describe("loadReviewItems — pending-suggestions.jsonl", () => {
  test("3 lines → 3 pending_suggestion items with kind='pending_suggestion'", async () => {
    writeJsonl(pendingSuggestionsPath, [
      { id: "s1", ts: "2026-01-01T10:00:00.000Z", type: "suggest", payload: { description: "Suggestion 1" } },
      { id: "s2", ts: "2026-01-01T11:00:00.000Z", type: "suggest", payload: { description: "Suggestion 2" } },
      { id: "s3", ts: "2026-01-01T12:00:00.000Z", type: "suggest", payload: { description: "Suggestion 3" } },
    ]);

    const items = await loadReviewItems({ pendingSuggestionsPath, eventsJsonlPath });
    const suggestions = items.filter((i) => i.kind === "pending_suggestion");
    expect(suggestions).toHaveLength(3);
    expect(suggestions.every((s) => s.kind === "pending_suggestion")).toBe(true);
  });

  test("each suggestion item has id, kind, ts, preview (≤120 chars), raw", async () => {
    writeJsonl(pendingSuggestionsPath, [
      { id: "sug-1", ts: "2026-01-01T10:00:00.000Z", type: "suggest", payload: { description: "Short desc" } },
    ]);

    const items = await loadReviewItems({ pendingSuggestionsPath, eventsJsonlPath });
    const item = items[0]!;
    expect(item.id).toBe("sug-1");
    expect(item.kind).toBe("pending_suggestion");
    expect(item.ts).toBe("2026-01-01T10:00:00.000Z");
    expect(typeof item.preview).toBe("string");
    expect(item.preview.length).toBeLessThanOrEqual(120);
    expect(item.raw).toBeDefined();
  });

  test("preview is truncated to 120 chars for long suggestions", async () => {
    const longDescription = "X".repeat(200);
    writeJsonl(pendingSuggestionsPath, [
      { id: "long-1", ts: "2026-01-01T10:00:00.000Z", type: "suggest", payload: { description: longDescription } },
    ]);

    const items = await loadReviewItems({ pendingSuggestionsPath, eventsJsonlPath });
    expect(items[0]!.preview.length).toBeLessThanOrEqual(120);
  });
});

// ---------------------------------------------------------------------------
// events.jsonl — unclassified events
// ---------------------------------------------------------------------------

describe("loadReviewItems — unclassified events from events.jsonl", () => {
  test("2 manual.decision + 1 manual.promote (referencing decision #1) → 1 unclassified_event (decision #2)", async () => {
    // decision #1 (id: "ev-d1"): referenced by a manual.promote → classified → NOT in results
    // decision #2 (id: "ev-d2"): NOT promoted → unclassified → IN results
    writeJsonl(eventsJsonlPath, [
      {
        id: "ev-d1",
        type: "manual.decision",
        ts: "2026-01-01T10:00:00.000Z",
        title: "Decision 1",
      },
      {
        id: "ev-d2",
        type: "manual.decision",
        ts: "2026-01-01T11:00:00.000Z",
        title: "Decision 2",
      },
      {
        id: "ev-promote-1",
        type: "manual.promote",
        ts: "2026-01-01T12:00:00.000Z",
        eventId: "ev-d1",
        teachingValue: "high",
        source: "cli",
      },
    ]);

    const items = await loadReviewItems({ pendingSuggestionsPath, eventsJsonlPath });
    const unclassified = items.filter((i) => i.kind === "unclassified_event");
    expect(unclassified).toHaveLength(1);
    expect(unclassified[0]!.id).toBe("ev-d2");
  });

  test("manual.promote events themselves are NOT included as unclassified_event items", async () => {
    writeJsonl(eventsJsonlPath, [
      {
        id: "ev-d1",
        type: "manual.decision",
        ts: "2026-01-01T10:00:00.000Z",
        title: "Decision 1",
      },
      {
        id: "ev-promote-1",
        type: "manual.promote",
        ts: "2026-01-01T11:00:00.000Z",
        eventId: "ev-d1",
        teachingValue: "high",
        source: "cli",
      },
    ]);

    const items = await loadReviewItems({ pendingSuggestionsPath, eventsJsonlPath });
    // ev-d1 is referenced by a promote, so it's classified. ev-promote-1 is not a manual.* user event.
    const unclassified = items.filter((i) => i.kind === "unclassified_event");
    expect(unclassified).toHaveLength(0);
  });

  test("unclassified_event items have id, kind, ts, preview, raw", async () => {
    writeJsonl(eventsJsonlPath, [
      { id: "ev-m1", type: "manual.decision", ts: "2026-01-01T10:00:00.000Z", title: "My first decision" },
    ]);

    const items = await loadReviewItems({ pendingSuggestionsPath, eventsJsonlPath });
    const item = items.filter((i) => i.kind === "unclassified_event")[0]!;
    expect(item.id).toBe("ev-m1");
    expect(item.kind).toBe("unclassified_event");
    expect(item.ts).toBe("2026-01-01T10:00:00.000Z");
    expect(typeof item.preview).toBe("string");
    expect(item.preview.length).toBeLessThanOrEqual(120);
    expect(item.raw).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Both files present — combined and sorted
// ---------------------------------------------------------------------------

describe("loadReviewItems — combined and sorted by ts ascending", () => {
  test("items from both files are combined and sorted by ts ascending", async () => {
    writeJsonl(pendingSuggestionsPath, [
      { id: "s-late", ts: "2026-01-01T15:00:00.000Z", type: "suggest", payload: { description: "Late suggestion" } },
      { id: "s-early", ts: "2026-01-01T08:00:00.000Z", type: "suggest", payload: { description: "Early suggestion" } },
    ]);
    writeJsonl(eventsJsonlPath, [
      { id: "ev-mid", type: "manual.decision", ts: "2026-01-01T12:00:00.000Z", title: "Mid decision" },
    ]);

    const items = await loadReviewItems({ pendingSuggestionsPath, eventsJsonlPath });
    expect(items).toHaveLength(3);
    // sorted by ts ascending: s-early, ev-mid, s-late
    expect(items[0]!.id).toBe("s-early");
    expect(items[1]!.id).toBe("ev-mid");
    expect(items[2]!.id).toBe("s-late");
  });

  test("pending_suggestion and unclassified_event kinds coexist in results", async () => {
    writeJsonl(pendingSuggestionsPath, [
      { id: "s1", ts: "2026-01-01T10:00:00.000Z", type: "suggest", payload: { description: "A suggestion" } },
    ]);
    writeJsonl(eventsJsonlPath, [
      { id: "ev1", type: "manual.lesson", ts: "2026-01-01T11:00:00.000Z", title: "A lesson" },
    ]);

    const items = await loadReviewItems({ pendingSuggestionsPath, eventsJsonlPath });
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("pending_suggestion");
    expect(kinds).toContain("unclassified_event");
  });
});
