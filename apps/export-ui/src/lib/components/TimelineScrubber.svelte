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
  import LegendKey from "./LegendKey.svelte";

  interface Props {
    events: RenderEvent[];
    /** The element whose scroll position drives progress (defaults to window). */
    scrollContainer?: HTMLElement | null;
  }

  const { events, scrollContainer = null }: Props = $props();

  let progress = $state(0);
  let rafId: number | null = null;

  function recompute(): void {
    rafId = null;
    if (typeof window === "undefined") return;
    const target = scrollContainer ?? document.scrollingElement ?? document.documentElement;
    if (!target) return;
    const max = target.scrollHeight - target.clientHeight;
    const p = max > 0 ? target.scrollTop / max : 0;
    progress = Math.max(0, Math.min(1, p));
    scrub.set(progress);
    // Mirror to CSS variable on <html> so any descendant can animate from it.
    document.documentElement.style.setProperty("--scrub-progress", String(progress));
  }

  function onScroll(): void {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(recompute);
  }

  onMount(() => {
    if (typeof window === "undefined") return;
    const target = scrollContainer ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    // Seed.
    recompute();
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
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

<svelte:window onkeydown={onKey} />

<div class="scrubber" data-testid="timeline-scrubber" aria-label="Chapter timeline">
  <!-- Slice 12 P1 R-51: collapsible legend mounted above the dock. -->
  <LegendKey variant="inline" />

  <div class="track" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
    <div class="track-fill" style="width: {progress * 100}%"></div>
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

  .track {
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
