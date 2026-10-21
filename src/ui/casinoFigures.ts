import { PRESET_LABEL } from '../engine/variants/rules';
import { MINUS } from '../drills/signed';
import type { Casino, CasinoGame, CasinoLog, CasinoSession, GameRules, GeoPoint, HeatLevel } from '../store/casinoLog';
import { HEAT_LEVELS } from '../store/casinoLog';

/**
 * Wave J (lane C): every figure the Casino tab derives from the log, and how
 * it is written. Pure, so each one is pinned by casinoFigures.test.ts rather
 * than read off a screen.
 *
 * Money is real dollars here, never training units.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- per session

/** Total bought in across every buy-in. */
export function buyInTotal(s: Pick<CasinoSession, 'buyIns'>): number {
  return s.buyIns.reduce((a, b) => a + b, 0);
}

/** Won (+) or lost (−); null until there is a cash-out. */
export function sessionNet(s: Pick<CasinoSession, 'buyIns' | 'cashOut'>): number | null {
  return s.cashOut === null ? null : s.cashOut - buyInTotal(s);
}

/** Hours played; a running session counts to `now`. */
export function sessionHours(s: Pick<CasinoSession, 'start' | 'end'>, now: number): number {
  const end = s.end === null ? now : Date.parse(s.end);
  return Math.max(0, end - Date.parse(s.start)) / HOUR_MS;
}

// ---------------------------------------------------------------- totals

export interface Totals {
  /** Finished sessions with a cash-out: the ones with a result. */
  sessions: number;
  net: number;
  hours: number;
  /** Net per hour, null with no hours to divide by. */
  perHour: number | null;
}

/** Totals over finished, cashed-out sessions (a running session has no result yet). */
export function totals(sessions: readonly CasinoSession[]): Totals {
  let net = 0;
  let hours = 0;
  let n = 0;
  for (const s of sessions) {
    const r = sessionNet(s);
    if (s.end === null || r === null) continue;
    n += 1;
    net += r;
    hours += sessionHours(s, Date.parse(s.end));
  }
  return { sessions: n, net, hours, perHour: hours > 0 ? net / hours : null };
}

/** Starting bankroll plus all-time net, or null when no starting bankroll is set. */
export function bankrollNow(log: CasinoLog): number | null {
  const start = log.settings.startingBankroll;
  return start === null ? null : start + totals(log.sessions).net;
}

// ---------------------------------------------------------------- dates

/** The local calendar date of an instant, as YYYY-MM-DD. */
export function localDateKey(at: number | Date): string {
  const d = typeof at === 'number' ? new Date(at) : at;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Whole calendar days from `fromKey` to `toKey` (local dates). */
export function daysBetween(fromKey: string, toKey: string): number {
  return dayNumber(toKey) - dayNumber(fromKey);
}

/**
 * A local date N months on, clamped to the month's end (31 Aug + 6 months
 * is 28 or 29 Feb, not 3 March).
 */
export function addMonths(key: string, months: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  return localDateKey(target);
}

/** "today", "yesterday", "23 days ago", "4 months ago", "2 years ago". */
export function agoText(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  // Floored, but never below 2: "1 months ago" / "1 years ago" read wrong,
  // and 60 days is closer to two months than one.
  if (days < 730) return `${Math.max(2, Math.floor(days / 30.4))} months ago`;
  return `${Math.max(2, Math.floor(days / 365.25))} years ago`;
}

/** "Sat 12 Oct" (and the year when it is not this one). */
export function shortDate(iso: string, now: number): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const day = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${day} ${d.getDate()} ${month}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

/** A YYYY-MM-DD date as "12 Apr 2027". */
export function longDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const month = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
  return `${d} ${month} ${y}`;
}

// ---------------------------------------------------------------- casinos

/** Sessions played at one casino. */
export function sessionsAt(log: CasinoLog, casinoId: string): CasinoSession[] {
  return log.sessions.filter((s) => s.casinoId === casinoId);
}

/** The latest session start there, as a local date, or null if never visited. */
export function lastVisitKey(sessions: readonly CasinoSession[]): string | null {
  let best: number | null = null;
  for (const s of sessions) {
    const t = Date.parse(s.start);
    if (best === null || t > best) best = t;
  }
  return best === null ? null : localDateKey(best);
}

