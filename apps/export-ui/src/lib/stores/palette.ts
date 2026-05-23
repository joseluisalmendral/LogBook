/*
 * palette store — drives <CommandPalette> open/close state.
 *
 * Spec R-30 / S-7: opens via Cmd+K (Mac) / Ctrl+K (Win-Linux), closes on Esc,
 * native <dialog> element provides focus trap + ::backdrop.
 *
 * The keyboard binding lives in <CourseShell> (P3) so it's mounted exactly
 * once at app root. This store just tracks the open/closed state.
 */

type Listener = (open: boolean) => void;

let open = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(open);
}

export const palette = {
  get(): boolean {
    return open;
  },
  openPalette(): void {
    if (open) return;
    open = true;
    notify();
  },
  closePalette(): void {
    if (!open) return;
    open = false;
    notify();
  },
  toggle(): void {
    open = !open;
    notify();
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(open);
    return () => {
      listeners.delete(fn);
    };
  },
};
