/**
 * HTML external-reference sanitizer (T12).
 *
 * Hard contract: the generated HTML must have ZERO external references.
 * This module provides regex-based detection and a throwing assertion.
 *
 * Patterns matched:
 *   - External URLs:    /\bhttps?:\/\/[^\s"'<>]+/g
 *   - Script with src:  /<script[^>]+src=/gi
 *   - Stylesheets:      /<link[^>]+rel=["']?stylesheet/gi
 *   - Iframes:          /<iframe[^>]/gi
 *
 * Note on CSS url() containing http(s) URLs: the URL pattern is conservative
 * and will match http(s) URLs appearing inside <style> blocks (e.g., inside
 * url()). This is intentional — the inline CSS we produce never references
 * external resources, so any match is a genuine violation.
 *
 * Note on markdown code blocks: content inside <code> elements is HTML-entity
 * encoded by rehype (e.g., `>` → `&gt;`). The URL regex matches literal
 * `https?://`, which does NOT match entity-encoded text. Code block URLs
 * therefore do NOT trigger the sanitizer.
 */

export interface SanitizeReport {
  externalUrls: string[];
  externalScripts: string[];
  externalStylesheets: string[];
  externalIframes: string[];
}

const PATTERN_EXTERNAL_URL = /\bhttps?:\/\/[^\s"'<>]+/g;
const PATTERN_SCRIPT_SRC = /<script[^>]+src=/gi;
const PATTERN_LINK_STYLESHEET = /<link[^>]+rel=["']?stylesheet/gi;
const PATTERN_IFRAME = /<iframe[^>]/gi;

/**
 * Scan HTML for external references and return a report.
 * Does not throw — callers that want an assertion should use assertNoExternalRefs.
 */
export function sanitizeReport(html: string): SanitizeReport {
  const externalUrls = html.match(PATTERN_EXTERNAL_URL) ?? [];
  const externalScripts = html.match(PATTERN_SCRIPT_SRC) ?? [];
  const externalStylesheets = html.match(PATTERN_LINK_STYLESHEET) ?? [];
  const externalIframes = html.match(PATTERN_IFRAME) ?? [];

  return {
    externalUrls: [...new Set(externalUrls)],
    externalScripts: [...new Set(externalScripts)],
    externalStylesheets: [...new Set(externalStylesheets)],
    externalIframes: [...new Set(externalIframes)],
  };
}

/**
 * Assert that the HTML has no external references.
 * Throws an Error if any external ref is detected.
 *
 * Used as the final gatekeeper in the exportHtml pipeline.
 * If this throws, the export is aborted (temp file is not renamed to outFile).
 */
export function assertNoExternalRefs(html: string): void {
  const report = sanitizeReport(html);

  const violations: string[] = [];

  if (report.externalUrls.length > 0) {
    violations.push(
      `External URLs found (${report.externalUrls.length}): ${report.externalUrls.slice(0, 3).join(", ")}`
    );
  }
  if (report.externalScripts.length > 0) {
    violations.push(
      `External scripts found (${report.externalScripts.length}): ${report.externalScripts.slice(0, 3).join(", ")}`
    );
  }
  if (report.externalStylesheets.length > 0) {
    violations.push(
      `External stylesheets found (${report.externalStylesheets.length}): ${report.externalStylesheets.slice(0, 3).join(", ")}`
    );
  }
  if (report.externalIframes.length > 0) {
    violations.push(
      `Iframe elements found (${report.externalIframes.length})`
    );
  }

  if (violations.length > 0) {
    throw new Error(
      `HTML export failed: external references detected (violates self-contained contract):\n` +
        violations.map((v) => `  - ${v}`).join("\n")
    );
  }
}
