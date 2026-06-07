<!--
  SubAgentCard — slice 12 P2 (R-56, R-57, R-58, R-59, INV-15 M1).

  Pattern: compact-then-expand inline (Graphite stacked-PR rows + Emil Kowalski
  clip-path reveal). Replaces slice 10's 3D card-flip (R-24 superseded by R-57).

  COMPACT ROW (default state)
    Single line: colored left-border (var(--color-subagent)) + monogram ⟳ +
    agent name + one-line summary peek + badge strip (skills / tools /
    duration) + always-visible chevron rotated by P1 affordance.css when
    [aria-expanded="true"].

  EXPAND MECHANISM (ADR-SC-B1)
    CSS Grid grid-template-rows: auto 0fr → auto 1fr (250ms,
    cubic-bezier(0.77, 0, 0.175, 1)) on the wrapper; inner content has
    overflow: hidden + clip-path: inset(0 0 100% 0) → inset(0) for the
    Kowalski reveal (R-58 / brief pattern #6). No JS height measurement.

  MOMENT 1 — sub-agent deploy entrance (INV-15 M1)
    When the card first scrolls into the viewport, an IntersectionObserver
    triggers a staggered reveal: outer card clip-path inset(100% 0 0 0) → 0
    over 280ms + color bleed-in via pseudo-element (50ms delay) + child
    content stagger (30ms each, capped). Total perceived 400ms.
    Skipped under reduced-motion AND when keyboard focus drives the mount
    (we gate with `:focus-visible` inside the entrance selector so focused
    navigation does not animate the entrance).

  REDUCED-MOTION (R-58 / R-59 / INV-15)
    html[data-motion="reduced"]:
      - Expand: instant (grid-template-rows snaps to auto 1fr, clip-path: inset(0)).
      - Entrance Moment 1: skipped (card appears in final state).
      - Chevron rotation: kept (it is a state indicator, not delight motion).

  ACCESSIBILITY
    - Toggle is a real <button>, aria-expanded, aria-controls referencing the
      expanded region.
    - Expanded container is role="region" with the id referenced by
      aria-controls.
    - Inspector affordance becomes a separate <button> in the expanded region
      (no nested-button anti-pattern).

  Flip implementation fully removed. R-24 superseded by R-57/R-58. AG-25
  enforces zero residue (verified by grep).
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { RenderEvent, FileTouch } from "../types";
  import MarkdownBlock from "./MarkdownBlock.svelte";
  import FileChangeStrip from "./FileChangeStrip.svelte";
  import { inspector } from "../stores/inspector";
  import { linkifyText } from "../util/deep-link";
  import { selection } from "../stores/selection";
  import { router } from "../stores/router";

  interface Props {
    event: RenderEvent;
  }

  const { event }: Props = $props();

  let expanded = $state(false);
  let inView = $state(false);
  let cardEl: HTMLElement | undefined;

  // Stable region id for aria-controls.
  const regionId = $derived(`sub-agent-region-${event.id}`);

  // Pull sub-agent metadata from event.payload (validated permissively — the
  // event source is the transcript scraper, and that may evolve).
  const payload = $derived((event.payload ?? {}) as Record<string, unknown>);
  const agent = $derived(typeof payload.agent === "string" ? payload.agent : (event.title ?? "Sub-agent"));
  const model = $derived(typeof payload.model === "string" ? payload.model : null);
  const durationMs = $derived(typeof payload.durationMs === "number" ? payload.durationMs : null);
  const promptSummary = $derived(typeof payload.promptSummary === "string" ? payload.promptSummary : "");
  const fullPrompt = $derived(typeof payload.fullPrompt === "string" ? payload.fullPrompt : "");
  const response = $derived(typeof payload.response === "string" ? payload.response : "");
  // Slice-25: pre-rendered HTML versions (markdown → sanitized HTML) from
  // build-export-payload. When present, the UI renders formatted output
  // (bold, lists, code blocks, links). Falls back to the plain string.
  const fullPromptHtml = $derived(typeof payload.fullPromptHtml === "string" ? payload.fullPromptHtml : "");
  const responseHtml = $derived(typeof payload.responseHtml === "string" ? payload.responseHtml : "");
  const skillsLoaded = $derived(Array.isArray(payload.skillsLoaded) ? (payload.skillsLoaded as string[]) : []);
  const tools = $derived(
    Array.isArray(payload.tools)
      ? (payload.tools as Array<{
          name?: string;
          input?: string;
          displayName?: string;
          isMcp?: boolean;
          mcpServer?: string;
        }>)
      : [],
  );
  /**
   * Slice-14 Bucket E: list of files this sub-agent's child tool_use events
   * touched. Build-derived (see backend `build-export-payload.ts`). Strict
   * runtime guard — coerce to [] when absent or malformed.
   */
  const filesTouched = $derived(
    Array.isArray(payload.filesTouched)
      ? ((payload.filesTouched as FileTouch[]).filter(
          (f) => f && typeof f.path === "string" && typeof f.action === "string",
        ) as FileTouch[])
      : [],
  );

  const durationLabel = $derived.by(() => {
    if (durationMs === null) return null;
    if (durationMs < 1000) return `${durationMs} ms`;
    return `${(durationMs / 1000).toFixed(1)} s`;
  });

  function toggleExpand(): void {
    expanded = !expanded;
    // Bidirectional link wiring (R-68 / ADR-SC-D3): emit selection + URL hash
    // query so the transcript view can sync. The card lives inside
    // #/chapter/<sid>, so we navigate to the same route but with ?event=<id>.
    const route = router.get();
    if (route.name === "chapter") {
      selection._setFromRoute("chapter", event.id);
      router.navigate({ name: "chapter", chapterId: route.chapterId, eventId: event.id });
    }
  }

  function openInspector(e: MouseEvent): void {
    e.stopPropagation();
    inspector.open(event.id);
  }

  // Slice-22 hygiene: VISIBILITY IS NEVER GATED BY THE OBSERVER.
  //
  // Background: the slice-12 Moment-1 entrance used `clip-path: inset(100%)`
  // as the pre-state, gated to flip via IntersectionObserver. In production on
  // long narrative chapters (200+ rows) the IO callbacks did NOT fire for
  // cards rendered below the fold even after the user scrolled to them —
  // resulting in every sub-agent card permanently invisible.
  //
  // Fix: set inView = true synchronously on mount. The card lands visible.
  // The CSS pre-state was also changed from `clip-path: inset(100% 0 0 0)`
  // to a subtle opacity+translateY (see styles) so the worst case is a
  // slightly-dimmed card rather than a clipped-to-zero invisible one.
  onMount(() => {
    inView = true;
  });
</script>

<article
  bind:this={cardEl}
  class="card-wrap lb-snap-target"
  data-testid="sub-agent-card"
  data-expanded={expanded}
  data-in-view={inView}
  data-event-id={event.id}
>
  <button
    type="button"
    class="card"
    data-interactive
    aria-expanded={expanded}
    aria-controls={regionId}
    aria-label={expanded ? `Collapse ${agent}` : `Expand ${agent}`}
    onclick={toggleExpand}
  >
    <!-- COMPACT ROW: monogram + meta + badges + chevron. R-57 / R-59 -->
    <div class="compact-row">
      <span class="agent-monogram" aria-hidden="true">⟳</span>
      <div class="agent-meta">
        <p class="agent-eyebrow">Sub-agent</p>
        <p class="agent-name">{agent}</p>
      </div>
      {#if promptSummary}
        <p class="agent-summary" title={promptSummary}>{promptSummary}</p>
      {/if}
      <div class="badge-strip" aria-hidden="true">
        {#if skillsLoaded.length > 0}
          <span class="badge" title="Skills loaded">{skillsLoaded.length}&nbsp;skill{skillsLoaded.length === 1 ? "" : "s"}</span>
        {/if}
        {#if tools.length > 0}
          <span class="badge" title="Tool calls">{tools.length}&nbsp;tool{tools.length === 1 ? "" : "s"}</span>
        {/if}
        {#if durationLabel}
          <span class="badge lb-tnum" title="Duration">{durationLabel}</span>
        {/if}
        {#if model}
          <span class="badge badge-model lb-tnum" title="Model">{model}</span>
        {/if}
        {#if filesTouched.length > 0}
          <span class="badge lb-tnum" title={`${filesTouched.length} file${filesTouched.length === 1 ? "" : "s"} touched`}>
            {filesTouched.length}&nbsp;file{filesTouched.length === 1 ? "" : "s"}
          </span>
        {/if}
      </div>
      <!-- P1 chevron — rotated 90° via affordance.css when [aria-expanded="true"]. -->
      <span class="lb-chevron card-chevron" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="5 3 11 8 5 13" />
        </svg>
      </span>
    </div>
  </button>

  <!-- EXPANDED REGION — animated via CSS Grid `auto 0fr → auto 1fr`. R-58 / ADR-SC-B1 -->
  <div class="expand-grid" id={regionId} role="region" aria-label={`${agent} details`}>
    <div class="expand-inner">
      <div class="expand-content">
        {#if fullPrompt || fullPromptHtml}
          <!--
            Slice-25: full prompt now renders the pre-built HTML when the
            backend pre-renders it (bold / lists / code-block-aware). Falls
            back to a wrapping <pre> for plain text. The wrapper width
            stretches to the card edges (no narrow column) so long prompts
            stay readable without horizontal scroll.
          -->
          <section class="back-section back-section-wide" aria-label="Full prompt">
            <h4 class="back-section-title">Full prompt</h4>
            {#if fullPromptHtml}
              <div class="back-md"><MarkdownBlock body={fullPromptHtml} /></div>
            {:else}
              <pre class="back-pre">{fullPrompt}</pre>
            {/if}
          </section>
        {/if}

        {#if skillsLoaded.length > 0}
          <section class="back-section" aria-label="Skills loaded">
            <h4 class="back-section-title">Skills loaded</h4>
            <div class="chip-row">
              {#each skillsLoaded as skill}
                <span class="skill-chip">{skill}</span>
              {/each}
            </div>
          </section>
        {/if}

        {#if tools.length > 0}
          <section class="back-section" aria-label="Tool calls">
            <h4 class="back-section-title">Tool calls</h4>
            <ul class="tool-list">
              {#each tools as t}
                <li class="tool-row">
                  {#if t.isMcp}{@render brainIcon(t.mcpServer ?? "mcp")}{/if}
                  <code
                    class="tool-name"
                    class:tool-name-mcp={t.isMcp}
                    title={t.isMcp ? `MCP · ${t.mcpServer ?? "mcp"} · ${t.name ?? "tool"}` : (t.name ?? "tool")}
                  >{t.displayName ?? t.name ?? "tool"}</code>
                  {#if t.input}
                    <!-- Slice-12 P3 (R-63): wrap detected file paths inside
                         tool-input prose in vscode://file/ anchors. linkifyText
                         HTML-escapes everything else, so the splat is safe. -->
                    <span class="tool-input">{@html linkifyText(t.input).html}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if filesTouched.length > 0}
          <!-- Slice-14 Bucket E: files this sub-agent touched. The strip is
               always rendered when there's content; the data is build-derived
               from tool_result events (PASSIVE per INV-1). -->
          <section class="back-section" aria-label="Files touched">
            <h4 class="back-section-title">Files touched</h4>
            <FileChangeStrip files={filesTouched} ariaLabel="Files touched by this sub-agent" />
          </section>
        {/if}

        {#if response || responseHtml}
          <!--
            Slice-25: response renders the pre-rendered markdown HTML when
            available (formatted bold / lists / code blocks). The previous
            implementation wrapped the raw markdown string in <p>...</p>
            and splatted that, showing literal **bold** characters.
          -->
          <section class="back-section back-section-wide" aria-label="Response synthesis">
            <h4 class="back-section-title">Response synthesis</h4>
            {#if responseHtml}
              <div class="back-md"><MarkdownBlock body={responseHtml} /></div>
            {:else}
              <pre class="back-pre">{response}</pre>
            {/if}
          </section>
        {/if}

        <footer class="back-footer">
          <button
            type="button"
            class="inspector-btn"
            onclick={openInspector}
            aria-label="Open in inspector"
          >
            Open in inspector →
          </button>
        </footer>
      </div>
    </div>
  </div>
</article>

<!--
  Brain glyph marking MCP / engram tool calls in the sub-agent tool list.
  Inline SVG, currentColor-driven so it tracks the accent of `.tool-name-mcp`.
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
   * OUTER WRAP — Moment 1 entrance host.
   *
   * The wrap stacks two rows in a grid: (1) the compact button row, (2) the
   * expandable grid row whose grid-template-rows animates auto 0fr → auto 1fr.
   * interpolate-size: allow-keywords lets `auto` be a transition target on
   * supporting browsers; older browsers fall through to instant resize.
   */
  /*
   * Slice 30 — Paper Brutalism for sub-agent cards.
   *   - 0px corners.
   *   - 1px hairline violet border + 4px Teal Basin border-left.
   *   - Hard 4px drop shadow at 14% violet when expanded.
   */
  /*
   * Slice 31.1 — bigger card on expand, scroll lives inside the prompt
   * + response boxes (not the panel), and a creative "page unfold"
   * entrance with 3D perspective + child stagger.
   */
  .card-wrap {
    display: block;
    margin: var(--p-space-4) 0;
    background: var(--color-surface-raised);
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 16%, transparent);
    border-left: 4px solid var(--color-subagent);
    border-radius: var(--p-radius-accent);
    interpolate-size: allow-keywords;
    overflow: hidden;
    position: relative;
    perspective: 1400px;
    transition: box-shadow 360ms cubic-bezier(0.22, 1, 0.36, 1),
                transform 360ms cubic-bezier(0.22, 1, 0.36, 1),
                max-width 360ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .card-wrap[data-expanded="true"] {
    box-shadow: 6px 6px 0 0 color-mix(in srgb, var(--color-subagent) 32%, transparent);
    transform: translateY(-2px);
  }

  /* ---- MOMENT 1: sub-agent deploy entrance --------------------------- */
  /*
   * Slice-22 hygiene: the previous pre-state used `clip-path: inset(100%)`
   * which clipped the card to zero painted area. When the IntersectionObserver
   * failed to fire (real regression on 200+ row chapters), the card stayed
   * invisible forever. Replaced with opacity+translateY so the worst case
   * is a slightly-dim card rather than a missing one. JS now sets
   * data-in-view="true" synchronously on mount; this CSS only animates the
   * transition for that one-time state change.
   */
  .card-wrap[data-in-view="false"] {
    opacity: 0;
    transform: translateY(8px);
  }
  .card-wrap[data-in-view="true"] {
    opacity: 1;
    transform: translateY(0);
    transition: opacity 280ms ease-out, transform 280ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  /* Color bleed pseudo-element — paints the kind border-color across the
     surface with a quick fade, then settles. 50ms delay per brief moment #1. */
  .card-wrap[data-in-view="true"]::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(90deg, rgba(var(--brand-rgb), 0.08), transparent 40%);
    opacity: 0;
    animation: lb-color-bleed 350ms ease-out 50ms 1 both;
  }
  @keyframes lb-color-bleed {
    0%   { opacity: 0; }
    40%  { opacity: 1; }
    100% { opacity: 0; }
  }

  /* Reduced-motion: skip entrance entirely; the card lands in final state. */
  :global(html[data-motion="reduced"]) .card-wrap[data-in-view="false"],
  :global(html[data-motion="reduced"]) .card-wrap[data-in-view="true"] {
    opacity: 1;
    transform: none;
    transition: none;
  }
  :global(html[data-motion="reduced"]) .card-wrap[data-in-view="true"]::before {
    animation: none;
  }

  /* ---- COMPACT ROW ---------------------------------------------------- */
  .card {
    /* Reset native button chrome so it lays out like a row. */
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    width: 100%;
    text-align: left;
    cursor: pointer;
    padding: 0;
    font: inherit;
  }

  .compact-row {
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
    padding: var(--card-padding);
    min-height: 56px;
  }

  .agent-monogram {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--color-surface-sunken);
    color: var(--color-subagent);
    font-size: 16px;
    line-height: 1;
    flex-shrink: 0;
  }

  .agent-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 0 1 auto;
  }

  .agent-eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0;
  }

  .agent-name {
    margin: 0;
    font-family: var(--font-headline);
    font-size: var(--font-size-meta);
    color: var(--color-text-primary);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .agent-summary {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-meta);
    line-height: 1.4;
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge-strip {
    display: flex;
    align-items: center;
    gap: var(--p-space-2);
    flex-shrink: 0;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    font-size: var(--font-size-caption);
    background: var(--color-surface-sunken);
    color: var(--color-text-secondary);
    border-radius: var(--radius-xs);
    padding: 2px 8px;
    white-space: nowrap;
  }

  .badge-model {
    color: var(--color-accent-primary);
  }

  /*
   * Slice-25: chevron is larger + sits in a chip-like circle so the
   * affordance is obvious. The icon itself scales via CSS (overrides the
   * inline svg width/height) and a hover state on the parent card makes
   * the chevron pop. All other "lb-chevron" instances inherit the same
   * styling from affordance.css; this rule only overrides for the
   * SubAgentCard's prominent header chevron.
   */
  .card-chevron {
    margin-left: var(--p-space-2);
    width: 32px;
    height: 32px;
    border-radius: 4px;   /* Slice 30: editorial 4px (was 999 pill) */
    background: var(--color-surface-sunken);
    border: 1px solid var(--color-border-hairline);
    color: var(--color-text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 220ms cubic-bezier(0.22, 1, 0.36, 1),
                color 220ms cubic-bezier(0.22, 1, 0.36, 1),
                border-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
                transform 480ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  /* Slice 31.2 — chevron rotates with an editorial overshoot to seal the
   * brush-sweep with a tactile click. Counter-rotates the inner svg so
   * the icon glyph itself uses the affordance.css aria-expanded rotation
   * (which targets `.lb-chevron > svg`). The button-level transform here
   * does a subtle scale "stamp" instead of fighting the icon rotation. */
  .card-wrap[data-expanded="true"] .card-chevron {
    transform: scale(1.08);
    background: color-mix(in srgb, var(--color-subagent) 18%, var(--color-surface-sunken));
    color: var(--color-subagent);
    border-color: color-mix(in srgb, var(--color-subagent) 48%, var(--color-border-hairline));
  }

  .card-chevron :global(svg) {
    width: 14px;
    height: 14px;
    transition: transform 480ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .card-wrap[data-expanded="true"] .card-chevron :global(svg) {
    transform: rotate(90deg);
  }

  .card-wrap:hover .card-chevron,
  .card:focus-visible .card-chevron {
    background: color-mix(in srgb, var(--color-accent-primary) 14%, var(--color-surface-sunken));
    color: var(--color-accent-primary);
    border-color: color-mix(in srgb, var(--color-accent-primary) 36%, var(--color-border-hairline));
  }

  :global(html[data-motion="reduced"]) .card-chevron {
    transition: none;
  }

  /*
   * Slice-25: `back-section-wide` overrides the default reading-column
   * max-width so the full prompt and response synthesis fill the card
   * edge-to-edge. Improves legibility on long markdown content.
   */
  .back-section-wide :global(.md-block) {
    max-width: none;
  }
  .back-section-wide .back-pre {
    max-width: none;
  }
  /*
   * Slice 31.1 — scroll lives HERE (was on .expand-inner). The Full
   * prompt and Response synthesis boxes cap at min(46vh, 440px) and
   * scroll internally so long markdown doesn't push every other
   * section off-screen. Thin themed scrollbar matches the editorial
   * register.
   */
  .back-md {
    background: var(--color-surface-sunken);
    border-radius: var(--radius-sm);
    padding: var(--p-space-3) var(--p-space-4);
    border: 1px solid var(--color-border-hairline);
    max-height: min(46vh, 440px);
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--color-text-primary) 24%, transparent) transparent;
  }
  .back-md::-webkit-scrollbar { width: 8px; }
  .back-md::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--color-text-primary) 22%, transparent);
    border-radius: 999px;
  }
  .back-md::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--color-accent-primary) 40%, transparent);
  }
  .back-md :global(p:first-child) {
    margin-top: 0;
  }
  .back-md :global(p:last-child) {
    margin-bottom: 0;
  }

  /* ---- EXPAND GRID — ADR-SC-B1 ---------------------------------------
   *
   * Slice 31 — fluid editorial expand.
   *   - Grid rows 0fr → 1fr animated at 420ms with the editorial ease
   *     (cubic-bezier(0.22, 1, 0.36, 1)) for a softer settle than the
   *     prior 250ms back-out.
   *   - Inner content fades + lifts (opacity 0 → 1, translateY 6 → 0)
   *     so the reveal feels layered, not a hard clip wipe.
   *   - Inner pane caps at min(58vh, 560px) and scrolls — was unbounded
   *     and ate the whole viewport on long prompts/responses.
   */
  /* Slice 31.4 — sober editorial fade, slower for presence.
   * Grid 720ms, content opacity 640ms (120ms delay) + travel 760ms
   * (90ms delay). translateY 14px gives the lift more body than the
   * previous 6px snap. */
  .expand-grid {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 720ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .card-wrap[data-expanded="true"] .expand-grid {
    grid-template-rows: 1fr;
  }

  .expand-inner {
    overflow: hidden;
    min-height: 0;
  }

  .expand-content {
    padding: 0 var(--card-padding) var(--card-padding);
    display: grid;
    gap: var(--p-space-4);
    opacity: 0;
    transform: translateY(14px);
    transition: opacity 640ms cubic-bezier(0.22, 1, 0.36, 1) 120ms,
                transform 760ms cubic-bezier(0.22, 1, 0.36, 1) 90ms;
    border-top: var(--card-border);
    margin-top: 0;
  }

  .card-wrap[data-expanded="true"] .expand-content {
    opacity: 1;
    transform: translateY(0);
    padding-top: var(--card-padding);
  }

  :global(html[data-motion="reduced"]) .expand-content {
    transition: none;
    opacity: 1;
    transform: none;
  }

  /* Reduced-motion: instant expand, no clip-path animation. */
  :global(html[data-motion="reduced"]) .expand-grid,
  :global(html[data-motion="reduced"]) .expand-content,
  :global(html[data-motion="reduced"]) .card-wrap {
    transition: none;
  }
  :global(html[data-motion="reduced"]) .card-wrap[data-expanded="true"] .expand-content {
    opacity: 1;
    transform: none;
  }

  /* ---- EXPANDED CONTENT CHROME (carried from slice 10 back-face) ---- */
  .back-section-title {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0 0 var(--p-space-2) 0;
    font-weight: 600;
  }

  .back-pre {
    background: var(--color-surface-sunken);
    border-radius: var(--radius-sm);
    padding: var(--p-space-3) var(--p-space-4);
    font-family: var(--font-mono);
    font-size: var(--font-size-meta);
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--color-text-primary);
    /* Slice 31.1: scroll lives on the inner content boxes (was panel). */
    max-height: min(46vh, 440px);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--color-text-primary) 24%, transparent) transparent;
  }
  .back-pre::-webkit-scrollbar { width: 8px; }
  .back-pre::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--color-text-primary) 22%, transparent);
    border-radius: 999px;
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--p-space-2);
  }

  .skill-chip {
    display: inline-flex;
    align-items: center;
    font-size: var(--font-size-caption);
    color: var(--color-accent-primary);
    background: var(--color-surface-sunken);
    border: 1px solid var(--color-border-hairline);
    border-radius: var(--radius-xs);
    padding: 2px 8px;
    font-family: var(--font-mono);
  }

  .tool-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--p-space-1);
  }

  .tool-row {
    display: flex;
    align-items: baseline;
    gap: var(--p-space-3);
    font-size: var(--font-size-meta);
  }

  .tool-name {
    background: var(--color-surface-sunken);
    color: var(--color-accent-primary);
    border-radius: var(--radius-xs);
    padding: 1px 6px;
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
  }

  .tool-name-mcp {
    font-style: normal;
  }

  /* Brain glyph for MCP / engram tool calls. Accent-tinted, baseline-aligned
     with the tool row. 150ms transition per LogBook motion budget. */
  .tool-mcp-icon {
    flex-shrink: 0;
    color: var(--color-accent-primary);
    opacity: 0.85;
    align-self: center;
    transition: opacity 150ms ease;
  }

  .tool-row:hover .tool-mcp-icon {
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
    word-break: break-all;
  }

  /* Slice 12 P3 (R-63): file-path anchors embedded by linkifyText. */
  .tool-input :global(a[data-deep-link="file"]) {
    color: var(--color-accent-primary);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .tool-input :global(a[data-deep-link="file"]:hover) {
    text-decoration-thickness: 2px;
  }

  .back-footer {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--p-space-3);
    border-top: var(--card-border);
  }

  .inspector-btn {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--color-accent-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
    cursor: pointer;
    padding: 0;
  }

  .inspector-btn:hover {
    text-decoration: underline;
  }
</style>
