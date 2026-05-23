<!--
  ChapterPlayer — the chapter route's root component.

  Replaces P3's <ChapterPlaceholder>. Owns:
    - <ChapterHeader>      editorial header + view-transition anchor
    - <PhaseAct> sections  grouped by chapter.phases (if any)
    - <TurnRow> per event  the dispatcher routing to specific cards
    - <TimelineScrubber>   pinned at bottom, drives --scrub-progress
    - back button          returns to TOC

  Layout: single column document, 880px reading width, large vertical
  rhythm. The scrubber stays sticky to viewport bottom while content scrolls.

  Each event gets an anchor id `event-<id>` so the scrubber chips + inspector
  links can jump to it.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { payload } from "../stores/data";
  import { router } from "../stores/router";
  import { subscribeMotion } from "../stores/motion";
  import type { Chapter, RenderEvent } from "../types";
  import ChapterHeader from "./ChapterHeader.svelte";
  import TurnRow from "./TurnRow.svelte";
  import TimelineScrubber from "./TimelineScrubber.svelte";
  import MobileTimeline from "./MobileTimeline.svelte";
  import PhaseAct from "./PhaseAct.svelte";
  import EmptyState from "./EmptyState.svelte";

  // Subscribe to the motion store so we can swap the desktop scrubber for
  // the mobile anchor list (design D3: horizontal-swipe scrubber conflicts
  // with native page scroll on iOS Safari, so mobile uses MobileTimeline).
  let isMobile = $state(false);
  onMount(() => subscribeMotion((s) => { isMobile = s.isMobile; }));

  interface Props {
    chapterId: string;
  }

  const { chapterId }: Props = $props();

  const chapter = $derived<Chapter | null>(
    payload.chapters.find((c) => c.sessionId === chapterId) ?? null,
  );

  /**
   * Group events under their phase if the chapter has multiple phases.
   * For chapters with a single phase (the common case), we skip the PhaseAct
   * wrapper and let TurnRows flow directly under the header. Multi-phase
   * chapters get explicit Act dividers.
   */
  function groupEvents(ch: Chapter): Array<{ phase: { id: string; label: string } | null; events: RenderEvent[] }> {
    if (ch.phases.length <= 1) {
      return [{ phase: null, events: ch.events }];
    }
    // Multi-phase: assign each event to the latest phase whose ts <= event.ts.
    const sortedPhases = [...ch.phases].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const groups = sortedPhases.map((p) => ({ phase: { id: p.id, label: p.label }, events: [] as RenderEvent[] }));
    for (const ev of ch.events) {
      const evTs = new Date(ev.ts).getTime();
      let target = 0;
      for (let i = 0; i < sortedPhases.length; i++) {
        if (new Date(sortedPhases[i]!.ts).getTime() <= evTs) target = i;
      }
      groups[target]!.events.push(ev);
    }
    return groups;
  }

  const groups = $derived(chapter ? groupEvents(chapter) : []);

  function back(): void {
    router.navigate({ name: "toc" });
  }
</script>

<section class="chapter-player" data-testid="chapter-player">
  {#if chapter}
    <div class="player-doc">
      <button type="button" class="back-btn" onclick={back} data-testid="chapter-back">
        <span aria-hidden="true">←</span> Back to course
      </button>

      <ChapterHeader {chapter} />

      <div class="phases">
        {#each groups as group, gi}
          {#if group.phase}
            <PhaseAct label={group.phase.label} index={gi} />
          {/if}
          {#if group.events.length === 0}
            <EmptyState title="No events" hint="This phase has no recorded events." />
          {:else}
            <div class="events-stream">
              {#each group.events as ev (ev.id)}
                <div id={`event-${ev.id}`} class="event-anchor">
                  <TurnRow event={ev} />
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      </div>

      {#if isMobile}
        <MobileTimeline events={chapter.events} />
      {/if}
    </div>

    {#if !isMobile}
      <TimelineScrubber events={chapter.events} />
    {/if}
  {:else}
    <div class="not-found">
      <button type="button" class="back-btn" onclick={back}>
        <span aria-hidden="true">←</span> Back to course
      </button>
      <EmptyState
        title="Session not found"
        hint={`No session with id ${chapterId} in this export.`}
      />
    </div>
  {/if}
</section>

<style>
  .chapter-player {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .player-doc {
    flex: 1;
    max-width: 920px;
    margin: 0 auto;
    padding: var(--p-space-5) var(--p-space-6) var(--p-space-9) var(--p-space-6);
    width: 100%;
    box-sizing: border-box;
  }

  .back-btn {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--color-accent-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
    padding: 0;
    cursor: pointer;
    margin-bottom: var(--p-space-4);
    display: inline-flex;
    align-items: center;
    gap: var(--p-space-1);
  }

  .back-btn:hover {
    text-decoration: underline;
  }

  .events-stream {
    display: flex;
    flex-direction: column;
    gap: var(--p-space-2);
  }

  .event-anchor {
    scroll-margin-top: var(--p-space-6);
    /* Scroll-driven reveal motion #2. opacity 0 → 1 + translateY 8px → 0 as
       the event approaches the viewport center. */
    opacity: 1;
    transform: translateY(0);
    transition: opacity 250ms ease-out, transform 250ms ease-out;
  }

  /* Reduced-motion: always full opacity, no transform. The global rule in
     app.css zeroes the transition duration; explicit values here are for
     clarity. */
  :global(html[data-motion="reduced"]) .event-anchor {
    transition: none !important;
  }

  .not-found {
    padding: var(--p-space-7) var(--p-space-6);
    max-width: 880px;
    margin: 0 auto;
  }

  @media (max-width: 767px) {
    .player-doc {
      padding: var(--p-space-4) var(--p-space-4) var(--p-space-8) var(--p-space-4);
    }
  }
</style>
