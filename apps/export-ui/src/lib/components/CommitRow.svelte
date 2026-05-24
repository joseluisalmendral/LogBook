<!--
  CommitRow — single commit metadata row. Spec design §2 row 21. MVP atom.
-->
<script lang="ts">
  import type { RenderEvent } from "../types";
  import { inspector } from "../stores/inspector";
  import { selection } from "../stores/selection";
  import { router } from "../stores/router";

  interface Props {
    event: RenderEvent;
  }

  const { event }: Props = $props();

  const payload = $derived((event.payload ?? {}) as Record<string, unknown>);
  const sha = $derived(typeof payload.sha === "string" ? payload.sha : "");
  const shortSha = $derived(sha.length > 7 ? sha.slice(0, 7) : sha);
  const message = $derived(typeof payload.message === "string" ? payload.message : (event.title ?? ""));
  const author = $derived(typeof payload.author === "string" ? payload.author : "");
  // Slice-12 P3 (R-60, R-61, ADR-SC-C1): server-built commit URL. When present
  // the SHA renders as a target=_blank anchor; otherwise as plain <code>.
  const commitUrl = $derived(
    typeof payload.commitUrl === "string" ? payload.commitUrl : "",
  );

  function open(): void {
    inspector.open(event.id);
    // Slice-12 P7 (R-68): emit selection + URL hash query for transcript sync.
    const route = router.get();
    if (route.name === "chapter") {
      selection._setFromRoute("chapter", event.id);
      router.navigate({ name: "chapter", chapterId: route.chapterId, eventId: event.id });
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  }
</script>

<div
  class="commit-row lb-snap-target"
  data-testid="commit-row"
  data-event-id={event.id}
  data-interactive
  role="button"
  tabindex="0"
  aria-label={`Open commit ${shortSha || event.id}`}
  onclick={open}
  onkeydown={onKey}
>
  {#if shortSha}
    {#if commitUrl}
      <a
        class="sha sha-link lb-tnum"
        href={commitUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open commit ${shortSha} on remote`}
        onclick={(e) => e.stopPropagation()}
        data-deep-link="commit"
        data-testid="commit-sha-link"
      >{shortSha}</a>
    {:else}
      <code class="sha lb-tnum">{shortSha}</code>
    {/if}
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

  /* Slice 12 P3: anchor variant — same chip surface, native link semantics. */
  .sha-link {
    text-decoration: none;
    cursor: pointer;
    transition: background 150ms ease, color 150ms ease;
  }
  .sha-link:hover,
  .sha-link:focus-visible {
    background: var(--color-accent-primary);
    color: var(--color-surface-sunken);
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
