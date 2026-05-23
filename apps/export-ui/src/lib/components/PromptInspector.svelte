<!--
  PromptInspector — slide-in aside from the right.

  Spec R-22, R-23, R-36 / motion #11 / S-8, S-17 / Q3.

  CLOSED by default. Opens when a user clicks any event (sets the inspector
  store). Animates from translateX(100%) → translateX(0) over 300ms with the
  Emil Kowalski cubic-bezier curve. Exit reverses at 200ms.

  Closes on:
    - Esc key
    - Backdrop click
    - "Close" button

  Width: 480px on desktop (per --inspector-width token). Full-width drawer
  on mobile (P5 handles the breakpoint media query; the aside already
  respects var(--inspector-width)).

  Focus trap:
    Native <dialog> would give us focus trap for free, but a <dialog> is
    centered + modal-modal, not a side-panel. We implement a minimal trap
    here: on open, focus moves to the close button; Tab cycles inside the
    aside; Shift+Tab cycles backward; focus on the previous active element
    is restored on close.

  Reduced motion:
    Instant slide (no transition). The aside still opens + closes; only the
    animation is suppressed. Verified via data-motion="reduced" + global
    transition kill in app.css.
-->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import { payload } from "../stores/data";
  import { inspector } from "../stores/inspector";
  import type { RenderEvent } from "../types";
  import MarkdownBlock from "./MarkdownBlock.svelte";

  let openEventId: string | null = $state(null);
  let asideEl: HTMLElement | undefined = $state();
  let closeBtnEl: HTMLButtonElement | undefined = $state();
  let previousFocus: HTMLElement | null = null;

  const event = $derived.by<RenderEvent | null>(() => {
    if (!openEventId) return null;
    for (const ch of payload.chapters) {
      const found = ch.events.find((e) => e.id === openEventId);
      if (found) return found;
    }
    return null;
  });

  const body = $derived(openEventId ? payload.bodies[openEventId] : undefined);

  const tsDisplay = $derived.by(() => {
    if (!event) return "";
    const d = new Date(event.ts);
    if (Number.isNaN(d.getTime())) return event.ts;
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  });

  onMount(() => {
    const unsub = inspector.subscribe(async (id) => {
      const wasOpen = openEventId !== null;
      openEventId = id;
      if (id !== null && !wasOpen) {
        previousFocus = (document.activeElement as HTMLElement | null) ?? null;
        // Move focus to the close button on next tick (after the aside mounts).
        await tick();
        closeBtnEl?.focus();
      }
      if (id === null && wasOpen) {
        // Restore focus to whatever triggered the open.
        previousFocus?.focus();
        previousFocus = null;
      }
    });
    return unsub;
  });

  function onKey(e: KeyboardEvent): void {
    if (openEventId === null) return;
    if (e.key === "Escape") {
      e.preventDefault();
      inspector.close();
      return;
    }
    if (e.key === "Tab" && asideEl) {
      // Minimal focus trap: keep focus inside the aside.
      const focusable = asideEl.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function close(): void {
    inspector.close();
  }

  async function copyBody(): Promise<void> {
    const text = body ?? event?.title ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API may be denied in file://; non-fatal.
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if openEventId !== null}
  <button
    type="button"
    class="backdrop"
    aria-label="Close inspector"
    onclick={close}
    data-testid="inspector-backdrop"
  ></button>
{/if}

<aside
  class="inspector"
  class:is-open={openEventId !== null}
  aria-hidden={openEventId === null}
  aria-label="Event inspector"
  data-testid="prompt-inspector"
  bind:this={asideEl}
>
  {#if event}
    <header class="ins-header">
      <div class="ins-eyebrow-row">
        <span class="ins-eyebrow">{event.type}</span>
        <button
          type="button"
          class="close-btn"
          onclick={close}
          aria-label="Close inspector"
          bind:this={closeBtnEl}
          data-testid="inspector-close"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <line x1="3" y1="3" x2="13" y2="13" />
            <line x1="13" y1="3" x2="3" y2="13" />
          </svg>
        </button>
      </div>
      {#if event.title}
        <h2 class="ins-title">{event.title}</h2>
      {/if}
      <p class="ins-meta lb-tnum">
        <time datetime={event.ts}>{tsDisplay}</time>
        {#if event.sessionId}
          <span class="dot" aria-hidden="true">·</span>
          <span>{event.sessionId}</span>
        {/if}
      </p>
    </header>

    <div class="ins-body">
      {#if event.description}
        <p class="ins-description">{event.description}</p>
      {/if}
      {#if body}
        <MarkdownBlock {body} />
      {:else if !event.description}
        <p class="ins-empty">No body content for this event.</p>
      {/if}
    </div>

    <footer class="ins-footer">
      <button type="button" class="copy-btn" onclick={copyBody}>
        Copy body
      </button>
    </footer>
  {/if}
</aside>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--inspector-backdrop-color);
    border: 0;
    cursor: pointer;
    z-index: 40;
    /* Backdrop fades — gated by motion (kill in reduced via global rule). */
    animation: backdrop-in 200ms ease-out;
  }

  @keyframes backdrop-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .inspector {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    width: var(--inspector-width);
    max-width: 100vw;
    background: var(--color-surface-raised);
    border-left: 1px solid var(--color-border-hairline);
    box-shadow: -16px 0 48px rgba(0, 0, 0, 0.18);
    z-index: 50;
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
  }

  .inspector.is-open {
    transform: translateX(0);
  }

  /* Exit easing is slightly faster (200ms ease-out per spec R-23). */
  .inspector:not(.is-open) {
    transition: transform 200ms ease-in;
  }

  /* Reduced-motion: instant. The global rule in app.css zeroes the transition
     duration; this is just belt-and-suspenders. */
  :global(html[data-motion="reduced"]) .inspector {
    transition: none !important;
  }

  .ins-header {
    padding: var(--p-space-5) var(--p-space-5) var(--p-space-4);
    border-bottom: var(--card-border);
    flex-shrink: 0;
  }

  .ins-eyebrow-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--p-space-3);
  }

  .ins-eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-family: var(--font-mono);
  }

  .close-btn {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 6px;
    border-radius: var(--radius-xs);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .close-btn:hover {
    background: var(--color-surface-sunken);
    color: var(--color-text-primary);
  }

  .ins-title {
    font-family: var(--font-headline);
    font-size: var(--font-size-h2);
    margin: 0 0 var(--p-space-2) 0;
    color: var(--color-text-primary);
    line-height: 1.2;
    letter-spacing: -0.01em;
  }

  .ins-meta {
    margin: 0;
    font-size: var(--font-size-meta);
    color: var(--color-text-secondary);
    display: flex;
    align-items: center;
    gap: var(--p-space-2);
  }

  .dot {
    color: var(--color-text-tertiary);
  }

  .ins-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--p-space-5);
    min-height: 0;
  }

  .ins-description {
    margin: 0 0 var(--p-space-4) 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    line-height: 1.6;
  }

  .ins-empty {
    color: var(--color-text-tertiary);
    font-style: italic;
    margin: 0;
  }

  .ins-footer {
    padding: var(--p-space-4) var(--p-space-5);
    border-top: var(--card-border);
    display: flex;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .copy-btn {
    appearance: none;
    background: transparent;
    border: 1px solid var(--color-border-hairline);
    color: var(--color-accent-primary);
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
    padding: var(--p-space-2) var(--p-space-4);
    border-radius: var(--radius-xs);
    cursor: pointer;
    transition: border-color 150ms ease-out;
  }
  .copy-btn:hover {
    border-color: var(--color-accent-primary);
  }

  /* MOBILE: full-width drawer. */
  @media (max-width: 767px) {
    .inspector {
      width: 100vw;
      border-left: 0;
    }
  }
</style>
