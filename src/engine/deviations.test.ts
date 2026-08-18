import { describe, it, expect } from 'vitest';
import { ILLUSTRIOUS_18, ILLUSTRIOUS_18_S17, indexSetFor } from './deviations';

/**
 * Index-threshold verification against published sources (2026-08-17).
 *
 * Wizard of Odds and casinoalpha both state the Illustrious 18 convention as
 * "stand/double/split when the true count is AT OR ABOVE the index, otherwise
 * hit", and both give the same negative indices: 13v2 = -1, 13v3 = -2,
 * 12v5 = -2, 12v6 = -1, 12v4 = 0.
 *
 * This codebase stores the negatives in the inverted `hit at TC <= threshold`
 * form, so threshold must be `index - 1`. Four of the five were storing the
 * raw index instead, which moves the decision boundary by one whole true
 * count: at exactly TC -1 the trainer demanded HIT on 13 v 2 where the
 * published index says STAND, and graded a correct stand as a missed
 * deviation. 12v4 was already converted, which is why the set was internally
 * inconsistent.
 */
describe('negative Hi-Lo indices match the published convention', () => {
  const lte = (id: string) => {
    const d = [...ILLUSTRIOUS_18].find((x) => x.id === id)!;
    expect(d.dir).toBe('lte');
    return d.threshold;
  };

  it('13 v 2 hits at TC <= -2 (index -1)', () => expect(lte('13v2')).toBe(-2));
  it('13 v 3 hits at TC <= -3 (index -2)', () => expect(lte('13v3')).toBe(-3));
  it('12 v 5 hits at TC <= -3 (index -2)', () => expect(lte('12v5')).toBe(-3));
  it('12 v 4 hits at TC <= -1 (index 0) — already correct', () => expect(lte('12v4')).toBe(-1));

  it('12 v 6 hits at TC <= -2 (index -1) under S17', () => {
    const d = ILLUSTRIOUS_18_S17.find((x) => x.id === '12v6')!;
    expect(d.threshold).toBe(-2);
  });

  it('stands at exactly the index, which is the boundary that was wrong', () => {
    // 13 v 2 at TC -1: the published index says STAND. Before this, the
    // deviation fired and the trainer demanded a hit.
    const d = [...ILLUSTRIOUS_18].find((x) => x.id === '13v2')!;
    expect(-1 <= d.threshold).toBe(false);
  });
});

/**
 * Deck-size-aware indices (operator request).
 *
 * The charts already select by deck class (d1/d2/d68); the indices did not,
 * so a single-deck profile was trained on shoe thresholds.
 *
 * Only ONE per-deck delta is published clearly enough to ship: the insurance
 * index, given by two independent sources as 1D 1.4 / 2D 2.4 / 6D 3.0. This
 * app's true count is an integer, so 2.4 and 3.0 both mean "take at TC >= 3"
 * and only single deck actually moves — to TC >= 2.
 *
 * No other per-deck deltas are invented here. The published I18 is a single
 * set, and practitioners commonly use shoe indices at every deck count
 * because the EV difference is negligible; guessing values would be exactly
 * the failure this trainer must not have.
 */
describe('indexSetFor — deck-size-aware indices', () => {
  const ins = (decks: 1 | 2 | 6 | 8, s17: boolean) =>
    indexSetFor({ decks, s17 }).find((d) => d.id === 'ins')!;

  it('takes insurance at TC >= 3 in a shoe game', () => {
    expect(ins(6, false).threshold).toBe(3);
    expect(ins(8, false).threshold).toBe(3);
  });

  it('takes insurance at TC >= 2 in a single-deck game', () => {
    // Published 1.4; with an integer true count that is TC >= 2.
    expect(ins(1, false).threshold).toBe(2);
  });

  it('keeps double deck at TC >= 3, because 2.4 rounds there on an integer count', () => {
    expect(ins(2, false).threshold).toBe(3);
  });

  it('still applies the S17 overrides at every deck count', () => {
    const s17single = indexSetFor({ decks: 1, s17: true });
    expect(s17single.find((d) => d.id === '11vA')!.active).toBe(true);
    expect(s17single.find((d) => d.id === '16v9')!.threshold).toBe(5);
    // ...and the single-deck insurance delta survives the S17 mapping.
    expect(s17single.find((d) => d.id === 'ins')!.threshold).toBe(2);
  });

  it('leaves the hard-total indices identical across deck counts', () => {
    // Deliberate: no published per-deck values for these, so they must not
    // silently differ. This test exists so a future edit has to be explicit.
    const shoe = indexSetFor({ decks: 6, s17: false });
    const single = indexSetFor({ decks: 1, s17: false });
    for (const d of shoe.filter((x) => x.id !== 'ins')) {
      expect(single.find((x) => x.id === d.id)!.threshold).toBe(d.threshold);
    }
  });
});
