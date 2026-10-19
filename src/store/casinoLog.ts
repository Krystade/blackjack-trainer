import { reportStorageFailure, shrinkDiagnostics } from './storageHealth';
import { subscribeToExternalWrites } from './crossTab';

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
 */

export const CASINO_LOG_KEY = 'bjtrainer.casinoLog.v1';
const CORRUPT_KEY = `${CASINO_LOG_KEY}.corrupt`;

// ---------------------------------------------------------------- types

export type DeckCount = 1 | 2 | 6 | 8;
export const DECK_COUNTS: readonly DeckCount[] = [1, 2, 6, 8];

export type MidShoeEntry = 'allowed' | 'no' | 'unknown';
export type CasinoStatus = 'ok' | 'avoid' | 'burned';
export type HeatLevel = 'none' | 'attention' | 'shuffle-up' | 'flat-bet' | 'back-off' | 'trespass';
export const HEAT_LEVELS: readonly HeatLevel[] = ['none', 'attention', 'shuffle-up', 'flat-bet', 'back-off', 'trespass'];

/**
 * The game as dealt there. Every field is optional and `null` means "not
 * known yet": a first visit often learns the decks and the payout and nothing
 * else, and an unknown must not be shown as a rule.
 */
export interface CasinoGame {
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
}

export interface Casino {
  id: string;
  name: string;
  area?: string;
  game: CasinoGame;
  minBet?: number | null;
  maxBet?: number | null;
  /** Back-counting (wonging in) depends on it. */
  midShoeEntry: MidShoeEntry;
  /** A continuous shuffler: counting is impossible. */
  csm: boolean;
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
}

export interface CasinoLog {
  version: 1;
  casinos: Casino[];
  sessions: CasinoSession[];
  settings: CasinoLogSettings;
  /** When the log was last exported to a file (ISO), for the backup nudge. */
  lastExportAt: string | null;
}

export function emptyCasinoLog(): CasinoLog {
  return {
    version: 1,
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

function normGame(x: unknown): CasinoGame {
  const g = isObj(x) ? x : {};
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
    game: normGame(x.game),
    minBet: money(x.minBet),
    maxBet: money(x.maxBet),
    midShoeEntry: x.midShoeEntry === 'allowed' || x.midShoeEntry === 'no' ? x.midShoeEntry : 'unknown',
    csm: x.csm === true,
    status,
    burnedUntil: typeof x.burnedUntil === 'string' && DATE_ONLY.test(x.burnedUntil) ? x.burnedUntil : null,
    notes: typeof x.notes === 'string' ? x.notes : '',
    createdAt,
    updatedAt: iso(x.updatedAt) ?? createdAt,
  };
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
  return { startingBankroll: money(s.startingBankroll), updatedAt: iso(s.updatedAt) };
}

/**
 * Bring any blob this build understands up to the current shape.
 *
 * Version 1 is the first, so "migrating" today means repairing: a partial or
 * hand-edited v1 blob gets every missing field filled and every bad entry
 * dropped. A blob with no version but the two lists is read as v1 (an
 * export edited by hand loses the wrapper first). Anything else -- a newer
 * version this build does not know -- is refused, so it is quarantined
 * rather than flattened into this build's idea of it.
 */
export function migrateCasinoLog(parsed: unknown): { log: CasinoLog; skipped: number } | null {
  if (!isObj(parsed)) return null;
  const v = parsed.version;
  const looksV1 = v === 1 || (v === undefined && (Array.isArray(parsed.casinos) || Array.isArray(parsed.sessions)));
  if (!looksV1) return null;
  const casinos = normList(parsed.casinos, normCasino);
  const sessions = normList(parsed.sessions, normSession);
  return {
    log: {
      version: 1,
      casinos: casinos.items,
      sessions: sessions.items,
      settings: normSettings(parsed.settings),
      lastExportAt: iso(parsed.lastExportAt),
    },
    skipped: casinos.skipped + sessions.skipped,
  };
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

/** The bytes a previous load could not read, if any were kept. */
export function quarantinedCasinoLog(): string | null {
  try {
    return store().getItem(CORRUPT_KEY);
  } catch {
    return null;
  }
}

/**
 * Read the log. Never throws: absent reads as empty, unreadable is
 * quarantined and reads as empty, partial is repaired.
 */
export function loadCasinoLog(): CasinoLog {
  let raw: string | null;
  try {
    raw = store().getItem(CASINO_LOG_KEY);
  } catch {
    return emptyCasinoLog();
  }
  if (!raw) return emptyCasinoLog();
  try {
    const migrated = migrateCasinoLog(JSON.parse(raw) as unknown);
    if (migrated) return migrated.log;
  } catch {
    /* fall through to quarantine */
  }
  quarantine(raw);
  return emptyCasinoLog();
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
  const offExternal = subscribeToExternalWrites([CASINO_LOG_KEY], () => fn());
  return () => {
    listeners.delete(fn);
    offExternal();
  };
}

// ---------------------------------------------------------------- ids and time

export function makeCasinoId(prefix: 'c' | 's'): string {
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
    game: { decks: null, s17: null, das: null, surrender: null, payout: null, cutDecksLeft: null },
    minBet: null,
    maxBet: null,
    midShoeEntry: 'unknown',
    csm: false,
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
  return { ...log, settings: { startingBankroll: money(amount), updatedAt: stamp(now) } };
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
    version: 1,
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
      byId.set(inc.id, inc);
      updated += 1;
    } else {
      kept += 1;
    }
  }
  // Local order first, then the new ones in file order.
  const items = [...local.map((x) => byId.get(x.id)!), ...incoming.filter((x) => !local.some((l) => l.id === x.id))];
  return { items, added, updated, kept };
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
  if (parsed.version !== undefined && parsed.version !== 1) {
    return { ok: false, error: `That file is version ${String(parsed.version)}, newer than this app reads.` };
  }
  const migrated = migrateCasinoLog({ ...parsed, version: 1 });
  if (!migrated) return { ok: false, error: 'That file is not a casino log export.' };
  const inc = migrated.log;
  const casinos = mergeById(local.casinos, inc.casinos);
  const sessions = mergeById(local.sessions, inc.sessions);
  const incSettingsNewer =
    inc.settings.updatedAt !== null &&
    (local.settings.updatedAt === null || Date.parse(inc.settings.updatedAt) > Date.parse(local.settings.updatedAt));
  const open = sessions.items.filter((s) => s.end === null).length;
  return {
    ok: true,
    // Bytes the file was carrying because its own device could not read them.
    unreadable: typeof parsed.unreadable === 'string' ? parsed.unreadable : null,
    log: {
      ...local,
      casinos: casinos.items,
      sessions: sessions.items,
      settings: incSettingsNewer ? inc.settings : local.settings,
    },
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
