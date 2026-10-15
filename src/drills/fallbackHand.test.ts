import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../engine/cards';
import type { Card } from '../engine/cards';
import { handValue, isPair } from '../engine/hand';
import { correctPlay, basicPlay } from '../engine/strategy';
import type { RuleSet } from '../engine/ruleset';
import { DEFAULT_RULES } from '../engine/ruleset';
import { generateAllCells } from './flashcards';
import { buildFallback, fallbackCellAction, maybeFallback, FALLBACK_RATE } from './fallbackHand';

const RULESETS: RuleSet[] = [];
for (const decks of [1, 2, 6, 8] as const)
  for (const s17 of [false, true])
    for (const das of [false, true])
      for (const ls of [false, true]) RULESETS.push({ decks, s17, das, ls, rsa: false, bj65: false });

const FALLBACK_OF = { Dh: 'hit', Ds: 'stand', Rh: 'hit', Rs: 'stand', Rp: 'split' } as const;

describe('#27 buildFallback', () => {
  const cells = generateAllCells();

  it('every fallback hand keeps the cell total, is 3 cards (Rp: the pair), and grades to the fallback', () => {
    let built = 0;
    for (const rules of RULESETS) {
      for (const cell of cells) {
        const cellAction = fallbackCellAction(cell.cards, cell.up, rules);
        for (let seed = 1; seed <= 4; seed++) {
          const fb = buildFallback(cell.cards, cell.up, rules, mulberry32(seed * 7919 + built));
          if (!cellAction) {
            expect(fb).toBeNull();
            continue;
          }
          if (!fb) {
            // Only hard totals with no three-card version, or a pair double
            // cell whose total row differs.
            expect(handValue(cell.cards).total < 6 || isPair(cell.cards)).toBe(true);
            continue;
          }
          built++;
          const want = handValue(cell.cards);
          const got = handValue(fb.cards);
          expect(got.total).toBe(want.total);
          expect(got.soft).toBe(want.soft);
          if (fb.cards.length === 2) {
            // Rp, or a pair surrender cell (7,7 v 10 1D): the pair, surrender off.
            expect(['Rp', 'Rh', 'Rs']).toContain(cellAction);
            expect(fb.cards).toBe(cell.cards);
            expect(isPair(fb.cards)).toBe(true);
            expect(fb.ctx.canSurrender).toBe(false);
          } else {
            expect(fb.cards).toHaveLength(3);
            expect(isPair(fb.cards)).toBe(false);
            expect(fb.ctx).toEqual({ canDouble: false, canSplit: false, canSurrender: false });
          }
          const advice = correctPlay(fb.cards, cell.up, 0, fb.ctx, rules);
          expect(advice.action).not.toBe('double');
          expect(advice.action).not.toBe('surrender');
          // With no index involved, the answer is exactly the chart fallback.
          if (advice.source === 'basic') expect(advice.action).toBe(FALLBACK_OF[cellAction]);
          else expect(advice.action).toBe(correctPlay(fb.cards, cell.up, 0, fb.ctx, rules).action);
          // and the 2-card hand on the same cell is double/surrender.
          const two = basicPlay(cell.cards, cell.up, { canDouble: true, canSplit: true, canSurrender: true }, rules);
          expect(['double', 'surrender']).toContain(two.action);
        }
      }
    }
    expect(built).toBeGreaterThan(1000);
  });

  it('covers every fallback kind somewhere', () => {
    const seen = new Set<string>();
    for (const rules of RULESETS)
      for (const cell of cells) {
        const a = fallbackCellAction(cell.cards, cell.up, rules);
        if (a && buildFallback(cell.cards, cell.up, rules, mulberry32(1))) seen.add(a);
      }
    expect([...seen].sort()).toEqual(['Dh', 'Ds', 'Rh', 'Rp', 'Rs']);
  });

  it('hard 16 v 10 (Rh) dealt as three cards hits or takes the 16 v 10 index -- never surrenders', () => {
    const fb = buildFallback([{ rank: '10', suit: 's' }, { rank: '6', suit: 'h' }], '10', DEFAULT_RULES, mulberry32(3))!;
    expect(fb.cards).toHaveLength(3);
    expect(correctPlay(fb.cards, '10', -1, fb.ctx, DEFAULT_RULES).action).toBe('hit');
    expect(correctPlay(fb.cards, '10', 0, fb.ctx, DEFAULT_RULES).action).toBe('stand');
  });

  it('soft 18 v 3 (Ds) dealt as three cards stands', () => {
    const fb = buildFallback([{ rank: 'A', suit: 's' }, { rank: '7', suit: 'h' }], '3', DEFAULT_RULES, mulberry32(9))!;
    expect(fb.cards).toHaveLength(3);
    expect(handValue(fb.cards)).toMatchObject({ total: 18, soft: true });
    expect(correctPlay(fb.cards, '3', 0, fb.ctx, DEFAULT_RULES).action).toBe('stand');
  });
});

describe('#27 maybeFallback', () => {
  const eleven = [{ rank: '5', suit: 's' }, { rank: '6', suit: 'h' }] as const;
  it('off: never, and draws nothing from the rng', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0;
    };
    expect(maybeFallback([...eleven], '5', DEFAULT_RULES, rng, false)).toBeNull();
    expect(calls).toBe(0);
  });

  it('on: about 15% of eligible hands, never on a cell without a fallback', () => {
    const rng = mulberry32(42);
    let hits = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (maybeFallback([...eleven], '5', DEFAULT_RULES, rng, true)) hits++;
    expect(hits / N).toBeGreaterThan(FALLBACK_RATE - 0.02);
    expect(hits / N).toBeLessThan(FALLBACK_RATE + 0.02);
    const twenty: Card[] = [{ rank: '10', suit: 's' }, { rank: 'K', suit: 'h' }];
    for (let i = 0; i < 200; i++) expect(maybeFallback(twenty, '5', DEFAULT_RULES, rng, true)).toBeNull();
  });
});
