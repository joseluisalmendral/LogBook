<!--
  FileChangeStrip — slice 14 Bucket E.

  Renders a compact horizontal list of files touched during a chapter/turn,
  grouped by action. Each chip carries:
    - Action monogram (write=●, edit=◆, multi-edit=◇, read=○)
    - Path basename (full path in title attr for hover detail)
    - Click → opens the file via vscode://file/<absPath> (slice-12 deep-link.ts)

  Pure presentational atom. No internal state, no observers. Consumers:
    - SubAgentCard expanded body (per-sub-agent filesTouched)
    - ChapterHeader (chapter-level aggregate)

  Compact mode (`compact={true}`): shows only the count badge + first 3 chips,
  rest collapse to a "+N more" suffix. Used inside dense SubAgentCard compact
  rows. Default mode renders the full list wrapped.
-->
<script lang="ts">
  import type { FileTouch } from "../types.ts";
  import { buildFileUri } from "../util/deep-link.ts";

  interface Props {
    files: FileTouch[];
    /** When true, render only the count + first N chips. Default: false (full list). */
    compact?: boolean;
    /** Max chips shown in compact mode before collapsing to "+N more". Default 3. */
    compactLimit?: number;
    /** ARIA label for the strip. Override when the surrounding context needs more specificity. */
    ariaLabel?: string;
  }

  const {
    files,
    compact = false,
    compactLimit = 3,
    ariaLabel = "Files touched",
  }: Props = $props();

  const visible = $derived(compact ? files.slice(0, compactLimit) : files);
  const overflow = $derived(
    compact && files.length > compactLimit ? files.length - compactLimit : 0,
  );

  /** Last path segment for the chip label. Full path stays in the title attr. */
  function basename(p: string): string {
    const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return idx >= 0 ? p.slice(idx + 1) : p;
  }

  /**
   * Action → glyph + label. Glyph mirrors the SubAgentCard monogram style so
   * the dictionary stays in one place visually. Read is hollow because it's
   * the weakest action; create has a `+` to signal a new file vs an overwrite.
   */
  const ACTION_META: Record<FileTouch["action"], { glyph: string; label: string }> = {
    create: { glyph: "✚", label: "created" },
    write: { glyph: "●", label: "wrote" },
    edit: { glyph: "◆", label: "edited" },
    multi_edit: { glyph: "◇", label: "multi-edit" },
    read: { glyph: "○", label: "read" },
  };
</script>

{#if files.length > 0}
  <ul class="strip" data-testid="file-change-strip" aria-label={ariaLabel}>
    {#each visible as file (file.path)}
      <li class="chip" data-action={file.action} title={`${ACTION_META[file.action].label} ${file.path}`}>
        <a
          class="chip-link"
          href={buildFileUri(file.path)}
          data-deep-link="file"
          aria-label={`${ACTION_META[file.action].label} ${file.path}`}
        >
          <span class="glyph" aria-hidden="true">{ACTION_META[file.action].glyph}</span>
          <span class="path">{basename(file.path)}</span>
        </a>
      </li>
    {/each}
    {#if overflow > 0}
      <li class="chip chip-overflow" title={`${overflow} more file${overflow === 1 ? "" : "s"} touched`}>
        +{overflow}
      </li>
    {/if}
  </ul>
{/if}

<style>
  .strip {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem 0.5rem;
    font-size: 0.78rem;
    line-height: 1.2;
  }

  .chip {
    display: inline-flex;
    align-items: center;
  }

  .chip-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.18rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--lb-border, rgba(0, 0, 0, 0.12));
    background: var(--lb-surface-sunken, rgba(0, 0, 0, 0.025));
    color: var(--lb-fg, currentColor);
    text-decoration: none;
    font-family: var(--lb-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    transition: background 150ms ease, border-color 150ms ease, transform 150ms ease;
  }

  .chip-link:hover {
    background: rgba(var(--brand-rgb, 124 91 234), 0.08);
    border-color: rgba(var(--brand-rgb, 124 91 234), 0.4);
    transform: translateY(-1px);
  }

  .chip-link:focus-visible {
    outline: 2px solid rgba(var(--brand-rgb, 124 91 234), 0.6);
    outline-offset: 2px;
  }

  .glyph {
    font-size: 0.7em;
    line-height: 1;
  }

  /* Per-action accent colors. Create = strongest signal (new file, green +);
     write = overwrite (yellow accent); edit/multi-edit = modification of
     existing (subagent purple); read = muted (touched but not changed). */
  .chip[data-action="create"] .glyph {
    color: var(--color-fix, #16a34a);
    font-weight: 700;
  }
  .chip[data-action="create"] .chip-link {
    border-color: rgba(22, 163, 74, 0.3);
    background: rgba(22, 163, 74, 0.05);
  }
  .chip[data-action="write"] .glyph {
    color: var(--color-milestone, #f59e0b);
  }
  .chip[data-action="edit"] .glyph {
    color: var(--color-subagent, #8b5cf6);
  }
  .chip[data-action="multi_edit"] .glyph {
    color: var(--color-subagent, #8b5cf6);
  }
  .chip[data-action="read"] .glyph {
    color: var(--lb-fg-muted, rgba(0, 0, 0, 0.5));
  }

  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 24ch;
  }

  .chip-overflow {
    padding: 0.18rem 0.5rem;
    border-radius: 999px;
    color: var(--lb-fg-muted, rgba(0, 0, 0, 0.55));
    font-variant-numeric: tabular-nums;
    background: transparent;
    border: 1px dashed var(--lb-border, rgba(0, 0, 0, 0.15));
  }

  /* Honor reduced-motion: skip hover lift but keep color/border feedback. */
  :global(html[data-motion="reduced"]) .chip-link:hover {
    transform: none;
  }
</style>
