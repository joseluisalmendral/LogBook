<!--
  PhaseAct — large section divider inside a ChapterPlayer.

  "Phase as Act" — borrowed from theatrical structure: each phase reads as a
  named act in the narrative. Editorial serif title, optional subtitle,
  hairline divider above + below.

  Spec design §2 row 7. Lightweight component; props only.
-->
<script lang="ts">
  interface Props {
    label: string;
    subtitle?: string;
    index?: number;
  }

  const { label, subtitle, index }: Props = $props();

  // Roman numerals for "Act II — W2 — Scaffold" register. Caps out at XII.
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  const actLabel = $derived(typeof index === "number" && index >= 0 && index < ROMAN.length ? `Act ${ROMAN[index]}` : null);
</script>

<header class="phase-act" data-testid="phase-act">
  {#if actLabel}
    <p class="act-eyebrow">{actLabel}</p>
  {/if}
  <h2 class="act-title">{label}</h2>
  {#if subtitle}
    <p class="act-subtitle">{subtitle}</p>
  {/if}
</header>

<style>
  .phase-act {
    margin: var(--p-space-9) 0 var(--p-space-6) 0;
    padding-bottom: var(--p-space-4);
    border-bottom: 1px solid var(--color-border-hairline);
  }

  .phase-act:first-child {
    margin-top: 0;
  }

  .act-eyebrow {
    font-family: var(--font-headline);
    font-style: italic;
    font-size: var(--font-size-meta);
    color: var(--color-text-secondary);
    margin: 0 0 var(--p-space-2) 0;
    letter-spacing: 0.04em;
  }

  .act-title {
    font-family: var(--font-headline);
    font-size: var(--font-size-h1);
    margin: 0;
    color: var(--color-text-primary);
    line-height: 1.05;
    letter-spacing: -0.02em;
  }

  .act-subtitle {
    margin: var(--p-space-2) 0 0 0;
    font-style: italic;
    color: var(--color-text-secondary);
    font-size: var(--font-size-lead);
  }

  @media (max-width: 767px) {
    .phase-act {
      margin-top: var(--p-space-7);
    }
    .act-title {
      font-size: var(--font-size-h2);
    }
  }
</style>
