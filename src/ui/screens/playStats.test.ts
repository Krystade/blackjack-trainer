import { describe, expect, it } from 'vitest';
import type { GradedEvent } from '../../engine/grade';
import { applyEvents } from '../../store/stats';
import { EMPTY_STATS } from '../../store/types';
import { drillPerIndex, playFigures } from './playStats';

const ev = (over: Partial<GradedEvent>): GradedEvent => ({
  kind: 'action',
  category: 'hard',
  correct: true,
  classification: 'correct',
  taken: 'hit',
  expected: 'hit',
  reason: 'x',
  tc: 0,
  ...over,
});

/** The finding's run: 4 flashcards (2 wrong, priced), then table plays with no wrong play. */
function mixed() {
  let s = structuredClone(EMPTY_STATS);
  s = applyEvents(s, [
    ev({ source: 'flashcard' }),
    ev({ source: 'flashcard' }),
    ev({ source: 'flashcard', correct: false, classification: 'basic-error', taken: 'stand', hand: 'hard-7-v-3', evCost: 0.2 }),
    ev({ source: 'flashcard', correct: false, classification: 'basic-error', taken: 'hit', expected: 'stand', hand: 'hard-13-v-4', evCost: 0.1 }),
    ev({ source: 'quiz', deviationId: '16v10', correct: false, classification: 'missed-deviation' }),
  ]);
  s = applyEvents(s, [
    ...Array.from({ length: 11 }, () => ev({ source: 'table' })),
    ev({ source: 'table', deviationId: '12v3' }),
    ev({ source: 'table', kind: 'wong', category: 'wong', correct: false, classification: 'basic-error', taken: 'sit-out', expected: 'play' }),
    ev({ source: 'table', correct: false, classification: 'basic-error', taken: 'stand', hand: 'hard-12-v-2', evCost: 0.05 }),
  ]);
  return s;
}

describe('D-R2: Stats > Play reads table decisions only', () => {
  it('hard is the table 12/13, not 14/17 pooled with Flashcards', () => {
    const s = mixed();
    expect(s.categories.hard).toEqual({ right: 14, wrong: 4 }); // the pooled figure the finding saw
    const p = playFigures(s);
    expect(p.categories.hard).toEqual({ right: 12, wrong: 1 });
    expect(p.categories.wong).toEqual({ right: 0, wrong: 1 });
  });
  it('mistakes, priced rows and per-index tallies leave the drills out', () => {
    const p = playFigures(mixed());
    expect(p.mistakes['basic-error']).toBe(2);
    expect(p.mistakes['missed-deviation']).toBe(0);
    expect(p.evCostRows.map((r) => r.hand)).toEqual(['hard-12-v-2']);
    expect(p.perIndex).toEqual({ '12v3': { right: 1, wrong: 0 } });
  });
  it('the drills keep their per-index answers on their own side', () => {
    expect(drillPerIndex(mixed())).toEqual({ '16v10': { right: 0, wrong: 1 } });
  });
  it('a blob from before the table slices shows no table figures', () => {
    const old = structuredClone(EMPTY_STATS);
    old.categories.hard = { right: 5, wrong: 1 };
    old.mistakes['basic-error'] = 1;
    const p = playFigures(old);
    expect(p.categories.hard).toEqual({ right: 0, wrong: 0 });
    expect(p.mistakes['basic-error']).toBe(0);
  });
});
