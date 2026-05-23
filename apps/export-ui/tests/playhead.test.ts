/*
 * playhead.test.ts — slice 12 P6 / Bucket F unit tests.
 *
 * Covers R-70 (store shape + actions), R-74 (scroll-conflict mode handling),
 * R-75 (heartbeat-target consistency through t/playing), INV-16 (programmatic
 * vs user scroll distinction via suppressUserScrollUntil).
 *
 * RAF is not used in these tests: we drive `playhead.tick(dt)` directly. The
 * production RAF loop is a thin wrapper around tick() (see playhead.ts:frame).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { playhead, SUPPRESS_WINDOW_MS } from "../src/lib/stores/playhead";

beforeEach(() => {
  playhead._reset();
  // Deterministic clock — every test that touches suppressUserScrollUntil
  // re-pins `now`.
  let t = 1_000_000;
  playhead._setNow(() => t);
  // expose a setter on the closure for tests that want to advance time
  (globalThis as Record<string, unknown>)["__advanceNow"] = (delta: number) => {
    t += delta;
  };
});

describe("playhead store", () => {
  it("play() sets playing=true and mode='play'", () => {
    playhead.play();
    const s = playhead.get();
    expect(s.playing).toBe(true);
    expect(s.mode).toBe("play");
  });

  it("pause('user') reverts mode to 'scroll'", () => {
    playhead.play();
    playhead.pause("user");
    const s = playhead.get();
    expect(s.playing).toBe(false);
    expect(s.mode).toBe("scroll");
  });

  it("pause('programmatic') keeps mode='play'", () => {
    playhead.play();
    playhead.pause("programmatic");
    const s = playhead.get();
    expect(s.playing).toBe(false);
    expect(s.mode).toBe("play");
  });

  it("seek clamps to [0,1] and pauses", () => {
    playhead.play();
    playhead.seek(2);
    expect(playhead.get().t).toBe(1);
    playhead.seek(-1);
    expect(playhead.get().t).toBe(0);
    expect(playhead.get().playing).toBe(false);
  });

  it("setSpeed updates without stopping playback", () => {
    playhead.play();
    playhead.setSpeed(2);
    const s = playhead.get();
    expect(s.playing).toBe(true);
    expect(s.speed).toBe(2);
  });

  it("tick advances t proportional to (dt / duration) * speed", () => {
    playhead.setDuration(10_000); // 10s chapter
    playhead.play();
    playhead.tick(1_000); // 1s of 10s at speed 1 → 0.1
    expect(playhead.get().t).toBeCloseTo(0.1, 5);
    playhead.setSpeed(2);
    playhead.tick(1_000); // 1s at speed 2 → +0.2 → 0.3
    expect(playhead.get().t).toBeCloseTo(0.3, 5);
  });

  it("tick at t reaching 1 emits 'ended' and pauses", () => {
    playhead.setDuration(1_000);
    let endedCount = 0;
    playhead.onEnded(() => {
      endedCount++;
    });
    playhead.play();
    playhead.tick(2_000); // overruns, clamps to 1
    const s = playhead.get();
    expect(s.t).toBe(1);
    expect(s.playing).toBe(false);
    expect(endedCount).toBe(1);
  });

  it("speed change mid-play preserves t", () => {
    playhead.setDuration(10_000);
    playhead.play();
    playhead.tick(500);
    const tBefore = playhead.get().t;
    playhead.setSpeed(4);
    const tAfter = playhead.get().t;
    expect(tAfter).toBeCloseTo(tBefore, 6);
  });

  it("markProgrammaticScroll sets suppressUserScrollUntil to now+350ms", () => {
    let clock = 5_000_000;
    playhead._setNow(() => clock);
    playhead.markProgrammaticScroll();
    expect(playhead.get().suppressUserScrollUntil).toBe(
      5_000_000 + SUPPRESS_WINDOW_MS,
    );
  });

  it("isSuppressingScroll() is true inside the window and false after", () => {
    let clock = 100_000;
    playhead._setNow(() => clock);
    playhead.markProgrammaticScroll();
    expect(playhead.isSuppressingScroll()).toBe(true);
    clock += SUPPRESS_WINDOW_MS - 1;
    expect(playhead.isSuppressingScroll()).toBe(true);
    clock += 2; // cross the boundary
    expect(playhead.isSuppressingScroll()).toBe(false);
  });

  it("markProgrammaticScroll only EXTENDS the window (never shortens it)", () => {
    // First mark establishes window. Second mark with an earlier clock must
    // NOT pull the window backwards (could be racy if two scroll triggers
    // fire in quick succession with overlapping windows).
    let clock = 2_000_000;
    playhead._setNow(() => clock);
    playhead.markProgrammaticScroll();
    const first = playhead.get().suppressUserScrollUntil;
    clock -= 100; // rewind clock (should never happen, but check defensively)
    playhead.markProgrammaticScroll();
    const second = playhead.get().suppressUserScrollUntil;
    expect(second).toBe(first);
  });

  it("play() from t=1 rewinds to 0 (treated as fresh play intent)", () => {
    playhead.seek(1);
    expect(playhead.get().t).toBe(1);
    playhead.play();
    expect(playhead.get().t).toBe(0);
    expect(playhead.get().playing).toBe(true);
  });

  it("subscribers fire immediately with current snapshot and on every change", () => {
    const seen: number[] = [];
    const unsub = playhead.subscribe((s) => seen.push(s.t));
    expect(seen.length).toBe(1);
    expect(seen[0]).toBe(0);

    playhead.setDuration(1_000);
    playhead.play();
    playhead.tick(100);
    playhead.tick(100);
    playhead.pause("user");
    unsub();
    expect(seen.length).toBeGreaterThan(3); // initial + play + 2 ticks + pause
  });

  it("multiple play() calls are idempotent (no double-fire of mode)", () => {
    const seen: string[] = [];
    playhead.subscribe((s) =>
      seen.push(`${s.playing ? "p" : "P"}-${s.mode[0]}`),
    );
    playhead.play();
    const len1 = seen.length;
    playhead.play();
    expect(seen.length).toBe(len1); // no-op second call
  });

  it("pause('user') is idempotent when already paused in scroll mode", () => {
    let count = 0;
    playhead.subscribe(() => {
      count++;
    });
    const before = count;
    // initial state is paused in scroll-mode; pause('user') should be a no-op
    playhead.pause("user");
    expect(count).toBe(before);
  });
});
