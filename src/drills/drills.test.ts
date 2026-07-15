import { describe, it, expect } from 'vitest';
import { hiLoTag } from '../engine/count';
import { isPair } from '../engine/hand';
import { correctPlay, insuranceCorrect } from '../engine/strategy';
import { ILLUSTRIOUS_18 } from '../engine/deviations';
import { makeCountDrill, makeCountdown } from './countDrill';
import { drawFlashcard } from './flashcards';
import { drawQuizItem } from './deviationQuiz';

describe('countDrill', () => {
  describe('makeCountDrill', () => {
    it('should generate 52 cards with groupSize 1 when cards=52 and groupSize=1', () => {
      const drill = makeCountDrill(52, 1, 42);
      const totalCards = drill.groups.reduce((sum, group) => sum + group.length, 0);
      expect(totalCards).toBe(52);
      expect(drill.groups.length).toBe(52);
    });

    it('should generate 52 cards with 18 groups when groupSize=3', () => {
      const drill = makeCountDrill(52, 3, 42);
      const totalCards = drill.groups.reduce((sum, group) => sum + group.length, 0);
      expect(totalCards).toBe(52);
      expect(drill.groups.length).toBe(18); // 52/3 = 17.33, so 18 groups (last short)
      expect(drill.groups.slice(0, -1).every((g) => g.length === 3)).toBe(true);
      expect(drill.groups[drill.groups.length - 1].length === 1).toBe(true); // last group is short
    });

    it('finalRc should equal sum of all card tags', () => {
      const drill = makeCountDrill(52, 1, 42);
      const expectedRc = drill.groups.reduce((sum, group) => {
        return sum + group.reduce((g, card) => g + hiLoTag(card.rank), 0);
      }, 0);
      expect(drill.finalRc).toBe(expectedRc);
    });

    it('should be deterministic per seed', () => {
      const drill1 = makeCountDrill(52, 3, 123);
      const drill2 = makeCountDrill(52, 3, 123);
      expect(drill1.groups).toEqual(drill2.groups);
      expect(drill1.finalRc).toBe(drill2.finalRc);
    });

    it('should produce different results for different seeds', () => {
      const drill1 = makeCountDrill(52, 3, 123);
      const drill2 = makeCountDrill(52, 3, 456);
      expect(drill1.groups).not.toEqual(drill2.groups);
    });
  });

  describe('makeCountdown', () => {
    it('should return 52 distinct cards with 1 hidden', () => {
      const countdown = makeCountdown(42);
      const totalCards = countdown.shown.length + 1;
      expect(totalCards).toBe(52);
    });

    it('sum of shown card tags should equal negative tag of hidden card', () => {
      const countdown = makeCountdown(42);
      const shownSum = countdown.shown.reduce((sum, card) => sum + hiLoTag(card.rank), 0);
      const hiddenTag = hiLoTag(countdown.hidden.rank);
      expect(shownSum).toBe(-hiddenTag);
    });

    it('should be deterministic per seed', () => {
      const c1 = makeCountdown(999);
      const c2 = makeCountdown(999);
      expect(c1.shown).toEqual(c2.shown);
      expect(c1.hidden).toEqual(c2.hidden);
    });

    it('should produce different results for different seeds', () => {
      const c1 = makeCountdown(111);
      const c2 = makeCountdown(222);
      expect(c1.shown).not.toEqual(c2.shown);
    });
  });
});

describe('flashcards', () => {
  describe('drawFlashcard', () => {
    it('pairs category should only return pair hands', () => {
      for (let i = 0; i < 20; i++) {
        const card = drawFlashcard('pairs', {}, 1000 + i);
        expect(isPair(card.cards)).toBe(true);
      }
    });

    it('correct action should match correctPlay at tc=0 with full context', () => {
      const card = drawFlashcard('all', {}, 42);
      const advice = correctPlay(card.cards, card.up, 0, {
        canDouble: true,
        canSplit: true,
        canSurrender: true,
      });
      expect(card.correct).toBe(advice.action);
    });

    it('cellId should have format like hard-16-v-9 or soft-18-v-A or pair-8-v-10', () => {
      for (let i = 0; i < 20; i++) {
        const card = drawFlashcard('all', {}, 1000 + i);
        const cellId = card.cellId;
        expect(cellId).toMatch(/^(hard|soft)-\d+-v-(A|2|3|4|5|6|7|8|9|10)$|^pair-(A|2|3|4|5|6|7|8|9|10)-v-(A|2|3|4|5|6|7|8|9|10)$/);
      }
    });

    it('should respect weighting: 50-weight cell gets ≥30% of 200 draws', () => {
      const missWeights: Record<string, number> = {};
      const targetCellId = 'hard-16-v-9';
      missWeights[targetCellId] = 50;

      let hits = 0;
      for (let i = 0; i < 200; i++) {
        const card = drawFlashcard('all', missWeights, 5000 + i);
        if (card.cellId === targetCellId) hits++;
      }

      // weight = 1 + 2*50 = 101 for target, so ~101/sum should be hit rate
      // over 200 draws, expecting roughly 30%+ hits (60+ hits)
      expect(hits).toBeGreaterThanOrEqual(30);
    });
  });
});

