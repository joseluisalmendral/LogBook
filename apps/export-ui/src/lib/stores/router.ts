/*
 * router store — hash-based routing for the file:// export.
 *
 * Spec R-17 (slice 10): hash-routed multi-page with chapterId in the hash
 * only. No history API (file:// safe; the export must work offline from disk).
 *
 * Slice 12 P5 extension (R-65 + ADR-SC-D3):
 *   New `transcript` route + optional `?event=<id>` query suffix on BOTH the
 *   chapter and transcript routes. The query carries the bidirectional link
 *   selection (active raw row / active card). Parsing is permissive: missing
 *   query → eventId null; malformed query → eventId null.
 *
 * Route shape (slice 12):
 *   #/                                 → { name: "toc" }
 *   #/chapter/<sessionId>              → { name: "chapter", chapterId, eventId: null }
 *   #/chapter/<sessionId>?event=<id>   → { name: "chapter", chapterId, eventId: <id> }
 *   #/transcript/<sessionId>           → { name: "transcript", sessionId, eventId: null }
 *   #/transcript/<sessionId>?event=<id> → { name: "transcript", sessionId, eventId: <id> }
 *
 * Anything else (empty, unrecognized) falls back to the TOC route.
 *
 * Sort mode, theme, inspector state are NOT in the hash — pure UI state per
 * Q2 + design §3. The selection slot lives in selection.ts but mirrors the URL
 * via `_setFromRoute` on every hashchange (URL is the source of truth).
 */

import { selection } from "./selection";
import { getMotionState } from "./motion";

export type Route =
  | { name: "toc" }
  | { name: "chapter"; chapterId: string; eventId: string | null }
  | { name: "transcript"; sessionId: string; eventId: string | null };

type Listener = (route: Route) => void;

function parseEventQuery(query: string): string | null {
  // query is the part AFTER `?` (without the leading `?`). Format: a=b&c=d.
  if (!query) return null;
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    if (key === "event") {
      const raw = pair.slice(eq + 1);
      if (!raw) return null;
      try {
        return decodeURIComponent(raw);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parseHash(hash: string): Route {
  // window.location.hash includes the leading "#". Strip it before matching.
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (h === "" || h === "/" || h === "#") return { name: "toc" };

  // Split into path + query at the first `?`.
  const qIdx = h.indexOf("?");
  const path = qIdx >= 0 ? h.slice(0, qIdx) : h;
  const query = qIdx >= 0 ? h.slice(qIdx + 1) : "";
  const eventId = parseEventQuery(query);

  const chapterMatch = /^\/?chapter\/([^/?]+)/.exec(path);
  if (chapterMatch) {
    return {
      name: "chapter",
      chapterId: decodeURIComponent(chapterMatch[1]!),
      eventId,
    };
  }

  const transcriptMatch = /^\/?transcript\/([^/?]+)/.exec(path);
  if (transcriptMatch) {
    return {
      name: "transcript",
      sessionId: decodeURIComponent(transcriptMatch[1]!),
      eventId,
    };
  }
  return { name: "toc" };
}

function routeToHash(route: Route): string {
  switch (route.name) {
    case "toc":
      return "#/";
    case "chapter": {
      const base = `#/chapter/${encodeURIComponent(route.chapterId)}`;
      return route.eventId
        ? `${base}?event=${encodeURIComponent(route.eventId)}`
        : base;
    }
    case "transcript": {
      const base = `#/transcript/${encodeURIComponent(route.sessionId)}`;
      return route.eventId
        ? `${base}?event=${encodeURIComponent(route.eventId)}`
        : base;
    }
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

function syncSelectionFromRoute(r: Route): void {
  // Mirror the URL into the selection store. URL-then-store: back button stays
  // honest (the browser flips the hash, the listener runs, the store updates).
  if (r.name === "chapter") {
    selection._setFromRoute("chapter", r.eventId);
  } else if (r.name === "transcript") {
    selection._setFromRoute("transcript", r.eventId);
  } else {
    selection.clear();
  }
}

function routesEqual(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  if (a.name === "toc" && b.name === "toc") return true;
  if (a.name === "chapter" && b.name === "chapter") {
    return a.chapterId === b.chapterId && a.eventId === b.eventId;
  }
  if (a.name === "transcript" && b.name === "transcript") {
    return a.sessionId === b.sessionId && a.eventId === b.eventId;
  }
  return false;
}

let attached = false;

function attachOnce(): void {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener("hashchange", () => {
    const next = parseHash(window.location.hash);
    if (!routesEqual(next, current)) {
      current = next;
      syncSelectionFromRoute(current);
      notify();
    }
  });
  // Initial sync (in case the page loaded directly at #/chapter/...?event=...).
  syncSelectionFromRoute(current);
}

attachOnce();

export const router = {
  get(): Route {
    return current;
  },

  /**
   * Navigate by mutating the hash. Triggers the listener via hashchange.
   *
   * Slice-18 motion polish (G1): when the View Transitions API is available
   * AND motion is allowed AND we're moving between toc ↔ chapter (the two
   * routes that share a `view-transition-name` element via SessionTile and
   * ChapterHeader), wrap the hash change in `document.startViewTransition`
   * so the shared header morphs smoothly. Reduced-motion users + browsers
   * without the API skip the wrapper.
   */
  navigate(route: Route): void {
    if (typeof window === "undefined") {
      // Test environment without a window — still update internal state so
      // subscribers can verify navigation intent.
      current = route;
      syncSelectionFromRoute(current);
      notify();
      return;
    }
    const target = routeToHash(route);
    if (window.location.hash === target) return;

    const motion = getMotionState();
    const doc = document as Document & {
      startViewTransition?: (cb: () => void | Promise<void>) => unknown;
    };
    const startVT = doc.startViewTransition;
    const shouldMorph =
      motion.motionAllowed &&
      typeof startVT === "function" &&
      (current.name === "toc" || route.name === "toc");

    if (shouldMorph) {
      startVT.call(doc, () => {
        window.location.hash = target;
      });
    } else {
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
