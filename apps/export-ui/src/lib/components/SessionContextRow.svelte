<!--
  SessionContextRow — teaching-faithful view.

  Renders a `session_context` event: the startup context injected by Claude
  Code's SessionStart hooks (engram persistent-memory protocol, LogBook
  SessionStart memory, plugin context, …). This is the FIRST thing that
  happens in a session, so the row is meant to render at the very top of the
  chapter, before the first user prompt.

  The row is a collapsible <details>:
    - Collapsed: 🪝 title + one-line summary of which hooks injected context.
    - Expanded: the full injected text in a scrollable monospace block.

  Paper Brutalism styling matches the surrounding rows (0–6px corners, hard
  drop shadow, hairline violet border, ember-left accent). Motion is a single
  150ms ease, fully disabled under prefers-reduced-motion.

  Accessibility:
    - native <details>/<summary> gives keyboard toggling + aria-expanded
      semantics for free.
    - data-event-id + data-testid for the scrubber + selection sync.
-->
<script lang="ts">
  import type { RenderEvent } from "../types";

  interface Props {
    event: RenderEvent;
  }

  const { event }: Props = $props();

  const evPayload = $derived((event.payload ?? {}) as Record<string, unknown>);

  const summary = $derived(
    typeof evPayload.summary === "string" && evPayload.summary.length > 0
      ? (evPayload.summary as string)
      : "startup context injected at session start",
  );

  const text = $derived(
    typeof evPayload.text === "string" ? (evPayload.text as string) : "",
  );

  const truncated = $derived(evPayload.truncated === true);
  const placeholder = $derived(evPayload.placeholder === true);
</script>

<div
  class="session-context-row lb-snap-target"
  data-testid="session-context-row"
  data-event-id={event.id}
>
  <details class="sc-details">
    <summary class="sc-summary">
      <span class="sc-hook" aria-hidden="true">🪝</span>
      <span class="sc-title">Contexto inyectado al inicio</span>
      <span class="sc-summary-text" dir="auto">{summary}</span>
      <span class="sc-chevron" aria-hidden="true">▸</span>
    </summary>
    <div class="sc-body">
      {#if placeholder}
        <p class="sc-note">
          Parte del contexto se guardó como
          <code>&lt;persisted-output&gt;</code> (demasiado grande para inlinear);
          se muestra lo disponible.
        </p>
      {/if}
      {#if text}
        <pre class="sc-text"><code>{text}</code></pre>
        {#if truncated}
          <p class="sc-note sc-note-trunc">… (texto truncado)</p>
        {/if}
      {:else}
        <p class="sc-note">No injected text captured.</p>
      {/if}
    </div>
  </details>
</div>

<style>
  .session-context-row {
    margin: var(--p-space-3) 0;
  }

  /*
   * Paper Brutalism — startup-context folder.
   *   - 6px corners (DESIGN.md accent radius).
   *   - 3px ember-left accent (matches Claude's bubble anchor).
   *   - 1px hairline violet on the other edges at 22%.
   *   - 3px hard drop shadow, no soft blur.
   */
  .sc-details {
    position: relative;
    background: var(--color-surface-raised);
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 22%, transparent);
    border-left: 3px solid var(--color-accent-primary);
    border-radius: var(--p-radius-accent);
    box-shadow: 3px 3px 0 0 color-mix(in srgb, var(--color-text-primary) 10%, transparent);
  }

  .sc-summary {
    display: flex;
    align-items: center;
    gap: var(--p-space-2);
    padding: var(--p-space-3) var(--p-space-4);
    cursor: pointer;
    list-style: none;
    user-select: none;
  }
  .sc-summary::-webkit-details-marker {
    display: none;
  }
  .sc-summary:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 2px;
  }

  .sc-hook {
    font-size: 1.2em;
    line-height: 1;
    flex-shrink: 0;
  }

  .sc-title {
    font-size: var(--font-size-caption);
    color: var(--color-text-primary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 700;
    flex-shrink: 0;
  }

  .sc-summary-text {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sc-chevron {
    color: var(--color-text-tertiary);
    flex-shrink: 0;
    transition: transform 150ms ease;
  }
  .sc-details[open] .sc-chevron {
    transform: rotate(90deg);
  }

  .sc-body {
    padding: 0 var(--p-space-4) var(--p-space-4);
    border-top: 1px solid color-mix(in srgb, var(--color-text-primary) 12%, transparent);
    padding-top: var(--p-space-3);
  }

  .sc-text {
    margin: 0;
    max-height: 320px;
    overflow: auto;
    background: color-mix(in srgb, var(--color-text-primary) 5%, var(--color-surface-base));
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 12%, transparent);
    border-radius: var(--radius-sm);
    padding: var(--p-space-3);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    line-height: 1.5;
    color: var(--color-text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .sc-note {
    margin: 0 0 var(--p-space-2);
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
  }
  .sc-note-trunc {
    margin: var(--p-space-2) 0 0;
  }

  /* Reduced-motion: chevron snaps, no rotation tween. */
  :global(html[data-motion="reduced"]) .sc-chevron {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .sc-chevron {
      transition: none;
    }
  }
</style>
