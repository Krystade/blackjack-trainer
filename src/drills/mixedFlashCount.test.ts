import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../engine/cards';
import type { Card } from '../engine/cards';
import { DEFAULT_RULES, type StrategyRules } from '../engine/ruleset';
import { basicPlay } from '../engine/strategy';
import { narrateQuizPrompt, narrateTc } from '../audio/narrate';
import { flashCtx, generateAllCells } from './flashcards';
import { FULL_CTX, NO_SURRENDER_CTX, THREE_CARD_CTX } from './fallbackHand';
import { drawMixedFlashcard, mixedFlashLabel, mixedPrompt } from './mixedSession';
import { buildFlashcardEvent } from './gradeAnswer';
import { drawPlainTc, plainCounts, reachableIndexes, withCountAdvice, PLAIN_MAX, PLAIN_MIN } from './withCount';

/**
 * E1 (W2-11): every Mixed item shows a true count. A basic-strategy item's
 * count is one where no index applies, so its answer is still the chart play.
 */

const RULESETS: StrategyRules[] = [];
for (const decks of [1, 2, 6, 8] as const) {
  for (const s17 of [false, true]) {
    for (const ls of [false, true]) {
      for (const extras of [false, true]) {
        RULESETS.push({ ...DEFAULT_RULES, decks, s17, ls, surrenderIndices: extras && ls, bjaExtras: extras && !s17 });
      }
    }
  }
}
const name = (r: StrategyRules) =>
  `${r.decks}D ${r.s17 ? 'S17' : 'H17'} ls=${r.ls} fab4=${r.surrenderIndices === true} bja=${r.bjaExtras === true}`;
/** The bare profile rules a Mixed flashcard is graded under (no opt-in index flags). */
const bare = (r: StrategyRules): StrategyRules => ({ ...r, surrenderIndices: undefined, bjaExtras: undefined });

const hand = (...ranks: string[]): Card[] => ranks.map((rank) => ({ rank, suit: 's' }) as Card);

