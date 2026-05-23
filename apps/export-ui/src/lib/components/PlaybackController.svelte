<!--
  PlaybackController — slice 12 P6 / Bucket F (R-70..R-75).

  Compact toolbar that drives the playhead store. Mounts inside the chapter
  TimelineScrubber on desktop and inside MobileTimeline on mobile (a compact
  variant — see prop `compact`). Components:
    - Play / Pause toggle
    - Speed segmented control (0.5x / 1x / 2x / 4x) — ADR-SC-F3
    - Position readout: MM:SS / MM:SS (current play position / chapter total)

  Keyboard map (R-72, ADR-SC §accessibility):
    Space        — toggle play/pause
    ← / →        — step to prev / next event (uses provided `events` array
                   to compute the matching t and call playhead.seek)
    1 / 2 / 3 / 4 — set speed 0.5 / 1 / 2 / 4

  Keyboard handlers ignore typing inside <input>/<textarea> so the user can
  still type into a search box without triggering playback.

  ARIA:
    Root element is `role="group" aria-label="Playback controls"`.
    Play/pause is a single <button> with `aria-pressed`.
    Speed controls live in a `role="radiogroup"`; each speed is a
    `role="radio" aria-checked` button.

  Reduced-motion: nothing here animates — controls are functional. The motion
  budget for P6 is M3 heartbeat (handled in CSS on `.is-active`).
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { RenderEvent } from "../types";
  import { playhead, type Speed } from "../stores/playhead";

  interface Props {
    /** Events in the active chapter (drives prev/next step + duration). */
    events: RenderEvent[];
    /** Render in compact mode (mobile timeline). Hides the radio group; uses a single cycle button. */
    compact?: boolean;
  }

  const { events, compact = false }: Props = $props();

  let playing = $state(false);
  let speed = $state<Speed>(1);
  let t = $state(0);

  onMount(() => {
    const unsub = playhead.subscribe((s) => {
      playing = s.playing;
      speed = s.speed;
      t = s.t;
    });
    // Seed chapter duration from event timestamps.
    if (events.length >= 2) {
      const first = new Date(events[0]!.ts).getTime();
      const last = new Date(events[events.length - 1]!.ts).getTime();
      const span = last - first;
      if (Number.isFinite(span) && span > 0) playhead.setDuration(span);
    }
    return unsub;
  });

  function togglePlay(): void {
    if (playing) playhead.pause("user");
    else playhead.play();
  }

  /**
   * Step to prev/next event. Computes the target event's t-position (0..1) as
   * (event.ts - first.ts) / (last.ts - first.ts), then seeks. Selecting events
   * via t keeps the playhead loop consistent — seek() pauses, the user can hit
   * play to resume from there.
   */
  function step(direction: 1 | -1): void {
    if (events.length === 0) return;
    if (events.length === 1) {
      playhead.seek(0);
      return;
    }
    const first = new Date(events[0]!.ts).getTime();
    const last = new Date(events[events.length - 1]!.ts).getTime();
    const span = last - first;
    if (!Number.isFinite(span) || span <= 0) {
      // Fallback: step by index proportionally.
      const i = currentIndex();
      const next = Math.max(0, Math.min(events.length - 1, i + direction));
      playhead.seek(next / (events.length - 1));
      return;
    }
    const i = currentIndex();
    const next = Math.max(0, Math.min(events.length - 1, i + direction));
    const targetMs = new Date(events[next]!.ts).getTime() - first;
    playhead.seek(targetMs / span);
  }

  /**
   * Compute the index of the event whose ts is closest to the current playhead
   * time. Mirrors the player's "active event" logic so step() snaps the user
   * to whatever they're currently looking at, then advances by ±1.
   */
  function currentIndex(): number {
    if (events.length <= 1) return 0;
    const first = new Date(events[0]!.ts).getTime();
    const last = new Date(events[events.length - 1]!.ts).getTime();
    const span = last - first;
    if (!Number.isFinite(span) || span <= 0) {
      return Math.round(t * (events.length - 1));
    }
    const targetMs = first + t * span;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < events.length; i++) {
      const d = Math.abs(new Date(events[i]!.ts).getTime() - targetMs);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function setSpeed(s: Speed): void {
    playhead.setSpeed(s);
  }

  /** Cycle 0.5 → 1 → 2 → 4 → 0.5 (mobile compact). */
  function cycleSpeed(): void {
    const order: Speed[] = [0.5, 1, 2, 4];
    const i = order.indexOf(speed);
    const next = order[(i + 1) % order.length]!;
    playhead.setSpeed(next);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "1") {
      setSpeed(0.5);
    } else if (e.key === "2") {
      setSpeed(1);
    } else if (e.key === "3") {
      setSpeed(2);
    } else if (e.key === "4") {
      setSpeed(4);
    }
  }

  /** Format ms as MM:SS (no negatives, no hours — chapters are minutes-scale). */
  function fmt(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  const durationMs = $derived(() => {
    if (events.length < 2) return 0;
    const first = new Date(events[0]!.ts).getTime();
    const last = new Date(events[events.length - 1]!.ts).getTime();
    return Math.max(0, last - first);
  });

  const positionMs = $derived(() => durationMs() * t);

  const SPEEDS: Speed[] = [0.5, 1, 2, 4];
</script>

<svelte:window onkeydown={onKey} />

<div
  class="playback-controller"
  class:compact
  role="group"
  aria-label="Playback controls"
  data-testid="playback-controller"
>
  <button
    type="button"
    class="play-btn"
    onclick={togglePlay}
    aria-pressed={playing}
    aria-label={playing ? "Pause" : "Play"}
    title={playing ? "Pause (Space)" : "Play (Space)"}
  >
    <span aria-hidden="true">{playing ? "⏸" : "▶"}</span>
  </button>

  {#if compact}
    <button
      type="button"
      class="speed-cycle"
      onclick={cycleSpeed}
      aria-label={`Speed ${speed}x. Tap to cycle.`}
      title={`${speed}x — tap to cycle`}
    >
      {speed}x
    </button>
  {:else}
    <div class="speeds" role="radiogroup" aria-label="Playback speed">
      {#each SPEEDS as s}
        <button
          type="button"
          class="speed-btn"
          class:active={speed === s}
          role="radio"
          aria-checked={speed === s}
          aria-label={`Speed ${s}x`}
          onclick={() => setSpeed(s)}
        >
          {s}x
        </button>
      {/each}
    </div>
  {/if}

  <span class="position" aria-live="polite" aria-atomic="true">
    {fmt(positionMs())} / {fmt(durationMs())}
  </span>
</div>

<style>
  .playback-controller {
    display: inline-flex;
    align-items: center;
    gap: var(--p-space-2);
    padding: 4px 6px;
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, var(--color-surface-raised) 80%, transparent);
    border: 1px solid var(--color-border-hairline);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
  }

  .play-btn {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--color-text-primary);
    font-size: 14px;
    line-height: 1;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms ease;
  }
  .play-btn:hover {
    background: rgba(var(--brand-rgb), 0.1);
  }
  .play-btn:focus-visible {
    outline: 1px solid var(--color-accent-primary);
    outline-offset: 1px;
  }
  .play-btn[aria-pressed="true"] {
    background: rgba(var(--brand-rgb), 0.15);
    color: var(--color-accent-primary);
  }

  .speeds {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: var(--color-surface-sunken);
    border-radius: var(--radius-xs);
    padding: 2px;
  }

  .speed-btn,
  .speed-cycle {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--font-size-caption);
    padding: 2px 8px;
    border-radius: var(--radius-xs);
    cursor: pointer;
    min-width: 32px;
    transition: background 120ms ease, color 120ms ease;
  }
  .speed-btn:hover,
  .speed-cycle:hover {
    background: rgba(var(--brand-rgb), 0.08);
  }
  .speed-btn:focus-visible,
  .speed-cycle:focus-visible {
    outline: 1px solid var(--color-accent-primary);
    outline-offset: 1px;
  }
  .speed-btn.active {
    background: var(--color-accent-primary);
    color: var(--color-text-on-accent, #fff);
    font-weight: 600;
  }

  .position {
    color: var(--color-text-secondary);
    letter-spacing: 0.04em;
    min-width: 96px;
    text-align: right;
  }

  .playback-controller.compact {
    /* Mobile compact variant: single speed cycle button + smaller position */
    gap: var(--p-space-1);
    padding: 2px 4px;
  }
  .playback-controller.compact .position {
    min-width: 80px;
  }

  /* Reduced motion: kill the transitions (functional state remains). */
  :global(html[data-motion="reduced"]) .play-btn,
  :global(html[data-motion="reduced"]) .speed-btn,
  :global(html[data-motion="reduced"]) .speed-cycle {
    transition: none !important;
  }
</style>
