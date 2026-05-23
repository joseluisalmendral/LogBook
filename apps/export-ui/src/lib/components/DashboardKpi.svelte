<!--
  DashboardKpi — KPI card atom. Spec design §2 row 22. MVP.
-->
<script lang="ts">
  interface Props {
    label: string;
    value: number | string;
    accent?: "primary" | "decision" | "error" | "milestone" | "question";
  }

  const { label, value, accent = "primary" }: Props = $props();
</script>

<div class="kpi" data-accent={accent} data-testid="dashboard-kpi">
  <span class="kpi-value lb-tnum">{value}</span>
  <span class="kpi-label">{label}</span>
</div>

<style>
  .kpi {
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--card-radius);
    padding: var(--p-space-4);
    display: flex;
    flex-direction: column;
    gap: 2px;
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
</style>
