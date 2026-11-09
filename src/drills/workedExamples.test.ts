import { describe, expect, it } from 'vitest';
import { trueCount, type TcRounding } from '../engine/count';
import { signedTc } from './tcFeedback';
import {
  NEGATIVE_EXAMPLE,
  PRODUCE_EXAMPLE,
  TRAY_EXAMPLE,
  deckEstimationExample,
  produceTcExample,
  roundingContrast,
  trueCountExample,
} from './workedExamples';

const ROUNDINGS: TcRounding[] = ['floor', 'truncate', 'round'];

describe('worked examples', () => {
  it('the negative example really separates floor from truncate (else it teaches nothing)', () => {
    const { runningCount, decksRemaining } = NEGATIVE_EXAMPLE;
    expect(trueCount(runningCount, decksRemaining, 'floor')).toBe(-4);
    expect(trueCount(runningCount, decksRemaining, 'truncate')).toBe(-3);
  });

  it.each(ROUNDINGS)("true count (%s): every sum ends on the drill's own answer, and names the profile's rounding", (r) => {
    const ex = trueCountExample(r);
    expect(ex.examples[0]).toMatch(new RegExp(`→ ${r} ${signedTc(trueCount(6, 3, r)).replace('+', '\\+')}$`));
    const neg = trueCount(NEGATIVE_EXAMPLE.runningCount, NEGATIVE_EXAMPLE.decksRemaining, r);
    expect(ex.examples[1]!.endsWith(`${r} ${signedTc(neg)}`)).toBe(true);
    const verb = { floor: 'floors', truncate: 'truncates', round: 'rounds' }[r];
    expect(ex.lines.join(' ')).toContain(`Your profile ${verb}`);
  });

  it.each([
    [
      'floor',
      'Your profile floors: it always rounds down. Set it in Profile › True count rounding.',
      'Below zero the rounding matters: truncate and round would both give −3.',
    ],
    [
      'truncate',
      'Your profile truncates: it rounds toward zero, dropping the fraction. Set it in Profile › True count rounding.',
      'Below zero the rounding matters: floor would give −4.',
    ],
    [
      'round',
      'Your profile rounds: it rounds to the nearest whole number. Set it in Profile › True count rounding.',
      'Below zero the rounding matters: floor would give −4.',
    ],
  ] as const)('true count (%s): the profile and contrast lines read naturally', (r, profileLine, contrastLine) => {
    const lines = trueCountExample(r).lines;
    expect(lines[1]).toBe(profileLine);
    expect(lines[2]).toBe(contrastLine);
  });

  it('roundingContrast: agreeing alternatives are grouped, and no contrast when all agree', () => {
    // −5 ÷ 1.5 = −3.33: floor −4, truncate −3, round −3.
    expect(roundingContrast('floor', -5, 1.5)).toBe('truncate and round would both give −3');
    // +5 ÷ 1.5 = 3.33: all three give +3.
    expect(roundingContrast('floor', 5, 1.5)).toBe('');
    // −8 ÷ 3 = −2.67: floor −3, truncate −2, round −3.
    expect(roundingContrast('truncate', -8, 3)).toBe('floor and round would both give −3');
    expect(roundingContrast('round', -8, 3)).toBe('truncate would give −2');
    // +8 ÷ 3 = 2.67: floor +2, truncate +2, round +3.
    expect(roundingContrast('round', 8, 3)).toBe('floor and truncate would both give +2');
  });

  it('roundingContrast: never a run-on list (round always equals floor or truncate)', () => {
    for (const rc of [-13, -10, -8, -7, -5, 5, 7, 8, 10, 13])
      for (const d of [1.5, 2, 2.5, 3])
        for (const r of ROUNDINGS) expect(roundingContrast(r, rc, d)).not.toContain(',');
  });

  it('deck estimation: the text matches the tray it draws, and follows the resolution', () => {
    const ex = deckEstimationExample('half');
    expect(ex.tray).toEqual({ cardsDealt: Math.round(TRAY_EXAMPLE.decksDealt * 52), decks: TRAY_EXAMPLE.decks });
    expect(ex.examples[0]).toBe('The tray holds about 2½ decks of 6, so 3½ are left.');
    expect(deckEstimationExample('quarter').lines[1]).toContain('quarter');
    expect(deckEstimationExample('half').lines[1]).not.toContain('quarter');
  });

  it.each(ROUNDINGS)('produce the true count (%s): +8 with 4 decks left is +2, from the tray drawn', (r) => {
    const ex = produceTcExample(r);
    const left = PRODUCE_EXAMPLE.decks - PRODUCE_EXAMPLE.decksDealt;
    expect(left).toBe(4);
    expect(ex.tray).toEqual({ cardsDealt: PRODUCE_EXAMPLE.decksDealt * 52, decks: PRODUCE_EXAMPLE.decks });
    expect(ex.examples[1]).toBe(`+8 ÷ 4 = 2 → ${r} +2`);
    expect(trueCount(PRODUCE_EXAMPLE.runningCount, left, r)).toBe(2);
  });
});
