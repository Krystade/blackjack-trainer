import type { PlayGame } from './losingShoe';

/**
 * THE SHOE SURVIVES A TRIP TO SETTINGS AND BACK (audit D3).
 *
 * `useGame` builds its game once per Table mount, so every way off Play
 * threw the shoe away. One of them promises to come back: the Play gear's
 * "All settings", whose screen now offers "Back to the table". Mid-shoe, the
 * trip used to come back to Round 0 with an empty discard tray and the count
 * gone, and nothing had warned that it would.
 *
 * So when Play is left FOR Settings, the live game and the
 * session bookkeeping that goes with it are set aside here, and the next
 * Table mount with the same key takes them back. The key is the one App
 * gives the Table (epoch, profile id and profile content), so a real change
 * to the game definition -- a profile edit, a bankroll reset, the losing
 * shoe -- still deals a new table, exactly as before.
 *
 * Anything else drops it: leaving Play for Home or Drills, or leaving
 * Settings for anywhere but Play. Those deal a fresh shoe as they always
 * have; this is only the round trip that said it would come back.
 */

/** What a session has already written, so a resumed one neither re-applies
 * nor loses graded events (see useGame's persistSession). */
export interface KeptSession {
  id: string;
  committed: number;
  sideCommitted: number;
  peeks: number;
  paced: number;
  storedBankroll: number;
}

export interface KeptTable {
  key: string;
  playGame: PlayGame;
  session: KeptSession;
}

/** Screens a trip to which keeps the shoe for the way back. Play's only
 * other exits (Home, Drills, the profile editor) never promised a way back. */
const KEEP_THROUGH: ReadonlySet<string> = new Set(['settings']);

let kept: KeptTable | null = null;
/** Play is being left for a screen that comes back: the unmount may stash. */
let leavingToKeep = false;

/**
 * Called by App's navigate on every screen change, before the change renders.
 */
export function noteNavigation(from: string, to: string): void {
  if (from === to) return;
  if (from === 'table') {
    leavingToKeep = KEEP_THROUGH.has(to);
    if (!leavingToKeep) kept = null;
    return;
  }
  leavingToKeep = false;
  // Anywhere but back to Play drops it.
  if (to !== 'table') kept = null;
}

/** On Table unmount. Stashes only on the way to Settings. */
export function offerKeptTable(next: KeptTable): void {
  if (!leavingToKeep) return;
  leavingToKeep = false;
  kept = next;
}

/**
 * At Table mount, during render. Does NOT clear: React may render a mount
 * twice (StrictMode) and both renders must see the same answer. The mount
 * effect clears it with `dropKeptTable`.
 */
export function peekKeptTable(key: string): KeptTable | null {
  return kept !== null && kept.key === key ? kept : null;
}

export function dropKeptTable(): void {
  kept = null;
}
