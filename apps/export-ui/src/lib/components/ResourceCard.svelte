<!--
  ResourceCard — tile for an external resource (link, doc, image reference).

  Spec design §2 row 19. MVP-functional in P4; polish lands in P5.
-->
<script lang="ts">
  import type { RenderEvent } from "../types";

  interface Props {
    event: RenderEvent;
  }

  const { event }: Props = $props();
</script>

<aside class="resource" data-testid="resource-card">
  <p class="eyebrow">Resource</p>
  <p class="title">{event.title ?? "Untitled resource"}</p>
  {#if event.description}
    <p class="description">{event.description}</p>
  {/if}
</aside>

<style>
  .resource {
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--card-radius);
    padding: var(--p-space-4);
    margin: var(--p-space-3) 0;
    border-left: 3px solid var(--color-accent-secondary);
  }

  .eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-accent-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0 0 var(--p-space-1) 0;
    font-weight: 600;
  }

  .title {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
  }

  .description {
    margin: var(--p-space-2) 0 0 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-meta);
    line-height: 1.5;
  }
</style>
