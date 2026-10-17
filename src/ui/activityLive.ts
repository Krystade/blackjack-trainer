import { useEffect } from 'react';
import { fieldTestRunIsLive } from '../diag/fieldTestRun';

/**
 * ONE "SOMEBODY IS IN THE MIDDLE OF SOMETHING" FLAG for the whole app.
 *
 * The update check reloads the app from a visibility change (updateCheck.ts),
 * and a phone call, Siri or Maps taking the screen is enough to fire one. It
 * used to defer only for a live field-test run, so a deploy landing while a
 * drill or a Play shoe was running reloaded the app on the way back from the
 * call: a silent Home, eyes-free and the mic off, mid-drive (backlog F2).
 *
 * Anything with a run that a reload would interrupt holds the flag while it
 * runs: the table, every drill view, the field test. Holds are counted, not
 * keyed booleans, because React StrictMode mounts an effect twice and two
 * screens can overlap for a frame during a navigation; a release only ever
 * gives back its own hold.
 *
 * The update is not lost while the flag is held: the check runs again on the
 * next foreground event once nothing holds it.
 */

const holds = new Map<number, string>();
let nextId = 1;

/** Hold the flag; call the returned function to let go (idempotent). */
export function holdActivity(key: string): () => void {
  const id = nextId++;
  holds.set(id, key);
  return () => {
    holds.delete(id);
  };
}

/** Is anything holding the flag right now? */
export function activityIsLive(): boolean {
  return holds.size > 0;
}

/** What holds it, for the diagnostic log. */
export function activityHolders(): string[] {
  return [...holds.values()];
}

/**
 * Hold the flag for as long as `live` is true and the component is mounted.
 *
 * For the table and the drill views: `useActivityLive('drill:flash', running)`.
 */
export function useActivityLive(key: string, live = true): void {
  useEffect(() => {
    if (!live) return undefined;
    return holdActivity(key);
  }, [key, live]);
}

/**
 * Must an update reload wait? The single rule main.tsx hands the update check.
 * `fieldTest` is injectable so the rule can be tested without storage.
 */
export function updateMustWait(fieldTest: () => boolean = fieldTestRunIsLive): boolean {
  return activityIsLive() || fieldTest();
}

/** Tests only. */
export function resetActivityForTest(): void {
  holds.clear();
}
