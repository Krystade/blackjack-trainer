/**
 * "Leave this screen?" -- one guard, asked by the shell before it navigates.
 *
 * The Profile editor dropped unsaved edits when a tab was tapped (F13): the
 * tab bar belongs to the shell, so the editor never heard about it. A screen
 * with unsaved work registers a guard here while it has some; App.navigate
 * asks it before leaving, and a false answer keeps the screen.
 */

type Guard = () => boolean;

let guard: Guard | null = null;

/** Install (or with null, remove) the guard. Returns a remover for effects. */
export function setLeaveGuard(next: Guard | null): () => void {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}

/** May the shell navigate away? True when no guard is installed. */
export function mayLeave(): boolean {
  if (!guard) return true;
  try {
    return guard();
  } catch {
    return true;
  }
}

/**
 * B14: is a screen holding unsaved work right now? The update check's
 * deferral asks this, so ANY guarded form (the Profile editor today) holds an
 * update reload, not only the screens that opted into useActivityLive.
 */
export function leaveGuardInstalled(): boolean {
  return guard !== null;
}
