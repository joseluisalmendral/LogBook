<!--
  BriefLegend — display-annotations Feature B (ADR-DA-7).

  Sibling to LegendKey (NOT a mode prop on it — the LegendKey 8-chip contract is
  preserved untouched). The Full/Brief toggle lives in the scrubber/mobile host;
  this component renders ONLY the user-annotated events as a scannable, ordered
  list: a tabular index, the tag glyph in the annotation color, the label, and a
  per-row delete. Rows are sorted in CONVERSATION order (their position in the
  payload), not insertion order, so the list mirrors the timeline.

  Clicking a row resolves the owning chapter and navigates through the SAME
  router + selection plumbing SubAgentIndex uses, so ChapterPlayer's selection
  subscriber scrolls the card into view and fires the one-shot acknowledge pulse
  (.lb-pulse-once) — never the looping heartbeat (.is-active).

  Subscribes to the shared `annotations` store, so it re-renders the moment an
  annotation is added, edited, removed, or cleared.
-->
<script lang="ts">
  import { annotations, activeLegendId, TAG_META, type Annotation } from "../stores/annotations";
  import { getMotionState } from "../stores/motion";
  import { router } from "../stores/router";
  import { selection } from "../stores/selection";
  import { payload } from "../stores/data";

  // Built once from the frozen payload:
  //   eventChapter: eventId -> owning chapter sessionId (cross-chapter jump).
  //   eventOrder:   eventId -> global position (conversation order sort key).
  const eventChapter = new Map<string, string>();
  const eventOrder = new Map<string, number>();
  let _ord = 0;
  for (const chapter of payload.chapters) {
    for (const ev of chapter.events) {
      eventChapter.set(ev.id, chapter.sessionId);
      eventOrder.set(ev.id, _ord++);
    }
  }

  // Sort marks by their position in the conversation; orphans (event no longer
  // in the payload) sink to the bottom but keep a stable relative order.
  function sortChrono(list: Annotation[]): Annotation[] {
    return [...list].sort((a, b) => {
      const oa = eventOrder.get(a.eventId) ?? Number.MAX_SAFE_INTEGER;
      const ob = eventOrder.get(b.eventId) ?? Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });
  }

  interface Props {
    /** Layout variant. Mirrors LegendKey. */
    variant?: "inline" | "mobile";
  }

  const { variant = "inline" }: Props = $props();

  let items = $state<Annotation[]>(sortChrono(Object.values(annotations.get())));
  $effect(() => {
    const unsub = annotations.subscribe((map) => {
      items = sortChrono(Object.values(map));
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

    const route = router.get();
    const ownerChapterId =
      eventChapter.get(eventId) ?? (route.name === "chapter" ? route.chapterId : null);

    if (ownerChapterId) {
      // Robust path (same as SubAgentIndex): prime selection, push ?event=<id>.
      // ChapterPlayer's selection subscriber scrolls + applies .lb-pulse-once
      // (one-shot), NOT the looping .is-active heartbeat. Works cross-chapter.
      selection._setFromRoute("chapter", eventId);
      router.navigate({ name: "chapter", chapterId: ownerChapterId, eventId });
      return;
    }

    // Fallback: direct anchor scroll if we could not resolve a chapter.
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
    <ol class="brief-list" data-testid="brief-list">
      {#each items as item, i (item.eventId)}
        <li class="brief-item">
          <button
            type="button"
            class="brief-row"
            class:brief-row--selected={activeId === item.eventId}
            onclick={() => scrollTo(item.eventId)}
            title={item.label}
            data-testid="brief-entry"
          >
            <span class="brief-num" aria-hidden="true">{i + 1}</span>
            <span class="brief-glyph" aria-hidden="true" style="color: {item.color};"
              >{TAG_META[item.tag].glyph}</span
            >
            <span class="brief-label">{item.label}</span>
          </button>
          <button
            type="button"
            class="brief-remove"
            onclick={() => removeMark(item.eventId)}
            aria-label={`Remove marked point ${i + 1}: ${item.label}`}
            title="Remove this marked point"
            data-testid="brief-remove"
          >×</button>
        </li>
      {/each}
    </ol>
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

  /* Vertical, table-like list. One mark per row so the eye scans a single
     column of labels; hairline separators give the "ledger" order the user
     asked for. Capped height with a thin scroll so it grows but stays usable. */
  .brief-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    max-height: min(42vh, 24rem);
    overflow-y: auto;
    scrollbar-width: thin;
  }

  /* Width floor so the label column has room to align even in the narrow
     scrubber host. The Zen panel / mobile give it more. */
  .brief-legend[data-variant="inline"] .brief-list {
    min-width: 15rem;
  }

  .brief-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto; /* row | delete */
    align-items: stretch;
    min-width: 0;
    border-bottom: 1px solid var(--color-border-hairline);
  }

  .brief-item:last-child {
    border-bottom: 0;
  }

  /* Aligned columns: a right-aligned tabular index, a fixed-width glyph, then
     the label. Identical track sizing on every row keeps the glyphs and labels
     in vertical alignment — the core scannability win. */
  .brief-row {
    appearance: none;
    background: transparent;
    border: 0;
    border-radius: 0;
    display: grid;
    grid-template-columns: 1.6em 1.15em minmax(0, 1fr);
    align-items: center;
    gap: var(--p-space-2);
    width: 100%;
    min-width: 0;
    padding: var(--p-space-2) var(--p-space-2);
    cursor: pointer;
    color: var(--color-text-secondary);
    font: inherit;
    text-align: left;
    /* inset accent lives on the left edge when selected; reserve nothing at
       rest (box-shadow doesn't affect layout, so no shift). */
    transition: color 150ms ease-out, background 150ms ease-out;
  }

  .brief-num {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    line-height: 1;
    text-align: right;
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .brief-glyph {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    font-weight: 700;
    line-height: 1;
    text-align: center;
  }

  .brief-label {
    font-family: var(--font-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .brief-row:hover,
  .brief-row:focus-visible {
    color: var(--color-text-primary);
    background: var(--color-surface-sunken);
  }

  /* Last-clicked marked point: STATIC sunken surface + a hard left accent bar
     (inset shadow, so no layout shift) + the index goes accent + bold. No
     animation — a distinct class name avoids the global `.is-active` heartbeat
     in affordance.css. */
  .brief-row.brief-row--selected {
    color: var(--color-text-primary);
    background: var(--color-surface-sunken);
    box-shadow: inset 3px 0 0 0 var(--color-accent-primary);
  }

  .brief-row.brief-row--selected .brief-num {
    color: var(--color-accent-primary);
    font-weight: 700;
  }

  .brief-row:focus-visible {
    outline: 1px solid var(--color-focus, var(--color-accent-primary));
    outline-offset: -1px;
  }

  /* Per-point delete: faint at rest, brightens to the error color on hover of
     the row or itself. Removes ONLY that mark (not all). */
  .brief-remove {
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0;
    color: var(--color-text-tertiary);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--font-size-meta);
    line-height: 1;
    padding: 0 var(--p-space-2);
    opacity: 0.4;
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
    outline-offset: -1px;
  }

  :global(html[data-motion="reduced"]) .brief-row,
  :global(html[data-motion="reduced"]) .brief-remove {
    transition: none;
  }
</style>
