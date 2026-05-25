<!--
  MotionRoot — single gate for motion + viewport reactivity.

  Design §2 row 1 + ADR-4. This component is the ONLY place that subscribes
  to prefers-reduced-motion AND viewport-width changes. Its job:

    1. Initialize the motion store at boot (one matchMedia + one resize listener).
    2. Mirror the resolved state onto <html data-motion="…" data-viewport="…">
       so CSS can branch without JS.
    3. Render its children (slot) — it adds no visible UI.

  Why a component, not a module side-effect?
    Lifecycle. We need the listener to be torn down if the component unmounts
    (HMR, tests, future modal-as-app embedding). Putting initMotionStore() in
    a $effect gives Svelte 5 the cleanup hook for free.

  Why a single gate?
    11 motion moments × an ad-hoc matchMedia query per component = 11
    listeners + 11 chances to get the mobile-degrade rule wrong. ADR-4
    rationale: 3 motion moments are JS-driven (scroll listeners, View
    Transitions, IntersectionObserver) and MUST NOT initialize at all when
    motion is denied — a pure CSS `@media` query can't do that.

  Children read the resolved state via:
    import { subscribeMotion, getMotionState } from "$lib/stores/motion";
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { initMotionStore } from "../stores/motion";

  // No props beyond children. Slot is the entire app tree.
  const { children } = $props<{ children?: unknown }>();

  onMount(() => {
    const cleanupMotion = initMotionStore();

    // Slice 31 — ambient cursor spotlight tracker.
    //
    // Sets `--lb-mx` / `--lb-my` on <html> so the body::before radial
    // gradient (in app.css) can follow the pointer. rAF-throttled to one
    // write per frame; passive listener. Skipped when motion is reduced
    // OR when the device has no hover (touch).
    const supportsHover =
      typeof window !== "undefined" &&
      window.matchMedia?.("(hover: hover)").matches === true;
    const root = document.documentElement;

    let rafId: number | null = null;
    let nextX = window.innerWidth / 2;
    let nextY = window.innerHeight / 3;

    function flush(): void {
      rafId = null;
      root.style.setProperty("--lb-mx", `${nextX}px`);
      root.style.setProperty("--lb-my", `${nextY}px`);
    }

    function onPointer(e: PointerEvent): void {
      // Respect the reduced-motion gate at runtime — motion store mirrors
      // the same media query onto data-motion on <html>.
      if (root.dataset.motion === "reduced") return;
      nextX = e.clientX;
      nextY = e.clientY;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    }

    if (supportsHover) {
      // Seed initial position so the spotlight isn't pinned at 0,0 on first paint.
      flush();
      window.addEventListener("pointermove", onPointer, { passive: true });
    }

    return () => {
      if (supportsHover) window.removeEventListener("pointermove", onPointer);
      if (rafId !== null) cancelAnimationFrame(rafId);
      cleanupMotion?.();
    };
  });
</script>

{#if children}
  {@render (children as () => unknown)()}
{/if}
