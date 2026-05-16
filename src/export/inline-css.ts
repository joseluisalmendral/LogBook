/**
 * Inline CSS constant for HTML export (T12).
 *
 * Decision T12.D1: The CSS is embedded as a string constant here rather than
 * loaded from assets/export/styles.css at runtime. This avoids bundle-time
 * asset resolution complexity (CJS __dirname vs ESM import.meta.url vs tsup
 * output layout). The CSS is small (~30 lines) so embedding is acceptable.
 *
 * Synchronization contract: tests/unit/inline-css-sync.test.ts asserts that
 * this constant is byte-identical to assets/export/styles.css. Any change to
 * the CSS must be applied to BOTH files.
 *
 * No external fonts, no CDN references, no http(s) URLs.
 */

export const INLINE_CSS =
  `body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;\n` +
  `       max-width: 800px; margin: 2rem auto; padding: 0 1rem;\n` +
  `       color: #1a1a1a; line-height: 1.6; }\n` +
  `h1, h2, h3 { color: #0a0a0a; margin-top: 2rem; }\n` +
  `code { background: #f4f4f4; padding: 0.15em 0.3em; border-radius: 3px;\n` +
  `       font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.9em; }\n` +
  `pre { background: #f4f4f4; padding: 1rem; border-radius: 6px; overflow-x: auto; }\n` +
  `pre code { background: transparent; padding: 0; }\n` +
  `table { border-collapse: collapse; width: 100%; margin: 1rem 0; }\n` +
  `th, td { border: 1px solid #d0d0d0; padding: 0.5rem; text-align: left; }\n` +
  `th { background: #f8f8f8; }\n` +
  `blockquote { border-left: 3px solid #d0d0d0; margin: 1rem 0; padding: 0.25rem 1rem;\n` +
  `             color: #555; }\n` +
  `hr { border: none; border-top: 1px solid #e0e0e0; margin: 2rem 0; }\n` +
  `@media print { body { max-width: none; margin: 0; } }\n`;
