<!--
  ChapterHeader — top of a ChapterPlayer. Editorial serif title, italics goal,
  outcome badge, model + duration badges.

  Motion #4: subtle parallax title via `animation-timeline: scroll(root block)`.
  Translates the title up to -30px as the user scrolls. Gated by motion and
  mobile breakpoint (CSS `@supports (animation-timeline: scroll())` for
  progressive enhancement — older browsers see a static title).

  Reduced-motion + mobile: `transform: none` everywhere.

  Spec R-17 + motion #1: the header carries `view-transition-name: chapter-{id}`
  so the TOC→chapter morph has a shared element to interpolate against.
-->
<script lang="ts">
  import type { Chapter, FileTouch } from "../types";
  import FileChangeStrip from "./FileChangeStrip.svelte";
  import { router } from "../stores/router";

  interface Props {
    chapter: Chapter;
  }

  const { chapter }: Props = $props();

  /**
   * Slice-14 Bucket E: chapter-level aggregate of files touched. Read with a
   * strict runtime guard — old payloads without the field stay supported.
   */
  const filesTouched = $derived(
    Array.isArray(chapter.filesTouched)
      ? (chapter.filesTouched as FileTouch[]).filter(
          (f) => f && typeof f.path === "string" && typeof f.action === "string",
        )
      : [],
  );

  let filesExpanded = $state(false);
  function toggleFiles(): void {
    filesExpanded = !filesExpanded;
  }

  function openTranscript(): void {
    router.navigate({ name: "transcript", sessionId: chapter.sessionId, eventId: null });
  }

  const tsDisplay = $derived.by(() => {
    const d = new Date(chapter.ts);
    if (Number.isNaN(d.getTime())) return chapter.ts;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  });

  const durationLabel = $derived.by(() => {
    if (!chapter.endTs) return null;
    const start = new Date(chapter.ts).getTime();
    const end = new Date(chapter.endTs).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
    const mins = Math.round((end - start) / 60000);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  });

  // Build a CSS-safe view-transition-name from the chapter id.
  const vtName = $derived(`chapter-${chapter.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
</script>

<header
  class="ch-header"
  data-testid="chapter-header"
  style="view-transition-name: {vtName};"
>
  <div class="ch-eyebrow-row">
    <p class="ch-eyebrow">Session</p>
    <time class="ch-date lb-tnum" datetime={chapter.ts}>{tsDisplay}</time>
  </div>

  <h1 class="ch-title">{chapter.label}</h1>

  {#if chapter.goal}
    <p class="ch-goal">{chapter.goal}</p>
  {/if}

  <div class="ch-meta-row">
    {#if chapter.outcome}
      <span class="meta-pill meta-outcome">
        <span class="meta-label">Outcome</span>
        <span class="meta-value">{chapter.outcome}</span>
      </span>
    {/if}
    {#if durationLabel}
      <span class="meta-pill meta-duration">
        <span class="meta-label">Duration</span>
        <span class="meta-value lb-tnum">{durationLabel}</span>
      </span>
    {/if}
    <button
      type="button"
      class="meta-pill meta-transcript-link"
      onclick={openTranscript}
      data-interactive
      aria-label="View raw transcript for this session"
    >
      <span class="meta-label">Raw</span>
      <span class="meta-value">View transcript →</span>
    </button>
    {#if filesTouched.length > 0}
      <!-- Slice-14 Bucket E: chapter-level "files touched" summary. Collapsed
           pill expands into a full FileChangeStrip below. -->
      <button
        type="button"
        class="meta-pill meta-files-pill"
        onclick={toggleFiles}
        data-interactive
        aria-expanded={filesExpanded}
        aria-controls={`ch-files-${chapter.sessionId}`}
        aria-label={`${filesExpanded ? "Hide" : "Show"} ${filesTouched.length} file${filesTouched.length === 1 ? "" : "s"} touched`}
      >
        <span class="meta-label">Files</span>
        <span class="meta-value lb-tnum">{filesTouched.length}&nbsp;touched</span>
      </button>
    {/if}
  </div>
  {#if filesTouched.length > 0 && filesExpanded}
    <div class="ch-files" id={`ch-files-${chapter.sessionId}`}>
      <FileChangeStrip files={filesTouched} ariaLabel="Files touched in this chapter" />
    </div>
  {/if}
</header>

<style>
  .ch-header {
    padding: var(--p-space-9) 0 var(--p-space-7) 0;
    border-bottom: 1px solid var(--color-border-hairline);
    margin-bottom: var(--p-space-7);
  }

  .ch-eyebrow-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: var(--p-space-4);
  }

  .ch-eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin: 0;
  }

  .ch-date {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }

  .ch-title {
    font-family: var(--font-headline);
    font-size: var(--font-size-display);
    color: var(--color-text-primary);
    margin: 0 0 var(--p-space-4) 0;
    line-height: 1.02;
    letter-spacing: -0.02em;
    /* Scroll-driven parallax. Animation-timeline: scroll() lets the title
       translate as the document scrolls. Gated by @supports + reduced-motion
       (global app.css zeroes animation-duration). */
  }

  @supports (animation-timeline: scroll()) {
    .ch-title {
      animation: ch-title-parallax linear both;
      animation-timeline: scroll(root block);
      animation-range: 0 400px;
    }
    @keyframes ch-title-parallax {
      from { transform: translate3d(0, 0, 0); opacity: 1; }
      to   { transform: translate3d(0, -30px, 0); opacity: 0.92; }
    }
  }

  /* Reduced-motion + mobile: kill the parallax. */
  :global(html[data-motion="reduced"]) .ch-title,
  :global(html[data-viewport="mobile"]) .ch-title {
    animation: none !important;
    transform: none !important;
  }

  .ch-goal {
    font-style: italic;
    font-size: var(--font-size-h3);
    color: var(--color-text-secondary);
    margin: 0 0 var(--p-space-6) 0;
    line-height: 1.4;
    max-width: var(--reading-max-width);
  }

  .ch-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--p-space-3);
  }

  .meta-pill {
    display: inline-flex;
    align-items: baseline;
    gap: var(--p-space-2);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-hairline);
    border-radius: var(--radius-sm);
    padding: var(--p-space-2) var(--p-space-3);
    font-size: var(--font-size-meta);
  }

  .meta-label {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }

  .meta-value {
    color: var(--color-text-primary);
  }

  .meta-outcome .meta-label {
    color: var(--color-success);
  }

  /* Slice 12 P5: raw transcript link styled as a pill button (consistent with
     the rest of the meta row). */
  .meta-transcript-link {
    appearance: none;
    cursor: pointer;
    color: var(--color-text-primary);
    font-family: inherit;
    transition: border-color 150ms ease-out;
  }
  .meta-transcript-link:hover,
  .meta-transcript-link:focus-visible {
    border-color: var(--color-accent-primary);
    color: var(--color-accent-primary);
  }
  .meta-transcript-link .meta-label {
    color: var(--color-accent-primary);
  }

  /* Slice 14 Bucket E: files-touched pill mirrors transcript-link styling.
     Active-state border swaps when expanded so users have a clear toggle cue. */
  .meta-files-pill {
    appearance: none;
    cursor: pointer;
    color: var(--color-text-primary);
    font-family: inherit;
    transition: border-color 150ms ease-out, color 150ms ease-out;
  }
  .meta-files-pill:hover,
  .meta-files-pill:focus-visible,
  .meta-files-pill[aria-expanded="true"] {
    border-color: var(--color-accent-primary);
    color: var(--color-accent-primary);
  }
  .meta-files-pill .meta-label {
    color: var(--color-accent-primary);
  }

  .ch-files {
    margin-top: var(--p-space-4);
    padding-top: var(--p-space-3);
    border-top: 1px solid var(--color-border-hairline);
  }

  @media (max-width: 767px) {
    .ch-header {
      padding-top: var(--p-space-6);
    }
    .ch-title {
      font-size: var(--font-size-h1);
    }
    .ch-goal {
      font-size: var(--font-size-lead);
    }
  }
</style>
