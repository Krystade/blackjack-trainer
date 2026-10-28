import type { CustomSelection, SelectionTier, Settings } from '../store/types';
import { getStorage } from '../store/persist';
import { reportStorageFailure, shrinkDiagnostics } from '../store/storageHealth';
import { subscribeToExternalWrites } from '../store/crossTab';
import { defaultSelection, mixShare, TIERS } from './cellSelection';

/**
 * WAVE W: SAVED CUSTOM LISTS. Jack: "I'd like to be able to save a custom
 * weight list for the flashcard and mastery custom test."
 *
 * The Custom deck (`settings.drill.custom`) is ONE working selection: the
 * tiers painted on the chart, the session mix and Favour missed. A saved list
 * is a named copy of one, kept beside it; loading a list copies it back into
 * the working selection, which is what the drills deal from. So nothing about
 * how a drill draws changes, and a list is never edited by painting -- only
 * by an explicit Overwrite.
 *
 * ITS OWN KEY, additive: settings are untouched but for an optional
 * `drill.customListId` naming the list the working selection was loaded from
 * or saved as. In the Stats backup (persist.ts EXTRA_KEYS).
 *
 * CROSS-TAB SAFE BY CONSTRUCTION. Every change goes through `updateCustomLists`,
 * which re-reads the stored blob, applies the change to THAT and writes it --
 * so a tab holding an old copy cannot save it back over a list another tab
 * added. The screens re-read on `subscribeCustomLists` (this tab's writes and
 * other tabs' storage events).
 */

export const CUSTOM_LISTS_KEY = 'bjtrainer.customLists.v1';
/** Enough for every scope-and-theme combination anyone would keep; a backstop on the blob's size. */
export const MAX_LISTS = 50;
export const MAX_NAME = 40;

export interface SavedCustomList {
  id: string;
  name: string;
  selection: CustomSelection;
  /** ISO time of the last Save as / Overwrite. */
  savedAt: string;
}

export interface CustomListsDoc {
  version: 1;
  lists: SavedCustomList[];
}

