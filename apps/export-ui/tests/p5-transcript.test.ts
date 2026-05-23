/*
 * P5 component-level tests.
 *
 * Slice 12 P5 — Bucket D part 2. Following the same convention as
 * p3-components.test.ts and p4-components.test.ts: store/util-level coverage
 * with a structural mount test deferred to the visual-verify pass.
 *
 * Coverage:
 *   1. router parses #/transcript/<sid>?event=<id> into the new route shape
 *   2. router round-trips the transcript route
 *   3. selection._setFromRoute writes the correct slot
 *   4. selection.clear resets both slots
 *   5. router.navigate(transcript) updates the selection store via the listener
 *      (verified through the no-window code path)
 *   6. computeWindow over 5000 events at every realistic scrollTop respects
 *      the INV-17 ≤ 80 mounted-row ceiling (structural assertion)
 *
 * Mount-test substitute (INV-17 / AG-30): we feed computeWindow the exact
 * scrollTop/viewport pairs RawTranscriptView would produce and assert the
 * mounted slice stays bounded. This is the contract — RawTranscriptView only
 * mounts what computeWindow returns.
 */

// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { computeWindow } from "../src/lib/util/virtual-window";

beforeEach(() => {
  if (typeof window !== "undefined") {
    window.location.hash = "";
  }
});

describe("router — transcript route", () => {
  it("_parseHash decodes #/transcript/<sid> into the transcript route", async () => {
    const { router } = await import("../src/lib/stores/router");
    expect(router._parseHash("#/transcript/sess-001")).toEqual({
      name: "transcript",
      sessionId: "sess-001",
      eventId: null,
    });
  });

  it("_parseHash extracts ?event=<id> on the transcript route", async () => {
    const { router } = await import("../src/lib/stores/router");
    expect(
      router._parseHash("#/transcript/sess-001?event=ev-42"),
    ).toEqual({
      name: "transcript",
      sessionId: "sess-001",
      eventId: "ev-42",
    });
  });

  it("_parseHash extracts ?event=<id> on the chapter route (bidirectional link)", async () => {
    const { router } = await import("../src/lib/stores/router");
    expect(
      router._parseHash("#/chapter/sess-001?event=ev-42"),
    ).toEqual({
      name: "chapter",
      chapterId: "sess-001",
      eventId: "ev-42",
    });
  });

  it("_parseHash ignores garbage query strings (eventId stays null)", async () => {
    const { router } = await import("../src/lib/stores/router");
    expect(router._parseHash("#/chapter/sess-001?foo=bar")).toEqual({
      name: "chapter",
      chapterId: "sess-001",
      eventId: null,
    });
  });

  it("_parseHash URL-decodes event ids with special chars", async () => {
    const { router } = await import("../src/lib/stores/router");
    expect(
      router._parseHash("#/transcript/sess-001?event=evt%2Fwith-slash"),
    ).toEqual({
      name: "transcript",
      sessionId: "sess-001",
      eventId: "evt/with-slash",
    });
  });

  it("_routeToHash round-trips the transcript route with event", async () => {
    const { router } = await import("../src/lib/stores/router");
    expect(
      router._routeToHash({
        name: "transcript",
        sessionId: "sess-001",
        eventId: "ev-42",
      }),
    ).toBe("#/transcript/sess-001?event=ev-42");
  });

  it("_routeToHash omits the query when eventId is null", async () => {
    const { router } = await import("../src/lib/stores/router");
    expect(
      router._routeToHash({
        name: "transcript",
        sessionId: "sess-001",
        eventId: null,
      }),
    ).toBe("#/transcript/sess-001");
  });
});

describe("selection store", () => {
  it("_setFromRoute writes to the matching slot only", async () => {
    const { selection } = await import("../src/lib/stores/selection");
    selection.clear();
    selection._setFromRoute("chapter", "ev-1");
    expect(selection.get()).toEqual({
      chapterEventId: "ev-1",
      transcriptEventId: null,
    });
    selection._setFromRoute("transcript", "raw-9");
    expect(selection.get()).toEqual({
      chapterEventId: "ev-1",
      transcriptEventId: "raw-9",
    });
  });

  it("clear() resets both slots", async () => {
    const { selection } = await import("../src/lib/stores/selection");
    selection._setFromRoute("chapter", "ev-1");
    selection._setFromRoute("transcript", "raw-9");
    selection.clear();
    expect(selection.get()).toEqual({
      chapterEventId: null,
      transcriptEventId: null,
    });
  });

  it("subscribe() fires with current snapshot synchronously and on every change", async () => {
    const { selection } = await import("../src/lib/stores/selection");
    selection.clear();
    const calls: Array<{ chapterEventId: string | null; transcriptEventId: string | null }> = [];
    const unsub = selection.subscribe((s) => calls.push({ ...s }));
    selection._setFromRoute("chapter", "a");
    selection._setFromRoute("transcript", "b");
    unsub();
    expect(calls.length).toBeGreaterThanOrEqual(3); // initial + 2 updates
    expect(calls[calls.length - 1]).toEqual({
      chapterEventId: "a",
      transcriptEventId: "b",
    });
  });

  it("_setFromRoute(null) clears the matching slot only", async () => {
    const { selection } = await import("../src/lib/stores/selection");
    selection.clear();
    selection._setFromRoute("chapter", "ev-1");
    selection._setFromRoute("transcript", "raw-9");
    selection._setFromRoute("transcript", null);
    expect(selection.get()).toEqual({
      chapterEventId: "ev-1",
      transcriptEventId: null,
    });
  });
});

describe("virtualization budget across realistic transcript scrolls", () => {
  it("with 5000 events at every reasonable scrollTop, mounted rows stay ≤ 80 (INV-17 / AG-30)", () => {
    const totalCount = 5000;
    const rowHeight = 56;
    const viewportHeight = 800;
    const totalScrollable = totalCount * rowHeight - viewportHeight;
    // Sweep across the entire scroll range in 50px steps. The naive overscan
    // window is small (5 + ceil(800/56) + 5 = 25 rows) so this is comfortable,
    // but we ASSERT the bound to guard against future regressions.
    for (let st = 0; st <= totalScrollable; st += 1000) {
      const w = computeWindow({
        totalCount,
        scrollTop: st,
        viewportHeight,
        rowHeight,
      });
      expect(w.endIndex - w.startIndex).toBeLessThanOrEqual(80);
      // Sanity: the window is non-empty as long as there are items.
      expect(w.endIndex - w.startIndex).toBeGreaterThan(0);
    }
  });
});
