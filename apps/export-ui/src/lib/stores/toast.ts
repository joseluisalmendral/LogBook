/*
 * toast store — minimal singleton for transient user feedback.
 *
 * P3 introduces the toast pattern as the substitute for the fictional
 * `claude://` deep link (INV-19 / R-79). A toast is shown after copying the
 * "claude --resume <id>" command to the clipboard so the user knows the
 * paste payload is ready. The store also drives the dismissal timer.
 *
 * Shape: { message, visible, key }.
 *   - message: current message (null when hidden)
 *   - visible: drives mount/unmount of <Toast>
 *   - key:     monotonic counter so the component can re-trigger CSS entrance
 *              even when the same message is shown twice in a row
 *
 * Follows the same hand-rolled subscribable shape as inspector.ts — no
 * svelte/store dependency, fully SSR-safe (setTimeout is guarded).
 */

export interface ToastState {
  message: string | null;
  visible: boolean;
  key: number;
}

type Listener = (state: ToastState) => void;

const DEFAULT_DURATION_MS = 2000;

let current: ToastState = { message: null, visible: false, key: 0 };
const listeners = new Set<Listener>();
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  for (const fn of listeners) fn(current);
}

function clearTimer(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

export const toast = {
  get(): ToastState {
    return current;
  },
  show(message: string, durationMs: number = DEFAULT_DURATION_MS): void {
    clearTimer();
    current = {
      message,
      visible: true,
      key: current.key + 1,
    };
    notify();
    if (typeof setTimeout !== "undefined") {
      dismissTimer = setTimeout(() => {
        current = { ...current, visible: false };
        notify();
        dismissTimer = null;
      }, Math.max(0, durationMs));
    }
  },
  hide(): void {
    clearTimer();
    if (!current.visible) return;
    current = { ...current, visible: false };
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
