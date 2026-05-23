/*
 * Motion store — single source of truth for "is motion allowed right now?".
 *
 * Design §2 row 1 + ADR-4: <MotionRoot> owns the gate; this store exposes
 * the resolved state to the rest of the tree. All 11 motion moments read
 * `motionAllowed` and short-circuit their JS path when it's false.
 *
 * Resolution combines TWO signals (design §4 + R-27 + Q4):
 *   1. window.matchMedia("(prefers-reduced-motion: reduce)") — OS preference
 *   2. viewport width ≤ 767px — mobile graceful-degrade per Q4
 *
 * Either trigger forces motionAllowed = false. The store is reactive: the
 * matchMedia listener AND a window resize listener update it live so a
 * mid-session OS toggle or device rotation propagates without reload (R-39).
 *
 * Svelte 5 runes can't live at the module top-level (they require a .svelte
 * file or .svelte.ts file). We use a plain mutable state object + a Set of
 * subscribers — the same shape Svelte stores have, so consumers can either
 * subscribe directly or wrap with a $state in their component.
 *
 * The actual matchMedia / resize subscription is initialized by <MotionRoot>
 * at app boot via initMotionStore(). This keeps the store SSR-safe (no
 * window access at import time) and concentrates the listener lifecycle in
 * one component.
 */

const MOBILE_BREAKPOINT_PX = 767;

export interface MotionState {
  motionAllowed: boolean;
  isMobile: boolean;
  prefersReducedMotion: boolean;
}

type Listener = (state: MotionState) => void;

const state: MotionState = {
  motionAllowed: true,
  isMobile: false,
  prefersReducedMotion: false,
};

const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(state);
}

/** Subscribe to motion-state changes. Returns an unsubscribe function. */
export function subscribeMotion(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

/** Read the current snapshot without subscribing (e.g. for one-shot checks). */
export function getMotionState(): MotionState {
  return { ...state };
}

/**
 * Initialize the matchMedia + resize listeners. Idempotent — calling twice
 * does nothing. Called once by <MotionRoot> on mount.
 *
 * Returns a cleanup function that removes both listeners (used by tests).
 */
export function initMotionStore(): () => void {
  if (typeof window === "undefined") return () => {};

  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");

  const recompute = (): void => {
    const isMobile = window.innerWidth <= MOBILE_BREAKPOINT_PX;
    const prefersReducedMotion = mql.matches;
    const next: MotionState = {
      prefersReducedMotion,
      isMobile,
      // Mobile is treated as reduced-motion by default (Q4 graceful-degrade).
      motionAllowed: !prefersReducedMotion && !isMobile,
    };

    if (
      next.motionAllowed !== state.motionAllowed ||
      next.isMobile !== state.isMobile ||
      next.prefersReducedMotion !== state.prefersReducedMotion
    ) {
      state.motionAllowed = next.motionAllowed;
      state.isMobile = next.isMobile;
      state.prefersReducedMotion = next.prefersReducedMotion;
      applyAttributes();
      notify();
    }
  };

  /**
   * Mirror state onto <html> as data-motion + data-viewport so CSS can branch
   * without consulting JS. app.css uses data-motion="reduced" to kill motion
   * across every animated rule.
   */
  const applyAttributes = (): void => {
    const html = document.documentElement;
    html.setAttribute("data-motion", state.motionAllowed ? "allowed" : "reduced");
    html.setAttribute("data-viewport", state.isMobile ? "mobile" : "desktop");
  };

  // matchMedia change events fire when the OS preference toggles mid-session.
  // The newer addEventListener API is preferred (R-39); older Safari falls back
  // to addListener.
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", recompute);
  } else {
    // Safari < 14 fallback
    (mql as unknown as { addListener: (fn: () => void) => void }).addListener(recompute);
  }

  window.addEventListener("resize", recompute, { passive: true });

  // Seed initial state on mount.
  recompute();

  return (): void => {
    if (typeof mql.removeEventListener === "function") {
      mql.removeEventListener("change", recompute);
    } else {
      (mql as unknown as { removeListener: (fn: () => void) => void }).removeListener(recompute);
    }
    window.removeEventListener("resize", recompute);
  };
}
