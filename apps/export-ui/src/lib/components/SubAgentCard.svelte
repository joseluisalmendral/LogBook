<!--
  SubAgentCard — the centerpiece of the editorial replay.

  Spec R-24 / motion #3 / S-2 / AG-4. This is the moment a student sees the
  AI's sub-agent invocation laid open. Two faces:

    FRONT (collapsed):  pill / preview — agent name + model + duration.
    BACK  (expanded):   full prompt (MarkdownBlock-rendered) + skills loaded
                        + tool calls + response synthesis.

  THE 3D FLIP — load-bearing CSS that's exotic enough to deserve comments:

    `perspective: 1200px` on the OUTER `.card-wrap`.
      Gives the browser a vanishing-point so rotateY produces foreshortening
      rather than a flat 2D mirror. Lower = more dramatic; 1200px is the
      Linear / Stripe Press "calm" register, not the marketing-page punch.

    `transform-style: preserve-3d` on the INNER `.card`.
      Without this, the back face is clipped to the front face's 2D plane and
      you see a flat mirror instead of two distinct surfaces.

    `backface-visibility: hidden` on each face.
      Hides whichever face is rotated away from the camera. Front rotates 0deg
      → 180deg; back is pre-rotated 180deg → 360deg (modulo 360 == 0).

    `transition-behavior: allow-discrete` + `@starting-style` on `display`.
      Lets us animate the back face IN from `display: none` (NOT in the layout
      tree) to `display: grid` (in the tree). Without `allow-discrete`, the
      browser snaps non-animatable properties (display, visibility) at the
      cycle start and the entry transition collapses to instant.

    `interpolate-size: allow-keywords` on the wrap.
      Makes height: auto transitions animatable. The back face has more content
      than the front, so the wrap's resolved height differs between states.

  REDUCED MOTION (R-33 / S-5):
    `data-motion="reduced"` on <html> kills every transition + animation via
    app.css's global rule. We additionally short-circuit the rotate by setting
    `transform: none` on the inner card in reduced-motion mode — without this,
    even an instant transition still resolves the back face mirrored on top of
    the front face. The card swaps INSTANTLY: no flip, no animation, just a
    state change. Verify by Emulating reduced-motion in Chromium DevTools.

  BROWSER SUPPORT:
    `transition-behavior: allow-discrete`: Chromium 117+, Safari 17.4+, Firefox 129+.
    `@starting-style`: same browsers.
    Older browsers fall back to instant swap (graceful — the content is still
    accessible). Detection via @supports inside the style block.
-->
<script lang="ts">
  import type { RenderEvent } from "../types";
  import MarkdownBlock from "./MarkdownBlock.svelte";
  import { inspector } from "../stores/inspector";

  interface Props {
    event: RenderEvent;
  }

  const { event }: Props = $props();

  let flipped = $state(false);

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

  function toggleFlip(): void {
    flipped = !flipped;
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleFlip();
    }
  }

  function openInspector(e: MouseEvent): void {
    // Inspector is a secondary action — only when the user explicitly clicks
    // the meta button, not the whole card (clicking the card flips it).
    e.stopPropagation();
    inspector.open(event.id);
  }
</script>

