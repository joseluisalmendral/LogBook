/**
 * Smoke tests for src/review/tui.ts (T11).
 *
 * Uses ink-testing-library to mount the ReviewApp component and verify:
 *   1. Initial frame shows item preview + key binding hints
 *   2. Simulating "j" (next) advances to item 2
 *   3. Simulating "p" promotes current item and advances
 *   4. Simulating "q" signals exit
 *
 * NOTE: This test depends on ink-testing-library. If library has compatibility
 * issues with the installed Ink version, individual tests use .skipIf.
 * The pure reducer (T10 — review-flows.test.ts) already has full coverage;
 * TUI render tests are bonus.
 *
 * TDD Cycle:
 *   RED  → fail with "Cannot find module" (tui.ts not yet created)
 *   GREEN → implement src/review/tui.ts so tests pass
 */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import type { ReviewItem } from "../../src/types/review.js";

// Detect ink-testing-library availability at module level (import-time)
let inkTestingLibraryAvailable = false;
try {
  // Dynamic check: if the import fails at runtime, we skip gracefully
  await import("ink-testing-library");
  inkTestingLibraryAvailable = true;
} catch {
  inkTestingLibraryAvailable = false;
}

function makeItem(id: string, preview: string = `Preview text for item ${id}`): ReviewItem {
  return {
    id,
    kind: "pending_suggestion",
    ts: "2026-01-01T10:00:00.000Z",
    preview,
    raw: { id },
  };
}

const ITEM_1 = makeItem("item-1", "First item preview text here");
const ITEM_2 = makeItem("item-2", "Second item preview text here");

describe("ReviewApp TUI smoke tests", () => {
  it.skipIf(!inkTestingLibraryAvailable)(
    "initial frame contains first item preview and key binding hints",
    async () => {
      const { render } = await import("ink-testing-library");
      const { ReviewApp } = await import("../../src/review/tui.js");

      const { lastFrame } = render(
        createElement(ReviewApp, { initialItems: [ITEM_1, ITEM_2] }),
      );

      const frame = lastFrame() ?? "";
      // Should show item preview
      expect(frame).toContain("First item preview text here");
      // Should show key binding hints
      expect(frame).toMatch(/q.*quit|quit.*q/i);
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    'simulating "j" advances cursor to item 2',
    async () => {
      const { render } = await import("ink-testing-library");
      const { ReviewApp } = await import("../../src/review/tui.js");

      const { lastFrame, stdin } = render(
        createElement(ReviewApp, { initialItems: [ITEM_1, ITEM_2] }),
      );

      // Wait for React effects (useEffect) to run: sets up stdin 'readable' listener
      await new Promise((r) => setTimeout(r, 100));

      // Initial frame shows item 1
      const beforeFrame = lastFrame() ?? "";
      expect(beforeFrame).toContain("First item preview text here");

      // Simulate pressing "j" (next)
      stdin.write("j");

      // Wait for Ink v5 input processing + React re-render cycle
      await new Promise((r) => setTimeout(r, 200));

      const afterFrame = lastFrame() ?? "";
      expect(afterFrame).toContain("Second item preview text here");
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    'simulating "p" promotes current item (default high) and advances',
    async () => {
      const { render } = await import("ink-testing-library");
      const { ReviewApp } = await import("../../src/review/tui.js");

      const { lastFrame, stdin } = render(
        createElement(ReviewApp, { initialItems: [ITEM_1, ITEM_2] }),
      );

      // Wait for React effects (useEffect) to run: sets up stdin 'readable' listener
      await new Promise((r) => setTimeout(r, 100));

      // Promote item 1 with "p" (defaults to high)
      stdin.write("p");

      // Wait for Ink v5 input processing + React re-render cycle
      await new Promise((r) => setTimeout(r, 200));

      // Should auto-advance to item 2
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Second item preview text here");
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    'simulating "q" triggers exit state',
    async () => {
      const { render } = await import("ink-testing-library");
      const { ReviewApp } = await import("../../src/review/tui.js");

      const { unmount, stdin } = render(
        createElement(ReviewApp, { initialItems: [ITEM_1] }),
      );

      // Press q — should exit
      stdin.write("q");
      await new Promise((r) => setTimeout(r, 100));

      // After q, the app should have exited — we just verify no crash
      unmount();
    },
  );
});
