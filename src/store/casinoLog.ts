import { reportStorageFailure, shrinkDiagnostics } from './storageHealth';
import { subscribeToExternalWrites } from './crossTab';
import { normMethod, type BetMethod } from '../engine/betMethods';

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
 *     ever calls `diag()`.
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
 */

export const CASINO_LOG_KEY = 'bjtrainer.casinoLog.v2';
/** The v1 blob's key: read as a migration source, never written. */
export const LEGACY_CASINO_LOG_KEY = 'bjtrainer.casinoLog.v1';
const CORRUPT_KEY = `${CASINO_LOG_KEY}.corrupt`;
/** Where an older build quarantined what it could not read. */
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
  version: 2;
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
}

export interface LegacyIds {
  casinos: string[];
  sessions: string[];
}

const idList = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);

export function emptyCasinoLog(): CasinoLog {
  return {
    version: 2,
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
 * game that arrived without one.
 */
export function normGame(x: unknown, fallbackId: string, legacy?: Record<string, unknown>): CasinoGame {
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
  Object.assign(game, normWaveMGame(g));
  return game;
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

function normGames(x: Record<string, unknown>, casinoId: string): CasinoGame[] {
  // v1: one `game`, with the betting facts on the casino beside it.
  if (!Array.isArray(x.games)) return [normGame(x.game, `g-${casinoId}`, { ...(isObj(x.game) ? x.game : {}), ...x })];
  const seen = new Set<string>();
  const games: CasinoGame[] = [];
  x.games.forEach((raw, i) => {
    const g = normGame(raw, `g-${casinoId}-${i}`);
    if (seen.has(g.id)) return;
    seen.add(g.id);
    games.push(g);
  });
  return games.length > 0 ? games : [blankGame(`g-${casinoId}`)];
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
  return {
    id,
    name,
    area: typeof x.area === 'string' && x.area.trim() !== '' ? x.area.trim() : undefined,
    games: normGames(x, id),
    driveMinutes: boundedOrNull(x.driveMinutes, 0, 24 * 60),
    location: normPoint(x.location),
    ...normWaveMCasino(x),
    status,
    burnedUntil: typeof x.burnedUntil === 'string' && DATE_ONLY.test(x.burnedUntil) ? x.burnedUntil : null,
    notes: notesOf(x.notes),
    createdAt,
    updatedAt: iso(x.updatedAt) ?? createdAt,
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
  return {
    id,
    casinoId,
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
 * either version is also repaired: a partial or hand-edited blob gets every
 * missing field filled and every bad entry dropped. A blob with no version
 * but the two lists is read as v1 (an export edited by hand loses the
 * wrapper first). Anything else -- a newer version this build does not know
 * -- is refused, so it is quarantined rather than flattened into this
 * build's idea of it.
 */
export function migrateCasinoLog(parsed: unknown): { log: CasinoLog; skipped: number } | null {
  if (!isObj(parsed)) return null;
  const v = parsed.version;
  const readable = v === 1 || v === 2 || (v === undefined && (Array.isArray(parsed.casinos) || Array.isArray(parsed.sessions)));
  if (!readable) return null;
  const casinos = normList(parsed.casinos, normCasino);
  const sessions = normList(parsed.sessions, normSession);
  const log: CasinoLog = {
    version: 2,
    casinos: casinos.items,
    sessions: sessions.items,
    settings: normSettings(parsed.settings),
    lastExportAt: iso(parsed.lastExportAt),
  };
  if (v === 2 && typeof parsed.legacySeen === 'string') log.legacySeen = parsed.legacySeen;
  if (v === 2 && isObj(parsed.legacyIds)) log.legacyIds = { casinos: idList(parsed.legacyIds.casinos), sessions: idList(parsed.legacyIds.sessions) };
  return { log, skipped: casinos.skipped + sessions.skipped };
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
    return s.getItem(CORRUPT_KEY) ?? s.getItem(LEGACY_CORRUPT_KEY);
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
 * quarantined and reads as empty, partial is repaired. A v1 blob an older
 * build wrote since this log last took it in is merged in (see the header);
 * the result carries the v1 fingerprint, and the next save records it. Load
 * itself never writes the log.
 */
export function loadCasinoLog(): CasinoLog {
  let raw: string | null;
  let legacy: string | null;
  try {
    raw = store().getItem(CASINO_LOG_KEY);
    legacy = store().getItem(LEGACY_CASINO_LOG_KEY);
  } catch {
    return emptyCasinoLog();
  }
  let log: CasinoLog | null = null;
  if (raw) {
    log = readBlob(raw);
    if (!log) quarantine(raw);
  }
  if (!legacy) return log ?? emptyCasinoLog();
  const seen = fingerprint(legacy);
  if (log && log.legacySeen === seen) {
    if (log.legacyIds) return log;
    // Saved by a build before R1: the v1 blob it took in is still this one.
    const taken = readBlob(legacy);
    return taken ? { ...log, legacyIds: idsOf(taken) } : log;
  }
  const old = readBlob(legacy);
  if (!old) {
    quarantine(legacy);
    return { ...(log ?? emptyCasinoLog()), legacySeen: seen };
  }
  if (!log) return { ...old, legacySeen: seen, legacyIds: idsOf(old) };
  // Re-review R1: what was taken in from v1 before and is gone now was deleted here.
  const prev = log.legacyIds ?? { casinos: [], sessions: [] };
  const deletedCasinos = new Set(prev.casinos.filter((id) => !log.casinos.some((c) => c.id === id)));
  const deletedSessions = new Set(prev.sessions.filter((id) => !log.sessions.some((x) => x.id === id)));
  const fresh: CasinoLog = {
    ...old,
    casinos: old.casinos.filter((c) => !deletedCasinos.has(c.id)),
    sessions: old.sessions.filter((x) => !deletedSessions.has(x.id) && !deletedCasinos.has(x.casinoId)),
  };
  const ids = idsOf(old);
  return {
    ...mergeLogs(log, fresh, true).log,
    legacySeen: seen,
    legacyIds: { casinos: union(prev.casinos, ids.casinos), sessions: union(prev.sessions, ids.sessions) },
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
  // The v1 key too: an older build in another tab writes only that.
  const offExternal = subscribeToExternalWrites([CASINO_LOG_KEY, LEGACY_CASINO_LOG_KEY], () => fn());
  return () => {
    listeners.delete(fn);
    offExternal();
  };
}

// ---------------------------------------------------------------- ids and time

export function makeCasinoId(prefix: 'c' | 's' | 'g' | 'm'): string {
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

/** Add (no id) or replace a casino. The name is trimmed; an empty one is refused. */
export function saveCasino(log: CasinoLog, draft: CasinoDraft, now: number, id?: string): { log: CasinoLog; casino: Casino } | null {
  const name = draft.name.trim();
  if (!name) return null;
  const existing = id ? casinoById(log, id) : undefined;
  const casino = normCasino({
    ...draft,
    name,
    id: existing?.id ?? makeCasinoId('c'),
    createdAt: existing?.createdAt ?? stamp(now),
    updatedAt: stamp(now),
  })!;
  const casinos = existing ? log.casinos.map((c) => (c.id === casino.id ? casino : c)) : [...log.casinos, casino];
  return { log: { ...log, casinos }, casino };
}

/** Remove a casino and every session played there (the UI says so first). */
export function deleteCasino(log: CasinoLog, id: string): CasinoLog {
  return {
    ...log,
    casinos: log.casinos.filter((c) => c.id !== id),
    sessions: log.sessions.filter((s) => s.casinoId !== id),
  };
}

/** Put a session on the clock. Refused while another is running, or for an unknown casino. */
export function startSession(
  log: CasinoLog,
  casinoId: string,
  now: number,
  buyIn?: number | null,
): { log: CasinoLog; session: CasinoSession } | null {
  if (runningSession(log) || !casinoById(log, casinoId)) return null;
  const at = stamp(now);
  const session: CasinoSession = {
    id: makeCasinoId('s'),
    casinoId,
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

export function deleteSession(log: CasinoLog, id: string): CasinoLog {
  return { ...log, sessions: log.sessions.filter((s) => s.id !== id) };
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
    version: 2,
    exportedAt: stamp(now),
    casinos: log.casinos,
    sessions: log.sessions,
    settings: log.settings,
  };
  if (corrupt !== null) out.unreadable = corrupt;
  return JSON.stringify(out, null, 2);
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
}

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
 * Two logs merged by id: the newer `updatedAt` wins, a tie keeps what is
 * here, nothing is deleted. `fromV1`: the incoming log was a v1 blob or file
 * (see `fromV1Casino`; its settings only carry the bankroll).
 */
function mergeLogs(local: CasinoLog, inc: CasinoLog, fromV1: boolean) {
  const casinos = mergeById(local.casinos, inc.casinos, fromV1 ? fromV1Casino : undefined);
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
 * newer `updatedAt` wins, a tie keeps what is here. Nothing is deleted.
 */
export function mergeImport(
  local: CasinoLog,
  text: string,
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
  if (parsed.version !== undefined && parsed.version !== 1 && parsed.version !== 2) {
    return { ok: false, error: `That file is version ${String(parsed.version)}, newer than this app reads.` };
  }
  // A v1 file is migrated exactly as a v1 blob is (each casino's game -> games[0]).
  const migrated = migrateCasinoLog({ ...parsed, version: parsed.version ?? 1 });
  if (!migrated) return { ok: false, error: 'That file is not a casino log export.' };
  const { log, casinos, sessions } = mergeLogs(local, migrated.log, parsed.version !== 2);
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
    },
  };
}
