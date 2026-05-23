<!--
  EmptyState — placeholder atom for empty buckets.

  Spec design §2 row 23. Used by chapter renderers when there are no events,
  by CourseTOC fallback, by PromptInspector when no body present.

  Visual register: editorial / quiet. NOT a "nothing here!" exclamation —
  more like a captioned dash that says "this section is intentionally light".
-->
<script lang="ts">
  interface Props {
    title: string;
    hint?: string;
  }

  const { title, hint }: Props = $props();
</script>

<div class="empty-state" role="status" data-testid="empty-state">
  <p class="es-title">{title}</p>
  {#if hint}
    <p class="es-hint">{hint}</p>
  {/if}
</div>

<style>
  .empty-state {
    background: var(--color-surface-raised);
    border: 1px dashed var(--color-border-hairline);
    border-radius: var(--card-radius);
    padding: var(--p-space-6);
    text-align: center;
    color: var(--color-text-secondary);
  }

  .es-title {
    font-family: var(--font-headline);
    font-size: var(--font-size-lead);
    color: var(--color-text-primary);
    margin: 0 0 var(--p-space-2) 0;
  }

  .es-hint {
    margin: 0;
    font-size: var(--font-size-meta);
    color: var(--color-text-secondary);
    font-style: italic;
  }
</style>
