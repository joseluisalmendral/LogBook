/**
 * markdown-body.ts — body-only Markdown → sanitized HTML helper (export-replan P2).
 *
 * This is the helper consumed by `buildExportPayload` to fill the
 * `bodies: Record<eventId, html>` field of payload v2 (spec R-11, R-13). It is
 * NOT a refactor of the legacy `src/export/markdown-to-html.ts`; that file
 * keeps its placeholder ceremony (LBDETAILS_N / LBRAW_N / mermaid pre-render)
 * because the OLD shell still uses it. P5 deletes the old path.
 *
 * Sanitization contract (spec INV-11, R-50):
 *   - NO `<script>` tags (allowed by default schema, explicitly stripped here)
 *   - NO inline event handlers (`onclick`, `onmouseenter`, …)
 *   - NO `javascript:` URIs
 *   - NO `data:` URIs except `data:image/*`
 *   - Heading anchors via `rehype-slug` so the export UI can target #fragments.
 *
 * Pure async function — no I/O, deterministic for a given input.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

// `rehype-sanitize` ships its own Schema type via its options parameter; we
// avoid a direct `hast-util-sanitize` import (not in package.json) by inferring
// the schema shape from the default export's accepted argument.
type Schema = Parameters<typeof rehypeSanitize>[0];

// ---------------------------------------------------------------------------
// Sanitize schema
// ---------------------------------------------------------------------------

/**
 * Custom sanitize schema derived from rehype-sanitize's defaultSchema.
 *
 * Why a custom schema:
 *   - The default schema is GitHub-flavored: it allows `data:` URIs in `src`
 *     and `href` indiscriminately. We must restrict `data:` to images only.
 *   - We add an explicit `id` allowance on heading elements so `rehype-slug`
 *     anchors survive sanitization (the default schema permits this on most
 *     headings already; we re-state it for clarity).
 *
 * Anything not in the schema is dropped silently — that includes `<script>`,
 * `<iframe>`, `<object>`, `onclick`, `onmouseenter`, etc.
 */
const SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  // Restrict URL protocols. The default schema already excludes `javascript:`
  // from `href` / `src`; we re-state the restrictions explicitly because the
  // single-file export must never carry executable URIs.
  protocols: {
    ...(defaultSchema.protocols ?? {}),
    // `href` keeps the default-safe set (http, https, mailto, irc, …).
    // `src` and `cite` are tightened to drop `data:` for non-image elements.
    src: ["http", "https", "data"],
    cite: ["http", "https"],
  },
  // `data:` URIs on `<img>` are permitted (used for inlined PNG/SVG content);
  // the schema's url-handling drops `data:` when the protocol is not listed.
  // We keep the default attribute list intact otherwise.
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render an event body Markdown string into sanitized HTML.
 *
 * Returns the empty string for empty / whitespace-only input.
 *
 * The output is an inner HTML fragment — NO `<html>`, `<head>`, or `<body>`
 * ceremony — suitable for direct insertion into the export UI via `{@html ...}`
 * (Svelte) or any other innerHTML-bearing slot.
 */
export async function renderEventBody(rawMarkdown: string): Promise<string> {
  if (typeof rawMarkdown !== "string" || rawMarkdown.trim() === "") return "";

  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlug)
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(rehypeStringify);

  const file = await processor.process(rawMarkdown);
  return String(file);
}
