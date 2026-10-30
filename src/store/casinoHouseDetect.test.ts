import { describe, it, expect } from 'vitest';
import { emptyCasinoLog, isHouseGame, mergeImport, normGame, type CasinoLog } from './casinoLog';

/**
 * C9 follow-up: an import or a paste ticks House game on a game whose own
 * text (label, house name, notes) names a house game's features, and says
 * so. The games below are copied from Jack's import file
 * (casino-import-2026-10-20.json): Viejas's "21st Century" line, and two
 * card rooms whose games carry no such text and stay standard blackjack.
 */

const AT = '2026-10-21T12:00:00.000Z';
const LATER = '2026-10-25T12:00:00.000Z';
const base = { decks: null, s17: false, das: true, surrender: true, payout: '6:5', cutDecksLeft: null, minBet: null, maxBet: null, midShoeEntry: 'unknown', csm: false, roundsPerHour: null, rsa: false, maxSplitHands: 3 };
const viejas = {
  id: 'c-import-viejas', name: 'Viejas', kind: 'casino', miles: 113, status: 'ok', burnedUntil: null, notes: '', createdAt: AT, updatedAt: AT,
  games: [
    { ...base, id: 'g-import-viejas-1', s17: true },
    { ...base, id: 'g-import-viejas-2', label: '21st Century', variantName: '21st Century Blackjack', commissionPer100: 1, notes: "Line listed after Viejas in the notes - confirm it's Viejas." },
  ],
};
const hustler = {
  id: 'c-import-hustler-casino', name: 'Hustler Casino', kind: 'cardroom', miles: 31, status: 'ok', burnedUntil: null, notes: '', createdAt: AT, updatedAt: AT,
  games: [{ ...base, id: 'g-import-hustler-casino-1', s17: true, commissionPer100: 1, unsure: ['surrender'] }],
};
const oceans = {
  id: 'c-import-ocean-s-eleven-casino', name: "Ocean's Eleven Casino", kind: 'cardroom', status: 'ok', burnedUntil: null, notes: '', createdAt: AT, updatedAt: AT,
  games: [{ ...base, id: 'g-import-ocean-s-eleven-casino-1', label: '6D', commissionPer100: 1 }],
};
const file = (casinos: unknown[]) => JSON.stringify({ app: 'bjtrainer-casino-log', version: 2, exportedAt: AT, casinos, sessions: [], settings: { startingBankroll: null, updatedAt: null } });
const gameIn = (log: CasinoLog, id: string) => log.casinos.flatMap((c) => c.games).find((g) => g.id === id)!;

describe('house games are detected on import', () => {
  it("ticks Viejas's 21st Century game and no card-room game without house-game text", () => {
    const r = mergeImport(emptyCasinoLog(), file([viejas, hustler, oceans]));
    if (!r.ok) throw new Error(r.error);
    const g = gameIn(r.log, 'g-import-viejas-2');
    expect(g.houseGame).toBe(true);
    expect(g.houseGameDetected).toBe(true);
    for (const id of ['g-import-viejas-1', 'g-import-hustler-casino-1', 'g-import-ocean-s-eleven-casino-1']) {
      expect(gameIn(r.log, id).houseGame).toBeUndefined();
      expect(gameIn(r.log, id).houseGameDetected).toBeUndefined();
    }
    expect(r.report.houseGamesDetected).toEqual([{ casinoId: 'c-import-viejas', casino: 'Viejas', gameId: 'g-import-viejas-2', label: '21st Century' }]);
  });

  it.each([
    ['label', { label: 'Joker blackjack' }],
    ['label', { label: 'Natural 22' }],
    ['house name', { variantName: 'No-Bust 21' }],
    ['notes', { notes: 'Card room game, player-dealer rotates' }],
    ['notes', { notes: 'two jokers in each deck' }],
  ])('reads the %s', (_where, over) => {
    const c = { ...hustler, games: [{ ...hustler.games[0]!, ...over }] };
    const r = mergeImport(emptyCasinoLog(), file([c]));
    if (!r.ok) throw new Error(r.error);
    expect(gameIn(r.log, 'g-import-hustler-casino-1').houseGame).toBe(true);
    expect(r.report.houseGamesDetected).toHaveLength(1);
  });

  it('keeps an untick: a game marked not a house game here stays unticked, even when the file is newer', () => {
    const first = mergeImport(emptyCasinoLog(), file([viejas]));
    if (!first.ok) throw new Error(first.error);
    const unticked: CasinoLog = {
      ...first.log,
      casinos: first.log.casinos.map((c) => ({ ...c, games: c.games.map((g) => (g.id === 'g-import-viejas-2' ? { ...g, houseGame: false, houseGameDetected: undefined } : g)) })),
    };
    const g = gameIn(unticked, 'g-import-viejas-2');
    expect(isHouseGame(g)).toBe(false);
    const again = mergeImport(unticked, file([{ ...viejas, updatedAt: LATER }]));
    if (!again.ok) throw new Error(again.error);
    expect(gameIn(again.log, 'g-import-viejas-2').houseGame).toBe(false);
    expect(again.report.houseGamesDetected).toEqual([]);
  });

  it('the same file twice detects nothing the second time', () => {
    const first = mergeImport(emptyCasinoLog(), file([viejas]));
    if (!first.ok) throw new Error(first.error);
    const again = mergeImport(first.log, file([viejas]));
    if (!again.ok) throw new Error(again.error);
    expect(again.report.houseGamesDetected).toEqual([]);
    expect(gameIn(again.log, 'g-import-viejas-2').houseGameDetected).toBe(true);
  });

  it('the flags survive the stored blob, and an untick is kept as false', () => {
    const g = normGame(JSON.parse(JSON.stringify({ ...base, id: 'g', houseGame: true, houseGameDetected: true })), 'x');
    expect(g.houseGame).toBe(true);
    expect(g.houseGameDetected).toBe(true);
    const off = normGame(JSON.parse(JSON.stringify({ ...base, id: 'g', houseGame: false, houseGameDetected: true })), 'x');
    expect(off.houseGame).toBe(false);
    expect(off.houseGameDetected).toBeUndefined();
  });
});
