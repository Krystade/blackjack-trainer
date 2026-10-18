import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, EMPTY_STATS } from '../../../store/types';
import type { Settings, Stats } from '../../../store/types';
import { DEFAULT_RULES } from '../../../engine/ruleset';
import { flashSummaryLine, goalProgressShort, mixedSummaryLine, quizSummaryLine, rulesShort } from './summaryLine';

const drill = (over: Partial<Settings['drill']>): Settings['drill'] => ({ ...DEFAULT_SETTINGS.drill, ...over });

const stats = (cells: Record<string, [number, number, string?]>, handRecent?: Record<string, string>): Stats => ({
  ...EMPTY_STATS,
  cellStats: Object.fromEntries(
    Object.entries(cells).map(([id, [right, wrong, recent]]) => [id, { right, wrong, lastAt: '', ...(recent ? { recent } : {}) }]),
  ),
  ...(handRecent ? { handRecent } : {}),
});

describe('rulesShort', () => {
  it('reads decks and the soft-17 rule', () => {
    expect(rulesShort({ decks: 6, s17: false })).toBe('6D H17');
    expect(rulesShort({ decks: 2, s17: true })).toBe('2D S17');
  });
});

describe('goalProgressShort', () => {
  it('sums the answers counted toward judging while any dealt type is thin', () => {
    const s = stats({ 'hard-16-v-10': [9, 3], 'soft-18-v-9': [25, 5] });
    // Hard 12 of 20, Soft capped at 20 of 20.
    expect(goalProgressShort(s, drill({ scopes: ['hard', 'soft'] }))).toBe('32/40');
    expect(goalProgressShort(s, drill({ scopes: ['hard'] }))).toBe('12/20');
    expect(goalProgressShort(EMPTY_STATS, drill({ scopes: ['hard', 'soft'] }))).toBe('0/40');
  });

  it('reads one judged type as its figure and several as how many are on target', () => {
    const s = stats(
      { 'hard-16-v-10': [27, 3, '1'.repeat(27) + '000'], 'soft-18-v-9': [26, 4, '1'.repeat(26) + '0000'] },
      { hard: '1'.repeat(27) + '000', soft: '1'.repeat(26) + '0000' },
    );
    expect(goalProgressShort(s, drill({ scopes: ['hard'] }))).toBe('90% ✓');
    expect(goalProgressShort(s, drill({ scopes: ['soft'] }))).toBe('86%');
    expect(goalProgressShort(s, drill({ scopes: ['hard', 'soft'] }))).toBe('1/2 on target');
  });
});

describe('summary lines', () => {
  it('Flashcards: deck, rules, progress', () => {
    const s = stats({ 'hard-16-v-10': [9, 3] });
    expect(flashSummaryLine(drill({ scopes: ['hard', 'soft'], deck: 'chart' }), DEFAULT_RULES, s)).toBe(
      `Hard + Soft · ${rulesShort(DEFAULT_RULES)} · 12/40`,
    );
    expect(flashSummaryLine(drill({ scopes: ['hard', 'soft', 'pairs'], deck: 'custom' }), { ...DEFAULT_RULES, decks: 8, s17: true }, s)).toBe(
      'Custom · All · 8D S17 · 12/60',
    );
  });

  it('Mixed and the quiz: what is dealt and the rules', () => {
    expect(mixedSummaryLine(drill({ scopes: ['pairs'], deck: 'marked' }), { ...DEFAULT_RULES, decks: 1 })).toBe(
      `Marked · Pairs · 1D ${DEFAULT_RULES.s17 ? 'S17' : 'H17'}`,
    );
    expect(quizSummaryLine('All indices', { ...DEFAULT_RULES, decks: 6, s17: false })).toBe('All indices · 6D H17');
  });
});