export function lastVisitText(sessions: readonly CasinoSession[], now: number): string {
  const key = lastVisitKey(sessions);
  return key === null ? 'never visited' : agoText(daysBetween(key, localDateKey(now)));
}

export type Standing = 'playable' | 'avoid' | 'burned';

/**
 * Where a casino belongs in the list today. A burn whose date has passed is
 * playable again, flagged `coolOffOver` so the row can say so; the stored
 * status is left for the user to change.
 */
export function standing(c: Pick<Casino, 'status' | 'burnedUntil'>, now: number): { group: Standing; coolOffOver: boolean } {
  if (c.status === 'avoid') return { group: 'avoid', coolOffOver: false };
  if (c.status !== 'burned') return { group: 'playable', coolOffOver: false };
  if (c.burnedUntil && c.burnedUntil <= localDateKey(now)) return { group: 'playable', coolOffOver: true };
  return { group: 'burned', coolOffOver: false };
}

/** "until 12 Apr 2027" or "indefinitely". */
export function burnedText(c: Pick<Casino, 'burnedUntil'>): string {
  return c.burnedUntil ? `until ${longDate(c.burnedUntil)}` : 'indefinitely';
}

const GROUP_ORDER: Record<Standing, number> = { playable: 0, avoid: 1, burned: 2 };

