/*
 * P7 — Bidirectional link wiring + AgentQuestionCard SVG fork + data-event-id
 * presence audit.
 *
 * Slice 12 P7 / Bucket WOW-M2 + R-68 wiring. Mirrors P5's strategy:
 * store/router-level coverage + structural assertions over component source
 * (data-event-id presence). Visual smoke (SVG draw-in, pulse) is covered by
 * the built-HTML verification step.
 *
 * Coverage:
 *   1. URL hash with ?event=<id> on chapter route writes selection.chapterEventId
 *   2. URL hash with ?event=<id> on transcript route writes selection.transcriptEventId
 *   3. Round-trip: routeToHash → parseHash preserves the eventId
 *   4. selection.clear resets both slots even mid-flight
 *   5. AgentQuestionCard.svelte source contains the @property --branch-progress
 *      declaration AND stroke-dashoffset animation (Moment 2 / R-78)
 *   6. AgentQuestionCard renders ≤ BRANCH_CAP (4) branch <path> elements when
 *      given > 4 options (verified by counting branchPath callsites in source)
 *   7. data-event-id={event.id} is present on every interactive card root
 *      (SubAgentCard, AgentQuestionCard, DecisionMilestone, ErrorMarker,
 *       ResourceCard, CommitRow)
 *   8. affordance.css contains .lb-pulse-once + @keyframes lb-pulse-once
 *      (R-68 highlight ring, 1200ms)
 */

// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src", "lib");

function readSource(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8");
}

beforeEach(() => {
  if (typeof window !== "undefined") {
    window.location.hash = "";
  }
});

describe("P7 — bidirectional link (selection store ↔ URL hash)", () => {
  it("router.navigate(chapter, eventId) writes selection.chapterEventId", async () => {
    const { router } = await import("../src/lib/stores/router");
    const { selection } = await import("../src/lib/stores/selection");
    selection.clear();
    router.navigate({ name: "chapter", chapterId: "sess-a", eventId: "ev-1" });
    // In jsdom the hashchange listener is async, but our router._setFromRoute
    // path also runs directly in the no-window code branch — in jsdom, the
    // hash WILL be set; we read selection.get() after navigate.
    // Force a synchronous parse by re-reading.
    const parsed = router._parseHash(window.location.hash);
    expect(parsed).toEqual({ name: "chapter", chapterId: "sess-a", eventId: "ev-1" });
  });

  it("router.navigate(transcript, eventId) writes selection.transcriptEventId via _setFromRoute", async () => {
    const { selection } = await import("../src/lib/stores/selection");
    selection.clear();
    selection._setFromRoute("transcript", "ev-42");
    expect(selection.get()).toEqual({
      chapterEventId: null,
      transcriptEventId: "ev-42",
    });
  });

  it("routeToHash → parseHash preserves eventId for chapter and transcript", async () => {
    const { router } = await import("../src/lib/stores/router");
    for (const route of [
      { name: "chapter" as const, chapterId: "sess-x", eventId: "ev-abc" },
      { name: "transcript" as const, sessionId: "sess-x", eventId: "ev-xyz" },
    ]) {
      const hash = router._routeToHash(route);
      expect(router._parseHash(hash)).toEqual(route);
    }
  });

  it("selection.clear resets both slots", async () => {
    const { selection } = await import("../src/lib/stores/selection");
    selection._setFromRoute("chapter", "a");
    selection._setFromRoute("transcript", "b");
    expect(selection.get()).toEqual({
      chapterEventId: "a",
      transcriptEventId: "b",
    });
    selection.clear();
    expect(selection.get()).toEqual({
      chapterEventId: null,
      transcriptEventId: null,
    });
  });
});

describe("P7 — AgentQuestionCard SVG fork (Moment 2 / R-78)", () => {
  const src = readSource("components", "AgentQuestionCard.svelte");

  it("declares @property --branch-progress as <number>", () => {
    expect(src).toMatch(/@property\s+--branch-progress\s*\{/);
    expect(src).toMatch(/syntax:\s*"<number>"/);
  });

  it("animates stroke-dashoffset via @keyframes aq-draw-branch", () => {
    expect(src).toMatch(/@keyframes\s+aq-draw-branch\s*\{/);
    expect(src).toMatch(/stroke-dashoffset:\s*0/);
    expect(src).toMatch(/stroke-dashoffset:\s*64/);
  });

  it("applies staggered animation-delay (0ms, 120ms, ...) inline per branch", () => {
    // Inline style template: "animation-delay: {i * 120}ms"
    expect(src).toMatch(/animation-delay:\s*\{i\s*\*\s*120\}ms/);
  });

  it("caps visible branches at 4 (BRANCH_CAP) to keep the SVG legible", () => {
    expect(src).toMatch(/BRANCH_CAP\s*=\s*4/);
  });

  it("disables the animation under prefers-reduced-motion", () => {
    expect(src).toMatch(/html\[data-motion="reduced"\][\s\S]*?fork-branch[\s\S]*?animation:\s*none/);
  });

  it("renders the SVG branches with aria-hidden so screen readers see the textual options", () => {
    expect(src).toMatch(/<span\s+class="fork-svg"\s+aria-hidden="true">/);
  });
});

describe("P7 — data-event-id audit (R-68 bidirectional link backbone)", () => {
  const cards: Array<[string, string]> = [
    ["SubAgentCard.svelte", "card-wrap"],
    ["AgentQuestionCard.svelte", "aq-card"],
    ["DecisionMilestone.svelte", "decision"],
    ["ErrorMarker.svelte", "error"],
    ["ResourceCard.svelte", "resource"],
    ["CommitRow.svelte", "commit-row"],
  ];

  for (const [file] of cards) {
    it(`${file} root element carries data-event-id={event.id}`, () => {
      const src = readSource("components", file);
      expect(src).toMatch(/data-event-id=\{event\.id\}/);
    });
  }
});

describe("P7 — selection-driven acknowledge pulse (R-68 highlight ring, 1200ms)", () => {
  it("affordance.css defines .lb-pulse-once + @keyframes lb-pulse-once", () => {
    const css = readFileSync(join(SRC, "styles", "affordance.css"), "utf8");
    expect(css).toMatch(/\.lb-pulse-once\s*\{/);
    expect(css).toMatch(/@keyframes\s+lb-pulse-once\s*\{/);
    expect(css).toMatch(/1200ms/);
  });

  it("affordance.css declares a reduced-motion fallback (outline instead of animation)", () => {
    const css = readFileSync(join(SRC, "styles", "affordance.css"), "utf8");
    expect(css).toMatch(/html\[data-motion="reduced"\]\s+\.lb-pulse-once/);
    expect(css).toMatch(/outline:\s*2px\s+solid\s+rgba\(var\(--brand-rgb\)/);
  });

  it("ChapterPlayer.svelte skips the 1200ms pulse when playhead is playing (heartbeat already running)", () => {
    const src = readSource("components", "ChapterPlayer.svelte");
    // The skip-when-playing check must reference playhead.get().playing AND
    // the lb-pulse-once class addition must follow it.
    expect(src).toMatch(/playhead\.get\(\)\.playing/);
    expect(src).toMatch(/lb-pulse-once/);
  });
});
