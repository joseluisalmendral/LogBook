<!--
  SubAgentIndex — per-session bird's-eye legend of every sub-agent delegated in
  the chapter (slice 32).

  A session can fan out to many sub-agents (e.g. tendr-landing's l16-fase4 has
  13). As `subagent_complete` cards they get lost among hundreds of
  claude_message rows. This block sits near the TOP of the chapter view and
  lists every delegated agent so the reader can scan and jump.

  Data: derived from the chapter's events (those with
  `type === "subagent_complete"`). Each carries `payload.agent`
  (subagent_type / display name), `payload.promptSummary`, `payload.tools`,
  and `payload.filesTouched`. No backend schema change — purely a read.

  Interaction: clicking a row navigates to `#/...?event=<id>` and the existing
  selection store (ChapterPlayer's pulse subscriber) scrolls the card into
  view + pulses it. We reuse the same router/selection plumbing the cards use.

  Empty state: renders nothing when the session delegated to zero sub-agents.
-->
<script lang="ts">
  import type { RenderEvent } from "../types";
  import { router } from "../stores/router";
  import { selection } from "../stores/selection";

  interface Props {
    events: RenderEvent[];
  }

  const { events }: Props = $props();

  interface IndexEntry {
    id: string;
    name: string;
    summary: string;
    toolCount: number;
    fileCount: number;
  }

  const entries = $derived.by<IndexEntry[]>(() => {
    return events
      .filter((e) => e.type === "subagent_complete")
      .map((e) => {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const name = typeof p.agent === "string" ? p.agent : (e.title ?? "Sub-agent");
        const summary = typeof p.promptSummary === "string" ? p.promptSummary : "";
        const toolCount = Array.isArray(p.tools) ? p.tools.length : 0;
        const fileCount = Array.isArray(p.filesTouched) ? p.filesTouched.length : 0;
        return { id: e.id, name, summary, toolCount, fileCount };
      });
  });

  function jumpTo(id: string): void {
    // Mirror SubAgentCard.toggleExpand wiring: set selection + push the
    // ?event=<id> query so ChapterPlayer's selection subscriber scrolls +
    // pulses the matching card.
    const route = router.get();
    if (route.name === "chapter") {
      selection._setFromRoute("chapter", id);
      router.navigate({ name: "chapter", chapterId: route.chapterId, eventId: id });
    } else {
      // Fallback: scroll directly to the anchor if we're somehow not on a
      // chapter route.
      const el = document.getElementById(`event-${id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
</script>

{#if entries.length > 0}
  <aside class="subagent-index" data-testid="subagent-index" aria-label="Delegated sub-agents">
    <header class="index-head">
      <span class="index-icon" aria-hidden="true">🤖</span>
      <h2 class="index-title">Sub-agents ({entries.length})</h2>
    </header>
    <ul class="index-list">
      {#each entries as entry (entry.id)}
        <li>
          <button
            type="button"
            class="index-row"
            data-interactive
            onclick={() => jumpTo(entry.id)}
            title={entry.summary || entry.name}
          >
            <span class="row-icon" aria-hidden="true">🤖</span>
            <span class="row-name">{entry.name}</span>
            {#if entry.summary}
              <span class="row-summary">{entry.summary}</span>
            {/if}
            <span class="row-badges" aria-hidden="true">
              {#if entry.toolCount > 0}
                <span class="row-badge">{entry.toolCount}&nbsp;tool{entry.toolCount === 1 ? "" : "s"}</span>
              {/if}
              {#if entry.fileCount > 0}
                <span class="row-badge">{entry.fileCount}&nbsp;file{entry.fileCount === 1 ? "" : "s"}</span>
              {/if}
            </span>
            <span class="row-jump" aria-hidden="true">↘</span>
          </button>
        </li>
      {/each}
    </ul>
  </aside>
{/if}

<style>
  /*
   * Paper Brutalism: square-ish corners, teal accent (matches SubAgentCard's
   * --color-subagent), tinted teal surface so the whole block reads as the
   * "delegated agents" register, distinct from the ember Claude stream.
   */
  .subagent-index {
    margin: var(--p-space-4) 0 var(--p-space-5);
    background: color-mix(in srgb, var(--color-subagent) 6%, var(--color-surface-raised));
    border: 1px solid color-mix(in srgb, var(--color-subagent) 30%, transparent);
    border-left: 6px solid var(--color-subagent);
    border-radius: var(--p-radius-accent);
    padding: var(--p-space-3) var(--p-space-4);
  }

  .index-head {
    display: flex;
    align-items: center;
    gap: var(--p-space-2);
    margin-bottom: var(--p-space-3);
  }

  .index-icon {
    font-size: 18px;
    line-height: 1;
    font-family:
      "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  }

  .index-title {
    margin: 0;
    font-family: var(--font-headline);
    font-size: var(--font-size-meta);
    color: var(--color-text-primary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }

  .index-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .index-row {
    appearance: none;
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    display: flex;
    align-items: baseline;
    gap: var(--p-space-2);
    padding: var(--p-space-2) var(--p-space-2);
    border-radius: var(--radius-xs);
    transition: background 150ms ease-out;
  }

  .index-row:hover,
  .index-row:focus-visible {
    background: color-mix(in srgb, var(--color-subagent) 12%, transparent);
    outline: none;
  }

  .index-row:focus-visible {
    outline: 2px solid var(--color-subagent);
    outline-offset: -2px;
  }

  .row-icon {
    flex-shrink: 0;
    font-size: 13px;
    line-height: 1;
    align-self: center;
    font-family:
      "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  }

  .row-name {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--color-subagent);
    white-space: nowrap;
  }

  .row-summary {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-badges {
    flex-shrink: 0;
    display: inline-flex;
    gap: var(--p-space-1);
  }

  .row-badge {
    display: inline-flex;
    align-items: center;
    font-size: var(--font-size-caption);
    background: color-mix(in srgb, var(--color-subagent) 10%, var(--color-surface-sunken));
    color: var(--color-text-secondary);
    border-radius: var(--radius-xs);
    padding: 1px 6px;
    white-space: nowrap;
  }

  .row-jump {
    flex-shrink: 0;
    color: var(--color-subagent);
    opacity: 0.6;
    font-size: var(--font-size-caption);
  }

  .index-row:hover .row-jump,
  .index-row:focus-visible .row-jump {
    opacity: 1;
  }

  :global(html[data-motion="reduced"]) .index-row {
    transition: none;
  }
</style>
