/*
 * Feature detection — slice 12 P1 (R-76, ADR-SC-G1).
 *
 * Single-purpose helpers that probe browser capability via CSS.supports().
 * Designed to be called ONCE at module load by <ChapterPlayer> (or any
 * consumer); the resolved boolean is mirrored to <html> as a data-attribute
 * so CSS can branch via attribute selectors instead of querying JS.
 *
 * No JS polyfill. The graceful-degrade path for scroll-timeline is the
 * existing slice 10 rAF + --scrub-progress pipe (already tested).
 *
 * SSR safety: every helper checks for `typeof window` / `typeof CSS` before
 * touching the platform globals. Returns conservative `false` when unknown.
 */

/**
 * Returns true on Chromium 115+ where scroll-timeline animations work.
 * Safari + Firefox return false today (no scroll-timeline shipping yet),
 * which is the expected fallback path.
 *
 * The check uses the canonical `animation-timeline: scroll()` syntax that
 * the CSSWG specced. Firefox in particular requires the parameterless
 * `scroll()` to be recognized — vendor-prefixed forms are intentionally
 * not probed.
 */
export function supportsScrollTimeline(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return false;
  }
  try {
    return CSS.supports("animation-timeline: scroll()");
  } catch {
    return false;
  }
}

/**
 * Returns true when the browser supports the `@property` at-rule needed for
 * smooth animation of custom-property numeric values (used by KPI count-up
 * + AgentQuestionCard pulse). Chromium 85+, Safari 16.4+, Firefox 128+.
 */
export function supportsCSSProperty(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") {
    return false;
  }
  return true;
}

/**
 * Mirror feature-detect results to <html> as data-* attributes so CSS can
 * branch declaratively. Call once on app boot.
 *
 * Sets:
 *   data-scroll-timeline="native" | "fallback"
 *   data-css-property="native" | "fallback"
 */
export function applyFeatureDetectAttributes(): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.setAttribute(
    "data-scroll-timeline",
    supportsScrollTimeline() ? "native" : "fallback",
  );
  html.setAttribute(
    "data-css-property",
    supportsCSSProperty() ? "native" : "fallback",
  );
}
