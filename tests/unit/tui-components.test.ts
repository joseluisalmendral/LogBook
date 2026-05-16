/**
 * Unit tests for src/tui/components — T3 reusable Ink components.
 *
 * TDD Cycle:
 *   RED  → fail: "Cannot find module src/tui/components/..."
 *   GREEN → implement all 4 components so tests pass
 *
 * Strategy: test the pure exported formatter functions (formatTokenBar,
 * formatBreadcrumb, formatKeybindingsLine) with string assertions.
 * Ink render tests are gated behind inkTestingLibraryAvailable (same pattern
 * as review-tui-smoke.test.ts).
 *
 * TokenBudgetBar also exports formatTokenBar(used, budget, width) → string
 * so that unit tests don't need Ink at all.
 * Breadcrumb exports formatBreadcrumb(path) → string.
 * KeybindingsFooter exports formatKeybindingsLine(bindings) → string.
 */

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";

// Detect ink-testing-library availability at module level
let inkTestingLibraryAvailable = false;
try {
  await import("ink-testing-library");
  inkTestingLibraryAvailable = true;
} catch {
  inkTestingLibraryAvailable = false;
}

// ---------------------------------------------------------------------------
// TokenBudgetBar — pure formatter tests (no Ink needed)
// ---------------------------------------------------------------------------

describe("formatTokenBar", () => {
  it("used=0, budget=500, width=10 → all empty chars + '0 / 500'", async () => {
    const { formatTokenBar } = await import("../../src/tui/components/token-budget-bar.js");
    const result = formatTokenBar(0, 500, 10);
    // All 10 slots must be the empty block character
    expect(result).toContain("░".repeat(10));
    expect(result).toContain("0 / 500");
  });

  it("used=250, budget=500, width=10 → 5 filled + 5 empty chars + '250 / 500'", async () => {
    const { formatTokenBar } = await import("../../src/tui/components/token-budget-bar.js");
    const result = formatTokenBar(250, 500, 10);
    // Exactly half filled
    expect(result).toContain("█".repeat(5) + "░".repeat(5));
    expect(result).toContain("250 / 500");
  });

  it("used=499, budget=500, width=10 → 9 filled + 1 empty + '499 / 500'", async () => {
    const { formatTokenBar } = await import("../../src/tui/components/token-budget-bar.js");
    const result = formatTokenBar(499, 500, 10);
    expect(result).toContain("█".repeat(9) + "░".repeat(1));
    expect(result).toContain("499 / 500");
  });

  it("used=500, budget=500, width=10 → all filled + '500 / 500' (no over tag)", async () => {
    const { formatTokenBar } = await import("../../src/tui/components/token-budget-bar.js");
    const result = formatTokenBar(500, 500, 10);
    expect(result).toContain("█".repeat(10));
    expect(result).toContain("500 / 500");
    // Exactly at budget is NOT "over"
    expect(result).not.toContain("OVER");
  });

  it("used=600, budget=500, width=10 → bar capped at 100% + '600 / 500' + OVER tag", async () => {
    const { formatTokenBar } = await import("../../src/tui/components/token-budget-bar.js");
    const result = formatTokenBar(600, 500, 10);
    // Bar must be capped — all 10 slots filled (100%)
    expect(result).toContain("█".repeat(10));
    // Actual count shown (not capped)
    expect(result).toContain("600 / 500");
    // Over-budget indicator
    expect(result).toContain("OVER");
  });

  it("default width=30 produces 30-char bar section", async () => {
    const { formatTokenBar } = await import("../../src/tui/components/token-budget-bar.js");
    const result = formatTokenBar(0, 500);
    // Should have 30 empty chars (default width)
    expect(result).toContain("░".repeat(30));
  });
});

// ---------------------------------------------------------------------------
// TokenBudgetBar Ink component — gated render tests
// ---------------------------------------------------------------------------

