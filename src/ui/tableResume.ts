import type { Card, Rank, Suit } from '../engine/cards';
import type { CutOffRound, Game, GameResumeState, ResumeShoe } from '../engine/game';
import type { Profile } from '../store/types';
import {
  TABLE_RESUME_KEY,
  TABLE_ROUND_KEY,
  clearSavedTable,
  markRestored,
  readSlot,
  removeSlot,
  writeSlot,
} from './tableResumeSlot';
import { makePlayGame, type PlayGame } from './losingShoe';
import { playConfigFor } from './playConfig';
import { resumeBankroll } from './playBankroll';
import type { KeptSession } from './tableKeep';

/**
 * TRACK 3: THE TABLE COMES BACK AFTER IOS TAKES IT (2026-11-07).
 *
 * A call or a Maps check in the car can get the page evicted, and the open
 * table lived only in memory -- forty rounds of stamina practice, gone. So
 * the table is written to disk at every round boundary, in the same breath as
 * the round's stats (useGame), and the next Play mount takes it back.
 *
 * Kept across every in-app exit too (Home, Drills, Stats, a cancelled profile
 * edit): it is discarded only when the session is over (End, New shoe), when
 * a new table is asked for (App's applyProfile: profile options, a bankroll
 * reset, the losing shoe, a backup import), when the profile or its rules
 * changed underneath it, when the bankroll on disk is no longer the one it
 * wrote, or after RESUME_MAX_AGE_MS.
 *
 * A round the page died in is not dealt again. Its shoe and count, as far as
 * it had gone, are kept in a second small key after every move; on the way
 * back the round is voided and its cards burned -- the ones shown stay
 * counted -- so the count the app holds is the count the driver saw.
 */

export { TABLE_RESUME_KEY, TABLE_ROUND_KEY, clearSavedTable, noteCrash } from './tableResumeSlot';
/** A shoe last written longer ago than this is not resumed. */
export const RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// ---------------------------------------------------------------- cards

