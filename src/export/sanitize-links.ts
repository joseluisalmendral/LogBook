/**
 * HTML external-reference sanitizer (T12).
 *
 * Hard contract: the generated HTML must have ZERO external references,
 * except URLs from the host allowlist (ADR-20). Scripts/stylesheets/iframes
 * are NEVER allowlisted — only navigation href URLs can pass the allowlist.
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
 *
 * ADR-20: allowlist of trusted git hosting providers.
 * Exact hostname match (not substring) — defeats github.com.attacker.com spoofing.
 * HTTPS only — blocks http:// downgrade attacks.
 */

// ---------------------------------------------------------------------------
// Allowlist — ADR-20
// ---------------------------------------------------------------------------

/**
 * Exact-match set of allowed git hosting hostnames.
 * Match is ALWAYS exact (new URL().hostname.toLowerCase()) — never substring.
 * Only https:// protocol is accepted.
 */
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
]);

/**
 * URLs that may appear as STRING LITERALS inside the vendored Svelte 5 bundle.
 * These are NOT fetched by the browser — Svelte 5's compiled output embeds
 * documentation pointers (e.g. `https://svelte.dev/e/<error-code>`) so that
 * runtime error messages can link out IF a developer copy-pastes them. They
 * never reach the network in normal operation. Browsers don't auto-fetch
 * arbitrary text content of inline scripts.
 *
 * Same fail-closed contract as ALLOWED_HOSTS: exact protocol + hostname +
 * path-prefix match. Any other svelte.dev path is still rejected.
 */
const SVELTE_DOC_URL_PREFIXES: readonly string[] = [
  "https://svelte.dev/e/",
];

/**
 * Canonical XML namespace URIs that appear in inline SVG / MathML markup
 * shipped by the Svelte runtime. These are namespace IDENTIFIERS — never
 * fetched by the browser. Both http: and https: forms are accepted because
 * the W3C namespace URIs are canonical http:// strings; upgrading them to
 * https:// would change the namespace identity.
 */
const XML_NAMESPACE_URIS: ReadonlySet<string> = new Set([
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/XML/1998/namespace",
  "http://www.w3.org/1998/Math/MathML",
]);

/** Strip URL-trailing punctuation that markdown/HTML output sometimes glues on. */
function stripUrlTrailingPunct(raw: string): string {
  return raw.replace(/[).,;:!?]+$/, "");
}

/** True for canonical XML namespace URIs (xmlns / xlink / etc.). */
export function isXmlNamespaceUri(raw: string): boolean {
  return XML_NAMESPACE_URIS.has(stripUrlTrailingPunct(raw));
}

/** True for the Svelte 5 runtime error-link prefix (string-literal only, never fetched). */
export function isSvelteDocUri(raw: string): boolean {
  const cleaned = stripUrlTrailingPunct(raw);
  return SVELTE_DOC_URL_PREFIXES.some((p) => cleaned.startsWith(p));
}

/**
 * Return true if `raw` is an HTTPS URL whose hostname is exactly in ALLOWED_HOSTS.
 *
 * Strips trailing punctuation that glues to URLs in markdown/HTML output
 * (e.g. ")" from "(https://github.com/foo)") before parsing.
 *
 * Security notes:
 *   - `new URL().hostname` returns the raw host portion without port.
 *     "github.com.attacker.com" → hostname = "github.com.attacker.com" → NOT in Set.
 *   - Only https: is accepted; http: is always blocked (downgrade risk).
 *   - Invalid URLs throw → caught → return false (fail-closed).
 */
export function isAllowlistedUrl(raw: string): boolean {
  const cleaned = raw.replace(/[).,;:!?]+$/, "");
  try {
    const u = new URL(cleaned);
    if (u.protocol !== "https:") return false;
    return ALLOWED_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

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

/** Return value of assertNoExternalRefs on the success path. */
export interface ExternalRefsResult {
  /** Count of BLOCKED (non-allowlisted) external references (always 0 on success path). */
  externalRefs: number;
  /** Count of allowlisted URLs that passed the allowlist check (ADR-20). */
  allowedRefs: number;
}

/**
 * Assert that the HTML has no external references outside the allowlist.
 * Throws an Error if any non-allowlisted external ref is detected, or if
 * scripts/stylesheets/iframes are present (these are NEVER allowlisted).
 *
 * Returns { externalRefs: 0, allowedRefs: N } on success.
 * `allowedRefs` counts URLs that matched the ALLOWED_HOSTS set (ADR-20).
 *
 * Used as the final gatekeeper in the exportHtml pipeline.
 * If this throws, the export is aborted (temp file is not renamed to outFile).
 *
 * ADR-20: allowlist relaxes the previously strict no-URL policy for git
 * hosting providers. Scripts/stylesheets/iframes remain unconditionally blocked.
 */
export function assertNoExternalRefs(html: string): ExternalRefsResult {
  const report = sanitizeReport(html);

  const blocked: string[] = [];
  let allowedRefs = 0;

  // Partition URLs into allowed vs blocked. The allowlist covers:
  //   - Git hosting (ADR-20, ALLOWED_HOSTS): URLs students may click in commit refs.
  //   - XML namespace URIs (xmlns / xlink / MathML): namespace IDENTIFIERS,
  //     never fetched by the browser.
  //   - Svelte 5 runtime doc URLs (svelte.dev/e/*): string literals embedded
  //     in error templates inside the vendored UI bundle (P5, AG-2).
  for (const url of report.externalUrls) {
    if (isAllowlistedUrl(url) || isXmlNamespaceUri(url) || isSvelteDocUri(url)) {
      allowedRefs++;
    } else {
      blocked.push(url);
    }
  }

  const violations: string[] = [];

  if (blocked.length > 0) {
    const blockedSamples = blocked.slice(0, 5);
    violations.push(
      `External URLs found (${blocked.length}): ${blockedSamples.join(", ")}`
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

  return { externalRefs: 0, allowedRefs };
}
