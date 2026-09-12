import { describe, it, expect } from 'vitest';
import { parseCell, confusabilityWeight } from './confusability';
import { generateAllCells } from './flashcards';

describe('parseCell', () => {
  it('reads the three things that make two cells confusable', () => {
    expect(parseCell('hard-16-v-9')).toEqual({ kind: 'hard', value: 16, up: 9 });
    expect(parseCell('soft-18-v-A')).toEqual({ kind: 'soft', value: 18, up: 11 });
    expect(parseCell('pair-8-v-10')).toEqual({ kind: 'pair', value: 8, up: 10 });
  });

  it('treats an ace as 11 on both axes, so it neighbours the ten like the chart does', () => {
    expect(parseCell('pair-A-v-A')).toEqual({ kind: 'pair', value: 11, up: 11 });
  });

  it('returns null for an unrecognised shape rather than inventing neighbours', () => {
    expect(parseCell('quads-16-v-2')).toBeNull();
    expect(parseCell('hard-16')).toBeNull();
    expect(parseCell('hard-x-v-9')).toBeNull();
    expect(parseCell('hard-16-v-Z')).toBeNull();
    expect(parseCell('')).toBeNull();
  });

  it('parses every cell the app actually ships', () => {
    // Vacuity guard on the whole module: a parser that returned null for real
    // cells would make every weight below a silent 1.0.
    for (const c of generateAllCells()) {
      expect(parseCell(c.id), c.id).not.toBeNull();
    }
  });
});

describe('confusabilityWeight', () => {
  it('boosts the same row one line out -- 16 v 10 then 15 v 10', () => {
    expect(confusabilityWeight('hard-15-v-10', 'hard-16-v-10')).toBeGreaterThan(1);
  });

  it('boosts the same line one column out -- 12 v 2 then 12 v 3', () => {
    expect(confusabilityWeight('hard-12-v-3', 'hard-12-v-2')).toBeGreaterThan(1);
  });

  it('boosts hardest across hand SHAPE at the same total -- soft 18 after hard 18', () => {
    // Same number in your head, different right answer: the costliest mix-up,
    // and the one V4-2's varied compositions were built to expose.
    const shape = confusabilityWeight('soft-18-v-9', 'hard-18-v-9');
    const row = confusabilityWeight('hard-17-v-9', 'hard-18-v-9');
    expect(shape).toBeGreaterThan(row);
  });

  it('leaves an unrelated cell completely alone', () => {
    expect(confusabilityWeight('pair-2-v-7', 'hard-19-v-3')).toBe(1);
  });

  it('never boosts a cell against itself -- that is massed practice, not interleaving', () => {
    // NOTE: this holds by construction, not because of the early return that
    // states it -- see the comment in confusability.ts. Deleting that guard
    // leaves this green. Asserted across the whole chart anyway, because the
    // property is what matters and a future rule could break it.
    for (const c of generateAllCells()) {
      expect(confusabilityWeight(c.id, c.id), c.id).toBe(1);
    }
  });

  it('is a no-op with no previous cell, so the first draw of a session is untouched', () => {
    for (const c of generateAllCells()) {
      expect(confusabilityWeight(c.id, null), c.id).toBe(1);
    }
  });

  it('never returns zero or below for any real cell pair -- nothing leaves the deck', () => {
    // The same guarantee handFrequency.ts makes: this may only ever RAISE a
    // cell's odds. A term that could reach 0 would make part of the chart
    // unreachable for a whole session.
    const cells = generateAllCells();
    const previous = ['hard-16-v-10', 'soft-18-v-9', 'pair-8-v-6', 'hard-12-v-2'];
    for (const prev of previous) {
      for (const c of cells) {
        expect(confusabilityWeight(c.id, prev), `${c.id} after ${prev}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('boosts a decisive minority, not most of the chart', () => {
    // If nearly everything were "confusable" the term would be a no-op with
    // extra steps. It must actually discriminate.
    const cells = generateAllCells();
    const boosted = cells.filter((c) => confusabilityWeight(c.id, 'hard-16-v-10') > 1);
    expect(boosted.length).toBeGreaterThan(3);
    expect(boosted.length).toBeLessThan(cells.length / 10);
  });

  it('degrades to 1 for an unparseable id on either side', () => {
    expect(confusabilityWeight('quads-16-v-2', 'hard-16-v-10')).toBe(1);
    expect(confusabilityWeight('hard-16-v-10', 'quads-16-v-2')).toBe(1);
  });

  it('ranks a near neighbour above a two-out one, and both above a stranger', () => {
    const near = confusabilityWeight('hard-15-v-10', 'hard-16-v-10');
    const far = confusabilityWeight('hard-14-v-10', 'hard-16-v-10');
    const stranger = confusabilityWeight('hard-8-v-10', 'hard-16-v-10');
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(stranger);
    expect(stranger).toBe(1);
  });
});