export function emptyLists(): CustomListsDoc {
  return { version: 1, lists: [] };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isTier = (t: unknown): t is SelectionTier => (TIERS as readonly unknown[]).includes(t);

/**
 * A selection in one canonical shape: only real tiers, only `true` painted
 * marks, every mix share a number, Favour missed a boolean. Stored data is
 * read through this, so a hand-edited backup cannot take the editor down, and
 * two selections that deal alike compare equal.
 */
export function normSelection(x: unknown): CustomSelection {
  const o = isObj(x) ? x : {};
  const tiers: Record<string, SelectionTier> = {};
  if (isObj(o.tiers)) for (const [id, t] of Object.entries(o.tiers)) if (isTier(t)) tiers[id] = t;
  const painted: Record<string, true> = {};
  if (isObj(o.painted)) for (const [id, v] of Object.entries(o.painted)) if (v === true) painted[id] = true;
  const mix = isObj(o.mix) ? (o.mix as CustomSelection['mix']) : undefined;
  return {
    tiers,
    painted,
    mix: { focus: mixShare(mix, 'focus'), regular: mixShare(mix, 'regular'), rare: mixShare(mix, 'rare') },
    favourMissed: o.favourMissed === true,
  };
}

/** Do two selections deal exactly alike (same tiers, marks, mix and Favour missed)? */
export function sameSelection(a: unknown, b: unknown): boolean {
  const x = normSelection(a);
  const y = normSelection(b);
  const sameMap = (p: Record<string, unknown>, q: Record<string, unknown>) => {
    const kp = Object.keys(p);
    return kp.length === Object.keys(q).length && kp.every((k) => p[k] === q[k]);
  };
  return (
    sameMap(x.tiers, y.tiers) &&
    sameMap(x.painted ?? {}, y.painted ?? {}) &&
    x.mix.focus === y.mix.focus &&
    x.mix.regular === y.mix.regular &&
    x.mix.rare === y.mix.rare &&
    x.favourMissed === y.favourMissed
  );
}

/** A name as stored: trimmed, inner runs of space collapsed, at most MAX_NAME characters. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
}

const nameKey = (name: string) => cleanName(name).toLocaleLowerCase();

export function normLists(x: unknown): CustomListsDoc {
  if (!isObj(x) || !Array.isArray(x.lists)) return emptyLists();
  const lists: SavedCustomList[] = [];
  for (const raw of x.lists) {
    if (!isObj(raw) || typeof raw.id !== 'string' || raw.id === '' || typeof raw.name !== 'string') continue;
    const name = cleanName(raw.name);
    // Two lists of one name, or one id twice: the first is kept.
    if (name === '' || lists.some((l) => l.id === raw.id || nameKey(l.name) === nameKey(name))) continue;
    lists.push({
      id: raw.id,
      name,
      selection: normSelection(raw.selection),
      savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
    });
    if (lists.length >= MAX_LISTS) break;
  }
  return { version: 1, lists };
}

export function listById(doc: CustomListsDoc, id: string | undefined): SavedCustomList | undefined {
  return id === undefined ? undefined : doc.lists.find((l) => l.id === id);
}

export function listByName(doc: CustomListsDoc, name: string): SavedCustomList | undefined {
  const key = nameKey(name);
  return doc.lists.find((l) => nameKey(l.name) === key);
}

/** The lists in the order the pickers show them: by name. */
export function sortedLists(doc: CustomListsDoc): SavedCustomList[] {
  return [...doc.lists].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

export type NameProblem = 'empty' | 'taken' | 'full';

export function makeListId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `cl-${crypto.randomUUID()}`;
  return `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Save `selection` under a new name. A name already in use is refused with
 * the list that has it, so the screen can offer Overwrite instead -- never a
 * silent replace.
 */
export function saveAs(
  doc: CustomListsDoc,
  name: string,
  selection: CustomSelection,
  now: number,
  id: string = makeListId(),
): { ok: true; doc: CustomListsDoc; list: SavedCustomList } | { ok: false; problem: NameProblem; existing?: SavedCustomList } {
  const clean = cleanName(name);
  if (clean === '') return { ok: false, problem: 'empty' };
  const existing = listByName(doc, clean);
  if (existing) return { ok: false, problem: 'taken', existing };
  if (doc.lists.length >= MAX_LISTS) return { ok: false, problem: 'full' };
  const list: SavedCustomList = { id, name: clean, selection: normSelection(selection), savedAt: new Date(now).toISOString() };
  return { ok: true, doc: { version: 1, lists: [...doc.lists, list] }, list };
}

/** Replace a list's selection with `selection`; its name stays. Unknown id: unchanged. */
export function overwriteList(doc: CustomListsDoc, id: string, selection: CustomSelection, now: number): CustomListsDoc {
  return {
    version: 1,
    lists: doc.lists.map((l) => (l.id === id ? { ...l, selection: normSelection(selection), savedAt: new Date(now).toISOString() } : l)),
  };
}

export function renameList(
  doc: CustomListsDoc,
  id: string,
  name: string,
): { ok: true; doc: CustomListsDoc } | { ok: false; problem: Exclude<NameProblem, 'full'> } {
  const clean = cleanName(name);
  if (clean === '') return { ok: false, problem: 'empty' };
  const other = listByName(doc, clean);
  if (other && other.id !== id) return { ok: false, problem: 'taken' };
  return { ok: true, doc: { version: 1, lists: doc.lists.map((l) => (l.id === id ? { ...l, name: clean } : l)) } };
}

export function deleteList(doc: CustomListsDoc, id: string): CustomListsDoc {
  return { version: 1, lists: doc.lists.filter((l) => l.id !== id) };
}

/**
 * The saved list the working selection is, if any: the one it was loaded
 * from or saved as (`preferId`) when it still matches, else the first by
 * name that deals alike.
 */
export function matchingList(doc: CustomListsDoc, selection: unknown, preferId?: string): SavedCustomList | undefined {
  const preferred = listById(doc, preferId);
  if (preferred && sameSelection(preferred.selection, selection)) return preferred;
  return sortedLists(doc).find((l) => sameSelection(l.selection, selection));
}

/**
 * The settings with `list` loaded as the working Custom selection (a copy),
 * remembered as where it came from. `asDeck`: and dealt from, as when the
 * list is picked in a drill's Deck select.
 */
export function withListLoaded(settings: Settings, list: SavedCustomList, asDeck = false): Settings {
  return {
    ...settings,
    drill: {
      ...settings.drill,
      ...(asDeck ? { deck: 'custom' as const } : {}),
      custom: normSelection(list.selection),
      customListId: list.id,
    },
  };
}

/**
 * Would loading a list throw away painting that exists nowhere else? Not for
 * a selection that was never painted (every cell Regular), one that is all
 * Off, or one that is a saved list.
 */
export function unsavedPainting(drill: Pick<Settings['drill'], 'custom' | 'customListId'>, doc: CustomListsDoc): boolean {
  if (!drill.custom) return false;
  const sel = normSelection(drill.custom);
  if (Object.keys(sel.tiers).length === 0) return false;
  if (sameSelection(sel, defaultSelection())) return false;
  return matchingList(doc, sel, drill.customListId) === undefined;
}

// ---------------------------------------------------------------- storage

type Listener = () => void;
const listeners = new Set<Listener>();

export function loadCustomLists(): CustomListsDoc {
  try {
    const raw = getStorage().getItem(CUSTOM_LISTS_KEY);
    return raw === null ? emptyLists() : normLists(JSON.parse(raw));
  } catch {
    return emptyLists();
  }
}

/** Write the lists; false (and the shell's storage toast) when the write could not land. */
export function saveCustomLists(doc: CustomListsDoc): boolean {
  const s = getStorage();
  const json = JSON.stringify(doc);
  let ok = false;
  try {
    s.setItem(CUSTOM_LISTS_KEY, json);
    ok = true;
  } catch {
    if (shrinkDiagnostics(s as Parameters<typeof shrinkDiagnostics>[0])) {
      try {
        s.setItem(CUSTOM_LISTS_KEY, json);
        ok = true;
      } catch {
        /* reported below */
      }
    }
    if (!ok) reportStorageFailure(CUSTOM_LISTS_KEY);
  }
  if (ok) for (const fn of [...listeners]) fn();
  return ok;
}

/**
 * Read the stored lists, change them, write them back: the one way they
 * change. `change` returns the new doc (or null to write nothing) and
 * whatever the caller needs back.
 */
export function updateCustomLists<R>(change: (doc: CustomListsDoc) => { doc: CustomListsDoc | null; result: R }): { saved: boolean; result: R } {
  const { doc, result } = change(loadCustomLists());
  if (doc === null) return { saved: false, result };
  return { saved: saveCustomLists(doc), result };
}

/** Called after a write in this tab, and when another tab writes the lists. */
export function subscribeCustomLists(fn: Listener): () => void {
  listeners.add(fn);
  const offExternal = subscribeToExternalWrites([CUSTOM_LISTS_KEY], () => fn());
  return () => {
    listeners.delete(fn);
    offExternal();
  };
}
