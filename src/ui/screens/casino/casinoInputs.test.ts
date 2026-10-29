import { describe, it, expect } from 'vitest';
import { blankGame, type CasinoGame } from '../../../store/casinoLog';
import { gameText, withRuleChange, withTextChange } from './casinoInputs';

const unsure = (over: Partial<CasinoGame> = {}): CasinoGame => ({ ...blankGame('g'), das: true, s17: false, minBet: 25, unsure: ['das', 's17', 'minBet'], ...over });

describe("review S2: setting a rule clears that rule's ? only", () => {
  it('a choice set to something else drops its own mark and keeps the rest', () => {
    expect(withRuleChange(unsure(), { das: false }).unsure).toEqual(['s17', 'minBet']);
    expect(withRuleChange(unsure(), { das: false }).das).toBe(false);
  });

  it('the same value tapped again changes nothing, so clears nothing', () => {
    expect(withRuleChange(unsure(), { das: true }).unsure).toEqual(['das', 's17', 'minBet']);
  });

  it('a field that is not a rule (a label, notes) clears nothing', () => {
    expect(withRuleChange(unsure(), { label: 'Pit 3', notes: 'x' }).unsure).toEqual(['das', 's17', 'minBet']);
  });

  it('the last mark cleared leaves no list behind', () => {
    const g = withRuleChange(unsure({ unsure: ['das'] }), { das: false });
    expect('unsure' in g).toBe(false);
  });

  it('"Confirmed" (an explicit unsure) still clears every mark', () => {
    expect(withRuleChange(unsure(), { unsure: undefined }).unsure).toBeUndefined();
  });

  it('a number box typed in drops its own field, by the field it edits', () => {
    const g = unsure({ unsure: ['minBet', 'cutDecksLeft', 'commissionPer100', 'das'] });
    const t = gameText(g);
    expect(withTextChange(g, t, { minBet: '50' }).unsure).toEqual(['cutDecksLeft', 'commissionPer100', 'das']);
    expect(withTextChange(g, t, { cut: '2' }).unsure).toEqual(['minBet', 'commissionPer100', 'das']);
    expect(withTextChange(g, t, { commission: '1' }).unsure).toEqual(['minBet', 'cutDecksLeft', 'das']);
    // Rounds per hour is no rule: nothing is cleared, and the text unchanged clears nothing.
    expect(withTextChange(g, t, { roundsPerHour: '60' }).unsure).toEqual(g.unsure);
    expect(withTextChange(g, t, { minBet: t.minBet }).unsure).toEqual(g.unsure);
  });
});
