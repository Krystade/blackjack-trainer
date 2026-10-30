import { describe, it, expect } from 'vitest';
import { lossPer100, formatLossPer100, formatSessionLoss, LOSS_RATE_HAND_FLOOR, formatLossValue, betMissText, sessionsBetMisses, sessionsLossPer100, sessionTag, sessionsPlayAccuracy } from './sessionFigures';

const row = (extra: Record<string, unknown> = {}) => ({ date: '2026-10-17', rounds: 10, graded: 10, correct: 9, bankrollDelta: 0, ...extra });

describe('per-100 figure (B6/W12)', () => {
  it('is units lost per 100 hands, and null with no hands', () => {
    expect(lossPer100(0.75, 30)).toBeCloseTo(2.5);
    expect(lossPer100(0, 40)).toBe(0);
    expect(lossPer100(1, 0)).toBeNull();
  });
  // B2, R3 (deliberately changed): the figure prices PLAY decisions only, and
  // says so -- "lost to mistakes" read as clean above a list of bet misses.
  it('says it prices playing mistakes', () => {
    expect(formatLossPer100(2.5)).toBe('−2.50 u lost to playing mistakes per 100 hands');
    expect(formatLossPer100(0)).toBe('0 u lost to playing mistakes per 100 hands');
    expect(formatLossPer100(0.004)).toBe('Under 0.01 u lost to playing mistakes per 100 hands');
  });
  it('B2 #50: the Stats value does not repeat its label', () => {
    expect(formatLossValue(2.5)).toBe('−2.50 u per 100 hands');
    expect(formatLossValue(0)).toBe('0 u per 100 hands');
    expect(formatLossValue(0.004)).toBe('Under 0.01 u per 100 hands');
    expect(formatLossValue(2.5)).not.toMatch(/lost|mistake/);
  });
  it('B2, R3: bet misses are counted beside it, singular and plural', () => {
    expect(betMissText(0)).toBeNull();
    expect(betMissText(1)).toBe('1 bet decision off');
    expect(betMissText(4)).toBe('4 bet decisions off');
    expect(sessionsBetMisses([row({ betMisses: 3 }), row(), row({ betMisses: 1 })])).toBe(4);
  });
  it('pools sessions that recorded it, skips older rows, and keeps Hot shoe rows (skill, not luck)', () => {
    expect(sessionsLossPer100([row({ hands: 50, mistakeUnits: 1 }), row({ hands: 50, mistakeUnits: 0.5, hotShoe: true }), row()])).toBeCloseTo(1.5);
    expect(sessionsLossPer100([row(), row()])).toBeNull();
    expect(sessionsLossPer100([])).toBeNull();
  });
  it('tags Hot shoe rows', () => {
    expect(sessionTag(row({ hotShoe: true }))).toBe('Hot shoe');
    expect(sessionTag(row())).toBeNull();
  });
});

describe('C-R8: Stats play accuracy counts play decisions only', () => {
  it('reads plays/playsCorrect, falling back to the graded total for rows written before B2', () => {
    // A B2 row: 100 graded (bets, sits, checks included) but 40 plays, 20 right.
    // A pre-B2 row: no plays, so its graded total stands in (C-R7's rule).
    const rows = [
      row({ graded: 100, correct: 90, plays: 40, playsCorrect: 20 }),
      row({ graded: 10, correct: 10 }),
    ];
    expect(sessionsPlayAccuracy(rows)).toEqual({ correct: 30, plays: 50 });
  });

  it('is zero plays with no rows', () => {
    expect(sessionsPlayAccuracy([])).toEqual({ correct: 0, plays: 0 });
  });
});

describe('C-R9: a provisional row is tagged not ended', () => {
  it('tags only provisional rows', () => {
    expect(sessionTag(row({ provisional: true }))).toBe('not ended');
    expect(sessionTag(row({ provisional: true, hotShoe: true }))).toBe('Hot shoe · not ended');
    expect(sessionTag(row())).toBeNull();
  });
});

describe('formatSessionLoss (D4)', () => {
  it('leads with the raw total below the hand floor', () => {
    expect(formatSessionLoss(0.15, 3)).toBe('−0.15 u lost to playing mistakes over 3 hands');
    expect(formatSessionLoss(0.5, 1)).toBe('−0.50 u lost to playing mistakes over 1 hand');
    expect(formatSessionLoss(0, 10)).toBe('0 u lost to playing mistakes over 10 hands');
  });
  it('gives the per-100 rate at and above the floor', () => {
    expect(formatSessionLoss(1, LOSS_RATE_HAND_FLOOR)).toBe(formatLossPer100(lossPer100(1, LOSS_RATE_HAND_FLOOR)!));
    expect(formatSessionLoss(1, 200)).toBe('−0.50 u lost to playing mistakes per 100 hands');
  });
  it('says nothing with no hands', () => {
    expect(formatSessionLoss(0, 0)).toBeNull();
  });
});
