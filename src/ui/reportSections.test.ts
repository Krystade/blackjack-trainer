import { describe, it, expect } from 'vitest';
import type { GradedEvent } from '../engine/grade';
import type { Rank } from '../engine/cards';
import { DEFAULT_RULES } from '../engine/ruleset';
import { playMissReason } from './screens/playMissReason';
import { reportSections, countMissText, drillCellIds, mistakeUnits, groupMistakes, betRowText, playRowText, unpricedNote } from './reportSections';

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

describe('betRowText (B2 #15): the bets list in plain words', () => {
  it('a bet off the ramp', () => {
    expect(betRowText(ev({ kind: 'bet', category: 'bet', taken: '2', expected: '1', tc: 0, reason: 'Spread bet at tc 0' }))).toBe(
      'TC +0 · you bet 2u · your ramp bets 1u',
    );
  });
  it('played a count the ramp sits out, and sat out one it plays, with real minus signs', () => {
    expect(betRowText(ev({ kind: 'wong', category: 'wong', taken: 'play', expected: 'sit-out', tc: -2, reason: 'Wong decision at tc -2' }))).toBe(
      'TC −2 · you played · your ramp sits out',
    );
    expect(betRowText(ev({ kind: 'wong', category: 'wong', taken: 'sit-out', expected: 'play', tc: 1, reason: 'Wong decision at tc 1' }))).toBe(
      'TC +1 · you sat out · your ramp plays',
    );
  });
  it('names the cover allowance when the session graded with it', () => {
    expect(
      betRowText(ev({ kind: 'bet', category: 'bet', taken: '12', expected: '2', tc: 1, reason: 'Spread bet at tc 1 (cover: one rung either side)' })),
    ).toBe('TC +1 · you bet 12u · your ramp bets 2u (one rung either side allowed)');
  });
  it('never prints the engine jargon', () => {
    for (const m of [
      ev({ kind: 'bet', category: 'bet', taken: '2', expected: '1', tc: 0, reason: 'Spread bet at tc 0' }),
      ev({ kind: 'wong', category: 'wong', taken: 'play', expected: 'sit-out', tc: 0, reason: 'Wong decision at tc 0' }),
    ]) {
      expect(betRowText(m)).not.toMatch(/wong|sit-out|played play|tc \d|Spread bet|—/);
    }
  });
});

describe('playRowText (B2 #49): insurance reads like the play rows', () => {
  it('capitalised Take/Decline, a real minus, and no repeated lowercase reason', () => {
    const m = ev({ kind: 'insurance', category: 'insurance', hand: 'dealer A', taken: 'take', expected: 'decline', tc: -6, reason: 'Insurance vs dealer A at tc -6' });
    expect(playRowText(m)).toBe('dealer A · TC −6 · you played Take · correct Decline');
  });
  it('a play row keeps its reason', () => {
    const m = ev({ kind: 'action', hand: '10,6 v 10', taken: 'hit', expected: 'stand', tc: 0, reason: 'Basic strategy' });
    expect(playRowText(m)).toBe('10,6 v 10 · TC +0 · you played Hit · correct Stand — Basic strategy');
  });
  it('the unpriced note is singular for one miss', () => {
    expect(unpricedNote(1)).toBe('Plus 1 index or insurance miss with no price.');
    expect(unpricedNote(3)).toBe('Plus 3 index or insurance misses with no price.');
  });
});

