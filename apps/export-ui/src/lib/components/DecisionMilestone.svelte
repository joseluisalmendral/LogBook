<!--
  DecisionMilestone — decision event row with a pulsing ring.

  Spec design §2 row 11 / motion #5. The pulse signals "this was an important
  inflection point" — but ONLY when in viewport so off-screen decisions don't
  burn paint cycles.

  THE PULSE:
    @property --decision-pulse: <number>; animated 0 → 1 via @keyframes.
    Drives box-shadow ring radius via calc(). Registered as a CSS @property
    so the value interpolates smoothly (browsers without @property support
    fall back to a stepped animation — still works, just less buttery).

  IO GATE:
    IntersectionObserver toggles data-in-view. When false, animation-play-state
    is paused; when true, running. Reduced-motion overrides to "paused" always.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { RenderEvent } from "../types";
  import { inspector } from "../stores/inspector";
  import { selection } from "../stores/selection";
  import { router } from "../stores/router";

  interface Props {
    event: RenderEvent;
  }

  const { event }: Props = $props();

  let cardEl: HTMLElement | undefined = $state();
  let inView = $state(false);

  onMount(() => {
    if (!cardEl || typeof IntersectionObserver === "undefined") {
      inView = true;
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) inView = entry.isIntersecting;
      },
      { threshold: 0.3 },
    );
    observer.observe(cardEl);
    return () => observer.disconnect();
  });

  function openInspector(): void {
    inspector.open(event.id);
    // Slice-12 P7 (R-68): emit selection + URL hash query for transcript sync.
    const route = router.get();
    if (route.name === "chapter") {
      selection._setFromRoute("chapter", event.id);
      router.navigate({ name: "chapter", chapterId: route.chapterId, eventId: event.id });
    }
  }
</script>

<button
  type="button"
  class="decision lb-snap-target"
  data-testid="decision-milestone"
  data-event-id={event.id}
  data-interactive
  data-in-view={inView}
  onclick={openInspector}
  bind:this={cardEl}
>
  <span class="ring" aria-hidden="true"></span>
  <span class="content">
    <span class="eyebrow">Decision</span>
    <span class="title">{event.title ?? "Untitled decision"}</span>
    {#if event.description}
      <span class="description">{event.description}</span>
    {/if}
  </span>
</button>

<style>
  @property --decision-pulse {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
  }

  .decision {
    appearance: none;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-hairline);
    border-radius: var(--card-radius);
    padding: var(--p-space-4) var(--p-space-5);
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--p-space-4);
    align-items: center;
    cursor: pointer;
    text-align: left;
    width: 100%;
    font: inherit;
    color: inherit;
    margin: var(--p-space-3) 0;
    border-left: 3px solid var(--color-decision);
  }

  .ring {
    position: relative;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-decision);
    flex-shrink: 0;
    /* Pulse ring via box-shadow with @property-driven radius. */
    --decision-pulse: 0;
    box-shadow:
      0 0 0 calc(var(--decision-pulse) * 6px) color-mix(in srgb, var(--color-decision) 30%, transparent),
      0 0 0 calc(var(--decision-pulse) * 12px) color-mix(in srgb, var(--color-decision) 12%, transparent);
    animation: decision-pulse 1.6s ease-in-out infinite alternate;
    animation-play-state: paused;
  }

  .decision[data-in-view="true"] .ring {
    animation-play-state: running;
  }

  @keyframes decision-pulse {
    from { --decision-pulse: 0; }
    to   { --decision-pulse: 1; }
  }

  /* Reduced-motion: static glow (no pulse animation). */
  :global(html[data-motion="reduced"]) .ring {
    animation: none !important;
    --decision-pulse: 0 !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-decision) 20%, transparent) !important;
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-decision);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }

  .title {
    font-family: var(--font-headline);
    font-size: var(--font-size-lead);
    color: var(--color-text-primary);
    line-height: 1.3;
  }

  .description {
    font-size: var(--font-size-meta);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  .decision:hover {
    border-color: var(--color-decision);
  }
</style>
