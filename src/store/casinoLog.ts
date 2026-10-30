import { reportStorageFailure, shrinkDiagnostics } from './storageHealth';
import { subscribeToExternalWrites } from './crossTab';
import { isPresetId } from '../engine/variants/rules';
import type { PresetId } from '../engine/variants/rules';
import { normMethod, type BetMethod } from '../engine/betMethods';
import { normSideBets, type CasinoSideBet } from './casinoSideBets';
import { diag } from '../diag/diagnosticLog';

/**
 * WAVE J (lane C): THE REAL-PLAY NOTEBOOK. Casinos and the sessions played in
 * them, in dollars, on this device only.
 *
 * Everything else in the app is practice. This is the record a counter keeps
 * of the real thing: what each casino's game is, how it has treated you, when
 * a cool-off ends, and what every session won or lost. It is personal
 * financial data, so three rules follow:
 *
 *   - ONE KEY, OWN BLOB. It shares nothing with settings or stats, so the
 *     settings diff in the diagnostic log never sees it, and nothing here
 *     calls `diag()` with any of it (the one line below, an old build's
 *     write ignored, carries no data at all).
 *   - NOT IN THE STATS BACKUP. `exportAll` (persist.ts) is a training backup
 *     a user may hand to someone to debug a drill; this has its own export,
 *     made deliberately from the Casino tab (persistHardening.test.ts lists
 *     the key as excluded, with that reason).
 *   - NEVER LOSE IT SILENTLY. A blob this build cannot read is quarantined
 *     once under `<key>.corrupt` before anything can overwrite it (the same
 *     rule persist.ts follows), and the export carries those bytes along.
 *
 * The functions that change the log are pure (log in, new log out) so the
 * merge, the end-of-session burn and the rest are testable without storage;
 * `saveCasinoLog` is the one place that writes.
 *
 * WAVE K: VERSION 2. A casino deals several games (a six-deck shoe at $25, a
 * double deck at $50), so `Casino.games` replaces v1's single `game` and the
 * casino-level min/max bet, mid-shoe entry and CSM, which were always facts
 * about a game, not a building. Ruling: those v1 fields are NOT kept as
 * fallbacks -- one place for each fact -- and a v1 blob or v1 export file is
 * migrated on read: its `game` plus those four fields become `games[0]`,
 * under the id `g-<casino id>`, the same id every time, so importing the
 * same v1 file twice is still a no-op and a cached ranking result stays
 * attached to its game. Additive in v2: a casino's `driveMinutes` and saved
 * `location`, a game's label, rounds per hour and notes, and the Casino
 * settings' custom betting methods, session length and exit times.
 *
 * A NEW KEY FOR V2 (review S2). The v2 blob lives under
 * `bjtrainer.casinoLog.v2`; the v1 key is only ever READ, as a migration
 * source, and this build never writes it. A tab still running an older build
 * reads and writes only the v1 key, so it can never see a v2 blob (which it
 * would quarantine as unreadable) nor overwrite one. What such a tab writes
 * is merged in on the next load (`loadCasinoLog`): the v2 blob remembers a
 * fingerprint of the v1 bytes it has already taken in (`legacySeen`), and v1
 * bytes that differ are merged by id, the newer `updatedAt` winning, with a
 * casino coming from v1 keeping the games, drive time and spot only v2 knows
 * (`fromV1Casino`). Re-review R1: the log also remembers every casino and
 * session id it has taken in from v1 (`legacyIds`). One of those that is no
 * longer here was deleted here, so a later v1 blob that still holds it does
 * not bring it back -- nor its sessions, which went with it (a deletion here
 * wins even over a newer edit in the old tab). A record the old tab created
 * since is new to `legacyIds` and is taken in.
 *
 * WAVE W (review S2): VERSION 3, VERSIONS OF A GAME. The owner: "When I do
 * adjust the rules I want a new 'version' of the casino made so previous
 * data on it is saved for the old versions." Each game keeps its stable id
 * and gains `versions`: every set of rules it has had (`GameVersion`: the
 * rules, side bets and limits -- everything its figures depend on -- with
 * when that version began), `versionId` naming the current one. The game's
 * own fields are the current version's rules and are authoritative: the
 * current entry in `versions` is kept in step with them on every read. The
 * label, notes, pace and the house's name for the game are not versioned.
 * A session records the game and the version it was played at (`gameId`,
 * `versionId`), so its result stays with the rules it was played under.
 *
 * The v2 -> v3 migration is the same every time: a game with no versions
 * gets one, `<game id>-v1`, from the casino's creation, and a session at a
 * casino with ONE game is attached to that game's version 1 (at a casino of
 * several games a v2 session never said which it was at, so it stays the
 * casino's, unattached; its edit form can say which). Nothing is dropped.
 *
 * A NEW KEY FOR V3, as for v2: `bjtrainer.casinoLog.v3`. The v2 key is only
 * read -- left exactly as the last build before this one wrote it, so it is
 * also the backup of the log as it was. It is taken in once, as the log,
 * while there is no v3 blob yet (`prevSeen`, `prevIds` record it).
 *
 * Re-review R1 (controller ruling): ONCE V3 EXISTS, THE V2 KEY IS NEVER
 * MERGED FROM. A v2 record has no versions, so whatever a tab still on the
 * old build wrote there -- even only a notes edit -- carried its stale rules
 * with a newer stamp and undid a rule fixed here. What such a tab writes is
 * ignored, with one diagnostic line (`casino old-build-write-ignored`, no
 * data). Accepted cost: a notes edit made in a stale tab is lost; the owner
 * uses one phone. (The v1 key is still merged from: no tab two builds old
 * can be running.)
 */

export const CASINO_LOG_KEY = 'bjtrainer.casinoLog.v3';
/** Wave W: the v2 blob's key -- read as a migration source and kept as the backup, never written. */
export const PREV_CASINO_LOG_KEY = 'bjtrainer.casinoLog.v2';
/** The v1 blob's key: read as a migration source, never written. */
export const LEGACY_CASINO_LOG_KEY = 'bjtrainer.casinoLog.v1';
const CORRUPT_KEY = `${CASINO_LOG_KEY}.corrupt`;
/** Where older builds quarantined what they could not read. */
const PREV_CORRUPT_KEY = `${PREV_CASINO_LOG_KEY}.corrupt`;
const LEGACY_CORRUPT_KEY = `${LEGACY_CASINO_LOG_KEY}.corrupt`;

// ---------------------------------------------------------------- types

// Wave M: 4 and 5 added (The Gardens deals four decks from a CSM).
export type DeckCount = 1 | 2 | 4 | 5 | 6 | 8;
export const DECK_COUNTS: readonly DeckCount[] = [1, 2, 4, 5, 6, 8];

export type MidShoeEntry = 'allowed' | 'no' | 'unknown';
export type CasinoStatus = 'ok' | 'avoid' | 'burned';
export type HeatLevel = 'none' | 'attention' | 'shuffle-up' | 'flat-bet' | 'back-off' | 'trespass';
export const HEAT_LEVELS: readonly HeatLevel[] = ['none', 'attention', 'shuffle-up', 'flat-bet', 'back-off', 'trespass'];

/**
 * One game as dealt there. Every rule is optional and `null` means "not
 * known yet": a first visit often learns the decks and the payout and nothing
 * else, and an unknown must not be shown as a rule.
 */
export interface CasinoGame {
  id: string;
  /** "DD pit 3". */
  label?: string;
  decks?: DeckCount | null;
  /** true = dealer stands on soft 17, false = hits it. */
  s17?: boolean | null;
  das?: boolean | null;
  /** Late surrender offered. */
  surrender?: boolean | null;
  payout?: '3:2' | '6:5' | null;
  /**
   * Penetration as the cut card's position: decks LEFT behind it. That is
   * what you can eyeball from the table (the stack behind the cut), where a
   * percentage needs arithmetic you should not be seen doing.
   */
  cutDecksLeft?: number | null;
  minBet?: number | null;
  maxBet?: number | null;
  /** Back-counting (wonging in) depends on it. */
  midShoeEntry: MidShoeEntry;
  /** A continuous shuffler: counting is impossible. */
  csm: boolean;
  /** Rounds dealt per hour at this game; absent = DEFAULT_ROUNDS_PER_HOUR. */
  roundsPerHour?: number | null;
  notes?: string;
  /** Wave L: side bets offered at this game (additive, optional). */
  sideBets?: CasinoSideBet[];
  // ---- Wave M (lane m): the owner's real notes. All optional; null/absent = not known.
  /** Resplit aces. */
  rsa?: boolean | null;
  /** Double down on split aces. */
  doubleSplitAces?: boolean | null;
  /** Most hands one original hand can be split into. */
  maxSplitHands?: 2 | 3 | 4 | null;
  /** Which first two cards may be doubled: any two, hard 9-11, hard 10-11. */
  doubleOn?: 'any2' | '9-11' | '10-11' | null;
  /** California card rooms: dollars collected per $100 wagered, per hand. */
  commissionPer100?: number | null;
  /** Free text, e.g. "21st Century Blackjack". */
  variantName?: string;
  /** Field names the owner marked with "?": shown with a "?", value kept. */
  unsure?: string[];
  // ---- end Wave M
  /**
   * Wave L: a blackjack variant (Free Bet, Spanish 21, Switch). Absent =
   * standard blackjack. The simulator models standard blackjack only, so a
   * variant game gets its flat house edge from the variant charts instead.
   */
  variant?: PresetId;
  /**
   * C9 (audit 2026-10-29): a card-room house game -- jokers in the deck,
   * "Natural 22", a player bust that is not an instant loss -- logged as
   * standard blackjack. The simulator deals standard blackjack only, so the
   * game is not modelled (see isHouseGame). Absent = not marked.
   * C9 follow-up: `false` is the owner's untick, which outranks a house
   * name and stops an import ticking it again.
   */
  houseGame?: boolean;
  /**
   * C9 follow-up: House game was ticked by an import or a paste, from the
   * game's own text (see detectHouseGame), not by the owner. The editor says
   * so until the box is touched. Only ever beside `houseGame: true`.
   */
  houseGameDetected?: true;
  /**
   * Wave W (review S2): the current version's id. Always set on a game read
   * from the log (`normGame`); a game being built may leave it to the save.
   */
  versionId?: string;
  /** Every version this game has had, oldest first, the current one included. */
  versions?: GameVersion[];
}