<div class="card-wrap" data-testid="sub-agent-card" data-flipped={flipped}>
  <!--
    The outer "button" is a div with role=button so we can host a nested
    <button> inside the back face (the Open-in-inspector affordance). Native
    <button>-inside-<button> is invalid HTML; role=button + tabindex + key
    handler is the standard escape hatch.
  -->
  <div
    class="card"
    class:is-flipped={flipped}
    role="button"
    tabindex="0"
    data-interactive
    aria-pressed={flipped}
    aria-expanded={flipped}
    aria-label={flipped ? `Collapse ${agent}` : `Expand ${agent}`}
    onclick={toggleFlip}
    onkeydown={onKey}
  >
    <!-- FRONT FACE: collapsed pill -->
    <div class="face face-front">
      <div class="face-row">
        <span class="agent-glyph" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16">
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4" />
            <circle cx="8" cy="8" r="2.5" fill="currentColor" />
          </svg>
        </span>
        <div class="agent-meta">
          <p class="agent-eyebrow">Sub-agent</p>
          <p class="agent-name">{agent}</p>
        </div>
        {#if model}
          <span class="badge badge-model lb-tnum" title="Model">{model}</span>
        {/if}
        {#if durationLabel}
          <span class="badge badge-time lb-tnum" title="Duration">{durationLabel}</span>
        {/if}
        <!-- R-54 / AG-24: always-visible chevron rotates 90° via affordance.css when [data-flipped="true"]. -->
        <span class="lb-chevron card-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="5 3 11 8 5 13" />
          </svg>
        </span>
      </div>
      {#if promptSummary}
        <p class="agent-summary">{promptSummary}</p>
      {/if}
    </div>

    <!-- BACK FACE: full prompt + skills + tools + response -->
    <div class="face face-back">
      <header class="back-header">
        <div>
          <p class="agent-eyebrow">Sub-agent · expanded</p>
          <p class="back-title">{agent}</p>
        </div>
        <span class="hint" aria-hidden="true">close</span>
      </header>

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
                {#if t.input}<span class="tool-input">{t.input}</span>{/if}
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

<style>
  /* OUTER WRAP — vanishing-point perspective. */
  .card-wrap {
    perspective: 1200px;
    /* interpolate-size: allow-keywords lets the wrap animate height: auto when
       the back face has more content than the front. Chrome 129+; older
       browsers fall through to instant resize, which is fine here. */
    interpolate-size: allow-keywords;
    margin: var(--p-space-3) 0;
  }

  /* INNER CARD — the 3D plane. */
  .card {
    background: transparent;
    width: 100%;
    cursor: pointer;
    color: inherit;

    /* preserve-3d keeps the back face IN a 3D plane behind the front rather
       than flattening it. Without this, rotateY produces a mirror, not a
       flip. */
    transform-style: preserve-3d;
    transition:
      transform 500ms cubic-bezier(0.16, 1, 0.3, 1);
    display: grid;
    grid-template-areas: "stack";
    border-radius: var(--card-radius);
  }

  .card.is-flipped {
    transform: rotateY(180deg);
  }

  /* Reduced-motion override: NO rotation, NO transition. The face we want
     visible is swapped via @media query below. */
  :global(html[data-motion="reduced"]) .card {
    transform: none !important;
    transition: none !important;
  }

  /* FACES — both faces stack at the same grid cell. backface-visibility hides
     the one rotated away from the camera. */
  .face {
    grid-area: stack;
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--card-radius);
    padding: var(--card-padding);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    min-height: 88px;
  }

  .face-front {
    /* Front face is in its natural rotation: rotateY(0). */
    display: flex;
    flex-direction: column;
    gap: var(--p-space-2);
    /* Subtle border accent so the card is recognizably "interactive". */
    border-color: var(--color-border-hairline);
    box-shadow: 0 1px 0 var(--color-border-hairline);
  }

  .face-back {
    /* Back face is pre-rotated 180deg so when the card is flipped, this face
       presents at rotateY(0) to the viewer. */
    transform: rotateY(180deg);
    display: grid;
    gap: var(--p-space-4);
    background: var(--color-surface-raised);
    border-color: var(--color-accent-primary);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.10);
  }

  /* Reduced-motion: hide one face via display rather than rotation. */
  :global(html[data-motion="reduced"]) .face-front {
    display: flex;
  }
  :global(html[data-motion="reduced"]) .card.is-flipped .face-front {
    display: none;
  }
  :global(html[data-motion="reduced"]) .face-back {
    display: none;
    transform: none;
  }
  :global(html[data-motion="reduced"]) .card.is-flipped .face-back {
    display: grid;
  }

  /* @starting-style — when the back face mounts (display goes from none to
     grid), animate IN from opacity 0 + slight translate. Requires
     transition-behavior: allow-discrete on the parent. Chromium 117+. */
  @supports (transition-behavior: allow-discrete) {
    .face-back {
      transition:
        transform 500ms cubic-bezier(0.16, 1, 0.3, 1),
        opacity 300ms ease-out,
        display 500ms allow-discrete;
    }
    @starting-style {
      .card.is-flipped .face-back {
        opacity: 0;
        transform: rotateY(180deg) translateY(8px);
      }
    }
  }

  /* ------ FRONT FACE CHROME ------ */
  .face-row {
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
    flex-wrap: wrap;
  }

  .agent-glyph {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--color-surface-sunken);
    color: var(--color-accent-primary);
    flex-shrink: 0;
  }

  .agent-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 auto;
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
    font-size: var(--font-size-lead);
    color: var(--color-text-primary);
    line-height: 1.2;
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

  .agent-summary {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-meta);
    line-height: 1.5;
  }

  .hint {
    margin-left: auto;
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    flex-shrink: 0;
  }

  /* R-54: pin the always-visible chevron to the right edge of the compact row. */
  .card-chevron {
    margin-left: auto;
  }

  /* ------ BACK FACE CHROME ------ */
  .back-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--p-space-3);
    padding-bottom: var(--p-space-3);
    border-bottom: var(--card-border);
  }

  .back-title {
    font-family: var(--font-headline);
    font-size: var(--font-size-h3);
    margin: 0;
    color: var(--color-text-primary);
    line-height: 1.2;
  }

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
