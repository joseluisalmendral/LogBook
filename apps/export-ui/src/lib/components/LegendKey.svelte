<!--
  LegendKey — slice 12 P1 (R-51, AG-21, ADR-SC-A1).

  Collapsible inline strip showing the 8 event-kind colors + labels. Acts as
  the rosetta stone for the colored borders + monograms used across the
  timeline (research brief #289 affordance fix #3).

  Default state: COLLAPSED — only the toggle button is visible. Reveals the
  chip strip inline when the user clicks. This keeps vertical real estate
  cheap on the default view yet makes discovery explicit (ADR-SC-A1 rejects
  hover popovers as a11y/touch hostile).

  Mounted by:
    - <TimelineScrubber> on desktop (above the scrubber dock)
    - <MobileTimeline> on mobile (at the top of the anchor list)

  Token contract:
    Reads --color-decision/error/milestone/lesson/fix/question/subagent/generic
    from the existing token sheet. NO new color tokens introduced here; if a
    palette swap is needed, semantic.css is the single source of truth.

  A11y:
    Toggle is a real <button> with aria-expanded + aria-controls. The chip
    strip has aria-hidden mirroring expanded state so AT users don't have
    duplicated content announced when collapsed.
-->
<script lang="ts">
  interface ChipDef {
    kind: string;
    label: string;
    monogram: string;
    cssVar: string;
  }

  /**
   * 8-chip dictionary. Order chosen so the highest-density kinds (decision,
   * error, milestone) come first, matching the reading frequency students
   * encounter in real sessions.
   */
  const CHIPS: ChipDef[] = [
    { kind: "decision",  label: "Decision",  monogram: "⚑", cssVar: "var(--color-decision)" },
    { kind: "error",     label: "Error",     monogram: "✕", cssVar: "var(--color-error)" },
    { kind: "milestone", label: "Milestone", monogram: "★", cssVar: "var(--color-milestone)" },
    { kind: "lesson",    label: "Lesson",    monogram: "✎", cssVar: "var(--color-lesson)" },
    { kind: "fix",       label: "Fix",       monogram: "✓", cssVar: "var(--color-fix)" },
    { kind: "question",  label: "Question",  monogram: "❓", cssVar: "var(--color-question)" },
    { kind: "subagent",  label: "Sub-agent", monogram: "⟳", cssVar: "var(--color-subagent)" },
    { kind: "generic",   label: "Event",     monogram: "•", cssVar: "var(--color-generic)" },
  ];

  interface Props {
    /** Layout variant. `inline` is the default; `mobile` adds vertical rhythm. */
    variant?: "inline" | "mobile";
  }

  const { variant = "inline" }: Props = $props();

  // Default collapsed per spec R-51.
  let expanded = $state(false);

  function toggle(): void {
    expanded = !expanded;
  }
</script>

<div class="legend" data-variant={variant} data-testid="legend-key">
  <button
    type="button"
    class="legend-toggle"
    aria-expanded={expanded}
    aria-controls="lb-legend-strip"
    aria-label={expanded ? "Hide event-kind legend" : "Show event-kind legend"}
    onclick={toggle}
  >
    <span class="lb-chevron" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="5 3 11 8 5 13" />
      </svg>
    </span>
    <span class="legend-toggle-label">Legend</span>
  </button>

  <ul
    id="lb-legend-strip"
    class="legend-strip"
    role="list"
    aria-hidden={!expanded}
    hidden={!expanded}
  >
    {#each CHIPS as chip}
      <li class="legend-chip">
        <span class="chip-dot" style="background: {chip.cssVar};" aria-hidden="true"></span>
        <span class="chip-monogram" aria-hidden="true" style="color: {chip.cssVar};">{chip.monogram}</span>
        <span class="chip-label">{chip.label}</span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .legend {
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }

  .legend[data-variant="mobile"] {
    flex-direction: column;
    align-items: stretch;
    gap: var(--p-space-2);
    padding-bottom: var(--p-space-2);
    border-bottom: 1px solid var(--color-border-hairline);
    margin-bottom: var(--p-space-3);
  }

  .legend-toggle {
    appearance: none;
    background: transparent;
    border: 0;
    padding: 4px 6px;
    border-radius: var(--radius-xs);
    cursor: pointer;
    color: var(--color-text-secondary);
    font: inherit;
    display: inline-flex;
    align-items: center;
    gap: var(--p-space-1);
    flex-shrink: 0;
  }

  .legend-toggle:hover {
    color: var(--color-text-primary);
    background: rgba(var(--brand-rgb), 0.05);
  }

  .legend-toggle:focus-visible {
    outline: 1px solid var(--color-focus);
    outline-offset: 2px;
  }

  .legend-toggle-label {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }

  /*
   * Slice-25 fix: the previous version set `display:flex` unconditionally,
   * which overrode the HTML `hidden` attribute (browser default
   * `[hidden]{display:none}` was beaten on specificity by the class rule).
   * Net effect: the toggle button flipped aria-expanded but the strip
   * stayed visible. Move the display rule under [aria-hidden="false"] so
   * the strip is hidden by default and revealed only when expanded.
   */
  .legend-strip {
    list-style: none;
    margin: 0;
    padding: 0;
    display: none;
    flex-wrap: wrap;
    gap: var(--p-space-3) var(--p-space-4);
    align-items: center;
  }

  .legend-strip[aria-hidden="false"] {
    display: flex;
  }

  .legend[data-variant="mobile"] .legend-strip {
    gap: var(--p-space-2) var(--p-space-3);
  }

  .legend-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  .chip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .chip-monogram {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    font-weight: 700;
    line-height: 1;
  }

  .chip-label {
    color: var(--color-text-secondary);
    font-family: var(--font-body);
    font-size: var(--font-size-caption);
  }
</style>
