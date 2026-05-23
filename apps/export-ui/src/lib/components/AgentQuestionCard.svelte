<!--
  AgentQuestionCard — slice 12 P7 (R-68 wiring + R-78 Moment 2 SVG branch fork).

  This is the WOW moment. When the card enters the viewport an SVG fork
  animation draws each branch via stroke-dashoffset, staggered with
  animation-delay, total 600ms. Reduced-motion shows the paths statically.

  Spec contracts:
    R-78 (M2)  — SVG branch animation, @property --branch-progress,
                 stroke-dashoffset, staggered delays, 600ms total,
                 reduced-motion static fallback.
    R-68       — data-event-id on the card root for bidirectional link.
    R-57/R-54  — chevron parity with SubAgentCard (always-visible, rotates).
    INV-15     — counts against the 5-moment cap (slot M2).
    AG-40      — viewport-entry triggers the SVG animation.
    AG-41      — reduced-motion sweep: animation: none + static final paths.

  IMPORTANT
    The pulse animation (legacy @property --pulse) is kept for the chosen
    option's box-shadow ring — that's a continuous indicator (it pre-dates
    INV-15 and is functional feedback, not a 6th moment).
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { RenderEvent } from "../types";
  import { selection } from "../stores/selection";
  import { router } from "../stores/router";

  interface Option {
    label: string;
    value?: string;
    description?: string;
  }

  interface QuestionPayload {
    question: string;
    header?: string;
    options: Option[];
    multiSelect: boolean;
    chosen: string | string[];
    notes?: string;
    askedAt: string;
  }

  interface Props {
    event: RenderEvent;
    /** When part of a multi-question call, e.g. "1 of 3". */
    questionIndex?: number;
    questionCount?: number;
  }

  const { event, questionIndex, questionCount }: Props = $props();

  // Cast permissively — the event payload is shaped by the transcript scraper.
  const payload = $derived((event.payload ?? {}) as Partial<QuestionPayload>);
  const question = $derived(payload.question ?? event.title ?? "Untitled question");
  const header = $derived(payload.header ?? "Branching");
  const options = $derived(Array.isArray(payload.options) ? payload.options : []);
  const chosen = $derived(payload.chosen ?? null);
  const notes = $derived(payload.notes ?? null);
  const multiSelect = $derived(payload.multiSelect === true);

  function isChosen(opt: Option): boolean {
    if (chosen == null) return false;
    const chosenArr = Array.isArray(chosen) ? chosen : [chosen];
    return chosenArr.includes(opt.label) || (opt.value != null && chosenArr.includes(opt.value));
  }

  // SVG fork (Moment 2): cap visible branches at 4. If there are >4 options,
  // group the remaining into a single "+N more" branch tip so the SVG stays
  // legible. The labels themselves still render in the options grid below.
  const BRANCH_CAP = 4;
  const branchCount = $derived(Math.min(BRANCH_CAP, Math.max(1, options.length)));
  const overflowCount = $derived(Math.max(0, options.length - BRANCH_CAP));

  /**
   * Compute SVG path coordinates for N branches diverging from a central
   * trunk. The trunk goes from (cx, 8) to (cx, 36). Each branch then curves
   * out to its tip horizontal slot.
   */
  function branchPath(i: number, n: number): string {
    // Canvas: 240 wide, 72 tall. Trunk at x=120, y=8 → y=36.
    const slotWidth = 220;
    const startX = 120;
    const leftEdge = startX - slotWidth / 2 + 10;
    // Distribute tips evenly across the canvas.
    const tipX = n === 1 ? startX : leftEdge + (i / (n - 1)) * (slotWidth - 20);
    const trunkY = 36;
    const tipY = 64;
    // Cubic curve: trunk control point above the tip horizontal, tip control
    // point below trunk — gives a soft S-bend.
    const c1x = startX;
    const c1y = trunkY + 12;
    const c2x = tipX;
    const c2y = tipY - 12;
    return `M ${startX} ${trunkY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tipX} ${tipY}`;
  }

  // IntersectionObserver: trigger the fork animation on first viewport entry.
  let cardEl: HTMLElement | undefined = $state();
  let isVisible = $state(false);
  // Click-to-expand (parity with SubAgentCard P2).
  let expanded = $state(false);

  onMount(() => {
    if (!cardEl || typeof IntersectionObserver === "undefined") {
      isVisible = true;
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            isVisible = true;
            // Once visible we can disconnect — animation runs `once: true`.
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(cardEl);
    return () => observer.disconnect();
  });

  function toggleExpand(): void {
    expanded = !expanded;
    // Bidirectional link wiring (R-68): emit selection + URL hash query so the
    // transcript view can sync. The card lives inside #/chapter/<sid>, so we
    // navigate to the same route but with ?event=<id> appended.
    const route = router.get();
    if (route.name === "chapter") {
      selection._setFromRoute("chapter", event.id);
      router.navigate({ name: "chapter", chapterId: route.chapterId, eventId: event.id });
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleExpand();
    }
  }
</script>

<!--
  Slice-13 hygiene: switched from <article role="button"> to <div role="button">.
  Svelte's a11y lint flagged article (semantically non-interactive) being given
  the interactive `button` role. <div> is the permissive interactive container
  (a real <button> would impose restrictive default styling and can't contain
  the structured grid of sub-elements without breaking layout/AT semantics).
-->
<div
  class="aq-card"
  data-testid="agent-question-card"
  data-visible={isVisible}
  data-expanded={expanded}
  data-event-id={event.id}
  data-interactive
  role="button"
  tabindex="0"
  aria-expanded={expanded}
  aria-label={`Question: ${question}`}
  onclick={toggleExpand}
  onkeydown={onKey}
  bind:this={cardEl}
>
  <header class="aq-header">
    <!--
      MOMENT 2: SVG branch fork. Animates via stroke-dashoffset + staggered
      animation-delay across N branches. aria-hidden because the textual
      question + options below are the source of truth for screen readers.
    -->
    <span class="fork-svg" aria-hidden="true">
      <svg viewBox="0 0 240 72" width="120" height="36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="fork-svg-el">
        <!-- Central node + trunk line (always visible). -->
        <circle cx="120" cy="6" r="2.2" fill="currentColor" class="fork-node" />
        <line x1="120" y1="8" x2="120" y2="36" class="fork-trunk" />
        <!-- N animated branches. -->
        {#each Array(branchCount) as _, i}
          <path
            d={branchPath(i, branchCount)}
            class="fork-branch"
            style="animation-delay: {i * 120}ms"
          />
          <circle
            cx={branchCount === 1 ? 120 : (120 - 110 + (i / (branchCount - 1)) * 200)}
            cy="64"
            r="2.4"
            fill="currentColor"
            class="fork-tip"
            style="animation-delay: {i * 120 + 400}ms"
          />
        {/each}
        {#if overflowCount > 0}
          <text x="232" y="68" class="fork-overflow" text-anchor="end">+{overflowCount}</text>
        {/if}
      </svg>
    </span>
    <div class="aq-titles">
      <span class="aq-chip">{header}</span>
      <h3 class="aq-question">{question}</h3>
      {#if questionCount && questionCount > 1 && questionIndex != null}
        <p class="aq-sequence lb-tnum">Q {questionIndex + 1} of {questionCount}</p>
      {/if}
    </div>
    <!-- Chevron parity with SubAgentCard (R-54). Rotated via affordance.css. -->
    <span class="lb-chevron aq-chevron" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="5 3 11 8 5 13" />
      </svg>
    </span>
  </header>

  <ul class="aq-options" class:multi={multiSelect}>
    {#each options as opt}
      {@const sel = isChosen(opt)}
      <li class="aq-option" class:is-chosen={sel} class:is-dimmed={!sel}>
        <div class="opt-row">
          <span class="opt-check" aria-hidden="true">
            {#if sel}
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 8 6.5 11.5 13 4.5" />
              </svg>
            {:else}
              <span class="opt-bullet"></span>
            {/if}
          </span>
          <div class="opt-text">
            <p class="opt-label">{opt.label}</p>
            {#if opt.description}
              <p class="opt-description">{opt.description}</p>
            {/if}
          </div>
        </div>
      </li>
    {/each}
  </ul>

  {#if notes}
    <section class="aq-notes" aria-label="Notes">
      <header class="notes-header">
        <span class="notes-label">Other · notes</span>
      </header>
      <p class="notes-body">{notes}</p>
    </section>
  {/if}
</div>

<style>
  /*
   * @property --branch-progress (R-78). Typed CSS variable for the SVG branch
   * draw-in. Graceful degrade: browsers without @property still run the
   * animation; they just lack the smooth interpolation guarantee.
   *
   * Chromium 85+, Safari 16.4+, Firefox 128+.
   */
  @property --branch-progress {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
  }

  /*
   * @property --pulse — kept from slice 10 for the chosen-option ring.
   * Continuous indicator (functional feedback, not a delight motion moment).
   */
  @property --pulse {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
  }

  .aq-card {
    background: var(--color-surface-raised);
    border: 1px solid var(--color-question);
    border-radius: var(--card-radius);
    padding: var(--card-padding);
    margin: var(--p-space-3) 0;
    display: grid;
    gap: var(--p-space-4);
    color: var(--color-text-primary);
    box-shadow: 0 1px 0 var(--color-border-hairline);
    text-align: left;
    width: 100%;
    appearance: none;
    font: inherit;
    cursor: pointer;
  }

  .aq-header {
    display: flex;
    align-items: flex-start;
    gap: var(--p-space-3);
  }

  .fork-svg {
    color: var(--color-question);
    flex-shrink: 0;
    width: 120px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .fork-svg-el {
    overflow: visible;
  }

  /*
   * MOMENT 2 — SVG branch draw-in (R-78, AG-40, INV-15 slot M2).
   * Each .fork-branch starts with stroke-dasharray equal to its length and
   * stroke-dashoffset at the same length (invisible). The animation drives
   * dashoffset to 0 (drawn). Staggered via inline animation-delay per branch.
   * Total animation budget: 600ms (300ms per branch + last branch delay 360ms
   * = 660ms perceived, well inside R-80 ≤ 800ms cap for one-shots).
   */
  .fork-branch {
    stroke-dasharray: 64;
    stroke-dashoffset: 64;
    --branch-progress: 0;
  }
  .fork-tip {
    opacity: 0;
  }
  .aq-card[data-visible="true"] .fork-branch {
    animation: aq-draw-branch 300ms cubic-bezier(0.6, 0, 0.2, 1) forwards;
  }
  .aq-card[data-visible="true"] .fork-tip {
    animation: aq-draw-tip 180ms ease-out forwards;
  }
  @keyframes aq-draw-branch {
    from {
      stroke-dashoffset: 64;
      --branch-progress: 0;
    }
    to {
      stroke-dashoffset: 0;
      --branch-progress: 1;
    }
  }
  @keyframes aq-draw-tip {
    from { opacity: 0; transform: scale(0.4); transform-origin: center; }
    to   { opacity: 1; transform: scale(1); transform-origin: center; }
  }

  .fork-trunk {
    /* Trunk renders statically — it represents the question being asked,
       always present even before the user could "see" the branches. */
  }

  .fork-overflow {
    font-size: 10px;
    fill: var(--color-text-secondary);
    stroke: none;
    font-family: var(--font-mono);
  }

  /* Reduced-motion (R-78, AG-41): paths render statically at the final state. */
  :global(html[data-motion="reduced"]) .aq-card .fork-branch {
    animation: none !important;
    stroke-dashoffset: 0 !important;
    --branch-progress: 1 !important;
  }
  :global(html[data-motion="reduced"]) .aq-card .fork-tip {
    animation: none !important;
    opacity: 1 !important;
  }

  .aq-titles {
    display: flex;
    flex-direction: column;
    gap: var(--p-space-1);
    flex: 1;
    min-width: 0;
  }

  .aq-chevron {
    margin-left: var(--p-space-2);
    flex-shrink: 0;
    color: var(--color-text-tertiary);
  }

  .aq-chip {
    display: inline-block;
    width: fit-content;
    background: color-mix(in srgb, var(--color-question) 12%, transparent);
    color: var(--color-question);
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 2px 8px;
    border-radius: var(--radius-xs);
    font-weight: 600;
  }

  .aq-question {
    font-family: var(--font-headline);
    font-size: var(--font-size-h3);
    margin: 0;
    color: var(--color-text-primary);
    line-height: 1.25;
    letter-spacing: -0.01em;
  }

  .aq-sequence {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    margin: 0;
  }

  /* OPTIONS GRID */
  .aq-options {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--p-space-3);
  }

  .aq-option {
    background: var(--color-surface);
    border: 1px solid var(--color-border-hairline);
    border-radius: var(--radius-sm);
    padding: var(--p-space-4);
    transition: opacity 200ms ease-out, border-color 200ms ease-out;
  }

  .aq-option.is-dimmed {
    opacity: 0.45;
  }

  .aq-option.is-chosen {
    opacity: 1;
    border: 1.5px solid var(--color-question);
    background: var(--color-surface-raised);
    --pulse: 0;
    box-shadow:
      0 0 0 calc(var(--pulse) * 4px) color-mix(in srgb, var(--color-question) 28%, transparent),
      0 1px 0 var(--color-border-hairline);
    animation: aq-pulse 2.4s ease-in-out infinite alternate;
    animation-play-state: paused;
  }

  .aq-card[data-visible="true"] .aq-option.is-chosen {
    animation-play-state: running;
  }

  @keyframes aq-pulse {
    from { --pulse: 0; }
    to   { --pulse: 1; }
  }

  :global(html[data-motion="reduced"]) .aq-option.is-chosen {
    animation: none !important;
    box-shadow: 0 1px 0 var(--color-border-hairline) !important;
    --pulse: 0 !important;
  }

  .opt-row {
    display: flex;
    align-items: flex-start;
    gap: var(--p-space-3);
  }

  .opt-check {
    color: var(--color-question);
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .opt-bullet {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid var(--color-text-tertiary);
  }

  .opt-text {
    flex: 1;
    min-width: 0;
  }

  .opt-label {
    margin: 0;
    font-size: var(--font-size-body);
    color: var(--color-text-primary);
    font-weight: 600;
    line-height: 1.4;
  }

  .aq-option.is-chosen .opt-label {
    color: var(--color-question);
  }

  .opt-description {
    margin: var(--p-space-1) 0 0 0;
    font-size: var(--font-size-meta);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  /* INLINE NOTES PANEL — only when expanded (R-57 parity with SubAgentCard). */
  .aq-notes {
    background: var(--color-surface-sunken);
    border-radius: var(--radius-sm);
    padding: var(--p-space-3) var(--p-space-4);
    border-left: 3px solid var(--color-question);
    /* Hidden by default; revealed on expand via Grid auto 0fr → auto 1fr is
       overkill for a notes block — use a simpler height transition. */
    overflow: hidden;
    max-height: 0;
    opacity: 0;
    transition: max-height 250ms ease-out, opacity 200ms ease-out;
  }

  .aq-card[data-expanded="true"] .aq-notes {
    max-height: 400px;
    opacity: 1;
  }

  :global(html[data-motion="reduced"]) .aq-notes {
    transition: none !important;
  }

  .notes-header {
    margin-bottom: var(--p-space-1);
  }

  .notes-label {
    font-size: var(--font-size-caption);
    color: var(--color-question);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }

  .notes-body {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-meta);
    line-height: 1.6;
    font-style: italic;
  }

  /* MOBILE: single-column options + tighter padding. */
  @media (max-width: 767px) {
    .aq-options {
      grid-template-columns: 1fr;
    }
    .fork-svg {
      width: 80px;
      height: 24px;
    }
  }
</style>
