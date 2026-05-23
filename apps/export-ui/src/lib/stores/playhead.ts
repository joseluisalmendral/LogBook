/*
 * playhead.ts — slice 12 P6 / Bucket F.
 *
 * Time-mode playback for the chapter route. Owns a single `requestAnimationFrame`
 * loop that advances `t` in [0, 1] proportional to elapsed wall time and the
 * current speed. Subscribers (the chapter player + UI controls) react to t /
 * playing / speed changes; the chapter player additionally turns t into an
 * "active event" and scrolls that event into view programmatically.
 *
 * Spec (R-70..R-75) + design ADR-SC-F1/F2/F3 + INV-15/INV-16:
 *
 *   state = {
 *     playing : boolean       — RAF loop active?
 *     speed   : 0.5 | 1 | 2 | 4 — discrete speed (no continuous slider)
 *     t       : number        — 0..1 progress through the active chapter window
 *     mode    : 'scroll' | 'play' — scroll = scrub.ts drives, play = this drives
 *     suppressUserScrollUntil : number  — ms epoch. While now() < this, scroll
 *                                          events are programmatic (ignore for
 *                                          pause-on-user-scroll detection).
 *   }
 *
 * RAF loop:
 *   - Owned exclusively here. No component should spin its own RAF for playback.
 *   - The loop reads a "chapter duration" via setDuration(ms). If duration is
 *     unset or zero, tick() advances at a fallback rate so seek/setSpeed remain
 *     responsive in tests.
 *   - When t reaches 1, the loop pauses with reason='end' and emits an 'ended'
 *     event (subscribers can react via on('ended', fn)).
 *
 * Programmatic scroll suppression window (ADR-SC-F2):
 *   - Before triggering scrollIntoView from the player effect, set
 *     `suppressUserScrollUntil = now() + 350`.
 *   - The TimelineScrubber scroll handler reads `playhead.get().suppressUserScrollUntil`
 *     and ignores any scroll firing inside that window — that's the programmatic
 *     scroll. Anything outside the window is a user scroll → call
 *     `playhead.pause('user')` per INV-16.
 *   - 350ms is the design-locked value (empirically sufficient for smooth scroll
 *     at 60fps on long chapters). If a future browser drags the smooth tween past
 *     350ms, bump the window.
 *
 * Test injection:
 *   - The RAF scheduler is injectable via `_setScheduler(fn)`. Pure unit tests
 *     pass a synchronous fake; production code uses requestAnimationFrame.
 *   - performance.now() is also wrappable via `_setNow(fn)` so tests can drive
 *     the clock deterministically.
 *
 * Reduced-motion contract (R-75 / INV-15 Moment 3):
 *   - This store does NOT consult motion state directly. The heartbeat (M3) is
 *     CSS-only on `.is-active` — reduced-motion fallback is a static ring.
 *   - The chapter player decides scroll behavior ('smooth' vs 'auto') based on
 *     `data-motion` on <html> when calling scrollIntoView.
 */

export type Speed = 0.5 | 1 | 2 | 4;
export type Mode = "scroll" | "play";
export type PauseReason = "user" | "programmatic" | "end";

export interface PlayheadState {
  playing: boolean;
  speed: Speed;
  t: number;
  mode: Mode;
  suppressUserScrollUntil: number;
}

type Listener = (snap: PlayheadState) => void;
type EndedListener = () => void;

/** Default fallback duration used until setDuration(ms) is called by the player. */
const FALLBACK_DURATION_MS = 30_000;
/** Programmatic scroll suppression window, locked by ADR-SC-F2. */
export const SUPPRESS_WINDOW_MS = 350;

let state: PlayheadState = {
  playing: false,
  speed: 1,
  t: 0,
  mode: "scroll",
  suppressUserScrollUntil: 0,
};

const listeners = new Set<Listener>();
const endedListeners = new Set<EndedListener>();

// Active chapter duration (ms). Player sets this from event-timestamp span.
let durationMs: number = FALLBACK_DURATION_MS;

// Last RAF timestamp (in ms epoch via performance.now()). Used by the
// internal scheduler path to compute frame deltas.
let lastFrame: number | null = null;
let rafHandle: number | null = null;

// Injectable scheduler/now for tests. Defaults to RAF + performance.now in the
// browser; in node tests we typically replace both.
type RafLike = (cb: (ts: number) => void) => number;
type CancelLike = (handle: number) => void;
type NowLike = () => number;

let scheduler: RafLike = (cb) => {
  if (typeof window === "undefined") {
    // Node/SSR fallback — never tick. Tests should inject a fake scheduler.
    return 0;
  }
  return window.requestAnimationFrame(cb);
};

let canceler: CancelLike = (h) => {
  if (typeof window === "undefined") return;
  if (h) window.cancelAnimationFrame(h);
};

let nowMs: NowLike = () => {
  if (typeof performance !== "undefined") return performance.now();
  return Date.now();
};

function notify(): void {
  for (const fn of listeners) fn(state);
}