/**
 * Wave W (review S2): the fields a version of a game holds -- everything
 * its figures depend on. The label, notes, rounds per hour (a table's pace,
 * not a house rule) and the house's name for the game are the game's own.
 * `unsure` rides along with the rules it marks, but never makes a version
 * (`sameRules`).
 */
export const VERSIONED_FIELDS = [
  'decks', 's17', 'das', 'surrender', 'payout', 'cutDecksLeft', 'minBet', 'maxBet', 'midShoeEntry', 'csm',
  'rsa', 'doubleSplitAces', 'maxSplitHands', 'doubleOn', 'commissionPer100', 'variant', 'sideBets', 'unsure',
] as const;
export type VersionedField = (typeof VERSIONED_FIELDS)[number];
export type VersionRules = Pick<CasinoGame, VersionedField>;

export interface GameVersion {
  versionId: string;
  /** When these rules began. */
  createdAt: string;
  /** When they were last changed in place ("Fix this version"): decides a merge of two copies. */
  updatedAt: string;
  rules: VersionRules;
}

/** Rounds an hour when a game does not say: a typical shoe game with a few players. */
export const DEFAULT_ROUNDS_PER_HOUR = 80;

/** The game's rules as the summary and the simulator read them. */
export type GameRules = Pick<CasinoGame, 'decks' | 's17' | 'das' | 'surrender' | 'payout' | 'cutDecksLeft'> &
  Partial<Pick<CasinoGame, WaveMGameField | 'unsure'>>;

/** Wave M: the game fields added for the owner's notes (see CasinoGame). */
export type WaveMGameField = 'rsa' | 'doubleSplitAces' | 'maxSplitHands' | 'doubleOn' | 'commissionPer100' | 'variantName';

/** Every field name `unsure` may hold. */
export const UNSURE_FIELDS = [
  'decks', 's17', 'das', 'surrender', 'payout', 'cutDecksLeft', 'minBet', 'maxBet', 'midShoeEntry', 'csm',
  'rsa', 'doubleSplitAces', 'maxSplitHands', 'doubleOn', 'commissionPer100',
] as const;

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Casino {
  id: string;
  name: string;
  area?: string;
  /** At least one. */
  games: CasinoGame[];
  /** One way, from home, in minutes. */
  driveMinutes?: number | null;
  /** Saved with "Save this spot" while standing there; never captured otherwise. */
  location?: GeoPoint | null;
  // ---- Wave M (lane m)
  /** A California card room (player-banked, commission) or a casino; absent = casino. */
  kind?: 'casino' | 'cardroom';
  /** One way from home, in miles. */
  miles?: number | null;
  // ---- end Wave M
  status: CasinoStatus;
  /** Local date (YYYY-MM-DD) the cool-off ends; null = indefinitely. Only read when burned. */
  burnedUntil?: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CasinoSession {
  id: string;
  casinoId: string;
  /**
   * Wave W (review S2): the game played and its version then. Absent on a
   * session at a casino of several games from before versions (it never
   * said which), or one that says "several".
   */
  gameId?: string;
  versionId?: string;
  /** ISO timestamp. */
  start: string;
  /** ISO timestamp, or null while the session is running. */
  end: string | null;
  /** One entry per buy-in; a rebuy adds an entry. */
  buyIns: number[];
  cashOut: number | null;
  avgBet?: number | null;
  maxBet?: number | null;
  /** Highest true count seen, a whole number. */
  maxTc?: number | null;
  /** Which tables / dealers. */
  tables?: string;
  heat: HeatLevel;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CasinoLogSettings {
  startingBankroll: number | null;
  updatedAt: string | null;
  /** Wave K: betting methods the user added to the default set. */
  methods?: BetMethod[];
  /** Wave K: hours a casino visit lasts, for EV per trip hour; absent = DEFAULT_SESSION_HOURS. */
  sessionHours?: number | null;
  /**
   * Wave K (review B1): minutes a wong-out or back-count exit costs where
   * mid-shoe entry is allowed or unknown -- finding another table. Absent =
   * DEFAULT_EXIT_FIND_MINUTES; 0 = free.
   */
  exitFindMinutes?: number | null;
  /** Minutes an exit costs where mid-shoe entry is barred: waiting for a fresh shoe. Absent = DEFAULT_EXIT_WAIT_MINUTES. */
  exitWaitMinutes?: number | null;
}

export const DEFAULT_SESSION_HOURS = 4;
export const DEFAULT_EXIT_FIND_MINUTES = 5;
export const DEFAULT_EXIT_WAIT_MINUTES = 15;
export const EXIT_MINUTES_MAX = 120;

export interface CasinoLog {
  version: 3;
  casinos: Casino[];
  sessions: CasinoSession[];
  settings: CasinoLogSettings;
  /** When the log was last exported to a file (ISO), for the backup nudge. */
  lastExportAt: string | null;
  /**
   * A fingerprint of the v1 blob (LEGACY_CASINO_LOG_KEY) this log has already
   * merged in; v1 bytes that no longer match were written by an older build
   * since. Storage bookkeeping: never exported.
   */
  legacySeen?: string;
  /**
   * Re-review R1: the casino and session ids taken in from v1 so far. Storage
   * bookkeeping, never exported.
   */
  legacyIds?: LegacyIds;
  /** Wave W: the same pair for the v2 blob (PREV_CASINO_LOG_KEY). Storage bookkeeping, never exported. */
  prevSeen?: string;
  prevIds?: LegacyIds;
  /**
   * Re-review R5: casinos deleted in the app. An import of a file that
   * still holds one does not bring it back unless asked. Storage
   * bookkeeping, never exported.
   */
  deletedCasinos?: DeletedCasino[];
  /**
   * B15: sessions deleted in the app, remembered the same way, so an Import
   * or Paste of an older file does not quietly put a deleted session (and
   * its money) back. Storage bookkeeping, never exported.
   */
  deletedSessions?: DeletedSession[];
}

/** B15: a session deleted here, remembered; `label` says which, for the import preview. */
export interface DeletedSession {
  id: string;
  label: string;
  /** ISO. */
  at: string;
}

/** Re-review R5: a casino deleted here, remembered. */
export interface DeletedCasino {
  id: string;
  name: string;
  /** ISO. */
  at: string;
}

export interface LegacyIds {
  casinos: string[];
  sessions: string[];
}

const idList = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);

export function emptyCasinoLog(): CasinoLog {
  return {
    version: 3,
    casinos: [],
    sessions: [],
    settings: { startingBankroll: null, updatedAt: null },
    lastExportAt: null,
  };
}

// ---------------------------------------------------------------- storage

type MinimalStore = Pick<Storage, 'getItem' | 'setItem'> & { removeItem?: (k: string) => void };

let injected: MinimalStore | null = null;
const fallbackMap = new Map<string, string>();
const fallback: MinimalStore = {
  getItem: (k) => fallbackMap.get(k) ?? null,
  setItem: (k, v) => {
    fallbackMap.set(k, v);
  },
  removeItem: (k) => {
    fallbackMap.delete(k);
  },
};

/** Tests only: inject a store (null restores the default). */
export function _setCasinoStorage(s: MinimalStore | null): void {
  injected = s;
}

function store(): MinimalStore {
  if (injected) return injected;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    /* a sandboxed frame can throw on the getter itself */
  }
  return fallback;
}

// ---------------------------------------------------------------- normalising

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const EPOCH = '1970-01-01T00:00:00.000Z';

/**
 * An ISO timestamp, or null. The shape is required, not just parseability:
 * V8's Date.parse reads "1" as the year 2001 and "March 3" as a date, so a
 * malformed import would otherwise land a nonsense start.
 */
const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
function iso(x: unknown): string | null {
  if (typeof x !== 'string' || !ISO_SHAPE.test(x)) return null;
  return Number.isFinite(Date.parse(x)) ? x : null;
}

/** A money amount: finite and not negative. */
function money(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
}

function boolOrNull(x: unknown): boolean | null {
  return typeof x === 'boolean' ? x : null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function normRules(g: Record<string, unknown>): Required<Pick<GameRules, 'decks' | 's17' | 'das' | 'surrender' | 'payout' | 'cutDecksLeft'>> {
  const decks = DECK_COUNTS.includes(g.decks as DeckCount) ? (g.decks as DeckCount) : null;
  const payout = g.payout === '3:2' || g.payout === '6:5' ? g.payout : null;
  const cut = typeof g.cutDecksLeft === 'number' && Number.isFinite(g.cutDecksLeft) && g.cutDecksLeft >= 0 ? g.cutDecksLeft : null;
  return {
    decks,
    s17: boolOrNull(g.s17),
    das: boolOrNull(g.das),
    surrender: boolOrNull(g.surrender),
    payout,
    cutDecksLeft: cut,
  };
}

/** A positive count in a sane range, or null. */
function boundedOrNull(x: unknown, lo: number, hi: number): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : null;
}

const NOTES_MAX = 20_000;
const notesOf = (x: unknown) => (typeof x === 'string' ? x.slice(0, NOTES_MAX) : '');

/**
 * A stored or imported game, repaired. `legacy` carries a v1 casino's
 * casino-level fields, which a v1 game sat beside; `fallbackId` names a
 * game that arrived without one. Wave W: its versions too (`normVersions`);
 * `since` is when a game from before versions began, its version 1.
 */
export function normGame(x: unknown, fallbackId: string, legacy?: Record<string, unknown>, since?: { createdAt: string; updatedAt: string }): CasinoGame {
  const game = normGameRules(x, fallbackId, legacy);
  return normVersions(isObj(x) ? x : {}, game, since ?? { createdAt: EPOCH, updatedAt: EPOCH });
}

