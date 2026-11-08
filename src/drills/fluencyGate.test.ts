import { describe, it, expect } from 'vitest';
import {
  countFluency,
  isCountFluent,
  isQualifyingRun,
  rungMissLine,
  rungMissReason,
  rungMissSpeech,
  rungMissToSay,
  COUNT_RUNS_JUDGED,
  FLUENCY_MIN_CARDS,
} from './fluencyGate';
import type { CountRunLike } from './fluencyGate';
import { TABLE_PACE_MS } from './countSpeed';

/** A paced deck run at 550 ms a card -- table pace -- unless told otherwise. */
const run = (correct: boolean, extra: { cards?: number; manual?: boolean } = {}): CountRunLike => ({
  correct,
  cards: extra.cards ?? FLUENCY_MIN_CARDS,
  intervalMs: 550,
  ...(extra.manual === undefined ? {} : { manual: extra.manual }),
});

describe('countFluency (F15: the one rule for Home and the Drills picker)', () => {
  it('is not fluent with too few runs, even all right', () => {
    expect(isCountFluent([])).toBe(false);
    expect(isCountFluent(Array.from({ length: COUNT_RUNS_JUDGED - 1 }, () => run(true)))).toBe(false);
  });

  it('is fluent at 4 of the last 5', () => {
    expect(isCountFluent([run(true), run(true), run(false), run(true), run(true)])).toBe(true);
    expect(isCountFluent([run(true), run(true), run(false), run(false), run(true)])).toBe(false);
  });

  it('judges only the last five: old misses and old hits age out', () => {
    expect(isCountFluent([run(false), run(false), run(true), run(true), run(true), run(true), run(false)])).toBe(true);
    expect(isCountFluent([run(true), run(true), run(true), run(true), run(false), run(false)])).toBe(false);
  });

  it('counts only paced runs of at least one deck', () => {
    const short = Array.from({ length: 10 }, () => run(true, { cards: FLUENCY_MIN_CARDS - 1 }));
    const manual = Array.from({ length: 10 }, () => run(true, { manual: true }));
    expect(isCountFluent(short)).toBe(false);
    expect(isCountFluent(manual)).toBe(false);
    expect(countFluency([...short, ...manual, run(true)])).toEqual({ judged: 1, right: 1, fluent: false });
  });
});

// R7 (review of C12): a self-reported run (no number given) is the operator's
// own verdict, not a graded count, so it never counts toward fluency -- in
// countFluency itself, for every reader (Drills, CountDrillView, nextStep).
describe('self-reported runs (R7)', () => {
  it('do not qualify, however many', () => {
    const self = Array.from({ length: COUNT_RUNS_JUDGED }, () => ({ ...run(true), selfReport: true as const }));
    expect(isCountFluent(self)).toBe(false);
    expect(countFluency([...self, run(true)])).toEqual({ judged: 1, right: 1, fluent: false });
  });
});

// T2-2A: "Running count at table pace" used to pass at any speed.
describe('table pace (T2-2A)', () => {
  const at = (intervalMs: number, extra: Partial<CountRunLike> = {}): CountRunLike => ({
    correct: true,
    cards: FLUENCY_MIN_CARDS,
    intervalMs,
    ...extra,
  });

  it('is the table-ready interval: a deck in 30 s, 576 ms a card', () => {
    expect(TABLE_PACE_MS).toBe(576);
  });

  it('qualifies at exactly 576 ms a card and not at 577', () => {
    expect(isQualifyingRun(at(576))).toBe(true);
    expect(isQualifyingRun(at(577))).toBe(false);
  });

  it('does not qualify at the old 800 ms default', () => {
    expect(rungMissReason(at(800))).toBe('slow');
  });

  it('judges a grouped run per card: three cards in 1500 ms is 500 ms a card', () => {
    expect(isQualifyingRun(at(1500, { group: 3 }))).toBe(true);
    expect(isQualifyingRun(at(1500))).toBe(false);
  });

  it('judges an eyes-free run on its measured time, not its gap', () => {
    // The gap is 300 ms, but speech plus gap took 700 ms a card.
    expect(isQualifyingRun(at(300, { eyesFree: true, elapsedMs: 52 * 700 }))).toBe(false);
    expect(isQualifyingRun(at(300, { eyesFree: true, elapsedMs: 52 * 500 }))).toBe(true);
  });

  it('judges an eyes-free Countdown row (gap 300, about 900 ms a card) as too slow', () => {
    expect(rungMissReason(at(300, { eyesFree: true, elapsedMs: 52 * 900 }))).toBe('slow');
  });

  it('stops counting existing too-slow passes: five right runs at 800 ms judge nothing', () => {
    const old = Array.from({ length: COUNT_RUNS_JUDGED }, () => at(800));
    expect(countFluency(old)).toEqual({ judged: 0, right: 0, fluent: false });
    expect(countFluency([...old, ...Array.from({ length: COUNT_RUNS_JUDGED }, () => at(550))]).fluent).toBe(true);
  });

  it('names each reason in the order a user can act on', () => {
    expect(rungMissReason(at(800, { selfReport: true, manual: true, cards: 10 }))).toBe('selfReport');
    expect(rungMissReason(at(800, { manual: true, meanTapMs: 400, cards: 10 }))).toBe('manual');
    expect(rungMissReason(at(800, { cards: 51 }))).toBe('short');
    expect(rungMissReason(at(800))).toBe('slow');
    expect(rungMissReason(at(550))).toBeNull();
  });

  it('says on the result screen why a run did not count', () => {
    expect(rungMissLine(at(800))).toBe(
      'Too slow to count toward the step: 800 ms a card. Table pace is a deck in 30 s (576 ms a card): 500 ms or faster on the stepper.',
    );
    expect(rungMissLine(at(1500, { group: 2 }))).toContain('750 ms a card');
    expect(rungMissLine(at(550, { cards: 26 }))).toContain('52 cards');
    expect(rungMissLine(at(550))).toBeNull();
    expect(rungMissLine(at(800, { selfReport: true }))).toBeNull();
  });

  it('says only the pace out loud, eyes-free', () => {
    expect(rungMissSpeech('slow')).toMatch(/^Too slow to count toward the table pace step./);
    expect(rungMissSpeech('short')).toBeNull();
    expect(rungMissSpeech('selfReport')).toBeNull();
    expect(rungMissSpeech(null)).toBeNull();
  });
});

describe('the spoken miss, once until it changes (T2#6)', () => {
  it('is said on the first slow run, not the next, and again after a counted one', () => {
    expect(rungMissToSay(undefined, 'slow')).not.toBeNull();
    expect(rungMissToSay('slow', 'slow')).toBeNull();
    expect(rungMissToSay('slow', null)).toBeNull();
    expect(rungMissToSay(null, 'slow')).not.toBeNull();
    expect(rungMissToSay(undefined, null)).toBeNull();
  });
});
