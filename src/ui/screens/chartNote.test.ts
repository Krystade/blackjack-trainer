import { describe, it, expect } from 'vitest';
import { chartNoteFor } from './chartNote';
import { DEFAULT_RULES } from '../../engine/ruleset';
import type { Card } from '../../engine/cards';

const c = (rank: Card['rank']): Card => ({ rank, suit: 's' });

describe('the note that reconciles the chart with the correction', () => {
  it('says nothing when the chart and the grade agree', () => {
    // Hard 16 v 10 with no count in play: basic strategy surrenders under the
    // default (ls) profile, and that is exactly what the trainer expected.
    expect(
      chartNoteFor({
        cards: [c('10'), c('6')],
        dealerUp: '10',
        rules: DEFAULT_RULES,
        expected: 'surrender',
      }),
      'a note appeared over a cell that does not contradict anything',
    ).toBeNull();
  });

  it('explains the difference when the grade came from the count', () => {
    const note = chartNoteFor({
      cards: [c('10'), c('6')],
      dealerUp: '10',
      rules: DEFAULT_RULES,
      expected: 'stand',
      reason: '16 v 10: stand at TC >= 0',
      tc: 2,
    });
    expect(note, 'the contradiction was left unexplained').not.toBeNull();
    expect(note).toContain('stand');
    expect(note).toContain('+2');
    expect(note).toContain('16 v 10');
  });

  it('needs no reason text to be useful', () => {
    const note = chartNoteFor({
      cards: [c('10'), c('6')],
      dealerUp: '9',
      rules: DEFAULT_RULES,
      expected: 'stand',
      tc: -1,
    });
    expect(note).toContain('-1');
  });

  it('stays quiet with nothing to compare', () => {
    expect(
      chartNoteFor({ cards: null, dealerUp: '10', rules: DEFAULT_RULES, expected: 'stand' }),
    ).toBeNull();
    expect(
      chartNoteFor({
        cards: [c('10'), c('6')],
        dealerUp: '10',
        rules: DEFAULT_RULES,
        expected: undefined,
      }),
    ).toBeNull();
  });

  it('reads a hit hand as a hit hand -- doubling is over', () => {
    // 11 v 6 is a double cell, and after one hit it is not doubleable at
    // all. The live table opens this overlay on exactly such a hand.
    expect(
      chartNoteFor({
        cards: [c('5'), c('3'), c('3')],
        dealerUp: '6',
        rules: DEFAULT_RULES,
        expected: 'hit',
      }),
      'the note contradicted a correction that agreed with the chart',
    ).toBeNull();
    // Two cards, same total: now the cell really does say double.
    expect(
      chartNoteFor({
        cards: [c('5'), c('6')],
        dealerUp: '6',
        rules: DEFAULT_RULES,
        expected: 'hit',
      }),
    ).not.toBeNull();
  });

  it('reads the hand against the profile, not against one hardcoded table', () => {
    // No surrender at this table, so basic strategy HITS 16 v 10 -- and a
    // grade of `surrender` there would be the contradiction instead.
    const noSurrender = { ...DEFAULT_RULES, ls: false };
    expect(
      chartNoteFor({
        cards: [c('10'), c('6')],
        dealerUp: '10',
        rules: noSurrender,
        expected: 'hit',
      }),
    ).toBeNull();
    expect(
      chartNoteFor({
        cards: [c('10'), c('6')],
        dealerUp: '10',
        rules: noSurrender,
        expected: 'surrender',
      }),
    ).not.toBeNull();
  });
});
