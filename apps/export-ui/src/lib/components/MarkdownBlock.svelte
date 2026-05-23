<!--
  MarkdownBlock — sanitized HTML body renderer.

  INV-11: bodies arrive PRE-sanitized from buildExportPayload(). No Markdown
  parsing happens at runtime, no DOMPurify on the client. We just splat the
  HTML into a typography-tuned wrapper.

  Why a wrapper component? Two reasons:
    1. Centralize the reading-column typography so every body gets the same
       max-width, line-height, hairline borders on blockquotes, etc.
    2. Provide a single point to add visual decoration (e.g. drop caps) later
       without touching every consumer.

  The `body` prop comes from payload.bodies[eventId]. When undefined or empty,
  this component renders nothing (no fallback message — the caller decides).
-->
<script lang="ts">
  interface Props {
    body?: string;
  }

  const { body }: Props = $props();

  const hasContent = $derived(typeof body === "string" && body.trim().length > 0);
</script>

{#if hasContent}
  <div class="md-block" data-testid="markdown-block">
    {@html body}
  </div>
{/if}

<style>
  .md-block {
    color: var(--color-text-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-body);
    line-height: 1.6;
    max-width: var(--reading-max-width);
  }

  .md-block :global(p) {
    margin: 0 0 var(--p-space-4) 0;
  }
  .md-block :global(p:last-child) {
    margin-bottom: 0;
  }

  .md-block :global(strong) {
    color: var(--color-text-primary);
    font-weight: 600;
  }

  .md-block :global(em) {
    font-style: italic;
    color: var(--color-text-secondary);
  }

  .md-block :global(code) {
    background: var(--color-surface-sunken);
    color: var(--color-text-primary);
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    font-size: 0.92em;
    font-family: var(--font-mono);
  }

  .md-block :global(pre) {
    background: var(--color-surface-sunken);
    border: var(--card-border);
    border-radius: var(--radius-sm);
    padding: var(--p-space-4);
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--font-size-meta);
    margin: 0 0 var(--p-space-4) 0;
  }

  .md-block :global(blockquote) {
    border-left: 3px solid var(--color-accent-primary);
    margin: 0 0 var(--p-space-4) 0;
    padding: 0 0 0 var(--p-space-4);
    color: var(--color-text-secondary);
    font-style: italic;
  }

  .md-block :global(ul),
  .md-block :global(ol) {
    margin: 0 0 var(--p-space-4) var(--p-space-4);
    padding: 0;
  }

  .md-block :global(li) {
    margin: 0 0 var(--p-space-2) 0;
  }

  .md-block :global(a) {
    color: var(--color-accent-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-thickness: 1px;
  }
  .md-block :global(a:hover) {
    text-decoration-thickness: 2px;
  }
</style>
