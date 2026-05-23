<!--
  MobileNav — full slide-in drawer for mobile (R-26, design §2 row 24, Q4).

  REPLACES the P3 sidebar-as-drawer pattern. Native <dialog modal> hosts the
  drawer so we get focus trap + Esc handling for free without rolling our own.

  Sections inside the drawer (top → bottom):
    1. Header (brand + close button)
    2. Project info (name + sha)
    3. KPI strip (sessions / decisions / errors / milestones)
    4. Theme toggle + sort control
    5. Palette trigger (opens CommandPalette and closes the drawer)
    6. Link "Back to course outline" (TOC route)
    7. Footer: exportedAt

  Mounted from <CourseShell> on mobile via the hamburger button. The desktop
  Sidebar component remains unchanged for ≥768px viewports.

  Motion:
    - Enter: transform translateX(-100%) → translateX(0), 300ms cubic-bezier
      (0.16, 1, 0.3, 1). Reduced-motion (and mobile is treated as reduced by
      the motion store) → instant.
    - The <dialog>::backdrop fades simultaneously.

  A11y:
    - role="dialog" aria-modal="true" via native <dialog modal>
    - aria-label="Navigation"
    - Esc closes (native)
    - Backdrop click closes (handler)
    - Initial focus moves to the close button on open
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { router } from "../stores/router";
  import { payload } from "../stores/data";
  import { palette } from "../stores/palette";
  import ThemeToggle from "./ThemeToggle.svelte";
  import SortControl from "./SortControl.svelte";

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  const { open, onClose }: Props = $props();

  let dialogEl: HTMLDialogElement | null = null;
  let closeBtnEl: HTMLButtonElement | null = null;

  // Open/close the native dialog in sync with the `open` prop. We use
  // .show() (not .showModal()) ONLY so the page behind remains scrollable
  // for backdrop click — actually we want showModal() for the focus trap +
  // ::backdrop, and we add a backdrop click handler explicitly.
  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) {
      dialogEl.showModal();
      // Move initial focus to the close button — predictable + reversible.
      queueMicrotask(() => closeBtnEl?.focus());
    } else if (!open && dialogEl.open) {
      dialogEl.close();
    }
  });

  // The native cancel event fires on Esc. We translate it to the parent
  // close handler so the parent state stays the source of truth.
  function onCancel(event: Event): void {
    event.preventDefault();
    onClose();
  }

  // Click on the dialog element itself (not on inner content) means the
  // backdrop area was hit — close. We compare the event target to the
  // dialog node directly (innerContent stops propagation via :not at the
  // element layer).
  function onDialogClick(event: MouseEvent): void {
    if (event.target === dialogEl) onClose();
  }

  function goToToc(): void {
    router.navigate({ name: "toc" });
    onClose();
  }

  function openPalette(): void {
    onClose();
    // Defer slightly so the dialog close animation isn't competing with the
    // palette open animation for backdrop attention.
    queueMicrotask(() => palette.openPalette());
  }

  // Short sha derived once per render — same pattern as Sidebar.
  const shortSha = $derived.by(() => {
    const sha = payload.project.sha;
    if (!sha) return "";
    return sha.length > 7 ? sha.slice(0, 7) : sha;
  });

  // Whether we are currently on the TOC route — hides the "Back to course
  // outline" entry to avoid a redundant action.
  let routeName = $state(router.get().name);
  onMount(() => router.subscribe((r) => { routeName = r.name; }));
</script>

<dialog
  bind:this={dialogEl}
  class="mobile-nav"
  aria-label="Navigation"
  oncancel={onCancel}
  onclick={onDialogClick}
  data-testid="mobile-nav"
