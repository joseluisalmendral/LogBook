/*
 * selection.ts — bidirectional link backbone for slice 12 P5.
 *
 * Spec ADR-SC-D3 + R-68:
 *   The active event is selected SEPARATELY for the chapter view and the
 *   transcript view, but a single store carries both so cross-route navigation
 *   stays cheap and lock-step with the URL hash. The URL is the source of
 *   truth — the router writes the store on every hash change; subscribers
 *   read from the store and react.
 *
 * Shape:
 *   {
 *     chapterEventId   : RenderEvent.id selected inside `#/chapter/<sid>`
 *     transcriptEventId: SanitizedTranscriptEvent.id selected inside `#/transcript/<sid>`
 *   }
 *
 * Why two slots instead of one shared `activeEventId`?
 *   Sanitized transcript ids and RenderEvent ids do NOT overlap. P4 generates
 *   stable hash ids for transcript rows; the chapter side uses the
 *   build-derived RenderEvent.id. Keeping them separate prevents accidental
 *   cross-pollination — a transcript scroll-to-row never picks the wrong chapter
 *   card and vice versa.
 *
 * URL ↔ store contract (per ADR-SC-D3):
 *   - `#/chapter/<sid>?event=<id>`   → sets chapterEventId
 *   - `#/transcript/<sid>?event=<id>` → sets transcriptEventId
 *   - The router calls `selection._setFromRoute(...)` directly.
 *   - User actions (`selectChapterEvent`, `selectTranscriptEvent`) push a new
 *     URL hash (router.navigate) which then writes the store via the listener —
 *     URL-then-store, NEVER store-then-URL, so back-button works cleanly.
 */

type Listener = (snap: SelectionSnapshot) => void;

export interface SelectionSnapshot {
  chapterEventId: string | null;
  transcriptEventId: string | null;
}

let state: SelectionSnapshot = {
  chapterEventId: null,
  transcriptEventId: null,
};

const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(state);
}

function update(next: Partial<SelectionSnapshot>): void {
  const merged = { ...state, ...next };
  if (
    merged.chapterEventId === state.chapterEventId &&
    merged.transcriptEventId === state.transcriptEventId
  ) {
    return;
  }
  state = merged;
  notify();
}

export const selection = {
  get(): SelectionSnapshot {
    return state;
  },

  /**
   * Called by the router when the URL hash changes. NEVER call this from a
   * component — components go through router.navigate(...), which then ripples
   * back into here via the hashchange listener.
   *
   * `which` decides which slot the eventId lands in based on the route name.
   * Passing `null` clears the slot.
   */
  _setFromRoute(which: "chapter" | "transcript", eventId: string | null): void {
    if (which === "chapter") {
      update({ chapterEventId: eventId });
    } else {
      update({ transcriptEventId: eventId });
    }
  },

  /**
   * Clear both slots (e.g. user navigates back to TOC).
   */
  clear(): void {
    update({ chapterEventId: null, transcriptEventId: null });
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(state);
    return () => {
      listeners.delete(fn);
    };
  },
};
