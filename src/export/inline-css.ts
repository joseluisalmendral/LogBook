/**
 * Inline CSS constant for HTML export.
 *
 * Decision T12.D1: the CSS is embedded as a string constant here rather
 * than loaded from assets/export/styles.css at runtime. This avoids
 * bundle-time asset resolution complexity (CJS __dirname vs ESM
 * import.meta.url vs tsup output layout).
 *
 * Synchronization contract: tests/unit/inline-css-sync.test.ts asserts
 * that this constant is byte-identical to assets/export/styles.css. Any
 * change to the CSS must be applied to BOTH files. Regenerate with:
 *   python3 scripts/sync-inline-css.py
 *
 * No external fonts, no CDN references, no http(s) URLs.
 */

export const INLINE_CSS = `/* LogBook export styles. No external resources. Light + dark + print. */

/* =========================================================================
   Design tokens — ADR-06
   Linear aesthetic: zinc shells, indigo accent, generous whitespace.

   Semantic note on --lb-bg:
   --lb-bg paints the .lb-doc CARD surface (not the body/page shell).
   The page shell background is --lb-page-bg. If you have an existing
   --theme override that targets --lb-bg expecting it to be the body
   background, update your override to use --lb-page-bg for the shell and
   --lb-bg for the content card.
   ========================================================================= */
:root {
  /* Page shell — zinc 50 */
  --lb-page-bg: #fafafa;
  /* Content card surface — white. NOTE: --lb-bg is the CARD, not the body. */
  --lb-bg: #ffffff;
  /* Foreground */
  --lb-fg: #18181b;
  --lb-fg-muted: #71717a;
  /* Borders */
  --lb-border: #e4e4e7;
  --lb-border-strong: #d4d4d8;
  /* Code surfaces */
  --lb-code-bg: #f4f4f5;
  --lb-code-fg: #18181b;
  /* Accent — indigo (Linear brand) */
  --lb-accent: #5e6ad2;
  --lb-accent-hover: #4f5ac6;
  /* Blockquote text */
  --lb-blockquote-fg: #52525b;
  /* Speaker/callout */
  --lb-callout-bg: #fffbeb;
  --lb-callout-border: #f59e0b;
  /* Elevation */
  --lb-shadow-card: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.03);
  /* Radius scale */
  --lb-radius-sm: 6px;
  --lb-radius-md: 10px;
  --lb-radius-lg: 12px;
}

/* Dark mode overrides — ADR-06 */
@media (prefers-color-scheme: dark) {
  :root {
    --lb-page-bg: #09090b;
    --lb-bg: #0f0f10;
    --lb-fg: #fafafa;
    --lb-fg-muted: #a1a1aa;
    --lb-border: #27272a;
    --lb-border-strong: #3f3f46;
    --lb-code-bg: #18181b;
    --lb-code-fg: #fafafa;
    /* Dark accent validated at ~7.8:1 on #0f0f10 — passes WCAG AAA */
    --lb-accent: #8d94e8;
    --lb-accent-hover: #a5abeb;
    --lb-blockquote-fg: #a1a1aa;
    --lb-callout-bg: #1c1a0e;
    --lb-callout-border: #d4a72c;
    /* Shadows look like compression artifacts on dark surfaces — use border instead */
    --lb-shadow-card: none;
  }
}

/* =========================================================================
   Reset
   ========================================================================= */
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }

/* =========================================================================
   Layout — ADR-07
   Two-surface architecture: body = page shell, .lb-doc = content card.
   ========================================================================= */
body {
  background: var(--lb-page-bg);
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui,
    "Helvetica Neue", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.65;
  color: var(--lb-fg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.lb-doc {
  background: var(--lb-bg);
  max-width: 820px;
  margin: 2.5rem auto;
  padding: 3rem 2.5rem 4rem;
  border-radius: var(--lb-radius-lg);
  box-shadow: var(--lb-shadow-card);
}

@media (prefers-color-scheme: dark) {
  .lb-doc {
    border: 1px solid var(--lb-border);
    box-shadow: none;
  }
}

/* Mobile: edge-to-edge card — standard Linear/Vercel pattern */
@media (max-width: 640px) {
  .lb-doc {
    padding: 1.5rem 1.25rem 2rem;
    border-radius: 0;
    margin: 1rem 0;
  }
}

/* =========================================================================
   Typography — ADR-08
   ========================================================================= */
h1, h2, h3, h4, h5, h6 {
  color: var(--lb-fg);
  line-height: 1.2;
  margin: 2rem 0 1rem;
}

/* h1 — document title, no top margin, no border-bottom (removed old GitHub style) */
h1 {
  font-size: 2.25rem;
  font-weight: 700;
  letter-spacing: -0.04em;
  margin: 0 0 1.5rem;
}

/* h2 — section header, generous top spacing */
h2 {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  margin-top: 3.5rem;
}

h3 {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.015em;
}

h4 { font-size: 1.05rem; font-weight: 600; }

h5 { font-size: 0.95rem; font-weight: 600; color: var(--lb-fg-muted); }

h6 {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--lb-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

p { margin: 0.75rem 0; }

a {
  color: var(--lb-accent);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.15s ease, color 0.15s ease;
}

a:hover {
  border-bottom-color: var(--lb-accent);
  color: var(--lb-accent-hover);
}

strong { font-weight: 600; }
em { font-style: italic; }

ul, ol { padding-left: 1.5rem; margin: 0.75rem 0; }
li { margin: 0.25rem 0; }
li > p:first-child { margin-top: 0; }
li > p:last-child { margin-bottom: 0; }

/* =========================================================================
   Code — ADR-11
   Inline code loses its border; block pre keeps a subtle 1px border.
   ========================================================================= */
code {
  font-family: ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 0.875em;
  background: var(--lb-code-bg);
  color: var(--lb-code-fg);
  padding: 0.15em 0.4em;
  border-radius: var(--lb-radius-sm);
  /* No border on inline code — subtle, clean */
}

pre {
  background: var(--lb-code-bg);
  color: var(--lb-code-fg);
  padding: 1.25rem 1.5rem;
  border-radius: var(--lb-radius-md);
  border: 1px solid var(--lb-border);
  overflow-x: auto;
  font-size: 0.875em;
  line-height: 1.55;
  margin: 1.25rem 0;
}

pre code {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 1em;
  color: inherit;
}

/* =========================================================================
   Tables — ADR-09
   Bottom-border-only rows. No stripes. thead gets a stronger bottom rule.
   ========================================================================= */
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1.5rem 0;
  font-size: 0.95em;
  display: block;
  overflow-x: auto;
}

@media (min-width: 640px) {
  table { display: table; }
}

th, td {
  padding: 0.6rem 0.85rem;
  text-align: left;
  vertical-align: top;
  /* No left/right/top borders — bottom only */
}

tbody tr {
  border-bottom: 1px solid var(--lb-border);
}

thead tr {
  border-bottom: 2px solid var(--lb-border-strong);
}

th {
  font-weight: 600;
  color: var(--lb-fg);
}

/* =========================================================================
   Blockquote — ADR-10
   Left accent bar only. No background fill. No italic.
   ========================================================================= */
blockquote {
  border-left: 3px solid var(--lb-accent);
  margin: 1.5rem 0;
  padding: 0.25rem 0 0.25rem 1rem;
  color: var(--lb-blockquote-fg);
  background: none;
  border-radius: 0;
}

blockquote p:first-child { margin-top: 0; }
blockquote p:last-child { margin-bottom: 0; }

/* =========================================================================
   Horizontal rule — ADR-13
   Thin centered divider at 40% width to mark section boundaries.
   ========================================================================= */
hr {
  border: none;
  border-top: 1px solid var(--lb-border);
  max-width: 40%;
  margin: 3rem auto;
}

/* =========================================================================
   Images and SVG
   ========================================================================= */
img, svg { max-width: 100%; height: auto; }

/* =========================================================================
   Mermaid containers — ADR-12
   Card-style wrapper: border, large radius, centered content.
   ========================================================================= */
.mermaid {
  background: var(--lb-bg);
  border: 1px solid var(--lb-border);
  border-radius: var(--lb-radius-lg);
  padding: 1.5rem;
  margin: 1.5rem 0;
  overflow-x: auto;
  text-align: center;
}

/* =========================================================================
   Speaker notes — ADR-14
   Callout style with amber left border.
   ========================================================================= */
.speaker-note {
  background: var(--lb-callout-bg);
  border-left: 3px solid var(--lb-callout-border);
  padding: 1rem 1.25rem;
  margin: 1.25rem 0;
  border-radius: var(--lb-radius-md);
  font-style: italic;
}

/* =========================================================================
   Print — ADR-15 (preserved with token name updates)
   ========================================================================= */
@media print {
  body {
    max-width: none;
    margin: 0;
    padding: 1cm;
    font-size: 11pt;
    color: #000;
    background: #fff;
  }
  .lb-doc {
    max-width: none;
    margin: 0;
    padding: 0;
    border-radius: 0;
    box-shadow: none;
    border: none;
  }
  h1, h2, h3, h4 { page-break-after: avoid; }
  pre, blockquote, table { page-break-inside: avoid; }
  a { color: #000; border-bottom: none; }
  a[href^="#"]::after { content: ""; }
  .speaker-note { background: #f4f4f4; }
}
`;
