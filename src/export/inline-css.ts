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
:root {
  --lb-bg: #ffffff;
  --lb-fg: #1c2024;
  --lb-fg-muted: #6b7280;
  --lb-border: #e5e7eb;
  --lb-border-strong: #d1d5db;
  --lb-code-bg: #f6f8fa;
  --lb-code-fg: #24292f;
  --lb-accent: #0969da;
  --lb-accent-hover: #0550ae;
  --lb-blockquote-fg: #57606a;
  --lb-table-stripe: #f9fafb;
  --lb-callout-bg: #fffbeb;
  --lb-callout-border: #f59e0b;
  --lb-radius-sm: 4px;
  --lb-radius-md: 6px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --lb-bg: #0d1117;
    --lb-fg: #e6edf3;
    --lb-fg-muted: #8b949e;
    --lb-border: #30363d;
    --lb-border-strong: #444c56;
    --lb-code-bg: #161b22;
    --lb-code-fg: #e6edf3;
    --lb-accent: #58a6ff;
    --lb-accent-hover: #79b8ff;
    --lb-blockquote-fg: #8b949e;
    --lb-table-stripe: #161b22;
    --lb-callout-bg: #1c1a0e;
    --lb-callout-border: #d4a72c;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui,
    "Helvetica Neue", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.65;
  color: var(--lb-fg);
  background: var(--lb-bg);
  max-width: 820px;
  margin: 2.5rem auto;
  padding: 0 1.5rem 4rem;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
h1, h2, h3, h4, h5, h6 {
  color: var(--lb-fg);
  line-height: 1.25;
  font-weight: 600;
  margin: 2rem 0 1rem;
  letter-spacing: -0.01em;
}
h1 {
  font-size: 2rem;
  margin-top: 0;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--lb-border);
}
h2 {
  font-size: 1.5rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--lb-border);
}
h3 { font-size: 1.25rem; }
h4 { font-size: 1rem; }
h5 { font-size: 0.9rem; color: var(--lb-fg-muted); }
h6 {
  font-size: 0.85rem;
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
code {
  font-family: ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas,
    "Liberation Mono", monospace;
  font-size: 0.875em;
  background: var(--lb-code-bg);
  color: var(--lb-code-fg);
  padding: 0.15em 0.4em;
  border-radius: var(--lb-radius-sm);
  border: 1px solid var(--lb-border);
}
pre {
  background: var(--lb-code-bg);
  color: var(--lb-code-fg);
  padding: 1rem 1.25rem;
  border-radius: var(--lb-radius-md);
  border: 1px solid var(--lb-border);
  overflow-x: auto;
  font-size: 0.875em;
  line-height: 1.5;
  margin: 1rem 0;
}
pre code {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 1em;
  color: inherit;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1.25rem 0;
  font-size: 0.95em;
  display: block;
  overflow-x: auto;
}
@media (min-width: 640px) {
  table { display: table; }
}
thead { background: var(--lb-code-bg); }
th, td {
  border: 1px solid var(--lb-border);
  padding: 0.6rem 0.85rem;
  text-align: left;
  vertical-align: top;
}
th {
  font-weight: 600;
  color: var(--lb-fg);
}
tbody tr:nth-child(even) { background: var(--lb-table-stripe); }
blockquote {
  border-left: 4px solid var(--lb-border-strong);
  margin: 1.25rem 0;
  padding: 0.5rem 1.25rem;
  color: var(--lb-blockquote-fg);
  background: var(--lb-code-bg);
  border-radius: 0 var(--lb-radius-sm) var(--lb-radius-sm) 0;
}
blockquote p:first-child { margin-top: 0; }
blockquote p:last-child { margin-bottom: 0; }
hr {
  border: none;
  border-top: 1px solid var(--lb-border);
  margin: 2.5rem 0;
}
img, svg { max-width: 100%; height: auto; }
.speaker-note {
  background: var(--lb-callout-bg);
  border-left: 4px solid var(--lb-callout-border);
  padding: 0.75rem 1rem;
  margin: 1rem 0;
  font-style: italic;
  border-radius: 0 var(--lb-radius-sm) var(--lb-radius-sm) 0;
}
@media (max-width: 640px) {
  body {
    font-size: 15px;
    margin: 1rem auto;
    padding: 0 1rem 2rem;
  }
  h1 { font-size: 1.6rem; }
  h2 { font-size: 1.3rem; }
  pre { padding: 0.75rem 1rem; font-size: 0.8em; }
  th, td { padding: 0.4rem 0.6rem; font-size: 0.85em; }
}
@media print {
  body {
    max-width: none;
    margin: 0;
    padding: 1cm;
    font-size: 11pt;
    color: #000;
    background: #fff;
  }
  h1, h2, h3, h4 { page-break-after: avoid; }
  pre, blockquote, table { page-break-inside: avoid; }
  a { color: #000; border-bottom: none; }
  a[href^="#"]::after { content: ""; }
  .speaker-note { background: #f4f4f4; }
}
`;
