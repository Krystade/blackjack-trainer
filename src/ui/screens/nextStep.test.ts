import { describe, expect, it } from 'vitest';
import { EMPTY_STATS } from '../../store/types';
import type { Stats } from '../../store/types';
import { ILLUSTRIOUS_18 } from '../../engine/deviations';
import { generateAllCells } from '../../drills/flashcards';
import { cellLabel, masterySweepDone, nextStep } from './nextStep';

type Tally = { right: number; wrong: number };

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

function withIndices(s: Stats, t: Tally): Stats {
  for (const d of ILLUSTRIOUS_18.filter((x) => x.active)) s.perIndex[d.id] = { ...t };
  return s;
}

function withCountRuns(s: Stats, results: boolean[]): Stats {
  s.countDrill.history = results.map((correct) => ({ date: '', cards: 52, intervalMs: 700, correct }));
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
    expect(nextStep(s, { sweepDone: true }).kind).toBe('quiz');
    s.cellStats!['hard-12-v-3'] = { right: 39, wrong: 11, lastAt: '' }; // exactly 78%
    expect(nextStep(s, { sweepDone: true }).kind).toBe('quiz');
  });

  it('W3: a category is judged on its last 30 answers, so learning mistakes age out', () => {
    const s = learned();
    // Lifetime pairs at 70%: stuck on "Learn basic strategy" under the old rule.
    s.cellStats!['pair-8-v-A'] = { right: 70, wrong: 30, lastAt: '' };
    expect(nextStep(s, { sweepDone: true }).why).toMatch(/^Pairs are at 70%/);
    // The last 30 pair answers were all right: the gate clears.
    s.handRecent = { pair: '1'.repeat(30) };
    s.cellStats!['pair-8-v-A']!.recent = '1'.repeat(10);
    expect(nextStep(s, { sweepDone: true }).kind).toBe('quiz');
    // A recent slump is caught even with a good lifetime figure.
    s.cellStats!['pair-8-v-A'] = { right: 300, wrong: 5, lastAt: '' };
    s.handRecent = { pair: '0'.repeat(6) + '1'.repeat(24) };
    expect(nextStep(s, { sweepDone: true }).why).toBe('Pairs are at 80% over your last 30; get every category to 90%.');
  });

  it('W3: with fewer than 20 answers in the window the lifetime figure is used', () => {
    const s = learned();
    s.cellStats!['pair-8-v-A'] = { right: 70, wrong: 30, lastAt: '' };
    s.handRecent = { pair: '1'.repeat(19) };
    expect(nextStep(s, { sweepDone: true }).why).toMatch(/^Pairs are at 70%;/);
  });

  it('W3: a cell fumbled long ago but right on its last answers is not weak', () => {
    const s = learned();
    s.cellStats!['hard-16-v-10'] = { right: 1000, wrong: 0, lastAt: '' };
    s.cellStats!['hard-12-v-3'] = { right: 2, wrong: 4, lastAt: '', recent: '11111' };
    expect(nextStep(s, { sweepDone: true }).kind).toBe('quiz');
    // Still weak while the window is short: lifetime decides.
    s.cellStats!['hard-12-v-3'] = { right: 2, wrong: 4, lastAt: '', recent: '1111' };
    expect(nextStep(s, { sweepDone: true }).kind).toBe('custom');
    // And a recent run of misses is weak even with a good lifetime.
    s.cellStats!['hard-12-v-3'] = { right: 40, wrong: 5, lastAt: '', recent: '1100000111' };
    expect(nextStep(s, { sweepDone: true }).why).toMatch(/^Hard 12 v 3 is at 50%/);
  });

  it('3: strategy in hand and no completed sweep -> Mastery', () => {
    expect(nextStep(learned(), { sweepDone: false }).kind).toBe('mastery');
  });

  it('4: deviations until every index has 3 answers and 90% together', () => {
    expect(nextStep(learned(), { sweepDone: true })).toMatchObject({ kind: 'quiz' });
    const s = withIndices(learned(), { right: 2, wrong: 1 });
    const n = nextStep(s, { sweepDone: true });
    expect(n.kind).toBe('quiz');
    expect(n.why).toMatch(/at 66%/);
    expect(nextStep(withIndices(learned(), { right: 9, wrong: 1 }), { sweepDone: true }).kind).toBe('count');
  });

  it('5: counting until 4 of the last 5 runs are right', () => {
    const base = () => withIndices(learned(), { right: 10, wrong: 0 });
    expect(nextStep(withCountRuns(base(), [true, true, true, true]), { sweepDone: true }).kind).toBe('count');
    const three = nextStep(withCountRuns(base(), [true, true, true, false, false]), { sweepDone: true });
    expect(three.kind).toBe('count');
    expect(three.why).toMatch(/3 of your last 5/);
    // Old misses outside the last five do not count against you.
    expect(
      nextStep(withCountRuns(base(), [false, false, true, true, true, true, false]), { sweepDone: true }).kind,
    ).toBe('play');
    // And old hits outside them do not count for you.
    expect(
      nextStep(withCountRuns(base(), [true, true, true, true, false, false]), { sweepDone: true }).kind,
    ).toBe('count');
  });

  it('6: everything on target -> Play', () => {
    const s = withCountRuns(withIndices(learned(), { right: 10, wrong: 0 }), [true, true, true, true, true]);
    expect(nextStep(s, { sweepDone: true })).toMatchObject({ kind: 'play', title: 'Play a shoe' });
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
