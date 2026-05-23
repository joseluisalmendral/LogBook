/*
 * theme store — light | dark, persisted to localStorage["lb.theme"].
 *
 * The INITIAL value is whatever the boot script in index.html already wrote
 * onto <html data-theme="…"> — that script runs BEFORE this module loads and
 * is the only way to avoid the dark-mode FOUC (design §9 D2). We READ the
 * attribute here rather than re-running the resolution to keep one source of
 * truth.
 *
 * Why not Svelte runes at module top-level? Same reason as motion.ts —
 * `$state` requires a .svelte / .svelte.ts file or component scope. We export
 * the bare store as a tiny custom shape: a getter, a setter, and a subscribe
 * primitive (Svelte-store-compatible). Components can wrap with `$state(get())`
 * + subscribe in `$effect`, OR consume the snapshot directly.
 *
 * R-19: BOTH light + dark are first-class CSS-variable themes selected by
 * [data-theme] on <html>. R-3 / S-18: persistence to localStorage; S-3 toggle.
 */

export type Theme = "light" | "dark";

const STORAGE_KEY = "lb.theme";

type Listener = (theme: Theme) => void;

function readInitial(): Theme {
  // Honor the boot script's resolution — same source of truth, no chance of
  // drift between boot and store. If neither <html> nor localStorage have it,
  // default to "light" per design §1.2.
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") return attr;
  }
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  }
  return "light";
}

let current: Theme = readInitial();
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(current);
}

function applyToDom(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

function persist(theme: Theme): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  } catch {
    // localStorage may throw in private-mode Safari or when quota is full.
    // Swallow — theme works for the session, just doesn't persist.
  }
}

export const theme = {
  /** Snapshot read — current theme without subscribing. */
  get(): Theme {
    return current;
  },

  /** Replace theme; updates DOM, persists, notifies subscribers. */
  set(next: Theme): void {
    if (next !== "light" && next !== "dark") return;
    if (next === current) return;
    current = next;
    applyToDom(current);
    persist(current);
    notify();
  },

  /** Flip light↔dark — convenience for toggle buttons. */
  toggle(): void {
    this.set(current === "light" ? "dark" : "light");
  },

  /** Subscribe to changes; returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(current);
    return () => {
      listeners.delete(fn);
    };
  },
};
