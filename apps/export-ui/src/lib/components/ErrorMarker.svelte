<!--
  ErrorMarker — red-accent event row. Click expands description + linked fix
  reference inline.

  Spec design §2 row 12. The brick-red accent is reserved exclusively for
  errors / blocks so the student's eye learns to skip them when scanning a
  chapter for high-level structure.
-->
<script lang="ts">
  import type { RenderEvent } from "../types";
  import { inspector } from "../stores/inspector";

  interface Props {
    event: RenderEvent;
  }

  const { event }: Props = $props();

  let expanded = $state(false);

  function toggle(e: MouseEvent): void {
    expanded = !expanded;
    e.stopPropagation();
  }

  function openInspector(): void {
    inspector.open(event.id);
  }
</script>

<article class="error" data-testid="error-marker">
  <!--
    Row uses role=button so the inner expand <button> isn't a button-in-button.
    Keyboard activation (Enter/Space) is preserved via onkeydown.
  -->
  <div
    class="error-row"
    role="button"
    tabindex="0"
    data-interactive
    onclick={openInspector}
    onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openInspector(); } }}
  >
    <span class="marker" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <line x1="3" y1="3" x2="13" y2="13" />
        <line x1="13" y1="3" x2="3" y2="13" />
      </svg>
    </span>
    <span class="content">
      <span class="eyebrow">Error</span>
      <span class="title">{event.title ?? "Untitled error"}</span>
    </span>
    {#if event.description}
      <button
        type="button"
        class="expand-btn"
        aria-expanded={expanded}
        onclick={toggle}
        aria-label="Toggle details"
      >
        {expanded ? "−" : "+"}
      </button>
    {/if}
  </div>
  {#if expanded && event.description}
    <p class="error-desc">{event.description}</p>
  {/if}
</article>

<style>
  .error {
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-hairline);
    border-left: 3px solid var(--color-error);
    border-radius: var(--card-radius);
    padding: var(--p-space-3) var(--p-space-4);
    margin: var(--p-space-3) 0;
  }

  .error-row {
    width: 100%;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
    color: inherit;
  }

  .marker {
    width: 22px;
    height: 22px;
    background: color-mix(in srgb, var(--color-error) 14%, transparent);
    color: var(--color-error);
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-error);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }

  .title {
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    line-height: 1.4;
  }

  .expand-btn {
    appearance: none;
    background: transparent;
    border: 1px solid var(--color-border-hairline);
    color: var(--color-text-secondary);
    width: 24px;
    height: 24px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .error-desc {
    margin: var(--p-space-3) 0 0 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-meta);
    line-height: 1.6;
    padding-left: calc(22px + var(--p-space-3));
  }
</style>
