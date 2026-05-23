<!--
  CommitRow — single commit metadata row. Spec design §2 row 21. MVP atom.
-->
<script lang="ts">
  import type { RenderEvent } from "../types";

  interface Props {
    event: RenderEvent;
  }

  const { event }: Props = $props();

  const payload = $derived((event.payload ?? {}) as Record<string, unknown>);
  const sha = $derived(typeof payload.sha === "string" ? payload.sha : "");
  const shortSha = $derived(sha.length > 7 ? sha.slice(0, 7) : sha);
  const message = $derived(typeof payload.message === "string" ? payload.message : (event.title ?? ""));
  const author = $derived(typeof payload.author === "string" ? payload.author : "");
</script>

<div class="commit-row" data-testid="commit-row">
  {#if shortSha}
    <code class="sha lb-tnum">{shortSha}</code>
  {/if}
  <span class="message">{message}</span>
  {#if author}
    <span class="author">{author}</span>
  {/if}
</div>

<style>
  .commit-row {
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
    padding: var(--p-space-2) var(--p-space-3);
    font-size: var(--font-size-meta);
    border-bottom: 1px solid var(--color-border-hairline);
  }

  .commit-row:last-child {
    border-bottom: 0;
  }

  .sha {
    background: var(--color-surface-sunken);
    color: var(--color-accent-primary);
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
  }

  .message {
    flex: 1;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .author {
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
  }
</style>
