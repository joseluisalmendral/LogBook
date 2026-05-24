/*
 * editor-pref store — slice 18 editor URI picker.
 *
 * Persists the user's preferred local editor in localStorage so deep-link
 * chips (`FileChangeStrip`, linkified tool inputs, transcript anchors) open
 * files in the editor of their choice. Slice 12 P3 hardcoded vscode://;
 * this store unblocks Cursor / Zed / IntelliJ users without forking the UI.
 *
 * Storage key: `lb.editorScheme`. Survives page reloads on file:// exports
 * because localStorage is per-origin and `file://` is a stable origin.
 * SSR-safe: `typeof window` guard on every touch of localStorage.
 *
 * The chosen scheme is read by `buildFileUri()` in `util/deep-link.ts`.
 */

const STORAGE_KEY = "lb.editorScheme";

export type EditorScheme = "vscode" | "cursor" | "zed" | "intellij";

export const EDITOR_OPTIONS: ReadonlyArray<{
  value: EditorScheme;
  label: string;
  hint: string;
}> = [
  { value: "vscode", label: "VS Code", hint: "vscode://file/" },
  { value: "cursor", label: "Cursor", hint: "cursor://file/" },
  { value: "zed", label: "Zed", hint: "zed://file/" },
  { value: "intellij", label: "IntelliJ", hint: "idea://open?file=" },
];

const DEFAULT: EditorScheme = "vscode";

function readFromStorage(): EditorScheme {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (
      raw === "vscode" ||
      raw === "cursor" ||
      raw === "zed" ||
      raw === "intellij"
    ) {
      return raw;
    }
  } catch {
    // localStorage blocked (private mode, etc.) — fall through to default.
  }
  return DEFAULT;
}

let current: EditorScheme = readFromStorage();
type Listener = (scheme: EditorScheme) => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(current);
}

export const editorPref = {
  get(): EditorScheme {
    return current;
  },
  set(scheme: EditorScheme): void {
    if (scheme === current) return;
    current = scheme;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, scheme);
      } catch {
        // Storage failure is non-fatal — the pick still works this session.
      }
    }
    notify();
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(current);
    return () => {
      listeners.delete(fn);
    };
  },
};
