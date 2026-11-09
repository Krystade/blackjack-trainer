import { describe, expect, it } from 'vitest';
import { trueCount, type TcRounding } from '../engine/count';
import { signedTc } from './tcFeedback';
import {
  NEGATIVE_EXAMPLE,
  PRODUCE_EXAMPLE,
  TRAY_EXAMPLE,
  deckEstimationExample,
  produceTcExample,
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

  it('true count: the contrast line names only conventions that give a different answer', () => {
    expect(trueCountExample('floor').lines.join(' ')).toContain('truncate would give −3, round would give −3');
    const t = trueCountExample('truncate').lines.join(' ');
    expect(t).toContain('floor would give −4');
    expect(t).not.toContain('round would give');
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
