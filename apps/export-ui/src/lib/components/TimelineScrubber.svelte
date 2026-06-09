<!--
  TimelineScrubber — DVR-style scrub control pinned at the bottom of a
  ChapterPlayer.

  Spec design §2 row 6, motion #2. Two parts:
    (a) Thin progress track 0..100% reflecting scroll position.
    (b) Chip bar with event markers — colored by event kind, click to jump.

  Drives the global `scrub` store + writes `--scrub-progress` on the chapter
  root so descendant components can animate from it.

  Scroll listener is throttled to rAF (single global listener for the entire
  ChapterPlayer scroll container).

  Keyboard:
    J / K     prev / next event
    Home / End  scroll to start / end

  Reduced-motion:
    No scroll-driven animation. The scrubber renders a STATIC track (full
    width) + chip bar; clicks still navigate via scrollIntoView({ behavior: 'auto' }).
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { RenderEvent } from "../types";
  import { scrub } from "../stores/scrub";
  import { playhead } from "../stores/playhead";
  import LegendKey from "./LegendKey.svelte";
  import BriefLegend from "./BriefLegend.svelte";
  import PlaybackController from "./PlaybackController.svelte";

  interface Props {
    events: RenderEvent[];
    /** The element whose scroll position drives progress (defaults to window). */
    scrollContainer?: HTMLElement | null;
  }

  const { events, scrollContainer = null }: Props = $props();

  // display-annotations: Full (8-kind legend, current behavior) vs Brief
  // (annotated points only). Default Full, NOT persisted (ADR-DA-8).
  let legendView = $state<"full" | "brief">("full");

  // Collapsible legend (parity with the Zen legend panel): clicking anywhere
  // outside the legend collapses it to a chip; the chip reopens it. Default
  // expanded, not persisted.
  let collapsed = $state(false);
  let legendHostEl = $state<HTMLElement | undefined>(undefined);

  function handleWindowClick(event: MouseEvent): void {
    if (collapsed || !legendHostEl) return;
    const target = event.target as Node | null;
    if (!target) return;
    // In-legend controls that remove themselves (brief "×" / "↕" reset) detach
    // from the DOM before this bubbles up — contains() would then falsely report
    // "outside" and wrongly collapse. Detached targets were inside: ignore them.
    if ((target as Node & { isConnected?: boolean }).isConnected === false) return;
    if (!legendHostEl.contains(target)) collapsed = true;
  }

  let progress = $state(0);
  let rafId: number | null = null;
  let playMode = $state<"scroll" | "play">("scroll");

  function recompute(): void {
    rafId = null;
    if (typeof window === "undefined") return;
    const target = scrollContainer ?? document.scrollingElement ?? document.documentElement;
    if (!target) return;
    const max = target.scrollHeight - target.clientHeight;
    const p = max > 0 ? target.scrollTop / max : 0;
    progress = Math.max(0, Math.min(1, p));
    // Slice 12 P6 / ADR-SC-F2: when the playhead is driving, the scroll
    // store yields. Without this, the playhead's programmatic scroll would
    // bounce back into --scroll-progress and produce a double-driver flicker.
    if (playMode === "play") return;
    scrub.set(progress);
    document.documentElement.style.setProperty("--scrub-progress", String(progress));
  }

  function onScroll(): void {
    // INV-16: distinguish programmatic scroll (caused by playhead.scrollIntoView)
    // from a user scroll. The programmatic call set suppressUserScrollUntil =
    // now() + 350ms BEFORE invoking scrollIntoView, so any scroll firing inside
    // that window is ours and must NOT trigger pause-on-user-scroll.
    const isProgrammatic = playhead.isSuppressingScroll();
    if (!isProgrammatic && playhead.get().playing) {
      // User scrolled while playing → pause and revert to scroll-mode.
      playhead.pause("user");
    }
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(recompute);
  }

  onMount(() => {
    if (typeof window === "undefined") return;
    const target = scrollContainer ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    const unsub = playhead.subscribe((s) => {
      playMode = s.mode;
    });
    recompute();
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
      unsub();
    };
  });

  function jumpToEvent(eventId: string): void {
    const el = document.getElementById(`event-${eventId}`);
    if (!el) return;
    // Smooth scroll on motion-allowed; instant otherwise (CSS scroll-behavior
    // is overridden by the global rule in app.css for reduced-motion).
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function classify(event: RenderEvent): string {
    const k = (event as { kind?: string }).kind ?? event.type ?? "";
    if (k === "agent_question") return "question";
    if (k.startsWith("subagent")) return "subagent";
    if (k.endsWith("decision")) return "decision";
    if (k.endsWith("error")) return "error";
    if (k.endsWith("milestone")) return "milestone";
    if (k.endsWith("lesson")) return "lesson";
    if (k.endsWith("fix")) return "fix";
    return "generic";
  }

  function onKey(e: KeyboardEvent): void {
    if (!events.length) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "j" || e.key === "J") {
      e.preventDefault();
      jumpRelative(1);
    } else if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      jumpRelative(-1);
    } else if (e.key === "Home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (e.key === "End") {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
  }

  function jumpRelative(delta: 1 | -1): void {
    // Find the event whose anchor is closest to the current viewport center.
    const cy = window.innerHeight / 2;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < events.length; i++) {
      const el = document.getElementById(`event-${events[i]!.id}`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const d = Math.abs(rect.top + rect.height / 2 - cy);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) return;
    const nextIdx = Math.max(0, Math.min(events.length - 1, bestIdx + delta));
    jumpToEvent(events[nextIdx]!.id);
  }
