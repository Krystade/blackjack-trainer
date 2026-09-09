import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  recordHeard,
  readVoiceHistory,
  clearVoiceHistory,
  summariseHistory,
  formatVoiceHistory,
  MAX_ENTRIES,
} from './voiceHistory';

/**
 * The log exists so the vocabulary can grow from evidence. "Stant" was found
 * by chance -- the operator happened to glance at the screen mid-drill -- and
 * chance does not work in a car, which is where the substitutions worth
 * catching actually happen.
 *
 * So the property that matters most is that a REPEATED rejection surfaces
 * above a one-off: a substitution the engine keeps making is an alias worth
 * adding, while a stray phrase near the microphone is not.
 */

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function fakeStorage(): Map<string, string> {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    configurable: true,
    writable: true,
  });
  return map;
}

beforeEach(() => {
  fakeStorage();
});

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('recording', () => {
  it('keeps the transcript exactly as the engine returned it', () => {
    recordHeard('Stant', 'rejected', 'flashcards');
    const [entry] = readVoiceHistory();
    // Not lowercased, not normalised: the casing is part of the evidence.
    expect(entry?.heard).toBe('Stant');
    expect(entry?.verdict).toBe('rejected');
    expect(entry?.context).toBe('flashcards');
  });

  it('records what was understood as well as what was not', () => {
    recordHeard('stand', 'stand', 'flashcards');
    expect(readVoiceHistory()).toHaveLength(1);
  });

  it('ignores empty utterances rather than logging phantoms', () => {
    recordHeard('   ', 'rejected', 'table');
    expect(readVoiceHistory()).toHaveLength(0);
  });

  it('keeps the most recent entries when it hits the cap', () => {
    for (let i = 0; i < MAX_ENTRIES + 25; i++) recordHeard(`phrase ${i}`, 'rejected', 'table');
    const entries = readVoiceHistory();
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[entries.length - 1]?.heard).toBe(`phrase ${MAX_ENTRIES + 24}`);
  });

  it('clears completely, because this is a microphone recording', () => {
    recordHeard('stand', 'stand', 'table');
    clearVoiceHistory();
    expect(readVoiceHistory()).toEqual([]);
  });

  // A notebook must never interrupt someone mid-drill.
  it('never throws when storage refuses to write', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota exceeded');
        },
        removeItem: () => {},
      },
      configurable: true,
      writable: true,
    });
    expect(() => recordHeard('stand', 'stand', 'table')).not.toThrow();
  });

  it('survives a corrupted log rather than losing the app', () => {
    const map = fakeStorage();
    map.set('bjtrainer.voiceHistory.v1', 'not json at all');
    expect(readVoiceHistory()).toEqual([]);
    expect(() => recordHeard('stand', 'stand', 'table')).not.toThrow();
  });
});

describe('summarising', () => {
  /**
   * The whole point of the log. A substitution the engine keeps producing is
   * a real alias; something said once near the microphone is noise. Only the
   * count separates them, so it has to drive the order.
   */
  it('ranks repeated rejections above one-offs', () => {
    recordHeard('stant', 'rejected', 'flashcards');
    recordHeard('stant', 'rejected', 'flashcards');
    recordHeard('stant', 'rejected', 'table');
    recordHeard('what time is it', 'rejected', 'table');

    const { candidates } = summariseHistory();
    expect(candidates[0]).toEqual({ heard: 'stant', count: 3 });
    expect(candidates[1]).toEqual({ heard: 'what time is it', count: 1 });
  });

  it('groups the same word across different casings', () => {
    recordHeard('Stant', 'rejected', 'flashcards');
    recordHeard('stant', 'rejected', 'table');
    expect(summariseHistory().candidates).toEqual([{ heard: 'stant', count: 2 }]);
  });

  // The count screen labels its rejections differently; both are rejections.
  it('counts the count check\'s own rejection label too', () => {
    recordHeard('banana', 'not a command', 'count check');
    expect(summariseHistory().candidates).toEqual([{ heard: 'banana', count: 1 }]);
  });

  it('does not offer understood speech as a candidate alias', () => {
    recordHeard('stand', 'stand', 'flashcards');
    const summary = summariseHistory();
    expect(summary.matched).toBe(1);
    expect(summary.candidates).toEqual([]);
  });

  it('orders ties predictably, so the same log always reads the same', () => {
    recordHeard('zebra', 'rejected', 'table');
    recordHeard('apple', 'rejected', 'table');
    expect(summariseHistory().candidates.map((c) => c.heard)).toEqual(['apple', 'zebra']);
  });
});

describe('the pasteable report', () => {
  it('leads with the candidates rather than the raw timeline', () => {
    recordHeard('stant', 'rejected', 'flashcards');
    const out = formatVoiceHistory();
    expect(out.indexOf('candidate aliases')).toBeLessThan(out.indexOf('everything, in order'));
    expect(out).toContain('1x  "stant"');
  });

  it('says so plainly when nothing was rejected', () => {
    recordHeard('stand', 'stand', 'flashcards');
    expect(formatVoiceHistory()).toContain('(nothing was rejected)');
  });

  it('names the screen each utterance was heard on', () => {
    recordHeard('yes', 'yes', 'count check');
    expect(formatVoiceHistory()).toContain('[count check]');
  });
});
