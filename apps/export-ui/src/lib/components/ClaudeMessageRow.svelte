<!--
  ClaudeMessageRow — slice 21 P2 (R-85, R-90, R-92, ADR-SN-D1).

  Renders a `claude_message` event as a left-aligned chat bubble. Below the
  body, two collapsible affordances:
    1. Tool-call strip (inline chip row) driven by payload.toolStrip
    2. FileChangeStrip atom driven by payload.filesTouched

  Both are HIDDEN by default; clicking the chevron toggles `is-expanded`
  which reveals them. The body markdown is always visible (it's the
  primary narrative — the strips are supporting detail).

  Overflow (R-90): when payload.overflow.count > 0 (or
  payload.toolStripOverflow > 0) the strip shows a "+N more" affordance.
  The backend has already truncated the array to the first 8 entries; we
  just surface the count.

  Accessibility:
    - role="button" / aria-expanded on the chevron toggle
    - data-event-id + data-testid for scrubber + R-68 selection sync
    - lb-snap-target for the global scroll-snap

  Reduced-motion: instant expand (no clip-path animation). The chevron
  rotation is a state indicator, kept under both motion modes.

  Inline tool chip rationale (ADR-SN-D1 option a): the existing
  ToolCallStrip atom is a single-tool collapsible — not an array
  consumer. Inlining the chip row here keeps the PR-21B footprint small.
  If a second consumer needs the strip we promote it then.
-->
<script lang="ts">
  import type { RenderEvent, FileTouch } from "../types";
  import { inspector } from "../stores/inspector";
  import { selection } from "../stores/selection";
  import { router } from "../stores/router";
  import { payload as dataPayload } from "../stores/data";
  import MarkdownBlock from "./MarkdownBlock.svelte";
  import FileChangeStrip from "./FileChangeStrip.svelte";
  import { wrapPathsForBlur } from "../stores/teaching-prefs";

  interface ToolStripEntry {
    name: string;
    file_path?: string;
    toolUseId?: string;
    /** Slice-24: 1-line summary (command / file / pattern / url / etc.) */
    input?: string;
    /** Slice-24: truncated tool_response preview (≤500 chars). */
    outputPreview?: string;
  }

  interface Props {
    event: RenderEvent;
  }

  const { event }: Props = $props();

  const body = $derived(dataPayload.bodies[event.id]);

  const evPayload = $derived((event.payload ?? {}) as Record<string, unknown>);

  const toolStrip = $derived<ToolStripEntry[]>(
    Array.isArray(evPayload.toolStrip)
      ? (evPayload.toolStrip as ToolStripEntry[]).filter(
          (t) => t && typeof t.name === "string",
        )
      : [],
  );

  const filesTouched = $derived<FileTouch[]>(
    Array.isArray(evPayload.filesTouched)
      ? (evPayload.filesTouched as unknown[]).flatMap((f) => {
          // payload.filesTouched on a claude_message is either an array of
          // FileTouch objects OR (on slim) an array of strings (just paths).
          if (typeof f === "string") {
            return [{ path: f, action: "edit" as const }];
          }
          if (
            f &&
            typeof (f as FileTouch).path === "string" &&
            typeof (f as FileTouch).action === "string"
          ) {
            return [f as FileTouch];
          }
          return [];
        })
      : [],
  );

  /**
   * Overflow count for R-90. Backend writes `payload.overflow = { of: N }`
   * when the original tool list exceeded 12 entries (truncated to 8 + N).
   * Some older shapes use `payload.toolStripOverflow: number` — we accept
   * both for forward-compat.
   */
  const overflowCount = $derived.by(() => {
    const overflowField = evPayload.overflow;
    if (
      overflowField &&
      typeof overflowField === "object" &&
      typeof (overflowField as { of?: number }).of === "number"
    ) {
      return (overflowField as { of: number }).of;
    }
    if (typeof evPayload.toolStripOverflow === "number") {
      return evPayload.toolStripOverflow;
    }
    return 0;
  });

  const hasStrips = $derived(toolStrip.length > 0 || filesTouched.length > 0);

  let expanded = $state(false);
  const regionId = $derived(`claude-message-region-${event.id}`);

  function formatTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function basename(p: string): string {
    const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return idx >= 0 ? p.slice(idx + 1) : p;
  }

  function toggleExpand(e: MouseEvent): void {
    e.stopPropagation();
    expanded = !expanded;
  }

  function toggleKey(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      expanded = !expanded;
    }
  }

  function openInspectorWithSelection(): void {
    inspector.open(event.id);
    const route = router.get();
    if (route.name === "chapter") {
      selection._setFromRoute("chapter", event.id);
      router.navigate({ name: "chapter", chapterId: route.chapterId, eventId: event.id });
    }
  }

  function onBubbleKey(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openInspectorWithSelection();
    }
  }
</script>

