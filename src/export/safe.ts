/**
 * Safe-export redaction module (T7).
 *
 * Provides sanitizeForSafeExport — a pure string-in/string-out function that
 * redacts sensitive content before the markdown is passed to the rehype
 * unified pipeline.
 *
 * Redaction order:
 *   1. Emails — replaced with <email>
 *   2. Unix absolute paths (/Users/<n>/…, /home/<n>/…) — replaced with <path>/…
 *   3. Windows absolute paths (C:\Users\<n>\…) — replaced with <path>\…
 *   4. Usernames (extracted from path matches) — replaced with <user>
 *   5. Timestamps (opt-in) — RFC3339 time portion stripped to date only
 *
 * Known edge case:
 *   Username redaction is best-effort. The implementation extracts the
 *   username from /Users/<n>/ and /home/<n>/ path occurrences found within
 *   the same content string and then replaces every occurrence of that
 *   literal token. Usernames that are also common English words (e.g.
 *   "root", "home", "user") will be replaced wherever they appear in the
 *   document — not only inside path strings. This is documented behaviour and
 *   is acceptable for a safety-oriented opt-in flag.
 *
 * Design §8 — export --safe details.
 * Pipeline position: safe sanitize → markdown concat → rehype → inline CSS → sanitize-links.
 */

/** Options controlling which redaction passes run. */
export interface SafeExportOptions {
  /** Replace absolute filesystem paths. Default: true. */
  redactPaths?: boolean;
  /** Replace extracted usernames. Default: true. Requires redactPaths=true to be effective. */
  redactUsers?: boolean;
  /** Replace email addresses. Default: true. */
  redactEmails?: boolean;
  /** Strip sub-day precision from RFC3339 timestamps. Default: false. */
  redactTimes?: boolean;
}

// ---------------------------------------------------------------------------
// Regex constants
// ---------------------------------------------------------------------------

/** Standard email pattern. Matches local@domain.tld. */
const RE_EMAIL = /\b[\w.-]+@[\w.-]+\.\w+\b/g;

/**
 * Unix /Users/<name>/rest — captures <name> in group 1, rest in group 2.
 * rest may be empty (bare /Users/alice with no trailing slash).
 */
const RE_UNIX_USERS_PATH = /\/Users\/([^/\s]+)((?:\/[^\s]*)?)/g;

/**
 * Unix /home/<name>/rest — captures <name> in group 1, rest in group 2.
 */
const RE_UNIX_HOME_PATH = /\/home\/([^/\s]+)((?:\/[^\s]*)?)/g;

/**
 * Windows C:\Users\<name>\rest — captures <name> in group 1, rest in group 2.
 * Handles both forward and back slashes in the rest portion.
 */
const RE_WIN_USERS_PATH = /[A-Za-z]:\\Users\\([^\\\s]+)((?:\\[^\s]*)?)/g;

/**
 * RFC3339 time component: T followed by HH:MM:SS (with optional fractional
 * seconds and optional Z or offset).
 * Replaces the T… portion, leaving only the date prefix.
 */
const RE_RFC3339_TIME = /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g;

// ---------------------------------------------------------------------------
// Redaction token constants
// ---------------------------------------------------------------------------

/**
 * Redaction tokens use HTML entity encoding so that angle brackets survive
 * the remark/rehype markdown pipeline.
 *
 * When markdown containing `&lt;path&gt;` is processed by unified:
 *   - remark-parse: treats it as HTML-entity text (not an HTML tag)
 *   - rehype-stringify: outputs `&lt;path&gt;` in the HTML body
 *   - Browser: renders it as visible `<path>` text
 *
 * If we used bare `<path>` tokens, remark-parse would interpret `<path>` as
 * an inline HTML tag and rehype would strip or misrender it.
 */
const TOKEN_PATH = "&lt;path&gt;";
const TOKEN_USER = "&lt;user&gt;";
const TOKEN_EMAIL = "&lt;email&gt;";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize content for safe export by redacting sensitive strings.
 *
 * All options default to the values described in SafeExportOptions.
 * The function is pure: no I/O, no side effects, returns a new string.
 *
 * Redaction tokens in the returned string use HTML entity encoding
 * (&lt;path&gt;, &lt;email&gt;, &lt;user&gt;) so that they survive the
 * markdown-to-HTML pipeline and render correctly in the browser.
 *
 * @param content  Raw markdown (or any text) to sanitize.
 * @param opts     Redaction options (all default to true except redactTimes).
 * @returns        The sanitized string with HTML-entity-encoded tokens.
 */
export function sanitizeForSafeExport(
  content: string,
  opts?: SafeExportOptions,
): string {
  const redactPaths = opts?.redactPaths ?? true;
  const redactUsers = opts?.redactUsers ?? true;
  const redactEmails = opts?.redactEmails ?? true;
  const redactTimes = opts?.redactTimes ?? false;

  let result = content;

  // Step 1: Emails — run before paths so that an email inside a path string
  // (rare but possible) is caught by the email rule first.
  if (redactEmails) {
    result = result.replace(RE_EMAIL, TOKEN_EMAIL);
  }

  // Step 2 & 3: Absolute paths — collect usernames while replacing.
  const extractedUsernames = new Set<string>();

  if (redactPaths) {
    // Unix /Users/<name>/…
    result = result.replace(RE_UNIX_USERS_PATH, (_match, username: string, rest: string) => {
      extractedUsernames.add(username);
      // Keep the file/directory part after the user home, prefixed with token
      return `${TOKEN_PATH}${rest}`;
    });

    // Unix /home/<name>/…
    result = result.replace(RE_UNIX_HOME_PATH, (_match, username: string, rest: string) => {
      extractedUsernames.add(username);
      return `${TOKEN_PATH}${rest}`;
    });

    // Windows C:\Users\<name>\…
    result = result.replace(RE_WIN_USERS_PATH, (_match, username: string, rest: string) => {
      extractedUsernames.add(username);
      return `${TOKEN_PATH}${rest}`;
    });
  }

  // Step 4: Usernames — replace every occurrence of each extracted username
  // as a whole-word token. Best-effort; see module docstring for edge cases.
  if (redactUsers && extractedUsernames.size > 0) {
    for (const username of extractedUsernames) {
      // Escape any regex special chars in the username
      const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "g");
      result = result.replace(re, TOKEN_USER);
    }
  }

  // Step 5: Timestamps (opt-in)
  if (redactTimes) {
    result = result.replace(RE_RFC3339_TIME, "");
  }

  return result;
}
