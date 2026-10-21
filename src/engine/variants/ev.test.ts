import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../cards';
import { RANKS, rankValue, mulberry32 } from '../cards';
import { actionEvs } from '../handEv';
import { DEFAULT_RULES } from '../ruleset';
import { PRESETS } from './rules';
import type { VariantRules } from './rules';
import {
  actionValues,
  decisionValues,
  drawWeights,
  evTable,
  roundReturn,
  standValue,
  startState,
  switchChoice,
  switchHandValue,
  switchReturn,
  trackFor,
  variantDealer,
} from './ev';
import type { HandState } from './ev';
import { PUBLISHED_HOUSE_EDGE, PUBLISHED_P22, PUBLISHED_SWITCH_VALUES } from './published';
import generated from './generated.json';

const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** The app's standard game as variant rules: what must reproduce handEv.ts exactly. */
const STANDARD: VariantRules = {
  ...PRESETS.switch,
  dealer22Push: false,
  bjPays: 1.5,
  ls: true,
  das: true,
  maxHands: 2,
  rsa: false,
};

const card = (rank: Rank): Card => ({ rank, suit: 's' });
const rankOf = (v: number): Rank => (v === 11 ? 'A' : (String(v) as Rank));

describe('variant EV layer: probabilities', () => {
  it('draw weights sum to 1 for both decks; a Spanish deck has 3/12 ten-values', () => {
    for (const spanish of [false, true]) {
      const sum = drawWeights(spanish).reduce((s, d) => s + d.p, 0);
      expect(sum).toBeCloseTo(1, 12);
    }
    expect(drawWeights(true).find((d) => d.value === 10)!.p).toBeCloseTo(3 / 12, 12);
    expect(drawWeights(false).find((d) => d.value === 10)!.p).toBeCloseTo(4 / 13, 12);
  });

  it("the Spanish weights are the 48-card deck's own composition (52 cards less the four tens)", () => {
    const deck = RANKS.filter((r) => r !== '10').flatMap((r) => [r, r, r, r]);
    expect(deck).toHaveLength(48);
    for (const d of drawWeights(true)) {
      const n = deck.filter((r) => rankValue(r) === d.value).length;
      expect(d.p).toBeCloseTo(n / 48, 12);
    }
  });

  it('dealer outcomes sum to 1 for every up card, both decks, H17 and S17', () => {
    for (const rules of [PRESETS.freebet, PRESETS['s21-h17'], PRESETS['s21-s17'], STANDARD]) {
      for (const up of UPS) {
        const { dist } = variantDealer(up, rules);
        expect(dist.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12);
        expect(Math.min(...dist)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('a Monte Carlo dealer dealt from the 48-card deck matches the Spanish dealer distribution', () => {
    // With replacement from the explicit card list: the infinite-deck model,
    // but built from cards rather than from drawWeights.
    const deck = RANKS.filter((r) => r !== '10').flatMap((r) => [r, r, r, r]);
    const rng = mulberry32(2026);
    const N = 200_000;
    let bust = 0;
    let live = 0;
    for (let i = 0; i < N; i++) {
      let total = 6;
      let soft = false;
      const hole = rankValue(deck[Math.floor(rng() * 48)]!);
      total += hole;
      soft = hole === 11;
      while (total < 17 || (total === 17 && soft)) {
        const v = rankValue(deck[Math.floor(rng() * 48)]!);
        total += v;
        if (v === 11) soft = true;
        if (total > 21 && soft) {
          total -= 10;
          soft = false;
          // a second ace still counted as 11 would have been demoted above
        }
      }
      live++;
      if (total > 21) bust++;
    }
    const p = variantDealer(6, PRESETS['s21-h17']).dist;
    const computed = p[5] + p[6];
    const se = Math.sqrt((computed * (1 - computed)) / live);
    expect(Math.abs(bust / live - computed)).toBeLessThan(4 * se);
  });

  it('a Spanish deck makes the dealer bust less, and a natural under an ace rarer', () => {
    const std = variantDealer(6, STANDARD);
    const sp = variantDealer(6, { ...STANDARD, spanishDeck: true });
    expect(sp.dist[5] + sp.dist[6]).toBeLessThan(std.dist[5] + std.dist[6]);
    expect(variantDealer(11, PRESETS['s21-h17']).pNatural).toBeCloseTo(3 / 12, 12);
    expect(variantDealer(11, STANDARD).pNatural).toBeCloseTo(4 / 13, 12);
  });

  it('P(dealer draws to 22) matches the Wizard of Odds six-deck figure within the infinite-deck gap', () => {
    let p22 = 0;
    for (const d of drawWeights(false)) {
      const dealer = variantDealer(d.value, PRESETS.switch);
      p22 += d.p * (1 - dealer.pNatural) * dealer.dist[5];
    }
    expect(Math.abs(p22 - PUBLISHED_P22.p)).toBeLessThan(0.0005);
  });
});

describe('variant EV layer: reproduces the standard engine', () => {
  it('stand, hit, double, surrender and split equal handEv.ts for every two-card hand', () => {
    for (const up of UPS) {
      const t = evTable(STANDARD, up);
      for (let a = 2; a <= 11; a++) {
        for (let b = a; b <= 11; b++) {
          const cards = [card(rankOf(a)), card(rankOf(b))];
          if (a + b === 21) continue; // a natural is not a decision
          const ref = actionEvs(cards, rankOf(up), { canDouble: true, canSplit: true, canSurrender: true }, DEFAULT_RULES);
          const total = a + b > 21 ? 12 : a + b;
          const soft = a === 11 || b === 11;
          const mine = decisionValues(startState(total, soft, t), a === b ? a : null, t);
          expect(mine.S).toBeCloseTo(ref.stand, 10);
          expect(mine.H).toBeCloseTo(ref.hit, 10);
          expect(mine.D).toBeCloseTo(ref.double!, 10);
          expect(mine.R).toBeCloseTo(ref.surrender!, 10);
          if (a === b) expect(mine.P).toBeCloseTo(ref.split!, 10);
        }
      }
    }
  });
});

describe('Free Bet', () => {
  const rules = PRESETS.freebet;

  it('a free double on hard 9-11 is worth more than a real double, by exactly P(the doubled hand loses)', () => {
    for (const up of UPS) {
      const t = evTable(rules, up);
      for (const total of [9, 10, 11]) {
        const vals = actionValues(startState(total, false, t), t);
        expect(vals.FD).toBeGreaterThan(vals.D!);
        // A free double risks one unit where a real one risks two: the
        // difference is the probability the doubled hand loses.
        let pLose = 0;
        for (const d of drawWeights(false)) {
          const s: HandState = { ...startState(total + (d.value === 11 && total + 11 > 21 ? 1 : d.value), false, t), n: 3, canSurrender: false, freeDouble: false };
          const sv = standValue({ ...s, W: 1, L: 1 }, t);
          const st = standValue({ ...s, W: 1, L: 0 }, t);
          pLose += d.p * (st - sv);
        }
        expect(vals.FD! - vals.D!).toBeCloseTo(pLose, 10);
      }
    }
  });

  it('a free hand (token only) values a push the same as a loss', () => {
    const t = evTable(rules, 10);
    const free = startState(20, false, t, { stake: 'free', split: true });
    const real = startState(20, false, t, { split: true });
    // Standing 20 v 10: free value is P(win); real is P(win) - P(lose).
    expect(standValue(free, t)).toBeGreaterThan(standValue(real, t));
    expect(standValue(free, t)).toBeGreaterThan(0);
  });

  it('every pair but tens is a free split, and it beats a real-money split of the same pair', () => {
    const t = evTable(rules, 6);
    const free = decisionValues(startState(16, false, t), 8, t);
    const real = decisionValues(startState(16, false, t), 8, evTable({ ...rules, freeSplits: false }, 6));
    expect(free.FP).toBeGreaterThan(real.P!);
    const tens = decisionValues(startState(20, false, t), 10, t);
    expect(tens.FP).toBeUndefined();
    expect(tens.P).toBeDefined();
  });

  it('a dealer 22 push makes standing worth less than in a game where 22 busts', () => {
    const push = evTable(rules, 6);
    const bust = evTable({ ...rules, dealer22Push: false }, 6);
    expect(standValue(startState(20, false, push), push)).toBeLessThan(standValue(startState(20, false, bust), bust));
  });
});

describe('Spanish 21', () => {
  const rules = PRESETS['s21-h17'];

  it('a player 21 always wins, and pays 3:2 / 2:1 / 3:1 with 5 / 6 / 7 cards', () => {
    const t = evTable(rules, 10);
    const at = (n: number) => standValue(startState(21, false, t, { n }), t);
    expect(at(3)).toBe(1);
    expect(at(5)).toBe(1.5);
    expect(at(6)).toBe(2);
    expect(at(7)).toBe(3);
  });

  it('no bonus after a double or a split', () => {
    const t = evTable(rules, 10);
    const doubled: HandState = { ...startState(21, false, t, { n: 5 }), W: 2, L: 2, doubles: 1, postDouble: true };
    expect(standValue(doubled, t)).toBe(2);
    expect(standValue(startState(21, false, t, { n: 5, split: true }), t)).toBe(1);
  });

  it('a suited 6-7 start is worth more than a mixed one, and a spaded one more again', () => {
    const t = evTable(rules, 6);
    const v = (suit: 'm' | 's' | 'p') => Math.max(...(Object.values(actionValues(startState(13, false, t, { track: trackFor(6, 7, suit) }), t)) as number[]));
    expect(v('s')).toBeGreaterThan(v('m'));
    expect(v('p')).toBeGreaterThan(v('s'));
    expect(trackFor(9, 4, 'm')).toBe('');
  });

  it('strategy depends on the number of cards: 16 v 2 stands with two cards and hits with more', () => {
    const t = evTable(rules, 2);
    const best = (n: number) => {
      const vals = actionValues(startState(16, false, t, { n }), t);
      return vals.S! >= vals.H! ? 'S' : 'H';
    };
    expect(best(2)).toBe('S');
    expect(best(6)).toBe('H');
  });

  it('rescue after a double gives up half the stake, and is taken on a doubled 12 v 10', () => {
    const t = evTable(rules, 10);
    const s: HandState = { ...startState(12, false, t, { n: 3, surrender: false }), W: 2, L: 2, doubles: 1, postDouble: true };
    const vals = actionValues(s, t);
    expect(vals.R).toBe(-1);
    expect(vals.R!).toBeGreaterThan(vals.S!);
    expect(vals.D).toBeUndefined(); // no redouble in this preset
    const rdd = evTable(PRESETS['s21-h17-rdd'], 10);
    expect(actionValues({ ...s }, rdd).D).toBeDefined();
  });
});

describe('Blackjack Switch', () => {
  const rules = PRESETS.switch;

  it("matches the Wizard of Odds starting-hand values within the infinite-deck gap", () => {
    const rows = generated.presets.switch.switchValues;
    let worst = 0;
    for (const line of PUBLISHED_SWITCH_VALUES) {
      const [label, rest] = line.split(':') as [string, string];
      const pub = rest.trim().split(/\s+/).map(Number);
      const row = rows.find((r) => r.label === label);
      expect(row, label).toBeDefined();
      row!.values.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - pub[i]!))));
    }
    // Every gap over 0.01 is a doubling hand (9-11, 5,5, A,A, small pairs)
    // worth a little more in a real shoe; the largest is under 0.02.
    expect(worst).toBeLessThan(0.025);
  });

  it("makes the Wizard's worked switch decisions", () => {
    // Q7 and 9J v 2: 17 + 19 or, switched, 20 + 16 -- switch.
    expect(switchChoice(10, 7, 9, 10, evTable(rules, 2)).switchIt).toBe(true);
    // 8+4 and A+8 v 6: 12 + soft 19 or 8,8 + soft 15 -- switch.
    expect(switchChoice(8, 4, 11, 8, evTable(rules, 6)).switchIt).toBe(true);
    // Two twenties are not switched into anything.
    expect(switchChoice(10, 10, 10, 10, evTable(rules, 6)).switchIt).toBe(false);
  });

  it('a natural is only a blackjack when it was dealt, not switched into', () => {
    const t = evTable(rules, 9);
    expect(switchHandValue(11, 10, true, t)).toBe(1);
    const switched = switchHandValue(11, 10, false, t);
    // A switched ace-ten is a 21: it pushes a dealer 21 or 22, so it is worth less than 1.
    expect(switched).toBeLessThan(0.95);
    expect(switched).toBeCloseTo(standValue(startState(21, true, t), t), 10);
  });
});

describe('house edges against the published figures', () => {
  // Infinite deck runs about 0.1% worse than six decks for a game where more
  // decks hurt the player (Switch, Spanish 21), and slightly better for Free
  // Bet, where the Wizard notes the reverse. The rule effects, which barely
  // depend on decks, are compared tighter below.
  it.each(['freebet', 's21-h17', 's21-s17', 's21-h17-rdd'] as const)('%s within 0.15% of the six-deck figure', (id) => {
    const edge = -roundReturn(PRESETS[id]) * 100;
    expect(Math.abs(edge - PUBLISHED_HOUSE_EDGE[id].edge)).toBeLessThan(0.15);
    expect(generated.presets[id].houseEdge).toBeCloseTo(edge, 3);
  });

  it('Switch within 0.15% of the six-deck figure', () => {
    const edge = -switchReturn(PRESETS.switch) * 100;
    expect(Math.abs(edge - PUBLISHED_HOUSE_EDGE.switch.edge)).toBeLessThan(0.15);
  });

  it('Free Bet rule effects match the Wizard / Discount Gambling list', () => {
    const fb = PRESETS.freebet;
    const base = -roundReturn(fb) * 100;
    const effect = (r: VariantRules) => -roundReturn(r) * 100 - base;
    // Source: wizardofodds.com/games/free-bet-blackjack/ "Rule Variants".
    expect(effect({ ...fb, bjPays: 1.2 })).toBeCloseTo(1.36, 1);
    expect(effect({ ...fb, ls: true })).toBeCloseTo(-0.21, 1);
    expect(effect({ ...fb, s17: true })).toBeCloseTo(-0.31, 1);
    expect(effect({ ...fb, rsa: false })).toBeCloseTo(0.08, 1);
  });

  it('Spanish 21: redouble and S17 each lower the edge, by about the published amounts', () => {
    const h17 = -roundReturn(PRESETS['s21-h17']) * 100;
    const s17 = -roundReturn(PRESETS['s21-s17']) * 100;
    const rdd = -roundReturn(PRESETS['s21-h17-rdd']) * 100;
    expect(h17 - rdd).toBeCloseTo(0.76 - 0.42, 1);
    expect(h17 - s17).toBeGreaterThan(0.3);
  });
});
