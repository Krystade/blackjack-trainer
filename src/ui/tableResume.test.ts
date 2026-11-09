import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _setStorage } from '../store/persist';
import { makeDefaultProfile } from '../store/profiles';
import type { Profile } from '../store/types';
import type { Game } from '../engine/game';
import { makePlayGame, realignLosingShoe, type PlayGame } from './losingShoe';
import { playConfigFor } from './playConfig';
import {
  RESUME_MAX_AGE_MS,
  TABLE_RESUME_KEY,
  TABLE_ROUND_KEY,
  _resetTableResumeForTests,
  clearSavedTable,
  decodeCard,
  decodeResume,
  encodeCard,
  encodeResume,
  noteCrash,
  resumeKeyFor,
  saveCutOff,
  saveTable,
  takeSavedTable,
} from './tableResume';
import type { KeptSession } from './tableKeep';

/** Track 3 (U3): the table on disk -- written only between rounds, taken back only by its own game. */

let map: Map<string, string>;
beforeEach(() => {
  map = new Map();
  _setStorage({
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as Pick<Storage, 'getItem' | 'setItem'>);
  _resetTableResumeForTests();
});
afterEach(() => _setStorage(null));

const T0 = 1_800_000_000_000;

function profileWith(over: Partial<Profile> = {}): Profile {
  const p = makeDefaultProfile();
  return { ...p, countCheckEvery: 0, seats: { ...p.seats, bots: 1 }, ...over };
}

function playRound(g: Game): void {
  g.startRound(1);
  if (g.phase === 'insurance') g.insuranceDecision(false);
  while (g.phase === 'player') g.act('stand');
}

/** Stop in the player phase of the next round that has one; a round that settles on the deal is a boundary (onSettled). */
function dealIntoPlayerPhase(g: Game, onSettled?: () => void): void {
  for (let i = 0; i < 30; i++) {
    g.startRound(1);
    if (g.phase === 'insurance') g.insuranceDecision(false);
    if (g.phase === 'player') return;
    onSettled?.();
  }
  throw new Error('no round reached the player phase');
}

function table(profile: Profile, rounds: number, losing = false): PlayGame {
  const pg = makePlayGame(playConfigFor(profile, profile.bankrollStart, 7), losing);
  for (let r = 0; r < rounds; r++) {
    if (losing) realignLosingShoe(pg);
    playRound(pg.game);
  }
  return pg;
}

function session(pg: PlayGame, profile: Profile): KeptSession {
  return {
    id: 'sess-1',
    committed: pg.game.events.length,
    sideCommitted: 0,
    peeks: 2,
    paced: 1,
    // The fixture profile is not in storage: resumeBankroll reads it off the profile.
    storedBankroll: profile.bankrollNow ?? profile.bankrollStart,
  };
}

function save(pg: PlayGame, profile: Profile, now = T0, losing = false): boolean {
  return saveTable({ playGame: pg, session: session(pg, profile), key: resumeKeyFor(profile, losing), now });
}

describe('card codec', () => {
  it('two letters a card, T for ten, and back', () => {
    expect(encodeCard({ rank: '10', suit: 'h' })).toBe('Th');
    expect(encodeCard({ rank: 'A', suit: 's' })).toBe('As');
    expect(decodeCard('Th')).toEqual({ rank: '10', suit: 'h' });
    expect(decodeCard('9c')).toEqual({ rank: '9', suit: 'c' });
    expect(() => decodeCard('1h')).toThrow();
    expect(() => decodeCard('Ax')).toThrow();
    expect(() => decodeCard('A')).toThrow();
  });

  it('a game state survives encode -> JSON -> decode', () => {
    const p = profileWith();
    const pg = table(p, 9);
    const s = pg.game.toResume();
    const back = decodeResume(JSON.parse(JSON.stringify(encodeResume(s))));
    expect(back).toEqual(s);
  });
});

describe('saveTable / takeSavedTable', () => {
  it('round trip: the same round, bankroll, count, events, shoe and session', () => {
    const p = profileWith();
    const pg = table(p, 8);
    expect(save(pg, p)).toBe(true);
    const got = takeSavedTable(p, false, T0 + 60_000);
    expect(got).not.toBeNull();
    const g = got!.playGame.game;
    expect(g.roundNo).toBe(8);
    expect(got!.roundNo).toBe(8);
    expect(got!.cutOff).toBeNull();
    expect(got!.savedAt).toBe(T0);
    expect(g.bankroll).toBe(pg.game.bankroll);
    expect(g.runningCount).toBe(pg.game.runningCount);
    expect(g.events).toEqual(pg.game.events);
    expect(g.shoe.upcoming).toEqual(pg.game.shoe.upcoming);
    expect(g.cfg.bankrollStart).toBe(pg.game.cfg.bankrollStart);
    expect(got!.session).toEqual(session(pg, p));
  });

  it('writes nothing before the first round, mid-round, or with a count check open (D4)', () => {
    const p = profileWith();
    expect(save(table(p, 0), p)).toBe(false);
    expect(map.has(TABLE_RESUME_KEY)).toBe(false);

    const mid = table(p, 3);
    dealIntoPlayerPhase(mid.game);
    expect(save(mid, p)).toBe(false);
    expect(map.has(TABLE_RESUME_KEY)).toBe(false);

    // T1-1B: a new profile's Count checks switch is off; turn it on with the cadence.
    const checked = table(profileWith({ countCheckEvery: 1, playChecks: { count: true } }), 0);
    playRound(checked.game);
    expect(checked.game.poseCountCheck()).toBe(true);
    expect(save(checked, p)).toBe(false);
    expect(map.has(TABLE_RESUME_KEY)).toBe(false);
  });

  it('another profile, changed rules or the losing shoe switched: not resumed, and cleared', () => {
    const p = profileWith();
    save(table(p, 4), p);
    expect(takeSavedTable({ ...p, id: 'other' }, false, T0)).toBeNull();
    expect(map.get(TABLE_RESUME_KEY) ?? null).toBeNull();

    save(table(p, 4), p);
    expect(takeSavedTable({ ...p, rules: { ...p.rules, das: !p.rules.das } }, false, T0)).toBeNull();

    save(table(p, 4), p);
    expect(takeSavedTable(p, true, T0)).toBeNull();
  });

  it('the carried bankroll alone does not break the key', () => {
    const p = profileWith({ bankrollNow: 900 });
    const pg = table(p, 4);
    save(pg, p);
    expect(resumeKeyFor(p, false)).toBe(resumeKeyFor({ ...p, bankrollNow: 1234 }, false));
    expect(takeSavedTable(p, false, T0)).not.toBeNull();
  });

  it('a bankroll moved on disk since the write (a reset) is not resumed', () => {
    const p = profileWith({ bankrollNow: 900 });
    save(table(p, 4), p);
    expect(takeSavedTable({ ...p, bankrollNow: p.bankrollStart }, false, T0)).toBeNull();
  });

  it('expires 12 hours after the write', () => {
    const p = profileWith();
    save(table(p, 4), p);
    expect(takeSavedTable(p, false, T0 + RESUME_MAX_AGE_MS + 1)).toBeNull();
    save(table(p, 4), p);
    expect(takeSavedTable(p, false, T0 + RESUME_MAX_AGE_MS)).not.toBeNull();
  });

  it('malformed storage is cleared, never thrown', () => {
    const p = profileWith();
    map.set(TABLE_RESUME_KEY, '{not json');
    expect(takeSavedTable(p, false, T0)).toBeNull();
    save(table(p, 4), p);
    const raw = JSON.parse(map.get(TABLE_RESUME_KEY)!);
    raw.game.dealerCards = 'Zz';
    map.set(TABLE_RESUME_KEY, JSON.stringify(raw));
    expect(takeSavedTable(p, false, T0)).toBeNull();
    expect(map.get(TABLE_RESUME_KEY) ?? null).toBeNull();
  });

  it('a storage that throws costs the resume point, not the round', () => {
    _setStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    const p = profileWith();
    expect(() => save(table(p, 3), p)).not.toThrow();
    expect(save(table(p, 3), p)).toBe(false);
  });

  it('the losing shoe resumes on its own script', () => {
    const p = profileWith({ seats: { ...makeDefaultProfile().seats, bots: 0, playerHands: 1 } });
    const pg = table(p, 3, true);
    save(pg, p, T0, true);
    const got = takeSavedTable(p, true, T0);
    expect(got).not.toBeNull();
    expect(got!.playGame.boundaries).not.toBeNull();
    expect(got!.playGame.game.shoe.upcoming).toEqual(pg.game.shoe.upcoming);
  });
});

describe('the round the page died in', () => {
  it('is voided on the way back: shown cards counted, bet void, round number unchanged', () => {
    const p = profileWith();
    const pg = table(p, 5);
    save(pg, p);
    let before = pg.game.bankroll;
    // As useGame does: every settled round is written.
    dealIntoPlayerPhase(pg.game, () => {
      save(pg, p);
      before = pg.game.bankroll;
    });
    const round = pg.game.roundNo;
    expect(saveCutOff(pg.game, 'sess-1', T0)).toBe(true);
    const got = takeSavedTable(p, false, T0)!;
    expect(got.cutOff).toBe(round);
    const g = got.playGame.game;
    expect(g.roundNo).toBe(round - 1);
    expect(g.bankroll).toBe(before);
    expect(g.runningCount).toBe(pg.game.runningCount);
    expect(g.shoe.cardsDealt).toBe(pg.game.shoe.cardsDealt);
    expect(g.shoe.upcoming).toEqual(pg.game.shoe.upcoming);
  });

  it('is ignored from another session or for a round that is not the next one', () => {
    const p = profileWith();
    const pg = table(p, 5);
    save(pg, p);
    dealIntoPlayerPhase(pg.game);
    saveCutOff(pg.game, 'another-session', T0);
    expect(takeSavedTable(p, false, T0)!.cutOff).toBeNull();

    const pg2 = table(p, 5);
    save(pg2, p);
    while (pg2.game.phase === 'player' || pg2.game.roundNo < 7) {
      if (pg2.game.phase === 'player') pg2.game.act('stand');
      else playRound(pg2.game);
    }
    dealIntoPlayerPhase(pg2.game);
    saveCutOff(pg2.game, 'sess-1', T0);
    expect(takeSavedTable(p, false, T0)!.cutOff).toBeNull();
  });

  it('is only written mid-round, and a boundary save drops it', () => {
    const p = profileWith();
    const pg = table(p, 5);
    expect(saveCutOff(pg.game, 'sess-1', T0)).toBe(false);
    dealIntoPlayerPhase(pg.game);
    saveCutOff(pg.game, 'sess-1', T0);
    expect(map.has(TABLE_ROUND_KEY)).toBe(true);
    while (pg.game.phase === 'player') pg.game.act('stand');
    save(pg, p);
    expect(map.get(TABLE_ROUND_KEY) ?? null).toBeNull();
  });
});

describe('clear and crash', () => {
  it('clearSavedTable drops both keys', () => {
    const p = profileWith();
    const pg = table(p, 5);
    save(pg, p);
    dealIntoPlayerPhase(pg.game);
    saveCutOff(pg.game, 'sess-1', T0);
    clearSavedTable();
    expect(map.get(TABLE_RESUME_KEY) ?? null).toBeNull();
    expect(map.get(TABLE_ROUND_KEY) ?? null).toBeNull();
  });

  it('a crash after a restore and before its next save clears it; after a save it does not', () => {
    const p = profileWith();
    save(table(p, 5), p);
    noteCrash();
    expect(map.has(TABLE_RESUME_KEY), 'nothing restored yet: a crash keeps the table').toBe(true);
    takeSavedTable(p, false, T0);
    noteCrash();
    expect(map.get(TABLE_RESUME_KEY) ?? null).toBeNull();

    save(table(p, 5), p);
    const got = takeSavedTable(p, false, T0)!;
    playRound(got.playGame.game);
    saveTable({ playGame: got.playGame, session: got.session, key: resumeKeyFor(p, false), now: T0 });
    noteCrash();
    expect(map.has(TABLE_RESUME_KEY)).toBe(true);
  });
});
