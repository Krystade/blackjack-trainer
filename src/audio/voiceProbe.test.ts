import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendProbe, readProbeLog, clearProbeLog, formatProbeLog } from './voiceProbe';

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
