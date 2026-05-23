<!--
  TranscriptRow — fixed-height row inside the virtualized RawTranscriptView.

  Spec R-66 + INV-18 (slice 12 P5):
    - role monogram (▽ user / △ assistant / ⟳ tool / • system)
    - relative timestamp (HH:MM:SS.mmm vs. session start)
    - type badge
    - tool name (when present)
    - one-line truncated content preview (≤ 80 chars)
    - colored left-border via role/type classes
    - active row gets `is-active` class which the parent toggles when
      selection.transcriptEventId matches the row id.

  Click anywhere on the row → calls the parent's `onSelect(event.id)` callback
  which (a) writes the selection store via the router, and (b) toggles a local
  `expanded` flag for inline content reveal (still capped to the event's 4KB
  sanitized content — bounded by P4).

  Height: 56px at rest. Expanded grows to fit content but the parent treats
  the row as fixed-height for virtualization (expansion is purely visual; the
  scroll budget is unchanged because expanded body is rendered inside an
  overflowing slot below the row's static 56px frame).
-->
<script lang="ts">
  import type { SanitizedTranscriptEvent } from "../types";

  interface Props {
    event: SanitizedTranscriptEvent;
    sessionStart: number;
    active: boolean;
    expanded: boolean;
    onSelect: (eventId: string) => void;
  }

  const { event, sessionStart, active, expanded, onSelect }: Props = $props();

  const monogram = $derived.by(() => {
    switch (event.role) {
      case "user":
        return "▽";
      case "assistant":
        return "△";
      case "tool":
        return "⟳";
      case "system":
      default:
        return "•";
    }
  });

  /** HH:MM:SS.mmm relative to the session start. */
  const relTimestamp = $derived.by(() => {
    const dt = Math.max(0, event.timestamp - sessionStart);
    const hours = Math.floor(dt / 3_600_000);
    const minutes = Math.floor((dt % 3_600_000) / 60_000);
    const seconds = Math.floor((dt % 60_000) / 1000);
    const millis = dt % 1000;
    return (
      String(hours).padStart(2, "0") +
      ":" +
      String(minutes).padStart(2, "0") +
      ":" +
      String(seconds).padStart(2, "0") +
      "." +
      String(millis).padStart(3, "0")
    );
  });

  /** First 80 chars on a single line (newlines collapsed). */
  const preview = $derived.by(() => {
    const flat = event.content.replace(/\s+/g, " ").trim();
    return flat.length > 80 ? flat.slice(0, 80) + "…" : flat;
  });

  function handleClick(): void {
    onSelect(event.id);
  }
</script>

<div
  class="transcript-row"
  class:is-active={active}
  class:is-expanded={expanded}
  data-role={event.role}
  data-type={event.type}
  data-event-id={event.id}
  role="listitem"
>
  <button
    type="button"
    class="row-trigger"
    onclick={handleClick}
    data-interactive
    aria-expanded={expanded}
  >
    <span class="row-monogram" aria-hidden="true">{monogram}</span>
    <time class="row-ts lb-tnum" datetime={String(event.timestamp)}>{relTimestamp}</time>
    <span class="row-badge">{event.type}</span>
    {#if event.name}
      <span class="row-name">{event.name}</span>
    {/if}
    <span class="row-preview">{preview}</span>
    {#if event.truncated}
      <span class="row-truncated" title="Content was truncated to 4KB during sanitization">⤵</span>
    {/if}
  </button>

  {#if expanded}
    <pre class="row-full">{event.content}</pre>
  {/if}
</div>

<style>
  .transcript-row {
    /* Fixed-height frame for the virtualizer. Expansion grows below the frame
       visually, but the row's CONCEPTUAL position is locked. */
    min-height: 56px;
    display: flex;
    flex-direction: column;
    background: transparent;
    border-left: 3px solid transparent;
    transition: background-color 150ms ease-out, border-color 150ms ease-out;
  }

  /* Role-based left border (INV-18 register containment via monospace + sunken
     surface lives on the parent; the row carries the kind colour). */
  .transcript-row[data-role="user"] {
    border-left-color: var(--color-info, #6ea3ff);
  }
  .transcript-row[data-role="assistant"] {
    border-left-color: var(--color-accent-primary);
  }
  .transcript-row[data-role="tool"] {
    border-left-color: var(--color-warning, #d4a017);
  }
  .transcript-row[data-role="system"] {
    border-left-color: var(--color-text-tertiary);
  }

  .transcript-row.is-active {
    background: rgba(var(--brand-rgb, 38, 67, 124), 0.06);
    border-left-color: var(--color-accent-primary);
  }

  .transcript-row:hover {
    background: rgba(var(--brand-rgb, 38, 67, 124), 0.04);
  }

  .row-trigger {
    appearance: none;
    background: transparent;
    border: 0;
    text-align: left;
    width: 100%;
    height: 56px;
    padding: 0 var(--p-space-4);
    display: grid;
    grid-template-columns: 24px 88px 96px auto 1fr 16px;
    gap: var(--p-space-3);
    align-items: center;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--font-size-meta);
    color: var(--color-text-primary);
  }

  .row-trigger:focus-visible {
    outline: 1px solid var(--color-accent-primary);
    outline-offset: -1px;
  }

  .row-monogram {
    font-size: 14px;
    text-align: center;
    color: var(--color-text-secondary);
  }

  .row-ts {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    white-space: nowrap;
  }

  .row-badge {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 2px 6px;
    border-radius: var(--radius-xs);
    background: var(--color-surface-raised);
    white-space: nowrap;
    justify-self: start;
  }

  .row-name {
    color: var(--color-accent-primary);
    font-size: var(--font-size-caption);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
  }

  .row-preview {
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .row-truncated {
    color: var(--color-warning, #d4a017);
    font-size: 14px;
    text-align: center;
  }

  .row-full {
    /* Expanded body — already capped at 4KB by P4 sanitizer. */
    margin: 0;
    padding: var(--p-space-3) var(--p-space-4) var(--p-space-4) calc(var(--p-space-4) + 24px + var(--p-space-3));
    background: var(--color-surface-sunken);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    white-space: pre-wrap;
    word-break: break-word;
    border-top: 1px solid var(--color-border-hairline);
    max-height: 320px;
    overflow-y: auto;
  }

  :global(html[data-motion="reduced"]) .transcript-row {
    transition: none !important;
  }
</style>
