<!--
  BriefLegend — display-annotations Feature B (ADR-DA-7).

  Sibling to LegendKey (NOT a mode prop on it — the LegendKey 8-chip contract is
  preserved untouched). The Full/Brief toggle lives in the scrubber/mobile host;
  this component renders ONLY the user-annotated events, each row showing the
  tag glyph in the annotation color + the label. Clicking a row scrolls to the
  matching `#event-{id}` anchor (respecting reduced-motion via the motion store).

  Subscribes to the shared `annotations` store, so it re-renders the moment an
  annotation is added, edited, removed, or cleared.
-->
<script lang="ts">
  import { annotations, activeLegendId, TAG_META, type Annotation } from "../stores/annotations";
  import { getMotionState } from "../stores/motion";

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
    const el = document.getElementById(`event-${eventId}`);
    if (!el) return;
    const motionAllowed = getMotionState().motionAllowed;
    el.scrollIntoView({ behavior: motionAllowed ? "smooth" : "auto", block: "center" });
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
            class:is-active={activeId === item.eventId}
            onclick={() => scrollTo(item.eventId)}
            data-testid="brief-entry"
          >
            <span class="brief-glyph" aria-hidden="true" style="color: {item.color};"
              >{TAG_META[item.tag].glyph}</span
            >
            <span class="brief-label">{item.label}</span>
          </button>
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
  }

  .brief-row {
    appearance: none;
    background: transparent;
    border: 0;
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

  /* Last-clicked marked point stays highlighted (Paper Brutalism: sunken
     surface + bold label + hard left accent border, no soft shadow). */
  .brief-row.is-active {
    color: var(--color-text-primary);
    background: var(--color-surface-sunken);
    box-shadow: inset 2px 0 0 0 var(--color-accent-primary);
    font-weight: 700;
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
