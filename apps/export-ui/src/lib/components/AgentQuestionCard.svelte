<!--
  AgentQuestionCard — the pedagogical fork moment.

  Spec R-25 / S-11 / AG-6. This is the moment of human steering during an AI
  session: the agent asked a multiple-choice question and the human picked
  one of the options. Students learn AS MUCH from the unchosen branches as
  from the chosen one — so unchosen options stay readable (just dimmed),
  notes panel inline when present.

  Four visual states per the spec:
    (a) Question header — editorial serif, "Branching" chip, fork SVG glyph.
    (b) Options DIMMED when unchosen — opacity 0.45, no border highlight.
    (c) CHOSEN option highlighted — accent border, checkmark badge, subtle
        pulse animation (gated by motion + IntersectionObserver).
    (d) Inline notes panel when notes present — "Other / notes" label + body.

  VISUAL LANGUAGE
    SubAgentCard uses card-flip 3D.
    AgentQuestionCard uses branching grid + fork glyph.
    DecisionMilestone uses pulsing ring.
    These three components MUST be visually distinct so the student's eye
    learns to recognize them at a glance.

  THE FORK GLYPH
    Custom inline SVG — a branching path. Two strokes diverging from a node.
    Stroke uses currentColor so it picks up the question accent token
    (var(--color-question) — antique gold light / boosted gold dark).

  PULSE ANIMATION
    @property --pulse: <number> registered for animatable transition. Drives
    box-shadow ring on the chosen option. IntersectionObserver gates the
    animation-play-state so it ONLY runs when the card is visible — critical
    for long chapters where dozens of question cards exist below the fold.
    Reduced-motion → animation-play-state: paused permanently (static glow).
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { RenderEvent } from "../types";

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

  /**
   * Resolve which option labels are the chosen ones. The transcript stores
   * answers as the option LABEL (the human-readable string the user picked),
   * not the value — that's how AskUserQuestion serializes its result.
   */
  function isChosen(opt: Option): boolean {
    if (chosen == null) return false;
    const chosenArr = Array.isArray(chosen) ? chosen : [chosen];
    return chosenArr.includes(opt.label) || (opt.value != null && chosenArr.includes(opt.value));
  }

  // IntersectionObserver gate for the pulse animation.
  let cardEl: HTMLElement | undefined = $state();
  let isVisible = $state(false);

  onMount(() => {
    if (!cardEl || typeof IntersectionObserver === "undefined") {
      // Without IO support, default to visible — the pulse runs always but the
      // reduced-motion override still pauses it.
      isVisible = true;
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          isVisible = entry.isIntersecting;
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(cardEl);
    return () => observer.disconnect();
  });
</script>

<article
  class="aq-card"
  data-testid="agent-question-card"
  data-visible={isVisible}
  bind:this={cardEl}
>
  <header class="aq-header">
    <span class="fork-glyph" aria-hidden="true">
      <!--
        Branching SVG. A node with two paths diverging — pedagogical signal
        that THIS was a fork in the road.
      -->
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="5" r="1.6" fill="currentColor" />
        <path d="M12 6.6 V11" />
        <path d="M12 11 Q12 14 7.5 16.5" />
        <path d="M12 11 Q12 14 16.5 16.5" />
        <circle cx="7.5" cy="17.6" r="1.4" fill="currentColor" />
        <circle cx="16.5" cy="17.6" r="1.4" fill="currentColor" />
      </svg>
    </span>
    <div class="aq-titles">
      <span class="aq-chip">{header}</span>
      <h3 class="aq-question">{question}</h3>
      {#if questionCount && questionCount > 1 && questionIndex != null}
        <p class="aq-sequence lb-tnum">Q {questionIndex + 1} of {questionCount}</p>
      {/if}
    </div>
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
</article>

<style>
  /* Pulse value (0..1) for the chosen-option ring. Registered as a CSS @property
     so it can be animated smoothly (not stepped). Default 0 = no glow. */
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
    /* The fork glyph + chip + question text all use the question accent. */
    color: var(--color-text-primary);
    box-shadow: 0 1px 0 var(--color-border-hairline);
  }

  .aq-header {
    display: flex;
    align-items: flex-start;
    gap: var(--p-space-3);
  }

  .fork-glyph {
    color: var(--color-question);
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--color-surface-sunken);
    border-radius: 50%;
    flex-shrink: 0;
  }

  .aq-titles {
    display: flex;
    flex-direction: column;
    gap: var(--p-space-1);
    flex: 1;
    min-width: 0;
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
    /* Subtle pulse via @property --pulse — only animates when motion is allowed
       AND the card is in the viewport. Reduced-motion override at bottom. */
    --pulse: 0;
    box-shadow:
      0 0 0 calc(var(--pulse) * 4px) color-mix(in srgb, var(--color-question) 28%, transparent),
      0 1px 0 var(--color-border-hairline);
    animation: aq-pulse 2.4s ease-in-out infinite alternate;
    animation-play-state: paused;
  }

  /* IO-gated animation: only run when in viewport. */
  .aq-card[data-visible="true"] .aq-option.is-chosen {
    animation-play-state: running;
  }

  @keyframes aq-pulse {
    from { --pulse: 0; }
    to   { --pulse: 1; }
  }

  /* Reduced-motion: kill the pulse entirely. Keep the static accent border so
     the chosen option remains visually distinguished. */
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

  /* INLINE NOTES PANEL — rendered only when payload.notes is non-empty. */
  .aq-notes {
    background: var(--color-surface-sunken);
    border-radius: var(--radius-sm);
    padding: var(--p-space-3) var(--p-space-4);
    border-left: 3px solid var(--color-question);
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
  }
</style>
