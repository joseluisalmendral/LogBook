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
 */
const PATH_RE =
  /(\/(?:[\w.\-@]+)(?:\/[\w.\-@%+~]+){1,})|([A-Za-z]:[\\/](?:[\w.\-@]+[\\/]?){1,})/g;

export function wrapPathsForBlur(text: string): string {
  // Escape HTML chars first so we can interpolate spans safely.
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(PATH_RE, (m) => `<span class="lb-path">${m}</span>`);
}
