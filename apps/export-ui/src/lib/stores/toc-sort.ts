/*
 * toc-sort store — 3-state sort for the course TOC.
 *
 * Spec R-18: default = "phase". S-4 / AG-19: cycle order is
 *   phase → chrono-asc → chrono-desc → phase
 * AND persists to localStorage as "lb.tocSort".
 *
 * The sort mode is PURE UI state per Q2 — never lives in the URL hash, never
 * tracked by the router. That keeps shareable URLs stable across user prefs.
 */

export type TocSort = "phase" | "chrono-asc" | "chrono-desc";

const STORAGE_KEY = "lb.tocSort";
const ORDER: readonly TocSort[] = ["phase", "chrono-asc", "chrono-desc"];

type Listener = (sort: TocSort) => void;

function readInitial(): TocSort {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "phase" || stored === "chrono-asc" || stored === "chrono-desc") {
      return stored;
    }
  }
  return "phase";
}

let current: TocSort = readInitial();
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(current);
}

function persist(sort: TocSort): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, sort);
    }
  } catch {
    // Swallow — same rationale as theme.ts.
  }
}

export const tocSort = {
  get(): TocSort {
    return current;
  },
  set(next: TocSort): void {
    if (!ORDER.includes(next)) return;
    if (next === current) return;
    current = next;
    persist(current);
    notify();
  },
  /** Advance to the next state in the documented cycle. */
  cycle(): void {
    const idx = ORDER.indexOf(current);
    const next = ORDER[(idx + 1) % ORDER.length];
    this.set(next);
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(current);
    return () => {
      listeners.delete(fn);
    };
  },
};
