import { describe, it, expect } from 'vitest';
import { blankGame, normCasino, normGame, migrateCasinoLog } from '../store/casinoLog';
import { simInputFor } from '../store/casinoGameStats';
import { distanceMinutes, distanceOf, gameSummary, kindBadge, labelledSummary, tripMinutesOf, ASSUMED_MPH } from './casinoFigures';
import { makeDefaultProfile } from '../store/profiles';

const DEFAULT_PROFILE = makeDefaultProfile();

/** Wave M: the casino model for the owner's real notes. */
describe('Wave M casino fields', () => {
  it('round-trips the new game fields, and an old game reads back exactly as it was', () => {
    const g = normGame(
      { id: 'g', decks: 5, rsa: true, doubleSplitAces: false, maxSplitHands: 3, doubleOn: '10-11', commissionPer100: 1, variantName: ' 21st Century Blackjack ', unsure: ['das', 'das', 'bogus'] },
      'f',
    );
    expect(g).toMatchObject({ decks: 5, rsa: true, doubleSplitAces: false, maxSplitHands: 3, doubleOn: '10-11', commissionPer100: 1, variantName: '21st Century Blackjack', unsure: ['das'] });
    const old = normGame({ id: 'o', decks: 6, s17: false }, 'f');
    expect(old).toEqual(normGame(JSON.parse(JSON.stringify(old)), 'f'));
    expect('rsa' in old || 'unsure' in old || 'maxSplitHands' in old).toBe(false);
    expect(normGame({ id: 'x', maxSplitHands: 5, doubleOn: 'soft', commissionPer100: -1 }, 'f')).not.toHaveProperty('maxSplitHands');
  });

  it('casino kind and miles: kept when valid, absent otherwise', () => {
    expect(normCasino({ id: 'c', name: 'Pala', kind: 'cardroom', miles: 74, games: [] })).toMatchObject({ kind: 'cardroom', miles: 74 });
    const c = normCasino({ id: 'c', name: 'Pala', kind: 'pit', miles: -2, games: [] })!;
    expect(c).not.toHaveProperty('kind');
    expect(c).not.toHaveProperty('miles');
    expect(migrateCasinoLog({ version: 2, casinos: [{ id: 'c', name: 'A', kind: 'casino', miles: 3, games: [] }], sessions: [] })!.log.casinos[0]).toMatchObject({ kind: 'casino', miles: 3 });
  });

  it('the row summary carries the new rules and the owner\u2019s question marks', () => {
    expect(
      gameSummary({ decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: null, rsa: true, maxSplitHands: 4, commissionPer100: 1 }),
    ).toBe('6D H17 DAS LS RSA 3:2 · split 4 · $1/100');
    expect(gameSummary({ decks: 2, s17: false, das: true, surrender: null, payout: '3:2', cutDecksLeft: 1, rsa: false, unsure: ['das', 'decks', 'cutDecksLeft', 'rsa'] })).toBe(
      '2D? H17 DAS? NRSA? 3:2 · cut 1.0?',
    );
    expect(gameSummary({ decks: null, s17: null, das: null, surrender: null, payout: null, cutDecksLeft: null, doubleOn: '10-11', doubleSplitAces: true })).toBe('DSA D10-11');
    expect(labelledSummary({ ...blankGame('g'), variantName: '21st Century Blackjack', payout: '6:5' })).toBe('21st Century Blackjack: 6:5');
    expect(labelledSummary({ ...blankGame('g'), label: '21st Century', variantName: '21st Century Blackjack' })).toBe('21st Century Blackjack: Game not logged');
    expect(labelledSummary({ ...blankGame('g'), label: 'Pit 3', variantName: 'Free Bet' })).toBe('Pit 3, Free Bet: Game not logged');
    expect(kindBadge({ kind: 'cardroom' })).toBe('Card room');
    expect(kindBadge({})).toBeNull();
  });

  it('distance: live miles, then logged miles, then drive minutes, on one scale', () => {
    const here = { lat: 34, lon: -118 };
    const spot = { lat: 34.1, lon: -118 };
    expect(distanceOf({ location: spot, miles: 70, driveMinutes: 90 }, here)!.text).not.toContain('from home');
    const logged = distanceOf({ location: null, miles: 70, driveMinutes: 90 }, here)!;
    expect(logged).toMatchObject({ kind: 'miles', miles: 70, logged: true });
    expect(logged.text).toBe('70 mi from home');
    expect(distanceMinutes(logged)).toBeCloseTo((70 / ASSUMED_MPH) * 60, 9);
    expect(distanceOf({ location: null, miles: null, driveMinutes: 90 }, null)).toMatchObject({ kind: 'drive', minutes: 90 });
    expect(tripMinutesOf({ driveMinutes: 30, miles: 70 })).toBe(30);
    expect(tripMinutesOf({ driveMinutes: null, miles: 80 })).toBeCloseTo(120, 9);
    expect(tripMinutesOf({ driveMinutes: null, miles: null })).toBeNull();
  });

  it('the simulator input: known rules pass through, unknown ones assumed, card rooms charged', () => {
    const known = simInputFor({ ...blankGame('g'), decks: 5, rsa: true, doubleSplitAces: true, maxSplitHands: 4, doubleOn: 'any2', commissionPer100: 1 }, DEFAULT_PROFILE, [], 'cardroom');
    expect(known.spec).toMatchObject({ shoeDecks: 5, doubleSplitAces: true, commissionPct: 1 });
    expect(known.spec.rules).toMatchObject({ decks: 6, rsa: true });
    expect(known.spec).not.toHaveProperty('maxSplitHands');
    expect(known.spec).not.toHaveProperty('doubleOn');
    expect(known.assumed).not.toContain('rsa');
    const room = simInputFor(blankGame('g'), DEFAULT_PROFILE, [], 'cardroom');
    expect(room.assumed).toContain('commission');
    expect(room.spec.commissionPct).toBe(1);
    const casino = simInputFor(blankGame('g'), DEFAULT_PROFILE, [], 'casino');
    expect(casino.assumed).not.toContain('commission');
    expect(casino.spec.commissionPct).toBeUndefined();
    // The cache key moves with every new rule.
    expect(simInputFor({ ...blankGame('g'), rsa: true }, DEFAULT_PROFILE, []).key).not.toBe(simInputFor(blankGame('g'), DEFAULT_PROFILE, []).key);
  });
});
