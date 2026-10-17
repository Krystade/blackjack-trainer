import { describe, expect, it } from 'vitest';
import { EMPTY_STATS } from '../../store/types';
import { isCountFluent } from '../../drills/fluencyGate';
import { ladder } from './nextStep';
import { NOW, DAY, iso, flags, runs, deckRows, tcRows, withBets, withIndices, stateAt, ctxFor } from './ladderFixtures';
import type { SrCard, SrDeck } from '../../drills/spacedRepetition';
import { generateAllCells } from '../../drills/flashcards';
import { activeIndices } from './readiness';

describe('ladder: casino order (B2)', () => {
  it.each([
    [1, 'basic', 'flash'], [2, 'repair', 'mastery'], [3, 'count', 'count'], [4, 'tc', 'deckest'],
    [5, 'deviations', 'quiz'], [6, 'betramp', 'betsizing'], [7, 'play', 'play'],
  ] as const)('rung %i (%s) is current and Start opens %s', (r, id, kind) => {
    const l = ladder(stateAt(r), ctxFor(r));
    expect(l.current).toBe(r - 1);
    expect(l.rungs.map((x) => x.id)).toEqual(['basic', 'repair', 'count', 'tc', 'deviations', 'betramp', 'play']);
    expect(l.rungs[r - 1]!.id).toBe(id);
    expect(l.step).toMatchObject({ card: 'rung', kind });
    expect(l.rungs.slice(0, r - 1).every((x) => x.passed)).toBe(true);
  });

  it('every rung passed: no current rung', () => {
    expect(ladder(stateAt(8), ctxFor(8)).current).toBeNull();
  });

  it('a later rung already met reports passed while an earlier one is current', () => {
    const s = structuredClone(EMPTY_STATS);
    s.countDrill.history = runs(flags(5, 5));
    const l = ladder(s, { sweepDone: false, now: NOW });
    expect(l.current).toBe(0);
    expect(l.rungs[2]!.passed).toBe(true);
  });

  it('rung 3 is the Drills picker fluency rule (fluencyGate reads the same result)', () => {
    const cases = [[], runs(flags(4, 4)), runs(flags(5, 5)), runs([true, true, false, false, true]), runs([true, true, true, false, true]), [...runs(flags(5, 5), 20), ...runs([true])]];
    for (const h of cases) {
      const s = stateAt(3); s.countDrill.history = h;
      expect(ladder(s, ctxFor(3)).rungs[2]!.passed).toBe(isCountFluent(h));
    }
    const s = stateAt(3); s.countDrill.history = runs([true, true, true, false, false]);
    expect(ladder(s, ctxFor(3)).rungs[2]!.progress).toBe('3/5 right (need 4)');
  });

  it('rung 4: 8 of the last 10 each; deck estimation first; 9 rows are too few', () => {
    const s = stateAt(4); s.countDrill.history = runs(flags(5, 5));
    s.deckEstimation.history = deckRows(flags(7, 10)); s.trueCount.history = tcRows(flags(10, 10));
    expect(ladder(s, ctxFor(4)).step.kind).toBe('deckest');
    expect(ladder(s, ctxFor(4)).rungs[3]!.progress).toBe('Decks 7/10 · TC 10/10 (need 8/10 each)');
    s.deckEstimation.history = deckRows(flags(8, 10)); s.trueCount.history = tcRows(flags(7, 10));
    expect(ladder(s, ctxFor(4)).step.kind).toBe('truecount');
    s.trueCount.history = tcRows(flags(8, 10));
    expect(ladder(s, ctxFor(4)).rungs[3]!.passed).toBe(true);
    s.trueCount.history = tcRows(flags(9, 9));
    expect(ladder(s, ctxFor(4)).rungs[3]!.passed).toBe(false);
    // Old misses outside the last 10 do not count against you.
    s.trueCount.history = tcRows([false, false, false, ...flags(10, 10)]);
    expect(ladder(s, ctxFor(4)).rungs[3]!.passed).toBe(true);
  });

  it('rung 6 reads stats.betSizing.history (contract 1): 8 of last 10, absent = not met', () => {
    const s = stateAt(6); withIndices(s);
    expect(ladder(s, ctxFor(6)).rungs[5]!.progress).toBe('No bet sizing answers yet');
    withBets(s, flags(7, 10));
    expect(ladder(s, ctxFor(6))).toMatchObject({ current: 5, step: { kind: 'betsizing' } });
    expect(ladder(s, ctxFor(6)).rungs[5]!.progress).toBe('7/10 right (need 8/10)');
    withBets(s, flags(8, 10));
    expect(ladder(s, ctxFor(6)).current).toBe(6);
  });

  it('rung 7: a session of 40+ graded decisions at 90%, among the last 5', () => {
    const s = stateAt(7);
    const row = (graded: number, correct: number) => ({ date: iso(1), rounds: 45, graded, correct, bankrollDelta: 0 });
    s.sessions = [row(39, 39)];
    expect(ladder(s, ctxFor(7)).rungs[6]!.passed).toBe(false);
    s.sessions = [row(40, 35)];
    expect(ladder(s, ctxFor(7)).rungs[6]!.passed).toBe(false);
    s.sessions = [row(40, 36)];
    expect(ladder(s, ctxFor(7)).rungs[6]!.passed).toBe(true);
    s.sessions = [row(40, 36), ...Array.from({ length: 5 }, () => row(10, 10))];
    expect(ladder(s, ctxFor(7)).rungs[6]!.passed).toBe(false);
  });

  it('survives legacy and corrupt rows (Review Focus 2)', () => {
    const s = stateAt(8);
    s.sessions = [{ date: 'garbage', rounds: 0, graded: 0, correct: 0, bankrollDelta: 0 }];
    (s as unknown as { betSizing: unknown }).betSizing = { history: [{ date: '', ok: 'yes' }] };
    const l = ladder(s, ctxFor(8));
    expect(l.rungs[5]!.passed).toBe(false);
    expect(l.rungs[6]!.passed).toBe(false);
    expect(JSON.stringify(l)).not.toMatch(/NaN|Infinity/);
  });
});

