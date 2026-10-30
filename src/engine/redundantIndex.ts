import type { Card, Rank } from './cards';
import type { Deviation } from './deviations';
import type { StrategyRules } from './ruleset';
import { basicPlay, type PlayContext } from './strategy';

/**
 * Wave A (s08 high): an index the profile's OWN basic chart already plays.
 * Moved here from drills/deviationQuiz.ts so Game can use it without the
 * engine importing from drills/.
 *
 * The index set is the 6-deck one. On 2 decks basic strategy already doubles
 * 9 v 2 and 11 v A, so "9 v 2: double at TC >= +1" was asked at TC 0 and
 * graded against basic -- Double -- while the label on the same card said to
 * hit below +1. Such an index teaches nothing at this table: the drills leave
 * it out and Play does not tag it. Judged with the ctx the item is asked under.
 */
export function redundantForChart(entry: Deviation, rules: StrategyRules): boolean {
  if (entry.kind === 'insurance') return false;
  // Only a contradiction when TC 0 is on the index's NON-deviation side.
  const zeroBeforeIndex = entry.dir === 'gte' ? entry.threshold > 0 : entry.threshold < 0;
  if (!zeroBeforeIndex) return false;
  const cards = indexHand(entry);
  if (!cards || !entry.up) return false;
  return basicPlay(cards, entry.up, indexCtx(entry), rules).action === entry.action;
}

const QUIZ_CTX: PlayContext = { canDouble: true, canSplit: true, canSurrender: false };
const QUIZ_CTX_SURRENDER: PlayContext = { ...QUIZ_CTX, canSurrender: true };

/** The ctx an index is asked under: surrender indices need the play available, every other kind needs it not. */
export function indexCtx(entry: Deviation): PlayContext {
  return entry.kind === 'surrender' ? QUIZ_CTX_SURRENDER : QUIZ_CTX;
}

const card = (rank: Rank): Card => ({ rank, suit: 's' });
const num = (n: number): Rank => (n === 1 ? 'A' : (String(n) as Rank));

/** One two-card hand for an index: never a pair (a pair could split), so basic plays it by its total. */
export function indexHand(entry: Deviation): [Card, Card] | null {
  if (entry.kind === 'pair10') return [card('10'), card('J')];
  const t = entry.total;
  if (t === undefined) return null;
  if (entry.kind === 'soft') return t >= 13 && t <= 20 ? [card('A'), card(num(t - 11))] : null;
  if (t >= 12 && t <= 19) return [card('10'), card(num(t - 10))];
  if (t >= 5 && t <= 11) {
    const hi = Math.min(9, Math.ceil(t / 2) + 1);
    const lo = t - hi;
    return lo >= 2 && lo !== hi ? [card(num(hi)), card(num(lo))] : null;
  }
  return null;
}
