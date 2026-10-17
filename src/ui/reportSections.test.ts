import { describe, it, expect } from 'vitest';
import type { GradedEvent } from '../engine/grade';
import { reportSections, countMissText, drillCellIds, mistakeUnits, groupMistakes } from './reportSections';

const ev = (p: Partial<GradedEvent> & Pick<GradedEvent, 'kind'>): GradedEvent => ({
  category: 'hard', correct: false, classification: 'basic-error', taken: 'hit', expected: 'stand', reason: 'r', tc: 0, source: 'table', ...p,
});

describe('reportSections (B6/W12)', () => {
  it('plays, count checks and bets land in separate sections', () => {
    const s = reportSections([
      ev({ kind: 'countCheck', category: 'countCheck', taken: '2', expected: '0', reason: 'Running count check' }),
      ev({ kind: 'action', hand: '10,6 v 10', evCost: 0.1 }),
      ev({ kind: 'wong', category: 'wong', taken: 'play', expected: 'sit-out' }),
      ev({ kind: 'bet', category: 'bet', taken: '4', expected: '1' }),
      ev({ kind: 'insurance', category: 'insurance', taken: 'take', expected: 'decline' }),
    ]);
    expect(s.plays.map((r) => r.mistake.kind)).toEqual(['action', 'insurance']);
    expect(s.counts.map((r) => r.mistake.kind)).toEqual(['countCheck']);
    expect(s.bets.map((r) => r.mistake.kind)).toEqual(['bet', 'wong']);
  });
  it('plays are sorted by units lost; unpriced rows follow in the order they happened', () => {
    const s = reportSections([
      ev({ kind: 'action', hand: '9,3 v 4', taken: 'stand', expected: 'hit', classification: 'missed-deviation', deviationId: 'x' as GradedEvent['deviationId'] }),
      ev({ kind: 'action', hand: '10,6 v 10', evCost: 0.05 }),
      ev({ kind: 'action', hand: '8,8 v 4', taken: 'hit', expected: 'split', evCost: 0.61 }),
      ev({ kind: 'action', hand: 'A,7 v 9', taken: 'stand', expected: 'hit', evCost: 0.2 }),
    ]);
    expect(s.plays.map((r) => r.mistake.hand)).toEqual(['8,8 v 4', 'A,7 v 9', '10,6 v 10', '9,3 v 4']);
    expect(s.plays.map((r) => r.unitsTotal)).toEqual([0.61, 0.2, 0.05, null]);
  });
  it('a repeated mistake is one row whose cost is the total', () => {
    const rows = groupMistakes([ev({ kind: 'action', hand: '8,8 v 4', evCost: 0.3 }), ev({ kind: 'action', hand: '8,8 v 4', evCost: 0.3 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 2, unitsTotal: 0.6 });
  });
});

describe('countMissText (B6: RC off by N)', () => {
  it('says how far off the running and true counts were, with real minus signs', () => {
    expect(countMissText(ev({ kind: 'countCheck', taken: '2', expected: '0', reason: 'Running count check' }))).toBe('RC off by 2 · you said +2 · it was 0');
    expect(countMissText(ev({ kind: 'countCheck', taken: '-1', expected: '2', reason: 'True count check' }))).toBe('TC off by 3 · you said −1 · it was +2');
  });
  it('an unanswered check says so instead of "off by NaN"', () => {
    expect(countMissText(ev({ kind: 'countCheck', taken: '', expected: '-4', reason: 'Running count check' }))).toBe('RC not answered · it was −4');
  });
});

describe('drillCellIds (B6: Drill these hands)', () => {
  it('one id per chart cell, in report order, two hands on one cell collapse', () => {
    const rows = reportSections([
      ev({ kind: 'action', hand: '8,8 v 4', evCost: 0.6 }),
      ev({ kind: 'action', hand: '10,6 v 10', evCost: 0.1 }),
      ev({ kind: 'action', hand: '9,7 v K', evCost: 0.1, taken: 'stand', expected: 'hit' }),
    ]).plays;
    expect(drillCellIds(rows)).toEqual(['pair-8-v-4', 'hard-16-v-10']);
  });
  it('leaves out index plays, insurance and cells the Custom grid has no row for', () => {
    const rows = reportSections([
      ev({ kind: 'action', hand: '10,2 v 3', deviationId: 'i' as GradedEvent['deviationId'], classification: 'missed-deviation' }),
      ev({ kind: 'insurance', category: 'insurance', taken: 'take', expected: 'decline' }),
      ev({ kind: 'action', hand: '10,6,4 v 6', taken: 'hit', expected: 'stand', evCost: 0.8 }),
    ]).plays;
    expect(drillCellIds(rows)).toEqual([]);
  });
});

it('mistakeUnits adds priced mistakes only', () => {
  expect(mistakeUnits([ev({ kind: 'action', evCost: 0.5 }), ev({ kind: 'action', evCost: 0.25 }), ev({ kind: 'action' }), ev({ kind: 'bet', correct: true })])).toBeCloseTo(0.75);
});
