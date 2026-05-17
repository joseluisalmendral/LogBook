/**
 * Speaker block marker family for teaching-scripts (S6.2).
 *
 * Marker syntax:
 *   <!-- logbook:speaker start v=1 -->
 *   ...speaker note content...
 *   <!-- logbook:speaker end -->
 *
 * Public functions:
 *   - stripSpeakerBlocks(md): remove all speaker blocks from markdown.
 *     Used by default export pipeline (speakerMode=false).
 *   - renderSpeakerBlocks(md): replace marker pairs with placeholder comments
 *     that survive remark/rehype; a second pass (injectSpeakerDivs) replaces
 *     the placeholders with <div class="speaker-note">...</div> in the final HTML.
 *     Used when speakerMode=true.
 *   - injectSpeakerDivs(html, blocks): replace placeholder comments with rendered divs.
 *
 * Failure modes:
 *   - Nested start markers → throws Error("nested speaker blocks are not supported")
 *   - Unterminated start marker → strips from open to EOF + console.warn
 */

/**
 * Placeholder text format — rendered as a paragraph by remark, then replaced
 * with the actual speaker-note div after the unified pipeline runs.
 *
 * Format: `LBSPEAKER_N` as a standalone paragraph.
 * After rehype-stringify: `<p>LBSPEAKER_N</p>`.
 * We replace `<p>LBSPEAKER_N</p>` in the HTML output with the speaker div.
 */
const SPEAKER_PLACEHOLDER_PREFIX = "LBSPEAKER_";

const RE_START = /<!--\s*logbook:speaker start[^>]*-->/;
const RE_END = /<!--\s*logbook:speaker end\s*-->/;

type ParsedSegment =
  | { kind: "text"; content: string }
  | { kind: "block"; content: string };

/**
 * Parse a markdown string into alternating text and speaker-block segments.
 *
 * Throws if nested start markers are detected.
 * Warns (console.warn) if an unterminated block is found — treats remainder
 * from open marker to EOF as block content (strips/renders it accordingly).
 */
function parseSegments(md: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let remaining = md;

  while (remaining.length > 0) {
    const startMatch = RE_START.exec(remaining);
    if (!startMatch) {
      // No more speaker blocks — rest is plain text.
      segments.push({ kind: "text", content: remaining });
      break;
    }

    // Text before the start marker.
    const textBefore = remaining.slice(0, startMatch.index);
    if (textBefore.length > 0) {
      segments.push({ kind: "text", content: textBefore });
    }

    // Content after the start marker.
    const afterStart = remaining.slice(
      startMatch.index + startMatch[0].length,
    );

    // Check for nested start marker before the end marker.
    const nestedStartMatch = RE_START.exec(afterStart);
    const endMatch = RE_END.exec(afterStart);

    if (nestedStartMatch && (!endMatch || nestedStartMatch.index < endMatch.index)) {
      throw new Error(
        "nested speaker blocks are not supported: found <!-- logbook:speaker start --> inside another speaker block",
      );
    }

    if (!endMatch) {
      // Unterminated block — strip from start to EOF with warning.
      console.warn(
        "[logbook] warning: unterminated <!-- logbook:speaker start --> block found; stripping from open marker to EOF",
      );
      segments.push({ kind: "block", content: afterStart.trimEnd() });
      break;
    }

    // Extract block content (between start and end markers).
    const blockContent = afterStart.slice(0, endMatch.index);
    segments.push({ kind: "block", content: blockContent });

    // Advance past the end marker.
    remaining = afterStart.slice(endMatch.index + endMatch[0].length);
  }

  return segments;
}

/**
 * Remove all speaker blocks (and surrounding blank lines) from markdown.
 * Used by the default export pipeline (speakerMode=false).
 */
export function stripSpeakerBlocks(md: string): string {
  const segments = parseSegments(md);
  const textParts = segments
    .filter((s) => s.kind === "text")
    .map((s) => s.content);

  // Join text parts; collapse runs of 3+ newlines to 2 (clean up blank lines
  // left by removed blocks).
  return textParts.join("").replace(/\n{3,}/g, "\n\n");
}

export interface SpeakerBlock {
  /** Placeholder index (matches the comment in markdown). */
  index: number;
  /** Raw content of the speaker block (trimmed). */
  content: string;
}

/**
 * Replace speaker block markers with text placeholder paragraphs that survive
 * the remark → rehype → stringify pipeline.
 *
 * The placeholder `LBSPEAKER_N` is rendered as `<p>LBSPEAKER_N</p>` by rehype.
 * Call injectSpeakerDivs() on the HTML output to replace these with actual
 * <div class="speaker-note"> elements.
 *
 * Used when speakerMode=true.
 */
export function preprocessSpeakerPlaceholders(md: string): {
  markdown: string;
  blocks: SpeakerBlock[];
} {
  const segments = parseSegments(md);
  const blocks: SpeakerBlock[] = [];
  let blockIndex = 0;

  const parts = segments.map((s) => {
    if (s.kind === "text") return s.content;
    const index = blockIndex++;
    const content = s.content.replace(/^\n+/, "").replace(/\n+$/, "");
    blocks.push({ index, content });
    // Use a standalone paragraph with a unique token — remark renders this as
    // <p>LBSPEAKER_N</p> which we can reliably find and replace post-pipeline.
    return `\n\n${SPEAKER_PLACEHOLDER_PREFIX}${index}\n\n`;
  });

  return { markdown: parts.join(""), blocks };
}

/**
 * Replace <p>LBSPEAKER_N</p> paragraphs in HTML with
 * <div class="speaker-note">...</div> elements.
 *
 * The content of each speaker block is rendered as plain HTML paragraphs
 * (trimmed, with newlines converted to <br> if multi-line).
 */
export function injectSpeakerDivs(html: string, blocks: SpeakerBlock[]): string {
  let result = html;
  for (const block of blocks) {
    // rehype-stringify wraps the placeholder text in a <p> tag
    const placeholder = `<p>${SPEAKER_PLACEHOLDER_PREFIX}${block.index}</p>`;
    // Format the content: preserve line breaks as <br>.
    const inner = block.content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("<br>\n");
    const div = `<div class="speaker-note">${inner}</div>`;
    result = result.replace(placeholder, div);
  }
  return result;
}

/**
 * @deprecated Use preprocessSpeakerPlaceholders + injectSpeakerDivs instead.
 * Kept for direct unit-test assertions on the markdown-level transformation.
 *
 * Replace speaker block markers with <div class="speaker-note">...</div> directly.
 * NOTE: These raw divs will be dropped by remark/rehype unless allowDangerousHtml
 * is enabled. Use the placeholder approach for the actual export pipeline.
 */
export function renderSpeakerBlocks(md: string): string {
  const segments = parseSegments(md);
  return segments
    .map((s) => {
      if (s.kind === "text") return s.content;
      // Wrap block content in speaker-note div.
      // Trim trailing/leading newlines inside the block for clean HTML.
      const inner = s.content.replace(/^\n+/, "").replace(/\n+$/, "");
      return `<div class="speaker-note">\n${inner}\n</div>`;
    })
    .join("");
}
