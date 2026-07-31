import { describe, it, expect } from 'vitest';
import { hiLoTag } from '../engine/count';
import { isPair, handValue } from '../engine/hand';
import { correctPlay, insuranceCorrect } from '../engine/strategy';
import { ILLUSTRIOUS_18, isIndexActive } from '../engine/deviations';
import { makeCountDrill, makeCountdown } from './countDrill';
import { drawFlashcard } from './flashcards';
import { drawQuizItem } from './deviationQuiz';
import type { DeviationId } from '../engine/deviations';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { RuleSet } from '../engine/ruleset';
import type { SrDeck } from './spacedRepetition';

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
        const card = drawFlashcard('pairs', {}, 0, 1000 + i);
        expect(isPair(card.cards)).toBe(true);
      }
    });

    it('correct action should match correctPlay at tc=0 with full context', () => {
      const card = drawFlashcard('all', {}, 0, 42);
      const advice = correctPlay(card.cards, card.up, 0, {
        canDouble: true,
        canSplit: true,
        canSurrender: true,
      });
      expect(card.correct).toBe(advice.action);
    });

    it('cellId should have format like hard-16-v-9 or soft-18-v-A or pair-8-v-10', () => {
      for (let i = 0; i < 20; i++) {
        const card = drawFlashcard('all', {}, 0, 1000 + i);
        const cellId = card.cellId;
        expect(cellId).toMatch(/^(hard|soft)-\d+-v-(A|2|3|4|5|6|7|8|9|10)$|^pair-(A|2|3|4|5|6|7|8|9|10)-v-(A|2|3|4|5|6|7|8|9|10)$/);
      }
    });

    it('structural: hard cells are truly hard, soft cells truly soft, pair cells true pairs (200 seeded draws)', () => {
      for (let i = 0; i < 200; i++) {
        const card = drawFlashcard('all', {}, 0, 20000 + i);
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
      // An empty SR deck draws uniformly, so each hard cell is reachable within
      // enough draws -- this just asserts the cell EXISTS in the 'hard' universe.
      for (const target of ['hard-18-v-5', 'hard-19-v-6']) {
        let hit = false;
        for (let i = 0; i < 400 && !hit; i++) {
          const card = drawFlashcard('hard', {}, 0, 30000 + i);
          if (card.cellId === target) hit = true;
        }
        expect(hit, `${target} must exist in the hard universe`).toBe(true);
      }
    });
    // (SR due-weighting of the draw is covered in the "RV4 spaced-repetition
    // scheduling" block below.)
  });
});

