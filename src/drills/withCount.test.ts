import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../engine/cards';
import type { Card } from '../engine/cards';
import { DEFAULT_RULES } from '../engine/ruleset';
import { correctPlay } from '../engine/strategy';
import { indexSetFor } from '../engine/deviations';
import { drawFlashcard } from './flashcards';
import { FULL_CTX } from './fallbackHand';
import { drawCountTc, indexLine, indexPickerText, reachableIndexes, withCountAdvice, PLAIN_MIN, PLAIN_MAX, TC_MIN, TC_MAX } from './withCount';

const hand = (...ranks: string[]): Card[] => ranks.map((rank) => ({ rank, suit: 's' }) as Card);
const NO_LS = { ...DEFAULT_RULES, ls: false };

describe('#53 reachableIndexes', () => {
  it('12 v 4 has its index; 20 v 4 has none', () => {
    expect(reachableIndexes(hand('10', '2'), '4', FULL_CTX, DEFAULT_RULES).map((d) => d.id)).toEqual(['12v4']);
    expect(reachableIndexes(hand('10', 'K'), '4', FULL_CTX, DEFAULT_RULES)).toEqual([]);
  });
  it('16 v 10 surrenders at every count when surrender is on, so its stand index never applies', () => {
    expect(reachableIndexes(hand('10', '6'), '10', FULL_CTX, DEFAULT_RULES)).toEqual([]);
    expect(reachableIndexes(hand('10', '6'), '10', FULL_CTX, NO_LS).map((d) => d.id)).toEqual(['16v10']);
  });
});

describe('#53 drawCountTc', () => {
  it('a hand with an index sits at or past it about half the time or more', () => {
    const rng = mulberry32(5);
    let past = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const tc = drawCountTc(hand('10', '2'), '4', FULL_CTX, DEFAULT_RULES, rng);
      expect(tc).toBeGreaterThanOrEqual(TC_MIN);
      expect(tc).toBeLessThanOrEqual(TC_MAX);
      if (tc <= -1) past++;
    }
    expect(past / N).toBeGreaterThan(0.5);
  });
  it('a hand with no index draws from the plain range', () => {
    const rng = mulberry32(6);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(drawCountTc(hand('10', 'K'), '4', FULL_CTX, DEFAULT_RULES, rng));
    expect(Math.min(...seen)).toBe(PLAIN_MIN);
    expect(Math.max(...seen)).toBe(PLAIN_MAX);
  });
});

describe('#53 indexLine', () => {
  it('names the index that applied, or says none did', () => {
    expect(indexLine(correctPlay(hand('10', '6'), '10', 0, FULL_CTX, NO_LS), NO_LS)).toBe('Index: 16 v 10: stand at TC ≥ 0');
    expect(indexLine(correctPlay(hand('10', '6'), '10', -1, FULL_CTX, NO_LS), NO_LS)).toBe('No index here');
  });
  it('Wave A: on an index cell short of its index, names the index instead of "No index here"', () => {
    const h = { cards: hand('4', '8'), up: '2' as const, ctx: FULL_CTX };
    expect(indexLine(correctPlay(h.cards, h.up, 0, FULL_CTX, NO_LS), NO_LS, h)).toBe(
      'Index not reached at this count: 12 v 2: stand at TC ≥ +3',
    );
    const none = { cards: hand('10', 'K'), up: '4' as const, ctx: FULL_CTX };
    expect(indexLine(correctPlay(none.cards, none.up, 0, FULL_CTX, NO_LS), NO_LS, none)).toBe('No index here');
  });
  it('Wave A: the picker text carries no threshold', () => {
    expect(indexPickerText({ id: '9v2', label: '9 v 2: double at TC ≥ +1', kind: 'hard', action: 'double', dir: 'gte' })).toBe('9 v 2 (double)');
    expect(indexPickerText({ id: 'sur15v10', label: '15 v 10: surrender at TC ≥ 0', kind: 'surrender', action: 'surrender', dir: 'gte' })).toBe('15 v 10 (surrender)');
    expect(indexPickerText({ id: 'ins', label: 'Insurance: take at TC ≥ +3', kind: 'insurance', action: 'take-insurance', dir: 'gte' })).toBe('Insurance');
  });
  it('H6 (R6): the picker names the published play, never the stored lte side', () => {
    const h17 = indexSetFor({ ...DEFAULT_RULES, s17: false });
    const t12v6 = h17.find((d) => d.id === '12v6')!;
    expect(t12v6.dir).toBe('lte'); // stored as "hit at TC ≤ −4"
    expect(indexPickerText(t12v6)).toBe('12 v 6 (stand)');
    expect(indexPickerText(t12v6)).not.toContain('hit');
    // Every lte entry, under every deck count and rule: the play in the
    // picker is the play the label (published form) names.
    for (const decks of [1, 2, 6, 8] as const) {
      for (const s17 of [false, true]) {
        for (const dev of indexSetFor({ ...DEFAULT_RULES, decks, s17, bjaExtras: true, surrenderIndices: true })) {
          if (dev.kind === 'insurance') continue;
          const play = /: (\w+) at TC/.exec(dev.label)?.[1];
          if (!play) continue;
          expect(indexPickerText(dev), `${decks}D s17=${s17} ${dev.id}`).toBe(`${dev.label.split(':')[0]!.trim()} (${play})`);
        }
      }
    }
  });
});

