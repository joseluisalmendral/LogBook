/*
 * router store — hash-based routing for the file:// export.
 *
 * Spec R-17: hash-routed multi-page with chapterId in the hash only. No
 * history API (file:// safe; the export must work offline from disk).
 *
 * Route shape:
 *   #/                       → { name: "toc" }
 *   #/chapter/<sessionId>    → { name: "chapter", chapterId: <sessionId> }
 *
 * Anything else (empty, unrecognized) falls back to the TOC route. We keep
 * the grammar tiny so a URL pasted by a teacher into chat opens predictably.
 *
 * Sort mode, theme, inspector state are NOT in the hash — pure UI state per
 * Q2 + design §3.
 */

export type Route =
  | { name: "toc" }
  | { name: "chapter"; chapterId: string };

type Listener = (route: Route) => void;

function parseHash(hash: string): Route {
  // window.location.hash includes the leading "#". Strip it before matching.
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (h === "" || h === "/" || h === "#") return { name: "toc" };

  const match = /^\/?chapter\/([^/?]+)/.exec(h);
  if (match) {
    return { name: "chapter", chapterId: decodeURIComponent(match[1]!) };
  }
  return { name: "toc" };
}

function routeToHash(route: Route): string {
  switch (route.name) {
    case "toc":
      return "#/";
    case "chapter":
      return `#/chapter/${encodeURIComponent(route.chapterId)}`;
  }
}

function readInitial(): Route {
  if (typeof window === "undefined") return { name: "toc" };
  return parseHash(window.location.hash);
}

let current: Route = readInitial();
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(current);
}

let attached = false;

function attachOnce(): void {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener("hashchange", () => {
    const next = parseHash(window.location.hash);
    if (next.name !== current.name || (next.name === "chapter" && current.name === "chapter" && next.chapterId !== current.chapterId)) {
      current = next;
      notify();
    }
  });
}

attachOnce();

export const router = {
  get(): Route {
    return current;
  },

  /** Navigate by mutating the hash. Triggers the listener via hashchange. */
  navigate(route: Route): void {
    if (typeof window === "undefined") {
      // Test environment without a window — still update internal state so
      // subscribers can verify navigation intent.
      current = route;
      notify();
      return;
    }
    const target = routeToHash(route);
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(current);
    return () => {
      listeners.delete(fn);
    };
  },

  // Exported for tests — pure helpers without side effects.
  _parseHash: parseHash,
  _routeToHash: routeToHash,
};
