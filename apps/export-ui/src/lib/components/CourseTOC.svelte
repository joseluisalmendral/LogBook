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
  import { animate, stagger, inView } from "motion";
  import type { Chapter } from "../types";
  import { payload } from "../stores/data";
  import { tocSort, type TocSort } from "../stores/toc-sort";
  import { router } from "../stores/router";
  import { getMotionState } from "../stores/motion";
  import SessionTile from "./SessionTile.svelte";
  import SortControl from "./SortControl.svelte";

  let sort: TocSort = $state(tocSort.get());

  onMount(() => {
    return tocSort.subscribe((s) => {
      sort = s;
    });
  });

  /*
   * Slice 29 — editorial entrance WOW for the TOC.
   *
   *  1. The hero "burst" element wipes in from clip-path inset(0 100% 0 0)
   *     to inset(0).
   *  2. The session lines stagger-reveal as they enter the viewport
   *     (intersection observer via motion's inView helper).
   *  3. A cursor spotlight follows the mouse on the hero canvas (radial
   *     gradient that tracks mouseX/mouseY).
   */
  let cursorX = $state(50);
  let cursorY = $state(20);

  onMount(() => {
    const motion = getMotionState();
    if (!motion.motionAllowed) return;

    // 1. Hero burst wipe.
    const hero = document.querySelector<HTMLElement>(".toc-hero");
    if (hero) {
      hero.style.clipPath = "inset(0 100% 0 0)";
      animate(hero, { clipPath: "inset(0 0% 0 0)" }, {
        duration: 0.9,
        ease: [0.85, 0, 0.15, 1],
        delay: 0.05,
      });
    }

    // 2. Stagger-reveal session entries on scroll-in.
    const lines = document.querySelectorAll<HTMLElement>(".session-entry");
    for (const l of lines) {
      l.style.opacity = "0";
      l.style.transform = "translateY(24px)";
    }
    const stopWatching = inView(
      lines as unknown as Element[],
      (entry) => {
        animate(
          entry.target as HTMLElement,
          { opacity: 1, transform: "translateY(0px)" },
          { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
        );
      },
      { margin: "-10% 0px -5% 0px" },
    );

    // 3. Cursor spotlight on hero only.
    const onMove = (e: MouseEvent): void => {
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
        cursorX = x;
        cursorY = y;
      }
    };
    window.addEventListener("mousemove", onMove);

    return () => {
      stopWatching();
      window.removeEventListener("mousemove", onMove);
    };
  });

  function openLatest(): void {
    const latest = payload.chapters[payload.chapters.length - 1];
    if (!latest) return;
    router.navigate({ name: "chapter", chapterId: latest.sessionId });
  }

  function pad(n: number): string {
    return n.toString().padStart(2, "0");
  }

  function fmtDate(iso: string): string {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
    } catch {
      return iso.slice(0, 10);
    }
  }

  function chapterMeta(ch: Chapter): string {
    const parts: string[] = [];
    const evs = ch.events.length;
    if (evs > 0) parts.push(`${evs} event${evs === 1 ? "" : "s"}`);
    const subs = ch.events.filter((e) => e.type === "subagent_complete").length;
    if (subs > 0) parts.push(`${subs} sub-agent${subs === 1 ? "" : "s"}`);
    const fileN = (ch.filesTouched as unknown[] | undefined)?.length ?? 0;
    if (fileN > 0) parts.push(`${fileN} file${fileN === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }

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
  <!--
    Slice 29 — editorial hero.
    Hero canvas with a cursor-tracking radial spotlight + a 64px display
    title + KPI strip + Ghost Waitlist CTA to open the latest session.
  -->
  <header
    class="toc-hero"
    style="--cursor-x: {cursorX}%; --cursor-y: {cursorY}%;"
  >
    <div class="toc-hero-inner">
      <p class="toc-eyebrow">
        <span class="lb-margin-note">{pad(payload.course.totals.sessions || 0)}</span>
        Course · LogBook replay
      </p>
      <h1 class="toc-display">{payload.project.name || "LogBook Replay"}</h1>
      <p class="toc-lead">
        A reading-paced replay of every Claude Code session you ran in this
        repo — prompts, responses, tools, sub-agents.
      </p>
      <div class="toc-kpis">
        <div class="kpi">
          <span class="kpi-value lb-tnum">{payload.course.totals.sessions}</span>
          <span class="kpi-label">sessions</span>
        </div>
        {#if payload.course.totals.decisions > 0}
          <div class="kpi">
            <span class="kpi-value lb-tnum">{payload.course.totals.decisions}</span>
            <span class="kpi-label">decisions</span>
          </div>
        {/if}
        {#if payload.course.totals.milestones > 0}
          <div class="kpi">
            <span class="kpi-value lb-tnum">{payload.course.totals.milestones}</span>
            <span class="kpi-label">milestones</span>
          </div>
        {/if}
        {#if payload.course.totals.skillInvocations > 0}
          <div class="kpi">
            <span class="kpi-value lb-tnum">{payload.course.totals.skillInvocations}</span>
            <span class="kpi-label">skills loaded</span>
          </div>
        {/if}
      </div>
      {#if payload.chapters.length > 0}
        <div class="toc-actions">
          <button
            type="button"
            class="lb-ghost-btn"
            onclick={openLatest}
          >
            Open latest session
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
              <line x1="3" y1="8" x2="13" y2="8" />
              <polyline points="9 4 13 8 9 12" />
            </svg>
          </button>
          <SortControl />
        </div>
      {/if}
    </div>
  </header>

  {#if payload.chapters.length === 0}
    <div class="empty-state" role="status">
      <h2>No sessions yet</h2>
      <p>This export is empty. Once you run a Claude Code session and rebuild with <code>logbook export html</code>, sessions appear here.</p>
    </div>
  {:else}
    <!--
      Slice 29 — sessions render as a NUMBERED EDITORIAL LIST instead of a
      card grid. The big numeric marker sits in the left gutter (ruled-
      paper margin) and the title carries the weight. Hover slides the
      ember accent in from the left + nudges the row right.

      For the phase grouping we still emit the phase label, but the rest
      of the layout is the same numbered list.
    -->
    <ol class="session-list" start="1">
      {#if sort === "phase"}
        {#each grouped as group (group.id)}
          <li class="phase-divider" aria-hidden="true">
            <span class="lb-section-title">{group.label}</span>
          </li>
          {#each group.chapters as ch, i (ch.sessionId)}
            <li class="session-entry">
              <a
                href={`#/chapter/${ch.sessionId}`}
                class="session-link"
                data-event-id={ch.sessionId}
              >
                <span class="entry-number lb-tnum" aria-hidden="true">{pad(i + 1)}</span>
                <div class="entry-body">
                  <h3 class="entry-title">{ch.label || `Session ${ch.sessionId.slice(0, 8)}`}</h3>
                  <p class="entry-meta lb-tnum">{fmtDate(ch.ts)} · {chapterMeta(ch)}</p>
                </div>
                <span class="entry-arrow" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="13 6 19 12 13 18" />
                  </svg>
                </span>
              </a>
            </li>
          {/each}
        {/each}
      {:else}
        {#each (sort === "chrono-asc" ? flatAsc : flatDesc) as ch, i (ch.sessionId)}
          <li class="session-entry">
            <a
              href={`#/chapter/${ch.sessionId}`}
              class="session-link"
              data-event-id={ch.sessionId}
            >
              <span class="entry-number lb-tnum" aria-hidden="true">{pad(i + 1)}</span>
              <div class="entry-body">
                <h3 class="entry-title">{ch.label || `Session ${ch.sessionId.slice(0, 8)}`}</h3>
                <p class="entry-meta lb-tnum">{fmtDate(ch.ts)} · {chapterMeta(ch)}</p>
              </div>
              <span class="entry-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="13 6 19 12 13 18" />
                </svg>
              </span>
            </a>
          </li>
        {/each}
      {/if}
    </ol>
  {/if}
</section>

<style>
  /*
   * Slice 29 — editorial TOC layout (Syllabus DESIGN.md × Claude).
   *
   * The whole page reads like a magazine spread: a hero canvas with
   * a 56-64px display title + cursor-tracked radial spotlight, then
   * a numbered editorial list of sessions with prominent left-gutter
   * counters and a slide-in ember accent on hover.
   */
  .course-toc {
    padding: var(--p-space-7) var(--p-space-6) var(--p-space-9);
    max-width: 1280px;     /* DESIGN.md page max-width */
    margin: 0 auto;
  }

  /* ============================================================ */
  /* HERO                                                          */
  /* ============================================================ */

  .toc-hero {
    position: relative;
    overflow: hidden;
    padding: 64px 0 56px;
    border-bottom: 2px solid var(--color-text-primary);
    margin-bottom: 56px;
    /* Radial spotlight follows the cursor (set via inline --cursor-x/y). */
    background:
      radial-gradient(
        circle at var(--cursor-x, 50%) var(--cursor-y, 30%),
        color-mix(in srgb, var(--color-accent-secondary) 55%, transparent) 0%,
        transparent 28%
      ),
      radial-gradient(
        ellipse 70% 40% at 90% 110%,
        color-mix(in srgb, var(--color-accent-primary) 22%, transparent) 0%,
        transparent 60%
      );
    transition: background-position 50ms linear;
  }

  .toc-hero-inner {
    position: relative;
    z-index: 1;
    max-width: 1080px;
  }

  .toc-eyebrow {
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
    font-family: var(--font-mono);
    font-size: var(--font-size-meta);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    margin: 0 0 24px 0;
  }

  .toc-eyebrow .lb-margin-note {
    color: var(--color-accent-primary);
    font-weight: 700;
    letter-spacing: 0.1em;
  }

  .toc-display {
    font-family: var(--font-headline);
    font-size: clamp(40px, 8vw, 64px);
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.025em;
    margin: 0 0 24px 0;
    color: var(--color-text-primary);
    max-width: 16ch;
  }

  .toc-lead {
    font-family: var(--font-body);
    font-size: var(--font-size-lead);
    line-height: 1.4;
    color: var(--color-text-secondary);
    margin: 0 0 40px 0;
    max-width: 56ch;
  }

  .toc-kpis {
    display: flex;
    flex-wrap: wrap;
    gap: 40px;
    margin-bottom: 40px;
    padding-top: 24px;
    border-top: 1px solid color-mix(in srgb, var(--color-text-primary) 14%, transparent);
  }

  .kpi {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .kpi-value {
    font-family: var(--font-headline);
    font-size: 40px;
    font-weight: 700;
    line-height: 1;
    color: var(--color-text-primary);
    letter-spacing: -0.02em;
  }

  .kpi-label {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--color-text-secondary);
  }

  .toc-actions {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  /* ============================================================ */
  /* NUMBERED EDITORIAL LIST                                      */
  /* ============================================================ */

  .session-list {
    list-style: none;
    margin: 0;
    padding: 0;
    counter-reset: session;
    display: flex;
    flex-direction: column;
  }

  .phase-divider {
    margin: 56px 0 24px;
  }

  .session-entry {
    border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 16%, transparent);
    position: relative;
  }

  .session-entry:first-child {
    border-top: 1px solid color-mix(in srgb, var(--color-text-primary) 16%, transparent);
  }

  .session-link {
    display: grid;
    grid-template-columns: 80px 1fr 48px;
    align-items: center;
    gap: 32px;
    padding: 32px 0 32px 24px;
    text-decoration: none;
    color: inherit;
    position: relative;
    transition: padding-left 280ms cubic-bezier(0.22, 1, 0.36, 1),
                background 280ms ease-out;
  }

  /*
   * Slice 29 hover affordance — a 4px ember accent slides in from the
   * left, and the row nudges right + gains a faint glow wash. Click
   * target stays full-row.
   */
  .session-link::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: var(--color-accent-primary);
    transform: scaleY(0);
    transform-origin: top;
    transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .session-link:hover,
  .session-link:focus-visible {
    padding-left: 48px;
    background: color-mix(in srgb, var(--color-accent-secondary) 22%, transparent);
    outline: none;
  }

  .session-link:hover::before,
  .session-link:focus-visible::before {
    transform: scaleY(1);
  }

  .session-link:focus-visible {
    box-shadow: inset 0 0 0 2px var(--color-accent-primary);
  }

  .entry-number {
    font-family: var(--font-mono);
    font-size: 40px;
    font-weight: 400;
    line-height: 1;
    color: var(--color-text-tertiary);
    letter-spacing: -0.01em;
    transition: color 280ms ease-out;
  }

  .session-link:hover .entry-number,
  .session-link:focus-visible .entry-number {
    color: var(--color-accent-primary);
  }

  .entry-body {
    min-width: 0;
  }

  .entry-title {
    font-family: var(--font-headline);
    font-size: var(--font-size-h2);   /* 40px DESIGN.md heading-sm */
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.015em;
    margin: 0 0 8px 0;
    color: var(--color-text-primary);
  }

  .entry-meta {
    font-family: var(--font-mono);
    font-size: var(--font-size-meta);
    color: var(--color-text-secondary);
    margin: 0;
    letter-spacing: 0.02em;
  }

  .entry-arrow {
    color: var(--color-text-tertiary);
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
                color 280ms ease-out;
  }

  .session-link:hover .entry-arrow,
  .session-link:focus-visible .entry-arrow {
    color: var(--color-accent-primary);
    transform: translateX(8px);
  }

  /* ============================================================ */
  /* EMPTY STATE                                                  */
  /* ============================================================ */

  .empty-state {
    padding: var(--p-space-9) var(--p-space-6);
    text-align: center;
    border: 2px dashed color-mix(in srgb, var(--color-text-primary) 22%, transparent);
    color: var(--color-text-secondary);
  }

  .empty-state h2 {
    font-family: var(--font-headline);
    font-size: var(--font-size-h2);
    margin: 0 0 var(--p-space-3) 0;
    color: var(--color-text-primary);
    font-weight: 700;
  }

  .empty-state code {
    background: var(--color-text-primary);
    color: var(--p-cream-50);
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: var(--font-size-meta);
  }

  /* ============================================================ */
  /* REDUCED MOTION                                               */
  /* ============================================================ */

  :global(html[data-motion="reduced"]) .session-link,
  :global(html[data-motion="reduced"]) .session-link::before,
  :global(html[data-motion="reduced"]) .session-link .entry-arrow,
  :global(html[data-motion="reduced"]) .session-link .entry-number {
    transition: none !important;
  }

  /* ============================================================ */
  /* MOBILE                                                       */
  /* ============================================================ */

  @media (max-width: 767px) {
    .course-toc {
      padding: var(--p-space-5) var(--p-space-4) var(--p-space-7);
    }
    .toc-hero {
      padding: 32px 0 24px;
      margin-bottom: 24px;
    }
    .toc-kpis {
      gap: 24px;
    }
    .session-link {
      grid-template-columns: 56px 1fr 32px;
      gap: 16px;
      padding: 20px 0 20px 16px;
    }
    .entry-number { font-size: 24px; }
    .entry-title { font-size: var(--font-size-lead); }
  }
</style>