/** A game's own fields, repaired: everything but its versions. */
function normGameRules(x: unknown, fallbackId: string, legacy?: Record<string, unknown>): CasinoGame {
  const g = isObj(x) ? x : {};
  const src = legacy ?? g;
  const game: CasinoGame = {
    id: typeof g.id === 'string' && g.id !== '' ? g.id : fallbackId,
    ...normRules(g),
    minBet: money(src.minBet),
    maxBet: money(src.maxBet),
    midShoeEntry: src.midShoeEntry === 'allowed' || src.midShoeEntry === 'no' ? src.midShoeEntry : 'unknown',
    csm: src.csm === true,
    roundsPerHour: boundedOrNull(g.roundsPerHour, 1, 1000),
  };
  if (typeof g.label === 'string' && g.label.trim() !== '') game.label = g.label.trim().slice(0, 60);
  const notes = notesOf(g.notes);
  if (notes !== '') game.notes = notes;
  const sideBets = normSideBets(g.sideBets);
  if (sideBets.length > 0) game.sideBets = sideBets;
  Object.assign(game, normWaveMGame(g));
  if (isPresetId(g.variant)) game.variant = g.variant;
  if (typeof g.houseGame === 'boolean') game.houseGame = g.houseGame;
  if (g.houseGame === true && g.houseGameDetected === true) game.houseGameDetected = true;
  return game;
}

/**
 * C9: house names of California card-room games whose rules are not
 * blackjack's (the state's filed rule sheets for these games). A name is
 * only a label, so only these, not every variantName, mark a game.
 */
const HOUSE_GAME_NAME = /21st\s*century|natural\s*22|no[\s-]*bust/i;

/** C9: a game the simulator cannot deal -- marked a house game, or named as one. */
export function isHouseGame(game: Pick<CasinoGame, 'houseGame' | 'variantName'>): boolean {
  if (game.houseGame !== undefined) return game.houseGame;
  return game.variantName !== undefined && HOUSE_GAME_NAME.test(game.variantName);
}

/**
 * C9 follow-up: the words in a game's own text -- its label, house name or
 * notes -- that mark a house game: jokers in the deck, "Natural 22", a
 * no-bust rule, the 21st Century house name, or the game called a card-room
 * game. A casino logged as a card room is not one by itself: Wave M deals
 * card-room commission games as blackjack.
 */
const HOUSE_GAME_SIGNS = /joker|natural\s*22|no[\s-]*bust|21st\s*century|card\s*-?room/i;

/** C9 follow-up: does this game's own text say it is a house game? */
export function detectHouseGame(game: Pick<CasinoGame, 'label' | 'variantName' | 'notes'>): boolean {
  return [game.label, game.variantName, game.notes].some((t) => t !== undefined && HOUSE_GAME_SIGNS.test(t));
}

/**
 * C9 follow-up: tick House game on each game the file brought whose box was
 * never set either way, when its text says so (detectHouseGame). A box set
 * here (an untick is `false`) is the owner's word: a newer file that never
 * set it does not undo it, and nothing is detected over it.
 */
function tickHouseGames(log: CasinoLog, local: CasinoLog, fileGames: ReadonlySet<string>): { log: CasinoLog; detected: HouseGameDetection[] } {
  const here = new Map<string, CasinoGame>();
  for (const c of local.casinos) for (const g of c.games) if (g.houseGame !== undefined) here.set(g.id, g);
  const detected: HouseGameDetection[] = [];
  let any = false;
  const casinos = log.casinos.map((c) => {
    let changed = false;
    const games = c.games.map((g) => {
      if (!fileGames.has(g.id) || g.houseGame !== undefined) return g;
      const set = here.get(g.id);
      if (set !== undefined) {
        changed = true;
        return set.houseGameDetected === true ? { ...g, houseGame: set.houseGame, houseGameDetected: true as const } : { ...g, houseGame: set.houseGame };
      }
      if (!detectHouseGame(g)) return g;
      changed = true;
      detected.push({ casinoId: c.id, casino: c.name, gameId: g.id, label: g.label ?? g.variantName ?? null });
      return { ...g, houseGame: true, houseGameDetected: true as const };
    });
    any ||= changed;
    return changed ? { ...c, games } : c;
  });
  return { log: any ? { ...log, casinos } : log, detected };
}

// ---------------------------------------------------------------- versions (Wave W, review S2)

/** A game's versioned fields, as stored (a field the game leaves unknown is left out where the game leaves it out). */
export function rulesOf(g: CasinoGame): VersionRules {
  const out: Record<string, unknown> = {};
  for (const f of VERSIONED_FIELDS) if (g[f] !== undefined) out[f] = g[f];
  return out as unknown as VersionRules;
}

/** The game with a version's rules in place of its own (a field the version does not have is cleared). */
export function withRules(g: CasinoGame, rules: VersionRules): CasinoGame {
  const next: Record<string, unknown> = { ...g };
  for (const f of VERSIONED_FIELDS) {
    if (rules[f] === undefined) delete next[f];
    else next[f] = rules[f];
  }
  return next as unknown as CasinoGame;
}

/** The rules as one comparable text: every versioned field but `unsure`, an unknown read as null. */
function rulesText(r: VersionRules | CasinoGame): string {
  return JSON.stringify(VERSIONED_FIELDS.filter((f) => f !== 'unsure').map((f) => r[f] ?? null));
}

/** Whether two sets of rules would deal the same game (a "?" mark aside). */
export function sameRules(a: VersionRules | CasinoGame, b: VersionRules | CasinoGame): boolean {
  return rulesText(a) === rulesText(b);
}

const byCreated = (a: GameVersion, b: GameVersion) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : 0);

/**
 * A game's versions, repaired: each entry's rules normalised as a game's
 * are, duplicates dropped, oldest first. The current one (`versionId`) is
 * the game's own fields -- those are authoritative -- and a game with none
 * gets its version 1, `<game id>-v1`, from `since`.
 */
function normVersions(raw: Record<string, unknown>, game: CasinoGame, since: { createdAt: string; updatedAt: string }): CasinoGame {
  const list: GameVersion[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.versions)) {
    for (const v of raw.versions) {
      if (!isObj(v) || typeof v.versionId !== 'string' || v.versionId === '' || seen.has(v.versionId)) continue;
      seen.add(v.versionId);
      const createdAt = iso(v.createdAt) ?? since.createdAt;
      list.push({
        versionId: v.versionId,
        createdAt,
        updatedAt: iso(v.updatedAt) ?? createdAt,
        rules: rulesOf(normGameRules({ ...(isObj(v.rules) ? v.rules : {}), id: game.id }, game.id)),
      });
    }
  }
  list.sort(byCreated);
  const named = typeof raw.versionId === 'string' && raw.versionId !== '' ? raw.versionId : null;
  const versionId = named ?? list[list.length - 1]?.versionId ?? `${game.id}-v1`;
  const rules = rulesOf(game);
  const cur = list.find((v) => v.versionId === versionId);
  if (cur) cur.rules = rules;
  else {
    list.push({ versionId, createdAt: since.createdAt, updatedAt: since.updatedAt, rules });
    list.sort(byCreated);
  }
  return { ...game, versionId, versions: list };
}

/** A game's versions; one built in memory and never read back has its version 1 only. */
export function versionsOf(g: CasinoGame): GameVersion[] {
  if (g.versions && g.versions.length > 0) return g.versions;
  return [{ versionId: g.versionId ?? `${g.id}-v1`, createdAt: EPOCH, updatedAt: EPOCH, rules: rulesOf(g) }];
}

/** A game's current version id. */
export const currentVersionId = (g: CasinoGame): string => g.versionId ?? `${g.id}-v1`;

/** The versions before the current one, newest first. */
export function earlierVersions(g: CasinoGame): GameVersion[] {
  const cur = currentVersionId(g);
  return versionsOf(g)
    .filter((v) => v.versionId !== cur)
    .sort((a, b) => byCreated(b, a));
}

/** An earlier version as a game: its rules on the game's own label, pace and notes, under the version's id. */
export function gameAtVersion(g: CasinoGame, v: GameVersion): CasinoGame {
  return { ...withRules(g, v.rules), id: v.versionId, versionId: v.versionId, versions: [v] };
}

/** The version of a game that was current at a moment: the newest begun by then (else the oldest). */
export function versionAt(g: CasinoGame, at: string): GameVersion {
  const list = versionsOf(g);
  const t = Date.parse(at);
  let best = list[0]!;
  for (const v of list) if (Date.parse(v.createdAt) <= t) best = v;
  return best;
}

/**
 * How a save treats a game whose rules changed: `new` -- the casino changed
 * them, so the old rules are kept as an earlier version with their sessions
 * and figures; `fix` -- they were entered wrong, so the current version is
 * corrected in place. The form asks only for a version with sessions or
 * figures; one with neither is corrected in place.
 */
export type VersionChoice = 'new' | 'fix';

/** A saved game, its versions brought up to the save (see `VersionChoice`). */
function versioned(prev: CasinoGame | undefined, g: CasinoGame, choice: VersionChoice | undefined, at: string): CasinoGame {
  if (!prev) {
    // A new game: its version 1 begins now.
    const versionId = currentVersionId(g);
    return { ...g, versionId, versions: [{ versionId, createdAt: at, updatedAt: at, rules: rulesOf(g) }] };
  }
  const base = versionsOf(prev);
  const curId = currentVersionId(prev);
  const rules = rulesOf(g);
  if (!sameRules(prev, g) && choice === 'new') {
    const versionId = makeCasinoId('v');
    return { ...g, versionId, versions: [...base, { versionId, createdAt: at, updatedAt: at, rules }] };
  }
  const changed = JSON.stringify(rulesOf(prev)) !== JSON.stringify(rules);
  const versions = base.map((v) => (v.versionId === curId ? { ...v, rules, updatedAt: changed ? at : v.updatedAt } : v));
  return { ...g, versionId: curId, versions };
}

/**
 * Two copies of one game merged: every version either holds, by id, the one
 * changed last winning; the newest version is current, and the game's rules
 * are its. Nothing is replaced wholesale and no version is dropped.
 */
function mergeGameVersions(g: CasinoGame, other: CasinoGame | undefined): CasinoGame {
  if (!other) return g;
  const byId = new Map(versionsOf(g).map((v) => [v.versionId, v]));
  for (const v of versionsOf(other)) {
    const cur = byId.get(v.versionId);
    if (!cur || Date.parse(v.updatedAt) > Date.parse(cur.updatedAt)) byId.set(v.versionId, v);
  }
  const versions = [...byId.values()].sort(byCreated);
  const current = versions[versions.length - 1]!;
  return { ...withRules(g, current.rules), versionId: current.versionId, versions };
}

