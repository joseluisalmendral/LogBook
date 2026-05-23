<!--
  App — P1 hello-world host. Reads the #lb-data payload (if any) and shows
  a count of events as a smoke-test signal that the bundle wires together.

  P3 replaces this with <CourseShell>. For slice-0 the only requirement is:
  prove the build pipeline + token CSS + MotionRoot all wire together and
  the resulting HTML opens without console errors (design §10 smoke #2).
-->
<script lang="ts">
  import MotionRoot from "./lib/components/MotionRoot.svelte";

  type LbPayload = { version?: number; chapters?: unknown[] } & Record<string, unknown>;

  function readPayload(): LbPayload | null {
    if (typeof document === "undefined") return null;
    const node = document.getElementById("lb-data");
    if (!node) return null;
    const raw = node.textContent?.trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LbPayload;
    } catch {
      return null;
    }
  }

  const payload = $state(readPayload());

  const chapterCount = $derived(
    payload && Array.isArray(payload.chapters) ? payload.chapters.length : 0,
  );
</script>

<MotionRoot>
  {#snippet children()}
    <main class="lb-shell" data-testid="lb-shell">
      <header class="lb-header">
        <p class="lb-eyebrow">LogBook export</p>
        <h1 class="lb-title">Slice 0 — scaffold smoke</h1>
        <p class="lb-meta">
          Bundle wired. MotionRoot mounted. Tokens loaded. Payload parsing OK.
        </p>
      </header>

      <section class="lb-card" aria-label="Payload status">
        {#if payload === null}
          <p>
            No <code>#lb-data</code> payload found. This is expected for the
            bare scaffold; <code>logbook export html</code> will inject one at
            build time (slice 10 P5).
          </p>
        {:else}
          <p>
            Payload <code>version={payload.version ?? "unknown"}</code> parsed
            successfully. {chapterCount} chapter{chapterCount === 1 ? "" : "s"}.
          </p>
        {/if}
      </section>
    </main>
  {/snippet}
</MotionRoot>

<style>
  .lb-shell {
    max-width: var(--reading-max-width);
    margin: var(--p-space-9) auto;
    padding: 0 var(--p-space-5);
    color: var(--color-text-primary);
  }

  .lb-header {
    margin-bottom: var(--p-space-7);
  }

  .lb-eyebrow {
    font-family: var(--font-body);
    font-size: var(--font-size-meta);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 var(--p-space-2) 0;
  }

  .lb-title {
    font-family: var(--font-headline);
    font-size: var(--font-size-h1);
    line-height: 1.1;
    margin: 0 0 var(--p-space-3) 0;
  }

  .lb-meta {
    font-size: var(--font-size-meta);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .lb-card {
    background: var(--color-surface-raised);
    border: var(--card-border);
    border-radius: var(--card-radius);
    padding: var(--card-padding);
  }

  .lb-card code {
    background: var(--color-surface-sunken);
    padding: 0 var(--p-space-1);
    border-radius: var(--p-radius-xs);
  }
</style>
