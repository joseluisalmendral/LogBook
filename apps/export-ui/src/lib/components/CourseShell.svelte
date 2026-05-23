<!--
  CourseShell — the root organism that hosts the entire app shell.

  Layout (CSS grid):
    desktop ≥768px:   [sidebar 280px][main 1fr]
    mobile  ≤767px:   single column, hamburger button toggles the sidebar
                      drawer; full <MobileNav> drawer (search, filters,
                      command palette trigger) lands in P5.

  Routing: subscribes to the router store. When route.name === "toc" the
  <CourseTOC> mounts; when "chapter" the <ChapterPlaceholder> mounts (the
  real <ChapterPlayer> lands in P4).

  This component mounts INSIDE <MotionRoot> (App.svelte slot), so it can
  assume the data-motion attribute on <html> is already set.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { router, type Route } from "../stores/router";
  import { subscribeMotion } from "../stores/motion";
  import Sidebar from "./Sidebar.svelte";
  import CourseTOC from "./CourseTOC.svelte";
  import ChapterPlaceholder from "./ChapterPlaceholder.svelte";

  let route: Route = $state(router.get());
  let isMobile = $state(false);
  let sidebarOpen = $state(false);

  onMount(() => {
    const unsubRoute = router.subscribe((r) => {
      route = r;
      // Auto-close the sidebar drawer when the user navigates on mobile —
      // standard pattern in mobile webapps so the chapter view is visible
      // after a tap.
      if (isMobile) sidebarOpen = false;
    });
    const unsubMotion = subscribeMotion((s) => {
      isMobile = s.isMobile;
      // On desktop the sidebar is always in flow; the drawer state only
      // matters on mobile.
      if (!isMobile) sidebarOpen = false;
    });
    return () => {
      unsubRoute();
      unsubMotion();
    };
  });

  function toggleSidebar(): void {
    sidebarOpen = !sidebarOpen;
  }
  function closeSidebar(): void {
    sidebarOpen = false;
  }
</script>

<!--
  Layout split: mobile keeps the hamburger bar as a sibling OUTSIDE the
  .shell grid so it can `position: sticky; top: 0` reliably. Putting it
  inside the grid (with grid-template-areas: "main") caused it to be
  auto-placed AFTER main, ending up at the page bottom rather than the
  top — Vite dev caught it on the first mobile screenshot.
-->
{#if isMobile}
  <header class="mobile-bar" aria-label="Top bar">
    <button
      type="button"
      class="hamburger"
      aria-label="Open navigation"
      aria-expanded={sidebarOpen}
      aria-controls="lb-sidebar"
      onclick={toggleSidebar}
      data-testid="hamburger"
    >
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
    </button>
    <p class="mobile-brand">LogBook Replay</p>
  </header>
{/if}

<div class="shell" data-testid="course-shell">
  <div id="lb-sidebar" class="sidebar-slot">
    <Sidebar open={!isMobile || sidebarOpen} onClose={closeSidebar} />
  </div>

  <main class="main-pane" data-testid="main-pane">
    {#if route.name === "toc"}
      <CourseTOC />
    {:else if route.name === "chapter"}
      <ChapterPlaceholder chapterId={route.chapterId} />
    {/if}
  </main>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: "sidebar main";
    min-height: 100vh;
    background: var(--color-surface);
    color: var(--color-text-primary);
  }

  .sidebar-slot {
    grid-area: sidebar;
  }

  .main-pane {
    grid-area: main;
    min-width: 0; /* allow inner content to truncate instead of overflowing the grid */
  }

  .mobile-bar {
    display: none;
  }

  /* ---------- Mobile graceful-degrade (Q4 / R-27) ---------- */
  @media (max-width: 767px) {
    .shell {
      grid-template-columns: 1fr;
      grid-template-areas:
        "main";
      /* Sidebar becomes a fixed drawer; no longer occupies a grid column. */
    }
    .sidebar-slot {
      /* Drawer floats; the grid area is unused on mobile. */
      grid-area: unset;
    }
    .mobile-bar {
      display: flex;
      align-items: center;
      gap: var(--p-space-3);
      padding: var(--p-space-3) var(--p-space-4);
      background: var(--color-surface-raised);
      border-bottom: var(--card-border);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .hamburger {
      appearance: none;
      background: transparent;
      border: 0;
      width: 36px;
      height: 36px;
      display: inline-flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      padding: 0;
      border-radius: var(--radius-xs);
    }
    .hamburger span {
      display: block;
      width: 18px;
      height: 2px;
      background: var(--color-text-primary);
      border-radius: 1px;
    }
    .hamburger:hover {
      background: var(--color-surface-sunken);
    }
    .mobile-brand {
      font-family: var(--font-headline);
      font-size: var(--font-size-lead);
      margin: 0;
      color: var(--color-text-primary);
    }
  }
</style>
