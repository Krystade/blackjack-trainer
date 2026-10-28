import type { Casino, CasinoGame, CasinoLog, GeoPoint } from '../store/casinoLog';
import { DEFAULT_ROUNDS_PER_HOUR } from '../store/casinoLog';
import { BET_NAMES, payTableOf } from '../engine/sideBets/payTables';
import { PRESET_LABEL } from '../engine/variants/rules';
import {
  distanceMinutes,
  distanceOf,
  kindBadge,
  labelledSummary,
  lastVisitKey,
  money,
  sessionsAt,
  sortCasinos,
  standing,
  type Standing,
} from './casinoFigures';

/**
 * WAVE W: THE CASINO DIRECTORY. Jack: the Casino tab "should also be a
 * repository of all the casinos I put in there and their rules and
 * everything". The pure half: what a search matches, the orders the list
 * can take, and every rule of a game as a line to read (unknowns said as
 * unknown, never guessed; the "?" the owner marked kept beside its value).
 */

export type DirectorySort = 'standing' | 'name' | 'distance' | 'ev';
export const DIRECTORY_SORTS: readonly DirectorySort[] = ['standing', 'name', 'distance', 'ev'];

const STANDING_WORD: Record<Standing, string> = { playable: 'playable', avoid: 'avoid', burned: 'burned' };

/** A side bet as one phrase: "Lucky Ladies (Table A) $5-$100". */
export function sideBetText(s: NonNullable<CasinoGame['sideBets']>[number]): string {
  const table = payTableOf(s.bet, s.payTable);
  const limits = limitsText(s.minBet, s.maxBet);
  return [BET_NAMES[s.bet], table ? `(${table.name})` : '', limits].filter(Boolean).join(' ');
}

/** "$25-$500", "$25 min", "$500 max", or '' when neither is known. */
export function limitsText(min: number | null | undefined, max: number | null | undefined): string {
  const lo = typeof min === 'number' ? money(min) : null;
  const hi = typeof max === 'number' ? money(max) : null;
  if (lo && hi) return `${lo}–${hi}`;
  if (lo) return `${lo} min`;
  if (hi) return `${hi} max`;
  return '';
}

/**
 * A game's at-a-glance extras for the directory row, after its rules line:
 * limits, mid-shoe entry, a CSM, side bets. Only what is known.
 */
export function gameExtras(g: CasinoGame): string[] {
  const out: string[] = [];
  const limits = limitsText(g.minBet, g.maxBet);
  if (limits) out.push(limits);
  if (g.midShoeEntry === 'allowed') out.push('Mid-shoe OK');
  if (g.midShoeEntry === 'no') out.push('No mid-shoe');
  if (g.csm) out.push('CSM');
  if (g.sideBets && g.sideBets.length > 0) out.push(`Side: ${g.sideBets.map((s) => BET_NAMES[s.bet]).join(', ')}`);
  return out;
}

/** Everything a search looks through for one casino, lower-cased. */
export function haystack(c: Casino, now: number): string {
  const parts: string[] = [c.name, c.area ?? '', c.notes, kindBadge(c) ?? 'casino', STANDING_WORD[standing(c, now).group]];
  for (const g of c.games) {
    parts.push(labelledSummary(g), g.label ?? '', g.variantName ?? '', g.notes ?? '', ...gameExtras(g));
    if (g.variant) parts.push(PRESET_LABEL[g.variant]);
    for (const s of g.sideBets ?? []) parts.push(sideBetText(s));
  }
  return parts.join(' \n ').toLocaleLowerCase();
}

/** Every word of the query somewhere in the casino (name, area, notes, any game's rules or side bets). */
export function matchesQuery(c: Casino, query: string, now: number): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = haystack(c, now);
  return words.every((w) => hay.includes(w));
}

/**
 * The directory's orders. Standing: playable, avoid, burned, the latest
 * visit first within each (the list as it always was). Name: A to Z.
 * Distance: nearest first by live miles, logged miles or drive time on one
 * scale, then the rest by name. EV: by the best figure among the casino's
 * games (`bestEv`, null = none yet), then the rest by name.
 */
export function sortDirectory(
  log: CasinoLog,
  casinos: readonly Casino[],
  sort: DirectorySort,
  now: number,
  here: GeoPoint | null,
  bestEv: (c: Casino) => number | null = () => null,
): Casino[] {
  const byName = (a: Casino, b: Casino) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  const ids = new Set(casinos.map((c) => c.id));
  if (sort === 'standing') return sortCasinos(log, now).filter((c) => ids.has(c.id));
  const list = [...casinos];
  if (sort === 'name') return list.sort(byName);
  const key = (c: Casino): number | null => {
    if (sort === 'distance') {
      const d = distanceOf(c, here);
      return d ? distanceMinutes(d) : null;
    }
    const ev = bestEv(c);
    return ev === null ? null : -ev;
  };
  return list.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== null && kb !== null && ka !== kb) return ka - kb;
    if (ka !== null && kb === null) return -1;
    if (ka === null && kb !== null) return 1;
    return byName(a, b);
  });
}

