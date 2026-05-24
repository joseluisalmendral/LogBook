<!--
  UserPromptRow — slice 21 P2 (R-84, R-92, ADR-SN-D1).

  Renders a `user_prompt` event as a right-aligned chat bubble. The bubble
  uses the accent-secondary tint to signal "you spoke" without shouting.
  The body markdown is pre-sanitized by the backend and lives in
  payload.bodies[event.id].

  Layout (R-92):
    - Desktop (>767px): bubble max-width 720px, right-aligned via margin-left:auto
    - Mobile (≤767px): bubble takes full width but keeps the right-aligned
      eyebrow row so the conversation direction stays legible.

  Accessibility:
    - role="button" / tabindex=0 / Enter|Space → openInspector
    - data-event-id + data-testid for the scrubber + R-68 selection sync
    - lb-snap-target so the global scroll-snap still aligns this row

  Reduced-motion: no entrance animation. Inherits the chapter's existing
  reveal cascade (slice 10 motion budget) without adding new moments.
-->
<script lang="ts">
  import type { RenderEvent } from "../types";
  import { inspector } from "../stores/inspector";
  import { selection } from "../stores/selection";
  import { router } from "../stores/router";
  import { payload } from "../stores/data";
  import MarkdownBlock from "./MarkdownBlock.svelte";

  interface Props {
    event: RenderEvent;
  }

  const { event }: Props = $props();

  const body = $derived(payload.bodies[event.id]);

  function formatTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function openInspectorWithSelection(): void {
    inspector.open(event.id);
    const route = router.get();
    if (route.name === "chapter") {
      selection._setFromRoute("chapter", event.id);
      router.navigate({ name: "chapter", chapterId: route.chapterId, eventId: event.id });
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openInspectorWithSelection();
    }
  }
</script>

<div
  class="user-prompt-row lb-snap-target"
  data-testid="user-prompt-row"
  data-event-id={event.id}
  data-interactive
  role="button"
  tabindex="0"
  aria-label="Your prompt"
  onclick={openInspectorWithSelection}
  onkeydown={onKey}
>
  <div class="bubble">
    <header class="eyebrow">
      <span class="who">You</span>
      <span class="time lb-tnum">{formatTime(event.ts)}</span>
    </header>
    {#if body}
      <div class="body">
        <MarkdownBlock {body} />
      </div>
    {/if}
  </div>
</div>

<style>
  .user-prompt-row {
    display: flex;
    justify-content: flex-end;
    margin: var(--p-space-3) 0;
    cursor: pointer;
  }

  /*
   * Slice 30 — Paper Brutalism for the user-prompt bubble.
   *
   *  - 0px corners.
   *  - Glow-Yellow wash background (the editorial highlight role).
   *  - 3px Inkwell Violet border-right (mirror of Claude's accent-left
   *    so the two voices feel visually anchored to opposite sides of
   *    the page).
   *  - 1px hairline violet on top/bottom/left at 16%.
   *  - No soft shadow; no transition on borders (static feel).
   */
  .bubble {
    background: color-mix(in srgb, var(--p-glow-yellow) 28%, var(--color-surface-raised));
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 16%, transparent);
    border-right: 3px solid var(--color-text-primary);
    border-radius: 0;
    padding: var(--p-space-4) var(--p-space-5);
    max-width: 760px;
    width: fit-content;
  }

  .user-prompt-row:focus-visible {
    outline: none;
  }
  .user-prompt-row:focus-visible .bubble {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 3px;
  }

  .eyebrow {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: var(--p-space-2);
    margin-bottom: var(--p-space-2);
  }

  .who {
    font-size: var(--font-size-caption);
    color: var(--color-accent-secondary, var(--color-text-secondary));
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }

  .time {
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
  }

  .body {
    color: var(--color-text-primary);
  }

  /* Mobile: bubble takes full width but the eyebrow row stays right-aligned
     so the affordance of "you said this" is preserved (R-92). */
  @media (max-width: 767px) {
    .bubble {
      max-width: 100%;
      width: 100%;
      padding: var(--p-space-3);
    }
  }

  /* Reduced-motion: no transitions on hover. */
  :global(html[data-motion="reduced"]) .bubble {
    transition: none;
  }
</style>
