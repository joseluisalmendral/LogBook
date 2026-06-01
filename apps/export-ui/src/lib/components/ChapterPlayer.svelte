<!--
  ChapterPlayer — the chapter route's root component.

  Replaces P3's <ChapterPlaceholder>. Owns:
    - <ChapterHeader>      editorial header + view-transition anchor
    - <PhaseAct> sections  grouped by chapter.phases (if any)
    - <TurnRow> per event  the dispatcher routing to specific cards
    - <TimelineScrubber>   pinned at bottom, drives --scrub-progress
    - back button          returns to TOC

  Layout: single column document, 880px reading width, large vertical
  rhythm. The scrubber stays sticky to viewport bottom while content scrolls.

  Each event gets an anchor id `event-<id>` so the scrubber chips + inspector
  links can jump to it.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { animate, stagger } from "motion";
  import { payload } from "../stores/data";
  import { router } from "../stores/router";
  import { subscribeMotion, getMotionState } from "../stores/motion";
  import { playhead } from "../stores/playhead";
  import { selection } from "../stores/selection";
  import type { Chapter, RenderEvent } from "../types";
  import ChapterHeader from "./ChapterHeader.svelte";
  import TurnRow from "./TurnRow.svelte";
  import TimelineScrubber from "./TimelineScrubber.svelte";
  import MobileTimeline from "./MobileTimeline.svelte";
  import PhaseAct from "./PhaseAct.svelte";
  import EmptyState from "./EmptyState.svelte";
  import AnnotationControl from "./AnnotationControl.svelte";
  import { annotations } from "../stores/annotations";

  // display-annotations: a Set of annotated event ids drives the `data-annotated`
  // ring. Hydrated from the shared annotations store; re-derived on every change
  // (add / edit / remove / clear all) through one subscription.
  let annotatedIds = $state<Set<string>>(new Set(Object.keys(annotations.get())));
  $effect(() => {
    const unsub = annotations.subscribe((map) => {
      annotatedIds = new Set(Object.keys(map));
    });
    return () => unsub();
  });

  // Subscribe to the motion store so we can swap the desktop scrubber for
  // the mobile anchor list (design D3: horizontal-swipe scrubber conflicts
  // with native page scroll on iOS Safari, so mobile uses MobileTimeline).
  let isMobile = $state(false);
  onMount(() => subscribeMotion((s) => { isMobile = s.isMobile; }));

  // Slice 12 P6 / Bucket F: playhead drives the active-event scroll + heartbeat.
  let activeEventId = $state<string | null>(null);
  let playMode = $state<"scroll" | "play">("scroll");

  // Slice-22: back-to-top button visibility (>400px scrolled).
  let showBackToTop = $state(false);

  function scrollToTop(): void {
    const motion = getMotionState();
    window.scrollTo({ top: 0, behavior: motion.motionAllowed ? "smooth" : "auto" });
  }

  // Slice-25 zen mode. We subscribe to the prefs store so the button reflects
  // the current state and any keyboard-driven toggle (Z / F / Esc) is also
  // reflected.
  import { teachingPrefs } from "../stores/teaching-prefs";
  let zen = $state(teachingPrefs.get().zen);
  $effect(() => {
    const unsub = teachingPrefs.subscribe((s) => {
      zen = s.zen;
    });
    return () => unsub();
  });
  function toggleZen(): void {
    teachingPrefs.toggleZen();
  }

  interface Props {
    chapterId: string;
  }

  const { chapterId }: Props = $props();

  const chapter = $derived<Chapter | null>(
    payload.chapters.find((c) => c.sessionId === chapterId) ?? null,
  );

  /**
   * Group events under their phase if the chapter has multiple phases.
   * For chapters with a single phase (the common case), we skip the PhaseAct
   * wrapper and let TurnRows flow directly under the header. Multi-phase
   * chapters get explicit Act dividers.
   */
  function groupEvents(ch: Chapter): Array<{ phase: { id: string; label: string } | null; events: RenderEvent[] }> {
    if (ch.phases.length <= 1) {
      return [{ phase: null, events: ch.events }];
    }
    // Multi-phase: assign each event to the latest phase whose ts <= event.ts.
    const sortedPhases = [...ch.phases].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const groups = sortedPhases.map((p) => ({ phase: { id: p.id, label: p.label }, events: [] as RenderEvent[] }));
    for (const ev of ch.events) {
      const evTs = new Date(ev.ts).getTime();
      let target = 0;
      for (let i = 0; i < sortedPhases.length; i++) {
        if (new Date(sortedPhases[i]!.ts).getTime() <= evTs) target = i;
      }
      groups[target]!.events.push(ev);
    }
    return groups;
  }

  const groups = $derived(chapter ? groupEvents(chapter) : []);

  function back(): void {
    router.navigate({ name: "toc" });
  }

  /**
   * Compute the event index whose timestamp matches the playhead's t in [0,1].
   * Mirrors PlaybackController.currentIndex(): map t to wall time, then find
   * the event whose ts is the floor.
   */
  function activeIndexForT(ch: Chapter, t: number): number {
    const evs = ch.events;
    if (evs.length === 0) return -1;
    if (evs.length === 1) return 0;
    const first = new Date(evs[0]!.ts).getTime();
    const last = new Date(evs[evs.length - 1]!.ts).getTime();
    const span = last - first;
    if (!Number.isFinite(span) || span <= 0) {
      return Math.min(evs.length - 1, Math.floor(t * evs.length));
    }
    const targetMs = first + t * span;
    let best = 0;
    for (let i = 0; i < evs.length; i++) {
      if (new Date(evs[i]!.ts).getTime() <= targetMs) best = i;
      else break;
    }
    return best;
  }

  // Subscribe to the playhead. On every t-change while mode='play', recompute
  // the active event and scrollIntoView programmatically. R-73 + ADR-SC-F2.
  onMount(() => {
    let lastId: string | null = null;
    const unsub = playhead.subscribe((s) => {
      playMode = s.mode;
      if (!chapter) return;
      // Only auto-scroll when the playhead is the driver. When the user is
      // scroll-driving, we don't push them around.
      if (s.mode !== "play") {
        // Still expose activeEventId for the highlight class so the user sees
        // where they were when they pause — but no programmatic scroll.
        return;
      }
      const idx = activeIndexForT(chapter, s.t);
      if (idx < 0) return;
      const nextId = chapter.events[idx]!.id;
      if (nextId === lastId) return;
      lastId = nextId;
      activeEventId = nextId;
      const el = document.querySelector<HTMLElement>(`[data-event-id="${nextId}"]`);
      if (!el) return;
      // Mark the suppression window BEFORE scrolling so the TimelineScrubber
      // listener distinguishes this from a user scroll (INV-16).
      playhead.markProgrammaticScroll();
      const motion = getMotionState();
      el.scrollIntoView({
        behavior: motion.motionAllowed ? "smooth" : "auto",
        block: "center",
      });
    });
    return unsub;
  });

  /*
   * Slice-12 P7 — Selection-driven acknowledge pulse (R-68 highlight ring).
   *
   * When `selection.chapterEventId` changes (via card click OR via the
   * transcript route's "Jump to card"), find the matching DOM node, scroll it
   * into view, and apply `.lb-pulse-once` for 1200ms as a functional
   * acknowledge. The pulse is functional feedback (NOT a 6th delight motion
   * moment per INV-15 § exceptions).
   *
   * IMPORTANT: If the playhead is currently `playing`, the heartbeat
   * (`.is-active`) is already animating the target row — running both at the
   * same time would double-animate. We skip the one-shot pulse during
   * playback.
   */
  onMount(() => {
    let lastPulsedId: string | null = null;
    let lastPulsedEl: HTMLElement | null = null;
    let pulseTimer: ReturnType<typeof setTimeout> | null = null;

    // Cancel any in-flight pulse — removes the class from the previous element
    // AND clears the pending teardown timeout. Without this, a fast double-click
    // would strand the previous element with `.lb-pulse-once` because the
    // setTimeout closure only cleans up the element it captured.
    const clearPreviousPulse = (): void => {
      if (pulseTimer !== null) {
        clearTimeout(pulseTimer);
        pulseTimer = null;
      }
      if (lastPulsedEl !== null) {
        lastPulsedEl.classList.remove("lb-pulse-once");
        lastPulsedEl = null;
      }
    };

    const unsub = selection.subscribe((snap) => {
      const id = snap.chapterEventId;
      if (!id || id === lastPulsedId) return;
      // Only act when we are actually on a chapter route.
      const route = router.get();
      if (route.name !== "chapter") return;
      const el = document.querySelector<HTMLElement>(`[data-event-id="${id}"]`);
      if (!el) return;

      // Strip any in-flight pulse before starting a new one (R-68 cancellable).
      clearPreviousPulse();

      lastPulsedId = id;
      // Scroll the target card into view (R-68). Programmatic scroll suppression
      // ensures the TimelineScrubber listener doesn't read this as user input.
      playhead.markProgrammaticScroll();
      const motion = getMotionState();
      el.scrollIntoView({
        behavior: motion.motionAllowed ? "smooth" : "auto",
        block: "center",
      });
      // Skip the pulse if the heartbeat is already animating the target row
      // (playhead.playing). The heartbeat is enough visual acknowledgement.
      if (playhead.get().playing) return;
      // Apply the one-shot pulse for 1200ms.
      el.classList.add("lb-pulse-once");
      lastPulsedEl = el;
      pulseTimer = setTimeout(() => {
        // Defensive: only strip if this is still the active pulsed element.
        if (lastPulsedEl === el) {
          el.classList.remove("lb-pulse-once");
          lastPulsedEl = null;
        }
        pulseTimer = null;
      }, 1200);
    });
    return () => {
      unsub();
      clearPreviousPulse();
    };
  });

  // Slice-22: scroll listener for back-to-top button visibility.
  onMount(() => {
    const onScroll = (): void => {
      showBackToTop = (window.scrollY || document.documentElement.scrollTop) > 400;
    };
    onScroll(); // initial state
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  });

  /*
   * Slice 31.6 — "Editorial guillotine" entrance.
   *
   * The chapter mounts behind two solid cream curtains (left half +
   * right half of the viewport). On mount we animate the curtains apart
   * — left slides off-screen left, right slides off-screen right —
   * revealing the chapter beneath. At the moment of the split, a 2px
   * Teal Basin "blade-edge" line at x=50vw pulses (scaleY 0 → 1 → 0)
   * with a brief glow: the cut is visible for one beat, then gone.
   *
   * Under the curtains, the chapter itself does a subtle scale-up
   * 0.96 → 1 + opacity 0.7 → 1, so when the curtains part the content
   * feels like it's stepping into focus, not just exposed.
   *
   * Why this is the gesture:
   *   - Geometric + decisive (Pentagram editorial register).
   *   - Reuses Paper Brutalism tokens (cream surface + Teal Basin blade).
   *   - Reads as opening a folio: cover splits, content underneath.
   *   - GPU-only (transform + opacity), no layout reflow.
   *
   * The curtains are injected into <body> (not into .chapter-player)
   * so they cover the ENTIRE viewport including the sidebar and
   * scrubber chrome — the cut feels global, not local. They are
   * removed from the DOM at animation end.
   */
  onMount(() => {
    const motionState = getMotionState();
    if (!motionState.motionAllowed) return;

    const root = document.querySelector<HTMLElement>(".chapter-player");
    if (!root) return;

    // Resolve token values at runtime (light/dark themes flip them).
    const cs = getComputedStyle(document.documentElement);
    const cream = cs.getPropertyValue("--color-surface").trim() || "#fffcf7";
    // Slice 31.7 — blade switched from Teal Basin to Inkwell Violet (primary
    // ink). The green read as out-of-palette during the cut; ink-on-paper
    // is the cleaner editorial signal.
    const ink = cs.getPropertyValue("--color-text-primary").trim() || "#0d0129";
    const ember = cs.getPropertyValue("--color-accent-primary").trim() || "#d77a4a";

    // Build the curtain layer.
    const layer = document.createElement("div");
    layer.setAttribute("data-curtain-layer", "true");
    layer.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:9999",
      "pointer-events:none",
      "overflow:hidden",
    ].join(";");

    const sharedCurtain = [
      "position:absolute",
      "top:0",
      "bottom:0",
      "width:52vw",
      `background:${cream}`,
      // subtle dot-grid texture matches the Paper Brutalism canvas
      `background-image:radial-gradient(circle at center, ${ink}14 0.5px, transparent 1.5px)`,
      "background-size:24px 24px",
      "will-change:transform",
    ].join(";");

    const left = document.createElement("div");
    left.style.cssText =
      sharedCurtain +
      ";left:0;border-right:1px solid " + ink + "33;" +
      "box-shadow: 6px 0 24px " + ink + "1a";
    layer.appendChild(left);

    const right = document.createElement("div");
    right.style.cssText =
      sharedCurtain +
      ";right:0;border-left:1px solid " + ink + "33;" +
      "box-shadow: -6px 0 24px " + ink + "1a";
    layer.appendChild(right);

    // The blade-edge — a single 2px vertical line at x=50vw that pulses
    // bright during the split. Uses Teal Basin tinted with a Claude
    // Ember glow at the peak frame.
    const blade = document.createElement("div");
    blade.style.cssText = [
      "position:absolute",
      "top:0",
      "bottom:0",
      "left:50%",
      "width:2px",
      "margin-left:-1px",
      `background:${ink}`,
      `box-shadow:0 0 18px ${ember}aa, 0 0 6px ${ink}`,
      "transform:scaleY(0)",
      "transform-origin:center",
      "will-change:transform,opacity",
      "opacity:0",
    ].join(";");
    layer.appendChild(blade);

    document.body.appendChild(layer);

    // Seed the chapter pre-state (sits under curtains).
    root.style.transform = "scale(0.96)";
    root.style.opacity = "0.65";
    root.style.transformOrigin = "center top";
    root.style.willChange = "transform, opacity";

    const raf = requestAnimationFrame(() => {
      // 1. Blade flashes first (0–280ms): scaleY 0 → 1, opacity 0 → 1 → 0.
      animate(
        blade,
        {
          transform: ["scaleY(0)", "scaleY(1)", "scaleY(1)", "scaleY(1.04)"],
          opacity: [0, 1, 1, 0],
          offset: [0, 0.18, 0.55, 1],
        },
        { duration: 0.62, ease: [0.22, 1, 0.36, 1] },
      );

      // 2. Curtains part (60ms delay so the blade is seen first, then
      //    the cut "opens").
      animate(
        left,
        { transform: ["translateX(0)", "translateX(-104%)"] },
        { duration: 0.72, delay: 0.06, ease: [0.65, 0, 0.32, 1] },
      );
      animate(
        right,
        { transform: ["translateX(0)", "translateX(104%)"] },
        { duration: 0.72, delay: 0.06, ease: [0.65, 0, 0.32, 1] },
      );

      // 3. Chapter steps into focus underneath (slight scale + opacity).
      animate(
        root,
        {
          transform: ["scale(0.96)", "scale(1)"],
          opacity: [0.65, 1],
        },
        { duration: 0.78, delay: 0.18, ease: [0.22, 1, 0.36, 1] },
      ).finished.then(() => {
        root.style.willChange = "";
        root.style.transform = "";
        root.style.opacity = "";
        root.style.transformOrigin = "";
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      }).catch(() => {
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      });
    });

    return () => {
      cancelAnimationFrame(raf);
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      root.style.willChange = "";
      root.style.transform = "";
      root.style.opacity = "";
      root.style.transformOrigin = "";
    };
  });

  /*
   * Slice 28 — WOW entrance for the events stream via Motion One.
   *
   * On mount, animate the first ~20 visible event-anchor rows with a
   * staggered fade-up. Spring physics + custom ease give the wall of
   * rows a "settling into place" feel rather than appearing all at
   * once. Beyond the first 20 we leave at final state (no animation)
   * to avoid janky compositor work on long chapters.
   *
   * Reduced-motion skips the animation entirely — rows stay in their
   * final position.
   */
  onMount(() => {
    const motionState = getMotionState();
    if (!motionState.motionAllowed) return;

    // Defer to the next frame so DOM is fully painted before animation.
    const raf = requestAnimationFrame(() => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".event-anchor"),
      ).slice(0, 20);
      if (rows.length === 0) return;

      // Initial state: slightly down + transparent.
      for (const row of rows) {
        row.style.opacity = "0";
        row.style.transform = "translateY(14px)";
      }

      animate(
        rows,
        { opacity: 1, transform: "translateY(0px)" },
        {
          delay: stagger(0.05, { startDelay: 0.08 }),
          duration: 0.55,
          ease: [0.22, 1, 0.36, 1],
        },
      );
    });
    return () => cancelAnimationFrame(raf);
  });

  // Slice-25: keyboard shortcuts for zen mode.
  //   Z or F  → toggle zen
  //   Esc     → exit zen (only when currently in zen — leaves Esc alone
  //             so it still works for inspector / palette closes elsewhere)
  // Ignore key events when typing in inputs/textareas so the search palette
  // and inspector textareas don't accidentally toggle the mode.
  onMount(() => {
    const isEditableTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z" || key === "f") {
        e.preventDefault();
        teachingPrefs.toggleZen();
      } else if (key === "escape" && teachingPrefs.get().zen) {
        e.preventDefault();
        teachingPrefs.setZen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>

<section class="chapter-player" data-testid="chapter-player">
  {#if chapter}
    <div class="player-doc">
      <div class="chapter-toolbar">
        <!--
          Slice 29: editorial ghost-style toolbar. Back uses the inkwell
          ink variant (filled), zen uses the default glow yellow ghost.
        -->
        <button type="button" class="lb-ghost-btn" data-tone="ghost" onclick={back} data-testid="chapter-back">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="11 3 5 8 11 13" />
          </svg>
          Back to course
        </button>
        <button
          type="button"
          class="lb-ghost-btn"
          data-tone={zen ? "ink" : "default"}
          onclick={toggleZen}
          aria-pressed={zen}
          aria-label={zen ? "Exit zen mode" : "Enter zen mode"}
          title={zen ? "Exit zen mode (Esc or Z)" : "Zen mode — hide chrome (Z)"}
          data-testid="zen-toggle"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            {#if zen}
              <!-- Exit-zen glyph: arrows collapsing inward -->
              <polyline points="6 3 6 6 3 6" />
              <polyline points="10 3 10 6 13 6" />
              <polyline points="6 13 6 10 3 10" />
              <polyline points="10 13 10 10 13 10" />
            {:else}
              <!-- Enter-zen glyph: arrows expanding outward -->
              <polyline points="3 7 3 3 7 3" />
              <polyline points="13 7 13 3 9 3" />
              <polyline points="3 9 3 13 7 13" />
              <polyline points="13 9 13 13 9 13" />
            {/if}
          </svg>
          {zen ? "Exit zen" : "Zen mode"}
        </button>
      </div>

      <ChapterHeader {chapter} />

      {#if chapter.ghostTurns}
        <!-- Slice-21 R-89 / ADR-SN-B3: this chapter has user prompts but no
             Claude messages (e.g. session captured on a machine without the
             transcript scraper). Surface a single neutral notice at chapter
             top so the gap is explicit, not mysterious. -->
        <aside class="ghost-turn-notice" data-testid="ghost-turn-notice">
          <span class="notice-icon" aria-hidden="true">⚠</span>
          <p>
            Claude responses unavailable for this session — no local transcript
            was captured. Your prompts are shown below; tool activity may have
            run but is not paired with replies.
          </p>
        </aside>
      {/if}

      <div class="phases">
        {#each groups as group, gi}
          {#if group.phase}
            <PhaseAct label={group.phase.label} index={gi} />
          {/if}
          {#if group.events.length === 0}
            <EmptyState title="No events" hint="This phase has no recorded events." />
          {:else}
            <div class="events-stream">
              {#each group.events as ev (ev.id)}
                <div
                  id={`event-${ev.id}`}
                  class="event-anchor"
                  class:is-active={activeEventId === ev.id && playMode === "play"}
                  data-event-id={ev.id}
                  data-annotated={annotatedIds.has(ev.id) ? "true" : undefined}
                >
                  <AnnotationControl eventId={ev.id} />
                  <TurnRow event={ev} />
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      </div>

      {#if isMobile}
        <MobileTimeline events={chapter.events} />
      {/if}
    </div>

    {#if !isMobile}
      <TimelineScrubber events={chapter.events} />
    {/if}

    <!-- Slice-22: back-to-top floating button. Long chapters (177-1492 rows)
         make scrolling back to the chapter header tedious. Button fades in
         after 400px of scroll. Click → smooth scroll to top (or auto under
         reduced-motion). -->
    {#if showBackToTop}
      <button
        type="button"
        class="back-to-top"
        data-testid="back-to-top"
        aria-label="Back to top of chapter"
        onclick={scrollToTop}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="4 10 8 6 12 10" />
        </svg>
        <span class="back-to-top-label">Top</span>
      </button>
    {/if}
  {:else}
    <div class="not-found">
      <button type="button" class="lb-ghost-btn" data-tone="ghost" onclick={back}>
        <span aria-hidden="true">←</span> Back to course
      </button>
      <EmptyState
        title="Session not found"
        hint={`No session with id ${chapterId} in this export.`}
      />
    </div>
  {/if}
</section>

<style>
  .chapter-player {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .player-doc {
    flex: 1;
    max-width: 920px;
    margin: 0 auto;
    padding: var(--p-space-5) var(--p-space-6) var(--p-space-9) var(--p-space-6);
    width: 100%;
    box-sizing: border-box;
  }

  .back-btn {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--color-accent-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
    padding: 0;
    cursor: pointer;
    margin-bottom: var(--p-space-4);
    display: inline-flex;
    align-items: center;
    gap: var(--p-space-1);
  }

  .back-btn:hover {
    text-decoration: underline;
  }

  /* Slice-25: chapter toolbar (back + zen toggle). */
  .chapter-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--p-space-3);
    margin-bottom: var(--p-space-4);
  }

  .zen-btn {
    appearance: none;
    border: 1px solid var(--color-border-hairline);
    background: var(--color-surface-raised);
    color: var(--color-text-secondary);
    padding: 6px 12px;
    border-radius: 999px;
    cursor: pointer;
    font-family: var(--font-body);
    font-size: var(--font-size-caption);
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: var(--p-space-2);
    transition: background 160ms ease-out, color 160ms ease-out, border-color 160ms ease-out;
  }

  .zen-btn:hover {
    background: color-mix(in srgb, var(--color-accent-primary) 8%, var(--color-surface-raised));
    color: var(--color-text-primary);
    border-color: color-mix(in srgb, var(--color-accent-primary) 40%, var(--color-border-hairline));
  }

  .zen-btn[aria-pressed="true"] {
    background: var(--color-accent-primary);
    color: var(--color-bg);
    border-color: var(--color-accent-primary);
  }

  .zen-btn:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 3px;
  }

  :global(html[data-zen="true"]) .zen-btn {
    /* In zen mode the back button is hidden; the zen-btn becomes the
       primary chrome control. Make it slightly more present so users can
       always exit. */
    position: fixed;
    top: var(--p-space-4);
    right: var(--p-space-4);
    z-index: 50;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
  }

  :global(html[data-motion="reduced"]) .zen-btn {
    transition: none;
  }

  /* Slice-22: back-to-top floating button. Bottom-right anchored, above the
     TimelineScrubber. Visible only when scrolled past 400px (toggled by the
     JS scroll listener). Smooth-scroll to top on click (auto under
     reduced-motion). */
  .back-to-top {
    position: fixed;
    right: var(--p-space-5);
    bottom: calc(var(--p-space-6) + 88px); /* above the scrubber strip */
    z-index: 40;
    display: inline-flex;
    align-items: center;
    gap: var(--p-space-2);
    padding: 10px 14px;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-hairline);
    border-radius: 999px;
    color: var(--color-text-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
    transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), background 160ms ease-out, border-color 160ms ease-out;
    opacity: 0;
    animation: btt-fade-in 200ms ease-out forwards;
  }

  .back-to-top:hover {
    background: color-mix(in srgb, var(--color-accent-primary) 8%, var(--color-surface-raised));
    border-color: color-mix(in srgb, var(--color-accent-primary) 40%, var(--color-border-hairline));
    transform: translateY(-2px);
  }

  .back-to-top:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 3px;
  }

  .back-to-top svg { color: var(--color-accent-primary); }
  .back-to-top-label { line-height: 1; }

  @keyframes btt-fade-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  :global(html[data-motion="reduced"]) .back-to-top {
    animation: none !important;
    opacity: 1;
    transition: none !important;
  }
  :global(html[data-motion="reduced"]) .back-to-top:hover {
    transform: none;
  }

  /* Mobile: anchor to bottom corner above any mobile timeline strip. */
  @media (max-width: 767px) {
    .back-to-top {
      right: var(--p-space-3);
      bottom: var(--p-space-5);
      padding: 8px 12px;
    }
    .back-to-top-label { display: none; } /* icon-only on mobile to save space */
  }

  /* Slice-21 R-89: ghost-turn notice. Subtle neutral surface, accent
     border-left to flag that something is non-standard without alarming.
     Static — no entry animation (does not consume motion budget). */
  .ghost-turn-notice {
    display: flex;
    align-items: flex-start;
    gap: var(--p-space-3);
    background: var(--color-surface-sunken);
    border: 1px solid var(--color-border-hairline);
    border-left: 3px solid var(--color-text-secondary);
    border-radius: var(--card-radius);
    padding: var(--p-space-3) var(--p-space-4);
    margin: var(--p-space-3) 0 var(--p-space-4) 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-meta);
    line-height: 1.5;
  }

  .ghost-turn-notice .notice-icon {
    color: var(--color-text-secondary);
    font-size: 1rem;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .ghost-turn-notice p {
    margin: 0;
  }

  .events-stream {
    display: flex;
    flex-direction: column;
    gap: var(--p-space-2);
  }

  .event-anchor {
    position: relative; /* anchor the absolutely-positioned annotation trigger */
    scroll-margin-top: var(--p-space-6);
    /* Scroll-driven reveal motion #2. opacity 0 → 1 + translateY 8px → 0 as
       the event approaches the viewport center. */
    opacity: 1;
    transform: translateY(0);
    transition: opacity 250ms ease-out, transform 250ms ease-out;
  }

  /* display-annotations: reveal the per-event annotation trigger on
     hover/focus of the anchor, matching the inspector-icon-btn reveal idiom. */
  .event-anchor:hover :global(.annotation-trigger),
  .event-anchor:focus-within :global(.annotation-trigger) {
    opacity: 1;
  }

  /* Annotated events get a single left accent (border-left > border-radius,
     Paper Brutalism rule 9). Per-annotation color lives in the BriefLegend to
     keep the event stream calm; the ring stays one accent for scannability. */
  .event-anchor[data-annotated="true"] {
    border-left: 3px solid var(--color-accent-primary);
    padding-left: var(--p-space-3);
  }

  /* Reduced-motion: always full opacity, no transform. The global rule in
     app.css zeroes the transition duration; explicit values here are for
     clarity. */
  :global(html[data-motion="reduced"]) .event-anchor {
    transition: none !important;
  }

  .not-found {
    padding: var(--p-space-7) var(--p-space-6);
    max-width: 880px;
    margin: 0 auto;
  }

  @media (max-width: 767px) {
    .player-doc {
      padding: var(--p-space-4) var(--p-space-4) var(--p-space-8) var(--p-space-4);
    }
  }
</style>
