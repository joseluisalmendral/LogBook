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
    /** Legible label: native tools = name, MCP tools = "server · tool". */
    displayName?: string;
    /** True when `name` is an `mcp__server__tool` identifier. */
    isMcp?: boolean;
    /** Cleaned MCP server label (e.g. "engram"); MCP tools only. */
    mcpServer?: string;
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

  // Slice-28: thinking-marker variant. Reads both top-level and payload
  // because render-context's normalize sometimes flattens and sometimes
  // doesn't (depends on the writer). Marker is BEAT-only — Anthropic
  // encrypts the body so there's no content to render.
  const isThinking = $derived(
    (event as { isThinking?: boolean }).isThinking === true ||
      evPayload["isThinking"] === true,
  );
  const thinkingEncrypted = $derived(
    (event as { thinkingEncrypted?: boolean }).thinkingEncrypted !== false &&
      evPayload["thinkingEncrypted"] !== false,
  );

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

  /**
   * Slice-27: explicit inspector button. Click ONLY this small icon to open
   * the right-side inspector with raw JSON. The bubble body is no longer
   * a giant click target — clicking on the markdown / tool chips / strips
   * never opens the inspector now.
   */
  function openInspectorWithSelection(e: MouseEvent): void {
    e.stopPropagation();
    inspector.open(event.id);
    const route = router.get();
    if (route.name === "chapter") {
      selection._setFromRoute("chapter", event.id);
      router.navigate({ name: "chapter", chapterId: route.chapterId, eventId: event.id });
    }
  }
</script>

<!--
  Slice-27: the root is now a passive <div>. The previous role="button" +
  onclick={openInspectorWithSelection} pattern made the bubble a giant
  click target — clicking on markdown text, tool chips, file strips, or
  any inner element fired the parent handler and the inspector kept
  popping up unexpectedly. Inspector access lives in the explicit icon
  button in the eyebrow. Expand lives in the chevron button. Everything
  else is read-only content.
-->
<!--
  Slice 28 thinking-marker fork: a thinking turn renders as a compact
  inline marker instead of a full bubble. Anthropic encrypts the
  thinking body, so there's no content to show; the marker still
  surfaces the BEAT (timestamp + visual pulse) so the audience can
  follow the conversation pace.
