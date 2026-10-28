import { describe, it, expect } from 'vitest';
import { blankGame, emptyCasinoLog, type Casino, type CasinoGame, type CasinoLog } from '../store/casinoLog';
import { gameExtras, limitsText, matchesQuery, ruleLines, sideBetText, sortDirectory } from './casinoDirectory';

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();
const AT = '2026-10-01T12:00:00.000Z';

function game(over: Partial<CasinoGame> = {}): CasinoGame {
  return { ...blankGame('g'), ...over };
}

function casino(name: string, over: Partial<Casino> = {}): Casino {
  return {
    id: `c-${name}`,
    name,
    games: [game()],
    status: 'ok',
    notes: '',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

const logOf = (...casinos: Casino[]): CasinoLog => ({ ...emptyCasinoLog(), casinos });

describe('limitsText', () => {
  it('says what is known of the limits, and nothing when nothing is', () => {
    expect(limitsText(25, 500)).toBe('$25–$500');
    expect(limitsText(25, null)).toBe('$25 min');
    expect(limitsText(undefined, 1000)).toBe('$1,000 max');
    expect(limitsText(null, undefined)).toBe('');
  });
});

describe('sideBetText and gameExtras', () => {
  it('names the bet, its pay table and its limits', () => {
    expect(sideBetText({ bet: 'luckyLadies', payTable: 'll-a', minBet: 5, maxBet: 100 })).toBe(
      'Lucky Ladies (Table A (1000/125/19/9/4)) $5–$100',
    );
    // A pay table the build does not know is left out rather than invented.
    expect(sideBetText({ bet: 'twentyOnePlus3', payTable: 'nope' })).toBe('21+3');
  });

  it('lists only what is logged', () => {
    expect(gameExtras(game())).toEqual([]);
    expect(
      gameExtras(game({ minBet: 15, maxBet: 1000, midShoeEntry: 'no', csm: true, sideBets: [{ bet: 'perfectPairs', payTable: 'x' }] })),
    ).toEqual(['$15–$1,000', 'No mid-shoe', 'CSM', 'Side: Perfect Pairs']);
    expect(gameExtras(game({ midShoeEntry: 'allowed' }))).toEqual(['Mid-shoe OK']);
  });
});

describe('matchesQuery', () => {
  const el = casino('El Cortez', {
    area: 'Downtown',
    notes: 'Ask for Mike at the cage',
    games: [game({ decks: 6, s17: false, das: true, label: 'High limit', sideBets: [{ bet: 'luckyLadies', payTable: 'll-a' }] })],
  });
  const room = casino('Bicycle', { kind: 'cardroom', games: [game({ variant: 'freebet', commissionPer100: 1 })] });

  it('finds a casino by its name, area, notes, game label, rules, side bets, variant or kind', () => {
    for (const q of ['cortez', 'DOWNTOWN', 'mike', 'high limit', 'h17', '6d', 'lucky', 'ladies table a']) {
      expect(matchesQuery(el, q, NOW), q).toBe(true);
    }
    expect(matchesQuery(room, 'free bet', NOW)).toBe(true);
    expect(matchesQuery(room, 'card room', NOW)).toBe(true);
    expect(matchesQuery(el, 'card room', NOW)).toBe(false);
  });

  it('needs every word, anywhere; an empty query matches all', () => {
    expect(matchesQuery(el, 'downtown h17', NOW)).toBe(true);
    expect(matchesQuery(el, 'downtown s17', NOW)).toBe(false);
    expect(matchesQuery(el, '   ', NOW)).toBe(true);
  });

  it('matches on standing', () => {
    expect(matchesQuery(casino('X', { status: 'burned', burnedUntil: null }), 'burned', NOW)).toBe(true);
    expect(matchesQuery(casino('X'), 'burned', NOW)).toBe(false);
  });
});

describe('sortDirectory', () => {
  const a = casino('aria', { driveMinutes: 30 });
  const b = casino('Bellagio', { miles: 1 });
  const c = casino('Cosmo', { status: 'burned', burnedUntil: null });
  const d = casino('downtown 10');
  const d2 = casino('Downtown 9');
  const log = logOf(c, d, a, b, d2);

  it('by name, A to Z, ignoring case and reading numbers as numbers', () => {
    expect(sortDirectory(log, log.casinos, 'name', NOW, null).map((x) => x.name)).toEqual([
      'aria',
      'Bellagio',
      'Cosmo',
      'Downtown 9',
      'downtown 10',
    ]);
  });

  it('by distance: nearest first on one scale, then the rest by name', () => {
    // 1 mile is a couple of minutes' drive; 30 minutes is further.
    expect(sortDirectory(log, log.casinos, 'distance', NOW, null).map((x) => x.name)).toEqual([
      'Bellagio',
      'aria',
      'Cosmo',
      'Downtown 9',
      'downtown 10',
    ]);
  });

  it('by EV: the best figure first, casinos with none after, by name', () => {
    const ev: Record<string, number | null> = { 'c-aria': -5, 'c-Cosmo': 40, 'c-Bellagio': 12 };
    expect(sortDirectory(log, log.casinos, 'ev', NOW, null, (x) => ev[x.id] ?? null).map((x) => x.name)).toEqual([
      'Cosmo',
      'Bellagio',
      'aria',
      'Downtown 9',
      'downtown 10',
    ]);
  });

  it('by standing: burned last, and only the casinos asked for', () => {
    const out = sortDirectory(log, [a, c, b], 'standing', NOW, null).map((x) => x.name);
    expect(out[out.length - 1]).toBe('Cosmo');
    expect(out.sort()).toEqual(['Bellagio', 'Cosmo', 'aria']);
  });
});

describe('ruleLines', () => {
  const value = (g: CasinoGame, label: string) => ruleLines(g).find((l) => l.label === label);

  it('says every rule, with what is not logged as null', () => {
    const lines = ruleLines(game());
    expect(lines.map((l) => l.label)).toEqual([
      'Game',
      'Decks',
      'Dealer soft 17',
      'Double after split',
      'Late surrender',
      'Resplit aces',
      'Double split aces',
      'Split to',
      'Double on',
      'Blackjack pays',
      'Cut card',
      'Min bet',
      'Max bet',
      'Mid-shoe entry',
      'Shuffler',
      'Rounds per hour',
      'Commission',
    ]);
    expect(value(game(), 'Decks')!.value).toBeNull();
    expect(value(game(), 'Dealer soft 17')!.value).toBeNull();
    expect(value(game(), 'Game')!.value).toBe('Standard blackjack');
    expect(value(game(), 'Rounds per hour')!.value).toBe('80 (default)');
  });

  it('reads the logged values, the penetration beside the cut, and the owner’s ? marks', () => {
    const g = game({
      decks: 6,
      s17: false,
      das: true,
      surrender: false,
      payout: '3:2',
      cutDecksLeft: 1.5,
      maxSplitHands: 4,
      doubleOn: '10-11',
      commissionPer100: 0,
      roundsPerHour: 60,
      csm: false,
      unsure: ['das', 'cutDecksLeft'],
      variant: 'freebet',
      variantName: 'Free Bet Blackjack',
    });
    expect(value(g, 'Decks')!.value).toBe('6');
    expect(value(g, 'Dealer soft 17')!.value).toBe('Hits (H17)');
    expect(value(g, 'Double after split')).toMatchObject({ value: 'Yes', unsure: true });
    expect(value(g, 'Late surrender')).toMatchObject({ value: 'No', unsure: false });
    expect(value(g, 'Cut card')).toMatchObject({ value: '1.5 decks left (75% dealt)', unsure: true });
    expect(value(g, 'Split to')!.value).toBe('4 hands');
    expect(value(g, 'Double on')!.value).toBe('10-11 only');
    expect(value(g, 'Commission')!.value).toBe('None');
    expect(value(g, 'Rounds per hour')!.value).toBe('60');
    expect(value(g, 'Game')!.value).toBe('Free Bet');
    expect(value(g, 'House name')!.value).toBe('Free Bet Blackjack');
    expect(value(game({ s17: true, doubleOn: 'any2', commissionPer100: 1, csm: true }), 'Dealer soft 17')!.value).toBe('Stands (S17)');
    expect(value(game({ doubleOn: 'any2' }), 'Double on')!.value).toBe('Any two cards');
    expect(value(game({ commissionPer100: 1 }), 'Commission')!.value).toBe('$1 per $100');
    expect(value(game({ csm: true }), 'Shuffler')!.value).toBe('Continuous (CSM): no counting');
  });
});
