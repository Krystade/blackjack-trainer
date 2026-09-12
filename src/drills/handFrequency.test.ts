import { describe, it, expect } from 'vitest';
import { handProb, upProb, cellFrequency, frequencyWeight } from './handFrequency';
import { generateAllCells } from './flashcards';

describe('handProb', () => {
  it('a pair of tens is the commonest pair, by the ten-family margin', () => {
    expect(handProb('pair-10-v-2')).toBeCloseTo((4 / 13) ** 2, 10);
    expect(handProb('pair-8-v-2')).toBeCloseTo((1 / 13) ** 2, 10);
    expect(handProb('pair-10-v-2')).toBeCloseTo(16 * handProb('pair-8-v-2'), 10);
  });

  it('a two-value hand arrives both ways round, a pair does not', () => {
    // soft 18 is A+7, which can be dealt A-then-7 or 7-then-A.
    expect(handProb('soft-18-v-2')).toBeCloseTo(2 * (1 / 13) * (1 / 13), 10);
    expect(handProb('pair-7-v-2')).toBeCloseTo((1 / 13) * (1 / 13), 10);
  });

  it('a hard total sums over every composition of it', () => {
    // 16 = 6+10 and 7+9.
    const expected = 2 * (1 / 13) * (4 / 13) + 2 * (1 / 13) * (1 / 13);
    expect(handProb('hard-16-v-2')).toBeCloseTo(expected, 10);
  });

  it('hard 16 really is far commoner than hard 5 -- the whole premise', () => {
    expect(handProb('hard-16-v-2') / handProb('hard-5-v-2')).toBeGreaterThan(4);
  });

  it('an unrecognised cell shape is zero, not an invented weight', () => {
    expect(handProb('quads-16-v-2')).toBe(0);
    expect(handProb('soft-99-v-2')).toBe(0);
    expect(handProb('pair-Z-v-2')).toBe(0);
  });
});

describe('upProb', () => {
  it('a ten upcard is four times any other', () => {
    expect(upProb('hard-16-v-10')).toBeCloseTo(4 / 13, 10);
    expect(upProb('hard-16-v-A')).toBeCloseTo(1 / 13, 10);
    expect(upProb('hard-16-v-7')).toBeCloseTo(1 / 13, 10);
  });

  it('every upcard together is one whole card', () => {
    const ups = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
    const total = ups.reduce((n, up) => n + upProb(`hard-16-v-${up}`), 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('cellFrequency over the real chart', () => {
  const cells = generateAllCells();

  it('every shipped cell has a real, positive frequency', () => {
    for (const c of cells) {
      expect(cellFrequency(c.id), c.id).toBeGreaterThan(0);
    }
  });

  it('the chart plus the naturals is the whole deal, exactly', () => {
    // Vacuity guard on the model itself: if a hand shape were missed or
    // double-counted, this is where it shows. The chart is every two-card
    // deal EXCEPT a natural, which has no decision and so has no cell -- so
    // the 330 cells and A+ten must together account for all of it.
    const total = cells.reduce((n, c) => n + cellFrequency(c.id), 0);
    const natural = 2 * (1 / 13) * (4 / 13);
    expect(total + natural).toBeCloseTo(1, 8);
    // And the gap really is the naturals, not slack absorbing an error.
    expect(1 - total).toBeCloseTo(natural, 10);
  });

  it('the commonest cell is a ten-heavy one against a ten', () => {
    const top = [...cells].sort((a, b) => cellFrequency(b.id) - cellFrequency(a.id))[0]!;
    expect(top.id).toContain('-v-10');
  });
});

describe('frequencyWeight', () => {
  const cells = generateAllCells();

  it('compresses the spread so no cell effectively leaves the deck', () => {
    const weights = cells.map((c) => frequencyWeight(c.id));
    const raw = cells.map((c) => cellFrequency(c.id));
    const ratio = (xs: number[]) => Math.max(...xs) / Math.min(...xs);
    // The raw probabilities span a huge range; the weight must not.
    expect(ratio(raw)).toBeGreaterThan(30);
    expect(ratio(weights)).toBeLessThan(ratio(raw));
    expect(ratio(weights)).toBeLessThan(10);
  });

  it('is never zero for a real cell -- nothing becomes unreachable', () => {
    for (const c of cells) {
      expect(frequencyWeight(c.id), c.id).toBeGreaterThan(0);
    }
  });

  it('still ranks cells the same way the raw frequency does', () => {
    // Compression must not reorder: a commoner hand stays commoner.
    expect(frequencyWeight('hard-16-v-10')).toBeGreaterThan(frequencyWeight('hard-5-v-10'));
    expect(frequencyWeight('pair-10-v-10')).toBeGreaterThan(frequencyWeight('pair-2-v-10'));
    expect(frequencyWeight('hard-16-v-10')).toBeGreaterThan(frequencyWeight('hard-16-v-A'));
  });

  it('an unknown cell weighs nothing rather than defaulting into the draw', () => {
    expect(frequencyWeight('quads-16-v-2')).toBe(0);
  });
});
