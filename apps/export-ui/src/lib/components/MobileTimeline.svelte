<!--
  MobileTimeline — anchor-list timeline for mobile chapter view (design D3, R-28).

  REPLACES the horizontal-swipe <TimelineScrubber> on mobile. The swipe gesture
  conflicts with native page scroll on iOS Safari and Android Chrome (D3
  rationale), so on mobile we present a vertical list of event anchors at the
  trailing edge of the chapter view. Each anchor:
    - Small colored dot (event kind color)
    - Short event-kind label (DECISION, ERROR, etc. — accessibility win for
      colorblind audiences vs. dot-only)
    - Optional small tail showing the first few chars of the event title

  Tapping an anchor scrolls the corresponding event into view (smooth on
  desktop, instant on reduced-motion).

  Mounted only on mobile by <ChapterPlayer> (the desktop branch keeps
  <TimelineScrubber>).
-->
<script lang="ts">
  import type { RenderEvent } from "../types";
  import { subscribeMotion } from "../stores/motion";
  import { onMount } from "svelte";
  import LegendKey from "./LegendKey.svelte";
  import PlaybackController from "./PlaybackController.svelte";

  interface Props {
    events: RenderEvent[];
  }

  const { events }: Props = $props();

  let reduced = $state(false);
  onMount(() =>
    subscribeMotion((s) => {
      // Mobile is always treated as motion-reduced per Q4 / R-27, but we
      // honor the OS preference too so an iPad on a desktop-like profile
      // still respects the user's setting.
      reduced = !s.motionAllowed;
    }),
  );

  /**
   * Categorical color mapping mirrors <TimelineScrubber>'s palette — kept in
   * sync so the dot color is identical between desktop scrubber chips and
   * mobile anchor dots.
   */
  function dotClass(kind: string): string {
    if (kind.includes("decision")) return "dot-decision";
    if (kind.includes("error")) return "dot-error";
    if (kind.includes("fix")) return "dot-fix";
    if (kind.includes("lesson")) return "dot-lesson";
    if (kind.includes("milestone")) return "dot-milestone";
    if (kind.includes("question")) return "dot-question";
    if (kind.includes("subagent") || kind.includes("sub_agent")) return "dot-subagent";
    if (kind.includes("resource")) return "dot-resource";
    return "dot-default";
  }

  /** Map event kind → short uppercase label for the anchor row. */
  function kindLabel(kind: string): string {
    if (kind.includes("decision")) return "DECISION";
    if (kind.includes("error")) return "ERROR";
    if (kind.includes("fix")) return "FIX";
    if (kind.includes("lesson")) return "LESSON";
    if (kind.includes("milestone")) return "MILESTONE";
    if (kind.includes("question")) return "QUESTION";
    if (kind.includes("subagent") || kind.includes("sub_agent")) return "SUB-AGENT";
    if (kind.includes("resource")) return "RESOURCE";
    if (kind.includes("commit")) return "COMMIT";
    return "EVENT";
  }

  /** Pull a short title-ish string from arbitrary event shapes. */
  function shortTitle(ev: RenderEvent): string {
    const rec = ev as Record<string, unknown>;
    const candidate =
      (typeof rec["title"] === "string" && rec["title"]) ||
      (typeof rec["label"] === "string" && rec["label"]) ||
      (typeof rec["description"] === "string" && rec["description"]) ||
      "";
    if (typeof candidate !== "string") return "";
    const t = candidate.trim();
    return t.length > 40 ? `${t.slice(0, 38)}…` : t;
  }

  function jumpTo(eventId: string): void {
    const el = document.getElementById(`event-${eventId}`);
    if (!el) return;
    el.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  }
</script>

<nav class="mobile-timeline" aria-label="Chapter timeline" data-testid="mobile-timeline">
  <!-- Slice 12 P1 R-51: legend parity at the top of the mobile timeline. -->
  <LegendKey variant="mobile" />

  <!-- Slice 12 P6 R-72: compact playback controls (single cycle speed button). -->
  <div class="mobile-playback">
    <PlaybackController {events} compact />
  </div>

  <p class="title">Timeline</p>
  <ol class="anchor-list">
    {#each events as ev (ev.id)}
      <li>
        <button
          type="button"
          class="anchor"
          onclick={() => jumpTo(ev.id)}
          aria-label={`Jump to ${kindLabel(ev.type)}: ${shortTitle(ev) || ev.id}`}
        >
          <span class={`dot ${dotClass(ev.type)}`} aria-hidden="true"></span>
          <span class="kind-label">{kindLabel(ev.type)}</span>
          {#if shortTitle(ev)}
            <span class="title-tail">{shortTitle(ev)}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ol>
</nav>

<style>
  .mobile-timeline {
    border: var(--card-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    padding: var(--p-space-4);
    margin: var(--p-space-5) 0;
  }

  .mobile-playback {
    margin: 0 0 var(--p-space-3) 0;
    display: flex;
    justify-content: flex-end;
  }

  .title {
    margin: 0 0 var(--p-space-3) 0;
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .anchor-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .anchor {
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
    width: 100%;
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--color-text-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
    padding: var(--p-space-2) var(--p-space-2);
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-xs);
    min-height: 36px; /* touch target ≥ 36px per general mobile guideline */
  }
  .anchor:hover {
    background: var(--color-surface-sunken);
  }
  .anchor:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 1px;
  }

  .dot {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-text-tertiary);
  }
  .dot-decision  { background: var(--color-decision); }
  .dot-error     { background: var(--color-error); }
  .dot-fix       { background: var(--color-fix); }
  .dot-lesson    { background: var(--color-lesson); }
  .dot-milestone { background: var(--color-accent-primary); }
  .dot-question  { background: var(--color-question); }
  .dot-subagent  { background: var(--color-accent-secondary); }
  .dot-resource  { background: var(--color-success); }
  .dot-default   { background: var(--color-text-tertiary); }

  .kind-label {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    min-width: 80px;
  }

  .title-tail {
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
