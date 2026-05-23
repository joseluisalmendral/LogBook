<!--
  MilestoneCard — milestone summary tile. Spec design §2 row 20.

  MVP-functional in P4; polish lands in P5 (e.g. completion-ring graphic).
-->
<script lang="ts">
  import type { RenderEvent } from "../types";

  interface Props {
    event: RenderEvent;
  }

  const { event }: Props = $props();

  const tsDisplay = $derived.by(() => {
    const d = new Date(event.ts);
    if (Number.isNaN(d.getTime())) return event.ts;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  });
</script>

<article class="milestone" data-testid="milestone-card">
  <header class="m-head">
    <span class="flag" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
        <path d="M3 1.5v13a.5.5 0 0 0 1 0V10h7.5a.5.5 0 0 0 .42-.77l-2-3.23 2-3.23A.5.5 0 0 0 11.5 2H4V1.5a.5.5 0 0 0-1 0Z" />
      </svg>
    </span>
    <span class="eyebrow">Milestone</span>
    <time class="ts lb-tnum" datetime={event.ts}>{tsDisplay}</time>
  </header>
  <p class="title">{event.title ?? "Untitled milestone"}</p>
</article>

<style>
  .milestone {
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--card-radius);
    padding: var(--p-space-4);
    margin: var(--p-space-3) 0;
    border-left: 3px solid var(--color-accent-primary);
    display: flex;
    flex-direction: column;
    gap: var(--p-space-2);
  }

  .m-head {
    display: flex;
    align-items: center;
    gap: var(--p-space-2);
  }

  .flag {
    color: var(--color-accent-primary);
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-accent-primary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
    flex: 1;
  }

  .ts {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }

  .title {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    line-height: 1.4;
  }
</style>
