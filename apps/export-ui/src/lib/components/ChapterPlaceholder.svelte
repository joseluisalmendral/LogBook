<!--
  ChapterPlaceholder — temporary stub for the chapter route in P3.

  Shows: chapter title + goal + outcome + events summary + a notice that
  the full <ChapterPlayer> ships in P4. Includes a "Back to TOC" button so
  the chapter route is fully navigable end-to-end even without the player.

  Why keep this lightweight component rather than skip the route?
    Routing is part of P3's scope (R-17). Without a non-empty chapter view
    we can't visually verify that hash navigation works — the dev server
    would either render nothing or fall back to TOC, masking bugs in the
    router. The placeholder closes that visual loop.
-->
<script lang="ts">
  import { payload } from "../stores/data";
  import { router } from "../stores/router";

  interface Props {
    chapterId: string;
  }

  const { chapterId }: Props = $props();

  const chapter = $derived(
    payload.chapters.find((c) => c.sessionId === chapterId) ?? null,
  );

  function back(): void {
    router.navigate({ name: "toc" });
  }
</script>

<section class="chapter-placeholder" data-testid="chapter-placeholder">
  <header class="ch-header">
    <button type="button" class="back-button" onclick={back} data-testid="back-button">
      <span aria-hidden="true">←</span> Back to course
    </button>
    {#if chapter}
      <p class="ch-eyebrow">Session</p>
      <h1 class="ch-title">{chapter.label}</h1>
      {#if chapter.goal}
        <p class="ch-goal">{chapter.goal}</p>
      {/if}
      {#if chapter.outcome}
        <p class="ch-outcome">
          <span class="outcome-pill">Outcome</span>
          {chapter.outcome}
        </p>
      {/if}
    {:else}
      <h1 class="ch-title">Session not found</h1>
      <p>No session with id <code>{chapterId}</code> in this export.</p>
    {/if}
  </header>

  {#if chapter}
    <div class="player-stub">
      <p class="stub-label">Chapter Player</p>
      <p class="stub-msg">
        Editorial replay player ships in slice 10 P4 —
        <code>&lt;ChapterPlayer&gt;</code> with timeline scrubber, sub-agent
        card flips, agent question fork cards, and slide-in prompt inspector.
      </p>
      <p class="stub-stats">
        This session has <strong>{chapter.events.length}</strong> event{chapter.events.length === 1 ? "" : "s"}.
      </p>
    </div>
  {/if}
</section>

<style>
  .chapter-placeholder {
    padding: var(--p-space-7) var(--p-space-6);
    max-width: 880px;
    margin: 0 auto;
  }

  .ch-header {
    border-bottom: var(--card-border);
    padding-bottom: var(--p-space-5);
    margin-bottom: var(--p-space-6);
  }

  .back-button {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--color-accent-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
    padding: 0;
    cursor: pointer;
    margin-bottom: var(--p-space-4);
    display: inline-flex;
    align-items: center;
    gap: var(--p-space-1);
  }

  .back-button:hover {
    text-decoration: underline;
  }

  .ch-eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0 0 var(--p-space-2) 0;
  }

  .ch-title {
    font-family: var(--font-headline);
    font-size: var(--font-size-h1);
    margin: 0 0 var(--p-space-3) 0;
    line-height: 1.1;
    color: var(--color-text-primary);
    letter-spacing: -0.01em;
  }

  .ch-goal {
    font-style: italic;
    color: var(--color-text-secondary);
    font-size: var(--font-size-lead);
    margin: 0 0 var(--p-space-3) 0;
    line-height: 1.4;
  }

  .ch-outcome {
    margin: 0;
    color: var(--color-text-primary);
  }

  .outcome-pill {
    display: inline-block;
    background: var(--color-surface-sunken);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    margin-right: var(--p-space-2);
  }

  .player-stub {
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--card-radius);
    padding: var(--card-padding);
  }

  .stub-label {
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-accent-primary);
    margin: 0 0 var(--p-space-2) 0;
  }

  .stub-msg {
    margin: 0 0 var(--p-space-4) 0;
    color: var(--color-text-secondary);
    line-height: 1.6;
  }

  .stub-msg code {
    background: var(--color-surface-sunken);
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    color: var(--color-text-primary);
  }

  .stub-stats {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-meta);
  }
</style>
