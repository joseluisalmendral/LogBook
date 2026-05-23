<!--
  Toast — transient feedback pill (slice 12 P3).

  Bottom-right, 2-second default lifetime, ARIA-live polite. Driven by the
  toast store (`apps/export-ui/src/lib/stores/toast.ts`). The component is
  mounted ONCE at the app root (App.svelte) — every consumer just calls
  `toast.show(message)` to surface feedback.

  Motion contract:
    - Normal: fade-in + 4px lift over 150ms ease-out on appear, fade-out 150ms
      on dismiss.
    - Reduced-motion: instant appear / instant dismiss (transitions zeroed via
      data-motion="reduced" — same global rule that disables other slice
      transitions). Toast is functional feedback, not delight motion, so it
      MUST still be visible in reduced-motion (just without animation).

  Accessibility:
    - role="status" + aria-live="polite" so screen readers announce the
      message without interrupting current narration.
    - aria-atomic="true" so the entire message is read on each show.
    - The pill is non-interactive — no buttons, no focus trap. Users dismiss
      it implicitly by waiting out the timer or by triggering the next action.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { toast, type ToastState } from "../stores/toast";

  let state: ToastState = $state({ message: null, visible: false, key: 0 });

  onMount(() => {
    const unsub = toast.subscribe((s) => {
      state = s;
    });
    return unsub;
  });
</script>

{#if state.message !== null}
  <div
    class="toast"
    class:is-visible={state.visible}
    role="status"
    aria-live="polite"
    aria-atomic="true"
    data-testid="toast"
    data-key={state.key}
  >
    {state.message}
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: var(--p-space-5, 24px);
    right: var(--p-space-5, 24px);
    background: var(--color-surface-raised, #1a1a1a);
    color: var(--color-text-primary, #fff);
    border: 1px solid var(--color-border-hairline, rgba(255, 255, 255, 0.12));
    border-radius: var(--radius-sm, 6px);
    padding: 8px 14px;
    font-family: var(--font-body, system-ui);
    font-size: var(--font-size-meta, 13px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    z-index: 100;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 150ms ease-out, transform 150ms ease-out;
    pointer-events: none;
    max-width: 360px;
  }

  .toast.is-visible {
    opacity: 1;
    transform: translateY(0);
  }

  :global(html[data-motion="reduced"]) .toast {
    transition: none !important;
  }
</style>