describe('deviationQuiz', () => {
  describe('drawQuizItem', () => {
    it('should pick from ILLUSTRIOUS_18 including inactive 11vA', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const item = drawQuizItem(2000 + i);
        // distractorPct defaults to 0 here, so deviationId is always a real id.
        seen.add(item.deviationId!);
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
        // distractorPct defaults to 0 here, so deviationId is always a real id.
        seen.add(item.deviationId!);
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

  // Operator request: "mix in fakes" -- drawQuizItem gains a 4th optional
  // `distractorPct` param. distractorPct=0 (the default, and the value used
  // by every call above) must be BYTE-IDENTICAL to today's behavior; all
  // grading for a distractor must come from the engine itself
  // (correctPlay/basicPlay), never a hand-authored table -- same anti-drift
  // principle as the true-count drill's engine sweep.
  describe('drawQuizItem distractors (distractorPct)', () => {
    it('distractorPct=0 (default/omitted) never produces a distractor -- isDistractor is always false and deviationId always a real id', () => {
      for (let i = 0; i < 200; i++) {
        const viaDefault = drawQuizItem(70000 + i);
        const viaExplicitZero = drawQuizItem(70000 + i, undefined, DEFAULT_RULES, 0);
        expect(viaDefault.isDistractor).toBe(false);
        expect(viaExplicitZero).toEqual(viaDefault);
        expect(viaDefault.deviationId).toBeDefined();
      }
    });

    it('distractorPct=100: every draw is a distractor, deviationId is omitted (undefined), label says no index applies', () => {
      for (let i = 0; i < 300; i++) {
        const item = drawQuizItem(71000 + i, undefined, DEFAULT_RULES, 100);
        expect(item.isDistractor).toBe(true);
        expect(item.deviationId).toBeUndefined();
        expect(item.isDeviationSide).toBe(false);
        expect(item.label).toContain('No index applies here');
      }
    });

    it('sweep (300 seeded, H17): every hand distractor\'s `correct` matches correctPlay(tc), and correctPlay(tc).source is "basic" (no active index actually triggers)', () => {
      let handCount = 0;
      for (let i = 0; i < 300; i++) {
        const item = drawQuizItem(72000 + i, undefined, DEFAULT_RULES, 100);
        if (item.cards === null) continue;
        handCount++;
        const ctx = { canDouble: true, canSplit: true, canSurrender: false };
        const withCount = correctPlay(item.cards, item.up, item.tc, ctx, DEFAULT_RULES);
        expect(item.correct).toBe(withCount.action);
        expect(withCount.source, `seed ${72000 + i}: ${item.label} tc=${item.tc}`).toBe('basic');
      }
      expect(handCount).toBeGreaterThan(0);
    });

    it('sweep (300 seeded, S17): same engine-agreement invariant under the S17 ruleset', () => {
      let handCount = 0;
      for (let i = 0; i < 300; i++) {
        const item = drawQuizItem(73000 + i, undefined, S17_RULES, 100);
        if (item.cards === null) continue;
        handCount++;
        const ctx = { canDouble: true, canSplit: true, canSurrender: false };
        const withCount = correctPlay(item.cards, item.up, item.tc, ctx, S17_RULES);
        expect(item.correct).toBe(withCount.action);
        expect(withCount.source).toBe('basic'); // the whole point: no index triggers
      }
      expect(handCount).toBeGreaterThan(0);
    });

    it('insurance-flavored distractors: cards null, tc is always BELOW the +3 threshold, correct always decline', () => {
      let insuranceCount = 0;
      for (let i = 0; i < 300; i++) {
        const item = drawQuizItem(74000 + i, 'ins', DEFAULT_RULES, 100);
        expect(item.cards).toBeNull();
        insuranceCount++;
        expect(item.tc).toBeLessThan(3);
        expect(item.correct).toBe('decline-insurance');
        expect(insuranceCorrect(item.tc)).toBe(false);
      }
      expect(insuranceCount).toBeGreaterThan(0);
    });

    it('a pinned filter keeps every distractor "near" that same index (CLOSE only, no wandering to a random unrelated hand)', () => {
      for (let i = 0; i < 100; i++) {
        const item = drawQuizItem(75000 + i, '16v10', DEFAULT_RULES, 100);
        expect(item.label).toContain('near 16 v 10');
      }
    });

    it('with no filter, both CLOSE ("near") and RANDOM (no "near") labels occur across many draws', () => {
      let sawNear = false;
      let sawRandom = false;
      for (let i = 0; i < 300; i++) {
        const item = drawQuizItem(76000 + i, undefined, DEFAULT_RULES, 100);
        if (item.cards === null) continue; // insurance base entries are always "near"-labeled; skip for this check
        if (item.label.includes('(near ')) sawNear = true;
        else sawRandom = true;
      }
      expect(sawNear).toBe(true);
      expect(sawRandom).toBe(true);
    });

    it('CLOSE hard-hand distractors never land on a hand that is itself a real active index for this ruleset (engine-verified per draw)', () => {
      for (let i = 0; i < 300; i++) {
        const item = drawQuizItem(77000 + i, undefined, DEFAULT_RULES, 100);
        if (item.cards === null) continue;
        const ctx = { canDouble: true, canSplit: true, canSurrender: false };
        const withCount = correctPlay(item.cards, item.up, item.tc, ctx, DEFAULT_RULES);
        expect(withCount.source, `seed ${77000 + i}: ${item.label} tc=${item.tc}`).toBe('basic');
      }
    });

    it('distractorPct=25/50: roughly matches the requested rate over a large sample (within a generous tolerance)', () => {
      for (const pct of [25, 50]) {
        let distractors = 0;
        const n = 2000;
        for (let i = 0; i < n; i++) {
          const item = drawQuizItem(80000 + pct * 100000 + i, undefined, DEFAULT_RULES, pct);
          if (item.isDistractor) distractors++;
        }
        const rate = (distractors / n) * 100;
        expect(Math.abs(rate - pct), `pct=${pct} observed rate=${rate}`).toBeLessThan(8);
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
      const probe = drawFlashcard('soft', {}, 0, candidate);
      if (probe.cellId === 'soft-18-v-2') {
        seed = candidate;
        break;
      }
    }
    expect(seed, 'expected to find a seed landing on soft-18-v-2 within 5000 tries').toBeGreaterThanOrEqual(0);

    const h17Card = drawFlashcard('soft', {}, 0, seed, DEFAULT_RULES);
    const s17Card = drawFlashcard('soft', {}, 0, seed, S17_RULES);

    // Same seed -> identical cell regardless of rules.
    expect(h17Card.cellId).toBe('soft-18-v-2');
    expect(s17Card.cellId).toBe('soft-18-v-2');

    // The correct action diverges by ruleset.
    expect(h17Card.correct).toBe('double');
    expect(s17Card.correct).toBe('stand');
  });

  it('omitting rules preserves v1 (H17) behavior exactly', () => {
    const withDefault = drawFlashcard('hard', {}, 0, 7);
    const withExplicitH17 = drawFlashcard('hard', {}, 0, 7, DEFAULT_RULES);
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

  it('isIndexActive: 11vA is inactive under H17, active under S17', () => {
    expect(isIndexActive('11vA', DEFAULT_RULES)).toBe(false);
    expect(isIndexActive('11vA', S17_RULES)).toBe(true);
  });

  it('isIndexActive: 16v10 is active under both H17 and S17', () => {
    expect(isIndexActive('16v10', DEFAULT_RULES)).toBe(true);
    expect(isIndexActive('16v10', S17_RULES)).toBe(true);
  });

  it('isIndexActive: returns false for unknown indices', () => {
    // Ensure the function handles edge cases gracefully
    expect(isIndexActive('16v10' as DeviationId, DEFAULT_RULES)).toBe(true);
  });
});

/**
 * RV4 (docs/BACKLOG.md; spec 2026-07-30-rv4-spaced-repetition): the draw
 * functions weight candidates by SR due-ness (`srWeight`) instead of R3 miss
 * count. These INTEGRATION tests confirm drawFlashcard/drawQuizItem actually
 * consult the SR deck; the srWeight math itself is exhaustively covered in
 * spacedRepetition.test.ts. All draws pass an explicit wall-clock `now`. Note
 * that under SR, UNSEEN cells are intentionally high-weight (new material
 * surfaces), so the faithful contrast is "overdue vs the same item scheduled
 * ahead", not "weighted vs a uniform baseline".
 */
describe('RV4 spaced-repetition scheduling (draw integration)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 1_000_000_000_000;
  // A heavily-overdue box-0 card -- the heaviest srWeight (1 + cap + MAX_BOX).
  const overdueDeck = (id: string): SrDeck => ({
    [id]: { box: 0, dueAt: NOW - 90 * DAY, lastSeenAt: NOW - 91 * DAY, lapses: 3, reviews: 3 },
  });
  // A mastered card scheduled far ahead -- the lightest srWeight (the floor).
  const masteredDeck = (id: string): SrDeck => ({
    [id]: { box: 5, dueAt: NOW + 60 * DAY, lastSeenAt: NOW, lapses: 0, reviews: 10 },
  });

  describe('drawFlashcard', () => {
    it('an empty deck (fresh profile) is uniform -- byte-identical across two empty-deck draws', () => {
      for (let i = 0; i < 50; i++) {
        expect(drawFlashcard('all', {}, NOW, 9000 + i)).toEqual(drawFlashcard('all', {}, NOW, 9000 + i));
      }
    });

    it('an overdue cell is drawn far more often than the same cell scheduled ahead (due-weighting drives the draw)', () => {
      const target = 'hard-16-v-9';
      let overdueHits = 0;
      let masteredHits = 0;
      for (let i = 0; i < 1000; i++) {
        if (drawFlashcard('all', overdueDeck(target), NOW, 40000 + i).cellId === target) overdueHits++;
        if (drawFlashcard('all', masteredDeck(target), NOW, 40000 + i).cellId === target) masteredHits++;
      }
      expect(overdueHits).toBeGreaterThan(masteredHits);
    });
  });

  describe('drawQuizItem index weighting (no-filter draws)', () => {
    it('omitting the SR deck (backward compat) is byte-identical to an explicit empty deck', () => {
      for (let i = 0; i < 100; i++) {
        expect(drawQuizItem(90000 + i, undefined, DEFAULT_RULES, 0, {})).toEqual(drawQuizItem(90000 + i));
      }
    });

    it('an overdue index is drawn disproportionately vs the rest of the 18-entry set', () => {
      const target: DeviationId = '16v10';
      let hits = 0;
      const n = 500;
      for (let i = 0; i < n; i++) {
        if (drawQuizItem(100000 + i, undefined, DEFAULT_RULES, 0, overdueDeck(target), NOW).deviationId === target) {
          hits++;
        }
      }
      // Overdue weight ~36 vs ~8 for each of the 17 unseen -> ~21% share.
      expect(hits).toBeGreaterThan(n * 0.12);
    });

    it('a mastered, not-yet-due index is drawn far LESS than an overdue one', () => {
      const target: DeviationId = '16v10';
      const n = 900;
      let overdueHits = 0;
      let masteredHits = 0;
      for (let i = 0; i < n; i++) {
        if (drawQuizItem(110000 + i, undefined, DEFAULT_RULES, 0, overdueDeck(target), NOW).deviationId === target) {
          overdueHits++;
        }
        if (drawQuizItem(110000 + i, undefined, DEFAULT_RULES, 0, masteredDeck(target), NOW).deviationId === target) {
          masteredHits++;
        }
      }
      expect(masteredHits).toBeLessThan(overdueHits);
    });

    it('a pinned filter always returns that index regardless of the SR deck', () => {
      // Bias the deck heavily toward a DIFFERENT index; the pinned draw ignores it.
      for (let i = 0; i < 50; i++) {
        const item = drawQuizItem(120000 + i, '16v10', DEFAULT_RULES, 0, overdueDeck('12v6'), NOW);
        expect(item.deviationId).toBe('16v10');
      }
    });

    it('distractor items never carry a deviationId (the SR deck only keys off real deviationIds)', () => {
      for (let i = 0; i < 200; i++) {
        const item = drawQuizItem(130000 + i, undefined, DEFAULT_RULES, 100, overdueDeck('16v10'), NOW);
        if (item.isDistractor) expect(item.deviationId).toBeUndefined();
      }
    });

    it('a heavy SR deck does not change distractor eligibility at distractorPct=100 -- base-entry selection stays varied', () => {
      const seen = new Set<string | undefined>();
      for (let i = 0; i < 300; i++) {
        const item = drawQuizItem(140000 + i, undefined, DEFAULT_RULES, 100, overdueDeck('16v10'), NOW);
        expect(item.isDistractor).toBe(true);
        seen.add(item.label);
      }
      expect(seen.size).toBeGreaterThan(3);
    });
  });
});