/**
 * Wave M: the added game fields, repaired. Written only when known, so a game
 * saved before them reads back exactly as it was.
 */
function normWaveMGame(g: Record<string, unknown>): Partial<CasinoGame> {
  const out: Partial<CasinoGame> = {};
  if (typeof g.rsa === 'boolean') out.rsa = g.rsa;
  if (typeof g.doubleSplitAces === 'boolean') out.doubleSplitAces = g.doubleSplitAces;
  if (g.maxSplitHands === 2 || g.maxSplitHands === 3 || g.maxSplitHands === 4) out.maxSplitHands = g.maxSplitHands;
  if (g.doubleOn === 'any2' || g.doubleOn === '9-11' || g.doubleOn === '10-11') out.doubleOn = g.doubleOn;
  const fee = boundedOrNull(g.commissionPer100, 0, 25);
  if (fee !== null) out.commissionPer100 = fee;
  if (typeof g.variantName === 'string' && g.variantName.trim() !== '') out.variantName = g.variantName.trim().slice(0, 60);
  if (Array.isArray(g.unsure)) {
    const known = new Set<string>(UNSURE_FIELDS);
    const list = [...new Set(g.unsure.filter((f): f is string => typeof f === 'string' && known.has(f)))];
    if (list.length > 0) out.unsure = list;
  }
  return out;
}

/** A game with nothing known: every rule "?". */
export function blankGame(id: string = makeCasinoId('g')): CasinoGame {
  return {
    id,
    decks: null,
    s17: null,
    das: null,
    surrender: null,
    payout: null,
    cutDecksLeft: null,
    minBet: null,
    maxBet: null,
    midShoeEntry: 'unknown',
    csm: false,
    roundsPerHour: null,
  };
}

function normGames(x: Record<string, unknown>, casinoId: string, since: { createdAt: string; updatedAt: string }): CasinoGame[] {
  // v1: one `game`, with the betting facts on the casino beside it.
  if (!Array.isArray(x.games)) return [normGame(x.game, `g-${casinoId}`, { ...(isObj(x.game) ? x.game : {}), ...x }, since)];
  const seen = new Set<string>();
  const games: CasinoGame[] = [];
  x.games.forEach((raw, i) => {
    const g = normGame(raw, `g-${casinoId}-${i}`, undefined, since);
    if (seen.has(g.id)) return;
    seen.add(g.id);
    games.push(g);
  });
  return games.length > 0 ? games : [normGame(blankGame(`g-${casinoId}`), `g-${casinoId}`, undefined, since)];
}

function normPoint(x: unknown): GeoPoint | null {
  if (!isObj(x)) return null;
  const lat = boundedOrNull(x.lat, -90, 90);
  const lon = boundedOrNull(x.lon, -180, 180);
  return lat === null || lon === null ? null : { lat, lon };
}

/** A stored or imported casino, repaired field by field; null when it has no id or name. */
export function normCasino(x: unknown): Casino | null {
  if (!isObj(x)) return null;
  const id = typeof x.id === 'string' && x.id !== '' ? x.id : null;
  const name = typeof x.name === 'string' ? x.name.trim() : '';
  if (!id || !name) return null;
  const status: CasinoStatus = x.status === 'avoid' || x.status === 'burned' ? x.status : 'ok';
  const createdAt = iso(x.createdAt) ?? EPOCH;
  const updatedAt = iso(x.updatedAt) ?? createdAt;
  return {
    id,
    name,
    area: typeof x.area === 'string' && x.area.trim() !== '' ? x.area.trim() : undefined,
    games: normGames(x, id, { createdAt, updatedAt }),
    driveMinutes: boundedOrNull(x.driveMinutes, 0, 24 * 60),
    location: normPoint(x.location),
    ...normWaveMCasino(x),
    status,
    burnedUntil: typeof x.burnedUntil === 'string' && DATE_ONLY.test(x.burnedUntil) ? x.burnedUntil : null,
    notes: notesOf(x.notes),
    createdAt,
    updatedAt,
  };
}

/** Wave M: a casino's kind and miles, written only when set. */
function normWaveMCasino(x: Record<string, unknown>): Pick<Casino, 'kind' | 'miles'> {
  const out: Pick<Casino, 'kind' | 'miles'> = {};
  if (x.kind === 'casino' || x.kind === 'cardroom') out.kind = x.kind;
  const miles = boundedOrNull(x.miles, 0, 5000);
  if (miles !== null) out.miles = miles;
  return out;
}

/** A stored or imported session, repaired; null without an id, a casino or a start time. */
export function normSession(x: unknown): CasinoSession | null {
  if (!isObj(x)) return null;
  const id = typeof x.id === 'string' && x.id !== '' ? x.id : null;
  const casinoId = typeof x.casinoId === 'string' && x.casinoId !== '' ? x.casinoId : null;
  const start = iso(x.start);
  if (!id || !casinoId || !start) return null;
  const end = iso(x.end);
  const buyIns = Array.isArray(x.buyIns) ? x.buyIns.filter((b): b is number => money(b) !== null && (b as number) > 0) : [];
  const maxTc = typeof x.maxTc === 'number' && Number.isFinite(x.maxTc) ? Math.round(x.maxTc) : null;
  const createdAt = iso(x.createdAt) ?? start;
  const played: Pick<CasinoSession, 'gameId' | 'versionId'> = {};
  if (typeof x.gameId === 'string' && x.gameId !== '') {
    played.gameId = x.gameId;
    if (typeof x.versionId === 'string' && x.versionId !== '') played.versionId = x.versionId;
  }
  return {
    id,
    casinoId,
    ...played,
    start,
    // An end before the start is a typo, not a negative session.
    end: end && Date.parse(end) >= Date.parse(start) ? end : end ? start : null,
    buyIns,
    cashOut: money(x.cashOut),
    avgBet: money(x.avgBet),
    maxBet: money(x.maxBet),
    maxTc,
    tables: typeof x.tables === 'string' && x.tables.trim() !== '' ? x.tables : undefined,
    heat: HEAT_LEVELS.includes(x.heat as HeatLevel) ? (x.heat as HeatLevel) : 'none',
    notes: typeof x.notes === 'string' ? x.notes : '',
    createdAt,
    updatedAt: iso(x.updatedAt) ?? createdAt,
  };
}

function normList<T extends { id: string }>(x: unknown, norm: (v: unknown) => T | null): { items: T[]; skipped: number } {
  if (!Array.isArray(x)) return { items: [], skipped: 0 };
  const seen = new Set<string>();
  const items: T[] = [];
  let skipped = 0;
  for (const raw of x) {
    const v = norm(raw);
    if (!v || seen.has(v.id)) {
      skipped += 1;
      continue;
    }
    seen.add(v.id);
    items.push(v);
  }
  return { items, skipped };
}

function normSettings(x: unknown): CasinoLogSettings {
  const s = isObj(x) ? x : {};
  const out: CasinoLogSettings = { startingBankroll: money(s.startingBankroll), updatedAt: iso(s.updatedAt) };
  // Additive (v2): written only when set, so a v1 blob's settings read back exactly.
  if (Array.isArray(s.methods)) {
    const seen = new Set<string>();
    out.methods = s.methods.map(normMethod).filter((m): m is BetMethod => m !== null && !seen.has(m.id) && (seen.add(m.id), true));
  }
  const hours = boundedOrNull(s.sessionHours, 0.25, 24);
  if (hours !== null) out.sessionHours = hours;
  const find = boundedOrNull(s.exitFindMinutes, 0, EXIT_MINUTES_MAX);
  if (find !== null) out.exitFindMinutes = find;
  const wait = boundedOrNull(s.exitWaitMinutes, 0, EXIT_MINUTES_MAX);
  if (wait !== null) out.exitWaitMinutes = wait;
  return out;
}

/**
 * Bring any blob this build understands up to the current shape.
 *
 * Version 1 moves each casino's single game into `games` (see the header);
 * versions 1 and 2 give each game its version 1 and attach each session at a
 * casino of one game to it (Wave W); every version is also repaired: a
 * partial or hand-edited blob gets every missing field filled and every bad
 * entry dropped. A blob with no version but the two lists is read as v1 (an
 * export edited by hand loses the wrapper first). Anything else -- a newer
 * version this build does not know -- is refused, so it is quarantined
 * rather than flattened into this build's idea of it.
 */
export function migrateCasinoLog(parsed: unknown): { log: CasinoLog; skipped: number } | null {
  if (!isObj(parsed)) return null;
  const v = parsed.version;
  const readable = v === 1 || v === 2 || v === 3 || (v === undefined && (Array.isArray(parsed.casinos) || Array.isArray(parsed.sessions)));
  if (!readable) return null;
  const casinos = normList(parsed.casinos, normCasino);
  const sessions = normList(parsed.sessions, normSession);
  const log: CasinoLog = {
    version: 3,
    casinos: casinos.items,
    sessions: v === 3 ? sessions.items : attachToVersionOne(casinos.items, sessions.items),
    settings: normSettings(parsed.settings),
    lastExportAt: iso(parsed.lastExportAt),
  };
  const ids = (x: Record<string, unknown>): LegacyIds => ({ casinos: idList(x.casinos), sessions: idList(x.sessions) });
  if ((v === 2 || v === 3) && typeof parsed.legacySeen === 'string') log.legacySeen = parsed.legacySeen;
  if ((v === 2 || v === 3) && isObj(parsed.legacyIds)) log.legacyIds = ids(parsed.legacyIds);
  if (v === 3 && typeof parsed.prevSeen === 'string') log.prevSeen = parsed.prevSeen;
  if (v === 3 && isObj(parsed.prevIds)) log.prevIds = ids(parsed.prevIds);
  if (v === 3 && Array.isArray(parsed.deletedCasinos)) {
    const gone = parsed.deletedCasinos.flatMap((d): DeletedCasino[] =>
      isObj(d) && typeof d.id === 'string' && d.id !== '' ? [{ id: d.id, name: typeof d.name === 'string' ? d.name : '', at: iso(d.at) ?? EPOCH }] : [],
    );
    if (gone.length > 0) log.deletedCasinos = gone;
  }
  if (v === 3 && Array.isArray(parsed.deletedSessions)) {
    const gone = parsed.deletedSessions.flatMap((d): DeletedSession[] =>
      isObj(d) && typeof d.id === 'string' && d.id !== '' ? [{ id: d.id, label: typeof d.label === 'string' ? d.label : '', at: iso(d.at) ?? EPOCH }] : [],
    );
    if (gone.length > 0) log.deletedSessions = gone;
  }
  return { log, skipped: casinos.skipped + sessions.skipped };
}