export interface RuleLine {
  /** The field name in `CasinoGame` (the `unsure` list's names). */
  field: string;
  label: string;
  /** What is known, or null for not logged. */
  value: string | null;
  /** The owner marked the value with "?". */
  unsure: boolean;
}

const yesNo = (b: boolean | null | undefined, yes = 'Yes', no = 'No') => (b === true ? yes : b === false ? no : null);

/**
 * Every rule of a game, in the editor's order, as label and value. A rule
 * not logged has a null value (shown as "Not logged"); the penetration
 * beside the cut is worked out from the decks and the cut, when both are
 * known.
 */
export function ruleLines(g: CasinoGame): RuleLine[] {
  const unsure = new Set(g.unsure ?? []);
  const line = (field: string, label: string, value: string | null): RuleLine => ({ field, label, value, unsure: unsure.has(field) });
  const cut = typeof g.cutDecksLeft === 'number' ? g.cutDecksLeft : null;
  const pen = cut !== null && g.decks ? Math.round(((g.decks - cut) / g.decks) * 100) : null;
  const cutText = cut === null ? null : `${cut} deck${cut === 1 ? '' : 's'} left${pen !== null && pen > 0 && pen < 100 ? ` (${pen}% dealt)` : ''}`;
  const rph = typeof g.roundsPerHour === 'number' ? String(g.roundsPerHour) : `${DEFAULT_ROUNDS_PER_HOUR} (default)`;
  const fee =
    typeof g.commissionPer100 === 'number' ? (g.commissionPer100 === 0 ? 'None' : `$${g.commissionPer100} per $100`) : null;
  return [
    line('variant', 'Game', g.variant ? PRESET_LABEL[g.variant] : 'Standard blackjack'),
    ...(g.variantName ? [line('variantName', 'House name', g.variantName)] : []),
    line('decks', 'Decks', g.decks ? String(g.decks) : null),
    line('s17', 'Dealer soft 17', yesNo(g.s17, 'Stands (S17)', 'Hits (H17)')),
    line('das', 'Double after split', yesNo(g.das)),
    line('surrender', 'Late surrender', yesNo(g.surrender)),
    line('rsa', 'Resplit aces', yesNo(g.rsa)),
    line('doubleSplitAces', 'Double split aces', yesNo(g.doubleSplitAces)),
    line('maxSplitHands', 'Split to', g.maxSplitHands ? `${g.maxSplitHands} hands` : null),
    line('doubleOn', 'Double on', g.doubleOn === 'any2' ? 'Any two cards' : g.doubleOn ? `${g.doubleOn} only` : null),
    line('payout', 'Blackjack pays', g.payout ?? null),
    line('cutDecksLeft', 'Cut card', cutText),
    line('minBet', 'Min bet', typeof g.minBet === 'number' ? money(g.minBet) : null),
    line('maxBet', 'Max bet', typeof g.maxBet === 'number' ? money(g.maxBet) : null),
    line('midShoeEntry', 'Mid-shoe entry', g.midShoeEntry === 'allowed' ? 'Allowed' : g.midShoeEntry === 'no' ? 'Not allowed' : null),
    line('csm', 'Shuffler', g.csm ? 'Continuous (CSM): no counting' : 'Hand shuffle or shoe'),
    line('roundsPerHour', 'Rounds per hour', rph),
    line('commissionPer100', 'Commission', fee),
  ];
}

/** When the casino was last played at, for the detail page; null if never. */
export function lastVisit(log: CasinoLog, c: Casino): string | null {
  return lastVisitKey(sessionsAt(log, c.id));
}

export const DIRECTORY_SORT_KEY = 'bjtrainer.casinoDirSort.v1';

/** The directory's last order on this device; Standing when unset or unreadable. */
export function readDirectorySort(): DirectorySort {
  try {
    const v = localStorage.getItem(DIRECTORY_SORT_KEY);
    return (DIRECTORY_SORTS as readonly string[]).includes(v ?? '') ? (v as DirectorySort) : 'standing';
  } catch {
    return 'standing';
  }
}

export function writeDirectorySort(v: DirectorySort): void {
  try {
    localStorage.setItem(DIRECTORY_SORT_KEY, v);
  } catch {
    /* a per-device convenience */
  }
}
