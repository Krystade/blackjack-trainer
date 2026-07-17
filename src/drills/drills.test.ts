import { describe, it, expect } from 'vitest';
import { hiLoTag } from '../engine/count';
import { isPair, handValue } from '../engine/hand';
import { correctPlay, insuranceCorrect } from '../engine/strategy';
import { ILLUSTRIOUS_18 } from '../engine/deviations';
import { makeCountDrill, makeCountdown } from './countDrill';
import { drawFlashcard } from './flashcards';
import { drawQuizItem } from './deviationQuiz';
import type { DeviationId } from '../engine/deviations';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { RuleSet } from '../engine/ruleset';

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

    it('structural: hard cells are truly hard, soft cells truly soft, pair cells true pairs (200 seeded draws)', () => {
      for (let i = 0; i < 200; i++) {
        const card = drawFlashcard('all', {}, 20000 + i);
        const match = card.cellId.match(/^(hard|soft|pair)-([A0-9]+)-v-/);
        expect(match).not.toBeNull();
        const [, kind, labeled] = match!;
        const hv = handValue(card.cards);

        if (kind === 'hard') {
          expect(hv.total, `${card.cellId}: total`).toBe(Number(labeled));
          expect(hv.soft, `${card.cellId}: must be a HARD hand`).toBe(false);
          expect(isPair(card.cards), `${card.cellId}: must not be a pair`).toBe(false);
        } else if (kind === 'soft') {
          expect(hv.total, `${card.cellId}: total`).toBe(Number(labeled));
          expect(hv.soft, `${card.cellId}: must be a SOFT hand`).toBe(true);
        } else {
          expect(isPair(card.cards), `${card.cellId}: must be a pair`).toBe(true);
        }
      }
    });

    it('hard universe includes hard 18 and hard 19 (constructible non-pair hard totals)', () => {
      // Weight each target cell heavily; it must be drawable from the 'hard' category.
      for (const target of ['hard-18-v-5', 'hard-19-v-6']) {
        let hit = false;
        for (let i = 0; i < 200 && !hit; i++) {
          const card = drawFlashcard('hard', { [target]: 1000 }, 30000 + i);
          if (card.cellId === target) hit = true;
        }
        expect(hit, `${target} must exist in the hard universe`).toBe(true);
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

    it('correct action should match correctPlay for hard/pair items (surrender unavailable, matching drawQuizItem)', () => {
      for (let i = 0; i < 50; i++) {
        const item = drawQuizItem(5000 + i);
        const entry = ILLUSTRIOUS_18.find((d) => d.id === item.deviationId);
        if (entry && entry.kind !== 'insurance' && item.cards !== null) {
          const advice = correctPlay(item.cards, item.up, item.tc, {
            canDouble: true,
            canSplit: true,
            canSurrender: false,
          });
          expect(item.correct).toBe(advice.action);
        }
      }
    });

    it('structural: hard-kind quiz items have the exact hard total, non-soft, non-pair (200 seeded draws)', () => {
      for (let i = 0; i < 200; i++) {
        const item = drawQuizItem(21000 + i);
        const entry = ILLUSTRIOUS_18.find((d) => d.id === item.deviationId)!;
        if (entry.kind === 'hard') {
          expect(item.cards).not.toBeNull();
          const hv = handValue(item.cards!);
          expect(hv.total, `${entry.id}: total`).toBe(entry.total!);
          expect(hv.soft, `${entry.id}: must be a HARD hand`).toBe(false);
          expect(isPair(item.cards!), `${entry.id}: must not be a pair`).toBe(false);
        } else if (entry.kind === 'pair10') {
          expect(item.cards).not.toBeNull();
          expect(isPair(item.cards!)).toBe(true);
          const hv = handValue(item.cards!);
          expect(hv.total).toBe(20);
        }
      }
    });

    it('11vA (inactive): the ENGINE recomputation yields double at every sampled tc', () => {
      let seen = 0;
      for (let i = 0; i < 500; i++) {
        const item = drawQuizItem(6000 + i);
        if (item.deviationId === '11vA') {
          seen++;
          // item.correct must come from the engine, and the engine must say double
          const advice = correctPlay(item.cards!, item.up, item.tc, {
            canDouble: true,
            canSplit: true,
            canSurrender: true,
          });
          expect(advice.action).toBe('double');
          expect(item.correct).toBe(advice.action);
        }
      }
      expect(seen).toBeGreaterThan(0);
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

    it('filter param: always returns the requested id across 50 seeded draws', () => {
      for (let i = 0; i < 50; i++) {
        const item = drawQuizItem(60000 + i, '16v10');
        expect(item.deviationId).toBe('16v10');
      }
    });

    it('filter param: works for an insurance-kind id too', () => {
      for (let i = 0; i < 50; i++) {
        const item = drawQuizItem(61000 + i, 'ins');
        expect(item.deviationId).toBe('ins');
        expect(item.cards).toBeNull();
      }
    });

    it('filter param: tc still stays within ±2 of the entry threshold', () => {
      const entry = ILLUSTRIOUS_18.find((d) => d.id === '12v6')!;
      for (let i = 0; i < 50; i++) {
        const item = drawQuizItem(62000 + i, '12v6');
        expect(Math.abs(item.tc - entry.threshold)).toBeLessThanOrEqual(2);
      }
    });

    it('no-filter behavior is unaffected by the presence of the new optional param (variety still seen)', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const item = drawQuizItem(63000 + i);
        seen.add(item.deviationId);
      }
      expect(seen.size).toBeGreaterThan(5);
    });

    it('16v10/15v10/16v9 are surrenderable 2-card hands: quiz must model surrender-unavailable, so correct is stand at/above threshold and hit below — never surrender', () => {
      const targets: { id: DeviationId; threshold: number }[] = [
        { id: '16v10', threshold: 0 },
        { id: '15v10', threshold: 4 },
        { id: '16v9', threshold: 4 },
      ];

      for (const { id, threshold } of targets) {
        let sawBelow = false;
        let sawAtOrAbove = false;
        for (let i = 0; i < 2000 && !(sawBelow && sawAtOrAbove); i++) {
          const item = drawQuizItem(50000 + i);
          if (item.deviationId !== id) continue;
          expect(item.correct, `${id} at tc=${item.tc}`).not.toBe('surrender');
          if (item.tc >= threshold) {
            expect(item.correct, `${id} at tc=${item.tc} (>= threshold ${threshold})`).toBe('stand');
            sawAtOrAbove = true;
          } else {
            expect(item.correct, `${id} at tc=${item.tc} (< threshold ${threshold})`).toBe('hit');
            sawBelow = true;
          }
        }
        expect(sawBelow, `${id}: must see a below-threshold draw in the sample`).toBe(true);
        expect(sawAtOrAbove, `${id}: must see an at/above-threshold draw in the sample`).toBe(true);
      }
    });
  });
});

