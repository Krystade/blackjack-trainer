import { describe, it, expect } from 'vitest';
import type { Rank } from '../engine/cards';
import { hiLoTag } from '../engine/count';
import { EASY_FIRST_RUN, EASY_INTERVAL_MS, hiLoLabel, hiLoShown, offersEasyFirstRun } from './hiLoAid';
import { DEFAULT_SETTINGS } from '../store/types';

const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const MINUS = '\u2212';

describe('G1: Hi-Lo values', () => {
  it('labels every rank with its Hi-Lo tag, with a real minus', () => {
    const want: Record<string, string> = { '1': '+1', '0': '0', '-1': `${MINUS}1` };
    for (const rank of RANKS) expect(hiLoLabel({ rank })).toBe(want[String(hiLoTag(rank))]);
    expect(RANKS.map((rank) => hiLoLabel({ rank })).join(' ')).toBe(
      `+1 +1 +1 +1 +1 0 0 0 ${MINUS}1 ${MINUS}1 ${MINUS}1 ${MINUS}1 ${MINUS}1`,
    );
  });

  it('is off by default, and never drawn eyes-free', () => {
    expect(hiLoShown(DEFAULT_SETTINGS.drill, false)).toBe(false);
    expect(hiLoShown({ countShowHiLo: true }, false)).toBe(true);
    expect(hiLoShown({ countShowHiLo: true }, true)).toBe(false);
  });
});

describe('G1: Easy first run', () => {
  const run = { date: '2026-10-17T00:00:00Z', cards: 52, intervalMs: 800, correct: false };
  const timed = { date: '2026-10-17T00:00:00Z', cards: 52, elapsedMs: 40000, secondsPerDeck: 40, tier: 'learning' as const, correct: true };

  it('is offered with no count history, and gone after one run of any kind', () => {
    expect(offersEasyFirstRun({ countDrill: { history: [] }, timedCount: { history: [] } })).toBe(true);
    expect(offersEasyFirstRun({ countDrill: { history: [run] }, timedCount: { history: [] } })).toBe(false);
    expect(offersEasyFirstRun({ countDrill: { history: [] }, timedCount: { history: [timed] } })).toBe(false);
  });

  it('is one deck, slow, values shown, and nothing that makes a run harder', () => {
    expect(EASY_FIRST_RUN).toMatchObject({ countLengthCards: 52, countGroup: 1, countShowHiLo: true, countManual: false });
    expect(EASY_INTERVAL_MS).toBeGreaterThan(DEFAULT_SETTINGS.drill.countIntervalMs * 2);
    expect(EASY_INTERVAL_MS).toBeLessThanOrEqual(3000);
    expect(EASY_FIRST_RUN).toMatchObject({
      distractionFreq: 'off',
      countCheckpoints: 'off',
      countBias: 'none',
      messyCards: false,
      pacePressure: false,
      countTableMode: false,
    });
  });
});
