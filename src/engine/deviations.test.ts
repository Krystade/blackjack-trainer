import { describe, it, expect } from 'vitest';
import { ILLUSTRIOUS_18, ILLUSTRIOUS_18_S17 } from './deviations';

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
