<!--
  DashboardKpi — KPI card atom. Spec design §2 row 22.

  Slice 12 P1 enhancement (R-77 / ADR-SC-G2 / AG-39 / M5):
    Numeric values animate 0 → target over 800ms on first viewport entry.
    Driven by a CSS @property --kpi-value + IntersectionObserver gate using
    a counter-reset + content: counter() trick. Reduced-motion shows the final
    value instantly (no count-up).

  Implementation notes:
    - --kpi-value is registered as a <number> @property at module scope so the
      browser can interpolate it smoothly.
    - When the host element gains [data-counted], CSS animates the variable
      to the target value over 800ms with the Jhey Tompkins linear() spring.
    - We render the display value via counter-reset + ::after { content: counter() }
      so the displayed integer reads from the animated variable, NOT from JS.
      This is the pattern from research brief #289 pattern #9.
    - Non-numeric `value` props (string) skip the count-up path entirely.
-->
<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    label: string;
    value: number | string;
    accent?: "primary" | "decision" | "error" | "milestone" | "question";
  }

  const { label, value, accent = "primary" }: Props = $props();

  const isNumeric = $derived(typeof value === "number" && Number.isFinite(value));
  const numericTarget = $derived(isNumeric ? Math.round(value as number) : 0);

  let host: HTMLElement | undefined = $state();
  let counted = $state(false);

  onMount(() => {
    if (!isNumeric || !host) return;
    if (typeof IntersectionObserver === "undefined") {
      // Without IO support, snap to final value (no animation).
      counted = true;
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            counted = true;
            obs.disconnect();
            break;
          }
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(host);
    return () => obs.disconnect();
  });
</script>

<div
  class="kpi"
  data-accent={accent}
  data-testid="dashboard-kpi"
  data-counted={counted}
  data-numeric={isNumeric}
  style={isNumeric ? `--kpi-target: ${numericTarget};` : undefined}
  bind:this={host}
>
  {#if isNumeric}
    <!--
      The visible number is rendered via CSS counter() reading from
      --kpi-value (which animates 0 → target). The inner <span> with
      aria-live announces the final value for screen readers without
      relying on the animated content.
    -->
    <span class="kpi-value lb-tnum" aria-hidden="true"></span>
    <span class="sr-only" aria-live="polite">{numericTarget}</span>
  {:else}
    <span class="kpi-value lb-tnum">{value}</span>
  {/if}
  <span class="kpi-label">{label}</span>
</div>

<style>
  /* Animatable numeric custom property — Chromium/Safari/Firefox 128+. */
  @property --kpi-value {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
  }

  .kpi {
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--card-radius);
    padding: var(--p-space-4);
    display: flex;
    flex-direction: column;
    gap: 2px;
    --kpi-target: 0;
    --kpi-value: 0;
  }

  /* Counter-driven display value. Reads --kpi-value (animated) into a counter
     so the rendered integer follows the CSS animation. */
  .kpi[data-numeric="true"] .kpi-value::after {
    counter-reset: lb-kpi var(--kpi-value);
    content: counter(lb-kpi);
  }

  .kpi-value {
    font-family: var(--font-headline);
    font-size: var(--font-size-h2);
    color: var(--color-text-primary);
    line-height: 1;
  }

  .kpi[data-accent="decision"] .kpi-value { color: var(--color-decision); }
  .kpi[data-accent="error"]    .kpi-value { color: var(--color-error); }
  .kpi[data-accent="milestone"] .kpi-value { color: var(--color-accent-primary); }
  .kpi[data-accent="question"]  .kpi-value { color: var(--color-question); }

  .kpi-label {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  /* The count-up animation. Triggered when the tile enters the viewport
     (data-counted="true"). 800ms with the brief pattern #9 linear() spring. */
  .kpi[data-counted="true"][data-numeric="true"] {
    animation: lb-kpi-count 800ms
      linear(0, 0.218, 0.52 17.1%, 0.764, 0.907, 0.981, 1.02 52.4%, 1.004 59.4%, 1)
      forwards;
  }

  @keyframes lb-kpi-count {
    from { --kpi-value: 0; }
    to   { --kpi-value: var(--kpi-target); }
  }

  /* Reduced-motion: snap to final value, no animation. */
  :global(html[data-motion="reduced"]) .kpi[data-numeric="true"] {
    animation: none !important;
    --kpi-value: var(--kpi-target);
  }

  /* Until the IO gate fires, the value reads 0. To avoid a flash of "0" for
     users who never see the tile but still read its DOM (off-screen testing
     harnesses), the sr-only span carries the truth. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
