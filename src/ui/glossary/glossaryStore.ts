import { useSyncExternalStore } from 'react';
import type { TermId } from './terms';

/**
 * T2-2B: which glossary sheet is open, app-wide. One at a time: tapping a
 * second term swaps the sheet rather than stacking another. `owner` is the
 * tapped Term's own id, so only that instance renders the sheet (and gets
 * focus back when it closes).
 */
export interface OpenTerm {
  id: TermId;
  owner: string;
}

let open: OpenTerm | null = null;
let closedByKey = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function openTerm(next: OpenTerm): void {
  open = next;
  emit();
}

/**
 * `byKey`: closed from the keyboard (Escape), so focus goes back to the
 * word. Closed by a tap, it does not: a focused word would take the next
 * Enter or Space -- which the drills use for "next hand" -- and reopen.
 */
export function closeTerm(byKey = false): void {
  if (open === null) return;
  closedByKey = byKey;
  open = null;
  emit();
}

export function lastCloseWasByKey(): boolean {
  return closedByKey;
}

export function currentTerm(): OpenTerm | null {
  return open;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useOpenTerm(): OpenTerm | null {
  return useSyncExternalStore(subscribe, currentTerm, currentTerm);
}