</script>

<svelte:window onkeydown={onKey} onclick={handleWindowClick} />

<div
  class="scrubber"
  data-testid="timeline-scrubber"
  aria-label="Chapter timeline"
  data-play-mode={playMode}
>
  <!-- Slice 12 P1 R-51: collapsible legend mounted above the dock.
       display-annotations: Full/Brief switch (ADR-DA-7). -->
  <div class="legend-host" bind:this={legendHostEl}>
    {#if collapsed}
      <button
        type="button"
        class="legend-reopen"
        onclick={() => (collapsed = false)}
        data-testid="legend-reopen"
        title="Show legend"
      >
        ☰ Legend
      </button>
    {:else}
      <div class="legend-views" role="group" aria-label="Legend view">
        <button
          type="button"
          class="legend-view-btn"
          class:is-active={legendView === "full"}
          aria-pressed={legendView === "full"}
          onclick={() => (legendView = "full")}
          data-testid="legend-view-full"
        >
          Full
        </button>
        <button
          type="button"
          class="legend-view-btn"
          class:is-active={legendView === "brief"}
          aria-pressed={legendView === "brief"}
          onclick={() => (legendView = "brief")}
          data-testid="legend-view-brief"
        >
          Brief
        </button>
      </div>
      <button
        type="button"
        class="legend-collapse"
        onclick={() => (collapsed = true)}
        data-testid="legend-collapse"
        aria-label="Collapse legend"
        title="Collapse legend"
      >
        —
      </button>
      {#if legendView === "full"}
        <LegendKey variant="inline" />
      {:else}
        <BriefLegend variant="inline" />
      {/if}
    {/if}
  </div>

  <!-- Slice 12 P6 R-72: playback controls live in the dock alongside the scrubber. -->
  <div class="dock-row">
    <div class="track" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div class="track-fill" style="width: {progress * 100}%"></div>
    </div>
    <PlaybackController {events} />
  </div>
  <div class="chips" role="list">
    {#each events as ev}
      {@const k = classify(ev)}
      <button
        type="button"
        class="chip"
        data-kind={k}
        title={ev.title ?? ev.id}
        aria-label={ev.title ?? ev.id}
        onclick={() => jumpToEvent(ev.id)}
      >
        <span class="chip-dot" aria-hidden="true"></span>
      </button>
    {/each}
  </div>
</div>

<style>
  /* display-annotations: Full/Brief legend host + segmented toggle. */
  .legend-host {
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
    flex-wrap: wrap;
  }

  .legend-views {
    display: inline-flex;
    border: 1px solid var(--color-border-hairline);
    border-radius: 0;
    flex-shrink: 0;
  }

  .legend-view-btn {
    appearance: none;
    background: transparent;
    border: 0;
    border-right: 1px solid var(--color-border-hairline);
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 4px 10px;
    cursor: pointer;
    transition: color 150ms ease-out, background 150ms ease-out;
  }

  .legend-view-btn:last-child {
    border-right: 0;
  }

  .legend-view-btn:hover,
  .legend-view-btn:focus-visible {
    color: var(--color-text-primary);
    background: var(--color-surface-sunken);
  }

  .legend-view-btn.is-active {
    color: var(--color-text-primary);
    background: var(--color-surface-sunken);
    font-weight: 700;
  }

  .legend-view-btn:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: -2px;
  }

  :global(html[data-motion="reduced"]) .legend-view-btn {
    transition: none;
  }

  /* Collapse "—" button + reopen "☰ Legend" chip (parity with the Zen panel). */
  .legend-collapse,
  .legend-reopen {
    appearance: none;
    background: transparent;
    border: 1px solid var(--color-border-hairline);
    border-radius: 0;
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 150ms ease-out, background 150ms ease-out;
  }

  .legend-collapse {
    padding: 4px 8px;
  }

  .legend-reopen {
    padding: 4px 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .legend-collapse:hover,
  .legend-collapse:focus-visible,
  .legend-reopen:hover,
  .legend-reopen:focus-visible {
    color: var(--color-text-primary);
    background: var(--color-surface-sunken);
  }

  :global(html[data-motion="reduced"]) .legend-collapse,
  :global(html[data-motion="reduced"]) .legend-reopen {
    transition: none;
  }

  .scrubber {
    position: sticky;
    bottom: 0;
    background: color-mix(in srgb, var(--color-surface) 92%, transparent);
    backdrop-filter: saturate(140%) blur(6px);
    -webkit-backdrop-filter: saturate(140%) blur(6px);
    border-top: 1px solid var(--color-border-hairline);
    padding: var(--p-space-3) var(--p-space-5);
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--p-space-2);
  }

  /* Slice 12 P6 R-72: when playhead is driving (mode=play), dim the scroll-
     driven progress so the user sees who's in charge. */
  .scrubber[data-play-mode="play"] .track-fill {
    opacity: 0.45;
  }

  .dock-row {
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
  }

  .track {
    flex: 1;
    height: var(--scrubber-track-height);
    background: var(--color-surface-sunken);
    border-radius: 999px;
    overflow: hidden;
    position: relative;
  }

  .track-fill {
    height: 100%;
    background: var(--color-accent-primary);
    border-radius: 999px;
    transition: width 80ms linear;
  }

  :global(html[data-motion="reduced"]) .track-fill {
    transition: none !important;
  }

  /* Slice 12 P1 R-76 / ADR-SC-G1: scroll-timeline driven progress on Chromium 115+.
     When <html data-scroll-timeline="native"> the inline width still applies
     (so SSR / first paint reads correctly) but the @keyframes animation tied
     to scroll() takes over during scroll, eliminating the rAF tick. Browsers
     without scroll-timeline (Safari/Firefox) keep the rAF + inline-width path.
     Reduced-motion suppresses the animation entirely. */
  @supports (animation-timeline: scroll()) {
    :global(html[data-scroll-timeline="native"][data-motion="allowed"]) .track-fill {
      animation: lb-scroll-progress linear;
      animation-timeline: scroll(root);
    }
  }

  @keyframes lb-scroll-progress {
    from { width: 0%; }
    to   { width: 100%; }
  }

  .chips {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .chip {
    appearance: none;
    background: transparent;
    border: 0;
    padding: 4px;
    cursor: pointer;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: transform 150ms ease-out;
  }
  .chip:hover { transform: scale(1.2); }

  .chip-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-text-tertiary);
  }
  .chip[data-kind="decision"] .chip-dot { background: var(--color-decision); }
  .chip[data-kind="error"]    .chip-dot { background: var(--color-error); }
  .chip[data-kind="milestone"] .chip-dot { background: var(--color-accent-primary); }
  .chip[data-kind="lesson"]   .chip-dot { background: var(--color-accent-secondary); }
  .chip[data-kind="fix"]      .chip-dot { background: var(--color-success); }
  .chip[data-kind="question"] .chip-dot { background: var(--color-question); }
  .chip[data-kind="subagent"] .chip-dot { background: var(--color-text-primary); }

  @media (max-width: 767px) {
    .scrubber {
      padding: var(--p-space-2) var(--p-space-3);
    }
  }
</style>
