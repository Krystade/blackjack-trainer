import { describe, expect, it } from 'vitest';
import { EMPTY_STATS } from '../../store/types';
import type { Stats } from '../../store/types';
import { generateAllCells } from '../../drills/flashcards';
import { cellLabel, masterySweepDone, nextStep } from './nextStep';
import { ctxFor, runs, stateAt, withIndices } from './ladderFixtures';

/** Strategy learned: 30 answers per category, all right, spread over cells. */
function learned(): Stats {
  const s = structuredClone(EMPTY_STATS);
  s.cellStats = {
    'hard-16-v-10': { right: 30, wrong: 0, lastAt: '' },
    'soft-18-v-9': { right: 30, wrong: 0, lastAt: '' },
    'pair-8-v-A': { right: 30, wrong: 0, lastAt: '' },
  };
  return s;
}

function withCountRuns(s: Stats, results: boolean[]): Stats {
  s.countDrill.history = runs(results);
  return s;
}

describe('nextStep (#28)', () => {
  it('1: a fresh install learns basic strategy, saying there are too few answers to judge', () => {
    const n = nextStep(structuredClone(EMPTY_STATS), { sweepDone: false });
    expect(n.kind).toBe('flash');
    expect(n.why).toMatch(/0 answers so far, 20 needed/);
  });

  it('1: a category with 19 answers is still too thin; 20 is enough', () => {
    const s = learned();
    s.cellStats!['pair-8-v-A'] = { right: 19, wrong: 0, lastAt: '' };
    expect(nextStep(s, { sweepDone: false }).why).toMatch(/^Pairs: 19 answers/);
    s.cellStats!['pair-8-v-A'] = { right: 20, wrong: 0, lastAt: '' };
    expect(nextStep(s, { sweepDone: false }).kind).toBe('mastery');
  });

  it('1: names the weakest category below 90%, never rounding a miss up', () => {
    const s = learned();
    s.cellStats!['soft-18-v-9'] = { right: 84, wrong: 16, lastAt: '' };
    s.cellStats!['soft-13-v-5'] = { right: 0, wrong: 0, lastAt: '' };
    const n = nextStep(s, { sweepDone: true });
    expect(n).toMatchObject({ kind: 'flash' });
    expect(n.why).toBe('Soft totals are at 84%; get every category to 90%.');
    // 89.9% shows as 89, not 90.
    s.cellStats!['soft-18-v-9'] = { right: 899, wrong: 101, lastAt: '' };
    expect(nextStep(s, { sweepDone: true }).why).toMatch(/at 89%/);
  });

  it('2: a cell with enough answers below 78% sends you to Custom', () => {
    const s = learned();
    s.cellStats!['hard-12-v-3'] = { right: 3, wrong: 2, lastAt: '' }; // 60%, 5 answers
    const n = nextStep(s, { sweepDone: true });
    expect(n.kind).toBe('custom');
    expect(n.why).toMatch(/^Hard 12 v 3 is at 60%/);
  });

  it('2: a cell with too few answers, or at 78%, is not weak', () => {
    const s = learned();
    // Enough right answers elsewhere that Hard totals stay over 90%.
    s.cellStats!['hard-16-v-10'] = { right: 1000, wrong: 0, lastAt: '' };
    s.cellStats!['hard-12-v-3'] = { right: 2, wrong: 2, lastAt: '' };
    expect(nextStep(s, { sweepDone: true }).kind).toBe('count');
    s.cellStats!['hard-12-v-3'] = { right: 39, wrong: 11, lastAt: '' }; // exactly 78%
    expect(nextStep(s, { sweepDone: true }).kind).toBe('count');
  });

  it('W3: a category is judged on its last 30 answers, so learning mistakes age out', () => {
    const s = learned();
    // Lifetime pairs at 70%: stuck on "Learn basic strategy" under the old rule.
    s.cellStats!['pair-8-v-A'] = { right: 70, wrong: 30, lastAt: '' };
    expect(nextStep(s, { sweepDone: true }).why).toMatch(/^Pairs are at 70%/);
    // The last 30 pair answers were all right: the gate clears.
    s.handRecent = { pair: '1'.repeat(30) };
    s.cellStats!['pair-8-v-A']!.recent = '1'.repeat(10);
    expect(nextStep(s, { sweepDone: true }).kind).toBe('count');
    // A recent slump is caught even with a good lifetime figure.
    s.cellStats!['pair-8-v-A'] = { right: 300, wrong: 5, lastAt: '' };
    s.handRecent = { pair: '0'.repeat(6) + '1'.repeat(24) };
    expect(nextStep(s, { sweepDone: true }).why).toBe('Pairs are at 80% over your last 30; get every category to 90%.');
  });

  it('W3: with fewer than 20 answers in the window the lifetime figure is used', () => {
    const s = learned();
    s.cellStats!['pair-8-v-A'] = { right: 70, wrong: 30, lastAt: '', recent: '1'.repeat(10) };
    s.handRecent = { pair: '1'.repeat(19) };
    expect(nextStep(s, { sweepDone: true }).why).toMatch(/^Pairs are at 70%;/);
  });

  it('W3: a cell fumbled long ago but right on its last answers is not weak', () => {
    const s = learned();
    s.cellStats!['hard-16-v-10'] = { right: 1000, wrong: 0, lastAt: '' };
    s.cellStats!['hard-12-v-3'] = { right: 2, wrong: 4, lastAt: '', recent: '11111' };
    expect(nextStep(s, { sweepDone: true }).kind).toBe('count');
    // Still weak while the window is short: lifetime decides.
    s.cellStats!['hard-12-v-3'] = { right: 2, wrong: 4, lastAt: '', recent: '1111' };
    expect(nextStep(s, { sweepDone: true }).kind).toBe('custom');
    // And a recent run of misses is weak even with a good lifetime.
    s.cellStats!['hard-12-v-3'] = { right: 40, wrong: 5, lastAt: '', recent: '1100000111' };
    expect(nextStep(s, { sweepDone: true }).why).toMatch(/^Hard 12 v 3 is at 50%/);
  });

  it('F21: a basic-strategy step names the hand type Start should open on, with progress', () => {
    const fresh = nextStep(structuredClone(EMPTY_STATS), { sweepDone: false });
    expect(fresh.scope).toBe('hard');
    expect(fresh.progress?.map((c) => c.prefix)).toEqual(['hard', 'soft', 'pair']);
    const s = learned();
    s.cellStats!['soft-18-v-9'] = { right: 80, wrong: 20, lastAt: '', recent: '1'.repeat(10) };
    const low = nextStep(s, { sweepDone: true });
    expect(low).toMatchObject({ kind: 'flash', scope: 'soft' });
    expect(low.progress?.find((c) => c.prefix === 'hard')?.onTarget).toBe(true);
    expect(nextStep(learned(), { sweepDone: false }).scope).toBeUndefined();
  });

  it('s07: a weakness concentrated in a few cells of a low category goes to Fix weak cells', () => {
    const s = learned();
    // Soft at 80%: every miss is on two soft doubles with 3-4 answers each.
    s.cellStats!['soft-18-v-9'] = { right: 30, wrong: 0, lastAt: '', recent: '1'.repeat(10) };
    s.cellStats!['soft-17-v-3'] = { right: 0, wrong: 4, lastAt: '', recent: '0000' };
    s.cellStats!['soft-15-v-4'] = { right: 1, wrong: 3, lastAt: '', recent: '0100' };
    const n = nextStep(s, { sweepDone: false });
    expect(n.kind).toBe('custom');
    expect(n.why).toBe(
      'Soft totals are at 81%, mostly from Soft 17 v 3 at 0% and 1 more cell below 78%. Custom with Auto drills them most.',
    );
    expect(n.progress?.map((c) => c.prefix)).toEqual(['hard', 'soft', 'pair']);
  });

  it('s07: misses spread across the category stay with Learn basic strategy', () => {
    const s = learned();
    s.cellStats!['soft-18-v-9'] = { right: 24, wrong: 6, lastAt: '', recent: '1111111111' };
    // One weak cell, but it holds 2 of the category's 8 misses.
    s.cellStats!['soft-17-v-3'] = { right: 1, wrong: 2, lastAt: '', recent: '010' };
    expect(nextStep(s, { sweepDone: false })).toMatchObject({ kind: 'flash', scope: 'soft' });
  });

  it('s07: misses are counted on the same recent windows as the category figure', () => {
    // Review repro: a learner whose early pair misses were spread out. Ten
    // pair cells carry 3 old misses each but are clean lately; every one of
    // the last 30 pair answers' 7 misses is on two cells. Lifetime misses in
    // those two (7) are far short of half the category's (37), but they hold
    // all of its recent misses, so they are the drill.
    const s = learned();
    delete s.cellStats!['pair-8-v-A'];
    for (const up of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A']) {
      s.cellStats![`pair-3-v-${up}`] = { right: 10, wrong: 3, lastAt: '', recent: '1'.repeat(10) };
    }
    s.cellStats!['pair-9-v-7'] = { right: 5, wrong: 4, lastAt: '', recent: '1110000111' };
    s.cellStats!['pair-2-v-8'] = { right: 5, wrong: 3, lastAt: '', recent: '1111100011' };
    s.handRecent = { pair: '1'.repeat(23) + '0'.repeat(7) };
    const n = nextStep(s, { sweepDone: false });
    expect(n.kind).toBe('custom');
    expect(n.why).toBe(
      'Pairs are at 76%, mostly from 9,9 v 7 at 60% and 1 more cell below 78%. Custom with Auto drills them most.',
    );
  });

  it('s07: recent misses spread across the category stay with Learn basic strategy', () => {
    const s = learned();
    // Soft at 73% over the last 30: 8 misses, only 2 of them on the one weak cell.
    for (const up of ['2', '3', '4', '5', '6', '7']) {
      s.cellStats![`soft-19-v-${up}`] = { right: 9, wrong: 1, lastAt: '', recent: '1111111110' };
    }
    s.cellStats!['soft-17-v-3'] = { right: 3, wrong: 2, lastAt: '', recent: '00111' };
    s.handRecent = { soft: '1'.repeat(22) + '0'.repeat(8) };
    expect(nextStep(s, { sweepDone: false })).toMatchObject({ kind: 'flash', scope: 'soft' });
  });

  it('s02: once every category meets the goal, later steps still carry it, all ticked', () => {
    const later = [
      nextStep(learned(), { sweepDone: false }),
      nextStep(learned(), { sweepDone: true }),
    ];
    for (const n of later) {
      expect(n.kind).not.toBe('flash');
      expect(n.progress?.map((c) => c.onTarget)).toEqual([true, true, true]);
    }
  });

  it("a returning user's older answers are named, not counted as 'so far'", () => {
    // Hand decisions from before per-cell tracking live only in the category tally.
    const s = learned();
    s.categories.pairs = { right: 380, wrong: 20 };
    s.cellStats!['pair-8-v-A'] = { right: 12, wrong: 0, lastAt: '' };
    expect(nextStep(s, { sweepDone: false }).why).toBe(
      'Pairs: 12 answers since per-hand tracking began, 20 needed to judge (your 388 earlier answers predate it). Get every category to 90%.',
    );
  });

  it('never prints 0% for a category with a right answer', () => {
    const s = learned();
    s.cellStats!['soft-18-v-9'] = { right: 1, wrong: 299, lastAt: '' };
    expect(nextStep(s, { sweepDone: true }).why).toMatch(/^Soft totals are at <1%, mostly from Soft 18 v 9 at <1%/);
  });

  it('3: strategy in hand and no completed sweep -> Mastery', () => {
    expect(nextStep(learned(), { sweepDone: false }).kind).toBe('mastery');
  });

  it('4: deviations until every index has 3 answers and 90% together', () => {
    expect(nextStep(stateAt(5), ctxFor(5))).toMatchObject({ kind: 'quiz' });
    const n = nextStep(withIndices(stateAt(5), 2, 1), ctxFor(5));
    expect(n.kind).toBe('quiz');
    expect(n.why).toMatch(/at 66%/);
    expect(nextStep(withIndices(stateAt(5), 9, 1), ctxFor(5)).kind).toBe('betsizing');
  });

  it('F11: the deviations step counts the index set of the profile', () => {
    // Every H17 index practised: under H17 that is done; under S17, 11vA is
    // active and unpractised, so the step stays on the deviations.
    const s = withIndices(stateAt(5));
    expect(nextStep(s, { ...ctxFor(5), rules: { decks: 6, s17: false } }).kind).toBe('betsizing');
    const s17 = nextStep(s, { ...ctxFor(5), rules: { decks: 6, s17: true } });
    expect(s17.kind).toBe('quiz');
    expect(s17.why).toMatch(/^1 of 18 indices/);
  });

  it('F15: short or self-paced count runs do not count toward the counting step', () => {
    const s = withIndices(learned());
    s.countDrill.history = Array.from({ length: 5 }, () => ({ date: '', cards: 20, intervalMs: 700, correct: true }));
    expect(nextStep(s, { sweepDone: true }).why).toMatch(/^0 of 5 count drill runs/);
  });

  it('5: counting until 4 of the last 5 runs are right', () => {
    const base = () => withIndices(learned());
    expect(nextStep(withCountRuns(base(), [true, true, true, true]), { sweepDone: true }).kind).toBe('count');
    const three = nextStep(withCountRuns(base(), [true, true, true, false, false]), { sweepDone: true });
    expect(three.kind).toBe('count');
    expect(three.why).toMatch(/3 of your last 5/);
    // Old misses outside the last five do not count against you.
    expect(
      nextStep(withCountRuns(base(), [false, false, true, true, true, true, false]), { sweepDone: true }).kind,
    ).toBe('deckest');
    // And old hits outside them do not count for you.
    expect(
      nextStep(withCountRuns(base(), [true, true, true, true, false, false]), { sweepDone: true }).kind,
    ).toBe('count');
  });

  it('6: everything on target -> keep the stalest skill fresh (W2; no quiz SR = deviations never practised)', () => {
    expect(nextStep(stateAt(8), ctxFor(8))).toMatchObject({ card: 'stale', kind: 'quiz', title: 'Keep it fresh: Deviations' });
  });

  it('labels cells the way the chart reads', () => {
    expect(cellLabel('pair-8-v-A')).toBe('8,8 v A');
    expect(cellLabel('soft-18-v-9')).toBe('Soft 18 v 9');
  });
});

describe('masterySweepDone', () => {
  const all = generateAllCells().map((c) => c.id);
  it('is a finished run over every cell', () => {
    expect(masterySweepDone(null)).toBe(false);
    expect(masterySweepDone({ seed: 1, index: all.length, order: all })).toBe(true);
    expect(masterySweepDone({ seed: 1, index: all.length - 1, order: all })).toBe(false);
  });
  it('does not count a finished sweep of one scope', () => {
    const hard = all.filter((id) => id.startsWith('hard-'));
    expect(masterySweepDone({ seed: 1, index: hard.length, order: hard })).toBe(false);
  });
});