/** Playable, then avoid, then burned; within a group the most recent visit first, then by name. */
export function sortCasinos(log: CasinoLog, now: number): Casino[] {
  const visit = new Map(log.casinos.map((c) => [c.id, lastVisitKey(sessionsAt(log, c.id)) ?? '']));
  return [...log.casinos].sort((a, b) => {
    const g = GROUP_ORDER[standing(a, now).group] - GROUP_ORDER[standing(b, now).group];
    if (g !== 0) return g;
    const va = visit.get(a.id)!;
    const vb = visit.get(b.id)!;
    if (va !== vb) return va < vb ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------- heat

export const HEAT_LABEL: Record<HeatLevel, string> = {
  none: 'No heat',
  attention: 'Attention',
  'shuffle-up': 'Shuffle-up',
  'flat-bet': 'Flat-bet',
  'back-off': 'Back-off',
  trespass: 'Trespass',
};

/** What each level means, for the chooser. */
export const HEAT_HINT: Record<HeatLevel, string> = {
  none: 'Nobody noticed',
  attention: 'Pit watching, chatting, asking for a card',
  'shuffle-up': 'Shuffled early when the bet went up',
  'flat-bet': 'Told to flat bet',
  'back-off': 'Told not to play blackjack',
  trespass: 'Read the trespass act',
};

export function heatRank(h: HeatLevel): number {
  return HEAT_LEVELS.indexOf(h);
}

/** The worst heat ever logged at a casino ('none' if never any). */
export function worstHeat(sessions: readonly CasinoSession[]): HeatLevel {
  let worst: HeatLevel = 'none';
  for (const s of sessions) if (heatRank(s.heat) > heatRank(worst)) worst = s.heat;
  return worst;
}

/** 'warn' for heat you keep playing through, 'bad' from flat-bet up. */
export function heatTone(h: HeatLevel): 'none' | 'warn' | 'bad' {
  if (h === 'none') return 'none';
  return heatRank(h) >= heatRank('flat-bet') ? 'bad' : 'warn';
}

/**
 * The burn a session's heat suggests: a back-off cools off for six months from
 * the session's day (editable), a trespass is for good. Anything milder
 * suggests nothing.
 */
export function burnSuggestion(heat: HeatLevel, sessionDayKey: string): { until: string | null } | null {
  if (heat === 'back-off') return { until: addMonths(sessionDayKey, 6) };
  if (heat === 'trespass') return { until: null };
  return null;
}

// ---------------------------------------------------------------- game summary

/**
 * "6D H17 DAS LS RSA 3:2 · split 4 · $1/100 · cut 1.0"; unknown rules are
 * left out rather than guessed. Wave M: RSA and DSA when offered (an unsure
 * "no" shows as NRSA? / NDSA?), D9-11 / D10-11 when doubling is restricted,
 * the split cap, a card room's commission, and a "?" on every field the
 * owner marked unsure.
 */
export function gameSummary(g: GameRules): string {
  const unsure = new Set(g.unsure ?? []);
  const q = (field: string, token: string) => (unsure.has(field) ? `${token}?` : token);
  const parts: string[] = [];
  if (g.decks) parts.push(q('decks', `${g.decks}D`));
  if (g.s17 === true) parts.push(q('s17', 'S17'));
  if (g.s17 === false) parts.push(q('s17', 'H17'));
  if (g.das === true) parts.push(q('das', 'DAS'));
  if (g.das === false) parts.push(q('das', 'NDAS'));
  if (g.surrender === true) parts.push(q('surrender', 'LS'));
  if (g.surrender === false) parts.push(q('surrender', 'NS'));
  if (g.rsa === true) parts.push(q('rsa', 'RSA'));
  if (g.rsa === false && unsure.has('rsa')) parts.push('NRSA?');
  if (g.doubleSplitAces === true) parts.push(q('doubleSplitAces', 'DSA'));
  if (g.doubleSplitAces === false && unsure.has('doubleSplitAces')) parts.push('NDSA?');
  if (g.doubleOn === '9-11' || g.doubleOn === '10-11') parts.push(q('doubleOn', `D${g.doubleOn}`));
  if (g.payout) parts.push(q('payout', g.payout));
  const rules = parts.join(' ');
  const split = g.maxSplitHands ? q('maxSplitHands', `split ${g.maxSplitHands}`) : '';
  const fee = g.commissionPer100 ? q('commissionPer100', `$${g.commissionPer100}/100`) : '';
  const c = g.cutDecksLeft;
  // One decimal as you would say it ("cut 1.0"), two when that is what was entered (0.75).
  const cut = c !== null && c !== undefined ? q('cutDecksLeft', `cut ${Number.isInteger(Math.round(c * 1000) / 100) ? c.toFixed(1) : c.toFixed(2)}`) : '';
  return [rules, split, fee, cut].filter(Boolean).join(' · ') || GAME_NOT_LOGGED;
}

/** What gameSummary says of a game with nothing logged. */
export const GAME_NOT_LOGGED = 'Game not logged';

/** Wave L merge: a game with at least one rule logged (its summary is not "Game not logged"). */
export function gameLogged(g: GameRules): boolean {
  return gameSummary(g) !== GAME_NOT_LOGGED;
}

/** The conditions that change whether a game is worth playing at all. */
export function warnBadges(g: Pick<CasinoGame, 'payout' | 'csm' | 'midShoeEntry'>): string[] {
  const out: string[] = [];
  if (g.payout === '6:5') out.push('6:5');
  if (g.csm) out.push('CSM');
  if (g.midShoeEntry === 'no') out.push('No mid-shoe');
  return out;
}

/** A casino's badges: the warnings every one of its games carries (one good game clears a warning). */
export function casinoWarnBadges(c: Pick<Casino, 'games'>): string[] {
  const per = c.games.map((g) => warnBadges(g));
  if (per.length === 0) return [];
  return per[0]!.filter((w) => per.every((ws) => ws.includes(w)));
}

/**
 * "DD pit 3: 2D H17 · cut 0.75", or the summary alone without a label. Wave M:
 * a variant name joins the label. Wave L: a variant game's preset leads the
 * summary ("Free Bet · 6D H17"), unless the name already says it.
 */
export function labelledSummary(g: CasinoGame): string {
  // One name when either contains the other ("21st Century" / "21st Century Blackjack").
  const l = g.label ?? '';
  const v = g.variantName ?? '';
  const name = !v ? l : !l ? v : v.toLowerCase().includes(l.toLowerCase()) ? v : l.toLowerCase().includes(v.toLowerCase()) ? l : `${l}, ${v}`;
  const preset = g.variant ? PRESET_LABEL[g.variant] : null;
  const summary = preset && !name.toLowerCase().includes(preset.toLowerCase()) ? `${preset} · ${gameSummary(g)}` : gameSummary(g);
  return name ? `${name}: ${summary}` : summary;
}

/** Wave M: "Card room" for a California card room, else null. */
export function kindBadge(c: Pick<Casino, 'kind'>): string | null {
  return c.kind === 'cardroom' ? 'Card room' : null;
}

/** The first line of a casino's notes, for its row; null when there are none. */
export function notesFirstLine(notes: string): string | null {
  const line = notes.split(/\r?\n/).find((l) => l.trim() !== '');
  return line ? line.trim() : null;
}

// ---------------------------------------------------------------- distance

const EARTH_MILES = 3958.8;

/**
 * Great-circle distance in miles: the haversine formula (a definition of the
 * sphere's geometry), on the mean Earth radius. Straight-line, not road miles.
 */
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "4.2 mi" under ten miles, "37 mi" beyond. */
export function milesText(mi: number): string {
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

/** "25 min drive", "1 h 10 min drive". */
export function driveText(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min drive`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''} drive`;
}

export type Distance = { kind: 'miles'; miles: number; text: string; logged?: true } | { kind: 'drive'; minutes: number; text: string };

/**
 * How far a casino is, as a row shows it: live miles when the phone's position
 * is known and the casino has a saved spot, else (Wave M) the logged miles
 * from home, else the logged drive time, else nothing.
 */
export function distanceOf(c: Pick<Casino, 'location' | 'driveMinutes' | 'miles'>, here: GeoPoint | null): Distance | null {
  if (here && c.location) {
    const miles = haversineMiles(here, c.location);
    return { kind: 'miles', miles, text: milesText(miles) };
  }
  if (c.miles !== null && c.miles !== undefined) {
    return { kind: 'miles', miles: c.miles, text: `${milesText(c.miles)} from home`, logged: true };
  }
  if (c.driveMinutes !== null && c.driveMinutes !== undefined) {
    return { kind: 'drive', minutes: c.driveMinutes, text: driveText(c.driveMinutes) };
  }
  return null;
}

/**
 * EV per hour of the whole trip: the session's expected win spread over the
 * session plus the drive there and back,
 * (EV/h x session h) / (session h + 2 x drive minutes / 60).
 * Null without a drive time.
 *
 * Review N3: a game that loses is NOT shrunk toward zero by a long drive (the
 * formula would rank a far losing game above a near one); it stays at its EV
 * per hour, so losing games sort among themselves by how much they lose.
 */
/**
 * Wave M: one-way drive minutes for EV per trip hour -- the logged drive time,
 * else the logged miles at ASSUMED_MPH, else null.
 */
export function tripMinutesOf(c: Pick<Casino, 'driveMinutes' | 'miles'>): number | null {
  if (c.driveMinutes !== null && c.driveMinutes !== undefined) return c.driveMinutes;
  if (c.miles !== null && c.miles !== undefined) return (c.miles / ASSUMED_MPH) * 60;
  return null;
}

export function evPerTripHour(evHour: number, sessionHours: number, driveMinutes: number | null | undefined): number | null {
  if (driveMinutes === null || driveMinutes === undefined || !(sessionHours > 0)) return null;
  if (evHour <= 0) return evHour;
  return (evHour * sessionHours) / (sessionHours + (2 * driveMinutes) / 60);
}

/**
 * Review N3: live miles and drive minutes on one scale, for the Distance
 * sort -- minutes, a mile taken at ASSUMED_MPH. The miles are straight-line
 * and the minutes are by road, so this is a rough common scale for ordering,
 * never shown.
 */
export const ASSUMED_MPH = 40;
export function distanceMinutes(d: Distance): number {
  return d.kind === 'drive' ? d.minutes : (d.miles / ASSUMED_MPH) * 60;
}

// ---------------------------------------------------------------- formatting

function amount(n: number): string {
  const abs = Math.abs(n);
  const cents = Math.round(abs * 100) % 100 !== 0;
  return abs.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}

/** "$1,250" (a real minus when negative). */
export function money(n: number): string {
  return `${n < 0 ? MINUS : ''}$${amount(n)}`;
}

/** "+$450", "−$200", "$0". */
export function signedMoney(n: number): string {
  if (n > 0) return `+$${amount(n)}`;
  if (n < 0) return `${MINUS}$${amount(n)}`;
  return '$0';
}

/** "3.5 h". */
export function hoursText(h: number): string {
  return `${h.toFixed(1)} h`;
}

/** Running clock: "0:05:09", "12:00:00". */
export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Parse a money field: blank is null, anything else must be a non-negative
 * number ("1,200" and "$50" are accepted). NaN means "not a number": the
 * form says so instead of saving it.
 */
export function parseMoney(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

/** Whether the backup nudge should show: data exists and no export in 30 days. */
export function exportIsDue(log: CasinoLog, now: number, hasData: boolean): boolean {
  if (!hasData) return false;
  if (!log.lastExportAt) return true;
  return now - Date.parse(log.lastExportAt) > 30 * DAY_MS;
}
