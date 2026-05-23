/*
 * virtual-window.ts — pure window-slice helper for the raw transcript route.
 *
 * Spec R-67 + INV-17 + ADR-SC-D1 (slice 12 P5):
 *   The transcript route MUST mount ≤ 80 row DOM nodes at once, regardless of
 *   total event count. Approach is "manual window slice driven by scrollTop":
 *   the consumer measures the scroll container, asks this helper for the
 *   { startIndex, endIndex, offsetTop } slice, and renders only that slice
 *   inside an absolutely positioned inner container with a translate(0, offsetTop).
 *
 *   We deliberately AVOID:
 *     - `svelte-virtual` or `tanstack-virtual` deps (bundle budget, ADR-SC-D1).
 *     - IntersectionObserver per row (mounts every row to attach the observer —
 *       defeats the budget).
 *     - Variable-height rows. Fixed `rowHeight` is assumed; the transcript view
 *       enforces it via CSS (`.transcript-row { height: 56px }`).
 *
 *   `overscan` defaults to 5 (rows above + below viewport) which is enough to
 *   absorb smooth scrolls without visible mounting gaps at 60fps.
 *   `maxMounted` defaults to 80 per INV-17 / R-67.
 *
 *   The function is PURE — no DOM access, no Svelte runes. Caller wires it up
 *   to a scroll listener and a derived store.
 */

export interface VirtualWindowArgs {
  /** Total number of items in the list. May be 0. */
  totalCount: number;
  /** Pixel scroll offset of the scroll container (`scrollTop`). */
  scrollTop: number;
  /** Pixel height of the visible viewport (`clientHeight`). */
  viewportHeight: number;
  /** Pixel height of a single row. MUST be > 0. */
  rowHeight: number;
  /** Rows mounted above and below the viewport. Defaults to 5. */
  overscan?: number;
  /** Hard cap on simultaneously mounted rows. Defaults to 80 (INV-17). */
  maxMounted?: number;
}

export interface VirtualWindow {
  /** Inclusive start index of the rendered slice. */
  startIndex: number;
  /**
   * Exclusive end index (i.e. slice(startIndex, endIndex)). `endIndex - startIndex`
   * is guaranteed to be ≤ `maxMounted` and ≤ `totalCount`.
   */
  endIndex: number;
  /**
   * Translate-Y offset (px) for the inner positioned container so the rendered
   * slice lines up with its conceptual position in the virtual list.
   * Always `startIndex * rowHeight`.
   */
  offsetTop: number;
}

/**
 * Compute the slice of items to render given the current scroll state.
 *
 * Behaviour:
 *   - `totalCount === 0` → `{ startIndex: 0, endIndex: 0, offsetTop: 0 }`.
 *   - When `totalCount <= maxMounted`, EVERYTHING is mounted; we still respect
 *     scroll position via `offsetTop = 0`.
 *   - Otherwise the window is centered on the viewport with `overscan` on each
 *     side, then CLAMPED to [0, totalCount] and re-clamped so the mounted
 *     count stays ≤ `maxMounted`.
 *   - Scrolling to the bottom snaps the window so the LAST visible row is the
 *     last item — no blank tail.
 */
export function computeWindow(args: VirtualWindowArgs): VirtualWindow {
  const {
    totalCount,
    scrollTop,
    viewportHeight,
    rowHeight,
    overscan = 5,
    maxMounted = 80,
  } = args;

  if (totalCount <= 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: 0, offsetTop: 0 };
  }

  // Short list — render everything. Cheaper to skip the math, and the cap is
  // satisfied trivially since totalCount <= maxMounted.
  if (totalCount <= maxMounted) {
    return { startIndex: 0, endIndex: totalCount, offsetTop: 0 };
  }

  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight));

  // Naive window: overscan-padded around the visible slice.
  let start = Math.max(0, firstVisible - overscan);
  let end = Math.min(totalCount, firstVisible + visibleCount + overscan);

  // Enforce the maxMounted ceiling. If the naive window is too wide (would
  // happen on huge overscan or huge viewports), shrink it around the centre.
  if (end - start > maxMounted) {
    const centre = Math.floor((start + end) / 2);
    start = Math.max(0, centre - Math.floor(maxMounted / 2));
    end = Math.min(totalCount, start + maxMounted);
    // Re-anchor `start` if we hit the right edge while shrinking.
    start = Math.max(0, end - maxMounted);
  }

  // Bottom snap: if we are near the end, make sure the LAST item is included.
  if (end >= totalCount) {
    end = totalCount;
    start = Math.max(0, end - Math.min(maxMounted, totalCount));
  }

  return {
    startIndex: start,
    endIndex: end,
    offsetTop: start * rowHeight,
  };
}
