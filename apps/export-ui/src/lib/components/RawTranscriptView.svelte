<!--
  RawTranscriptView — slice 12 P5 Bucket D part 2.

  Mounts on route `#/transcript/<sessionId>`. Consumes
  `payload.transcripts[sessionId]` (sanitized by P4) and renders a virtualized
  list of TranscriptRow cards.

  Spec contracts:
    R-65   route mounts inside CourseShell
    R-66   transcript renders sanitized raw events
    R-67   ≤ 80 mounted rows (enforced by virtual-window.ts via INV-17)
    R-69   search + "show meaningful" filter
    R-68   bidirectional link → jump-to-card affordance
    INV-17 ≤ 80 row DOM nodes mounted at any time
    INV-18 monospace + sunken surface (dev-tools register containment)

  Architecture:
    - Outer scroller is a `<div role="list">` with overflow-y: auto.
    - Spacer holds totalHeight = totalCount × rowHeight.
    - Visible slice is rendered inside a positioned inner div translated to
      offsetTop. ~10-20 rows mounted at any time in practice.
    - Search is debounced 150ms; filter runs on the in-memory event list.
    - Active row (selection.transcriptEventId) gets is-active + autoscroll.

  Graceful degradation:
    - `payload.transcripts[sid] === null` → polite empty state ("Transcript not
      available on this machine").
    - `payload.transcripts[sid]` missing entirely → same empty state.
-->
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { payload } from "../stores/data";
  import { router } from "../stores/router";
  import { selection, type SelectionSnapshot } from "../stores/selection";
  import { computeWindow } from "../util/virtual-window";
  import type { SanitizedTranscriptEvent } from "../types";
  import TranscriptRow from "./TranscriptRow.svelte";

  interface Props {
    sessionId: string;
  }

  const { sessionId }: Props = $props();

  const ROW_HEIGHT = 56; // px — must stay in sync with TranscriptRow CSS.

  // Lookup transcript from payload. `payload.transcripts` may be undefined
  // (older payloads), the entry may be missing, or the entry may be null
  // (session originated on a different machine).
  const transcript = $derived.by(() => {
    const all = payload.transcripts;
    if (!all) return null;
    return all[sessionId] ?? null;
  });

  const isUnavailable = $derived(transcript === null);

  /* ---------------- Filters ---------------- */
  let searchInput = $state("");
  let searchDebounced = $state("");
  let showOnlyMeaningful = $state(true);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function onSearchInput(e: Event): void {
    searchInput = (e.target as HTMLInputElement).value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchDebounced = searchInput.toLowerCase().trim();
    }, 150);
  }

  function toggleMeaningful(): void {
    showOnlyMeaningful = !showOnlyMeaningful;
  }

  const filteredEvents = $derived.by<SanitizedTranscriptEvent[]>(() => {
    if (!transcript) return [];
    let list = transcript.events;
    if (showOnlyMeaningful) {
      list = list.filter((e) => e.type !== "meta");
    }
    if (searchDebounced) {
      list = list.filter((e) => {
        if (e.content && e.content.toLowerCase().includes(searchDebounced)) return true;
        if (e.name && e.name.toLowerCase().includes(searchDebounced)) return true;
        return false;
      });
    }
    return list;
  });

  const sessionStart = $derived.by(() => {
    if (!transcript || transcript.events.length === 0) return Date.now();
    return transcript.events[0]!.timestamp;
  });

  /* ---------------- Virtualization ---------------- */
  let scrollerEl: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let viewportHeight = $state(800);

  const win = $derived.by(() =>
    computeWindow({
      totalCount: filteredEvents.length,
      scrollTop,
      viewportHeight,
      rowHeight: ROW_HEIGHT,
    }),
  );

  const visibleSlice = $derived(filteredEvents.slice(win.startIndex, win.endIndex));

  function onScroll(e: Event): void {
    scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
  }

  /* ---------------- Selection (bidirectional link) ---------------- */
  let snap: SelectionSnapshot = $state({ chapterEventId: null, transcriptEventId: null });
  /** Per-row expansion state, keyed by event id. */
  let expandedRows: Record<string, boolean> = $state({});

  onMount(() => {
    const unsubSel = selection.subscribe((s) => {
      snap = s;
    });
    function onResize(): void {
      if (scrollerEl) {
        viewportHeight = scrollerEl.clientHeight;
      }
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      unsubSel();
      window.removeEventListener("resize", onResize);
    };
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  function selectRow(eventId: string): void {
    // URL-then-store: navigate; the router's hashchange listener writes
    // selection.transcriptEventId. We also flip the row expansion here so the
    // click feels immediate even before the listener fires.
    expandedRows = { ...expandedRows, [eventId]: !expandedRows[eventId] };
    router.navigate({ name: "transcript", sessionId, eventId });
  }

  /** "Jump to card" — bidirectional link out to #/chapter/<sid>?event=<id>. */
  function jumpToCard(): void {
    const id = snap.transcriptEventId;
    if (!id) return;
    router.navigate({ name: "chapter", chapterId: sessionId, eventId: id });
  }

  function backToChapter(): void {
    router.navigate({ name: "chapter", chapterId: sessionId, eventId: null });
  }

  /** Auto-scroll the active row into the viewport. */
  $effect(() => {
    const id = snap.transcriptEventId;
    if (!id || !scrollerEl) return;
    const idx = filteredEvents.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const targetTop = idx * ROW_HEIGHT;
    // Only scroll if the target is outside the current viewport (avoids
    // fighting user-initiated scroll).
    if (
      targetTop < scrollTop ||
      targetTop > scrollTop + viewportHeight - ROW_HEIGHT
    ) {
      scrollerEl.scrollTo({
        top: Math.max(0, targetTop - viewportHeight / 2 + ROW_HEIGHT / 2),
        behavior:
          typeof window !== "undefined" &&
          window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
      });
    }
  });

  /* ---------------- Keyboard navigation ---------------- */
  function onKey(e: KeyboardEvent): void {
    if (filteredEvents.length === 0) return;
    const activeId = snap.transcriptEventId;
    const idx = activeId ? filteredEvents.findIndex((ev) => ev.id === activeId) : -1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(filteredEvents.length - 1, idx + 1);
      const nextEv = filteredEvents[next];
      if (nextEv) router.navigate({ name: "transcript", sessionId, eventId: nextEv.id });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = Math.max(0, idx - 1);
      const prevEv = filteredEvents[prev];
      if (prevEv) router.navigate({ name: "transcript", sessionId, eventId: prevEv.id });
    } else if (e.key === "Enter" && activeId) {
      e.preventDefault();
      expandedRows = { ...expandedRows, [activeId]: !expandedRows[activeId] };
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<section class="transcript-view" data-testid="raw-transcript-view" aria-label="Raw transcript">
  <header class="t-header">
    <button type="button" class="back-btn" onclick={backToChapter}>
      <span aria-hidden="true">←</span> Back to chapter
    </button>
    <h1 class="t-title">Raw transcript</h1>
    <p class="t-meta lb-tnum" aria-live="polite">
      {#if transcript}
        {transcript.sanitizedEventCount} events shown · {transcript.droppedEvents} dropped (noise)
        {#if transcript.truncatedAtBytes}
          · session truncated at {transcript.truncatedAtBytes} bytes
        {/if}
      {:else}
        Transcript unavailable
      {/if}
    </p>
  </header>

  {#if isUnavailable}
    <div class="t-empty">
      <p class="t-empty-title">Raw transcript not available</p>
      <p class="t-empty-hint">
        The JSONL transcript for session <code>{sessionId}</code> wasn't accessible on the
        machine that built this export. The chapter view (visual replay) is still complete.
      </p>
    </div>
  {:else if transcript}
    <div class="t-filters">
      <label class="t-search-label">
        <span class="visually-hidden">Search transcript</span>
        <input
          type="search"
          class="t-search"
          placeholder="Search content or tool name…"
          value={searchInput}
          oninput={onSearchInput}
          data-interactive
        />
      </label>
      <button
        type="button"
        class="t-toggle"
        class:is-on={showOnlyMeaningful}
        onclick={toggleMeaningful}
        aria-pressed={showOnlyMeaningful}
        data-interactive
      >
        {showOnlyMeaningful ? "Showing meaningful" : "Showing all"}
      </button>
      {#if snap.transcriptEventId}
        <button
          type="button"
          class="t-jump"
          onclick={jumpToCard}
          data-interactive
          aria-label="Jump to matching chapter card"
        >
          Jump to card →
        </button>
      {/if}
    </div>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="t-scroller"
      bind:this={scrollerEl}
      onscroll={onScroll}
      role="list"
      tabindex="0"
    >
      <div class="t-spacer" style="height: {filteredEvents.length * ROW_HEIGHT}px;">
        <div class="t-window" style="transform: translateY({win.offsetTop}px);">
          {#each visibleSlice as ev (ev.id)}
            <TranscriptRow
              event={ev}
              sessionStart={sessionStart}
              active={snap.transcriptEventId === ev.id}
              expanded={Boolean(expandedRows[ev.id])}
              onSelect={selectRow}
            />
          {/each}
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .transcript-view {
    display: flex;
    flex-direction: column;
    height: 100vh;
    /* INV-18 register containment: monospace + sunken surface. */
    font-family: var(--font-mono);
    background: var(--color-surface-sunken);
    color: var(--color-text-primary);
  }

  .t-header {
    flex-shrink: 0;
    padding: var(--p-space-5) var(--p-space-6) var(--p-space-4);
    border-bottom: 1px solid var(--color-border-hairline);
    background: var(--color-surface-raised);
    /* Headline area allowed to use the body font so the editorial frame survives
       the route transition — only the row list is monospace. */
    font-family: var(--font-body);
  }

  .back-btn {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--color-accent-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
    padding: 0;
    cursor: pointer;
    margin-bottom: var(--p-space-3);
    display: inline-flex;
    align-items: center;
    gap: var(--p-space-1);
  }
  .back-btn:hover {
    text-decoration: underline;
  }

  .t-title {
    font-family: var(--font-headline);
    font-size: var(--font-size-h2);
    margin: 0 0 var(--p-space-2) 0;
    color: var(--color-text-primary);
  }

  .t-meta {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }

  .t-empty {
    padding: var(--p-space-7) var(--p-space-6);
    max-width: 720px;
    margin: 0 auto;
    font-family: var(--font-body);
    text-align: center;
  }
  .t-empty-title {
    font-family: var(--font-headline);
    font-size: var(--font-size-h3);
    color: var(--color-text-primary);
    margin: 0 0 var(--p-space-3) 0;
  }
  .t-empty-hint {
    color: var(--color-text-secondary);
    line-height: 1.5;
    margin: 0;
  }
  .t-empty code {
    font-family: var(--font-mono);
    background: var(--color-surface-raised);
    padding: 2px 6px;
    border-radius: var(--radius-xs);
  }

  .t-filters {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
    padding: var(--p-space-3) var(--p-space-6);
    background: var(--color-surface-raised);
    border-bottom: 1px solid var(--color-border-hairline);
    font-family: var(--font-body);
  }

  .t-search-label { flex: 1; }
  .visually-hidden {
    position: absolute !important;
    width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0,0,0,0); border: 0;
  }
  .t-search {
    width: 100%;
    appearance: none;
    background: var(--color-surface);
    border: 1px solid var(--color-border-hairline);
    border-radius: var(--radius-xs);
    padding: var(--p-space-2) var(--p-space-3);
    color: var(--color-text-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
  }
  .t-search:focus-visible {
    outline: 1px solid var(--color-accent-primary);
    outline-offset: 0;
    border-color: var(--color-accent-primary);
  }

  .t-toggle, .t-jump {
    appearance: none;
    background: transparent;
    border: 1px solid var(--color-border-hairline);
    color: var(--color-text-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
    padding: var(--p-space-2) var(--p-space-3);
    border-radius: var(--radius-xs);
    cursor: pointer;
    white-space: nowrap;
  }
  .t-toggle:hover, .t-jump:hover {
    border-color: var(--color-accent-primary);
  }
  .t-toggle.is-on {
    border-color: var(--color-accent-primary);
    color: var(--color-accent-primary);
  }
  .t-jump {
    border-color: var(--color-accent-primary);
    color: var(--color-accent-primary);
  }

  .t-scroller {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    background: var(--color-surface-sunken);
  }
  .t-scroller:focus-visible {
    outline: 1px solid var(--color-accent-primary);
    outline-offset: -1px;
  }

  .t-spacer {
    position: relative;
    width: 100%;
  }
  .t-window {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    display: flex;
    flex-direction: column;
  }

  @media (max-width: 767px) {
    .t-header { padding: var(--p-space-4) var(--p-space-4) var(--p-space-3); }
    .t-filters {
      padding: var(--p-space-3) var(--p-space-4);
      flex-wrap: wrap;
    }
  }
</style>