describe('H7: a play row reads the wrong-play card reason, not the engine placeholder', () => {
  const card = (cards: string[], up: string, canSplit = true) =>
    playMissReason({
      reason: 'unused',
      classification: 'basic-error',
      cards: cards.map((rank) => ({ rank: rank as Rank, suit: 's' as const })),
      dealerUp: up as Rank,
      canSplit,
      rules: DEFAULT_RULES,
    });

  it('a basic miss row carries the chart region and bust line, as the card does', () => {
    const m = ev({ kind: 'action', hand: '9,4 v 10', taken: 'stand', expected: 'hit', reason: 'Basic hit vs dealer 10', evCost: 0.05 });
    const row = playRowText(m, DEFAULT_RULES);
    expect(row).not.toMatch(/Basic \w+ vs dealer/);
    expect(row).toContain(card(['9', '4'], '10'));
    expect(row).toMatch(/— Hard [^:]+: hit\. Dealer busts \d+%/);
    expect(row.startsWith('9,4 v 10 · TC +0 · you played Stand · correct Hit — ')).toBe(true);
    // Without the rules (an older caller) the engine reason stands.
    expect(playRowText(m)).toContain('— Basic hit vs dealer 10');
  });

  it('a multi-card hand and a face-card up card read their cell too', () => {
    const m = ev({ kind: 'action', hand: '5,4,7 v K', taken: 'stand', expected: 'hit', reason: 'Basic hit vs dealer K' });
    const row = playRowText(m, DEFAULT_RULES);
    expect(row).not.toMatch(/Basic \w+ vs dealer/);
    expect(row).toContain(card(['5', '4', '7'], 'K'));
  });

  it('a pair graded as its total (no split left) reads the total, not the split row', () => {
    const m = ev({ kind: 'action', hand: '8,8 v 10', taken: 'stand', expected: 'hit', reason: 'Basic hit vs dealer 10' });
    const row = playRowText(m, DEFAULT_RULES);
    expect(row).toContain(card(['8', '8'], '10', false));
    expect(row).not.toMatch(/split/i);
    // ...while a splittable pair reads its pair row.
    const split = playRowText(ev({ kind: 'action', hand: '8,8 v 6', taken: 'hit', expected: 'split', reason: 'Basic split vs dealer 6' }), DEFAULT_RULES);
    expect(split).toContain(card(['8', '8'], '6'));
    expect(split).toMatch(/— 8,8 v [^:]+: split\./);
  });

  it('an index miss keeps its index label', () => {
    const m = ev({ kind: 'action', hand: '10,6 v 10', taken: 'hit', expected: 'stand', classification: 'missed-deviation', deviationId: 'h16v10' as GradedEvent['deviationId'], reason: '16 v 10: stand at TC ≥ 0' });
    expect(playRowText(m, DEFAULT_RULES)).toContain('— 16 v 10: stand at TC ≥ 0');
  });
});

describe('Wave J: back-count rows', () => {
  it('the entry, both ways, against the entry point', () => {
    expect(betRowText(ev({ kind: 'wongIn', category: 'wongIn', taken: 'watch', expected: 'sit-in', tc: 2, wongInTc: 1 }))).toBe(
      'TC +2 · you watched · you enter at +1',
    );
    expect(betRowText(ev({ kind: 'wongIn', category: 'wongIn', taken: 'sit-in', expected: 'watch', tc: -1, wongInTc: 0 }))).toBe(
      'TC −1 · you sat in · you enter at +0',
    );
  });
  it('leaving above the exit point', () => {
    expect(betRowText(ev({ kind: 'wong', category: 'wong', taken: 'leave', expected: 'play', tc: 1 }))).toBe(
      'TC +1 · you left · your ramp plays',
    );
  });
  it('entries are listed with the bets, after the exits', () => {
    const s = reportSections([
      ev({ kind: 'wongIn', category: 'wongIn', taken: 'watch', expected: 'sit-in', tc: 2, wongInTc: 1 }),
      ev({ kind: 'wong', category: 'wong', taken: 'leave', expected: 'play', tc: 1 }),
    ]);
    expect(s.bets.map((r) => r.mistake.kind)).toEqual(['wong', 'wongIn']);
    expect(s.plays).toEqual([]);
  });
});

describe('Wave J: a two-hand ramp bet row names the hands', () => {
  it('the hands reason', () => {
    expect(betRowText(ev({ kind: 'bet', category: 'bet', taken: '8', expected: '8', tc: 4, handsTaken: 1, handsExpected: 2, reason: 'Spread bet at tc 4, two hands' }))).toBe(
      'TC +4 · you bet one hand of 8u · your ramp bets two hands of 8u',
    );
  });
  it('with cover on, the tolerance note stays', () => {
    expect(
      betRowText(ev({ kind: 'bet', category: 'bet', taken: '4', expected: '8', tc: 4, handsTaken: 2, handsExpected: 2, reason: 'Spread bet at tc 4, two hands (cover: one rung either side)' })),
    ).toBe('TC +4 · you bet two hands of 4u · your ramp bets two hands of 8u (one rung either side allowed)');
  });
  it('one hand on both sides is the plain row', () => {
    expect(betRowText(ev({ kind: 'bet', category: 'bet', taken: '4', expected: '2', tc: 1, handsTaken: 1, handsExpected: 1, reason: 'Spread bet at tc 1, one hand' }))).toBe(
      'TC +1 · you bet 4u · your ramp bets 2u',
    );
  });
});
