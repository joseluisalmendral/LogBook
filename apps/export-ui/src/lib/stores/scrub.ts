/*
 * scrub store — chapter scroll progress 0..1.
 *
 * Spec motion #2: scroll-driven reveal of TurnRow events. The <TimelineScrubber>
 * computes the chapter's vertical scroll position throttled to rAF and writes
 * to this store. Children animate from --scrub-progress CSS variable bound on
 * the chapter root.
 *
 * In reduced-motion mode the scrubber stays static at progress=1 so every
 * row is fully visible without animation.
 *
 * Slice 12 P6 / ADR-SC-F2 — playhead yield:
 *   When the playhead store is in mode='play', the scrub store MUST NOT update
 *   --scroll-progress. Reason: the playhead is itself triggering programmatic
 *   scrolls (scrollIntoView), and letting scrub.ts re-emit progress from those
 *   would cause a double-driver flicker — the scrubber's progress bar would
 *   step forward, then snap back to wherever the user was looking before play
 *   started. The TimelineScrubber's recompute() already short-circuits when
 *   playMode === 'play'; this comment exists so future contributors don't
 *   "fix" that short-circuit thinking it's a bug.
 */

type Listener = (progress: number) => void;

let progress = 0;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(progress);
}

export const scrub = {
  get(): number {
    return progress;
  },
  set(p: number): void {
    const clamped = Math.max(0, Math.min(1, p));
    if (Math.abs(clamped - progress) < 0.001) return;
    progress = clamped;
    notify();
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(progress);
    return () => {
      listeners.delete(fn);
    };
  },
};
