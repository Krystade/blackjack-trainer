import { describe, expect, it } from 'vitest';
import type { Card } from '../engine/cards';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { StrategyRules } from '../engine/ruleset';
import { cellIdForEvent } from '../store/cellStats';
import { generateAllCells } from './flashcards';
import {
  buildSpeedEvent,
  drawSpeedQuestion,
  isAskable,
  judgeSpeed,
  medianMs,
  speedCandidates,
  speedKeyAnswer,
  speedModeOf,
  SPEED_MODES,
  TC_MAX,
  TC_MIN,
} from './speedDrill';

const ALL = generateAllCells().map((c) => c.id);
const H17: StrategyRules = DEFAULT_RULES;
const FAB4: StrategyRules = { ...DEFAULT_RULES, surrenderIndices: true };
const c = (...ranks: string[]): Card[] => ranks.map((rank) => ({ rank, suit: 's' }) as Card);
const chart = { ids: ALL, weights: null };

describe('judgeSpeed (checked against the engine charts, 6D H17 DAS LS)', () => {
  it('surrender: 16 v 10 yes, 16 v 6 no, 15 v A yes (H17)', () => {
    expect(judgeSpeed('surrender', c('10', '6'), '10', 0, H17).answer).toBe(true);
    expect(judgeSpeed('surrender', c('10', '6'), '6', 0, H17).answer).toBe(false);
    expect(judgeSpeed('surrender', c('10', '5'), 'A', 0, H17).answer).toBe(true);
  });
  it('double: 11 v 6 yes, 12 v 6 no, A,6 v 4 yes', () => {
    expect(judgeSpeed('double', c('5', '6'), '6', 0, H17).answer).toBe(true);
    expect(judgeSpeed('double', c('10', '2'), '6', 0, H17).answer).toBe(false);
    expect(judgeSpeed('double', c('A', '6'), '4', 0, H17).answer).toBe(true);
  });
  it('split: 8,8 v 6 yes, 10,10 v 6 no, 5,5 v 6 no', () => {
    expect(judgeSpeed('split', c('8', '8'), '6', 0, H17).answer).toBe(true);
    expect(judgeSpeed('split', c('10', '10'), '6', 0, H17).answer).toBe(false);
    expect(judgeSpeed('split', c('5', '5'), '6', 0, H17).answer).toBe(false);
  });
  it('deviation: 12 v 3 stands at +2, not at +1; 10,10 v 6 splits at +4', () => {
    expect(judgeSpeed('deviation', c('10', '2'), '3', 2, H17).answer).toBe(true);
    expect(judgeSpeed('deviation', c('10', '2'), '3', 1, H17).answer).toBe(false);
    expect(judgeSpeed('deviation', c('10', '10'), '6', 4, H17)).toMatchObject({ answer: true, play: 'split', basic: 'stand' });
    expect(judgeSpeed('deviation', c('10', '10'), '6', 3, H17).answer).toBe(false);
  });
  it('deviation: the Fab 4 count only when the rules carry them (15 v 9 at +2)', () => {
    expect(judgeSpeed('deviation', c('10', '5'), '9', 2, H17).answer).toBe(false);
    expect(judgeSpeed('deviation', c('10', '5'), '9', 2, FAB4)).toMatchObject({ answer: true, play: 'surrender' });
  });
});

describe('isAskable', () => {
  it('split asks pairs only; double asks everything', () => {
    expect(ALL.filter((id) => isAskable('split', id, H17)).every((id) => id.startsWith('pair-'))).toBe(true);
    expect(ALL.filter((id) => isAskable('double', id, H17))).toHaveLength(ALL.length);
  });
  it('surrender: nothing when the table has no late surrender, never a soft hand', () => {
    expect(ALL.filter((id) => isAskable('surrender', id, { ...H17, ls: false }))).toHaveLength(0);
    expect(ALL.some((id) => id.startsWith('soft-') && isAskable('surrender', id, H17))).toBe(false);
  });
  it('deviation: only cells with an index; 13 v 2 yes, 13 v 4 no', () => {
    expect(isAskable('deviation', 'hard-13-v-2', H17)).toBe(true);
    expect(isAskable('deviation', 'hard-13-v-4', H17)).toBe(false);
    expect(isAskable('deviation', 'hard-15-v-9', H17)).toBe(false);
    expect(isAskable('deviation', 'hard-15-v-9', FAB4)).toBe(true);
  });
});

