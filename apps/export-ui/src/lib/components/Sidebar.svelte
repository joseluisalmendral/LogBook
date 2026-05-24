<!--
  Sidebar — left rail of the CourseShell.

  Contents (top to bottom):
    1. App title ("LogBook Replay")
    2. Project info (name + short sha)
    3. Theme toggle (sun/moon)
    4. Course totals (KPI strip)
    5. Footer: exportedAt timestamp

  On mobile (≤767px) the sidebar collapses behind a hamburger button. The
  full slide-in <MobileNav> drawer is P5 — for P3 we wire the hamburger to
  toggle an `aria-expanded` flag on the sidebar so the basic mobile drawer
  works, but every section of MobileNav (search, filters) is deferred.

  The KPI strip mirrors the totals already shown in the TOC subtitle, but
  presents them as discrete chips that double as visual anchors on long
  chapter pages where the TOC header is scrolled out of view.
-->
<script lang="ts">
  import { payload } from "../stores/data";
  import ThemeToggle from "./ThemeToggle.svelte";
  import { palette } from "../stores/palette";
  import { editorPref, EDITOR_OPTIONS, type EditorScheme } from "../stores/editor-pref";

  // Slice-18: editor URI picker — small select bound to the editorPref store
  // so the file-open chips (FileChangeStrip, linkified tool inputs) route to
  // the user's preferred editor. Subscribing keeps the <select> in sync if
  // some other surface flips the pref.
  let editorScheme = $state<EditorScheme>(editorPref.get());
  $effect(() => {
    const unsub = editorPref.subscribe((scheme) => {
      editorScheme = scheme;
    });
    return () => unsub();
  });
  function onEditorChange(e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value;
    editorPref.set(value as EditorScheme);
  }

  interface Props {
    open: boolean;
    onClose?: () => void;
  }

  const { open, onClose }: Props = $props();

  const shortSha = $derived.by(() => {
    const sha = payload.project.sha;
    if (!sha) return "";
    return sha.length > 7 ? sha.slice(0, 7) : sha;
  });

  function handleBackdrop(): void {
    if (typeof onClose === "function") onClose();
  }
</script>

{#if open}
  <!-- Mobile-only backdrop. Desktop never renders this (the sidebar is in flow). -->
  <button
    type="button"
    class="sidebar-backdrop"
    aria-label="Close navigation"
    onclick={handleBackdrop}
  ></button>
{/if}

<aside
  class="sidebar"
  class:open
  aria-label="Course navigation"
  data-testid="sidebar"
>
  <header class="brand">
    <p class="brand-eyebrow">LogBook</p>
    <h1 class="brand-title">Replay</h1>
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

  <div class="toolbar">
    <ThemeToggle />
    <button
      type="button"
      class="palette-trigger"
      onclick={() => palette.openPalette()}
      aria-label="Open command palette"
      data-testid="palette-trigger"
    >
      <span class="pt-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6">
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" stroke-linecap="round" />
        </svg>
      </span>
      Search
      <kbd class="pt-kbd">⌘K</kbd>
    </button>
  </div>

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

  <!-- Slice-18: editor picker — small, low-emphasis. Sits above the
       exported-at footer so it's discoverable without dominating the rail. -->
  <section class="editor-pref" aria-label="Editor preference">
    <label class="editor-pref-label" for="lb-editor-pref">Open files in</label>
    <select
      id="lb-editor-pref"
      class="editor-pref-select"
      value={editorScheme}
      onchange={onEditorChange}
      data-interactive
    >
      {#each EDITOR_OPTIONS as opt (opt.value)}
        <option value={opt.value} title={opt.hint}>{opt.label}</option>
      {/each}
    </select>
  </section>

  <footer class="sidebar-footer">
    {#if payload.exportedAt}
      <p class="exported-at lb-tnum">
        Exported {new Date(payload.exportedAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </p>
    {/if}
  </footer>
</aside>

<style>
  .sidebar {
    grid-area: sidebar;
    width: 280px;
    background: var(--color-surface-raised);
    border-right: var(--card-border);
    padding: var(--p-space-6) var(--p-space-5);
    display: flex;
    flex-direction: column;
    gap: var(--p-space-5);
    overflow-y: auto;
    /* Sticky on desktop so the rail follows the chapter as you scroll. */
    position: sticky;
    top: 0;
    height: 100vh;
  }

  .brand {
    border-bottom: var(--card-border);
    padding-bottom: var(--p-space-4);
  }

  .brand-eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin: 0 0 var(--p-space-1) 0;
  }

  .brand-title {
    font-family: var(--font-headline);
    font-size: var(--font-size-h2);
    margin: 0;
    line-height: 1;
    letter-spacing: -0.01em;
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

  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--p-space-2);
    flex-wrap: wrap;
  }

  .palette-trigger {
    appearance: none;
    background: var(--color-surface);
    border: 1px solid var(--color-border-hairline);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-family: var(--font-body);
    font-size: var(--font-size-caption);
    padding: 4px 8px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    transition: border-color 150ms ease;
  }
  .palette-trigger:hover {
    border-color: var(--color-accent-primary);
    color: var(--color-text-primary);
  }
  .pt-icon {
    display: inline-flex;
    color: var(--color-text-tertiary);
  }
  .pt-kbd {
    margin-left: auto;
    font-family: var(--font-mono);
    background: var(--color-surface-sunken);
    color: var(--color-text-tertiary);
    padding: 1px 4px;
    border-radius: var(--radius-xs);
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

  /* Slice-18 editor picker — sits flush against the totals strip, low key. */
  .editor-pref {
    display: flex;
    flex-direction: column;
    gap: var(--p-space-2);
    margin-top: auto;
    padding-top: var(--p-space-3);
    border-top: 1px solid var(--color-border-hairline);
  }
  .editor-pref-label {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .editor-pref-select {
    appearance: none;
    font: inherit;
    font-size: var(--font-size-meta);
    color: var(--color-text-primary);
    background: var(--color-surface-base);
    border: var(--card-border);
    border-radius: var(--card-radius);
    padding: var(--p-space-2) var(--p-space-3);
    cursor: pointer;
    transition: border-color 150ms ease;
  }
  .editor-pref-select:hover,
  .editor-pref-select:focus-visible {
    border-color: var(--color-accent-primary);
    outline: none;
  }

  .sidebar-footer {
    margin-top: auto;
    padding-top: var(--p-space-4);
    border-top: var(--card-border);
  }

  .exported-at {
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
    margin: 0;
  }

  /* Desktop never shows a backdrop. */
  .sidebar-backdrop {
    display: none;
  }

  /* ---------- Mobile graceful-degrade (Q4 / R-27) ---------- */
  @media (max-width: 767px) {
    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      height: 100vh;
      width: min(85vw, 320px);
      z-index: 30;
      transform: translateX(-100%);
      transition: transform 250ms ease-out;
      box-shadow: 8px 0 28px rgba(0, 0, 0, 0.18);
    }
    .sidebar.open {
      transform: translateX(0);
    }
    .sidebar-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      background: var(--inspector-backdrop-color);
      z-index: 20;
      border: 0;
      cursor: pointer;
    }
  }
</style>