function clampT(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function frame(ts: number): void {
  if (!state.playing) {
    lastFrame = null;
    rafHandle = null;
    return;
  }
  if (lastFrame === null) {
    lastFrame = ts;
    rafHandle = scheduler(frame);
    return;
  }
  const dt = ts - lastFrame;
  lastFrame = ts;
  tick(dt);
  if (state.playing) {
    rafHandle = scheduler(frame);
  } else {
    rafHandle = null;
    lastFrame = null;
  }
}

function startLoop(): void {
  if (rafHandle !== null) return;
  lastFrame = null;
  rafHandle = scheduler(frame);
}

function stopLoop(): void {
  if (rafHandle !== null) {
    canceler(rafHandle);
    rafHandle = null;
  }
  lastFrame = null;
}

/**
 * Advance t by dt (ms of wall time). Called by the RAF frame OR directly by
 * tests. Reaching t === 1 pauses with reason='end' and fires `ended`.
 */
function tick(dtMs: number): void {
  if (!state.playing) return;
  const dur = durationMs > 0 ? durationMs : FALLBACK_DURATION_MS;
  const nextT = clampT(state.t + (dtMs / dur) * state.speed);
  if (nextT === state.t) return;
  state = { ...state, t: nextT };
  if (nextT >= 1) {
    state = { ...state, playing: false };
    stopLoop();
    notify();
    for (const fn of endedListeners) fn();
    return;
  }
  notify();
}

export const playhead = {
  /** Current snapshot. */
  get(): PlayheadState {
    return state;
  },

  /**
   * Start playback. Sets mode='play' so the scrub store knows to yield.
   * Idempotent: calling while playing has no effect.
   */
  play(): void {
    if (state.playing) return;
    // If we're already at the end, rewind to 0 so play() is a true "from
    // scratch" intent.
    const nextT = state.t >= 1 ? 0 : state.t;
    state = { ...state, playing: true, mode: "play", t: nextT };
    notify();
    startLoop();
  },

  /**
   * Pause the loop.
   *
   * `reason='user'`         — caused by a real user scroll (INV-16) OR a click
   *                           on the pause button. Reverts mode to 'scroll' so
   *                           the scrub store reclaims --scroll-progress.
   * `reason='programmatic'` — caused by the system (e.g. route swap). Keeps
   *                           mode='play' so resuming is implicit (we don't
   *                           flip back to scroll-mode prematurely).
   * `reason='end'`          — internal: t reached 1.
   */
  pause(reason: PauseReason = "user"): void {
    const nextMode: Mode = reason === "programmatic" ? state.mode : "scroll";
    if (!state.playing && state.mode === nextMode) return;
    state = { ...state, playing: false, mode: nextMode };
    stopLoop();
    notify();
  },

  /**
   * Seek to t in [0, 1]. Pauses if currently playing — explicit re-play is
   * required so the user controls when the loop resumes.
   */
  seek(t: number): void {
    const next = clampT(t);
    const wasPlaying = state.playing;
    state = { ...state, t: next, playing: false };
    if (wasPlaying) {
      // User-initiated pause via seek — drop back to scroll mode for parity
      // with the scrubber's "scrub paused" UX.
      state = { ...state, mode: "scroll" };
      stopLoop();
    }
    notify();
  },

  /**
   * Change speed without interrupting playback. If playing, the next frame
   * will advance with the new speed multiplier — t is preserved.
   */
  setSpeed(speed: Speed): void {
    if (state.speed === speed) return;
    state = { ...state, speed };
    notify();
  },

  /**
   * Public tick — exposed for tests AND for any future deterministic stepper.
   * NOT called by user-facing code in production (RAF drives via frame()).
   */
  tick(dtMs: number): void {
    tick(dtMs);
  },

  /**
   * Inform the loop how long the current chapter is in ms. Player computes
   * this from (lastEventTs - firstEventTs); UI debounces calls to avoid
   * thrashing when the chapter mounts.
   */
  setDuration(ms: number): void {
    durationMs = ms > 0 ? ms : FALLBACK_DURATION_MS;
  },

  /**
   * Mark a programmatic scroll about to happen. The caller MUST set this
   * BEFORE invoking scrollIntoView — the scrub listener checks `now() <
   * suppressUserScrollUntil` to distinguish our scroll from a user's.
   */
  markProgrammaticScroll(): void {
    const until = nowMs() + SUPPRESS_WINDOW_MS;
    if (until <= state.suppressUserScrollUntil) return;
    state = { ...state, suppressUserScrollUntil: until };
    notify();
  },

  /**
   * Returns true while a programmatic scroll suppression window is active.
   * The scrub store + scroll listeners use this to ignore self-induced
   * scroll events.
   */
  isSuppressingScroll(): boolean {
    return nowMs() < state.suppressUserScrollUntil;
  },

  /**
   * Subscribe to state changes. Fires immediately with the current snapshot
   * (Svelte-store contract).
   */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(state);
    return () => {
      listeners.delete(fn);
    };
  },

  /** Subscribe to the 'ended' edge. Returns unsubscribe. */
  onEnded(fn: EndedListener): () => void {
    endedListeners.add(fn);
    return () => {
      endedListeners.delete(fn);
    };
  },

  /** Reset to defaults — used by tests AND on route swap away from chapter. */
  _reset(): void {
    stopLoop();
    state = {
      playing: false,
      speed: 1,
      t: 0,
      mode: "scroll",
      suppressUserScrollUntil: 0,
    };
    durationMs = FALLBACK_DURATION_MS;
    notify();
  },

  /** Inject a synchronous RAF scheduler (for tests). */
  _setScheduler(s: RafLike, c: CancelLike): void {
    scheduler = s;
    canceler = c;
  },

  /** Inject a custom now() (for tests). */
  _setNow(fn: NowLike): void {
    nowMs = fn;
  },
};