describe('E1 plainCounts: every cell has a count where the chart plays', () => {
  const cells = generateAllCells();
  it.each(RULESETS.map((r) => [name(r), r] as const))('%s', (_, rules) => {
    expect(cells).toHaveLength(330);
    let agreeOnly = 0;
    for (const cell of cells) {
      for (const ctx of [FULL_CTX, NO_SURRENDER_CTX, THREE_CARD_CTX]) {
        const counts = plainCounts(cell.cards, cell.up, ctx, rules, bare(rules));
        expect(counts.length, `${cell.id} ${JSON.stringify(ctx)}`).toBeGreaterThan(0);
        const chart = basicPlay(cell.cards, cell.up, ctx, rules).action;
        for (const tc of counts) {
          // Graded under the bare rules: plain, so routed as a basic answer.
          const graded = withCountAdvice(cell.cards, cell.up, tc, ctx, bare(rules));
          expect(graded.deviationId, `${cell.id} at ${tc}`).toBeUndefined();
          expect(graded.action, `${cell.id} at ${tc}`).toBe(chart);
          // ...and the chart's play under the learner's own index set too.
          expect(withCountAdvice(cell.cards, cell.up, tc, ctx, rules).action, `${cell.id} at ${tc}`).toBe(chart);
        }
        // A count where an index of the learner's set agrees with the chart is
        // only used on a cell that has no count free of every index.
        if (withCountAdvice(cell.cards, cell.up, counts[0]!, ctx, rules).deviationId) {
          agreeOnly++;
          for (let tc = -6; tc <= 8; tc++) {
            const a = withCountAdvice(cell.cards, cell.up, tc, ctx, rules);
            const g = withCountAdvice(cell.cards, cell.up, tc, ctx, bare(rules));
            const free = !a.deviationId && a.action === chart && !g.deviationId && g.action === chart;
            expect(free, `${cell.id} has a free count ${tc} but was offered an index one`).toBe(false);
          }
        }
      }
    }
    // Without the opt-in sets every count offered is free of every index.
    if (!rules.surrenderIndices && !rules.bjaExtras) expect(agreeOnly).toBe(0);
  });

  it('Fab 4 15 v 10 (no free count) is shown only where its surrender index agrees with the chart', () => {
    const fab4: StrategyRules = { ...DEFAULT_RULES, surrenderIndices: true };
    const counts = plainCounts(hand('10', '5'), '10', FULL_CTX, fab4, DEFAULT_RULES);
    expect(counts.length).toBeGreaterThan(0);
    for (const tc of counts) expect(withCountAdvice(hand('10', '5'), '10', tc, FULL_CTX, fab4).action).toBe('surrender');
    const label = mixedFlashLabel({ cards: hand('10', '5'), up: '10', correct: 'surrender', cellId: 'hard-15-v-10', tc: counts[0] }, fab4);
    expect(label).toMatch(/^15 v 10: surrender at TC/);
  });

  it('a cell with an index only offers counts short of it (12 v 4: stand from 0 up, hit below)', () => {
    // 12 v 4 is a hit below 0: the plain counts are the ones the chart's stand holds.
    expect(plainCounts(hand('10', '2'), '4', FULL_CTX, DEFAULT_RULES)).toEqual([0, 1, 2, 3, 4, 5]);
    // 20 v 4 has no index: the whole plain range.
    const all: number[] = [];
    for (let tc = PLAIN_MIN; tc <= PLAIN_MAX; tc++) all.push(tc);
    expect(plainCounts(hand('10', 'K'), '4', FULL_CTX, DEFAULT_RULES)).toEqual(all);
  });

  it('a count is plain under the grading rules too, even where they hold an index the count rules lack', () => {
    // The roles reversed: counted under the bare rules, graded under the opt-in
    // sets. The grading side's own check is what keeps its indexes out.
    let checked = 0;
    for (const rules of RULESETS.filter((r) => r.surrenderIndices || r.bjaExtras)) {
      for (const cell of generateAllCells()) {
        const chart = basicPlay(cell.cards, cell.up, FULL_CTX, rules).action;
        for (const tc of plainCounts(cell.cards, cell.up, FULL_CTX, bare(rules), rules)) {
          const g = withCountAdvice(cell.cards, cell.up, tc, FULL_CTX, rules);
          expect(g.deviationId, `${name(rules)} ${cell.id} at ${tc}`).toBeUndefined();
          expect(g.action, `${name(rules)} ${cell.id} at ${tc}`).toBe(chart);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('drawPlainTc reaches every plain count of a cell, and nothing else', () => {
    const rng = mulberry32(11);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(drawPlainTc(hand('10', '2'), '4', FULL_CTX, DEFAULT_RULES, rng));
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('E1 drawMixedFlashcard: 2,000 seeded Mixed flash items', () => {
  for (const rules of [DEFAULT_RULES as StrategyRules, ...RULESETS.filter((r) => r.surrenderIndices || r.bjaExtras || r.decks === 2)]) {
    it(`every item has a TC and is the chart play at it (${name(rules)})`, () => {
      const N = rules === DEFAULT_RULES ? 2000 : 250;
      let withIndexCell = 0;
      for (let seed = 1; seed <= N; seed++) {
        const card = drawMixedFlashcard({
          scopes: 'all',
          srDeck: {},
          now: 0,
          seed,
          rules: bare(rules),
          countRules: rules,
          byConfusability: false,
          previousCellId: null,
          deckWeights: null,
          options: { fallbacks: seed % 3 === 0 },
        });
        expect(card.tc, `seed ${seed}`).toBeTypeOf('number');
        const ctx = flashCtx(card);
        const chart = basicPlay(card.cards, card.up, ctx, rules).action;
        // Graded under the profile's bare rules: plain -- no index, the chart's play.
        const graded = withCountAdvice(card.cards, card.up, card.tc!, ctx, bare(rules));
        expect(graded.deviationId, `seed ${seed} ${card.cellId} at ${card.tc}`).toBeUndefined();
        expect(graded.action, `seed ${seed} ${card.cellId} at ${card.tc}`).toBe(chart);
        // The chart's play under the learner's own index set too; an index of
        // that set may fire only where it agrees (plainCounts' second tier).
        const own = withCountAdvice(card.cards, card.up, card.tc!, ctx, rules);
        expect(own.action, `seed ${seed} ${card.cellId} at ${card.tc}`).toBe(chart);
        if (!rules.surrenderIndices && !rules.bjaExtras) expect(own.deviationId).toBeUndefined();
        expect(card.correct, `seed ${seed}`).toBe(chart);
        if (reachableIndexes(card.cards, card.up, ctx, rules).length > 0) withIndexCell++;
      }
      // Non-vacuity: cells WITH an index were drawn, so the "short of it" rule ran.
      expect(withIndexCell).toBeGreaterThan(0);
    });
  }

  it('the counts vary across items, not one fixed number', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
      seen.add(
        drawMixedFlashcard({
          scopes: 'all', srDeck: {}, now: 0, seed, rules: DEFAULT_RULES, countRules: DEFAULT_RULES,
          byConfusability: false, previousCellId: null, deckWeights: null, options: {},
        }).tc!,
      );
    }
    expect(seen.size).toBeGreaterThanOrEqual(PLAIN_MAX - PLAIN_MIN);
  });

  it('a graded Mixed flash answer carries the shown count and files no index on a basic answer', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const card = drawMixedFlashcard({
        scopes: 'all', srDeck: {}, now: 0, seed, rules: DEFAULT_RULES, countRules: DEFAULT_RULES,
        byConfusability: false, previousCellId: null, deckWeights: null, options: {},
      });
      const right = buildFlashcardEvent(card, card.correct, DEFAULT_RULES, 900);
      expect(right.event.tc).toBe(card.tc);
      expect(right.correct).toBe(true);
      expect(right.event.deviationId).toBeUndefined();
    }
  });
});

describe('E1 mixedPrompt: one spoken shape for both kinds', () => {
  it('a flash item is spoken through the quiz prompt, count included', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const card = drawMixedFlashcard({
        scopes: 'all', srDeck: {}, now: 0, seed, rules: DEFAULT_RULES, countRules: DEFAULT_RULES,
        byConfusability: false, previousCellId: null, deckWeights: null, options: {},
      });
      const prompt = mixedPrompt({ type: 'flash', card });
      expect(prompt).toContain(`True count ${narrateTc(card.tc!)}.`);
      expect(prompt).toBe(narrateQuizPrompt(card.cards as [Card, Card], card.up, card.tc!));
    }
  });
});

describe('E1 mixedFlashLabel: the quiz label shape', () => {
  it('reads like the quiz distractor, near the index the cell carries', () => {
    const plain = { cards: hand('10', 'K'), up: '4' as const, correct: 'stand' as const, cellId: 'hard-20-v-4', tc: 1 };
    expect(mixedFlashLabel(plain, DEFAULT_RULES)).toBe('No index applies here — basic strategy.');
    const near = { cards: hand('10', '2'), up: '4' as const, correct: 'stand' as const, cellId: 'hard-12-v-4', tc: 2 };
    expect(mixedFlashLabel(near, DEFAULT_RULES)).toMatch(/^No index applies here — basic strategy\. \(near 12 v 4: .+\)$/);
  });
});
