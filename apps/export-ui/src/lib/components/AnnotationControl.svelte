<!--
  AnnotationControl — display-annotations Feature B (ADR-DA-4, ADR-DA-5).

  Per-event annotation trigger + editor. Rendered inside the `.event-anchor`
  wrapper in ChapterPlayer (the single injection site that knows ev.id across
  all event kinds). The trigger button matches the established `.inspector-icon-btn`
  idiom (transparent, low-emphasis, revealed on hover/focus of the anchor). The
  editor is a native <dialog> opened via showModal() — accessible (focus trap +
  Esc-to-close built in), tap-friendly, and proven safe at file:// (ADR-DA-5).

  Reads/writes the shared `annotations` store so saving here lights up the ring,
  the BriefLegend entry, and the Sidebar count through one subscription.
-->
<script lang="ts">
  import {
    annotations,
    TAG_META,
    COLOR_OPTIONS,
    type Annotation,
    type AnnotationTag,
  } from "../stores/annotations";

  interface Props {
    eventId: string;
  }

  const { eventId }: Props = $props();

  const TAGS: AnnotationTag[] = ["milestone", "error", "interesting"];

  // Live view of this event's annotation (undefined when unmarked). Seeded by
  // the subscription below, which fires synchronously on subscribe.
  let current = $state<Annotation | undefined>(undefined);
  $effect(() => {
    const unsub = annotations.subscribe((map) => {
      current = map[eventId];
    });
    return () => unsub();
  });

  // Dialog element + draft fields (seeded from `current` when opened).
  let dialogEl: HTMLDialogElement | undefined = $state();
  let labelEl: HTMLInputElement | undefined = $state();
  let draftLabel = $state("");
  let draftTag = $state<AnnotationTag>("milestone");
  let draftColor = $state(TAG_META.milestone.color);

  function openDialog(): void {
    const existing = annotations.getOne(eventId);
    draftLabel = existing?.label ?? "";
    draftTag = existing?.tag ?? "milestone";
    draftColor = existing?.color ?? TAG_META[draftTag].color;
    dialogEl?.showModal();
    // Focus the label after the dialog paints.
    queueMicrotask(() => labelEl?.focus());
  }

  function pickTag(tag: AnnotationTag): void {
    draftTag = tag;
    // Prefill the color from the tag default; the picker can still override.
    draftColor = TAG_META[tag].color;
  }

  function save(): void {
    const label = draftLabel.trim() || TAG_META[draftTag].label;
    annotations.set({ eventId, label, color: draftColor, tag: draftTag });
    dialogEl?.close();
  }

  function removeAnnotation(): void {
    annotations.remove(eventId);
    dialogEl?.close();
  }
</script>

<button
  type="button"
  class="annotation-trigger"
  class:is-marked={current !== undefined}
  aria-label={current ? "Edit annotation" : "Add annotation"}
  title={current ? "Edit annotation" : "Add annotation"}
  onclick={openDialog}
  data-interactive
  data-testid="annotation-trigger"
