<!--
  ToolCallStrip — collapsible strip showing one tool invocation.

  Spec motion #7 / design §2 row 10. Click the summary row to expand
  details. Expansion uses `interpolate-size: allow-keywords` so we can
  transition `height: auto` directly (no JS measurement).

  Reduced-motion: instant toggle (no transition). Verified via app.css
  global rule.

  Browser support: interpolate-size lands in Chromium 129+. Older browsers
  snap from collapsed to expanded without animation — acceptable.
-->
<script lang="ts">
  interface Props {
    tool: string;
    input?: string;
    output?: string;
  }

  const { tool, input, output }: Props = $props();

  let expanded = $state(false);

  function toggle(): void {
    expanded = !expanded;
  }
</script>

<div class="tool-strip" data-testid="tool-call-strip">
  <button
    type="button"
    class="summary"
    onclick={toggle}
    aria-expanded={expanded}
  >
    <code class="tool-name">{tool}</code>
    {#if input}
      <span class="tool-input">{input}</span>
    {/if}
    <span class="chevron" aria-hidden="true" class:open={expanded}>›</span>
  </button>
  <div class="details" class:open={expanded}>
    {#if expanded && output}
      <pre class="output">{output}</pre>
    {/if}
  </div>
</div>

<style>
  .tool-strip {
    background: var(--color-surface-sunken);
    border: 1px solid var(--color-border-hairline);
    border-radius: var(--radius-sm);
    margin: var(--p-space-2) 0;
    overflow: hidden;
  }

  .summary {
    appearance: none;
    background: transparent;
    border: 0;
    padding: var(--p-space-3) var(--p-space-4);
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
    cursor: pointer;
    font: inherit;
    color: inherit;
    text-align: left;
  }

  .tool-name {
    background: var(--color-surface-raised);
    color: var(--color-accent-primary);
    padding: 2px 8px;
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    flex-shrink: 0;
  }

  .tool-input {
    flex: 1;
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chevron {
    color: var(--color-text-tertiary);
    transition: transform 200ms ease-out;
    flex-shrink: 0;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .details {
    /* interpolate-size enables height: auto transitions in Chrome 129+. */
    interpolate-size: allow-keywords;
    height: 0;
    overflow: hidden;
    transition: height 250ms ease-out;
  }

  .details.open {
    height: auto;
  }

  .output {
    background: var(--color-surface);
    border-top: 1px solid var(--color-border-hairline);
    margin: 0;
    padding: var(--p-space-3) var(--p-space-4);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    color: var(--color-text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
  }
</style>
