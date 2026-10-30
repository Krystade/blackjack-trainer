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
    expect(b.edge! - a.edge!).toBeGreaterThan(1.2);
    expect(b.edge! - a.edge!).toBeLessThan(1.5);
    // C22 follow-up: Spanish 21 logged 6:5 is worked out at 6:5 (no committed figure, so the worker's), said as 6:5.
    const s21 = variantEdgeFor({ payout: '6:5' }, 's21-h17');
    expect(s21.payout).toBe('6:5');
    expect(s21.edge).toBeNull();
  });

  it('names logged rules that differ from the preset', async () => {
    const { variantRuleNotes } = await import('./casinoVariant');
    expect(variantRuleNotes({ decks: 6, s17: false, payout: '3:2' }, 's21-h17')).toEqual({ applied: [], appliedLine: null, unapplied: [] });
    expect(variantRuleNotes({ decks: 8, s17: null, payout: null }, 'freebet').unapplied[0]).toMatch(/8 decks/);
    expect(variantRuleNotes({ decks: null, s17: true, payout: null }, 's21-h17').appliedLine).toMatch(/Spanish 21, S17/);
    expect(variantRuleNotes({ decks: null, s17: true, payout: null }, 'switch').applied).toEqual(['S17']);
    expect(variantRuleNotes({ decks: null, s17: null, payout: '3:2' }, 'switch').unapplied[0]).toMatch(/1:1/);
  });
});

describe('merge with Wave M: a variant game and the new rules', () => {
  it('a commission is added to the flat edge; a card room that logged none is assumed $1 per $100', async () => {
    const { variantCostFor, variantEdgeFor } = await import('./casinoVariant');
    const chart = variantEdgeFor({ payout: '3:2' }, 'freebet').edge!;
    const room = variantCostFor({ payout: '3:2' }, 'freebet', 'cardroom');
    expect(room).toMatchObject({ commissionPer100: 1, commissionAssumed: true });
    expect(room.total).toBeCloseTo(chart + 1, 9);
    expect(variantCostFor({ payout: '3:2', commissionPer100: 0 }, 'freebet', 'cardroom')).toMatchObject({ commissionAssumed: false, total: chart });
    expect(variantCostFor({ payout: '3:2', commissionPer100: 2 }, 'freebet', undefined).total).toBeCloseTo(chart + 2, 9);
    // A casino charges none unless it is logged.
    expect(variantCostFor({ payout: '3:2' }, 'freebet', 'casino')).toMatchObject({ commissionPer100: 0, commissionAssumed: false, total: chart });
  });

  it('the split and double rules are the preset\'s: only a logged one that differs is named', async () => {
    const { variantRuleNotes } = await import('./casinoVariant');
    const none = { decks: null, s17: null, payout: null };
    const notes = (g: Parameters<typeof variantRuleNotes>[0], p: Parameters<typeof variantRuleNotes>[1]) => {
      const n = variantRuleNotes(g, p);
      return [...n.applied, ...n.unapplied];
    };
    // Unlogged: nothing assumed, nothing listed.
    expect(notes(none, 'freebet')).toEqual([]);
    // Logged and matching the preset: nothing listed.
    expect(notes({ ...none, rsa: true, maxSplitHands: 4, doubleOn: 'any2', doubleSplitAces: false }, 'freebet')).toEqual([]);
    expect(notes({ ...none, rsa: false }, 'switch')).toEqual([]);
    expect(notes({ ...none, doubleSplitAces: true }, 's21-h17')).toEqual([]);
    // Logged and different.
    expect(notes({ ...none, rsa: false }, 'freebet')).toEqual(['no resplitting aces']);
    expect(notes({ ...none, rsa: true }, 'switch')).toEqual(['resplitting aces']);
    expect(notes({ ...none, maxSplitHands: 2 }, 'freebet')).toEqual(['split to 2 hands']);
    expect(notes({ ...none, doubleOn: '10-11' }, 's21-s17')).toEqual(['doubling on 10-11 only']);
    expect(notes({ ...none, doubleSplitAces: true }, 'freebet')).toEqual(['doubling on split aces']);
    expect(notes({ ...none, doubleSplitAces: false }, 's21-h17')[0]).toMatch(/hit and double/);
  });

  it('the summary names the variant once when the house name already says it', () => {
    expect(labelledSummary(game('g', { variant: 'freebet', variantName: 'Free Bet Blackjack' }))).toMatch(/^Free Bet Blackjack: 6D H17/);
    expect(labelledSummary(game('g', { variant: 'freebet', variantName: '21st Century' }))).toMatch(/^21st Century: Free Bet · 6D H17/);
  });
});

// C22 (audit 2026-10-29): a logged DAS or surrender rule unlike the preset's is named.
// R4 (review of C22): a rule the edge is worked out for is a neutral note, not a
// warning beside the edge that already uses it; only rules the edge cannot
// take (decks, Switch's payout, Spanish 21 split aces that may not double) warn.
describe('variantRuleNotes: what the edge used, and what it could not (C22, R4)', () => {
  const none = { decks: null, s17: null, payout: null, rsa: null, doubleSplitAces: null, maxSplitHands: null, doubleOn: null } as const;

  it('DAS and surrender are applied to the edge, so they are a note, not a warning', async () => {
    const { variantRuleNotes } = await import('./casinoVariant');
    const s21 = variantRuleNotes({ ...none, das: false, surrender: false }, 's21-h17');
    expect(s21.applied).toEqual(['no doubling after a split', 'no surrender']);
    expect(s21.unapplied).toEqual([]);
    expect(s21.appliedLine).toBe(
      "Used for the edge, unlike the Spanish 21, H17 preset: no doubling after a split, no surrender. The Charts tab shows the preset's chart.",
    );
    expect(variantRuleNotes({ ...none, surrender: true }, 'freebet').applied).toEqual(['late surrender']);
    expect(variantRuleNotes({ ...none, das: true, surrender: false }, 'freebet').applied).toEqual([]);
    expect(variantRuleNotes({ ...none, das: null, surrender: null }, 's21-h17').applied).toEqual([]);
  });

  it('Free Bet split to 2 and Spanish 21 at 6:5 are notes; the edge uses both', async () => {
    const { variantRuleNotes } = await import('./casinoVariant');
    expect(variantRuleNotes({ ...none, maxSplitHands: 2 }, 'freebet')).toMatchObject({ applied: ['split to 2 hands'], unapplied: [] });
    expect(variantRuleNotes({ ...none, payout: '6:5' }, 's21-h17')).toMatchObject({ applied: ['blackjack 6:5'], unapplied: [] });
    expect(variantRuleNotes({ ...none, payout: '6:5' }, 'freebet')).toMatchObject({ applied: ['blackjack 6:5'], unapplied: [] });
  });

  it('only what the edge cannot take warns', async () => {
    const { variantRuleNotes } = await import('./casinoVariant');
    expect(variantRuleNotes({ ...none, decks: 8 }, 'freebet').unapplied).toEqual([
      'Logged 8 decks; the edge is worked out for an infinite deck, so the decks do not change it.',
    ]);
    expect(variantRuleNotes({ ...none, payout: '3:2' }, 'switch').unapplied).toEqual([
      'Logged blackjack 3:2; Blackjack Switch pays a blackjack 1:1, as these figures assume.',
    ]);
    expect(variantRuleNotes({ ...none, doubleSplitAces: false }, 's21-h17').unapplied).toEqual([
      'Logged no doubling on split aces; the Spanish 21, H17 figures let split aces hit and double.',
    ]);
  });
});
