<!--
  SortControl — 3-state segmented control for the course TOC sort.

  Spec R-18: phase | chrono-asc | chrono-desc. Default phase. Visually
  distinct from theme toggle (it's a horizontal segmented strip, not a
  square button).

  Keyboard: each segment is a <button> in a role="radiogroup" wrapper.
  Arrow keys move focus + selection within the group. Enter activates
  (browser default for buttons). aria-pressed shows the active segment.

  We use the store.cycle() pattern when a user clicks the whole control's
  active segment a second time (no-op), but each segment can also be
  selected directly — explicit is friendlier than cycle-only when there
  are only three options.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { tocSort, type TocSort } from "../stores/toc-sort";

  let current: TocSort = $state(tocSort.get());

  onMount(() => {
    return tocSort.subscribe((s) => {
      current = s;
    });
  });

  const OPTIONS: Array<{ value: TocSort; label: string; aria: string }> = [
    { value: "phase", label: "Phase", aria: "Group by phase" },
    { value: "chrono-asc", label: "Oldest", aria: "Sort chronologically, oldest first" },
    { value: "chrono-desc", label: "Newest", aria: "Sort chronologically, newest first" },
  ];

  function select(next: TocSort): void {
    tocSort.set(next);
  }

  function onKeydown(e: KeyboardEvent, idx: number): void {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const nextIdx = (idx + dir + OPTIONS.length) % OPTIONS.length;
    select(OPTIONS[nextIdx]!.value);
    // Move focus to the next segment so users see where they landed.
    const buttons = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>(
      "button[data-sort-segment]",
    );
    buttons?.[nextIdx]?.focus();
  }
</script>

<div
  class="sort-control"
  role="radiogroup"
  aria-label="Sort sessions"
  data-testid="sort-control"
>
  {#each OPTIONS as opt, idx (opt.value)}
    <button
      type="button"
      class="segment"
      class:active={current === opt.value}
      role="radio"
      aria-checked={current === opt.value}
      aria-label={opt.aria}
      data-sort-segment={opt.value}
      tabindex={current === opt.value ? 0 : -1}
      onclick={() => select(opt.value)}
      onkeydown={(e) => onKeydown(e, idx)}
    >
      {opt.label}
    </button>
  {/each}
</div>

<style>
  .sort-control {
    display: inline-flex;
    background: var(--color-surface-sunken);
    border: var(--card-border);
    border-radius: var(--radius-sm);
    padding: 2px;
    gap: 2px;
  }

  .segment {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--color-text-secondary);
    font-family: var(--font-body);
    font-size: var(--font-size-caption);
    padding: 4px 10px;
    border-radius: var(--radius-xs);
    cursor: pointer;
    transition:
      background-color 150ms ease,
      color 150ms ease;
  }

  .segment:hover {
    color: var(--color-text-primary);
  }

  .segment.active {
    background: var(--color-surface-raised);
    color: var(--color-text-primary);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }
</style>
