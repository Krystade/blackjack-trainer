import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _setStorage, snapshotBackedUp } from '../../store/persist';
import { liveUndo, practiceMark, readUndo, storeUndo, UNDO_FOR_MS } from './backupText';

/**
 * R1: an import can be undone only until something is practised on top of it,
 * or for 24 hours, whichever comes first; a lapsed undo is dropped.
 */
function memStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

let local: ReturnType<typeof memStore>;
beforeEach(() => {
  local = memStore();
  _setStorage(local);
  vi.stubGlobal('sessionStorage', memStore());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const AT = Date.parse('2026-10-30T18:00:00.000Z');

function imported(): void {
  local.setItem('bjtrainer.stats.v1', JSON.stringify({ version: 1, mistakes: { 'basic-error': 0 } }));
  storeUndo({ at: new Date(AT).toISOString(), snap: snapshotBackedUp(), mark: practiceMark() });
}

describe('import undo lapses (R1)', () => {
  it('is offered while nothing has been practised and under 24 hours have passed', () => {
    imported();
    expect(liveUndo(AT + 60_000)).not.toBeNull();
    expect(liveUndo(AT + UNDO_FOR_MS - 1)).not.toBeNull();
  });

  it('lapses, and is dropped, after 24 hours', () => {
    imported();
    expect(liveUndo(AT + UNDO_FOR_MS)).toBeNull();
    expect(readUndo()).toBeNull();
  });

  it('lapses, and is dropped, once an answer is recorded (stats or a review schedule)', () => {
    imported();
    local.setItem('bjtrainer.stats.v1', JSON.stringify({ version: 1, mistakes: { 'basic-error': 1 } }));
    expect(liveUndo(AT + 60_000)).toBeNull();
    expect(readUndo()).toBeNull();

    imported();
    local.setItem('bjtrainer.flashsr.v1', JSON.stringify({ 'hard-16-v-10': { box: 1 } }));
    expect(liveUndo(AT + 60_000)).toBeNull();
  });

  it('an undo saved without a mark (an older build) is not offered', () => {
    storeUndo({ at: new Date(AT).toISOString(), snap: snapshotBackedUp() });
    expect(liveUndo(AT + 1)).toBeNull();
  });
});
