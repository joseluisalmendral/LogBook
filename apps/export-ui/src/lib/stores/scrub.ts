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
