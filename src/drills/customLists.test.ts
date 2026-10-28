import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomSelection } from '../store/types';
import { _setStorage, exportAll, importAll, BACKED_UP_KEYS } from '../store/persist';
import { OWNED_KEYS } from '../store/crossTab';
import { onStorageFailure } from '../store/storageHealth';
import {
  CUSTOM_LISTS_KEY,
  MAX_LISTS,
  MAX_NAME,
  cleanName,
  deleteList,
  emptyLists,
  loadCustomLists,
  matchingList,
  normLists,
  normSelection,
  overwriteList,
  renameList,
  sameSelection,
  saveAs,
  saveCustomLists,
  sortedLists,
  subscribeCustomLists,
  updateCustomLists,
  type CustomListsDoc,
} from './customLists';
import { defaultSelection } from './cellSelection';

const T0 = Date.UTC(2026, 9, 26, 12);

const softDoubles: CustomSelection = {
  tiers: { 'soft-18-v-3': 'focus', 'soft-17-v-2': 'focus', 'hard-16-v-10': 'rare' },
  painted: { 'soft-18-v-3': true },
  mix: { focus: 70, regular: 20, rare: 10 },
  favourMissed: true,
};

function saved(doc: CustomListsDoc, name: string, sel: CustomSelection, id?: string): CustomListsDoc {
  const r = saveAs(doc, name, sel, T0, id);
  if (!r.ok) throw new Error(`saveAs refused ${name}: ${r.problem}`);
  return r.doc;
}

describe('a selection in one canonical shape', () => {
  it('keeps real tiers and painted marks, and reads a missing mix as the default', () => {
    const n = normSelection({ tiers: { a: 'focus', b: 'bogus', c: 'rare' }, painted: { a: true, b: 'yes' }, favourMissed: 'true' });
    expect(n).toEqual({ tiers: { a: 'focus', c: 'rare' }, painted: { a: true }, mix: { focus: 60, regular: 30, rare: 10 }, favourMissed: false });
  });

  it('reads garbage as an empty selection rather than throwing', () => {
    expect(normSelection(null).tiers).toEqual({});
    expect(normSelection('x').mix).toEqual({ focus: 60, regular: 30, rare: 10 });
  });

  it('calls two selections the same only when they deal alike', () => {
    expect(sameSelection(softDoubles, JSON.parse(JSON.stringify(softDoubles)))).toBe(true);
    expect(sameSelection(softDoubles, { ...softDoubles, tiers: { ...softDoubles.tiers, 'hard-16-v-10': 'regular' } })).toBe(false);
    expect(sameSelection(softDoubles, { ...softDoubles, tiers: { 'soft-18-v-3': 'focus', 'soft-17-v-2': 'focus' } })).toBe(false);
    expect(sameSelection(softDoubles, { ...softDoubles, mix: { focus: 60, regular: 30, rare: 10 } })).toBe(false);
    expect(sameSelection(softDoubles, { ...softDoubles, favourMissed: false })).toBe(false);
    expect(sameSelection(softDoubles, { ...softDoubles, painted: {} })).toBe(false);
    // A missing painted map and an empty one are the same thing.
    expect(sameSelection({ ...softDoubles, painted: undefined }, { ...softDoubles, painted: {} })).toBe(true);
  });
});

