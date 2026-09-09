import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  appendProbe,
  readProbeLog,
  clearProbeLog,
  formatProbeLog,
  describeResult,
} from './voiceProbe';

/**
 * The probe exists to be READ AFTER THE FACT by someone who was driving or
 * working in another tab, so the two things that matter are that entries
 * survive, and that the summary answers the question without reading the
 * timeline.
 */

const store = new Map<string, string>();
const originalLs = (globalThis as { localStorage?: unknown }).localStorage;

function setStorage(value: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
}

beforeEach(() => {
  store.clear();
  setStorage({
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => setStorage(originalLs));

describe('probe log', () => {
  it('persists entries so they survive the session that produced them', () => {
    appendProbe('start', 'recognition started');
    appendProbe('result', 'heard="stand" -> stand (visibility=visible)');
    expect(readProbeLog().map((e) => e.kind)).toEqual(['start', 'result']);
  });

  it('caps the log rather than growing without bound', () => {
    for (let i = 0; i < 400; i++) appendProbe('note', `n${i}`);
    const log = readProbeLog();
    expect(log.length).toBe(300);
    expect(log.at(-1)!.detail).toBe('n399');
  });

  it('survives a corrupt log rather than throwing on startup', () => {
    store.set('bjtrainer.voiceProbe.v1', 'not json{');
    expect(readProbeLog()).toEqual([]);
  });

  it('swallows a storage write failure', () => {
    setStorage({
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
    });
    expect(() => appendProbe('note', 'x')).not.toThrow();
  });

  it('clears', () => {
    appendProbe('note', 'x');
    clearProbeLog();
    expect(readProbeLog()).toEqual([]);
  });
});

describe('formatProbeLog', () => {
  /**
   * The background-tab question is the one the operator cannot answer by
   * watching, so the summary must state it outright rather than leaving it to
   * be inferred from the timeline.
   */
  it('counts how many sessions ended while the tab was hidden', () => {
    appendProbe('end', 'session ended (visibility=hidden)');
    appendProbe('end', 'session ended (visibility=visible)');
    appendProbe('end', 'session ended (visibility=hidden)');
    expect(formatProbeLog()).toContain('sessions ended: 3  (while tab hidden: 2)');
  });

  it('separates what was matched from what was rejected', () => {
    appendProbe('result', 'heard="stand" -> stand (visibility=visible)');
    appendProbe('result', 'heard="banana" -> REJECTED (visibility=visible)');
    const text = formatProbeLog();
    expect(text).toContain('phrases heard: 2');
    expect(text).toContain('matched: 1');
  });

  it('surfaces distinct errors without repeating them', () => {
    appendProbe('error', 'not-allowed');
    appendProbe('error', 'not-allowed');
    appendProbe('error', 'network');
    const line = formatProbeLog().split('\n').find((l) => l.startsWith('errors:'))!;
    expect(line).toBe('errors: not-allowed, network');
  });

  it('reports auto-restarts, since a session held together by restarts is a different answer', () => {
    appendProbe('restart', 'auto-restarting after end');
    appendProbe('restart', 'auto-restarting after end');
    expect(formatProbeLog()).toContain('auto-restarts: 2');
  });

  it('says so plainly when nothing went wrong', () => {
    appendProbe('start', 'recognition started');
    expect(formatProbeLog()).toContain('errors: (none)');
  });
});

/**
 * A car microphone over road noise is where the closed vocabulary is actually
 * tested, and "REJECTED" alone cannot distinguish the engine hearing
 * something unrelated from the engine hearing the right word and ranking it
 * second. The first means the design is fine; the second means the match is
 * too narrow. These lines are what the operator reads to tell them apart.
 */
describe('describeResult', () => {
  it('records the winning transcript, its confidence, and the verdict', () => {
    const line = describeResult([{ transcript: 'stand', confidence: 0.91 }], 'visible');
    expect(line).toBe('heard="stand" conf=0.91 -> stand (visibility=visible)');
  });

  it('says confidence is unavailable rather than inventing a number', () => {
    expect(describeResult([{ transcript: 'hit' }], 'visible')).toContain('conf=n/a');
  });

  // 0 is a real value some engines report for continuous recognition, and it
  // is informative. It must not be confused with "not reported".
  it('keeps a reported confidence of zero distinct from none', () => {
    expect(describeResult([{ transcript: 'hit', confidence: 0 }], 'visible')).toContain('conf=0.00');
  });

  it('flags a rejection that a runner-up would have caught', () => {
    const line = describeResult(
      [
        { transcript: 'sand over the line', confidence: 0.3 },
        { transcript: 'stand', confidence: 0.2 },
      ],
      'visible',
    );
    expect(line).toContain('REJECTED RESCUABLE=stand');
    expect(line).toContain('alts=["stand"]');
  });

  /**
   * The safety property, restated at this layer: a runner-up is DIAGNOSTIC.
   * The verdict on the line is still the rejection, so nothing downstream can
   * read this and play a hand off rank 2.
   */
  it('still rejects when only a runner-up matched', () => {
    const line = describeResult(
      [{ transcript: 'banana' }, { transcript: 'double' }],
      'visible',
    );
    expect(line).toContain('-> REJECTED RESCUABLE=double');
    expect(line).not.toMatch(/-> double/);
  });

  it('does not claim a rescue when no alternative matched either', () => {
    const line = describeResult([{ transcript: 'banana' }, { transcript: 'orange' }], 'hidden');
    expect(line).toContain('-> REJECTED');
    expect(line).not.toContain('RESCUABLE');
  });

  it('omits the alternatives list when they add nothing', () => {
    expect(describeResult([{ transcript: 'hit' }, { transcript: 'hit' }], 'visible')).not.toContain(
      'alts=',
    );
  });

  it('survives an empty result rather than throwing at the operator', () => {
    expect(() => describeResult([], 'visible')).not.toThrow();
    expect(describeResult([], 'visible')).toContain('REJECTED');
  });
});

describe('the summary a driver reads first', () => {
  it('counts rescuable rejections separately from plain ones', () => {
    appendProbe('result', describeResult([{ transcript: 'banana' }, { transcript: 'hit' }], 'visible'));
    appendProbe('result', describeResult([{ transcript: 'orange' }], 'visible'));
    const out = formatProbeLog();
    expect(out).toContain('rejected but rescuable: 1');
    expect(out).toContain('matched: 0');
  });

  it('reports whether the engine supplied confidence at all', () => {
    appendProbe('result', describeResult([{ transcript: 'hit' }], 'visible'));
    expect(formatProbeLog()).toContain('confidence: not reported by this engine');
    clearProbeLog();
    appendProbe('result', describeResult([{ transcript: 'hit', confidence: 0.8 }], 'visible'));
    expect(formatProbeLog()).toContain('confidence: reported');
  });
});
