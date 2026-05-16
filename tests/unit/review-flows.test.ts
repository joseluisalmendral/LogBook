/**
 * Unit tests for src/review/flows.ts (T10).
 *
 * Tests the pure reducer (initialState, reduce, summarize).
 * No I/O, no Ink, no async — all tests are synchronous.
 *
 * TDD Cycle:
 *   RED  → these tests fail with "Cannot find module" (module not yet created)
 *   GREEN → implement flows.ts so all tests pass
 *   REFACTOR → clean up if needed
 */

import { describe, test, expect } from "vitest";
import { initialState, reduce, summarize } from "../../src/review/flows.js";
import type { ReviewItem, ReviewState } from "../../src/types/review.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(id: string, preview = `Preview for ${id}`): ReviewItem {
  return {
    id,
    kind: "pending_suggestion",
    ts: `2026-01-01T10:00:00.00${id.slice(-1)}Z`,
    preview,
    raw: { id },
  };
}

const ITEM_A = makeItem("a");
const ITEM_B = makeItem("b");
const ITEM_C = makeItem("c");
const THREE_ITEMS = [ITEM_A, ITEM_B, ITEM_C];

// ---------------------------------------------------------------------------
// initialState
// ---------------------------------------------------------------------------

describe("initialState", () => {
  test("returns index=0, no decisions, no teachingValues, exiting=false", () => {
    const state = initialState([ITEM_A, ITEM_B]);
    expect(state.index).toBe(0);
    expect(state.decisions).toEqual({});
    expect(state.teachingValues).toEqual({});
    expect(state.exiting).toBe(false);
  });

  test("holds the exact items passed in", () => {
    const state = initialState(THREE_ITEMS);
    expect(state.items).toEqual(THREE_ITEMS);
  });

  test("works with an empty items array", () => {
    const state = initialState([]);
    expect(state.index).toBe(0);
    expect(state.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// reduce — next
// ---------------------------------------------------------------------------

describe("reduce — next", () => {
  test("increments index by 1", () => {
    const s0 = initialState(THREE_ITEMS);
    const s1 = reduce(s0, { type: "next" });
    expect(s1.index).toBe(1);
  });

  test("index is capped at items.length - 1", () => {
    const s0 = initialState(THREE_ITEMS);
    const s1 = reduce(s0, { type: "next" });
    const s2 = reduce(s1, { type: "next" });
    const s3 = reduce(s2, { type: "next" }); // already at end
    expect(s3.index).toBe(2);
  });

  test("returns a new state object (pure — different reference)", () => {
    const s0 = initialState(THREE_ITEMS);
    const s1 = reduce(s0, { type: "next" });
    expect(s1).not.toBe(s0);
  });

  test("does not mutate the original state", () => {
    const s0 = initialState(THREE_ITEMS);
    const indexBefore = s0.index;
    reduce(s0, { type: "next" });
    expect(s0.index).toBe(indexBefore);
  });
});

// ---------------------------------------------------------------------------
// reduce — prev
// ---------------------------------------------------------------------------

describe("reduce — prev", () => {
  test("decrements index by 1", () => {
    const s0 = { ...initialState(THREE_ITEMS), index: 2 };
    const s1 = reduce(s0, { type: "prev" });
    expect(s1.index).toBe(1);
  });

  test("index is floored at 0", () => {
    const s0 = initialState(THREE_ITEMS); // index = 0
    const s1 = reduce(s0, { type: "prev" });
    expect(s1.index).toBe(0);
  });

  test("returns a new state object (pure — different reference)", () => {
    const s0 = { ...initialState(THREE_ITEMS), index: 2 };
    const s1 = reduce(s0, { type: "prev" });
    expect(s1).not.toBe(s0);
  });
});

// ---------------------------------------------------------------------------
// reduce — promote
// ---------------------------------------------------------------------------

describe("reduce — promote", () => {
  test("sets decisions[currentId]='promote' and teachingValues[currentId]", () => {
    const s0 = initialState(THREE_ITEMS);
    const s1 = reduce(s0, { type: "promote", teaching: "high" });
    expect(s1.decisions[ITEM_A.id]).toBe("promote");
    expect(s1.teachingValues[ITEM_A.id]).toBe("high");
  });

  test("auto-advances the cursor after promote", () => {
    const s0 = initialState(THREE_ITEMS); // index = 0 (ITEM_A)
    const s1 = reduce(s0, { type: "promote", teaching: "medium" });
    expect(s1.index).toBe(1); // auto-advanced to ITEM_B
  });

  test("supports all three teaching values: high, medium, low", () => {
    const items = [makeItem("x"), makeItem("y"), makeItem("z")];
    const s0 = initialState(items);
    const s1 = reduce(s0, { type: "promote", teaching: "high" });
    const s2 = reduce(s1, { type: "promote", teaching: "medium" });
    const s3 = reduce(s2, { type: "promote", teaching: "low" });
    expect(s1.teachingValues["x"]).toBe("high");
    expect(s2.teachingValues["y"]).toBe("medium");
    expect(s3.teachingValues["z"]).toBe("low");
  });

  test("promote on the LAST item: index stays at last (capped)", () => {
    const s0 = { ...initialState(THREE_ITEMS), index: 2 }; // last item
    const s1 = reduce(s0, { type: "promote", teaching: "low" });
    expect(s1.index).toBe(2); // capped — cannot advance past end
    expect(s1.decisions[ITEM_C.id]).toBe("promote");
  });

  test("promote on EMPTY items: returns state unchanged", () => {
    const s0 = initialState([]);
    const s1 = reduce(s0, { type: "promote", teaching: "high" });
    expect(s1).toStrictEqual(s0);
  });

  test("does not mutate original decisions object", () => {
    const s0 = initialState(THREE_ITEMS);
    const decisionsBefore = { ...s0.decisions };
    reduce(s0, { type: "promote", teaching: "medium" });
    expect(s0.decisions).toEqual(decisionsBefore);
  });

  test("returns a new state object (pure — different reference)", () => {
    const s0 = initialState(THREE_ITEMS);
    const s1 = reduce(s0, { type: "promote", teaching: "high" });
    expect(s1).not.toBe(s0);
  });
});

// ---------------------------------------------------------------------------
// reduce — discard
// ---------------------------------------------------------------------------

describe("reduce — discard", () => {
  test("sets decisions[currentId]='discard' and auto-advances", () => {
    const s0 = initialState(THREE_ITEMS); // index = 0 (ITEM_A)
    const s1 = reduce(s0, { type: "discard" });
    expect(s1.decisions[ITEM_A.id]).toBe("discard");
    expect(s1.index).toBe(1);
  });

  test("discard on the LAST item: index stays at last", () => {
    const s0 = { ...initialState(THREE_ITEMS), index: 2 };
    const s1 = reduce(s0, { type: "discard" });
    expect(s1.index).toBe(2);
    expect(s1.decisions[ITEM_C.id]).toBe("discard");
  });

  test("discard on EMPTY items: returns state unchanged", () => {
    const s0 = initialState([]);
    const s1 = reduce(s0, { type: "discard" });
    expect(s1).toStrictEqual(s0);
  });

  test("returns a new state object (pure — different reference)", () => {
    const s0 = initialState(THREE_ITEMS);
    const s1 = reduce(s0, { type: "discard" });
    expect(s1).not.toBe(s0);
  });
});

// ---------------------------------------------------------------------------
// reduce — skip
// ---------------------------------------------------------------------------

describe("reduce — skip", () => {
  test("sets decisions[currentId]='skip' and auto-advances", () => {
    const s0 = initialState(THREE_ITEMS); // index = 0 (ITEM_A)
    const s1 = reduce(s0, { type: "skip" });
    expect(s1.decisions[ITEM_A.id]).toBe("skip");
    expect(s1.index).toBe(1);
  });

  test("skip on the LAST item: index stays at last", () => {
    const s0 = { ...initialState(THREE_ITEMS), index: 2 };
    const s1 = reduce(s0, { type: "skip" });
    expect(s1.index).toBe(2);
    expect(s1.decisions[ITEM_C.id]).toBe("skip");
  });

  test("skip on EMPTY items: returns state unchanged", () => {
    const s0 = initialState([]);
    const s1 = reduce(s0, { type: "skip" });
    expect(s1).toStrictEqual(s0);
  });

  test("returns a new state object (pure — different reference)", () => {
    const s0 = initialState(THREE_ITEMS);
    const s1 = reduce(s0, { type: "skip" });
    expect(s1).not.toBe(s0);
  });
});

// ---------------------------------------------------------------------------
// reduce — exit
// ---------------------------------------------------------------------------

describe("reduce — exit", () => {
  test("sets exiting=true", () => {
    const s0 = initialState(THREE_ITEMS);
    const s1 = reduce(s0, { type: "exit" });
    expect(s1.exiting).toBe(true);
  });

  test("does not change index or decisions", () => {
    const s0 = initialState(THREE_ITEMS);
    const s1 = reduce(s0, { type: "exit" });
    expect(s1.index).toBe(s0.index);
    expect(s1.decisions).toEqual(s0.decisions);
  });

  test("returns a new state object (pure — different reference)", () => {
    const s0 = initialState(THREE_ITEMS);
    const s1 = reduce(s0, { type: "exit" });
    expect(s1).not.toBe(s0);
  });
});

// ---------------------------------------------------------------------------
// Purity: reduce never mutates input state
// ---------------------------------------------------------------------------

describe("reducer purity — original state is never mutated", () => {
  test("promote does not mutate the original state's decisions", () => {
    const s0 = initialState(THREE_ITEMS);
    const snapshot = JSON.stringify(s0);
    reduce(s0, { type: "promote", teaching: "high" });
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  test("discard does not mutate the original state", () => {
    const s0 = initialState(THREE_ITEMS);
    const snapshot = JSON.stringify(s0);
    reduce(s0, { type: "discard" });
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  test("skip does not mutate the original state", () => {
    const s0 = initialState(THREE_ITEMS);
    const snapshot = JSON.stringify(s0);
    reduce(s0, { type: "skip" });
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  test("next does not mutate the original state", () => {
    const s0 = initialState(THREE_ITEMS);
    const snapshot = JSON.stringify(s0);
    reduce(s0, { type: "next" });
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  test("prev does not mutate the original state", () => {
    const s0 = { ...initialState(THREE_ITEMS), index: 1 };
    const snapshot = JSON.stringify(s0);
    reduce(s0, { type: "prev" });
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// reduce — sequence of actions
// ---------------------------------------------------------------------------

describe("reduce — action sequences", () => {
  test("promote A, skip B, discard C → all three decisions recorded", () => {
    const items = [makeItem("a"), makeItem("b"), makeItem("c")];
    let state = initialState(items);
    state = reduce(state, { type: "promote", teaching: "high" });
    state = reduce(state, { type: "skip" });
    state = reduce(state, { type: "discard" });
    expect(state.decisions["a"]).toBe("promote");
    expect(state.decisions["b"]).toBe("skip");
    expect(state.decisions["c"]).toBe("discard");
    expect(state.teachingValues["a"]).toBe("high");
  });

  test("next → next → prev → index = 1", () => {
    let state = initialState(THREE_ITEMS);
    state = reduce(state, { type: "next" }); // 1
    state = reduce(state, { type: "next" }); // 2
    state = reduce(state, { type: "prev" }); // 1
    expect(state.index).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

describe("summarize", () => {
  test("all zeros for initial state with no decisions", () => {
    const state = initialState(THREE_ITEMS);
    const summary = summarize(state);
    expect(summary.totalItems).toBe(3);
    expect(summary.promoted).toBe(0);
    expect(summary.discarded).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.untouched).toBe(3);
    expect(summary.teachingHigh).toBe(0);
    expect(summary.teachingMedium).toBe(0);
    expect(summary.teachingLow).toBe(0);
  });

  test("counts promoted, discarded, skipped correctly", () => {
    const items = [makeItem("a"), makeItem("b"), makeItem("c"), makeItem("d")];
    let state = initialState(items);
    state = reduce(state, { type: "promote", teaching: "high" }); // a: promoted
    state = reduce(state, { type: "discard" });                   // b: discarded
    state = reduce(state, { type: "skip" });                      // c: skipped
    // d: untouched
    const summary = summarize(state);
    expect(summary.promoted).toBe(1);
    expect(summary.discarded).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.untouched).toBe(1);
    expect(summary.totalItems).toBe(4);
  });

  test("counts teachingHigh, teachingMedium, teachingLow correctly", () => {
    const items = [makeItem("x"), makeItem("y"), makeItem("z")];
    let state = initialState(items);
    state = reduce(state, { type: "promote", teaching: "high" });
    state = reduce(state, { type: "promote", teaching: "medium" });
    state = reduce(state, { type: "promote", teaching: "low" });
    const summary = summarize(state);
    expect(summary.teachingHigh).toBe(1);
    expect(summary.teachingMedium).toBe(1);
    expect(summary.teachingLow).toBe(1);
    expect(summary.promoted).toBe(3);
    expect(summary.untouched).toBe(0);
  });

  test("untouched = totalItems - promoted - discarded - skipped", () => {
    const items = [makeItem("p"), makeItem("q"), makeItem("r"), makeItem("s"), makeItem("t")];
    let state = initialState(items);
    state = reduce(state, { type: "promote", teaching: "high" }); // p
    state = reduce(state, { type: "skip" });                      // q
    // r, s, t: untouched
    const summary = summarize(state);
    expect(summary.untouched).toBe(3);
  });

  test("empty items → all counts are zero", () => {
    const state = initialState([]);
    const summary = summarize(state);
    expect(summary.totalItems).toBe(0);
    expect(summary.promoted).toBe(0);
    expect(summary.discarded).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.untouched).toBe(0);
  });
});