describe('drawSpeedQuestion', () => {
  it('is seeded: the same seed draws the same question', () => {
    for (const mode of SPEED_MODES) {
      expect(drawSpeedQuestion(mode, chart, H17, 42)).toEqual(drawSpeedQuestion(mode, chart, H17, 42));
    }
  });

  it.each(SPEED_MODES)('%s: about half the questions are yes, and each answer is right', (mode) => {
    let yes = 0;
    const n = 2000;
    for (let seed = 1; seed <= n; seed++) {
      const q = drawSpeedQuestion(mode, chart, H17, seed)!;
      expect(isAskable(mode, q.cellId, H17)).toBe(true);
      expect(judgeSpeed(mode, q.cards, q.up, q.tc ?? 0, H17).answer).toBe(q.answer);
      if (mode === 'deviation') {
        expect(q.tc).not.toBeNull();
        expect(q.tc!).toBeGreaterThanOrEqual(TC_MIN);
        expect(q.tc!).toBeLessThanOrEqual(TC_MAX);
      } else expect(q.tc).toBeNull();
      if (q.answer) yes++;
    }
    expect(yes / n).toBeGreaterThan(0.45);
    expect(yes / n).toBeLessThan(0.55);
  });

  it('stays inside the deck', () => {
    const deck = { ids: ['pair-8-v-6', 'pair-10-v-6', 'hard-12-v-3'], weights: null };
    for (let seed = 1; seed < 200; seed++) {
      expect(deck.ids).toContain(drawSpeedQuestion('split', deck, H17, seed)!.cellId);
    }
    expect(drawSpeedQuestion('split', { ids: ['hard-12-v-3'], weights: null }, H17, 1)).toBeNull();
  });

  it('falls back to the other side when one side is empty', () => {
    const deck = { ids: ['pair-8-v-6'], weights: null };
    for (let seed = 1; seed < 50; seed++) expect(drawSpeedQuestion('split', deck, H17, seed)!.answer).toBe(true);
  });

  it('avoids repeating the previous cell when it can', () => {
    const deck = { ids: ['pair-8-v-6', 'pair-9-v-6'], weights: null };
    for (let seed = 1; seed < 100; seed++) {
      expect(drawSpeedQuestion('split', deck, H17, seed, 'pair-8-v-6')!.cellId).toBe('pair-9-v-6');
    }
  });

  it('deals hard cells as varied compositions of the same total', () => {
    const deck = { ids: ['hard-16-v-10'], weights: null };
    const shapes = new Set<string>();
    for (let seed = 1; seed < 100; seed++) {
      const q = drawSpeedQuestion('surrender', deck, H17, seed)!;
      shapes.add(q.cards.map((x) => x.rank).sort().join(','));
    }
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('candidates: deviation asks every count in range on each index cell', () => {
    const cands = speedCandidates('deviation', ['hard-12-v-3'], H17);
    expect(cands).toHaveLength(TC_MAX - TC_MIN + 1);
    expect(cands.filter((x) => x.answer).map((x) => x.tc)).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('buildSpeedEvent', () => {
  const q = drawSpeedQuestion('deviation', { ids: ['hard-12-v-3'], weights: null }, H17, 7)!;

  it('records a graded action on the cell, so cellStats and accuracy count it', () => {
    const e = buildSpeedEvent(q, q.answer, 900, 0);
    expect(e).toMatchObject({ kind: 'action', source: 'flashcard', correct: true, classification: 'correct', hand: 'hard-12-v-3', elapsedMs: 900 });
    expect(cellIdForEvent(e)).toBe('hard-12-v-3');
    expect(e.at).toBe(new Date(0).toISOString());
  });

  it('classifies a deviation miss as missed or phantom', () => {
    const wrong = buildSpeedEvent(q, !q.answer, 900, 0);
    expect(wrong.correct).toBe(false);
    expect(wrong.classification).toBe(q.answer ? 'missed-deviation' : 'phantom-deviation');
    const s = drawSpeedQuestion('split', chart, H17, 3)!;
    expect(buildSpeedEvent(s, !s.answer, 1, 0).classification).toBe('basic-error');
  });

  it('drops idle time over the 30s cap but still grades', () => {
    const e = buildSpeedEvent(q, q.answer, 31_000, 0);
    expect(e.elapsedMs).toBeUndefined();
    expect(e.correct).toBe(true);
  });
});

describe('helpers', () => {
  it('medianMs', () => {
    expect(medianMs([])).toBeNull();
    expect(medianMs([300, 100, 200])).toBe(200);
    expect(medianMs([100, 400, 200, 300])).toBe(250);
  });
  it('keys: Y / right is yes, N / left is no', () => {
    expect(speedKeyAnswer('y')).toBe(true);
    expect(speedKeyAnswer('ArrowRight')).toBe(true);
    expect(speedKeyAnswer('N')).toBe(false);
    expect(speedKeyAnswer('ArrowLeft')).toBe(false);
    expect(speedKeyAnswer('1')).toBeNull();
  });
  it('speedModeOf defaults to surrender', () => {
    expect(speedModeOf({})).toBe('surrender');
    expect(speedModeOf({ speedMode: 'split' })).toBe('split');
  });
});