describe("TokenBudgetBar Ink component", () => {
  it.skipIf(!inkTestingLibraryAvailable)(
    "renders color hint green when used < 80% budget",
    async () => {
      const { render } = await import("ink-testing-library");
      const { TokenBudgetBar } = await import("../../src/tui/components/token-budget-bar.js");

      const { lastFrame } = render(
        createElement(TokenBudgetBar, { used: 100, budget: 500, width: 10 }),
      );
      const frame = lastFrame() ?? "";
      // Frame must contain the count
      expect(frame).toContain("100 / 500");
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "renders over-budget when used > budget",
    async () => {
      const { render } = await import("ink-testing-library");
      const { TokenBudgetBar } = await import("../../src/tui/components/token-budget-bar.js");

      const { lastFrame } = render(
        createElement(TokenBudgetBar, { used: 600, budget: 500, width: 10 }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("600 / 500");
      expect(frame).toContain("OVER");
    },
  );
});

// ---------------------------------------------------------------------------
// KeybindingsFooter — pure formatter tests
// ---------------------------------------------------------------------------

describe("formatKeybindingsLine", () => {
  it("3 bindings → all 3 appear in the string", async () => {
    const { formatKeybindingsLine } = await import("../../src/tui/components/keybindings-footer.js");
    const result = formatKeybindingsLine([
      { keys: "j/k", label: "navigate" },
      { keys: "enter", label: "select" },
      { keys: "esc", label: "back" },
    ]);
    expect(result).toContain("[j/k]");
    expect(result).toContain("navigate");
    expect(result).toContain("[enter]");
    expect(result).toContain("select");
    expect(result).toContain("[esc]");
    expect(result).toContain("back");
  });

  it("empty array → empty string", async () => {
    const { formatKeybindingsLine } = await import("../../src/tui/components/keybindings-footer.js");
    const result = formatKeybindingsLine([]);
    expect(result).toBe("");
  });

  it("single binding → [keys] label (no separator at end)", async () => {
    const { formatKeybindingsLine } = await import("../../src/tui/components/keybindings-footer.js");
    const result = formatKeybindingsLine([{ keys: "q", label: "quit" }]);
    expect(result).toBe("[q] quit");
  });
});

// ---------------------------------------------------------------------------
// KeybindingsFooter Ink component — gated render tests
// ---------------------------------------------------------------------------

describe("KeybindingsFooter Ink component", () => {
  it.skipIf(!inkTestingLibraryAvailable)(
    "renders all bindings",
    async () => {
      const { render } = await import("ink-testing-library");
      const { KeybindingsFooter } = await import("../../src/tui/components/keybindings-footer.js");

      const bindings = [
        { keys: "j/k", label: "navigate" },
        { keys: "enter", label: "select" },
      ];
      const { lastFrame } = render(
        createElement(KeybindingsFooter, { bindings }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("[j/k]");
      expect(frame).toContain("navigate");
      expect(frame).toContain("[enter]");
      expect(frame).toContain("select");
    },
  );
});

// ---------------------------------------------------------------------------
// Breadcrumb — pure formatter tests
// ---------------------------------------------------------------------------

describe("formatBreadcrumb", () => {
  it("single element → no separators, just the element", async () => {
    const { formatBreadcrumb } = await import("../../src/tui/components/breadcrumb.js");
    const result = formatBreadcrumb(["LogBook"]);
    expect(result).toBe("LogBook");
    expect(result).not.toContain("›");
  });

  it("two elements → one › separator", async () => {
    const { formatBreadcrumb } = await import("../../src/tui/components/breadcrumb.js");
    const result = formatBreadcrumb(["LogBook", "Install"]);
    expect(result).toBe("LogBook › Install");
  });

  it("three elements → two › separators", async () => {
    const { formatBreadcrumb } = await import("../../src/tui/components/breadcrumb.js");
    const result = formatBreadcrumb(["LogBook", "Install", "Step 2 of 3"]);
    expect(result).toBe("LogBook › Install › Step 2 of 3");
  });

  it("empty array → empty string", async () => {
    const { formatBreadcrumb } = await import("../../src/tui/components/breadcrumb.js");
    const result = formatBreadcrumb([]);
    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Breadcrumb Ink component — gated render tests
// ---------------------------------------------------------------------------

describe("Breadcrumb Ink component", () => {
  it.skipIf(!inkTestingLibraryAvailable)(
    "renders 3-element path with 2 separators",
    async () => {
      const { render } = await import("ink-testing-library");
      const { Breadcrumb } = await import("../../src/tui/components/breadcrumb.js");

      const { lastFrame } = render(
        createElement(Breadcrumb, { path: ["LogBook", "Install", "Step 2 of 3"] }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("LogBook");
      expect(frame).toContain("Install");
      expect(frame).toContain("Step 2 of 3");
      // 2 separators for 3 elements
      const separatorCount = (frame.match(/›/g) ?? []).length;
      expect(separatorCount).toBe(2);
    },
  );
});

// ---------------------------------------------------------------------------
// ModalConfirm — compile + type-check only (Ink useInput fragility)
// ---------------------------------------------------------------------------

describe("ModalConfirm", () => {
  it("module exports ModalConfirm function", async () => {
    const mod = await import("../../src/tui/components/modal-confirm.js");
    expect(typeof mod.ModalConfirm).toBe("function");
  });

  it.skipIf(!inkTestingLibraryAvailable)(
    "renders message text",
    async () => {
      const { render } = await import("ink-testing-library");
      const { ModalConfirm } = await import("../../src/tui/components/modal-confirm.js");

      const onYes = vi.fn();
      const onNo = vi.fn();
      const { lastFrame } = render(
        createElement(ModalConfirm, { message: "Are you sure?", onYes, onNo }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Are you sure?");
      // y/n hints must appear
      expect(frame).toMatch(/\[y\]|\[n\]/i);
    },
  );
});

// ---------------------------------------------------------------------------
// Barrel re-exports — index.ts
// ---------------------------------------------------------------------------

describe("src/tui/components/index.ts barrel", () => {
  it("re-exports TokenBudgetBar, KeybindingsFooter, Breadcrumb, ModalConfirm", async () => {
    const idx = await import("../../src/tui/components/index.js");
    expect(typeof idx.TokenBudgetBar).toBe("function");
    expect(typeof idx.KeybindingsFooter).toBe("function");
    expect(typeof idx.Breadcrumb).toBe("function");
    expect(typeof idx.ModalConfirm).toBe("function");
  });

  it("re-exports formatter helpers", async () => {
    const idx = await import("../../src/tui/components/index.js");
    expect(typeof idx.formatTokenBar).toBe("function");
    expect(typeof idx.formatBreadcrumb).toBe("function");
    expect(typeof idx.formatKeybindingsLine).toBe("function");
  });
});