<div
  class="claude-message-row lb-snap-target"
  data-testid="claude-message-row"
  data-event-id={event.id}
  data-expanded={expanded}
  data-thinking={
    ((event as { isThinking?: boolean }).isThinking === true ||
      (event.payload as Record<string, unknown> | undefined)?.["isThinking"] === true)
      ? "true" : "false"
  }
  data-interactive
  role="button"
  tabindex="0"
  aria-label="Claude message"
  onclick={openInspectorWithSelection}
  onkeydown={onBubbleKey}
>
  <div class="bubble">
    <header class="eyebrow">
      <!--
        Slice-25: replaced the "C" monogram with the Claude orbit glyph
        (Anthropic's open public mark — a centered dot with a soft halo).
        Renders entirely inline so it works in dark/light mode via
        currentColor. Sized 22px to match the previous avatar footprint.
      -->
      <span class="avatar" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
          <path d="M5.9 17 11.3 7.5 13.6 7.5 8.1 17 5.9 17ZM12.6 17 18 7.5 20.3 7.5 14.8 17 12.6 17ZM6.5 7.5l1.5 0 0 9.5L6.5 17 6.5 7.5ZM17.5 7.5l1.5 0 0 9.5-1.5 0L17.5 7.5Z" fill="currentColor" opacity="0.92" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
        </svg>
      </span>
      <span class="who">Claude</span>
      <span class="time lb-tnum">{formatTime(event.ts)}</span>
      {#if hasStrips}
        <button
          type="button"
          class="lb-chevron toggle-btn"
          aria-expanded={expanded}
          aria-controls={regionId}
          aria-label={expanded ? "Hide tool activity" : "Show tool activity"}
          onclick={toggleExpand}
          onkeydown={toggleKey}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="5 3 11 8 5 13" />
          </svg>
        </button>
      {/if}
    </header>

    {#if body}
      <div class="body">
        <MarkdownBlock {body} />
      </div>
    {/if}

    {#if hasStrips}
      <div class="expand-grid" id={regionId} role="region" aria-label="Tool activity">
        <div class="expand-inner">
          <div class="meta-strips">
            {#if toolStrip.length > 0}
              <section class="strip-section" aria-label="Tool calls">
                <h4 class="strip-title">Tools called</h4>
                <!--
                  Slice-24: each chip is a self-contained collapsible row.
                  Compact face shows: tool name + 1-line input summary
                  (command / file / pattern / etc.). When `outputPreview`
                  is available, chip becomes a <details> that reveals the
                  truncated tool response in a code block.
                -->
                <ul class="tool-chips" data-testid="claude-tool-strip">
                  {#each toolStrip as t}
                    {@const displayLabel = t.file_path ? basename(t.file_path) : (t.input ?? "")}
                    {@const hasDetail = (t.outputPreview ?? "").length > 0 || (t.input ?? "").length > 0}
                    {#if hasDetail}
                      <li class="tool-chip">
                        <details class="tool-details">
                          <summary class="tool-summary" title={t.file_path ? `${t.name} · ${t.file_path}` : t.name}>
                            <code class="tool-name">{t.name}</code>
                            {#if displayLabel}
                              <!--
                                Slice-25: paths in the chip face are wrapped
                                in `<span class="lb-path">` so the CSS in
                                app.css (gated on html[data-path-blur="true"])
                                can blur them for teaching mode. Hover lifts
                                the blur so presenters can verify silently.
                              -->
                              <span class="tool-input" dir="auto">{@html wrapPathsForBlur(displayLabel)}</span>
                            {/if}
                            <span class="tool-chevron" aria-hidden="true">▸</span>
                          </summary>
                          <div class="tool-body">
                            {#if t.input}
                              <p class="tool-field"><span class="tool-field-label">input</span><code class="tool-field-value">{@html wrapPathsForBlur(t.input)}</code></p>
                            {/if}
                            {#if t.file_path}
                              <p class="tool-field"><span class="tool-field-label">path</span><code class="tool-field-value">{@html wrapPathsForBlur(t.file_path)}</code></p>
                            {/if}
                            {#if t.outputPreview}
                              <p class="tool-field tool-field-output"><span class="tool-field-label">output</span></p>
                              <pre class="tool-output"><code>{@html wrapPathsForBlur(t.outputPreview)}</code></pre>
                            {/if}
                          </div>
                        </details>
                      </li>
                    {:else}
                      <li class="tool-chip tool-chip-static" title={t.name}>
                        <code class="tool-name">{t.name}</code>
                      </li>
                    {/if}
                  {/each}
                  {#if overflowCount > 0}
                    <li class="tool-chip chip-overflow" title={`${overflowCount} more tool call${overflowCount === 1 ? "" : "s"}`}>
                      +{overflowCount} more
                    </li>
                  {/if}
                </ul>
              </section>
            {/if}

            {#if filesTouched.length > 0}
              <section class="strip-section" aria-label="Files touched">
                <h4 class="strip-title">Files touched</h4>
                <FileChangeStrip files={filesTouched} ariaLabel="Files touched by this message" />
              </section>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .claude-message-row {
    display: flex;
    justify-content: flex-start;
    margin: var(--p-space-3) 0;
    cursor: pointer;
  }

  .bubble {
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-hairline);
    border-radius: var(--card-radius);
    padding: var(--p-space-3) var(--p-space-4);
    max-width: 720px;
    width: fit-content;
    box-shadow: 0 1px 0 var(--color-border-hairline);
    transition: border-color 200ms ease-out;
  }

  .claude-message-row:hover .bubble,
  .claude-message-row:focus-visible .bubble {
    border-color: color-mix(in srgb, var(--color-accent-primary) 40%, var(--color-border-hairline));
  }

  .claude-message-row:focus-visible {
    outline: none;
  }
  .claude-message-row:focus-visible .bubble {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 3px;
  }

  .eyebrow {
    display: flex;
    align-items: center;
    gap: var(--p-space-2);
    margin-bottom: var(--p-space-2);
  }

  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--color-surface-sunken);
    color: var(--color-accent-primary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 1px solid color-mix(in srgb, var(--color-accent-primary) 22%, var(--color-border-hairline));
  }

  .avatar svg {
    display: block;
  }

  .who {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }

  .time {
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
    margin-right: auto;
  }

  .toggle-btn {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--color-text-tertiary);
    padding: 2px;
    cursor: pointer;
    border-radius: var(--radius-xs);
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .toggle-btn:hover,
  .toggle-btn:focus-visible {
    color: var(--color-accent-primary);
    background: var(--color-surface-sunken);
  }
  .toggle-btn:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 1px;
  }

  .body {
    color: var(--color-text-primary);
  }

  /* Collapsible region — ADR-SC-B1 idiom: grid-template-rows 0fr → 1fr.
     Hidden by default; revealed when [data-expanded="true"]. */
  .expand-grid {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 250ms cubic-bezier(0.77, 0, 0.175, 1);
    margin-top: var(--p-space-3);
  }
  .claude-message-row[data-expanded="true"] .expand-grid {
    grid-template-rows: 1fr;
  }
  .expand-inner {
    overflow: hidden;
    min-height: 0;
  }

  /* Reduced-motion: instant expand. */
  :global(html[data-motion="reduced"]) .expand-grid {
    transition: none;
  }

  .meta-strips {
    display: flex;
    flex-direction: column;
    gap: var(--p-space-3);
    padding-top: var(--p-space-3);
    border-top: 1px solid var(--color-border-hairline);
  }

  .strip-title {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0 0 var(--p-space-2) 0;
    font-weight: 600;
  }

  /*
   * Slice-24: each tool chip is now a vertically-flowing collapsible row
   * instead of an inline pill. The strip stacks one-per-line so users see
   * the command/file inline without truncation. Click → expand to reveal
   * the truncated output preview in a code block.
   */
  .tool-chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--p-space-2);
  }

  .tool-chip {
    display: block;
    padding: 0;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-hairline);
    background: var(--color-surface-sunken);
    font-size: 0.82rem;
  }

  .tool-chip-static {
    padding: 0.35rem 0.6rem;
  }

  .tool-details {
    margin: 0;
  }

  .tool-summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.65rem;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }

  .tool-summary::-webkit-details-marker {
    display: none;
  }

  .tool-summary:hover {
    background: color-mix(in srgb, var(--color-accent-primary) 6%, var(--color-surface-sunken));
  }

  .tool-name {
    color: var(--color-accent-primary);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    background: transparent;
    padding: 0;
    flex-shrink: 0;
  }

  .tool-input {
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .tool-chevron {
    color: var(--color-text-tertiary);
    transition: transform 180ms ease-out;
    font-size: 0.7rem;
    flex-shrink: 0;
  }

  .tool-details[open] .tool-chevron {
    transform: rotate(90deg);
  }

  .tool-body {
    padding: 0.35rem 0.65rem 0.65rem 0.65rem;
    border-top: 1px dashed var(--color-border-hairline);
    background: color-mix(in srgb, var(--color-text-primary) 2%, var(--color-surface-sunken));
  }

  .tool-field {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0.3rem 0;
    font-size: var(--font-size-caption);
  }

  .tool-field-output {
    margin-top: 0.6rem;
  }

  .tool-field-label {
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.65rem;
    flex-shrink: 0;
    min-width: 3.5rem;
  }

  .tool-field-value {
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    background: transparent;
    padding: 0;
    word-break: break-all;
    font-size: var(--font-size-caption);
  }

  .tool-output {
    margin: 0.2rem 0 0 0;
    padding: 0.5rem 0.65rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border-hairline);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    line-height: 1.45;
    overflow-x: auto;
    max-height: 16rem;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tool-output code {
    background: transparent;
    padding: 0;
    font: inherit;
    color: inherit;
  }

  .chip-overflow {
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
    background: transparent;
    border-style: dashed;
    padding: 0.35rem 0.65rem;
  }

  :global(html[data-motion="reduced"]) .tool-chevron {
    transition: none;
  }

  /* Mobile (R-92): full-width bubble, tighter padding. */
  @media (max-width: 767px) {
    .bubble {
      max-width: 100%;
      width: 100%;
      padding: var(--p-space-3);
    }
  }
</style>