-->
{#if isThinking}
  <div
    class="thinking-marker lb-snap-target"
    data-testid="claude-thinking-marker"
    data-event-id={event.id}
    data-thinking="true"
  >
    <span class="thinking-glyph" aria-hidden="true">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true">
        <g transform="translate(10 10)">
          <ellipse rx="1.2" ry="8" transform="rotate(0)" />
          <ellipse rx="1.2" ry="8" transform="rotate(45)" />
          <ellipse rx="1.2" ry="8" transform="rotate(90)" />
          <ellipse rx="1.2" ry="8" transform="rotate(135)" />
          <circle r="2.4" />
        </g>
      </svg>
    </span>
    <span class="thinking-label">Claude reasoning</span>
    <span class="thinking-meta">{thinkingEncrypted ? "encrypted" : "internal"}</span>
    <span class="thinking-time lb-tnum">{formatTime(event.ts)}</span>
  </div>
{:else}
<div
  class="claude-message-row lb-snap-target"
  data-testid="claude-message-row"
  data-event-id={event.id}
  data-expanded={expanded}
>
  <div class="bubble">
    <header class="eyebrow">
      <!--
        Slice-28: official Claude burst mark (the organic 11-ray sunburst
        Anthropic uses across product chrome and press kit). Each ray is
        a tapered shape drawn from the center, with slight angular and
        length variation so the burst feels hand-drawn rather than
        geometric.

        Geometry: viewBox 100x100; rays radiate from the origin (50,50).
        Each path is a quadrilateral with a rounded tip — `stroke-linecap`
        isn't enough, so we draw the silhouette explicitly. The angles
        cycle every ~33° (≈360 ÷ 11) with intentional ±3° jitter for
        organic feel.

        Fill = currentColor so the avatar inherits whatever the parent
        sets (Claude Ember in normal use; muted graphite when thinking).
      -->
      <span class="avatar" aria-hidden="true">
        <svg viewBox="0 0 100 100" width="26" height="26" fill="currentColor" aria-hidden="true">
          <!--
            Slice-28 take 2: thicker, more organic Claude burst.
            Each ray = ellipse rotated around the center. Combining
            ellipses (which the browser unions visually under same fill)
            gives the fat hand-drawn petal silhouette of the real mark.
            11 rays with slight length / thickness variation.
          -->
          <g transform="translate(50 50)">
            <ellipse rx="5"   ry="42" cy="-5"  transform="rotate(0)" />
            <ellipse rx="4.5" ry="38" cy="-6"  transform="rotate(33)" />
            <ellipse rx="5"   ry="40" cy="-5"  transform="rotate(63)" />
            <ellipse rx="4.5" ry="36" cy="-7"  transform="rotate(97)" />
            <ellipse rx="5"   ry="42" cy="-5"  transform="rotate(125)" />
            <ellipse rx="4.5" ry="38" cy="-6"  transform="rotate(158)" />
            <ellipse rx="5"   ry="40" cy="-5"  transform="rotate(192)" />
            <ellipse rx="4.5" ry="38" cy="-7"  transform="rotate(225)" />
            <ellipse rx="5"   ry="42" cy="-5"  transform="rotate(258)" />
            <ellipse rx="4.5" ry="36" cy="-6"  transform="rotate(290)" />
            <ellipse rx="5"   ry="38" cy="-5"  transform="rotate(325)" />
            <!-- Central anchor blob slightly off-center for organic feel. -->
            <circle r="9" cy="1" cx="0.5" />
          </g>
        </svg>
      </span>
      <span class="who">Claude</span>
      <span class="time lb-tnum">{formatTime(event.ts)}</span>
      <!-- Spacer pushes the eyebrow controls to the right edge. -->
      <span class="eyebrow-spacer"></span>
      <!--
        Slice-27: inspector icon — explicit, low-emphasis, only visible
        on hover/focus of the bubble (CSS reveals it). Click opens the
        right-side inspector with raw JSON. Replaces the previous
        bubble-wide click handler.
      -->
      <button
        type="button"
        class="inspector-icon-btn"
        aria-label="Open raw event in inspector"
        title="Open in inspector"
        onclick={openInspectorWithSelection}
        data-interactive
        data-testid="claude-msg-inspector"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M8 1.5 L14.5 4.75 L14.5 11.25 L8 14.5 L1.5 11.25 L1.5 4.75 Z" />
          <line x1="8" y1="8" x2="14.5" y2="4.75" />
          <line x1="8" y1="8" x2="1.5" y2="4.75" />
          <line x1="8" y1="8" x2="8" y2="14.5" />
        </svg>
      </button>
      {#if hasStrips}
        <!--
          Slice-27: larger, more accessible "Show tools" toggle. Visible
          label (not just an icon) + chip-style pill so the affordance is
          obvious. Replaces the small chevron-only icon button that users
          reported as invisible / hard to find.
        -->
        <button
          type="button"
          class="toggle-tools-btn"
          aria-expanded={expanded}
          aria-controls={regionId}
          aria-label={expanded ? "Hide tool activity" : "Show tool activity"}
          onclick={toggleExpand}
          onkeydown={toggleKey}
          data-interactive
          data-testid="claude-msg-toggle"
        >
          <span class="toggle-label">{expanded ? "Hide" : "Show"} activity</span>
          <span class="toggle-count lb-tnum">{toolStrip.length + (filesTouched.length > 0 ? 1 : 0)}</span>
          <svg class="toggle-chevron" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="4 6 8 10 12 6" />
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
                    {@const toolLabel = t.displayName ?? t.name}
                    {@const mcpTitle = t.isMcp ? `MCP · ${t.mcpServer ?? "mcp"} · ${t.name}` : t.name}
                    {#if hasDetail}
                      <li class="tool-chip">
                        <details class="tool-details">
                          <summary class="tool-summary" title={t.file_path ? `${mcpTitle} · ${t.file_path}` : mcpTitle}>
                            {#if t.isMcp}{@render brainIcon(t.mcpServer ?? "mcp")}{/if}
                            <code class="tool-name" class:tool-name-mcp={t.isMcp}>{toolLabel}</code>
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
                      <li class="tool-chip tool-chip-static" title={mcpTitle}>
                        {#if t.isMcp}{@render brainIcon(t.mcpServer ?? "mcp")}{/if}
                        <code class="tool-name" class:tool-name-mcp={t.isMcp}>{toolLabel}</code>
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
{/if}

<!--
  Brain glyph marking MCP / engram tool calls. Inline SVG keeps the Paper
  Brutalism look crisp at any zoom. currentColor inherits the accent so it
  matches `.tool-name-mcp`. aria-label gives screen readers the MCP context.
-->
{#snippet brainIcon(server: string)}
  <svg
    class="tool-mcp-icon"
    viewBox="0 0 24 24"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    role="img"
    aria-label={`MCP · ${server}`}
  >
    <path d="M9 3a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0-1 4.8A2.5 2.5 0 0 0 6 15a2.5 2.5 0 0 0 3 2.5V3Z" />
    <path d="M15 3a2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 1 1 4.8A2.5 2.5 0 0 1 18 15a2.5 2.5 0 0 1-3 2.5V3Z" />
    <path d="M9 9h1.5M15 9h-1.5M9 13h1M15 13h-1" />
  </svg>
{/snippet}

<style>
  /*
   * Slice 30 — Paper Brutalism update.
   *   - Bubble corners 0 (was 0 via token, restating explicitly for audit).
   *   - LEFT BORDER 3px Claude Ember accent — paper-folder feel.
   *   - Top/bottom/right borders are 1px Inkwell Violet hairline @ 16%.
   *   - No soft shadow; a 2px hard drop shadow on the editorial side
   *     (visible only when expanded, see [data-expanded="true"] rule).
   */
  .claude-message-row {
    display: flex;
    justify-content: flex-start;
    margin: var(--p-space-4) 0;
  }

  .bubble {
    background: var(--color-surface-raised);
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 16%, transparent);
    border-left: 4px solid var(--color-accent-primary);
    border-radius: var(--p-radius-accent);
    padding: var(--p-space-4) var(--p-space-5);
    max-width: 760px;
    width: fit-content;
    transition: box-shadow 280ms cubic-bezier(0.22, 1, 0.36, 1),
                transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .claude-message-row[data-expanded="true"] .bubble {
    box-shadow: 4px 4px 0 0 color-mix(in srgb, var(--color-text-primary) 14%, transparent);
    transform: translateY(-1px);
  }

  .eyebrow {
    display: flex;
    align-items: center;
    gap: var(--p-space-2);
    margin-bottom: var(--p-space-2);
  }

  /*
   * Slice-27: Anthropic sparkle stands alone (no circular pill / border).
   * Closer to how Anthropic uses its mark in product chrome. The accent
   * color comes from the theme variable so it tints orange-ish in light
   * mode and a softer hue in dark.
   */
  .avatar {
    width: 24px;
    height: 24px;
    color: var(--color-accent-primary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
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
  }

  .eyebrow-spacer {
    flex: 1;
  }

  /*
   * Slice-27: inspector icon button — small, secondary affordance. Sits in
   * the eyebrow to the left of the activity toggle. Stays subtle until
   * hover/focus so it doesn't compete with the avatar / who / time line
   * for attention.
   */
  .inspector-icon-btn {
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    color: var(--color-text-tertiary);
    padding: 4px;
    border-radius: 4px;     /* Slice 30: editorial 4px (DESIGN.md exception) */
    cursor: pointer;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color 160ms ease-out, background 160ms ease-out, border-color 160ms ease-out;
    opacity: 0.6;
  }

  .inspector-icon-btn:hover,
  .inspector-icon-btn:focus-visible {
    color: var(--color-accent-primary);
    background: var(--color-surface-sunken);
    border-color: var(--color-border-hairline);
    opacity: 1;
  }

  .inspector-icon-btn:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 2px;
  }

  /*
   * Slice-27: primary "Show activity" toggle. Pill-shaped with a visible
   * label + count + rotating chevron — the affordance the user reported
   * missing in slices 21–25 (the icon-only chevron was easy to miss).
   * Rotates on aria-expanded="true". Reduced-motion zeroes the
   * transition.
   */
  .toggle-tools-btn {
    appearance: none;
    background: var(--color-surface-sunken);
    border: 1px solid var(--color-border-hairline);
    color: var(--color-text-secondary);
    padding: 4px 10px 4px 12px;
    border-radius: 4px;     /* Slice 30: editorial 4px (DESIGN.md exception) */
    cursor: pointer;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-body);
    font-size: var(--font-size-caption);
    font-weight: 600;
    line-height: 1.2;
    transition: background 160ms ease-out, color 160ms ease-out, border-color 160ms ease-out;
  }

  .toggle-tools-btn:hover,
  .toggle-tools-btn:focus-visible {
    background: color-mix(in srgb, var(--color-accent-primary) 10%, var(--color-surface-sunken));
    color: var(--color-text-primary);
    border-color: color-mix(in srgb, var(--color-accent-primary) 40%, var(--color-border-hairline));
  }

  .toggle-tools-btn[aria-expanded="true"] {
    background: color-mix(in srgb, var(--color-accent-primary) 16%, var(--color-surface-sunken));
    color: var(--color-accent-primary);
    border-color: color-mix(in srgb, var(--color-accent-primary) 56%, var(--color-border-hairline));
  }

  .toggle-tools-btn:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 2px;
  }

  .toggle-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 16px;
    padding: 0 4px;
    border-radius: 4px;     /* Slice 30: editorial 4px (DESIGN.md exception) */
    background: color-mix(in srgb, var(--color-text-primary) 6%, var(--color-surface));
    font-size: 10px;
    font-weight: 700;
    color: var(--color-text-secondary);
  }

  .toggle-tools-btn[aria-expanded="true"] .toggle-count {
    background: color-mix(in srgb, var(--color-accent-primary) 22%, var(--color-surface));
    color: var(--color-accent-primary);
  }

  .toggle-chevron {
    transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
    color: currentColor;
  }

  .toggle-tools-btn[aria-expanded="true"] .toggle-chevron {
    transform: rotate(180deg);
  }

  :global(html[data-motion="reduced"]) .inspector-icon-btn,
  :global(html[data-motion="reduced"]) .toggle-tools-btn,
  :global(html[data-motion="reduced"]) .toggle-chevron {
    transition: none;
  }

  .body {
    color: var(--color-text-primary);
  }

  /* Collapsible region — ADR-SC-B1 idiom: grid-template-rows 0fr → 1fr.
     Hidden by default; revealed when [data-expanded="true"]. */
  /* Slice 31: fluid editorial expand (matches SubAgentCard). 420ms ease,
     panel cap min(48vh, 520px) with thin scrollbar, content fade-in. */
  .expand-grid {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 420ms cubic-bezier(0.22, 1, 0.36, 1);
    margin-top: var(--p-space-3);
  }
  .claude-message-row[data-expanded="true"] .expand-grid {
    grid-template-rows: 1fr;
  }
  /*
   * Slice 31.1: panel grows freely; only the per-tool .tool-output
   * (which is already capped at 16rem) scrolls. Keeps the activity
   * list compact when collapsed, but doesn't trap the user inside a
   * mini-scrollbox when expanded.
   */
  .expand-inner {
    overflow: hidden;
    min-height: 0;
  }
  .meta-strips {
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 360ms cubic-bezier(0.22, 1, 0.36, 1) 60ms,
                transform 420ms cubic-bezier(0.22, 1, 0.36, 1) 40ms;
  }
  .claude-message-row[data-expanded="true"] .meta-strips {
    opacity: 1;
    transform: translateY(0);
  }
  :global(html[data-motion="reduced"]) .meta-strips {
    transition: none;
    opacity: 1;
    transform: none;
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
    display: flex;
    align-items: center;
    gap: 0.4rem;
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

  /* MCP tool label: keep accent but distinguish the legible "server · tool"
     form. Brain icon sits flush before it (see .tool-mcp-icon). */
  .tool-name-mcp {
    font-style: normal;
  }

  /* Brain glyph for MCP / engram calls. Subtle accent tint, aligned with the
     caption baseline. 150ms transition per LogBook motion budget; honors
     prefers-reduced-motion. */
  .tool-mcp-icon {
    flex-shrink: 0;
    color: var(--color-accent-primary);
    opacity: 0.85;
    vertical-align: text-bottom;
    transition: opacity 150ms ease, transform 150ms ease;
  }

  .tool-summary:hover .tool-mcp-icon,
  .tool-chip-static:hover .tool-mcp-icon {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .tool-mcp-icon {
      transition: none;
    }
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

  /*
   * Slice-28 thinking marker — compact beat-only row used when a
   * claude_message represents an encrypted-by-Anthropic thinking
   * pause. Centered, dashed border, dim accent. Pulses subtly
   * (reduced-motion safe) so the audience perceives the beat.
   */
  .thinking-marker {
    display: inline-flex;
    align-items: center;
    gap: var(--p-space-2);
    margin: var(--p-space-2) auto;
    padding: 6px 12px;
    border: 1px dashed color-mix(in srgb, var(--color-accent-primary) 32%, var(--color-border-hairline));
    background: color-mix(in srgb, var(--color-accent-primary) 4%, var(--color-surface));
    color: color-mix(in srgb, var(--color-accent-primary) 80%, var(--color-text-secondary));
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    align-self: center;
    width: fit-content;
  }

  /*
   * Slice 29.0: the glyph is STATIC. The slice-28 pulse animation was
   * visually noisy and pulled attention away from the conversation
   * proper. The Claude burst now sits in its final state and lets the
   * dashed border + label carry the "thinking beat" message.
   */
  .thinking-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-accent-primary);
    opacity: 0.85;
  }

  .thinking-label {
    color: inherit;
    font-weight: 700;
  }

  .thinking-meta {
    color: var(--color-text-tertiary);
    font-weight: 400;
  }

  .thinking-time {
    color: var(--color-text-tertiary);
    margin-left: var(--p-space-2);
  }

  :global(html[data-motion="reduced"]) .thinking-glyph {
    opacity: 0.7;
  }
</style>
