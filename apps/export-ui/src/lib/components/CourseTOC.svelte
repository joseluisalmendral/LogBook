<!--
  CourseTOC — the main content for the TOC route.

  Renders the payload's chapters based on the current tocSort store value:

    - "phase":       group sessions under <h2> phase headers (W1, W2, ...).
                     Phase data comes from chapter.phases[]. A session is
                     placed under its FIRST phase; sessions with no phases
                     land in "Unassigned".
    - "chrono-asc":  flat list, oldest first by `ts`.
    - "chrono-desc": flat list, newest first by `ts`.

  EmptyState fallback when there are no chapters (e.g. file:// opened with
  no payload). Per design §2 row 23 EmptyState is a P3 component too, but
  to keep this PR focused we inline the empty markup here — the standalone
  `<EmptyState>` lands when first real consumer needs it (P4).
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { Chapter } from "../types";
  import { payload } from "../stores/data";
  import { tocSort, type TocSort } from "../stores/toc-sort";
  import SessionTile from "./SessionTile.svelte";
  import SortControl from "./SortControl.svelte";

  let sort: TocSort = $state(tocSort.get());

  onMount(() => {
    return tocSort.subscribe((s) => {
      sort = s;
    });
  });

  /**
   * Group chapters by their FIRST phase. Sessions with no phases go under
   * the "Unassigned" bucket so they're still discoverable.
   *
   * Returns an array of { label, chapters[] } preserving discovery order:
   * phases appear in the order they're first encountered in the chapter
   * list. This avoids hard-coding W1/W2/W3 sequencing — the payload owns
   * the canonical phase ordering.
   */
  function groupByPhase(chapters: Chapter[]): Array<{ id: string; label: string; chapters: Chapter[] }> {
    const seen = new Map<string, { id: string; label: string; chapters: Chapter[] }>();
    const order: string[] = [];

    for (const c of chapters) {
      const first = c.phases[0];
      const id = first?.id ?? "unassigned";
      const label = first?.label ?? "Unassigned";
      if (!seen.has(id)) {
        seen.set(id, { id, label, chapters: [] });
        order.push(id);
      }
      seen.get(id)!.chapters.push(c);
    }

    return order.map((id) => seen.get(id)!);
  }

  function sortChrono(chapters: Chapter[], direction: "asc" | "desc"): Chapter[] {
    const copy = [...chapters];
    copy.sort((a, b) => {
      const da = new Date(a.ts).getTime();
      const db = new Date(b.ts).getTime();
      return direction === "asc" ? da - db : db - da;
    });
    return copy;
  }

  const grouped = $derived(groupByPhase(payload.chapters));
  const flatAsc = $derived(sortChrono(payload.chapters, "asc"));
  const flatDesc = $derived(sortChrono(payload.chapters, "desc"));
</script>

<section class="course-toc" data-testid="course-toc" data-sort={sort}>
  <header class="toc-header">
    <div class="toc-titles">
      <p class="toc-eyebrow">Course</p>
      <h1 class="toc-title">{payload.project.name || "LogBook Replay"}</h1>
      <p class="toc-subtitle">
        {payload.course.totals.sessions} session{payload.course.totals.sessions === 1 ? "" : "s"}
        {#if payload.course.totals.decisions > 0}
          · {payload.course.totals.decisions} decision{payload.course.totals.decisions === 1 ? "" : "s"}
        {/if}
        {#if payload.course.totals.milestones > 0}
          · {payload.course.totals.milestones} milestone{payload.course.totals.milestones === 1 ? "" : "s"}
        {/if}
      </p>
    </div>
    <SortControl />
  </header>

  {#if payload.chapters.length === 0}
    <div class="empty-state" role="status">
      <h2>No sessions yet</h2>
      <p>This export is empty. Once you run a Claude Code session and rebuild with <code>logbook export html</code>, sessions appear here.</p>
    </div>
  {:else if sort === "phase"}
    <div class="phase-groups">
      {#each grouped as group (group.id)}
        <section class="phase-group" aria-labelledby={`phase-${group.id}`}>
          <h2 id={`phase-${group.id}`} class="phase-label">{group.label}</h2>
          <div class="tile-grid">
            {#each group.chapters as ch (ch.sessionId)}
              <SessionTile chapter={ch} />
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {:else if sort === "chrono-asc"}
    <div class="tile-grid">
      {#each flatAsc as ch (ch.sessionId)}
        <SessionTile chapter={ch} />
      {/each}
    </div>
  {:else}
    <div class="tile-grid">
      {#each flatDesc as ch (ch.sessionId)}
        <SessionTile chapter={ch} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .course-toc {
    padding: var(--p-space-7) var(--p-space-6);
    max-width: 1100px;
    margin: 0 auto;
  }

  .toc-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--p-space-5);
    margin-bottom: var(--p-space-7);
    padding-bottom: var(--p-space-5);
    border-bottom: var(--card-border);
  }

  .toc-eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0 0 var(--p-space-2) 0;
  }

  .toc-title {
    font-family: var(--font-headline);
    font-size: var(--font-size-display);
    line-height: 1.05;
    margin: 0 0 var(--p-space-3) 0;
    color: var(--color-text-primary);
    letter-spacing: -0.02em;
  }

  .toc-subtitle {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-meta);
  }

  .phase-groups {
    display: flex;
    flex-direction: column;
    gap: var(--p-space-7);
  }

  .phase-group + .phase-group {
    padding-top: var(--p-space-5);
    border-top: var(--card-border);
  }

  .phase-label {
    font-family: var(--font-headline);
    font-size: var(--font-size-h2);
    margin: 0 0 var(--p-space-5) 0;
    color: var(--color-text-primary);
    letter-spacing: -0.01em;
  }

  .tile-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: var(--p-space-5);
  }

  .empty-state {
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--card-radius);
    padding: var(--p-space-7);
    text-align: center;
    color: var(--color-text-secondary);
  }

  .empty-state h2 {
    font-family: var(--font-headline);
    font-size: var(--font-size-h2);
    margin: 0 0 var(--p-space-3) 0;
    color: var(--color-text-primary);
  }

  .empty-state code {
    background: var(--color-surface-sunken);
    padding: 1px 6px;
    border-radius: var(--radius-xs);
  }

  @media (max-width: 767px) {
    .course-toc {
      padding: var(--p-space-5) var(--p-space-4);
    }
    .toc-header {
      flex-direction: column;
      align-items: stretch;
      gap: var(--p-space-4);
    }
    .toc-title {
      font-size: var(--font-size-h1);
    }
    .tile-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
