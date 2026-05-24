/**
 * teaching-prefs.ts — Slice 25 polish.
 *
 * Three boolean preferences that change how content is displayed without
 * re-exporting:
 *   - pathBlur: blur absolute filesystem paths in tool inputs/file_paths/
 *     outputs. Use when presenting the export in a course so sensitive
 *     local paths (e.g. /Users/<name>/Documents/CLIENTES/...) don't leak.
 *   - zen: hide sidebar / scrubber / chrome and center the conversation.
 *     Used during live presentations.
 *   - showThinking: render Claude's thinking blocks as muted inline cards.
 *     Default off because thinking expands chapters considerably.
 *
 * Persisted to localStorage under `lb.prefs.teaching` so toggles survive
 * page reloads. Falls back gracefully when localStorage is unavailable.
 */

interface TeachingPrefs {
  pathBlur: boolean;
  zen: boolean;
  showThinking: boolean;
}

const STORAGE_KEY = "lb.prefs.teaching";

const DEFAULTS: TeachingPrefs = {
  pathBlur: false,
  zen: false,
  showThinking: false,
};

function readPrefs(): TeachingPrefs {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<TeachingPrefs>;
    return {
      pathBlur: typeof parsed.pathBlur === "boolean" ? parsed.pathBlur : DEFAULTS.pathBlur,
      zen: typeof parsed.zen === "boolean" ? parsed.zen : DEFAULTS.zen,
      showThinking:
        typeof parsed.showThinking === "boolean" ? parsed.showThinking : DEFAULTS.showThinking,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function writePrefs(prefs: TeachingPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable (private window, quota) — ignore.
  }
}

type Listener = (snap: TeachingPrefs) => void;

let snapshot: TeachingPrefs = readPrefs();
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l(snapshot);
}

/**
 * Apply the side-effect bindings of the current prefs snapshot:
 *   - data-zen on <html> so global CSS can hide / restructure chrome.
 *   - data-path-blur on <html> so CSS rules toggle blur of path tokens.
 *   - data-show-thinking on <html> so thinking blocks render or stay hidden.
 *
 * Pure DOM mutation; no Svelte reactivity needed because the body of the
 * export is rendered conditionally via the stores' subscribers below.
 */
function applyDom(snap: TeachingPrefs): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-zen", snap.zen ? "true" : "false");
  root.setAttribute("data-path-blur", snap.pathBlur ? "true" : "false");
  root.setAttribute("data-show-thinking", snap.showThinking ? "true" : "false");
}

// Hydrate DOM attributes immediately so the first paint already reflects
// the stored preferences. (No-op under SSR.)
applyDom(snapshot);

function update(partial: Partial<TeachingPrefs>): void {
  snapshot = { ...snapshot, ...partial };
  writePrefs(snapshot);
  applyDom(snapshot);
  emit();
}

