import { describe, expect, it } from 'vitest';
import { PICKER_RUNG, drillTag, type PickerDrill } from './drillRungs';
import { DRILL_RUNG } from './drills/rungProgress';
import { ladder, rungDone, type Ladder, type NextStepKind, type RungId } from './nextStep';
import { ctxFor, stateAt } from './ladderFixtures';
import drillsSource from './Drills.tsx?raw';

const ORDER: RungId[] = ['basic', 'repair', 'count', 'tc', 'deviations', 'betramp', 'play'];
const START: Record<RungId, NextStepKind> = {
  basic: 'flash',
  repair: 'mastery',
  count: 'count',
  tc: 'deckest',
  deviations: 'quiz',
  betramp: 'betsizing',
  play: 'play',
};

/** A ladder with `passed` (and `skipped`) rungs; the first other is current. */
function lad(passed: readonly RungId[], opts: { skipped?: readonly RungId[]; start?: Partial<Record<RungId, NextStepKind>> } = {}): Ladder {
  const rungs = ORDER.map((id) => ({
    id,
    label: id,
    passed: passed.includes(id),
    ...(opts.skipped?.includes(id) ? { skipped: true } : {}),
    progress: '',
    start: { kind: opts.start?.[id] ?? START[id] },
  }));
  const first = rungs.findIndex((r) => !rungDone(r));
  return { rungs, current: first === -1 ? null : first, step: { card: 'rung', kind: 'flash', title: '', why: '' } };
}
const text = (d: PickerDrill, l: Ladder) => drillTag(d, l)?.text ?? null;

describe('Drills picker labels (Track 1, 1A)', () => {
  it('a new user (the real ladder on empty stats): Flashcards first, the rest in order after', () => {
    // A real new user has no sweep (ctxFor(1) assumes one).
    const l = ladder(stateAt(1), { ...ctxFor(1), sweepDone: false });
    expect(text('flash', l)).toBe('Start here');
    expect(text('speed', l)).toBeNull();
    expect(text('mastery', l)).toBe('After: Flashcards');
    expect(text('count', l)).toBe('After: Mastery challenge');
    expect(text('quiz', l)).toBe('After: True count drill');
    expect(text('betsizing', l)).toBe('After: Deviation quiz');
    expect(text('rulesdiff', l)).toBeNull();
    expect(text('variant', l)).toBeNull();
    expect(text('sidecount', l)).toBeNull();
  });

  it('current = count: the count drill starts, the true count comes after it, basic strategy has no label', () => {
    const l = lad(['basic', 'repair']);
    expect(drillTag('count', l)).toEqual({ kind: 'start', text: 'Start here' });
    expect(text('deckest', l)).toBe('After: Count drill');
    expect(text('flash', l)).toBeNull();
    expect(text('paircancel', l)).toBeNull();
  });

  it('"After" names the nearest earlier step still to do, skipping passed ones', () => {
    // tc passed while count is current: deviations comes after the count, not the TC drill.
    expect(text('quiz', lad(['basic', 'repair', 'tc']))).toBe('After: Count drill');
  });

  it('a later rung already passed carries no label', () => {
    expect(text('betsizing', lad(['basic', 'repair', 'betramp']))).toBeNull();
  });

  it('a skipped rung reads as done', () => {
    const l = lad([], { skipped: ['basic', 'repair'] });
    expect(text('count', l)).toBe('Start here');
    expect(text('mastery', l)).toBeNull();
  });

  it('Custom gets "Start here: use Auto" when the step is fixing weak cells', () => {
    expect(text('custom', lad(['basic'], { start: { repair: 'custom' } }))).toBe('Start here: use Auto');
    expect(text('mastery', lad(['basic'], { start: { repair: 'custom' } }))).toBeNull();
  });

  it('everything done, or only the shoe left: no labels at all', () => {
    for (const l of [lad(ORDER), lad(ORDER.filter((r) => r !== 'play'))]) {
      for (const d of Object.keys(PICKER_RUNG) as PickerDrill[]) expect(text(d, l), d).toBeNull();
    }
  });

  it('every drill the picker draws has a rung entry', () => {
    const drawn = [...drillsSource.matchAll(/\{entry\('([a-z]+)'/g)].map((m) => m[1]!);
    expect(drawn.length).toBeGreaterThan(10);
    expect(drawn.filter((d) => !(d in PICKER_RUNG))).toEqual([]);
    expect(Object.keys(PICKER_RUNG).sort()).toEqual([...drawn].sort());
  });

  it("agrees with the result screens' DRILL_RUNG wherever both name a drill (producetc documented)", () => {
    const both = (Object.keys(DRILL_RUNG) as (keyof typeof DRILL_RUNG)[]).filter((d) => d in PICKER_RUNG);
    expect(both.length).toBeGreaterThan(2);
    for (const d of both) {
      // Produce the true count feeds no rung's figure, but is learned with the true count.
      if (d === 'producetc') expect([DRILL_RUNG[d], PICKER_RUNG[d]]).toEqual([null, 'tc']);
      else expect(PICKER_RUNG[d as PickerDrill], d).toBe(DRILL_RUNG[d]);
    }
  });
});
