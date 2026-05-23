<!--
  CommandPalette — native <dialog>-based Cmd+K palette.

  Spec R-30, R-35, R-36 / motion #8 / S-7 / AG-14.

  Native <dialog> gives us:
    - Focus trap (built-in)
    - ::backdrop pseudo-element (no manual backdrop element needed)
    - Esc closes (built-in)
    - Proper a11y semantics

  Open animation: @starting-style for entry (Chrome 117+). Older browsers
  see an instant show — graceful.

  Search index: flattened at boot from payload.chapters[].events — each entry
  is { id, label, kind, chapterId }. Fuzzy match via simple substring + lower-
  case comparison (good enough for ≤500 items, which the LogBook scale never
  exceeds in practice).

  Keyboard:
    Cmd+K / Ctrl+K  open (wired in <CourseShell>)
    ↑ / ↓           move selection
    Enter           navigate to selected
    Esc             close

  The component subscribes to `palette` store for open/closed state.
-->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import { palette } from "../stores/palette";
  import { payload } from "../stores/data";
  import { router } from "../stores/router";

  interface Entry {
    id: string;
    label: string;
    kind: string;
    chapterId: string;
    chapterLabel: string;
  }

  let dialogEl: HTMLDialogElement | undefined = $state();
  let inputEl: HTMLInputElement | undefined = $state();
  let query = $state("");
  let selectedIdx = $state(0);
  let isOpen = $state(false);

  // Flatten the payload's events into a searchable index. Pre-computed once at
  // mount; updates are not needed because the payload is frozen at file:// time.
  let index: Entry[] = $state([]);

  function buildIndex(): Entry[] {
    const entries: Entry[] = [];
    for (const ch of payload.chapters) {
      // The chapter itself is searchable.
      entries.push({
        id: `chapter-${ch.sessionId}`,
        label: ch.label,
        kind: "chapter",
        chapterId: ch.sessionId,
        chapterLabel: ch.label,
      });
      for (const ev of ch.events) {
        const t = ev.title ?? "";
        if (t.length === 0) continue;
        const k = (ev as { kind?: string }).kind ?? ev.type ?? "";
        let kind = "event";
        if (k === "agent_question") kind = "question";
        else if (k.startsWith("subagent")) kind = "subagent";
        else if (k.endsWith("decision")) kind = "decision";
        else if (k.endsWith("error")) kind = "error";
        else if (k.endsWith("milestone")) kind = "milestone";
        else if (k.endsWith("lesson")) kind = "lesson";
        else if (k.endsWith("fix")) kind = "fix";
        else if (k.endsWith("resource")) kind = "resource";
        entries.push({
          id: ev.id,
          label: t,
          kind,
          chapterId: ch.sessionId,
          chapterLabel: ch.label,
        });
      }
    }
    return entries;
  }

  const results = $derived.by(() => {
    if (!index.length) return [];
    const q = query.trim().toLowerCase();
    if (q.length === 0) return index.slice(0, 24);
    return index
      .filter((e) => e.label.toLowerCase().includes(q) || e.kind.toLowerCase().includes(q))
      .slice(0, 24);
  });

  onMount(() => {
    index = buildIndex();
    const unsub = palette.subscribe(async (open) => {
      isOpen = open;
      if (open && dialogEl && !dialogEl.open) {
        dialogEl.showModal();
        // Focus the input on next tick (after starting-style entry animation).
        await tick();
        inputEl?.focus();
        inputEl?.select();
      } else if (!open && dialogEl?.open) {
        dialogEl.close();
        query = "";
        selectedIdx = 0;
      }
    });
    return unsub;
  });

  function onKey(e: KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIdx = Math.min(results.length - 1, selectedIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIdx = Math.max(0, selectedIdx - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(selectedIdx);
    }
  }

  function activate(idx: number): void {
    const r = results[idx];
    if (!r) return;
    router.navigate({ name: "chapter", chapterId: r.chapterId, eventId: null });
    // Scroll to event after route change if it's not the chapter itself.
    palette.closePalette();
    if (r.kind !== "chapter") {
      setTimeout(() => {
        const el = document.getElementById(`event-${r.id}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
    }
  }

  function onDialogClose(): void {
    palette.closePalette();
  }

  function onBackdropClick(e: MouseEvent): void {
    // <dialog> ::backdrop click bubbles to the dialog itself when click
    // originated outside the dialog content. Detect by checking target === dialogEl.
    if (e.target === dialogEl) {
      palette.closePalette();
    }
  }
</script>

<dialog
  class="palette"
  bind:this={dialogEl}
  onclose={onDialogClose}
  onclick={onBackdropClick}
  data-testid="command-palette"
  aria-label="Command palette"
>
  {#if isOpen}
    <div class="palette-inner">
      <header class="palette-head">
        <span class="palette-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
            <circle cx="7" cy="7" r="4.5" />
            <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" stroke-linecap="round" />
          </svg>
        </span>
        <input
          bind:this={inputEl}
          bind:value={query}
          oninput={() => (selectedIdx = 0)}
          onkeydown={onKey}
          placeholder="Search sessions, decisions, prompts, errors…"
          autocomplete="off"
          spellcheck={false}
          aria-label="Search"
          data-testid="palette-input"
        />
        <kbd class="kbd-hint">Esc</kbd>
      </header>

      <ul class="results" role="listbox" aria-label="Search results">
        {#each results as r, i}
          <li>
            <button
              type="button"
              class="result"
              class:is-selected={i === selectedIdx}
              data-kind={r.kind}
              onclick={() => activate(i)}
              onmouseenter={() => (selectedIdx = i)}
              role="option"
              aria-selected={i === selectedIdx}
            >
              <span class="r-kind">{r.kind}</span>
              <span class="r-label">{r.label}</span>
              {#if r.kind !== "chapter"}
                <span class="r-context">{r.chapterLabel}</span>
              {/if}
            </button>
          </li>
        {/each}
        {#if results.length === 0}
          <li class="no-results">No matches for "{query}"</li>
        {/if}
      </ul>
    </div>
  {/if}
</dialog>

<style>
  .palette {
    border: 0;
    padding: 0;
    background: var(--color-surface-raised);
    color: var(--color-text-primary);
    border-radius: var(--card-radius);
    width: min(640px, 92vw);
    max-height: 70vh;
    overflow: hidden;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.24);
    /* Re-center: <dialog> default margin is browser-set; explicit margin auto
       centers it horizontally. Vertical position depends on UA. */
    margin: 12vh auto auto;
  }

  .palette::backdrop {
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
  }

  /* @starting-style entry — Chromium 117+. Older browsers skip the animation. */
  @supports (transition-behavior: allow-discrete) {
    .palette {
      transition:
        opacity 200ms ease-out,
        transform 200ms cubic-bezier(0.16, 1, 0.3, 1),
        overlay 200ms allow-discrete,
        display 200ms allow-discrete;
    }
    @starting-style {
      .palette[open] {
        opacity: 0;
        transform: translateY(-8px);
      }
    }
  }

  :global(html[data-motion="reduced"]) .palette {
    transition: none !important;
  }

  .palette-inner {
    display: flex;
    flex-direction: column;
    max-height: 70vh;
  }

  .palette-head {
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
    padding: var(--p-space-4);
    border-bottom: var(--card-border);
  }

  .palette-icon {
    color: var(--color-text-secondary);
    flex-shrink: 0;
    display: inline-flex;
  }

  .palette-head input {
    flex: 1;
    appearance: none;
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--color-text-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-lead);
    line-height: 1.4;
  }

  .palette-head input::placeholder {
    color: var(--color-text-tertiary);
  }

  .kbd-hint {
    background: var(--color-surface-sunken);
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    padding: 2px 8px;
    border-radius: var(--radius-xs);
    border: 1px solid var(--color-border-hairline);
  }

  .results {
    list-style: none;
    margin: 0;
    padding: var(--p-space-2);
    overflow-y: auto;
    flex: 1;
  }

  .result {
    appearance: none;
    background: transparent;
    border: 0;
    width: 100%;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    display: grid;
    grid-template-columns: 90px 1fr auto;
    align-items: center;
    gap: var(--p-space-3);
    padding: var(--p-space-3) var(--p-space-4);
    border-radius: var(--radius-sm);
  }

  .result.is-selected {
    background: var(--color-surface-sunken);
  }

  .r-kind {
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
  }

  .result[data-kind="decision"] .r-kind { color: var(--color-decision); }
  .result[data-kind="error"]    .r-kind { color: var(--color-error); }
  .result[data-kind="question"] .r-kind { color: var(--color-question); }
  .result[data-kind="milestone"] .r-kind { color: var(--color-accent-primary); }
  .result[data-kind="subagent"]  .r-kind { color: var(--color-text-primary); }
  .result[data-kind="lesson"]   .r-kind { color: var(--color-accent-secondary); }
  .result[data-kind="fix"]      .r-kind { color: var(--color-success); }

  .r-label {
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .r-context {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    white-space: nowrap;
  }

  .no-results {
    padding: var(--p-space-5);
    text-align: center;
    color: var(--color-text-tertiary);
    font-style: italic;
  }
</style>