>
  <div class="drawer">
    <header class="drawer-header">
      <p class="brand-eyebrow">LogBook</p>
      <h2 class="brand-title">Replay</h2>
      <button
        bind:this={closeBtnEl}
        type="button"
        class="close-btn"
        aria-label="Close navigation"
        onclick={onClose}
        data-testid="mobile-nav-close"
      >
        <span aria-hidden="true">×</span>
      </button>
    </header>

    <section class="project-block" aria-label="Project info">
      <p class="project-name">{payload.project.name || "—"}</p>
      {#if shortSha}
        <p class="project-meta lb-tnum">
          <span class="meta-label">SHA</span>
          <code class="meta-value">{shortSha}</code>
        </p>
      {/if}
    </section>

    <section class="kpi-strip" aria-label="Course totals">
      <div class="kpi">
        <span class="kpi-value lb-tnum">{payload.course.totals.sessions}</span>
        <span class="kpi-label">Sessions</span>
      </div>
      <div class="kpi">
        <span class="kpi-value lb-tnum kpi-decision">{payload.course.totals.decisions}</span>
        <span class="kpi-label">Decisions</span>
      </div>
      <div class="kpi">
        <span class="kpi-value lb-tnum kpi-error">{payload.course.totals.errors}</span>
        <span class="kpi-label">Errors</span>
      </div>
      <div class="kpi">
        <span class="kpi-value lb-tnum kpi-milestone">{payload.course.totals.milestones}</span>
        <span class="kpi-label">Milestones</span>
      </div>
    </section>

    <section class="controls" aria-label="Display preferences">
      <ThemeToggle />
      <SortControl />
    </section>

    <button
      type="button"
      class="palette-trigger"
      onclick={openPalette}
      aria-label="Open command palette"
      data-testid="mobile-palette-trigger"
    >
      <span class="pt-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" stroke-linecap="round" />
        </svg>
      </span>
      Search across course
    </button>

    {#if routeName !== "toc"}
      <button
        type="button"
        class="back-to-toc"
        onclick={goToToc}
        data-testid="mobile-nav-toc"
      >
        ← Back to course outline
      </button>
    {/if}

    <footer class="drawer-footer">
      {#if payload.exportedAt}
        <p class="exported-at lb-tnum">
          Exported {new Date(payload.exportedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      {/if}
    </footer>
  </div>
</dialog>

<style>
  /* Native dialog reset — by default <dialog> has a strong border and
     centered placement; we override to make it a left-edge slide-in drawer
     that occupies the viewport-leading area on mobile.

     Note: the dialog itself is the FULL viewport overlay (so clicking
     outside .drawer hits the dialog and triggers backdrop-close). The
     .drawer child carries the visible panel chrome.
  */
  .mobile-nav {
    /* Reset */
    border: 0;
    padding: 0;
    background: transparent;
    margin: 0;
    max-width: none;
    max-height: none;
    /* Cover the viewport so the dialog itself acts as the backdrop hit area. */
    width: 100vw;
    height: 100vh;
    /* Anchor to top-left so the drawer slides in from the leading edge. */
    inset: 0;
    color: var(--color-text-primary);
  }
  .mobile-nav::backdrop {
    background: var(--inspector-backdrop-color, rgba(0, 0, 0, 0.4));
  }

  /* The visible panel — left edge, 320px wide (capped at 85vw on small
     phones so a 360px-wide Galaxy doesn't show a flush-right notch). */
  .drawer {
    width: min(85vw, 320px);
    height: 100vh;
    background: var(--color-surface-raised);
    border-right: var(--card-border);
    padding: var(--p-space-5) var(--p-space-5) var(--p-space-6);
    display: flex;
    flex-direction: column;
    gap: var(--p-space-5);
    overflow-y: auto;
    box-sizing: border-box;
    /* Enter motion: slide in from leading edge. Initial transform applied
       via @starting-style so the FIRST paint after .showModal() is
       translateX(-100%) → translateX(0). */
    transform: translateX(0);
    transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* @starting-style is the modern way to animate from a "before the element
     existed" state. Falls back gracefully in browsers without support: the
     drawer just appears in its final position (acceptable). */
  @starting-style {
    .mobile-nav[open] .drawer {
      transform: translateX(-100%);
    }
  }

  /* Reduced motion (also the default on mobile per motion store) — no
     transition; the drawer simply appears. */
  :global(html[data-motion="reduced"]) .drawer {
    transition: none !important;
  }

  .drawer-header {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: var(--p-space-2);
    border-bottom: var(--card-border);
    padding-bottom: var(--p-space-3);
  }

  .brand-eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin: 0;
  }

  .brand-title {
    grid-column: 1;
    font-family: var(--font-headline);
    font-size: var(--font-size-h2);
    margin: 0;
    line-height: 1;
    letter-spacing: -0.01em;
  }

  .close-btn {
    grid-column: 2;
    grid-row: 1 / span 2;
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    color: var(--color-text-secondary);
    font-size: 28px;
    line-height: 1;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    padding: 0;
  }
  .close-btn:hover {
    background: var(--color-surface-sunken);
    color: var(--color-text-primary);
  }
  .close-btn:focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 2px;
  }

  .project-block {
    display: flex;
    flex-direction: column;
    gap: var(--p-space-2);
  }
  .project-name {
    font-size: var(--font-size-meta);
    color: var(--color-text-primary);
    margin: 0;
    font-weight: 500;
    line-height: 1.4;
  }
  .project-meta {
    display: flex;
    align-items: center;
    gap: var(--p-space-2);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    margin: 0;
  }
  .meta-label {
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .meta-value {
    background: var(--color-surface-sunken);
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    color: var(--color-text-primary);
  }

  .kpi-strip {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--p-space-3);
    border-top: var(--card-border);
    padding-top: var(--p-space-4);
  }
  .kpi {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--color-surface);
    border: var(--card-border);
    border-radius: var(--radius-sm);
    padding: var(--p-space-3) var(--p-space-4);
  }
  .kpi-value {
    font-family: var(--font-headline);
    font-size: var(--font-size-lead);
    color: var(--color-text-primary);
    line-height: 1;
  }
  .kpi-value.kpi-decision { color: var(--color-decision); }
  .kpi-value.kpi-error    { color: var(--color-error); }
  .kpi-value.kpi-milestone { color: var(--color-accent-primary); }
  .kpi-label {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--p-space-3);
    border-top: var(--card-border);
    padding-top: var(--p-space-4);
  }

  .palette-trigger {
    appearance: none;
    background: var(--color-surface);
    border: 1px solid var(--color-border-hairline);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
    padding: var(--p-space-3) var(--p-space-4);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--p-space-2);
    width: 100%;
    text-align: left;
  }
  .palette-trigger:hover {
    border-color: var(--color-accent-primary);
    color: var(--color-text-primary);
  }
  .pt-icon { color: var(--color-text-tertiary); }

  .back-to-toc {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--color-accent-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
    padding: var(--p-space-2) 0;
    cursor: pointer;
    text-align: left;
  }
  .back-to-toc:hover { text-decoration: underline; }

  .drawer-footer {
    margin-top: auto;
    padding-top: var(--p-space-4);
    border-top: var(--card-border);
  }
  .exported-at {
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
    margin: 0;
  }
</style>
