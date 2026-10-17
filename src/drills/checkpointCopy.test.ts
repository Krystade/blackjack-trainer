import { describe, expect, it } from 'vitest';
import { summarizeCheckpoints } from './countCheckpoints';
import { stretchLine } from './checkpointCopy';

/**
 * Wave A (s04 medium): the read-back said "After 47 cards: you said 1, it was
 * 1" in red (the adjusted grade disagreed with the matching numbers beside
 * it) and "you said -3, it was -2" in green. Each row now reads as a verdict
 * on its own stretch, and the colour (correct) always agrees with the words.
 */
describe('stretchLine', () => {
  // The reported run: +2 too high by card 24, then dropped 2 by card 47, which
  // cancelled -- the final count was right.
  const report = summarizeCheckpoints(
    [
      { atGroup: 23, cardsShown: 24, actual: 4, answer: 6 },
      { atGroup: 46, cardsShown: 47, actual: 1, answer: 1 },
    ],
    true,
    { cardsShown: 52, actual: 0, answer: 0 },
  );

  it('the first stop is absolute: off by how much, and both numbers', () => {
    const line = stretchLine(report.results[0]!);
    expect(line).toMatchObject({ fromCard: 1, toCard: 24, verdict: 'off by +2' });
    expect(line.detail).toBe('You said +6; it was +4.');
  });

  it('"you said 1, it was 1" under a miss reads as the stretch it was: dropped 2', () => {
    const r = report.results[1]!;
    expect(r.correct).toBe(false);
    const line = stretchLine(r);
    expect(line).toMatchObject({ fromCard: 25, toCard: 47, verdict: 'off by −2' });
    expect(line.detail).toBe('Your count moved −5; the cards moved −3.');
    // The matching absolute numbers are what read as a contradiction.
    expect(`${line.verdict} ${line.detail}`).not.toMatch(/it was/);
  });

  it('a right stretch after a slip says right, with no mismatched numbers', () => {
    const r = report.finalStretch!;
    expect(r.correct).toBe(true);
    const line = stretchLine(r);
    expect(line).toMatchObject({ fromCard: 48, toCard: 52, verdict: 'right' });
    expect(line.detail).toBe('Your count moved −1, as the cards did.');
  });

  it('a stretch with no change says so in words', () => {
    const flat = summarizeCheckpoints(
      [
        { atGroup: 2, cardsShown: 3, actual: 1, answer: 1 },
        { atGroup: 5, cardsShown: 6, actual: 1, answer: 2 },
      ],
      false,
    );
    expect(stretchLine(flat.results[1]!).detail).toBe('Your count moved +1; the cards stayed put.');
    expect(stretchLine(flat.results[0]!)).toMatchObject({ verdict: 'right', detail: 'You said +1; it was +1.' });
  });

  it('the verdict agrees with the grade on every row', () => {
    for (const r of [...report.results, report.finalStretch!]) {
      expect(stretchLine(r).verdict === 'right').toBe(r.correct);
    }
  });
});