const CELLS = generateAllCells().map((c) => c.id);
const ACTIVE = activeIndices().map((d) => d.id);
const card = (box: number, dueAt: number, lastSeenAt = dueAt - DAY): SrCard => ({ box, dueAt, lastSeenAt, lapses: 0, reviews: 3 });
const deckOf = (ids: readonly string[], c: SrCard): SrDeck => Object.fromEntries(ids.map((id) => [id, c]));

describe('Review N due (W2)', () => {
  const ctx = (flashSr: SrDeck, quizSr: SrDeck = {}) => ({ sweepDone: true, flashSr, quizSr, now: NOW });

  it('20 due cells put Review first once strategy is in hand; 19 do not', () => {
    const due = (n: number) => deckOf(CELLS.slice(0, n), card(2, NOW - DAY));
    expect(ladder(stateAt(3), ctx(due(19))).step.card).toBe('rung');
    const l = ladder(stateAt(3), ctx(due(20)));
    expect(l.step).toMatchObject({ card: 'review', kind: 'flash', title: 'Review 20 due' });
    expect(l.step.reviewCells).toEqual([...CELLS.slice(0, 20)].sort());
    expect(l.current).toBe(2); // the rung under it is unchanged
  });

  it('a card missed today (box 0), one not yet due, and a non-cell key are not due', () => {
    const sr = { ...deckOf(CELLS.slice(0, 19), card(2, NOW - DAY)), [CELLS[19]!]: card(0, NOW - 1), [CELLS[20]!]: card(3, NOW + DAY), junk: card(2, NOW - DAY) };
    expect(ladder(stateAt(3), ctx(sr)).step.card).toBe('rung');
  });

  it('nothing is inserted while rung 1 or 2 is current', () => {
    const sr = deckOf(CELLS.slice(0, 100), card(2, NOW - DAY));
    expect(ladder(stateAt(1), ctx(sr)).step.card).toBe('rung');
    expect(ladder(stateAt(2), { ...ctx(sr), sweepDone: false }).step.card).toBe('rung');
  });

  it('counts only active indexes, and reviews indexes when more of them are due', () => {
    const q = { ...deckOf(ACTIVE.slice(0, 15), card(2, NOW - DAY)), notAnIndex: card(2, NOW - DAY) };
    const l = ladder(stateAt(5), ctx(deckOf(CELLS.slice(0, 5), card(2, NOW - DAY)), q));
    expect(l.step).toMatchObject({ card: 'review', kind: 'quiz', title: 'Review 20 due' });
    expect(l.step.reviewCells).toBeUndefined();
  });

  it('after the ladder, Review still comes before the stalest skill', () => {
    expect(ladder(stateAt(8), ctx(deckOf(CELLS.slice(0, 20), card(1, NOW - DAY)))).step.card).toBe('review');
  });
});