describe('#53 drawFlashcard with count', () => {
  it('every card carries a TC and its answer is correctPlay at that TC', () => {
    let deviations = 0;
    for (let seed = 0; seed < 2000; seed++) {
      const card = drawFlashcard(['hard', 'soft', 'pairs'], {}, 0, seed, NO_LS, false, null, null, { withCount: true });
      expect(card.tc).toBeTypeOf('number');
      const advice = correctPlay(card.cards, card.up, card.tc!, card.ctx ?? FULL_CTX, NO_LS);
      expect(card.correct).toBe(advice.action);
      if (advice.deviationId) deviations++;
    }
    expect(deviations).toBeGreaterThan(0);
  });

  it('off: no TC, and the draw is unchanged', () => {
    for (let seed = 0; seed < 200; seed++) {
      const card = drawFlashcard('all', {}, 0, seed, DEFAULT_RULES, false, null, null, { withCount: false });
      expect(card).toEqual(drawFlashcard('all', {}, 0, seed, DEFAULT_RULES));
      expect(card.tc).toBeUndefined();
    }
  });

  it('on the indexes deck, a meaningful share of hands are graded on their index', () => {
    const deck = new Map([
      ['hard-12-v-4', 1],
      ['hard-16-v-10', 1],
      ['hard-9-v-2', 1],
    ]);
    let applied = 0;
    const N = 1000;
    for (let seed = 0; seed < N; seed++) {
      const card = drawFlashcard('all', {}, 0, seed, NO_LS, false, null, deck, { withCount: true });
      if (correctPlay(card.cards, card.up, card.tc!, FULL_CTX, NO_LS).deviationId) applied++;
    }
    expect(applied / N).toBeGreaterThan(0.4);
  });
});

/**
 * Wave A review (s08 carried into Flashcards): on 2 decks the basic chart
 * already doubles 9 v 2 and 11 v A, so the 6-deck index is no index at all.
 * The Deviation quiz leaves them out; a With-count card must agree -- never
 * "Index not reached at this count: 9 v 2: double at TC >= +1" under a graded
 * Double at TC 0, and never an index attribution for a play the chart makes.
 */
describe('Wave A: With-count cards on a chart that already plays the index', () => {
  const TWO_D: typeof DEFAULT_RULES = { ...DEFAULT_RULES, decks: 2, s17: true, ls: false };
  const nine = { cards: hand('5', '4'), up: '2' as const, ctx: FULL_CTX };
  const eleven = { cards: hand('6', '5'), up: 'A' as const, ctx: FULL_CTX };

  it('9 v 2 and 11 v A have no reachable index on 2D S17; 6D keeps them', () => {
    expect(reachableIndexes(nine.cards, nine.up, FULL_CTX, TWO_D)).toEqual([]);
    expect(reachableIndexes(eleven.cards, eleven.up, FULL_CTX, TWO_D)).toEqual([]);
    const sixD = { ...TWO_D, decks: 6 as const };
    expect(reachableIndexes(nine.cards, nine.up, FULL_CTX, sixD).map((d) => d.id)).toEqual(['9v2']);
    expect(reachableIndexes(eleven.cards, eleven.up, FULL_CTX, sixD).map((d) => d.id)).toEqual(['11vA']);
  });

  it('the advice keeps the play and drops the index id, at every count', () => {
    for (let tc = TC_MIN; tc <= TC_MAX; tc++) {
      for (const h of [nine, eleven]) {
        const raw = correctPlay(h.cards, h.up, tc, FULL_CTX, TWO_D);
        const adv = withCountAdvice(h.cards, h.up, tc, FULL_CTX, TWO_D);
        expect(adv.action).toBe(raw.action);
        expect(adv.action).toBe('double');
        expect(adv.deviationId, `${h.up} at TC ${tc}`).toBeUndefined();
      }
    }
    // 6D: the index is real, and kept.
    const sixD = { ...TWO_D, decks: 6 as const };
    expect(withCountAdvice(nine.cards, nine.up, 1, FULL_CTX, sixD).deviationId).toBe('9v2');
  });

  it('the strip never says an index was not reached under the index play', () => {
    for (const tc of [-1, 0, 1, 3]) {
      for (const h of [nine, eleven]) {
        const line = indexLine(withCountAdvice(h.cards, h.up, tc, FULL_CTX, TWO_D), TWO_D, h);
        expect(line).not.toMatch(/not reached|^Index:/);
        expect(line).toMatch(/basic already doubles/);
      }
    }
  });

  it('counts are not drawn toward an index the chart already plays', () => {
    // Biased toward +1 the share at +1..+3 is about 2/3; uniform over the
    // plain range it is 3/9.
    const rng = mulberry32(9);
    const N = 3000;
    let nearIndex = 0;
    for (let i = 0; i < N; i++) {
      const tc = drawCountTc(nine.cards, nine.up, FULL_CTX, TWO_D, rng);
      expect(tc).toBeGreaterThanOrEqual(PLAIN_MIN);
      expect(tc).toBeLessThanOrEqual(PLAIN_MAX);
      if (tc >= 1 && tc <= 3) nearIndex++;
    }
    expect(nearIndex / N).toBeLessThan(0.45);
  });
});

describe('BJA extras are reachable from a soft hand', () => {
  it('A,8 v 4 carries A8v4 only with the option on', () => {
    const ctx = { canDouble: true, canSplit: true, canSurrender: false };
    expect(reachableIndexes(hand('A', '8'), '4', ctx, { ...DEFAULT_RULES, bjaExtras: true }).map((d) => d.id)).toEqual(['A8v4']);
    expect(reachableIndexes(hand('A', '8'), '4', ctx, DEFAULT_RULES)).toEqual([]);
  });
});
