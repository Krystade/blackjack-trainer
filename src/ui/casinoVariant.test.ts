import { describe, it, expect } from 'vitest';
import { buildRanking, needsCompute } from './casinoRanking';
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
    expect(needsCompute(row)).toBe(false);
    expect(needsCompute(rows.find((r) => r.game.id === 'gstd')!)).toBe(true);
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