>
  {#if current}
    <span class="trigger-glyph" aria-hidden="true" style="color: {current.color};"
      >{TAG_META[current.tag].glyph}</span
    >
  {:else}
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 2.5 H10 L13 5.5 V13.5 L3.5 13.5 Z" />
      <line x1="3.5" y1="5.5" x2="9" y2="5.5" />
    </svg>
  {/if}
</button>

<dialog bind:this={dialogEl} class="annotation-dialog" data-testid="annotation-dialog">
  <form method="dialog" class="dialog-body" onsubmit={(e) => e.preventDefault()}>
    <p class="dialog-title">{current ? "Edit annotation" : "Add annotation"}</p>

    <label class="field">
      <span class="field-label">Label</span>
      <input
        bind:this={labelEl}
        bind:value={draftLabel}
        type="text"
        class="field-input"
        placeholder="e.g. key decision"
        data-testid="annotation-label"
      />
    </label>

    <fieldset class="field">
      <legend class="field-label">Tag</legend>
      <div class="tag-row" role="radiogroup" aria-label="Annotation tag">
        {#each TAGS as tag}
          <button
            type="button"
            class="tag-btn"
            class:is-selected={draftTag === tag}
            role="radio"
            aria-checked={draftTag === tag}
            onclick={() => pickTag(tag)}
            data-testid={`annotation-tag-${tag}`}
          >
            <span class="tag-glyph" aria-hidden="true" style="color: {TAG_META[tag].color};"
              >{TAG_META[tag].glyph}</span
            >
            <span class="tag-text">{TAG_META[tag].label}</span>
          </button>
        {/each}
      </div>
    </fieldset>

    <fieldset class="field">
      <legend class="field-label">Color</legend>
      <div class="color-row" role="radiogroup" aria-label="Annotation color">
        {#each COLOR_OPTIONS as opt}
          <button
            type="button"
            class="color-swatch"
            class:is-selected={draftColor === opt.value}
            role="radio"
            aria-checked={draftColor === opt.value}
            aria-label={opt.label}
            title={opt.label}
            style="background: {opt.value};"
            onclick={() => (draftColor = opt.value)}
            data-testid={`annotation-color-${opt.label}`}
          ></button>
        {/each}
      </div>
    </fieldset>

    <footer class="dialog-footer">
      {#if current}
        <button
          type="button"
          class="lb-ghost-btn"
          data-tone="ghost"
          onclick={removeAnnotation}
          data-testid="annotation-remove"
        >
          Remove
        </button>
      {/if}
      <span class="footer-spacer"></span>
      <button type="button" class="lb-ghost-btn" data-tone="ghost" onclick={() => dialogEl?.close()}>
        Cancel
      </button>
      <button
        type="button"
        class="lb-ghost-btn"
        data-tone="ink"
        onclick={save}
        data-testid="annotation-save"
      >
        Save
      </button>
    </footer>
  </form>
</dialog>

<style>
  /*
   * Trigger mirrors `.inspector-icon-btn` (ClaudeMessageRow): transparent,
   * tertiary text, 4px radius (DESIGN.md sole exception), revealed on
   * hover/focus of the parent `.event-anchor` via a global rule in
   * ChapterPlayer. Restraint motion: 150ms ease, zeroed under reduced-motion.
   */
  .annotation-trigger {
    position: absolute;
    top: var(--p-space-2);
    right: var(--p-space-2);
    z-index: 2;
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    color: var(--color-text-tertiary);
    padding: 4px;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: color 150ms ease-out, background 150ms ease-out,
      border-color 150ms ease-out, opacity 150ms ease-out;
  }

  .annotation-trigger:hover,
  .annotation-trigger:focus-visible {
    color: var(--color-accent-primary);
    background: var(--color-surface-sunken);
    border-color: var(--color-border-hairline);
    opacity: 1;
  }

  .annotation-trigger:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 2px;
  }

  /* Marked events keep the trigger faintly visible so the affordance reads. */
  .annotation-trigger.is-marked {
    opacity: 0.85;
  }

  .trigger-glyph {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
  }

  :global(html[data-motion="reduced"]) .annotation-trigger {
    transition: none;
  }

  /*
   * Dialog — Paper Brutalism: cream surface, 0px corners, 1px ink hairline,
   * hard 4px offset shadow (NO soft shadow, NO blur).
   */
  .annotation-dialog {
    border: 1px solid var(--color-text-primary);
    border-radius: 0;
    background: var(--color-surface);
    color: var(--color-text-primary);
    padding: 0;
    box-shadow: 4px 4px 0 0 var(--color-border-hairline);
    max-width: 340px;
    width: calc(100vw - 2 * var(--p-space-5));
  }

  .annotation-dialog::backdrop {
    background: color-mix(in srgb, var(--color-text-primary) 28%, transparent);
  }

  .dialog-body {
    display: flex;
    flex-direction: column;
    gap: var(--p-space-4);
    padding: var(--p-space-5);
    margin: 0;
  }

  .dialog-title {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 700;
    color: var(--color-text-secondary);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--p-space-2);
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }

  .field-label {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-tertiary);
    padding: 0;
  }

  .field-input {
    appearance: none;
    border: 1px solid var(--color-border-hairline);
    border-radius: 0;
    background: var(--color-surface-raised);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--font-size-meta);
    padding: var(--p-space-2) var(--p-space-3);
  }

  .field-input:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 1px;
    border-color: var(--color-accent-primary);
  }

  .tag-row {
    display: flex;
    gap: var(--p-space-2);
    flex-wrap: wrap;
  }

  .tag-btn {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-hairline);
    border-radius: 0;
    color: var(--color-text-secondary);
    padding: var(--p-space-2) var(--p-space-3);
    cursor: pointer;
    font-family: var(--font-body);
    font-size: var(--font-size-caption);
    transition: border-color 150ms ease-out, color 150ms ease-out,
      background 150ms ease-out;
  }

  .tag-btn:hover,
  .tag-btn:focus-visible {
    color: var(--color-text-primary);
    border-color: var(--color-text-secondary);
  }

  .tag-btn.is-selected {
    border-color: var(--color-text-primary);
    color: var(--color-text-primary);
    background: var(--color-surface-sunken);
  }

  .tag-btn:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 2px;
  }

  .tag-glyph {
    font-family: var(--font-mono);
    font-weight: 700;
    line-height: 1;
  }

  .color-row {
    display: flex;
    gap: var(--p-space-2);
    flex-wrap: wrap;
  }

  .color-swatch {
    width: 28px;
    height: 28px;
    border: 1px solid var(--color-border-hairline);
    border-radius: 0;
    cursor: pointer;
    padding: 0;
    transition: outline-color 150ms ease-out;
  }

  .color-swatch.is-selected {
    outline: 2px solid var(--color-text-primary);
    outline-offset: 2px;
  }

  .color-swatch:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 2px;
  }

  .dialog-footer {
    display: flex;
    align-items: center;
    gap: var(--p-space-2);
  }

  .footer-spacer {
    flex: 1;
  }

  :global(html[data-motion="reduced"]) .tag-btn,
  :global(html[data-motion="reduced"]) .color-swatch,
  :global(html[data-motion="reduced"]) .field-input {
    transition: none;
  }
</style>
