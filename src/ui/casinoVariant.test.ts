import { describe, it, expect } from 'vitest';
import { buildRanking } from './casinoRanking';
import { orderCandidates } from './casinoAutoSim';
import { labelledSummary } from './casinoFigures';
import { blankGame, emptyCasinoLog, normGame, type Casino, type CasinoGame } from '../store/casinoLog';
import { simInputFor, type GameResult } from '../store/casinoGameStats';
import { emptyAccum } from '../engine/casinoSim';
import { makeDefaultProfile } from '../store/profiles';

const profile = makeDefaultProfile();
const game = (id: string, over: Partial<CasinoGame> = {}): CasinoGame => ({
  ...blankGame(id),
  decks: 6,
  s17: false,
  payout: '3:2',
  minBet: 25,
  ...over,
});
const casino = (games: CasinoGame[]): Casino => ({
  id: 'c1',
  name: 'C1',
  games,
  status: 'ok',
  notes: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('Wave L: a casino game can be a variant', () => {
  it('normGame keeps a known variant and drops anything else', () => {
    expect(normGame({ id: 'g', variant: 's21-h17' }, 'x').variant).toBe('s21-h17');
    expect(normGame({ id: 'g', variant: 'spanish' }, 'x').variant).toBeUndefined();
    expect('variant' in normGame({ id: 'g' }, 'x')).toBe(false);
  });

  it('a variant game is never simulated, even with a stored result for its id', () => {
    const fb = game('gfb', { variant: 'freebet' });
    const std = game('gstd');
    const input = simInputFor(fb, profile, []);
    const stored: GameResult = {
      key: input.key,
      computedAt: '2026-10-20T00:00:00Z',
      profileName: profile.name,
      status: 'done',
      ms: 1,
      basicRounds: 1,
      countRounds: 1,
      unit: 25,
      basic: emptyAccum(),
      methods: null,
    };
    const log = { ...emptyCasinoLog(), casinos: [casino([fb, std])] };
    const rows = buildRanking(log, profile, { gfb: stored }, Date.now(), null, 'ev');
    const row = rows.find((r) => r.game.id === 'gfb')!;
    expect(row.notModelled).toBe(true);
    expect(row.figures).toBeNull();
    // Wave Q: never worked out on its own either; the standard game beside it is.
    expect(orderCandidates(rows, new Map(), 'p').map((c) => c.gameId)).toEqual(['gstd']);
  });

  it('names the variant in the game summary', () => {
    expect(labelledSummary(game('g', { variant: 'switch', label: 'Pit 2' }))).toMatch(/^Pit 2: Blackjack Switch · 6D H17/);
    expect(labelledSummary(game('g'))).not.toMatch(/Switch|Free Bet|Spanish/);
  });
});

describe('Wave L S3: a variant game honours its logged rules', () => {
  it('Free Bet logged 6:5 shows the 6:5 edge, about 1.35 points worse', async () => {
    const { variantEdgeFor } = await import('./casinoVariant');
    const a = variantEdgeFor({ payout: '3:2' }, 'freebet');
    const b = variantEdgeFor({ payout: '6:5' }, 'freebet');
    expect(b.payout).toBe('6:5');
    expect(b.edge - a.edge).toBeGreaterThan(1.2);
    expect(b.edge - a.edge).toBeLessThan(1.5);
    // Spanish 21 has no 6:5 figure: the preset's 3:2 edge, said as 3:2.
    expect(variantEdgeFor({ payout: '6:5' }, 's21-h17').payout).toBe('3:2');
  });

  it('names logged rules that differ from the preset', async () => {
    const { variantMismatches } = await import('./casinoVariant');
    expect(variantMismatches({ decks: 6, s17: false, payout: '3:2' }, 's21-h17')).toEqual([]);
    expect(variantMismatches({ decks: 8, s17: null, payout: null }, 'freebet')[0]).toMatch(/8 decks/);
    expect(variantMismatches({ decks: null, s17: true, payout: null }, 's21-h17')[0]).toMatch(/Spanish 21, S17/);
    expect(variantMismatches({ decks: null, s17: true, payout: null }, 'switch')[0]).toMatch(/Logged S17; this preset is H17/);
    expect(variantMismatches({ decks: null, s17: null, payout: '3:2' }, 'switch')[0]).toMatch(/1:1/);
  });
});

describe('merge with Wave M: a variant game and the new rules', () => {
  it('a commission is added to the flat edge; a card room that logged none is assumed $1 per $100', async () => {
    const { variantCostFor, variantEdgeFor } = await import('./casinoVariant');
    const chart = variantEdgeFor({ payout: '3:2' }, 'freebet').edge;
    const room = variantCostFor({ payout: '3:2' }, 'freebet', 'cardroom');
    expect(room).toMatchObject({ commissionPer100: 1, commissionAssumed: true });
    expect(room.total).toBeCloseTo(chart + 1, 9);
    expect(variantCostFor({ payout: '3:2', commissionPer100: 0 }, 'freebet', 'cardroom')).toMatchObject({ commissionAssumed: false, total: chart });
    expect(variantCostFor({ payout: '3:2', commissionPer100: 2 }, 'freebet', undefined).total).toBeCloseTo(chart + 2, 9);
    // A casino charges none unless it is logged.
    expect(variantCostFor({ payout: '3:2' }, 'freebet', 'casino')).toMatchObject({ commissionPer100: 0, commissionAssumed: false, total: chart });
  });

  it('the split and double rules are the preset\'s: only a logged one that differs is named', async () => {
    const { variantMismatches } = await import('./casinoVariant');
    const none = { decks: null, s17: null, payout: null };
    // Unlogged: nothing assumed, nothing listed.
    expect(variantMismatches(none, 'freebet')).toEqual([]);
    // Logged and matching the preset: nothing listed.
    expect(variantMismatches({ ...none, rsa: true, maxSplitHands: 4, doubleOn: 'any2', doubleSplitAces: false }, 'freebet')).toEqual([]);
    expect(variantMismatches({ ...none, rsa: false }, 'switch')).toEqual([]);
    expect(variantMismatches({ ...none, doubleSplitAces: true }, 's21-h17')).toEqual([]);
    // Logged and different.
    expect(variantMismatches({ ...none, rsa: false }, 'freebet')).toEqual(['Logged no resplitting aces; the Free Bet figures resplit them.']);
    expect(variantMismatches({ ...none, rsa: true }, 'switch')[0]).toMatch(/do not resplit aces/);
    expect(variantMismatches({ ...none, maxSplitHands: 2 }, 'freebet')).toEqual(['Logged split to 2 hands; the Free Bet figures split to 4.']);
    expect(variantMismatches({ ...none, doubleOn: '10-11' }, 's21-s17')[0]).toMatch(/^Logged doubling on 10-11 only/);
    expect(variantMismatches({ ...none, doubleSplitAces: true }, 'freebet')[0]).toMatch(/one card each/);
    expect(variantMismatches({ ...none, doubleSplitAces: false }, 's21-h17')[0]).toMatch(/hit and double/);
  });

  it('the summary names the variant once when the house name already says it', () => {
    expect(labelledSummary(game('g', { variant: 'freebet', variantName: 'Free Bet Blackjack' }))).toMatch(/^Free Bet Blackjack: 6D H17/);
    expect(labelledSummary(game('g', { variant: 'freebet', variantName: '21st Century' }))).toMatch(/^21st Century: Free Bet · 6D H17/);
  });
});
