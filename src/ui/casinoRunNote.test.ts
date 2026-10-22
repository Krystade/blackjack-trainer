import { describe, it, expect } from 'vitest';
import { statusNote } from './casinoRunNote';
import { AUTO_CAP_MS } from './casinoAutoSim';
import { emptyAccum } from '../engine/casinoSim';
import type { GameResult } from '../store/casinoGameStats';

/** Review N2: the card says a figure firms up on its own only when it will. */

const r = (over: Partial<GameResult> = {}): GameResult => ({
  key: 'k',
  computedAt: '2026-10-20T00:00:00Z',
  profileName: 'p',
  status: 'partial',
  ms: 120,
  basicRounds: 200_000,
  countRounds: 200_000,
  unit: 25,
  basic: emptyAccum(),
  methods: null,
  ...over,
});

describe('statusNote', () => {
  it('an estimate with time left firms up on its own -- unless something holds it', () => {
    expect(statusNote(r(), 'none')).toBe('An estimate from 400k rounds; it firms up on its own while Casino is open.');
    expect(statusNote(r(), 'unsaved')).toBe('An estimate from 400k rounds; it could not be saved, so it is not firmed up until there is room.');
    expect(statusNote(r(), 'failed')).toBe('An estimate from 400k rounds.');
  });

  it('one that has had its time (a run stopped by hand before Wave Q) is not promised more', () => {
    for (const status of ['partial', 'cancelled'] as const) {
      const note = statusNote(r({ status, ms: AUTO_CAP_MS }), 'none');
      expect(note, status).toBe('Stopped at the one-minute cap; the intervals say how close it got.');
    }
    expect(statusNote(r({ status: 'cancelled', ms: 5000 }), 'none')).toMatch(/firms up on its own/);
  });

  it('finished runs say where they stopped', () => {
    expect(statusNote(r({ status: 'done' }), 'none')).toMatch(/^Both targets met/);
    expect(statusNote(r({ status: 'time', ms: 3 * 60_000, capMs: 3 * 60_000 }), 'none')).toBe('Stopped at the 3-minute cap; the intervals say how close it got.');
    expect(statusNote(r({ status: 'budget' }), 'none')).toBe('Stopped at the test round budget.');
  });
});
