import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../engine/cards';
import { correctPlay, insuranceCorrect } from '../engine/strategy';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { StrategyRules } from '../engine/ruleset';
import { entryCtx } from './deviationQuiz';
import {
  indexTestSet, indexTestItemFor, gradeIndexTest, publishedIndex, indexTestPlayLine,
  indexTestPrompt, drawIndexTestItem, buildIndexTestEvent,
} from './indexTest';

const H17_ALL: StrategyRules = { ...DEFAULT_RULES, surrenderIndices: true, bjaExtras: true };
const S17_ALL: StrategyRules = { ...DEFAULT_RULES, s17: true, surrenderIndices: true, bjaExtras: true };

const H17_PUBLISHED: Record<string, number> = {
  ins: 3, '16v10': 0, '15v10': 4, TTv5: 5, TTv6: 4, '10v10': 4, '12v3': 2, '12v2': 3,
  '9v2': 1, '10vA': 3, '9v7': 3, '16v9': 4, '13v2': -1, '12v4': 0, '12v5': -2, '12v6': -3, '13v3': -2,
  sur15v9: 2, sur15v10: 0, sur15vA: -1, sur16v8: 4, sur16v9: 0, sur14v10: 3,
  '16vA': 3, '15vA': 5, '8v6': 2, A8v4: 3, A8v5: 1, A8v6: 0, A6v2: 1, TTv4: 6,
};
const S17_PUBLISHED: Record<string, number> = {
  ins: 3, '16v10': 0, '15v10': 4, TTv5: 5, TTv6: 4, '10v10': 4, '12v3': 2, '12v2': 3,
  '11vA': 1, '9v2': 1, '10vA': 4, '9v7': 3, '16v9': 5, '13v2': -1, '12v4': 0, '12v5': -2, '12v6': -1, '13v3': -2,
  sur15v9: 2, sur15v10: 0, sur15vA: 1, sur14v10: 3,
};

for (const [name, rules, published] of [
  ['H17', H17_ALL, H17_PUBLISHED],
  ['S17', S17_ALL, S17_PUBLISHED],
] as const) {
  describe(`Index test grades every ${name} index`, () => {
    it('asks exactly the published set (inactive 11 v A under H17 is never asked)', () => {
      expect(indexTestSet(rules).map((d) => d.id).sort()).toEqual(Object.keys(published).sort());
    });
    for (const dev of indexTestSet(rules)) {
      it(`${dev.id}: index ${published[dev.id]} is right, one either side is wrong`, () => {
        const want = published[dev.id]!;
        const item = indexTestItemFor(dev, rules, mulberry32(7));
        expect(publishedIndex(dev)).toBe(want);
        expect(item.index).toBe(want);
        expect(gradeIndexTest(item, want)).toBe(true);
        expect(gradeIndexTest(item, want + 1)).toBe(false);
        expect(gradeIndexTest(item, want - 1)).toBe(false);
      });
      it(`${dev.id}: the index is the count where the engine's play changes`, () => {
        const item = indexTestItemFor(dev, rules, mulberry32(7));
        if (item.cards === null) {
          expect(insuranceCorrect(item.index, rules)).toBe(true);
          expect(insuranceCorrect(item.index - 1, rules)).toBe(false);
          return;
        }
        const ctx = entryCtx(dev);
        expect(correctPlay(item.cards, item.up, item.index, ctx, rules).action).toBe(item.playAt);
        expect(correctPlay(item.cards, item.up, item.index - 1, ctx, rules).action).toBe(item.playBelow);
        expect(item.playAt).not.toBe(item.playBelow);
      });
    }
  });
}

describe('Index test copy and events', () => {
  it('single deck takes insurance at +2', () => {
    const ins = indexTestSet({ ...DEFAULT_RULES, decks: 1 }).find((d) => d.id === 'ins')!;
    expect(indexTestItemFor(ins, { ...DEFAULT_RULES, decks: 1 }, mulberry32(1)).index).toBe(2);
  });
  it('names the play, never the number, and the play line uses a real minus', () => {
    const d13 = indexTestSet(H17_ALL).find((d) => d.id === '13v2')!;
    const item = indexTestItemFor(d13, H17_ALL, mulberry32(2));
    expect(indexTestPrompt(item)).toBe('Index to stand?');
    expect(indexTestPlayLine(item)).toBe('Stand at TC ≥ −1; hit below');
    const s16 = indexTestSet(H17_ALL).find((d) => d.id === 'sur16v9')!;
    expect(indexTestPrompt(indexTestItemFor(s16, H17_ALL, mulberry32(2)))).toBe('Index to surrender?');
  });
  it('an event is an index event: per-index tally, no cell, no latency, no price', () => {
    const d = indexTestSet(H17_ALL).find((x) => x.id === '16v10')!;
    const item = indexTestItemFor(d, H17_ALL, mulberry32(3));
    const wrong = buildIndexTestEvent(item, 2);
    expect(wrong).toMatchObject({ kind: 'action', source: 'quiz', correct: false, classification: 'missed-deviation', deviationId: '16v10', taken: '2', expected: '0' });
    expect(wrong.elapsedMs).toBeUndefined();
    expect(wrong.evCost).toBeUndefined();
    expect(buildIndexTestEvent(item, 0).correct).toBe(true);
  });
  it('draws are weighted by the review deck', () => {
    // Every index but 12 v 4 reviewed and not due (weight SR_NOT_DUE_FLOOR 0.25); 12 v 4 new (SR_NEW_WEIGHT 8).
    const later = { box: 5, dueAt: 1e12, lastSeenAt: 0, lapses: 0, reviews: 4 };
    const deck = Object.fromEntries(indexTestSet(H17_ALL).filter((d) => d.id !== '12v4').map((d) => [d.id, later]));
    const count = (srDeck: object) =>
      Array.from({ length: 200 }, (_, s) => drawIndexTestItem(s + 1, H17_ALL, srDeck as never, 10)).filter((i) => i.deviationId === '12v4').length;
    expect(count(deck)).toBeGreaterThan(count({}) * 3);
  });
});
