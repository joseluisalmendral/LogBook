<!--
  SkillBadge — small chip showing a skill loaded for an event.

  Spec motion #6 / R-37. Hover lift = translateY(-1px) + box-shadow swap,
  150ms ease-out (Emil Kowalski hover register). Reduced-motion kills the
  hover transform via the global rule.

  ARIA: hover tooltip via `title` attribute (accessible name). For richer
  tooltip behavior (path + description on focus), the design phase deferred
  to P5 polish — this slice ships the visual chip + a11y label.
-->
<script lang="ts">
  interface Props {
    skill: string;
    description?: string;
  }

  const { skill, description }: Props = $props();
</script>

<span
  class="skill-badge"
  title={description ?? skill}
  tabindex="0"
  role="note"
  aria-label={description ? `Skill ${skill}: ${description}` : `Skill ${skill}`}
  data-testid="skill-badge"
>
  <span class="dot" aria-hidden="true"></span>
  <code class="name">{skill}</code>
</span>

<style>
  .skill-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--p-space-2);
    background: var(--color-surface-sunken);
    border: 1px solid var(--color-border-hairline);
    border-radius: var(--radius-xs);
    padding: 3px 8px;
    color: var(--color-accent-primary);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    cursor: default;
    transition: transform 150ms ease-out, box-shadow 150ms ease-out, border-color 150ms ease;
  }

  .skill-badge:hover,
  .skill-badge:focus-visible {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
    border-color: var(--color-accent-primary);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .name {
    color: inherit;
    background: transparent;
    padding: 0;
  }
</style>
