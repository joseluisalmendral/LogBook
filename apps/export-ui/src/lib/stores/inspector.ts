/*
 * inspector store — drives <PromptInspector> open/close + selected event.
 *
 * Spec R-22 / Q3: inspector is CLOSED by default, pops on event click, slides
 * in from the right, traps focus, closes on Esc or backdrop click.
 *
 * The store carries the ID of the selected event (or `null`). Components
 * resolve the full event by looking it up in the payload — keeping the store
 * narrow (just an id) avoids stale-reference issues when the payload is
 * re-loaded in hot module reload during dev.
 *
 * Ephemeral state per design §3 — never persisted, never in the URL hash.
 * Closing the inspector NEVER changes the route.
 */

type Listener = (eventId: string | null) => void;

let current: string | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(current);
}

export const inspector = {
  get(): string | null {
    return current;
  },
  open(eventId: string): void {
    if (current === eventId) return;
    current = eventId;
    notify();
  },
  close(): void {
    if (current === null) return;
    current = null;
    notify();
  },
  toggle(eventId: string): void {
    if (current === eventId) this.close();
    else this.open(eventId);
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(current);
    return () => {
      listeners.delete(fn);
    };
  },
};
