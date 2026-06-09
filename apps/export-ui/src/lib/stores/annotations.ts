/*
 * annotations.ts — display-annotations Feature B.
 *
 * Per-event instructor annotations layered on top of the exported deck WITHOUT
 * re-exporting. Each annotation carries a free-text label, a user-chosen color
 * (from the Paper Brutalism palette), and a coarse tag (milestone / error /
 * interesting) distinct from the 8 machine-derived event kinds in LegendKey.
 *
 * Persisted to localStorage under `lb.annotations` as a JSON object keyed by
 * eventId. Survives reloads on file:// exports (localStorage is per-origin and
 * file:// is a stable origin). Per-origin only — annotations DO NOT travel when
 * the HTML file is shared to another machine (accepted non-goal, spec B-7).
 *
 * Plain custom store (module-level `let` + Set<Listener> + notify), mirroring
 * editor-pref.ts / teaching-prefs.ts EXACTLY so cross-component reactivity
 * (rings in ChapterPlayer + the BriefLegend in the scrubber + the Sidebar
 * count) flows through one shared subscription. NOT a runes store — runes only
 * live inside .svelte components, where they wrap this via $effect.
 *
 * SSR-safe (typeof window guard on every localStorage touch) and graceful when
 * storage is blocked (private mode): all writes are wrapped in try/catch and the
 * in-memory map keeps working for the session (spec B-8).
 */

export type AnnotationTag = "milestone" | "error" | "interesting";

export interface Annotation {
  eventId: string;
  /** Free-text instructor caption. */
  label: string;
  /** CSS color (a token reference like "var(--color-milestone)"). */
  color: string;
  tag: AnnotationTag;
}

export type AnnotationMap = Record<string, Annotation>;

const STORAGE_KEY = "lb.annotations";

/**
 * Tag metadata: default color (existing semantic tokens) + glyph (echoes the
 * LegendKey monograms so the visual language stays consistent). The tags are
 * intentionally distinct from the 8-kind legend taxonomy (ADR-DA-6).
 */
export const TAG_META: Record<
  AnnotationTag,
  { label: string; color: string; glyph: string }
> = {
  milestone: { label: "Milestone", color: "var(--color-milestone)", glyph: "★" }, // inkwell violet
  error: { label: "Error", color: "var(--color-error)", glyph: "✕" }, // brick-600
  interesting: { label: "Interesting", color: "var(--color-accent-primary)", glyph: "◆" }, // Claude Ember
};

/**
 * Color picker palette — Paper Brutalism 5-palette only (rule 6: paleta 5 +
 * grayscale). Each value is a token reference so light/dark themes resolve it.
 */
export const COLOR_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "var(--color-milestone)", label: "Inkwell" }, // --p-graphite-900
  { value: "var(--color-error)", label: "Brick" }, // --p-brick-600
  { value: "var(--color-accent-primary)", label: "Ember" }, // --p-claude-ember
  { value: "var(--p-teal-basin)", label: "Teal" },
  { value: "var(--p-glow-yellow)", label: "Glow" },
];

function isAnnotation(v: unknown): v is Annotation {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.eventId === "string" &&
    typeof a.label === "string" &&
    typeof a.color === "string" &&
    (a.tag === "milestone" || a.tag === "error" || a.tag === "interesting")
  );
}

function readFromStorage(): AnnotationMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: AnnotationMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isAnnotation(value)) out[key] = value;
    }
    return out;
  } catch {
    // localStorage blocked (private mode) or corrupt JSON — start empty.
    return {};
  }
}

// Read once at module eval. SSR-safe via the guard above.
let current: AnnotationMap = readFromStorage();

type Listener = (map: AnnotationMap) => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(current);
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage failure is non-fatal — annotations still work this session.
  }
}

export const annotations = {
  /** Read the full map synchronously. */
  get(): AnnotationMap {
    return current;
  },
  /** Read a single annotation by eventId, or undefined if none. */
  getOne(eventId: string): Annotation | undefined {
    return current[eventId];
  },
  /** Subscribe to changes; fires immediately with the current map. Returns unsubscribe. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(current);
    return () => {
      listeners.delete(fn);
    };
  },
  /** Upsert an annotation by eventId, persist, and notify. */
  set(annotation: Annotation): void {
    current = { ...current, [annotation.eventId]: annotation };
    persist();
    notify();
  },
  /** Remove a single annotation by eventId, persist, and notify. */
  remove(eventId: string): void {
    if (!(eventId in current)) return;
    const next = { ...current };
    delete next[eventId];
    current = next;
    persist();
    notify();
  },
  /**
   * Remove ALL annotations with zero residue: the localStorage key is removed
   * entirely (not set to "{}") so getItem returns null afterwards (spec B-5).
   */
  clearAll(): void {
    current = {};
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Non-fatal — the in-memory reset already cleared this session.
      }
    }
    notify();
  },
};

/**
 * activeLegendId — the eventId of the last BriefLegend row the instructor
 * clicked, so the row stays highlighted after the scroll-to jump.
 *
 * BriefLegend is mounted in TWO surfaces at once (the normal-mode
 * TimelineScrubber and the Zen-mode ZenLegendPanel). A shared module-level
 * store keeps BOTH instances in sync from a single subscription, mirroring the
 * plain-store pattern used by `annotations` above. In-memory only: highlighting
 * the last jump target is a transient affordance and does NOT need to survive a
 * reload (spec parity with the not-persisted scrubber legend view).
 */
type LegendIdListener = (id: string | null) => void;
let activeId: string | null = null;
const legendIdListeners = new Set<LegendIdListener>();

export const activeLegendId = {
  /** Read the current active id synchronously. */
  get(): string | null {
    return activeId;
  },
  /** Subscribe to changes; fires immediately with the current id. Returns unsubscribe. */
  subscribe(fn: LegendIdListener): () => void {
    legendIdListeners.add(fn);
    fn(activeId);
    return () => {
      legendIdListeners.delete(fn);
    };
  },
  /** Set the active id and notify all subscribers. */
  set(id: string | null): void {
    activeId = id;
    for (const fn of legendIdListeners) fn(activeId);
  },
};

/**
 * briefOrder — the instructor's CUSTOM order for the brief-legend marked points
 * (drag-and-drop reorder). An array of eventIds. When empty, BriefLegend falls
 * back to conversation order. When set, listed ids lead (in this order) and any
 * not-yet-ordered marks trail in conversation order.
 *
 * Persisted to localStorage under `lb.brief.order` (removed entirely when empty,
 * so a cleared order leaves no residue). Shared module store so both BriefLegend
 * instances (scrubber + Zen panel) reorder together. Same plain-store pattern.
 */
const ORDER_KEY = "lb.brief.order";

function readOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

type OrderListener = (order: string[]) => void;
let order: string[] = readOrder();
const orderListeners = new Set<OrderListener>();

function persistOrder(): void {
  if (typeof window === "undefined") return;
  try {
    if (order.length === 0) window.localStorage.removeItem(ORDER_KEY);
    else window.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    // Non-fatal — the in-memory order still applies this session.
  }
}

export const briefOrder = {
  get(): string[] {
    return order;
  },
  subscribe(fn: OrderListener): () => void {
    orderListeners.add(fn);
    fn(order);
    return () => {
      orderListeners.delete(fn);
    };
  },
  /** Replace the custom order, persist, and notify. */
  set(next: string[]): void {
    order = [...next];
    persistOrder();
    for (const fn of orderListeners) fn(order);
  },
  /** Drop the custom order (revert to conversation order), persist, notify. */
  clear(): void {
    order = [];
    persistOrder();
    for (const fn of orderListeners) fn(order);
  },
};
