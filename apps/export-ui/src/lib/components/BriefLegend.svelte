<!--
  BriefLegend — display-annotations Feature B (ADR-DA-7).

  Renders the instructor's marked points as a scannable, ordered, reorderable
  list: a drag grip, a tabular index, the tag glyph in the annotation color, the
  label, and a per-row delete. Default sort is CONVERSATION order (payload
  position); the instructor can drag rows into a custom order (persisted via the
  shared `briefOrder` store) and reset back to conversation order.

  Clicking a row navigates to the owning chapter via the SAME router + selection
  plumbing SubAgentIndex uses, then RETRIES the scroll until the target paints —
  so it works for a mark in the current chapter AND for one in another chapter
  (which remounts ChapterPlayer before the target exists). The one-shot
  acknowledge pulse (.lb-pulse-once) fires; never the looping heartbeat.

  Subscribes to the shared `annotations` + `briefOrder` stores, so it re-renders
  whenever a mark or the order changes. Both BriefLegend instances (scrubber +
  Zen panel) stay in sync.
-->
<script lang="ts">
  import {
    annotations,
    activeLegendId,
    briefOrder,
    TAG_META,
    type Annotation,
    type AnnotationMap,
  } from "../stores/annotations";
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

  function sortChrono(list: Annotation[]): Annotation[] {
    return [...list].sort((a, b) => {
      const oa = eventOrder.get(a.eventId) ?? Number.MAX_SAFE_INTEGER;
      const ob = eventOrder.get(b.eventId) ?? Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });
  }

  // Apply the custom order if present: listed ids lead (in that order), the rest
  // trail in conversation order.
  function orderItems(map: AnnotationMap, custom: string[]): Annotation[] {
    const chrono = sortChrono(Object.values(map));
    if (custom.length === 0) return chrono;
    const idx = new Map(custom.map((id, i) => [id, i] as const));
    return chrono
      .map((a, ci) => ({ a, rank: idx.has(a.eventId) ? (idx.get(a.eventId) as number) : custom.length + ci }))
      .sort((x, y) => x.rank - y.rank)
      .map((x) => x.a);
  }

  interface Props {
    /** Layout variant. Mirrors LegendKey. */
    variant?: "inline" | "mobile";
  }

  const { variant = "inline" }: Props = $props();

  let map = $state<AnnotationMap>(annotations.get());
  $effect(() => {
    const unsub = annotations.subscribe((m) => {
      map = m;
    });
    return () => unsub();
  });

  let customOrder = $state<string[]>(briefOrder.get());
  $effect(() => {
    const unsub = briefOrder.subscribe((o) => {
      customOrder = o;
    });
    return () => unsub();
  });

  const items = $derived(orderItems(map, customOrder));

  // Last-clicked row, shared across BOTH BriefLegend instances.
  let activeId = $state<string | null>(activeLegendId.get());
  $effect(() => {
    const unsub = activeLegendId.subscribe((id) => {
      activeId = id;
    });
    return () => unsub();
  });

  function doScroll(eventId: string): void {
    const el = typeof document !== "undefined" ? document.getElementById(`event-${eventId}`) : null;
    if (!el) return;
    // Smooth so the audience SEES the travel and doesn't lose context (a class
    // affordance). The earlier "erratic overshoot" was a DOUBLE scroll (navigate
    // re-firing ChapterPlayer's subscriber); now same-chapter does ONE scroll,
    // so a single smooth animation lands cleanly. Reduced-motion → instant.
    const motionAllowed = getMotionState().motionAllowed;
    el.scrollIntoView({ behavior: motionAllowed ? "smooth" : "instant", block: "center" });
  }

  // After navigation the target may not be painted yet (cross-chapter remount).
  // Retry on animation frames until it exists, then scroll. Bounded (~40 frames).
  function scrollWhenReady(eventId: string, tries = 0): void {
    if (typeof document === "undefined") return;
    const el = document.getElementById(`event-${eventId}`);
    if (el) {
      doScroll(eventId);
      return;
    }
    if (tries >= 40) return;
    requestAnimationFrame(() => scrollWhenReady(eventId, tries + 1));
  }

  function scrollTo(eventId: string): void {
    activeLegendId.set(eventId);
    const route = router.get();
    const ownerChapterId =
      eventChapter.get(eventId) ?? (route.name === "chapter" ? route.chapterId : null);
    const sameChapter = route.name === "chapter" && ownerChapterId === route.chapterId;

    if (ownerChapterId && !sameChapter) {
      // Cross-chapter: remount the owning chapter, then scroll once it paints.
      selection._setFromRoute("chapter", eventId);
      router.navigate({ name: "chapter", chapterId: ownerChapterId, eventId });
      scrollWhenReady(eventId);
      return;
    }

    // Same chapter (the common case): a SINGLE direct scroll. We deliberately do
    // NOT router.navigate here — navigating to the chapter we're already on
    // re-fires ChapterPlayer's selection subscriber, which ALSO scrolls, and the
    // two animations fight (visible as an erratic overshoot that never lands on
    // the point). One scroll lands cleanly on the target.
    doScroll(eventId);
  }

  function removeMark(eventId: string): void {
    annotations.remove(eventId);
    if (activeLegendId.get() === eventId) activeLegendId.set(null);
  }

  // --- Drag & drop reorder (native HTML5 DnD; file://-safe, no deps) ---------
  let draggedId = $state<string | null>(null);
  let dragOverIndex = $state<number | null>(null);

  function onDragStart(e: DragEvent, id: string): void {
    draggedId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", id);
      } catch {
        // Some engines disallow setData on synthetic events — ignore.
      }
    }
  }

  function onDragOver(e: DragEvent, i: number): void {
    if (draggedId === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dragOverIndex = i;
  }

  function onDrop(e: DragEvent, i: number): void {
    e.preventDefault();
    if (draggedId !== null) reorder(draggedId, i);
    draggedId = null;
    dragOverIndex = null;
  }

  function onDragEnd(): void {
    draggedId = null;
    dragOverIndex = null;
  }

  function reorder(id: string, targetIndex: number): void {
    const ids = items.map((it) => it.eventId);
    const from = ids.indexOf(id);
    if (from === -1) return;
    ids.splice(from, 1);
    ids.splice(targetIndex, 0, id);
    briefOrder.set(ids);
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
        <li
          class="brief-item"
          class:is-drop-target={dragOverIndex === i}
          ondragover={(e) => onDragOver(e, i)}
          ondrop={(e) => onDrop(e, i)}
        >
          <span
            class="brief-grip"
            draggable="true"
            role="button"
            tabindex="-1"
            aria-label="Drag to reorder this point"
            title="Drag to reorder"
            ondragstart={(e) => onDragStart(e, item.eventId)}
            ondragend={onDragEnd}
            data-testid="brief-grip">⠿</span
          >
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
            data-testid="brief-remove">×</button
          >
        </li>
      {/each}
    </ol>
    {#if customOrder.length > 0}
      <button
        type="button"
        class="brief-reset"
        onclick={() => briefOrder.clear()}
        title="Revert to conversation order"
        data-testid="brief-reset"
      >↕ Conversation order</button>
    {/if}
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

  /* Vertical, table-like list. One mark per row; hairline separators give the
     "ledger" order. Capped height with a thin scroll so it grows but stays
     usable. */
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

  .brief-legend[data-variant="inline"] .brief-list {
    min-width: 16rem;
  }

  .brief-item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto; /* grip | row | delete */
    align-items: stretch;
    min-width: 0;
    border-bottom: 1px solid var(--color-border-hairline);
  }

  .brief-item:last-child {
    border-bottom: 0;
  }

  /* Drop indicator: a hard accent bar on the row's top edge. */
  .brief-item.is-drop-target {
    box-shadow: inset 0 2px 0 0 var(--color-accent-primary);
  }

  /* Drag grip: faint at rest, brighter on row hover. grab/grabbing cursor. */
  .brief-grip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    line-height: 1;
    color: var(--color-text-tertiary);
    cursor: grab;
    padding: 0 var(--p-space-1);
    opacity: 0.3;
    user-select: none;
    transition: opacity 150ms ease-out, color 150ms ease-out;
  }

  .brief-item:hover .brief-grip {
    opacity: 0.8;
  }

  .brief-grip:active {
    cursor: grabbing;
  }

  /* Aligned columns: right-aligned tabular index, fixed-width glyph, then the
     label. Identical track sizing on every row keeps glyphs + labels in
     vertical alignment — the core scannability win. */
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

  /* Last-clicked marked point: STATIC sunken surface + hard left accent bar
     (inset shadow → no layout shift) + accent/bold index. No animation; a
     distinct class name avoids the global `.is-active` heartbeat loop. */
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

  /* Per-point delete. */
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

  /* Reset-to-conversation-order: subtle text button shown only when a custom
     order is active. */
  .brief-reset {
    appearance: none;
    background: transparent;
    border: 0;
    cursor: pointer;
    display: block;
    width: 100%;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--font-size-meta);
    color: var(--color-text-tertiary);
    padding: var(--p-space-2);
    transition: color 150ms ease-out;
  }

  .brief-reset:hover,
  .brief-reset:focus-visible {
    color: var(--color-text-primary);
  }

  :global(html[data-motion="reduced"]) .brief-row,
  :global(html[data-motion="reduced"]) .brief-remove,
  :global(html[data-motion="reduced"]) .brief-grip {
    transition: none;
  }
</style>
