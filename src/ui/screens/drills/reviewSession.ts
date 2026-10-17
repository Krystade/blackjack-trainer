import { useRef, useState } from 'react';

/**
 * Wave B2 R7 (#40-#42) and R5 (#46): a finite drill session over a fixed set
 * of items handed over in memory -- Home's "Review N due" (cells or indexes)
 * or the session report's "Drill these hands". Each item leaves the set once
 * answered right; a miss keeps it. The session is done when none are left.
 * Nothing here touches Settings: the saved deck, scopes and Index choice are
 * the user's and survive the session untouched.
 */

/**
 * The ids to draw the next item from: every one still left, except `previous`
 * (the item just answered) while any other remains, so a missed item is not
 * dealt straight back and nothing repeats before the rest have come up.
 */
export function reviewPool(remaining: readonly string[], previous: string | null): string[] {
  if (remaining.length <= 1 || previous === null) return [...remaining];
  const others = remaining.filter((id) => id !== previous);
  return others.length > 0 ? others : [...remaining];
}

/** What is left after an answer: a right answer takes the item out. */
export function afterAnswer(remaining: readonly string[], id: string, correct: boolean): string[] {
  return correct ? remaining.filter((x) => x !== id) : [...remaining];
}

export interface ReviewSession {
  /** False when no set was handed over: the drill runs on its saved deck. */
  active: boolean;
  total: number;
  left: number;
  done: boolean;
  /** A ref, for handlers that can run from a stale closure (timers, wheel, voice). */
  doneRef: { readonly current: boolean };
  pool: (previous: string | null) => string[];
  answered: (id: string | undefined, correct: boolean) => void;
  finish: () => void;
}

export function useReviewSession(ids: readonly string[] | null): ReviewSession {
  const [initial] = useState(() => (ids && ids.length > 0 ? [...new Set(ids)] : null));
  const remainingRef = useRef<string[]>(initial ?? []);
  const doneRef = useRef(false);
  const [left, setLeft] = useState(initial?.length ?? 0);
  const [done, setDone] = useState(false);
  return {
    active: initial !== null,
    total: initial?.length ?? 0,
    left,
    done,
    doneRef,
    pool: (previous) => reviewPool(remainingRef.current, previous),
    answered: (id, correct) => {
      if (!initial || id === undefined) return;
      remainingRef.current = afterAnswer(remainingRef.current, id, correct);
      setLeft(remainingRef.current.length);
    },
    finish: () => {
      doneRef.current = true;
      setDone(true);
    },
  };
}

/** The review screen's heading (R7: "Review · N due"). */
export function reviewHeading(source: 'review' | 'session', total: number): string {
  return source === 'review' ? `Review · ${total} due` : 'Your session';
}

/** The line under it: what this is and how much is left. */
export function reviewStatus(source: 'review' | 'session', total: number, left: number, noun: 'cell' | 'index' | 'hand'): string {
  const plural = (n: number) => (noun === 'index' ? (n === 1 ? 'index' : 'indexes') : `${noun}${n === 1 ? '' : 's'}`);
  if (source === 'session') return `Drilling ${total} ${plural(total)} from your session · ${left} left`;
  return `${total} ${plural(total)} due · ${left} left`;
}

/** The end state's headline. */
export function reviewDoneLine(source: 'review' | 'session', total: number, noun: 'cell' | 'index' | 'hand'): string {
  const what = total === 1 ? `the ${noun}` : `all ${total} ${noun === 'index' ? 'indexes' : `${noun}s`}`;
  return source === 'review' ? `Review done: ${what} answered right.` : `Done: ${what} from your session answered right.`;
}