/**
 * Wave W: a session from before versions, at a casino with one game, was
 * played at that game as it was then -- its version 1. At a casino of
 * several it never said which, so it stays the casino's.
 */
function attachToVersionOne(casinos: readonly Casino[], sessions: CasinoSession[]): CasinoSession[] {
  const only = new Map(casinos.filter((c) => c.games.length === 1).map((c) => [c.id, c.games[0]!]));
  return sessions.map((s) => {
    const g = only.get(s.casinoId);
    if (!g || s.gameId !== undefined) return s;
    return { ...s, gameId: g.id, versionId: versionsOf(g)[0]!.versionId };
  });
}

/** FNV-1a over the text, plus its length: tells one stored v1 blob from another. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}:${text.length.toString(36)}`;
}

function quarantine(raw: string): void {
  try {
    const s = store();
    if (s.getItem(CORRUPT_KEY) !== null) return;
    s.setItem(CORRUPT_KEY, raw);
  } catch {
    /* full storage is when this matters most and works least; never fail the load */
  }
}

/**
 * Keep bytes an imported file carried as unreadable, unless this device
 * already holds its own (the copy closest to the original wins, as on load).
 */
export function keepUnreadable(raw: string): void {
  quarantine(raw);
}

/** The bytes a previous load could not read, if any were kept (this build's, else an older build's). */
export function quarantinedCasinoLog(): string | null {
  try {
    const s = store();
    return s.getItem(CORRUPT_KEY) ?? s.getItem(PREV_CORRUPT_KEY) ?? s.getItem(LEGACY_CORRUPT_KEY);
  } catch {
    return null;
  }
}

