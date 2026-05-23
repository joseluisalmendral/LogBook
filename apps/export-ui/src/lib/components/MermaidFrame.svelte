<!--
  MermaidFrame — pre-rendered SVG host for mermaid diagrams.

  Spec R-15 / S-15. Diagrams are pre-rendered at export time (src/export/mermaid.ts).
  At runtime, mermaid is NOT loaded — we just splat the sanitized SVG into a
  themed container. The SVG's `currentColor` strokes pick up our text-primary
  token so the diagram re-skins on theme toggle without storing two SVGs.

  P2 stubbed payload.mermaid to an empty map; when no diagram is found we
  render a small "no diagrams" notice instead of crashing.
-->
<script lang="ts">
  import { payload } from "../stores/data";

  interface Props {
    diagramId: string;
    caption?: string;
  }

  const { diagramId, caption }: Props = $props();

  const svg = $derived(payload.mermaid[diagramId]);
</script>

<figure class="mermaid-frame" data-testid="mermaid-frame">
  {#if svg}
    <div class="svg-host">{@html svg}</div>
  {:else}
    <div class="svg-empty">
      <p class="empty-eyebrow">Diagram</p>
      <p class="empty-msg">
        No pre-rendered SVG for <code>{diagramId}</code> in this export.
      </p>
    </div>
  {/if}
  {#if caption}
    <figcaption>{caption}</figcaption>
  {/if}
</figure>

<style>
  .mermaid-frame {
    margin: var(--p-space-4) 0;
    color: var(--color-text-primary);
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--card-radius);
    padding: var(--p-space-4);
  }

  .svg-host {
    color: var(--color-text-primary);
    overflow-x: auto;
  }

  .svg-host :global(svg) {
    max-width: 100%;
    height: auto;
  }

  .svg-empty {
    background: var(--color-surface-sunken);
    border-radius: var(--radius-sm);
    padding: var(--p-space-5);
    text-align: center;
    color: var(--color-text-secondary);
  }

  .empty-eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0 0 var(--p-space-2) 0;
  }

  .empty-msg {
    margin: 0;
    font-size: var(--font-size-meta);
  }

  figcaption {
    margin-top: var(--p-space-3);
    font-style: italic;
    color: var(--color-text-secondary);
    font-size: var(--font-size-meta);
    text-align: center;
  }
</style>
