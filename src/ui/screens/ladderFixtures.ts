import { EMPTY_STATS, type Stats } from '../../store/types';
import { ILLUSTRIOUS_18 } from '../../engine/deviations';

export const NOW = Date.parse('2026-10-17T12:00:00.000Z');
export const DAY = 86_400_000;
export const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
/** n results, the last `right` of them right. */
export const flags = (right: number, n: number) => Array.from({ length: n }, (_, i) => i >= n - right);

export function learned(): Stats {
  const s = structuredClone(EMPTY_STATS);
  s.cellStats = {
    'hard-16-v-10': { right: 30, wrong: 0, lastAt: iso(1) },
    'soft-18-v-9': { right: 30, wrong: 0, lastAt: iso(1) },
    'pair-8-v-A': { right: 30, wrong: 0, lastAt: iso(1) },
  };
  return s;
}
export const runs = (ok: boolean[], cards = 52) => ok.map((correct) => ({ date: iso(1), cards, intervalMs: 700, correct }));
export const deckRows = (ok: boolean[]) => ok.map((correct) => ({ date: iso(1), actualDecks: 3, guess: 3, errorDecks: correct ? 0 : 1, correct }));
export const tcRows = (ok: boolean[]) => ok.map((correct) => ({ date: iso(1), runningCount: 6, decksRemaining: 3, guess: 2, correctTc: 2, correct }));
export const betRows = (ok: boolean[]) => ok.map((v) => ({ date: iso(1), rc: 6, decksRemaining: 3, tc: 2, taken: 4, correct: 4, ok: v }));
export function withBets(s: Stats, ok: boolean[]): Stats { (s as Stats & { betSizing?: unknown }).betSizing = { history: betRows(ok) }; return s; }
export function withIndices(s: Stats, right = 10, wrong = 0): Stats {
  for (const d of ILLUSTRIOUS_18.filter((x) => x.active)) s.perIndex[d.id] = { right, wrong };
  return s;
}

/** Stats where rungs 1..r-1 pass and rung r fails (r = 8: everything passes). ctx.sweepDone = r !== 2. */
export function stateAt(r: number): Stats {
  if (r === 1) return structuredClone(EMPTY_STATS);
  const s = learned();
  if (r >= 4) s.countDrill.history = runs(flags(5, 5));
  if (r >= 5) { s.deckEstimation.history = deckRows(flags(10, 10)); s.trueCount.history = tcRows(flags(10, 10)); }
  if (r >= 6) withIndices(s);
  if (r >= 7) withBets(s, flags(10, 10));
  if (r >= 8) s.sessions = [{ date: iso(1), rounds: 45, graded: 40, correct: 36, bankrollDelta: 0, plays: 40, playsCorrect: 36 }];
  return s;
}
export const ctxFor = (r: number) => ({ sweepDone: r !== 2, now: NOW });