function readBlob(raw: string): CasinoLog | null {
  try {
    return migrateCasinoLog(JSON.parse(raw) as unknown)?.log ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the log. Never throws: absent reads as empty, unreadable is
 * quarantined and reads as empty, partial is repaired. A v2 or v1 blob an
 * older build wrote since this log last took it in is merged in (see the
 * header) -- the v2 one first, as the log itself when there is no v3 blob
 * yet; the result carries their fingerprints, and the next save records
 * them. Load itself never writes the log.
 */
export function loadCasinoLog(): CasinoLog {
  let raw: string | null;
  let prev: string | null;
  let legacy: string | null;
  try {
    raw = store().getItem(CASINO_LOG_KEY);
    prev = store().getItem(PREV_CASINO_LOG_KEY);
    legacy = store().getItem(LEGACY_CASINO_LOG_KEY);
  } catch {
    return emptyCasinoLog();
  }
  let log: CasinoLog | null = null;
  if (raw) {
    log = readBlob(raw);
    if (!log) quarantine(raw);
  }
  if (prev) {
    if (!log) log = takeIn(null, prev, PREV_SOURCE);
    else if (log.prevSeen !== fingerprint(prev)) oldBuildWriteIgnored(prev);
  }
  if (legacy) log = takeIn(log, legacy, LEGACY_SOURCE);
  return log ?? emptyCasinoLog();
}

/** Each ignored v2 write is logged once a page, however often the log is read. */
const ignoredPrev = new Set<string>();
function oldBuildWriteIgnored(prev: string): void {
  const f = fingerprint(prev);
  if (ignoredPrev.has(f)) return;
  ignoredPrev.add(f);
  diag('set', 'casino old-build-write-ignored');
}

/** An older build's key this build reads: where this log keeps what it has taken in from it. */
interface OlderSource {
  seen: 'legacySeen' | 'prevSeen';
  ids: 'legacyIds' | 'prevIds';
  /** A v1 blob's casinos know one game (`fromV1Casino`). */
  fromV1: boolean;
}
const LEGACY_SOURCE: OlderSource = { seen: 'legacySeen', ids: 'legacyIds', fromV1: true };
const PREV_SOURCE: OlderSource = { seen: 'prevSeen', ids: 'prevIds', fromV1: false };

/**
 * What an older build wrote under its own key, merged into the log unless
 * the log has taken in these very bytes already. Re-review R1: a casino or
 * session taken in from there before and gone now was deleted here, and
 * stays deleted.
 */
function takeIn(log: CasinoLog | null, text: string, src: OlderSource): CasinoLog {
  const seen = fingerprint(text);
  if (log && log[src.seen] === seen) {
    if (log[src.ids]) return log;
    // Saved by a build before R1: the blob it took in is still this one.
    const taken = readBlob(text);
    return taken ? { ...log, [src.ids]: idsOf(taken) } : log;
  }
  const old = readBlob(text);
  if (!old) {
    quarantine(text);
    return { ...(log ?? emptyCasinoLog()), [src.seen]: seen };
  }
  if (!log) return { ...old, [src.seen]: seen, [src.ids]: idsOf(old) };
  const before = log[src.ids] ?? { casinos: [], sessions: [] };
  const deletedCasinos = new Set(before.casinos.filter((id) => !log.casinos.some((c) => c.id === id)));
  const deletedSessions = new Set(before.sessions.filter((id) => !log.sessions.some((x) => x.id === id)));
  const fresh: CasinoLog = {
    ...old,
    casinos: old.casinos.filter((c) => !deletedCasinos.has(c.id)),
    sessions: old.sessions.filter((x) => !deletedSessions.has(x.id) && !deletedCasinos.has(x.casinoId)),
  };
  const ids = idsOf(old);
  return {
    ...mergeLogs(log, fresh, src.fromV1).log,
    [src.seen]: seen,
    [src.ids]: { casinos: union(before.casinos, ids.casinos), sessions: union(before.sessions, ids.sessions) },
  };
}

function idsOf(log: CasinoLog): LegacyIds {
  return { casinos: log.casinos.map((c) => c.id), sessions: log.sessions.map((x) => x.id) };
}

function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])];
}

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Write the log. Returns false (and tells the shell's storage toast) when the
 * write could not land even after shrinking the diagnostic log -- the same
 * order persist.ts's `writeKey` uses.
 */
export function saveCasinoLog(log: CasinoLog): boolean {
  const s = store();
  const json = JSON.stringify(log);
  let ok = false;
  try {
    s.setItem(CASINO_LOG_KEY, json);
    ok = true;
  } catch {
    if (shrinkDiagnostics(s as Parameters<typeof shrinkDiagnostics>[0])) {
      try {
        s.setItem(CASINO_LOG_KEY, json);
        ok = true;
      } catch {
        /* reported below */
      }
    }
    if (!ok) reportStorageFailure(CASINO_LOG_KEY);
  }
  if (ok) for (const fn of [...listeners]) fn();
  return ok;
}

/**
 * Called when the log changes in THIS tab (a save) or in another one (the
 * storage event), so the tab bar's live dot and the screen stay current.
 */
export function subscribeCasinoLog(fn: Listener): () => void {
  listeners.add(fn);
  // The older keys too: a tab still on an older build writes only its own.
  const offExternal = subscribeToExternalWrites([CASINO_LOG_KEY, PREV_CASINO_LOG_KEY, LEGACY_CASINO_LOG_KEY], () => fn());
  return () => {
    listeners.delete(fn);
    offExternal();
  };
}

// ---------------------------------------------------------------- ids and time

export function makeCasinoId(prefix: 'c' | 's' | 'g' | 'm' | 'v'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const stamp = (now: number) => new Date(now).toISOString();

// ---------------------------------------------------------------- queries

/** The session on the clock now: the latest-started one with no end. */
export function runningSession(log: CasinoLog): CasinoSession | null {
  let best: CasinoSession | null = null;
  for (const s of log.sessions) {
    if (s.end !== null) continue;
    if (!best || Date.parse(s.start) > Date.parse(best.start)) best = s;
  }
  return best;
}

export function casinoById(log: CasinoLog, id: string): Casino | undefined {
  return log.casinos.find((c) => c.id === id);
}

export function hasCasinoData(log: CasinoLog): boolean {
  return log.casinos.length > 0 || log.sessions.length > 0 || log.settings.startingBankroll !== null;
}

// ---------------------------------------------------------------- changes (pure)

/** The fields a casino form edits: everything but the bookkeeping. */
export type CasinoDraft = Omit<Casino, 'id' | 'createdAt' | 'updatedAt'>;

export function blankCasinoDraft(name = ''): CasinoDraft {
  return {
    name,
    area: undefined,
    games: [blankGame()],
    driveMinutes: null,
    location: null,
    status: 'ok',
    burnedUntil: null,
    notes: '',
  };
}

/**
 * Add (no id) or replace a casino. The name is trimmed; an empty one is
 * refused. Wave W (review S2): a game whose rules changed gets a new version
 * where `versions` says `new` for it, and is corrected in place otherwise.
 */
export function saveCasino(
  log: CasinoLog,
  draft: CasinoDraft,
  now: number,
  id?: string,
  versions: Readonly<Record<string, VersionChoice>> = {},
): { log: CasinoLog; casino: Casino } | null {
  const name = draft.name.trim();
  if (!name) return null;
  const existing = id ? casinoById(log, id) : undefined;
  const normed = normCasino({
    ...draft,
    name,
    id: existing?.id ?? makeCasinoId('c'),
    createdAt: existing?.createdAt ?? stamp(now),
    updatedAt: stamp(now),
  })!;
  const casino: Casino = {
    ...normed,
    games: normed.games.map((g) => versioned(existing?.games.find((p) => p.id === g.id), g, versions[g.id], stamp(now))),
  };
  const casinos = existing ? log.casinos.map((c) => (c.id === casino.id ? casino : c)) : [...log.casinos, casino];
  return { log: { ...log, casinos }, casino };
}

/** Remove a casino and every session played there (the UI says so first). */
export function deleteCasino(log: CasinoLog, id: string, now: number = Date.now()): CasinoLog {
  const gone = log.casinos.find((c) => c.id === id);
  // Re-review R5: remembered, so an older file does not bring it back unasked.
  const deletedCasinos = gone
    ? [...(log.deletedCasinos ?? []).filter((d) => d.id !== id), { id, name: gone.name, at: stamp(now) }]
    : log.deletedCasinos;
  return {
    ...log,
    casinos: log.casinos.filter((c) => c.id !== id),
    sessions: log.sessions.filter((s) => s.casinoId !== id),
    ...(deletedCasinos ? { deletedCasinos } : {}),
  };
}

/**
 * Put a session on the clock. Refused while another is running, or for an
 * unknown casino. Wave W: at the game `gameId` names, at its version now; a
 * casino of one game needs none named; at several, none named is "several".
 */
export function startSession(
  log: CasinoLog,
  casinoId: string,
  now: number,
  buyIn?: number | null,
  gameId?: string | null,
): { log: CasinoLog; session: CasinoSession } | null {
  const casino = casinoById(log, casinoId);
  if (runningSession(log) || !casino) return null;
  const at = stamp(now);
  const game = gameId === null ? undefined : gameId !== undefined ? casino.games.find((g) => g.id === gameId) : casino.games.length === 1 ? casino.games[0] : undefined;
  const session: CasinoSession = {
    id: makeCasinoId('s'),
    casinoId,
    ...(game ? { gameId: game.id, versionId: currentVersionId(game) } : {}),
    start: at,
    end: null,
    buyIns: buyIn && buyIn > 0 ? [buyIn] : [],
    cashOut: null,
    heat: 'none',
    notes: '',
    createdAt: at,
    updatedAt: at,
  };
  return { log: { ...log, sessions: [...log.sessions, session] }, session };
}

function patchSession(log: CasinoLog, id: string, now: number, patch: (s: CasinoSession) => CasinoSession): CasinoLog {
  return {
    ...log,
    sessions: log.sessions.map((s) => (s.id === id ? { ...patch(s), id: s.id, updatedAt: stamp(now) } : s)),
  };
}

export function addBuyIn(log: CasinoLog, sessionId: string, amount: number, now: number): CasinoLog {
  if (!(amount > 0) || !Number.isFinite(amount)) return log;
  return patchSession(log, sessionId, now, (s) => ({ ...s, buyIns: [...s.buyIns, amount] }));
}

export function setSessionHeat(log: CasinoLog, sessionId: string, heat: HeatLevel, now: number): CasinoLog {
  return patchSession(log, sessionId, now, (s) => ({ ...s, heat }));
}

export interface EndSessionFields {
  cashOut: number;
  heat: HeatLevel;
  avgBet?: number | null;
  maxBet?: number | null;
  maxTc?: number | null;
  tables?: string;
  notes?: string;
  /** Mark the casino burned, until this local date (null = indefinitely). */
  burn?: { until: string | null } | null;
}

/** Close a session: cash-out, heat and extras; optionally burn the casino. */
export function endSession(log: CasinoLog, sessionId: string, fields: EndSessionFields, now: number): CasinoLog {
  const session = log.sessions.find((s) => s.id === sessionId);
  if (!session) return log;
  let next = patchSession(log, sessionId, now, (s) => ({
    ...s,
    end: stamp(Math.max(now, Date.parse(s.start))),
    cashOut: Math.max(0, fields.cashOut),
    heat: fields.heat,
    avgBet: fields.avgBet ?? s.avgBet ?? null,
    maxBet: fields.maxBet ?? s.maxBet ?? null,
    maxTc: fields.maxTc ?? s.maxTc ?? null,
    tables: fields.tables?.trim() ? fields.tables : s.tables,
    notes: fields.notes ?? s.notes,
  }));
  if (fields.burn) next = burnCasino(next, session.casinoId, fields.burn.until, now);
  return next;
}

export function burnCasino(log: CasinoLog, casinoId: string, until: string | null, now: number): CasinoLog {
  return {
    ...log,
    casinos: log.casinos.map((c) =>
      c.id === casinoId
        ? { ...c, status: 'burned', burnedUntil: until && DATE_ONLY.test(until) ? until : null, updatedAt: stamp(now) }
        : c,
    ),
  };
}

/** Replace a session from the edit form (normalised, so a bad field cannot land). */
export function updateSession(log: CasinoLog, session: CasinoSession, now: number): CasinoLog {
  const clean = normSession({ ...session, updatedAt: stamp(now) });
  if (!clean) return log;
  return { ...log, sessions: log.sessions.map((s) => (s.id === clean.id ? clean : s)) };
}

export function deleteSession(log: CasinoLog, id: string, now: number = Date.now()): CasinoLog {
  const gone = log.sessions.find((s) => s.id === id);
  // B15: remembered, so an older file does not bring it back unasked.
  const deletedSessions = gone
    ? [...(log.deletedSessions ?? []).filter((d) => d.id !== id), { id, label: sessionLabel(log, gone), at: stamp(now) }]
    : log.deletedSessions;
  return { ...log, sessions: log.sessions.filter((s) => s.id !== id), ...(deletedSessions ? { deletedSessions } : {}) };
}

/** "Wynn, 2026-10-18, buy-in $500": which session, in the import preview. */
function sessionLabel(log: CasinoLog, s: CasinoSession): string {
  const d = new Date(s.start);
  const p = (n: number) => String(n).padStart(2, '0');
  const day = Number.isNaN(d.getTime()) ? s.start : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const buyIn = s.buyIns.reduce((a, b) => a + b, 0);
  const name = casinoById(log, s.casinoId)?.name ?? 'a casino';
  return `${name}, ${day}${buyIn > 0 ? `, buy-in $${buyIn.toLocaleString('en-US')}` : ''}`;
}

export function setStartingBankroll(log: CasinoLog, amount: number | null, now: number): CasinoLog {
  return { ...log, settings: { ...log.settings, startingBankroll: money(amount), updatedAt: stamp(now) } };
}

/** Wave K: the Casino settings beside the bankroll -- custom methods and session length. */
export function setCasinoSettings(
  log: CasinoLog,
  patch: { methods?: BetMethod[]; sessionHours?: number | null; exitFindMinutes?: number | null; exitWaitMinutes?: number | null },
  now: number,
): CasinoLog {
  const next = normSettings({ ...log.settings, ...patch, updatedAt: stamp(now) });
  if (patch.sessionHours === null) delete next.sessionHours;
  if (patch.exitFindMinutes === null) delete next.exitFindMinutes;
  if (patch.exitWaitMinutes === null) delete next.exitWaitMinutes;
  return { ...log, settings: next };
}

/**
 * Wave K: save one casino's notes in place (the detail screen's Notes
 * section). Moves `updatedAt`, so an import keeps whichever copy was written
 * last. Unknown casino or unchanged text: the same log back.
 */
export function setCasinoNotes(log: CasinoLog, casinoId: string, notes: string, now: number): CasinoLog {
  const text = notesOf(notes);
  const c = casinoById(log, casinoId);
  if (!c || c.notes === text) return log;
  return { ...log, casinos: log.casinos.map((x) => (x.id === casinoId ? { ...x, notes: text, updatedAt: stamp(now) } : x)) };
}

/** Wave K: save (or clear, with null) a casino's spot. */
export function setCasinoLocation(log: CasinoLog, casinoId: string, location: GeoPoint | null, now: number): CasinoLog {
  const loc = location === null ? null : normPoint(location);
  return {
    ...log,
    casinos: log.casinos.map((x) => (x.id === casinoId ? { ...x, location: loc, updatedAt: stamp(now) } : x)),
  };
}

export function markExported(log: CasinoLog, now: number): CasinoLog {
  return { ...log, lastExportAt: stamp(now) };
}

// ---------------------------------------------------------------- export / import

export const EXPORT_APP = 'bjtrainer-casino-log';

/** The file's name for a given day: `casino-log-YYYY-MM-DD.json` (local date). */
export function exportFileName(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `casino-log-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

/** The export file's text. Unreadable bytes from an earlier load ride along verbatim. */
export function serializeExport(log: CasinoLog, now: number, corrupt: string | null = quarantinedCasinoLog()): string {
  const out: Record<string, unknown> = {
    app: EXPORT_APP,
    version: 3,
    exportedAt: stamp(now),
    casinos: log.casinos,
    sessions: log.sessions,
    settings: log.settings,
  };
  if (corrupt !== null) out.unreadable = corrupt;
  return JSON.stringify(out, null, 2);
}

/** C9 follow-up: a game an import ticked as a house game. */
export interface HouseGameDetection {
  casinoId: string;
  casino: string;
  gameId: string;
  /** The game's label, else its house name; null when it has neither. */
  label: string | null;
}

export interface MergeReport {
  casinosAdded: number;
  casinosUpdated: number;
  sessionsAdded: number;
  sessionsUpdated: number;
  /** Entries already here and the same or newer here, so left alone. */
  kept: number;
  /** Entries in the file that could not be read. */
  skipped: number;
  /**
   * Sessions left running beside the live one after the merge (another
   * device's open session, or an export taken mid-session). Only the latest
   * is the live card; the others wait in the history to be ended.
   */
  extraRunning: number;
  /** Wave W (review S3): what the import does to each casino in the file, for the preview. */
  casinos: { id: string; name: string; outcome: 'added' | 'updated' | 'unchanged' }[];
  /**
   * Casinos in the file under another id than the one here of the same
   * name: merged into it (`localId`) or added beside it, as `choice` says.
   */
  nameMatches: NameMatch[];
  /**
   * Re-review R2: games a versionless (v1/v2) file gives other rules than
   * the current version's here. Each is a rule change on the current
   * version -- a new version, or a fix -- as `choice` says; never a write
   * into an earlier one.
   */
  ruleChanges: ImportRuleChange[];
  /**
   * Re-review R5: casinos in the file that were deleted here. Left out
   * unless `restore` names them; `restore` here says which are coming back.
   */
  deleted: { id: string; name: string; restore: boolean; kind?: 'session' }[];
  /** C9 follow-up: games the file brought that this import ticked as house games. */
  houseGamesDetected: HouseGameDetection[];
}

/** Re-review R2: a game whose rules a versionless file changes. */
export interface ImportRuleChange {
  /** `<casino id>/<game id>`: what `mergeImport`'s `rules` answers by. */
  key: string;
  casinoName: string;
  gameId: string;
  /** The game here (its current version's rules). */
  prev: CasinoGame;
  /** The game with the file's rules. */
  next: CasinoGame;
  /** Sessions played at the current version here. */
  sessions: number;
  choice: ImportRuleChoice;
}
/**
 * A new version or a fix, as the form asks; or keep the rules here. The
 * default: kept when the file's record is not newer than the one here (a
 * newer record wins, as always), else a new version when the current one
 * has sessions, a fix when it has none.
 */
export type ImportRuleChoice = VersionChoice | 'keep';

/** Wave W (review S3): a casino in a file named as one here, under another id. */
export interface NameMatch {
  /** The file's id for it. */
  id: string;
  name: string;
  /** The one here. */
  localId: string;
  choice: NameChoice;
}
/** Merge a same-named casino into the one here, or add it as another. */
export type NameChoice = 'merge' | 'add';

function mergeById<T extends { id: string; updatedAt: string }>(
  local: T[],
  incoming: T[],
  /** How a newer incoming entry replaces the one here; absent = whole. */
  replace: (cur: T, inc: T) => T = (_cur, inc) => inc,
): { items: T[]; added: number; updated: number; kept: number } {
  const byId = new Map(local.map((x) => [x.id, x]));
  let added = 0;
  let updated = 0;
  let kept = 0;
  for (const inc of incoming) {
    const cur = byId.get(inc.id);
    if (!cur) {
      byId.set(inc.id, inc);
      added += 1;
    } else if (Date.parse(inc.updatedAt) > Date.parse(cur.updatedAt)) {
      byId.set(inc.id, replace(cur, inc));
      updated += 1;
    } else {
      kept += 1;
    }
  }
  // Local order first, then the new ones in file order.
  const items = [...local.map((x) => byId.get(x.id)!), ...incoming.filter((x) => !local.some((l) => l.id === x.id))];
  return { items, added, updated, kept };
}

/** The game fields a v1 record carries (its `game` plus the casino-level four). */
const V1_GAME_FIELDS = ['decks', 's17', 'das', 'surrender', 'payout', 'cutDecksLeft', 'minBet', 'maxBet', 'midShoeEntry', 'csm'] as const;

/**
 * Review N8: a newer casino record that came from v1 (an older build's export
 * or stored blob) knows one game and no drive time or spot. It replaces the
 * casino's own fields, but the games, drive time and spot here stay: its one
 * game (id `g-<casino id>`, the migration's) updates the v1 facts of the game
 * with that id, keeping the label, rounds per hour and notes only v2 has.
 */
function fromV1Casino(cur: Casino, inc: Casino): Casino {
  const incGame = inc.games[0];
  const games = cur.games.map((g) => {
    if (!incGame || g.id !== incGame.id) return g;
    const next: CasinoGame = { ...g };
    for (const f of V1_GAME_FIELDS) (next as unknown as Record<string, unknown>)[f] = incGame[f];
    return next;
  });
  return { ...inc, games, driveMinutes: cur.driveMinutes ?? null, location: cur.location ?? null };
}

/**
 * Two copies of one casino merged. The newer record's own fields win (a tie
 * keeps what is here), as before; Wave W (review S2): each game both hold
 * keeps every version either has (`mergeGameVersions`), whichever record
 * won. A v1 record knows no versions: it is taken as before (`fromV1Casino`),
 * its rules the current version's.
 */
function mergeCasino(cur: Casino, inc: Casino, fromV1: boolean): Casino {
  const newer = Date.parse(inc.updatedAt) > Date.parse(cur.updatedAt);
  if (fromV1) {
    if (!newer) return cur;
    const taken = fromV1Casino(cur, inc);
    return {
      ...taken,
      notes: bothNotes(inc.notes, cur.notes),
      games: taken.games.map((g) => versioned(cur.games.find((p) => p.id === g.id), g, 'fix', inc.updatedAt)),
    };
  }
  const [base, other] = newer ? [inc, cur] : [cur, inc];
  // Review S3: a game only one copy has is kept, wherever it is -- the one here above all.
  const games = [
    ...base.games.map((g) => mergeGame(g, other.games.find((o) => o.id === g.id))),
    ...other.games.filter((o) => !base.games.some((g) => g.id === o.id)),
  ];
  return { ...base, notes: bothNotes(base.notes, other.notes), games };
}

/** One game both copies hold: every version either has, and both copies' notes. */
function mergeGame(g: CasinoGame, other: CasinoGame | undefined): CasinoGame {
  const merged = mergeGameVersions(g, other);
  if (!other) return merged;
  const notes = bothNotes(g.notes ?? '', other.notes ?? '');
  // Unchanged notes leave the record exactly as it was (an unchanged casino must compare equal).
  if (notes === (merged.notes ?? '')) return merged;
  const { notes: _drop, ...rest } = merged;
  return notes !== '' ? { ...rest, notes } : rest;
}

/**
 * Wave W (review S3): notes from two copies, neither dropped. The newer
 * copy's, and the other's after it when it says something the newer one
 * does not (an edit that only added to the notes reads as the longer one).
 * A text taken out on one phone can come back from the other: kept twice
 * is fixable, lost is not.
 */
function bothNotes(win: string, other: string): string {
  const w = win.trim();
  const o = other.trim();
  if (o === '' || covers(w, o)) return win;
  if (w === '' || covers(o, w)) return other;
  return `${win.trimEnd()}\n\n${o}`.slice(0, NOTES_MAX);
}

/**
 * Whether `big` already says `small`: its text, whitespace aside, whole
 * words at either end ("Ray" is in "Pit boss Ray.", not in "Raymond").
 * Re-review R4: an edit here that added to the notes, or only re-flowed
 * them, holds the file's older text -- so a re-import does not append it
 * again.
 */
function covers(big: string, small: string): boolean {
  const b = big.replace(/\s+/g, ' ').trim();
  const s = small.replace(/\s+/g, ' ').trim();
  if (s === '') return true;
  const edge = /[\s.,;:!?()[\]"'\u2018\u2019\u201c\u201d-]/;
  for (let i = b.indexOf(s); i >= 0; i = b.indexOf(s, i + 1)) {
    const before = i === 0 || edge.test(b[i - 1]!) || edge.test(s[0]!);
    const j = i + s.length;
    const after = j === b.length || edge.test(b[j]!) || edge.test(s[s.length - 1]!);
    if (before && after) return true;
  }
  return false;
}

/** Casinos merged by id (`mergeCasino`); one is counted updated when the merge changed it here. */
function mergeCasinos(
  local: Casino[],
  incoming: Casino[],
  fromV1: boolean,
): { items: Casino[]; added: number; updated: number; kept: number; outcomes: MergeReport['casinos'] } {
  const byId = new Map(local.map((x) => [x.id, x]));
  let added = 0;
  let updated = 0;
  let kept = 0;
  const outcomes: MergeReport['casinos'] = [];
  for (const inc of incoming) {
    const cur = byId.get(inc.id);
    if (!cur) {
      byId.set(inc.id, inc);
      added += 1;
      outcomes.push({ id: inc.id, name: inc.name, outcome: 'added' });
      continue;
    }
    const merged = mergeCasino(cur, inc, fromV1);
    if (JSON.stringify(merged) === JSON.stringify(cur)) {
      kept += 1;
      outcomes.push({ id: inc.id, name: cur.name, outcome: 'unchanged' });
    } else {
      byId.set(inc.id, merged);
      updated += 1;
      outcomes.push({ id: inc.id, name: merged.name, outcome: 'updated' });
    }
  }
  const items = [...local.map((x) => byId.get(x.id)!), ...incoming.filter((x) => !local.some((l) => l.id === x.id))];
  return { items, added, updated, kept, outcomes };
}

const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Wave W (review S3): casinos in the file under an id this log does not
 * have but a name it does. `merge` (the default) takes the file's record
 * as another copy of the one here -- its id, and its sessions' casino,
 * rewritten to the one here; `add` keeps it as a casino of its own.
 */
function matchNames(local: CasinoLog, inc: CasinoLog, choices: Readonly<Record<string, NameChoice>>): { inc: CasinoLog; matches: NameMatch[] } {
  const here = new Set(local.casinos.map((c) => c.id));
  const inFile = new Set(inc.casinos.map((c) => c.id));
  const matches: NameMatch[] = [];
  const remap = new Map<string, string>();
  for (const c of inc.casinos) {
    if (here.has(c.id)) continue;
    const same = local.casinos.find((l) => nameKey(l.name) === nameKey(c.name) && !inFile.has(l.id) && ![...remap.values()].includes(l.id));
    if (!same) continue;
    const choice = choices[c.id] ?? 'merge';
    matches.push({ id: c.id, name: c.name, localId: same.id, choice });
    if (choice === 'merge') remap.set(c.id, same.id);
  }
  if (remap.size === 0) return { inc, matches };
  return {
    matches,
    inc: {
      ...inc,
      casinos: inc.casinos.map((c) => (remap.has(c.id) ? { ...c, id: remap.get(c.id)! } : c)),
      sessions: inc.sessions.map((s) => (remap.has(s.casinoId) ? { ...s, casinoId: remap.get(s.casinoId)! } : s)),
    },
  };
}

/**
 * Two logs merged by id: the newer `updatedAt` wins, a tie keeps what is
 * here, nothing is deleted. `fromV1`: the incoming log was a v1 blob or file
 * (see `fromV1Casino`; its settings only carry the bankroll).
 */
function mergeLogs(local: CasinoLog, inc: CasinoLog, fromV1: boolean) {
  const casinos = mergeCasinos(local.casinos, inc.casinos, fromV1);
  const sessions = mergeById(local.sessions, inc.sessions);
  const incSettingsNewer =
    inc.settings.updatedAt !== null &&
    (local.settings.updatedAt === null || Date.parse(inc.settings.updatedAt) > Date.parse(local.settings.updatedAt));
  const settings = !incSettingsNewer
    ? local.settings
    : fromV1
      ? { ...local.settings, startingBankroll: inc.settings.startingBankroll, updatedAt: inc.settings.updatedAt }
      : inc.settings;
  return { log: { ...local, casinos: casinos.items, sessions: sessions.items, settings }, casinos, sessions };
}

/**
 * Merge an export file (or a raw stored blob) into the local log: by id, the
 * newer `updatedAt` wins a record's own fields, a tie keeps what is here.
 * Nothing here is deleted: Wave W (review S3), every game and version
 * either copy holds is kept, and both copies' notes. A casino in the file
 * named as one here under another id is merged into it or added beside it,
 * as `names` says (merged by default); the report lists each such match.
 * Pure: the screen shows the report as a preview and commits the log on
 * the owner's word.
 */
export function mergeImport(
  local: CasinoLog,
  text: string,
  names: Readonly<Record<string, NameChoice>> = {},
  rules: Readonly<Record<string, ImportRuleChoice>> = {},
  restore: Readonly<Record<string, boolean>> = {},
): { ok: true; log: CasinoLog; report: MergeReport; unreadable: string | null } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not JSON.' };
  }
  if (!isObj(parsed) || (!Array.isArray(parsed.casinos) && !Array.isArray(parsed.sessions))) {
    return { ok: false, error: 'That file is not a casino log export.' };
  }
  if (parsed.version !== undefined && parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) {
    return { ok: false, error: `That file is version ${String(parsed.version)}, newer than this app reads.` };
  }
  // A v1 file is migrated exactly as a v1 blob is (each casino's game -> games[0]).
  const migrated = migrateCasinoLog({ ...parsed, version: parsed.version ?? 1 });
  if (!migrated) return { ok: false, error: 'That file is not a casino log export.' };
  const kept = keepDeleted(local, migrated.log, restore);
  const matched = matchNames(kept.local, kept.inc, names);
  const versionless = parsed.version !== 3;
  const fromV1 = parsed.version !== 2 && parsed.version !== 3;
  const held = versionless ? holdRules(kept.local, matched.inc, fromV1) : { inc: matched.inc, pending: [] };
  const merged = mergeLogs(kept.local, held.inc, fromV1);
  const { casinos, sessions } = merged;
  const applied = applyRules(merged.log, kept.local, held.pending, rules);
  const fileGames = new Set(held.inc.casinos.flatMap((c) => c.games.map((g) => g.id)));
  const houses = tickHouseGames(applied.log, kept.local, fileGames);
  const log = houses.log;
  if (applied.changes.length > 0) {
    // A casino whose rules changed only through a choice counts as updated.
    for (const o of casinos.outcomes) {
      if (o.outcome === 'unchanged' && applied.changes.some((c) => c.key.startsWith(`${o.id}/`) && c.choice !== 'keep')) {
        o.outcome = 'updated';
        casinos.kept -= 1;
        casinos.updated += 1;
      }
    }
  }
  const open = sessions.items.filter((s) => s.end === null).length;
  return {
    ok: true,
    // Bytes the file was carrying because its own device could not read them.
    unreadable: typeof parsed.unreadable === 'string' ? parsed.unreadable : null,
    log,
    report: {
      casinosAdded: casinos.added,
      casinosUpdated: casinos.updated,
      sessionsAdded: sessions.added,
      sessionsUpdated: sessions.updated,
      kept: casinos.kept + sessions.kept,
      skipped: migrated.skipped,
      extraRunning: Math.max(0, open - 1),
      casinos: casinos.outcomes,
      nameMatches: matched.matches,
      ruleChanges: applied.changes,
      deleted: kept.deleted,
      houseGamesDetected: houses.detected,
    },
  };
}

/**
 * Re-review R5: a casino the file holds that was deleted here stays out,
 * with its sessions, unless `restore` asks for it back -- then it is
 * forgotten as deleted and taken in like any other.
 */
function keepDeleted(
  local: CasinoLog,
  inc: CasinoLog,
  restore: Readonly<Record<string, boolean>>,
): { local: CasinoLog; inc: CasinoLog; deleted: MergeReport['deleted'] } {
  const gone = new Map((local.deletedCasinos ?? []).filter((d) => !local.casinos.some((c) => c.id === d.id)).map((d) => [d.id, d]));
  const deleted: MergeReport['deleted'] = [];
  for (const c of inc.casinos) if (gone.has(c.id)) deleted.push({ id: c.id, name: c.name || gone.get(c.id)!.name, restore: restore[c.id] === true });
  // B15: a deleted session the file still holds stays out the same way.
  const goneS = new Map((local.deletedSessions ?? []).filter((d) => !local.sessions.some((x) => x.id === d.id)).map((d) => [d.id, d]));
  const casinoOut = new Set(deleted.filter((d) => !d.restore).map((d) => d.id));
  for (const x of inc.sessions) {
    if (goneS.has(x.id) && !casinoOut.has(x.casinoId)) {
      deleted.push({ id: x.id, name: goneS.get(x.id)!.label || sessionLabel(inc, x), restore: restore[x.id] === true, kind: 'session' });
    }
  }
  if (deleted.length === 0) return { local, inc, deleted };
  const out = new Set(deleted.filter((d) => !d.restore).map((d) => d.id));
  const back = new Set(deleted.filter((d) => d.restore).map((d) => d.id));
  const rest = (local.deletedCasinos ?? []).filter((d) => !back.has(d.id));
  const restS = (local.deletedSessions ?? []).filter((d) => !back.has(d.id));
  const { deletedCasinos: _d, deletedSessions: _s, ...base } = local;
  return {
    deleted,
    local: { ...base, ...(rest.length > 0 ? { deletedCasinos: rest } : {}), ...(restS.length > 0 ? { deletedSessions: restS } : {}) },
    inc: {
      ...inc,
      casinos: inc.casinos.filter((c) => !out.has(c.id)),
      sessions: inc.sessions.filter((x) => !out.has(x.casinoId) && !out.has(x.id)),
    },
  };
}

interface HeldRules {
  key: string;
  casinoId: string;
  gameId: string;
  rules: VersionRules;
  /** The file's record was newer than the one here. */
  newer: boolean;
  at: string;
}

/**
 * Re-review R2: a versionless record's games carry the file's rules on a
 * made-up version 1 that could overwrite the version 1 here. Before the
 * merge, each game the log already has takes the rules and versions here,
 * so the merge never touches a version; the file's rules are held aside,
 * to land on the current version afterwards (`applyRules`).
 */
function holdRules(local: CasinoLog, inc: CasinoLog, fromV1: boolean): { inc: CasinoLog; pending: HeldRules[] } {
  const pending: HeldRules[] = [];
  const casinos = inc.casinos.map((c) => {
    const here = local.casinos.find((l) => l.id === c.id);
    if (!here) return c;
    const newer = Date.parse(c.updatedAt) > Date.parse(here.updatedAt);
    return {
      ...c,
      games: c.games.map((g) => {
        const lg = here.games.find((x) => x.id === g.id);
        if (!lg) return g;
        // A v1 record knows only v1's fields: the rest stay as they are here.
        const theirs = fromV1 ? withV1Fields(lg, g) : g;
        pending.push({ key: `${c.id}/${g.id}`, casinoId: c.id, gameId: g.id, rules: rulesOf(theirs), newer, at: c.updatedAt });
        const { versions: _v, versionId: _id, ...rest } = withRules(g, rulesOf(lg));
        return { ...rest, ...(lg.versionId !== undefined ? { versionId: lg.versionId } : {}), ...(lg.versions !== undefined ? { versions: lg.versions } : {}) };
      }),
    };
  });
  return { inc: { ...inc, casinos }, pending };
}

function withV1Fields(here: CasinoGame, v1: CasinoGame): CasinoGame {
  const next: CasinoGame = { ...here };
  for (const f of V1_GAME_FIELDS) (next as unknown as Record<string, unknown>)[f] = v1[f];
  return next;
}

/**
 * The sessions that hold a game's version: those recorded at it, and
 * (re-review R3) the casino's sessions that never said which game -- a v2
 * session at a casino of several, or one started at "several" -- played
 * while that version was current. Such a session may have been at this
 * game, so its rules are kept like any other's.
 */
export function sessionsAtGameVersion(log: CasinoLog, casinoId: string, game: CasinoGame, versionId: string): CasinoSession[] {
  return log.sessions.filter(
    (s) =>
      s.casinoId === casinoId &&
      (s.gameId === game.id ? s.versionId === versionId : s.gameId === undefined && versionAt(game, s.start).versionId === versionId),
  );
}

/** The held rules landed on each game's current version: a new version, a fix, or kept, as chosen. */
function applyRules(
  log: CasinoLog,
  local: CasinoLog,
  pending: HeldRules[],
  choices: Readonly<Record<string, ImportRuleChoice>>,
): { log: CasinoLog; changes: ImportRuleChange[] } {
  const changes: ImportRuleChange[] = [];
  let casinos = log.casinos;
  for (const p of pending) {
    const c = casinos.find((x) => x.id === p.casinoId);
    const g = c?.games.find((x) => x.id === p.gameId);
    if (!c || !g || sameRules(g, p.rules)) continue;
    const next = withRules(g, p.rules);
    const sessions = sessionsAtGameVersion(log, c.id, g, currentVersionId(g)).length;
    const choice = choices[p.key] ?? (!p.newer ? 'keep' : sessions > 0 ? 'new' : 'fix');
    changes.push({ key: p.key, casinoName: c.name, gameId: g.id, prev: g, next, sessions, choice });
    if (choice === 'keep') continue;
    // Later than anything the game holds, so the change is the current version on every copy merged after.
    const last = versionsOf(g).reduce((t, v) => Math.max(t, Date.parse(v.createdAt), Date.parse(v.updatedAt)), 0);
    const here = local.casinos.find((x) => x.id === c.id);
    const atMs = Math.max(Date.parse(p.at), last + 1, here ? Date.parse(here.updatedAt) + 1 : 0);
    const at = new Date(atMs).toISOString();
    const game = versioned(g, next, choice, at);
    const updatedAt = Date.parse(c.updatedAt) >= atMs ? c.updatedAt : at;
    casinos = casinos.map((x) => (x.id === c.id ? { ...x, updatedAt, games: x.games.map((y) => (y.id === g.id ? game : y)) } : x));
  }
  return { log: { ...log, casinos }, changes };
}
