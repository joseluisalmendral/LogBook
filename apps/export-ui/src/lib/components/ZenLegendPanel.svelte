<!--
  ZenLegendPanel — floating legend + marked-points panel for Zen mode.

  In Zen mode the sidebar and TimelineScrubber (which normally host the
  Full/Brief legend) are hidden by global CSS. The instructor still wants the
  legend visible and their MARKED annotation points reachable to jump to them
  during a class. This panel restores both as a small floating element anchored
  bottom-left (out of the way of the top-right Exit-Zen button and the
  bottom-right back-to-top button).

  Reuse-only contract: this component embeds LegendKey + BriefLegend WITHOUT
  modifying them. It owns local `legendView` (default "brief" so the marked
  points surface first in class) and a local `collapsed` boolean. When
  collapsed it renders only a small chip; clicking the chip restores the panel.

  Mounted by ChapterPlayer inside `{#if zen}` so it only exists in Zen mode.

  Positioning note: the panel is `position: fixed`, but Zen mode applies a
  `transform` to an ancestor (`.chapter-player`), which would make that ancestor
  the containing block for fixed descendants and pin the panel to the (very
  tall) chapter element instead of the viewport. To stay viewport-anchored, the
  outer wrapper is portaled to `<body>` via the `portal` action so no ancestor
  transform can capture it.
-->
<script lang="ts">
  import LegendKey from "./LegendKey.svelte";
  import BriefLegend from "./BriefLegend.svelte";

  // display-annotations: Full (8-kind legend) vs Brief (annotated points only).
  // Default Brief in Zen: in class the instructor mostly wants their marked
  // points first. NOT persisted (mirrors the scrubber, ADR-DA-8).
  let legendView = $state<"full" | "brief">("brief");

  // Collapse the whole panel down to a single chip.
  let collapsed = $state(false);

  // Bound to the expanded panel <section> so the window click handler can tell
  // an inside-click (keep open) from an outside-click (collapse).
  let panelEl = $state<HTMLElement | undefined>(undefined);

  /**
   * Click-anywhere-outside collapses the panel back to the chip. The panel is
   * portaled to <body>, so inside-clicks do NOT bubble through Svelte ancestors
   * — a window-level listener is the only reliable place to catch this.
   *
   * The chip's own onclick calls stopPropagation, so the click that OPENS the
   * panel never reaches this handler and cannot immediately re-collapse it.
   */
  function handleWindowClick(event: MouseEvent): void {
    if (collapsed || !panelEl) return;
    const target = event.target as Node | null;
    if (target && !panelEl.contains(target)) {
      collapsed = true;
    }
  }

  /**
   * Relocate the node to <body> so `position: fixed` resolves against the
   * viewport, not an ancestor with a `transform` (Zen mode transforms
   * `.chapter-player`, which otherwise becomes the containing block).
   */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="zen-legend-portal" use:portal>
  {#if collapsed}
  <button
    type="button"
    class="zen-legend-chip"
    data-testid="zen-legend-chip"
    aria-label="Show legend panel"
    title="Show legend"
    onclick={(e) => {
      e.stopPropagation();
      collapsed = false;
    }}
  >
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <line x1="3" y1="4" x2="13" y2="4" />
      <line x1="3" y1="8" x2="13" y2="8" />
      <line x1="3" y1="12" x2="13" y2="12" />
    </svg>
    <span class="zen-legend-chip-label">Legend</span>
  </button>
{:else}
  <section
    bind:this={panelEl}
    class="zen-legend-panel"
    data-testid="zen-legend-panel"
    aria-label="Legend and marked points"
  >
    <header class="zen-legend-head">
      <div class="legend-views" role="group" aria-label="Legend view">
        <button
          type="button"
          class="legend-view-btn"
          class:is-active={legendView === "full"}
          aria-pressed={legendView === "full"}
          onclick={() => (legendView = "full")}
          data-testid="zen-legend-view-full"
        >
          Full
        </button>
        <button
          type="button"
          class="legend-view-btn"
          class:is-active={legendView === "brief"}
          aria-pressed={legendView === "brief"}
          onclick={() => (legendView = "brief")}
          data-testid="zen-legend-view-brief"
        >
          Brief
        </button>
      </div>
      <button
        type="button"
        class="zen-legend-collapse"
        data-testid="zen-legend-collapse"
        aria-label="Hide legend panel"
        title="Hide legend"
        onclick={() => (collapsed = true)}
      >
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
      </button>
    </header>

    <div class="zen-legend-body">
      {#if legendView === "full"}
        <LegendKey variant="inline" />
      {:else}
        <BriefLegend variant="inline" />
      {/if}
    </div>
  </section>
  {/if}
</div>

<style>
  .zen-legend-panel {
    position: fixed;
    bottom: var(--p-space-4);
    left: var(--p-space-4);
    z-index: 45; /* between back-to-top (40) and Exit-Zen (50) */
    display: flex;
    flex-direction: column;
    gap: var(--p-space-2);
    max-width: 360px;
    max-height: 60vh;
    box-sizing: border-box;
    padding: var(--p-space-3);
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--radius-sm);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
    animation: zen-legend-in 150ms ease-out;
  }

  .zen-legend-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--p-space-3);
    flex-shrink: 0;
  }

  .zen-legend-body {
    overflow-y: auto;
    min-height: 0;
  }

  /* Segmented Full/Brief toggle — same pattern as the scrubber legend host. */
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

  /* Collapse button: minimal ghost icon button matching the toggle language. */
  .zen-legend-collapse {
    appearance: none;
    background: transparent;
    border: 1px solid var(--color-border-hairline);
    color: var(--color-text-tertiary);
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 150ms ease-out, background 150ms ease-out, border-color 150ms ease-out;
  }

  .zen-legend-collapse:hover,
  .zen-legend-collapse:focus-visible {
    color: var(--color-text-primary);
    background: var(--color-surface-sunken);
  }

  .zen-legend-collapse:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 2px;
  }

  /* Collapsed chip — same fixed anchor as the panel. */
  .zen-legend-chip {
    position: fixed;
    bottom: var(--p-space-4);
    left: var(--p-space-4);
    z-index: 45;
    display: inline-flex;
    align-items: center;
    gap: var(--p-space-2);
    padding: 8px 12px;
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
    transition: background 150ms ease-out, color 150ms ease-out, border-color 150ms ease-out;
    animation: zen-legend-in 150ms ease-out;
  }

  .zen-legend-chip:hover {
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--color-accent-primary) 8%, var(--color-surface-raised));
    border-color: color-mix(in srgb, var(--color-accent-primary) 40%, var(--color-border-hairline));
  }

  .zen-legend-chip:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 3px;
  }

  .zen-legend-chip-label {
    line-height: 1;
  }

  @keyframes zen-legend-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* On small screens, keep within bounds and lower the max-height so the panel
     never eats the whole viewport. */
  @media (max-width: 767px) {
    .zen-legend-panel {
      max-width: calc(100vw - 2 * var(--p-space-4));
      max-height: 50vh;
    }
  }

  :global(html[data-motion="reduced"]) .zen-legend-panel,
  :global(html[data-motion="reduced"]) .zen-legend-chip {
    animation: none;
  }

  :global(html[data-motion="reduced"]) .legend-view-btn,
  :global(html[data-motion="reduced"]) .zen-legend-collapse,
  :global(html[data-motion="reduced"]) .zen-legend-chip {
    transition: none;
  }
</style>
