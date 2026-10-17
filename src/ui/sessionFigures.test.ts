import { describe, it, expect } from 'vitest';
import { lossPer100, formatLossPer100, sessionsLossPer100, sessionTag } from './sessionFigures';

const row = (extra: Record<string, unknown> = {}) => ({ date: '2026-10-17', rounds: 10, graded: 10, correct: 9, bankrollDelta: 0, ...extra });

describe('per-100 figure (B6/W12)', () => {
  it('is units lost per 100 hands, and null with no hands', () => {
    expect(lossPer100(0.75, 30)).toBeCloseTo(2.5);
    expect(lossPer100(0, 40)).toBe(0);
    expect(lossPer100(1, 0)).toBeNull();
  });
  it('reads as the spec words it', () => {
    expect(formatLossPer100(2.5)).toBe('−2.50 u lost to mistakes per 100 hands');
    expect(formatLossPer100(0)).toBe('0 u lost to mistakes per 100 hands');
    expect(formatLossPer100(0.004)).toBe('Under 0.01 u lost to mistakes per 100 hands');
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