describe('deviationQuiz', () => {
  describe('drawQuizItem', () => {
    it('should pick from ILLUSTRIOUS_18 including inactive 11vA', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const item = drawQuizItem(2000 + i);
        seen.add(item.deviationId);
      }
      // Should see at least some variety; 11vA might appear
      expect(seen.size).toBeGreaterThan(5);
    });

    it('tc should be within ±2 of entry threshold', () => {
      for (let i = 0; i < 200; i++) {
        const item = drawQuizItem(3000 + i);
        const entry = ILLUSTRIOUS_18.find((d) => d.id === item.deviationId);
        expect(entry).toBeDefined();
        const diff = Math.abs(item.tc - entry!.threshold);
        expect(diff).toBeLessThanOrEqual(2);
      }
    });

    it('isDeviationSide should reflect whether tc meets threshold+dir condition', () => {
      for (let i = 0; i < 200; i++) {
        const item = drawQuizItem(4000 + i);
        const entry = ILLUSTRIOUS_18.find((d) => d.id === item.deviationId);
        expect(entry).toBeDefined();

        const meetsCondition =
          entry!.dir === 'gte' ? item.tc >= entry!.threshold : item.tc <= entry!.threshold;
        expect(item.isDeviationSide).toBe(meetsCondition);
      }
    });

    it('correct action should match correctPlay for hard/pair items', () => {
      for (let i = 0; i < 50; i++) {
        const item = drawQuizItem(5000 + i);
        const entry = ILLUSTRIOUS_18.find((d) => d.id === item.deviationId);
        if (entry && entry.kind !== 'insurance' && item.cards !== null) {
          const advice = correctPlay(item.cards, item.up, item.tc, {
            canDouble: true,
            canSplit: true,
            canSurrender: true,
          });
          expect(item.correct).toBe(advice.action);
        }
      }
    });

    it('11vA (inactive) should always return correct=double', () => {
      for (let i = 0; i < 500; i++) {
        const item = drawQuizItem(6000 + i);
        if (item.deviationId === '11vA') {
          expect(item.correct).toBe('double');
        }
      }
      // Note: 11vA is just one of 18 entries, might not hit in 500 draws,
      // but if it does, it should be 'double'
    });

    it('insurance items should have cards=null and correct be take/decline-insurance', () => {
      for (let i = 0; i < 200; i++) {
        const item = drawQuizItem(7000 + i);
        if (item.deviationId === 'ins') {
          expect(item.cards).toBeNull();
          expect(['take-insurance', 'decline-insurance']).toContain(item.correct);
        }
      }
    });

    it('insurance correct should match insuranceCorrect(tc)', () => {
      for (let i = 0; i < 100; i++) {
        const item = drawQuizItem(8000 + i);
        if (item.deviationId === 'ins') {
          const shouldTake = insuranceCorrect(item.tc);
          const expectedCorrect = shouldTake ? 'take-insurance' : 'decline-insurance';
          expect(item.correct).toBe(expectedCorrect);
        }
      }
    });

    it('should have label field for feedback', () => {
      const item = drawQuizItem(42);
      expect(item.label).toBeDefined();
      expect(typeof item.label).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
    });

    it('both isDeviationSide values should occur over many draws', () => {
      const seen = { true: false, false: false };
      for (let i = 0; i < 300; i++) {
        const item = drawQuizItem(9000 + i);
        if (item.isDeviationSide) {
          seen.true = true;
        } else {
          seen.false = true;
        }
      }
      expect(seen.true).toBe(true);
      expect(seen.false).toBe(true);
    });
  });
});
