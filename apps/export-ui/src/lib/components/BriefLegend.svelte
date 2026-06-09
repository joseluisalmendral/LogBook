<!--
  BriefLegend — display-annotations Feature B (ADR-DA-7).

  Sibling to LegendKey (NOT a mode prop on it — the LegendKey 8-chip contract is
  preserved untouched). The Full/Brief toggle lives in the scrubber/mobile host;
  this component renders ONLY the user-annotated events, each row showing the
  tag glyph in the annotation color + the label. Clicking a row scrolls to the
  matching `#event-{id}` anchor (respecting reduced-motion via the motion store).

  Subscribes to the shared `annotations` store, so it re-renders the moment an
  annotation is added, edited, removed, or cleared.

  Navigation (slice export-ux): annotations are GLOBAL (localStorage keyed by
  eventId across every session), so a marked point can live in a DIFFERENT
  chapter than the one currently open. Clicking a row therefore resolves the
  owning chapter from the payload and navigates through the SAME router +
  selection plumbing SubAgentIndex uses, so ChapterPlayer's selection
  subscriber scrolls the card into view and fires the one-shot acknowledge
  pulse (.lb-pulse-once) — never the looping heartbeat (.is-active).
-->
<script lang="ts">
  import { annotations, activeLegendId, TAG_META, type Annotation } from "../stores/annotations";
  import { getMotionState } from "../stores/motion";
  import { router } from "../stores/router";
  import { selection } from "../stores/selection";
  import { payload } from "../stores/data";

  // eventId -> owning chapter sessionId, built once from the frozen payload.
  // Lets a brief row jump to a mark that lives in another chapter (the chapter
  // route uses the chapter's sessionId as its chapterId — see CourseTOC).
  const eventChapter = new Map<string, string>();
  for (const chapter of payload.chapters) {
    for (const ev of chapter.events) {
      eventChapter.set(ev.id, chapter.sessionId);
    }
  }

  interface Props {
    /** Layout variant. Mirrors LegendKey. */
    variant?: "inline" | "mobile";
  }

  const { variant = "inline" }: Props = $props();

  let items = $state<Annotation[]>(Object.values(annotations.get()));
  $effect(() => {
    const unsub = annotations.subscribe((map) => {
      items = Object.values(map);
    });
    return () => unsub();
  });

  // Last-clicked row, shared across BOTH BriefLegend instances (scrubber + Zen
  // panel) so the highlight stays in sync wherever the row was clicked.
  let activeId = $state<string | null>(activeLegendId.get());
  $effect(() => {
    const unsub = activeLegendId.subscribe((id) => {
      activeId = id;
    });
    return () => unsub();
  });

  function scrollTo(eventId: string): void {
    activeLegendId.set(eventId);

    // Resolve the chapter that actually owns this marked event. Fall back to
    // the current chapter when the lookup misses (e.g. an orphaned annotation
    // whose event is no longer in the payload).
    const route = router.get();
    const ownerChapterId =
      eventChapter.get(eventId) ?? (route.name === "chapter" ? route.chapterId : null);

    if (ownerChapterId) {
      // Same robust path SubAgentIndex uses: prime the selection slot, then
      // push the ?event=<id> route. ChapterPlayer's selection subscriber then
      // scrolls + applies the one-shot .lb-pulse-once (NOT the looping
      // .is-active heartbeat). Works cross-chapter: navigating to another
      // chapter remounts ChapterPlayer, whose onMount subscriber fires with
      // the current selection snapshot and scrolls the target.
      selection._setFromRoute("chapter", eventId);
      router.navigate({ name: "chapter", chapterId: ownerChapterId, eventId });
      return;
    }

    // Fallback: scroll directly to the anchor if we could not resolve a
    // chapter (no payload match and not on a chapter route).
    const el = document.getElementById(`event-${eventId}`);
    if (!el) return;
    const motionAllowed = getMotionState().motionAllowed;
    el.scrollIntoView({ behavior: motionAllowed ? "smooth" : "auto", block: "center" });
  }

  // Remove a single marked point straight from the brief list (the global
  // annotations store update re-renders both BriefLegend instances + the ring).
  function removeMark(eventId: string): void {
    annotations.remove(eventId);
    if (activeLegendId.get() === eventId) activeLegendId.set(null);
  }
