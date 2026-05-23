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
  import type { RenderEvent } from "../types";
  import MarkdownBlock from "./MarkdownBlock.svelte";
  import { inspector } from "../stores/inspector";
  import { linkifyText } from "../util/deep-link";

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
  const skillsLoaded = $derived(Array.isArray(payload.skillsLoaded) ? (payload.skillsLoaded as string[]) : []);
  const tools = $derived(
    Array.isArray(payload.tools)
      ? (payload.tools as Array<{ name?: string; input?: string }>)
      : [],
  );

  const durationLabel = $derived.by(() => {
    if (durationMs === null) return null;
    if (durationMs < 1000) return `${durationMs} ms`;
    return `${(durationMs / 1000).toFixed(1)} s`;
  });

  function toggleExpand(): void {
    expanded = !expanded;
  }

  function openInspector(e: MouseEvent): void {
    e.stopPropagation();
    inspector.open(event.id);
  }

  // Moment 1: gate the entrance on first viewport intersection. We use a
  // single observer per card; once fired, we disconnect to avoid replaying.
  // Under reduced-motion the entrance CSS is a no-op (see styles below), so
  // we still set inView so the card lands in its final state without delay.
  onMount(() => {
    if (!cardEl) return;
    if (typeof IntersectionObserver === "undefined") {
      inView = true;
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            inView = true;
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    io.observe(cardEl);
    return () => io.disconnect();
  });
</script>

<article
  bind:this={cardEl}
  class="card-wrap"
  data-testid="sub-agent-card"
  data-expanded={expanded}
  data-in-view={inView}
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
        {#if fullPrompt}
          <section class="back-section" aria-label="Full prompt">
            <h4 class="back-section-title">Full prompt</h4>
            <pre class="back-pre">{fullPrompt}</pre>
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
                  <code class="tool-name">{t.name ?? "tool"}</code>
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

        {#if response}
          <section class="back-section" aria-label="Response synthesis">
            <h4 class="back-section-title">Response synthesis</h4>
            <MarkdownBlock body={`<p>${response}</p>`} />
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

<style>
  /*
   * OUTER WRAP — Moment 1 entrance host.
   *
   * The wrap stacks two rows in a grid: (1) the compact button row, (2) the
   * expandable grid row whose grid-template-rows animates auto 0fr → auto 1fr.
   * interpolate-size: allow-keywords lets `auto` be a transition target on
   * supporting browsers; older browsers fall through to instant resize.
   */
  .card-wrap {
    display: block;
    margin: var(--p-space-3) 0;
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--card-radius);
    border-left: 3px solid var(--color-subagent);
    box-shadow: 0 1px 0 var(--color-border-hairline);
    interpolate-size: allow-keywords;
    overflow: hidden;
    position: relative;
  }

  /* ---- MOMENT 1: sub-agent deploy entrance --------------------------- */
  /* Pre-state (before viewport hit). clip-path inset hides the card from
     above; opacity stays at 1 so the color bleed feels like "deploying". */
  .card-wrap[data-in-view="false"] {
    clip-path: inset(100% 0 0 0);
  }
  .card-wrap[data-in-view="true"] {
    clip-path: inset(0 0 0 0);
    transition: clip-path 280ms cubic-bezier(0.16, 1, 0.3, 1);
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
    clip-path: none;
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

  .card-chevron {
    margin-left: var(--p-space-2);
  }

  /* ---- EXPAND GRID — ADR-SC-B1 --------------------------------------- */
  .expand-grid {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 250ms cubic-bezier(0.77, 0, 0.175, 1);
  }

  .card-wrap[data-expanded="true"] .expand-grid {
    grid-template-rows: 1fr;
  }

  .expand-inner {
    overflow: hidden;
    min-height: 0;
  }

  /* Kowalski clip-path reveal on inner content. */
  .expand-content {
    padding: 0 var(--card-padding) var(--card-padding);
    display: grid;
    gap: var(--p-space-4);
    clip-path: inset(0 0 100% 0);
    transition: clip-path 250ms cubic-bezier(0.77, 0, 0.175, 1);
    border-top: var(--card-border);
    margin-top: 0;
  }

  .card-wrap[data-expanded="true"] .expand-content {
    clip-path: inset(0 0 0 0);
    padding-top: var(--card-padding);
  }

  /* Reduced-motion: instant expand, no clip-path animation. */
  :global(html[data-motion="reduced"]) .expand-grid,
  :global(html[data-motion="reduced"]) .expand-content {
    transition: none;
  }
  :global(html[data-motion="reduced"]) .card-wrap[data-expanded="true"] .expand-content {
    clip-path: inset(0 0 0 0);
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
    max-height: 220px;
    overflow-y: auto;
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
