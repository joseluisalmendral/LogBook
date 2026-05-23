<!--
  ThemeToggle — sun/moon switch in the sidebar.

  Uses View Transitions API where available (Chromium 111+, Safari 18+) for a
  cinematic theme swap (design §"Motion Architecture" — theme toggle uses
  startViewTransition wrapping the store mutation). Falls back to instant
  swap on Firefox <129 and older Safari. The reduced-motion path is the
  fallback path — startViewTransition is NOT invoked if motion is reduced
  (R-33).

  ARIA: aria-label reflects the action (switch to dark / switch to light),
  not the current theme. role="switch" with aria-checked exposes binary state
  to assistive tech.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { theme, type Theme } from "../stores/theme";
  import { subscribeMotion, type MotionState } from "../stores/motion";

  let current: Theme = $state(theme.get());
  let motionAllowed = $state(true);

  onMount(() => {
    const unsubTheme = theme.subscribe((t) => {
      current = t;
    });
    const unsubMotion = subscribeMotion((s: MotionState) => {
      motionAllowed = s.motionAllowed;
    });
    return () => {
      unsubTheme();
      unsubMotion();
    };
  });

  type DocumentWithViewTransitions = Document & {
    startViewTransition?: (cb: () => void) => { finished?: Promise<void> };
  };

  function handleClick(): void {
    const doc = document as DocumentWithViewTransitions;
    const supportsVT = typeof doc.startViewTransition === "function";
    if (supportsVT && motionAllowed) {
      doc.startViewTransition!(() => theme.toggle());
    } else {
      theme.toggle();
    }
  }

  const label = $derived(
    current === "light" ? "Switch to dark theme" : "Switch to light theme",
  );
</script>

<button
  type="button"
  class="theme-toggle"
  role="switch"
  aria-checked={current === "dark"}
  aria-label={label}
  title={label}
  data-testid="theme-toggle"
  onclick={handleClick}
>
  {#if current === "light"}
    <!-- Sun glyph — current is light, hint at switching to dark (moon visible elsewhere is overkill). -->
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <line x1="12" y1="2.5" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="21.5" />
        <line x1="2.5" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="21.5" y2="12" />
        <line x1="5.2" y1="5.2" x2="7" y2="7" />
        <line x1="17" y1="17" x2="18.8" y2="18.8" />
        <line x1="5.2" y1="18.8" x2="7" y2="17" />
        <line x1="17" y1="7" x2="18.8" y2="5.2" />
      </g>
    </svg>
  {:else}
    <!-- Moon glyph — current is dark. -->
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"
        fill="currentColor"
      />
    </svg>
  {/if}
</button>

<style>
  .theme-toggle {
    appearance: none;
    background: var(--color-surface-raised);
    color: var(--color-text-primary);
    border: var(--card-border);
    border-radius: var(--radius-sm);
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      transform 100ms ease-out;
  }

  .theme-toggle:hover {
    background: var(--color-surface-sunken);
  }

  .theme-toggle:active {
    transform: scale(0.96);
  }
</style>