</script>

<div class="brief-legend" data-variant={variant} data-testid="brief-legend">
  {#if items.length === 0}
    <p class="brief-empty lb-margin-note">
      No marked points yet — use the tag control on any event.
    </p>
  {:else}
    <ul class="brief-list" role="list">
      {#each items as item (item.eventId)}
        <li class="brief-item">
          <button
            type="button"
            class="brief-row"
            class:brief-row--selected={activeId === item.eventId}
            onclick={() => scrollTo(item.eventId)}
            data-testid="brief-entry"
          >
            <span class="brief-glyph" aria-hidden="true" style="color: {item.color};"
              >{TAG_META[item.tag].glyph}</span
            >
            <span class="brief-label">{item.label}</span>
          </button>
          <button
            type="button"
            class="brief-remove"
            onclick={() => removeMark(item.eventId)}
            aria-label="Remove this marked point"
            title="Remove this marked point"
            data-testid="brief-remove"
          >×</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .brief-legend {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    min-width: 0;
  }

  .brief-empty {
    margin: 0;
  }

  .brief-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--p-space-1) var(--p-space-3);
    align-items: center;
  }

  .brief-legend[data-variant="mobile"] .brief-list {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }

  .brief-item {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  /* Per-point delete: a small "×" beside each marked row. Faint at rest,
     brightens to the error color on hover/focus. Clicking it removes only
     that annotation (not all). */
  .brief-remove {
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0;
    color: var(--color-text-tertiary);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    line-height: 1;
    padding: 2px 5px;
    opacity: 0.5;
    transition: opacity 150ms ease-out, color 150ms ease-out,
      background 150ms ease-out;
  }

  .brief-item:hover .brief-remove,
  .brief-remove:focus-visible {
    opacity: 1;
  }

  .brief-remove:hover {
    color: var(--color-error);
    background: var(--color-surface-sunken);
  }

  .brief-remove:focus-visible {
    outline: 1px solid var(--color-error);
    outline-offset: 1px;
  }

  .brief-legend[data-variant="mobile"] .brief-item {
    display: flex;
    width: 100%;
  }

  .brief-legend[data-variant="mobile"] .brief-row {
    flex: 1;
  }

  .brief-row {
    appearance: none;
    background: transparent;
    /* Transparent 1px border at rest so the selected state can color it in
       without shifting the row by 1px (no layout jump). */
    border: 1px solid transparent;
    border-radius: 0;
    padding: 4px 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-secondary);
    font: inherit;
    max-width: 100%;
    text-align: left;
    transition: color 150ms ease-out, background 150ms ease-out;
  }

  .brief-legend[data-variant="mobile"] .brief-row {
    width: 100%;
    border-bottom: 1px solid var(--color-border-hairline);
  }

  .brief-row:hover,
  .brief-row:focus-visible {
    color: var(--color-text-primary);
    background: var(--color-surface-sunken);
  }

  /* Last-clicked marked point stays highlighted. Deliberately STATIC: a subtle
     sunken surface + a hairline accent border. No animation, no box-shadow
     pulse, no font-weight change (font-weight would shift layout). A distinct
     class name (NOT `.is-active`) avoids the global `.is-active` heartbeat rule
     in affordance.css, which loops `lb-heartbeat` forever for the playhead. */
  .brief-row.brief-row--selected {
    color: var(--color-text-primary);
    background: var(--color-surface-sunken);
    border: 1px solid var(--color-accent-primary);
  }

  .brief-row:focus-visible {
    outline: 1px solid var(--color-focus, var(--color-accent-primary));
    outline-offset: 2px;
  }

  .brief-glyph {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    font-weight: 700;
    line-height: 1;
    flex-shrink: 0;
  }

  .brief-label {
    font-family: var(--font-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(html[data-motion="reduced"]) .brief-row {
    transition: none;
  }
</style>