describe('stalest skill after the ladder (W2)', () => {
  /** All rungs passed; each skill last practised `days` ago (deviations through quizSr). */
  function done(days: Partial<Record<'cells' | 'count' | 'deck' | 'tc' | 'quiz' | 'bets' | 'play', number>>) {
    const d = { cells: 1, count: 1, deck: 1, tc: 1, quiz: 1, bets: 1, play: 1, ...days };
    const s = stateAt(8);
    for (const t of Object.values(s.cellStats!)) t.lastAt = iso(d.cells);
    s.countDrill.history.forEach((r) => (r.date = iso(d.count)));
    s.deckEstimation.history.forEach((r) => (r.date = iso(d.deck)));
    s.trueCount.history.forEach((r) => (r.date = iso(d.tc)));
    (s as unknown as { betSizing: { history: { date: string }[] } }).betSizing.history.forEach((r) => (r.date = iso(d.bets)));
    s.sessions.forEach((r) => (r.date = iso(d.play)));
    const quizSr = deckOf(ACTIVE, card(3, NOW + 5 * DAY, NOW - d.quiz * DAY));
    return { s, ctx: { sweepDone: true, flashSr: {}, quizSr, now: NOW } };
  }

  it('rotates to the skill practised longest ago, saying how long', () => {
    const { s, ctx } = done({ deck: 30, tc: 2 });
    expect(ladder(s, ctx).step).toMatchObject({ card: 'stale', kind: 'deckest', title: 'Keep it fresh: Deck estimation' });
    expect(ladder(s, ctx).step.why).toMatch(/\(30 days ago\)/);
  });

  it('ties go to the earlier rung; never practised counts as oldest', () => {
    expect(ladder(done({ count: 9, quiz: 9 }).s, done({ count: 9, quiz: 9 }).ctx).step.kind).toBe('count');
    // Wave B2 #44 (deliberate change): every rung is passed here, so each
    // skill HAS practice on record; an undated one is not "not practised yet".
    const { s, ctx } = done({});
    s.sessions.forEach((r) => (r.date = ''));
    expect(ladder(s, ctx).step).toMatchObject({ kind: 'play', why: 'Every rung is done. Play a shoe has no practice date on record.' });
  });

  it('#44: deviations learned with no quiz schedule (perIndex only) are not "not practised yet"', () => {
    const { s } = done({});
    const l = ladder(s, { sweepDone: true, flashSr: {}, quizSr: {}, now: NOW });
    expect(l.rungs.find((r) => r.id === 'deviations')!.passed).toBe(true);
    expect(l.step).toMatchObject({ card: 'stale', kind: 'quiz', title: 'Keep it fresh: Deviations' });
    expect(l.step.why).toBe('Every rung is done. Deviations has no practice date on record.');
    expect(l.step.why).not.toMatch(/not been practised/);
  });

  it('a timestamp in the future (device clock behind) reads "today", never negative (Review Focus 3)', () => {
    const { s, ctx } = done({ bets: 40 });
    s.cellStats!['hard-16-v-10']!.lastAt = iso(-3);
    expect(ladder(s, ctx).step.why).toMatch(/40 days ago/);
    const fut = done({ cells: -3, count: -3, deck: -3, tc: -3, quiz: -3, bets: -3, play: -3 });
    expect(ladder(fut.s, fut.ctx).step.why).toMatch(/\(today\)/);
  });
});