export const teachingPrefs = {
  /** Read the current snapshot synchronously. */
  get(): TeachingPrefs {
    return snapshot;
  },
  /** Subscribe to changes; returns unsubscribe. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(snapshot);
    return () => {
      listeners.delete(fn);
    };
  },
  toggleZen(): void {
    update({ zen: !snapshot.zen });
  },
  setZen(value: boolean): void {
    update({ zen: value });
  },
  togglePathBlur(): void {
    update({ pathBlur: !snapshot.pathBlur });
  },
  setPathBlur(value: boolean): void {
    update({ pathBlur: value });
  },
  toggleShowThinking(): void {
    update({ showThinking: !snapshot.showThinking });
  },
  setShowThinking(value: boolean): void {
    update({ showThinking: value });
  },
};

/**
 * Helper: wrap absolute-looking path tokens in <span class="lb-path">…</span>
 * so the CSS `[data-path-blur="true"] .lb-path { filter: blur(4px); }` rule
 * can blur them. We MUST emit the HTML at build/render time because Svelte
 * cannot reactively re-wrap text already inside the DOM under `{text}`.
 *
 * The regex matches:
 *   - POSIX-ish absolute paths: starts with `/`, contains at least one
 *     non-space segment, and has at least 2 segments (so we don't match
 *     bare slashes).
 *   - Windows paths: `C:\Users\...` or `C:/Users/...`.
 *
 * Paths inside backticks/code blocks are still matched (the wrapping span
 * does not break copy-paste — it's transparent at the text level).
 *
 * Slice-27 refinement: when `projectRoot` is supplied, we only blur the
 * portion BEFORE the project root basename. The repo name and everything
 * inside it (apps/viewer/src/...) stays readable so the audience can still
 * follow what file Claude touched — the speaker's local directory layout
 * is the only thing hidden.
 *
 * Examples (project root = `/Users/me/Documents/CLIENTS/repo-name`):
 *   `/Users/me/Documents/CLIENTS/repo-name/src/foo.ts`
 *     → <span lb-path>/Users/me/Documents/CLIENTS/</span>repo-name/src/foo.ts
 *
 *   `/Users/me/Documents/CLIENTS/another-repo/file.txt`
 *     → <span lb-path>/Users/me/Documents/CLIENTS/another-repo/file.txt</span>
 *       (does not match the configured repo — blur the whole thing)
 *
 *   `/tmp/something`
 *     → <span lb-path>/tmp/something</span> (no project root match)
 */
const PATH_RE =
  /(\/(?:[\w.\-@]+)(?:\/[\w.\-@%+~]+){1,})|([A-Za-z]:[\\/](?:[\w.\-@]+[\\/]?){1,})/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Extract the project root from the payload data store. Called lazily by
 * `wrapPathsForBlur` so the helper stays a pure function from the caller's
 * perspective. Returns "" if data isn't loaded yet (SSR / very early frames).
 */
function readProjectRoot(): string {
  if (typeof window === "undefined") return "";
  try {
    const lb = (window as unknown as { __LB_PROJECT_ROOT__?: string }).__LB_PROJECT_ROOT__;
    if (typeof lb === "string") return lb;
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * Set the project root once (called by the data store on hydration). Cached
 * on `window` so `wrapPathsForBlur` reads it without taking a parameter
 * from every call site.
 */
export function setProjectRoot(root: string): void {
  if (typeof window === "undefined") return;
  (window as unknown as { __LB_PROJECT_ROOT__: string }).__LB_PROJECT_ROOT__ = root;
}

export function wrapPathsForBlur(text: string): string {
  const escaped = escapeHtml(text);
  const projectRoot = readProjectRoot();

  if (!projectRoot) {
    // No project root context — blur the entire path (legacy behaviour).
    return escaped.replace(PATH_RE, (m) => `<span class="lb-path">${m}</span>`);
  }

  // Compute the prefix to blur: the parent directory of the project root
  // (i.e. everything up to and INCLUDING the trailing slash before the
  // project basename). The repo basename + everything after it stays
  // readable.
  //
  // Example: projectRoot = `/Users/me/Documents/CLIENTS/repo`
  //          blurPrefix  = `/Users/me/Documents/CLIENTS/`
  //          repoBase    = `repo`
  //
  // We HTML-escape the prefix before using it in a regex so any special
  // characters in real paths don't blow up the literal match. The repo
  // basename is appended verbatim.
  const lastSlash = projectRoot.lastIndexOf("/");
  const blurPrefix = lastSlash >= 0 ? projectRoot.slice(0, lastSlash + 1) : projectRoot;
  // Escape for HTML (same as the input text) so substring search aligns
  // with the post-escape token strings.
  const escapedPrefix = escapeHtml(blurPrefix);

  return escaped.replace(PATH_RE, (match) => {
    // Path starts with the project-parent prefix → split: blur the prefix,
    // leave the rest visible.
    if (match.startsWith(escapedPrefix)) {
      const tail = match.slice(escapedPrefix.length);
      return `<span class="lb-path">${escapedPrefix}</span>${tail}`;
    }
    // Otherwise this is an external path (e.g. /tmp, ~/.claude, another
    // repo) — blur the whole thing.
    return `<span class="lb-path">${match}</span>`;
  });
}
