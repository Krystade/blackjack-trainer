import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearFieldTestDraft,
  readFieldTestDraft,
  writeFieldTestDraft,
} from './fieldTestDraft';

const KEY = 'bjtrainer.fieldTestDraft.v1';

function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const store: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = store;
  return map;
}

describe('the note still in the box', () => {
  beforeEach(() => {
    installStorage();
  });

  it('survives the page it was typed on', () => {
    writeFieldTestDraft({ step: 'route-2', condition: 'freeway', run: 'r1', text: 'lane change mid-line' });
    expect(readFieldTestDraft()).toEqual({
      step: 'route-2',
      condition: 'freeway',
      run: 'r1',
      text: 'lane change mid-line',
    });
  });

  /**
   * The step travels with the text. A condition change at the gate snaps the
   * pointer, so the run can resume somewhere else entirely -- and a note
   * belongs to the step it was written on.
   */
  it('says which step and condition it belongs to', () => {
    writeFieldTestDraft({ step: 'wheel-gap', condition: 'car', run: 'r2', text: 'radio took the press' });
    const back = readFieldTestDraft()!;
    expect(back.step).toBe('wheel-gap');
    expect(back.condition).toBe('car');
    expect(back.run).toBe('r2');
  });

  it('is gone once the note has been written', () => {
    writeFieldTestDraft({ step: 'route-1', condition: 'car', run: 'r', text: 'something' });
    clearFieldTestDraft();
    expect(readFieldTestDraft()).toBeUndefined();
  });

  /**
   * An emptied box is not a draft. The screen writes on every keystroke, so
   * backspacing to nothing writes the empty string -- and restoring that
   * would put a note row of whitespace into the log.
   */
  it('is not kept when the box is emptied', () => {
    const map = installStorage();
    writeFieldTestDraft({ step: 'route-1', condition: 'car', run: 'r', text: 'typo' });
    writeFieldTestDraft({ step: 'route-1', condition: 'car', run: 'r', text: '' });
    expect(map.has(KEY)).toBe(false);
    writeFieldTestDraft({ step: 'route-1', condition: 'car', run: 'r', text: '   ' });
    expect(readFieldTestDraft()).toBeUndefined();
  });

  it('ignores anything in storage that is not a draft', () => {
    const map = installStorage();
    for (const junk of [
      '',
      'not json',
      '{}',
      '[]',
      '{"step":"route-1"}',
      'null',
      // THE SHAPE THE FIELD CHECKS EXIST FOR: a text that reads fine beside a
      // step that does not. Every case above is caught by `text` alone -- a
      // missing `text` throws inside the try -- so without this one the step
      // and condition checks could be deleted and this test would still pass,
      // and a number would be written into a `note` row as the step it is
      // filed against.
      '{"step":1,"condition":"car","run":"r","text":"hi"}',
      '{"step":"route-1","condition":false,"run":"r","text":"hi"}',
    ]) {
      map.set(KEY, junk);
      expect(readFieldTestDraft(), junk).toBeUndefined();
    }
  });

  /**
   * TRIMMED TO DECIDE WHETHER IT IS A DRAFT, RETURNED AS TYPED. The operator
   * stopped in the middle of a sentence; the space they stopped after is part
   * of what they wrote, and the box has to come back looking like the box
   * they left.
   */
  it('gives the text back exactly as it was typed', () => {
    writeFieldTestDraft({ step: 'route-1', condition: 'car', run: 'r', text: '  the gap after ' });
    expect(readFieldTestDraft()?.text).toBe('  the gap after ');
  });

  /**
   * A draft left by the build that shipped before the run id existed is still
   * a note. Read as belonging to no run, which is exactly what makes the box
   * refuse to open holding it.
   */
  it('reads a draft from before the run id as belonging to no run', () => {
    const map = installStorage();
    map.set(KEY, '{"step":"route-1","condition":"car","text":"from the old build"}');
    expect(readFieldTestDraft()).toEqual({
      step: 'route-1',
      condition: 'car',
      run: '',
      text: 'from the old build',
    });
  });

  it('does not throw when there is no storage at all', () => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    expect(() => writeFieldTestDraft({ step: 'a', condition: 'b', run: 'r', text: 'c' })).not.toThrow();
    expect(readFieldTestDraft()).toBeUndefined();
    expect(() => clearFieldTestDraft()).not.toThrow();
  });

  /**
   * A full or blocked store is not a reason to drop the keystroke: the box
   * still has the text and the exit still writes the row.
   */
  it('does not throw when the store refuses the write', () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      length: 0,
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {
        throw new Error('nope');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => writeFieldTestDraft({ step: 'a', condition: 'b', run: 'r', text: 'c' })).not.toThrow();
    expect(() => writeFieldTestDraft({ step: 'a', condition: 'b', run: 'r', text: '' })).not.toThrow();
    expect(() => clearFieldTestDraft()).not.toThrow();
  });
});