const RANKS: ReadonlySet<string> = new Set(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
const SUITS: ReadonlySet<string> = new Set(['s', 'h', 'd', 'c']);

/** "As", "Td" (T is ten), "9c". */
export function encodeCard(c: Card): string {
  return `${c.rank === '10' ? 'T' : c.rank}${c.suit}`;
}

export function decodeCard(s: unknown): Card {
  if (typeof s !== 'string' || s.length !== 2) throw new Error(`bad card ${String(s)}`);
  const rank = s[0] === 'T' ? '10' : s[0]!;
  const suit = s[1]!;
  if (!RANKS.has(rank) || !SUITS.has(suit)) throw new Error(`bad card ${s}`);
  return { rank: rank as Rank, suit: suit as Suit };
}

const encodeCards = (cs: readonly Card[]): string => cs.map(encodeCard).join('');
function decodeCards(s: unknown): Card[] {
  if (typeof s !== 'string' || s.length % 2 !== 0) throw new Error('bad card list');
  const out: Card[] = [];
  for (let i = 0; i < s.length; i += 2) out.push(decodeCard(s.slice(i, i + 2)));
  return out;
}

/** A GameResumeState with every card a two-letter code. */
type EncodedResume = Record<string, unknown>;

function encodeShoe(s: ResumeShoe): Record<string, unknown> {
  return s.kind === 'fair' ? { ...s, upcoming: encodeCards(s.upcoming) } : { ...s };
}
function decodeShoe(raw: unknown): ResumeShoe {
  const s = raw as Record<string, unknown>;
  if (s?.kind === 'rigged') return { kind: 'rigged', dealt: num(s.dealt) };
  if (s?.kind !== 'fair') throw new Error('bad shoe');
  return { kind: 'fair', upcoming: decodeCards(s.upcoming), dealt: num(s.dealt), cut: num(s.cut) };
}

function num(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('bad number');
  return v;
}
function nums(v: unknown, n: number): number[] {
  if (!Array.isArray(v) || v.length !== n) throw new Error('bad counts');
  return v.map(num);
}

/** The game state as JSON-safe data, every card a two-letter code. */
export function encodeResume(s: GameResumeState): EncodedResume {
  return {
    ...s,
    shoe: encodeShoe(s.shoe),
    trail: encodeCards(s.trail),
    dealerCards: encodeCards(s.dealerCards),
    seats: s.seats.map((seat) => ({ ...seat, hands: seat.hands.map((h) => ({ ...h, cards: encodeCards(h.cards) })) })),
  };
}

/** Throws on anything malformed; the caller discards. */
export function decodeResume(raw: unknown): GameResumeState {
  const r = raw as Record<string, unknown>;
  if (!r || typeof r !== 'object') throw new Error('bad state');
  if (r.phase !== 'idle' && r.phase !== 'settled') throw new Error('bad phase');
  if (!Array.isArray(r.seats) || !Array.isArray(r.events) || !Array.isArray(r.sideDecisions)) throw new Error('bad lists');
  const seats = (r.seats as Record<string, unknown>[]).map((seat) => {
    if (seat?.kind !== 'player' && seat?.kind !== 'bot') throw new Error('bad seat');
    if (!Array.isArray(seat.hands)) throw new Error('bad hands');
    return { ...seat, hands: (seat.hands as Record<string, unknown>[]).map((h) => ({ ...h, cards: decodeCards(h.cards) })) };
  }) as unknown as GameResumeState['seats'];
  const playerSeatIndex = num(r.playerSeatIndex);
  if (seats[playerSeatIndex]?.kind !== 'player') throw new Error('bad player seat');
  for (const k of ['bankroll', 'roundNo', 'handsPlayed', 'runningCount', 'active', 'countCheckPromptCount']) num(r[k]);
  return {
    ...(r as unknown as GameResumeState),
    shoe: decodeShoe(r.shoe),
    trail: decodeCards(r.trail),
    dealerCards: decodeCards(r.dealerCards),
    sideRanks: nums(r.sideRanks, 13),
    sideSuits: nums(r.sideSuits, 4),
    seats,
  };
}

function encodeCutOff(c: CutOffRound): Record<string, unknown> {
  return { ...c, shoe: encodeShoe(c.shoe), trail: encodeCards(c.trail) };
}
function decodeCutOff(raw: unknown): CutOffRound {
  const r = raw as Record<string, unknown>;
  return {
    round: num(r.round),
    shoe: decodeShoe(r.shoe),
    runningCount: num(r.runningCount),
    trail: decodeCards(r.trail),
    sideRanks: nums(r.sideRanks, 13),
    sideSuits: nums(r.sideSuits, 4),
  };
}

// ---------------------------------------------------------------- the saved table

export interface SavedTable {
  version: 1;
  /** Epoch ms of this write; expiry is measured from it. */
  savedAt: number;
  /** resumeKeyFor(): the game definition the table was dealt under. */
  key: string;
  /** This session's start stake (GameConfig.bankrollStart, the report's delta base). */
  bankrollStart: number;
  /** The losing shoe's script seed; absent for a fair shoe. */
  scriptSeed?: number;
  session: KeptSession;
  game: EncodedResume;
}

interface SavedRound {
  version: 1;
  sessionId: string;
  savedAt: number;
  rec: Record<string, unknown>;
}

/**
 * The game definition a saved table belongs to: the profile (its content,
 * less the carried bankroll, which the table itself moves every round) and
 * the losing-shoe switch (read when the game is built).
 */
export function resumeKeyFor(profile: Profile, losingShoe: boolean): string {
  const { bankrollNow: _carried, ...rest } = profile;
  void _carried;
  return JSON.stringify([profile.id, rest, losingShoe]);
}

/**
 * Between rounds, with no check being asked: the only moments a table may be
 * written. Track 1 adds its own open-dialog conditions here (a distraction).
 */
export function resumeSavable(game: Game): boolean {
  return game.resumable;
}

/**
 * Write the table. A no-op (false) when it is not between rounds or a check
 * is open -- never a throw, since it runs in an effect.
 */
export function saveTable(t: {
  playGame: PlayGame;
  session: KeptSession;
  key: string;
  now: number;
}): boolean {
  const { game } = t.playGame;
  if (game.roundNo === 0 || !resumeSavable(game)) return false;
  let state: GameResumeState;
  try {
    state = game.toResume();
  } catch {
    return false;
  }
  const saved: SavedTable = {
    version: 1,
    savedAt: t.now,
    key: t.key,
    bankrollStart: game.cfg.bankrollStart,
    ...(t.playGame.scriptSeed === undefined || t.playGame.boundaries === null ? {} : { scriptSeed: t.playGame.scriptSeed }),
    session: { ...t.session },
    game: encodeResume(state),
  };
  const ok = writeSlot(TABLE_RESUME_KEY, JSON.stringify(saved));
  // The round is over: nothing of it is left to burn.
  removeSlot(TABLE_ROUND_KEY);
  if (ok) markRestored(false);
  return ok;
}

/** Mid-round: the shoe and the count of what has been shown so far. */
export function saveCutOff(game: Game, sessionId: string, now: number): boolean {
  if (game.phase !== 'player' && game.phase !== 'insurance') return false;
  const saved: SavedRound = { version: 1, sessionId, savedAt: now, rec: encodeCutOff(game.cutOffRecord()) };
  return writeSlot(TABLE_ROUND_KEY, JSON.stringify(saved));
}

/** What a resumed mount starts from. */
export interface ResumedTable {
  playGame: PlayGame;
  session: KeptSession;
  savedAt: number;
  /** The last round played to its end. */
  roundNo: number;
  /** The round the page died in, voided and burned; null when it died between rounds. */
  cutOff: number | null;
}

/**
 * The saved table for this profile, built back into a game -- or null, with
 * anything that does not belong (another profile, rules changed, the
 * bankroll moved, too old, malformed) cleared.
 */
export function takeSavedTable(profile: Profile, losingShoe: boolean, now: number): ResumedTable | null {
  const raw = readSlot(TABLE_RESUME_KEY);
  if (raw === null) {
    removeSlot(TABLE_ROUND_KEY);
    return null;
  }
  try {
    const saved = raw as SavedTable;
    if (saved.version !== 1) throw new Error('version');
    if (saved.key !== resumeKeyFor(profile, losingShoe)) throw new Error('another game');
    if (!(now - num(saved.savedAt) <= RESUME_MAX_AGE_MS)) throw new Error('expired');
    const session = saved.session;
    if (!session || typeof session.id !== 'string') throw new Error('bad session');
    for (const k of ['committed', 'sideCommitted', 'peeks', 'paced', 'storedBankroll'] as const) num(session[k]);
    // The bankroll on disk is still the one this table wrote (a reset clears it).
    if (resumeBankroll(profile) !== session.storedBankroll) throw new Error('bankroll moved');
    const state = decodeResume(saved.game);
    const cfg = playConfigFor(profile, num(saved.bankrollStart), Math.floor(Math.random() * 0x7fffffff));
    const playGame = makePlayGame(cfg, losingShoe, saved.scriptSeed);
    playGame.game.restoreResume(state);
    let cutOff: number | null = null;
    const round = readSlot(TABLE_ROUND_KEY) as SavedRound | null;
    if (round && round.version === 1 && round.sessionId === session.id) {
      const rec = decodeCutOff(round.rec);
      if (rec.round === state.roundNo + 1) {
        playGame.game.voidCutOffRound(rec);
        cutOff = rec.round;
      }
    }
    markRestored(true);
    return { playGame, session: { ...session }, savedAt: saved.savedAt, roundNo: state.roundNo, cutOff };
  } catch {
    clearSavedTable();
    return null;
  }
}

/** Tests only. */
export function _resetTableResumeForTests(): void {
  markRestored(false);
}