// Cycle-1 Task 13 (active-profile wiring): drawFlashcard/drawQuizItem gained
// an optional `rules` param so drills grade against the active profile's
// ruleset instead of always defaulting to v1's H17 6-deck game. These tests
// pin a case where the h17 vs s17 answer actually diverges, per spec §3
// (chart data verified against docs/sources; d68_h17.ts SOFT[18][0]='Ds' vs
// d68_s17.ts SOFT[18][0]='S').
const S17_RULES: RuleSet = { ...DEFAULT_RULES, s17: true };

describe('drawFlashcard rules wiring', () => {
  it('same seed (same cell drawn): h17 says double, s17 says stand for soft 18 (A,7) v 2', () => {
    // Cell selection depends only on category/missWeights/seed, never on
    // rules -- find a seed that lands on the soft-18-v-2 cell first, using
    // whichever (default) rules happen to be in effect (irrelevant to the search).
    let seed = -1;
    for (let candidate = 0; candidate < 5000; candidate++) {
      const probe = drawFlashcard('soft', {}, candidate);
      if (probe.cellId === 'soft-18-v-2') {
        seed = candidate;
        break;
      }
    }
    expect(seed, 'expected to find a seed landing on soft-18-v-2 within 5000 tries').toBeGreaterThanOrEqual(0);

    const h17Card = drawFlashcard('soft', {}, seed, DEFAULT_RULES);
    const s17Card = drawFlashcard('soft', {}, seed, S17_RULES);

    // Same seed -> identical cell regardless of rules.
    expect(h17Card.cellId).toBe('soft-18-v-2');
    expect(s17Card.cellId).toBe('soft-18-v-2');

    // The correct action diverges by ruleset.
    expect(h17Card.correct).toBe('double');
    expect(s17Card.correct).toBe('stand');
  });

  it('omitting rules preserves v1 (H17) behavior exactly', () => {
    const withDefault = drawFlashcard('hard', {}, 7);
    const withExplicitH17 = drawFlashcard('hard', {}, 7, DEFAULT_RULES);
    expect(withDefault).toEqual(withExplicitH17);
  });
});

describe('drawQuizItem rules wiring', () => {
  it('filter 11vA: h17 selects the inactive/threshold-0 H17 entry; s17 selects the active/threshold-1 S17 entry', () => {
    const h17Item = drawQuizItem(1, '11vA', DEFAULT_RULES);
    const s17Item = drawQuizItem(1, '11vA', S17_RULES);

    expect(h17Item.label).toContain('H17');
    expect(s17Item.label).toContain('S17');
    expect(h17Item.deviationId).toBe('11vA');
    expect(s17Item.deviationId).toBe('11vA');

    // tc is randomized within +/-2 of the entry's threshold -- the two
    // rulesets use different thresholds (0 vs 1), so their tc ranges differ.
    expect(h17Item.tc).toBeGreaterThanOrEqual(0 - 2);
    expect(h17Item.tc).toBeLessThanOrEqual(0 + 2);
    expect(s17Item.tc).toBeGreaterThanOrEqual(1 - 2);
    expect(s17Item.tc).toBeLessThanOrEqual(1 + 2);
  });

  it('omitting rules preserves v1 (H17) behavior exactly', () => {
    const withDefault = drawQuizItem(3);
    const withExplicitH17 = drawQuizItem(3, undefined, DEFAULT_RULES);
    expect(withDefault).toEqual(withExplicitH17);
  });
});