describe('save as, overwrite, rename, delete', () => {
  it('saves a copy under a cleaned name', () => {
    const r = saveAs(emptyLists(), '  Soft   doubles ', softDoubles, T0, 'cl-1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.list).toEqual({ id: 'cl-1', name: 'Soft doubles', selection: normSelection(softDoubles), savedAt: '2026-10-26T12:00:00.000Z' });
    // A copy: painting the working selection afterwards cannot reach the list.
    softDoubles.tiers['soft-13-v-5'] = 'focus';
    expect(r.list.selection.tiers['soft-13-v-5']).toBeUndefined();
    delete softDoubles.tiers['soft-13-v-5'];
  });

  it('refuses an empty name, a taken one (any case, with the list that has it), and a full shelf', () => {
    const doc = saved(emptyLists(), 'Soft doubles', softDoubles, 'cl-1');
    expect(saveAs(doc, '   ', softDoubles, T0)).toEqual({ ok: false, problem: 'empty' });
    const taken = saveAs(doc, 'SOFT DOUBLES', defaultSelection(), T0);
    expect(taken.ok).toBe(false);
    if (!taken.ok) {
      expect(taken.problem).toBe('taken');
      expect(taken.existing?.id).toBe('cl-1');
    }
    let full = emptyLists();
    for (let i = 0; i < MAX_LISTS; i++) full = saved(full, `List ${i}`, softDoubles, `cl-${i}`);
    expect(saveAs(full, 'One more', softDoubles, T0)).toEqual({ ok: false, problem: 'full' });
  });

  it('cuts a long name to the limit', () => {
    expect(cleanName('x'.repeat(MAX_NAME + 20))).toHaveLength(MAX_NAME);
  });

  it('overwrites one list in place: same id and name, the new selection and time', () => {
    let doc = saved(emptyLists(), 'Soft doubles', softDoubles, 'cl-1');
    doc = saved(doc, 'Pairs', defaultSelection(), 'cl-2');
    const next = overwriteList(doc, 'cl-1', defaultSelection(), T0 + 60_000);
    expect(next.lists[0]).toMatchObject({ id: 'cl-1', name: 'Soft doubles', savedAt: '2026-10-26T12:01:00.000Z' });
    expect(sameSelection(next.lists[0]!.selection, defaultSelection())).toBe(true);
    expect(next.lists[1]).toEqual(doc.lists[1]);
  });

  it('renames, refusing a name another list has but allowing a change of case', () => {
    let doc = saved(emptyLists(), 'Soft doubles', softDoubles, 'cl-1');
    doc = saved(doc, 'Pairs', defaultSelection(), 'cl-2');
    expect(renameList(doc, 'cl-1', 'pairs')).toEqual({ ok: false, problem: 'taken' });
    expect(renameList(doc, 'cl-1', ' ')).toEqual({ ok: false, problem: 'empty' });
    const r = renameList(doc, 'cl-1', 'soft DOUBLES');
    expect(r.ok && r.doc.lists[0]!.name).toBe('soft DOUBLES');
  });

  it('deletes only the one list', () => {
    let doc = saved(emptyLists(), 'Soft doubles', softDoubles, 'cl-1');
    doc = saved(doc, 'Pairs', defaultSelection(), 'cl-2');
    expect(deleteList(doc, 'cl-1').lists.map((l) => l.id)).toEqual(['cl-2']);
  });

  it('lists by name, numbers in order', () => {
    let doc = emptyLists();
    for (const n of ['b', 'List 10', 'A', 'List 2']) doc = saved(doc, n, softDoubles);
    expect(sortedLists(doc).map((l) => l.name)).toEqual(['A', 'b', 'List 2', 'List 10']);
  });
});

describe('which saved list the working selection is', () => {
  const doc = saved(saved(emptyLists(), 'Twin', softDoubles, 'cl-b'), 'Also twin', softDoubles, 'cl-a');

  it('is the one it came from while it still matches', () => {
    expect(matchingList(doc, softDoubles, 'cl-b')?.id).toBe('cl-b');
  });

  it('falls back to the first by name that deals alike, and to none once painted over', () => {
    expect(matchingList(doc, softDoubles)?.name).toBe('Also twin');
    expect(matchingList(doc, softDoubles, 'gone')?.name).toBe('Also twin');
    expect(matchingList(doc, { ...softDoubles, favourMissed: false }, 'cl-b')).toBeUndefined();
  });
});

describe('a stored blob is read defensively', () => {
  it('drops unreadable entries, a second use of an id or name, and anything past the cap', () => {
    const doc = normLists({
      version: 1,
      lists: [
        { id: 'a', name: 'One', selection: softDoubles, savedAt: 'x' },
        { id: 'a', name: 'Dup id', selection: softDoubles },
        { id: 'b', name: 'one', selection: softDoubles },
        { id: 'c', name: '   ', selection: softDoubles },
        { name: 'No id' },
        'junk',
        { id: 'd', name: 'Two', selection: { tiers: { x: 'nope' } } },
      ],
    });
    expect(doc.lists.map((l) => l.id)).toEqual(['a', 'd']);
    expect(doc.lists[1]!.selection.tiers).toEqual({});
    expect(normLists({ lists: Array.from({ length: MAX_LISTS + 5 }, (_, i) => ({ id: `i${i}`, name: `n${i}` })) }).lists).toHaveLength(MAX_LISTS);
    expect(normLists('nope')).toEqual(emptyLists());
  });
});

describe('storage', () => {
  let map: Map<string, string>;
  let failWrites = false;
  beforeEach(() => {
    map = new Map();
    failWrites = false;
    _setStorage({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        if (failWrites && k === CUSTOM_LISTS_KEY) throw new Error('QuotaExceededError');
        map.set(k, v);
      },
    });
  });
  afterEach(() => _setStorage(null));

  it('round-trips, and an unreadable blob loads as no lists', () => {
    const doc = saved(emptyLists(), 'Soft doubles', softDoubles, 'cl-1');
    expect(saveCustomLists(doc)).toBe(true);
    expect(loadCustomLists()).toEqual(doc);
    map.set(CUSTOM_LISTS_KEY, '{not json');
    expect(loadCustomLists()).toEqual(emptyLists());
  });

  it('applies a change to what is STORED, so a list another tab saved meanwhile survives', () => {
    // This tab read the lists while they were empty...
    const stale = loadCustomLists();
    // ...another tab saved one...
    map.set(CUSTOM_LISTS_KEY, JSON.stringify(saved(emptyLists(), 'From the other tab', softDoubles, 'cl-other')));
    // ...and this tab saves its own through the one way lists change.
    const r = updateCustomLists((doc) => {
      const s = saveAs(doc, 'Mine', defaultSelection(), T0, 'cl-mine');
      return { doc: s.ok ? s.doc : null, result: s.ok };
    });
    expect(r).toEqual({ saved: true, result: true });
    expect(loadCustomLists().lists.map((l) => l.id)).toEqual(['cl-other', 'cl-mine']);
    // And again: the other tab deletes its list, then this tab renames its own.
    map.set(CUSTOM_LISTS_KEY, JSON.stringify(deleteList(loadCustomLists(), 'cl-other')));
    updateCustomLists((doc) => {
      const s = renameList(doc, 'cl-mine', 'Mine, renamed');
      return { doc: s.ok ? s.doc : null, result: null };
    });
    expect(loadCustomLists().lists.map((l) => l.name)).toEqual(['Mine, renamed']);
    expect(stale.lists).toHaveLength(0);
  });

  it('tells subscribers in this tab after a save, and says so when the write fails', () => {
    const seen = vi.fn();
    const off = subscribeCustomLists(seen);
    saveCustomLists(saved(emptyLists(), 'A', softDoubles));
    expect(seen).toHaveBeenCalledTimes(1);
    failWrites = true;
    const failures: string[] = [];
    const offFail = onStorageFailure((f) => failures.push(f.key));
    expect(saveCustomLists(saved(emptyLists(), 'B', softDoubles))).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(failures).toContain(CUSTOM_LISTS_KEY);
    offFail();
    off();
  });

  it('is synced across tabs and carried by the Stats backup, both ways', () => {
    expect(OWNED_KEYS).toContain(CUSTOM_LISTS_KEY);
    expect(BACKED_UP_KEYS).toContain(CUSTOM_LISTS_KEY);
    const doc = saved(emptyLists(), 'Soft doubles', softDoubles, 'cl-1');
    saveCustomLists(doc);
    const backup = JSON.parse(exportAll()) as Record<string, unknown>;
    expect(backup.customLists).toEqual(doc);
    map.clear();
    expect(importAll(JSON.stringify(backup)).ok).toBe(true);
    expect(loadCustomLists()).toEqual(doc);
  });
});
