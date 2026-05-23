<!--
  SessionTile — one card in the course TOC.

  Shows session label (h3), optional goal in italics, ts (absolute date),
  outcome badge if present, count chips (decisions / errors / milestones)
  derived from the chapter's events array. Click navigates to the chapter
  route via the router store.

  Hover: subtle translate-Y -1px + shadow lift over 150ms ease-out (motion #6
  pattern; gated by data-motion="reduced" on <html>). The reduced-motion
  override in app.css zeroes all transitions globally, so no extra @media
  query here.

  Identifies events by `type` prefix (we don't have rich types in this
  fixture path; the buckets in payload.* are the source of truth for cross-
  session totals, but per-session counts need to be derived locally).
-->
<script lang="ts">
  import type { Chapter } from "../types";
  import { router } from "../stores/router";

  interface Props {
    chapter: Chapter;
  }

  const { chapter }: Props = $props();

  function countByType(events: Chapter["events"], suffix: string): number {
    let n = 0;
    for (const e of events) {
      if (typeof e.type === "string" && e.type.endsWith(suffix)) n++;
    }
    return n;
  }

  const decisionCount = $derived(countByType(chapter.events, "decision"));
  const errorCount = $derived(countByType(chapter.events, "error"));
  const milestoneCount = $derived(countByType(chapter.events, "milestone"));

  const tsDisplay = $derived.by(() => {
    const d = new Date(chapter.ts);
    if (Number.isNaN(d.getTime())) return chapter.ts;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  });

  // The view-transition-name MUST match the ChapterHeader's name for the
  // shared-element morph (motion #1). Same sanitization rules.
  const vtName = $derived(`chapter-${chapter.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}`);

  function navigate(): void {
    // View Transitions API: animate from this tile to the chapter header.
    // Gated by @supports + motion store (the global app.css rule kills
    // animations when data-motion="reduced").
    if (typeof document !== "undefined" && "startViewTransition" in document) {
      (document as Document & { startViewTransition: (cb: () => void) => unknown })
        .startViewTransition(() => {
          router.navigate({ name: "chapter", chapterId: chapter.sessionId });
        });
    } else {
      router.navigate({ name: "chapter", chapterId: chapter.sessionId });
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate();
    }
  }
</script>

<div
  class="session-tile"
  tabindex="0"
  role="button"
  aria-label={`Open session ${chapter.label}`}
  data-testid="session-tile"
  data-session-id={chapter.sessionId}
  style="view-transition-name: {vtName};"
  onclick={navigate}
  onkeydown={onKey}
>
  <header class="tile-header">
    <h3 class="tile-label">{chapter.label}</h3>
    <time class="tile-ts lb-tnum" datetime={chapter.ts}>{tsDisplay}</time>
  </header>

  {#if chapter.goal}
    <p class="tile-goal">{chapter.goal}</p>
  {/if}

  {#if chapter.outcome}
    <p class="tile-outcome">
      <span class="outcome-pill">Outcome</span>
      {chapter.outcome}
    </p>
  {/if}

  <footer class="tile-footer">
    {#if decisionCount > 0}
      <span class="chip chip-decision" aria-label={`${decisionCount} decisions`}>
        <span class="chip-dot" aria-hidden="true"></span>
        {decisionCount} decision{decisionCount === 1 ? "" : "s"}
      </span>
    {/if}
    {#if errorCount > 0}
      <span class="chip chip-error" aria-label={`${errorCount} errors`}>
        <span class="chip-dot" aria-hidden="true"></span>
        {errorCount} error{errorCount === 1 ? "" : "s"}
      </span>
    {/if}
    {#if milestoneCount > 0}
      <span class="chip chip-milestone" aria-label={`${milestoneCount} milestones`}>
        <span class="chip-dot" aria-hidden="true"></span>
        {milestoneCount} milestone{milestoneCount === 1 ? "" : "s"}
      </span>
    {/if}
  </footer>
</div>

<style>
  .session-tile {
    display: flex;
    flex-direction: column;
    gap: var(--p-space-3);
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--card-radius);
    padding: var(--card-padding);
    cursor: pointer;
    text-align: left;
    transition:
      transform 150ms ease-out,
      border-color 150ms ease,
      box-shadow 150ms ease-out;
  }

  .session-tile:hover {
    transform: translateY(-1px);
    border-color: var(--color-accent-primary);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.06);
  }

  .session-tile:focus-visible {
    border-color: var(--color-accent-primary);
  }

  .tile-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--p-space-4);
  }

  .tile-label {
    font-family: var(--font-headline);
    font-size: var(--font-size-h3);
    margin: 0;
    line-height: 1.2;
    color: var(--color-text-primary);
  }

  .tile-ts {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .tile-goal {
    font-style: italic;
    color: var(--color-text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .tile-outcome {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-meta);
  }

  .outcome-pill {
    display: inline-block;
    background: var(--color-surface-sunken);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    margin-right: var(--p-space-2);
  }

  .tile-footer {
    display: flex;
    flex-wrap: wrap;
    gap: var(--p-space-2);
    margin-top: var(--p-space-1);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    background: var(--color-surface-sunken);
    padding: 2px 8px;
    border-radius: var(--radius-xs);
  }

  .chip-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .chip-decision { color: var(--color-decision); }
  .chip-error    { color: var(--color-error); }
  .chip-milestone { color: var(--color-accent-primary); }
</style>
