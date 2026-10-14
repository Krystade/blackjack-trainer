import { describe, it, expect } from 'vitest';
import { assistedFlag, peekReadout } from './peekFlag';

// R7 (docs/BACKLOG.md, count-peek accountability): the assisted-flag string is
// the one piece of pure logic behind RT#5's "interpretable test-mode accuracy"
// fix -- a session whose count was peek-assisted must be labelled so its
// accuracy can't be read as unassisted. Everything else (the peek-increment
// wiring) is UI, covered by e2e.
describe('assistedFlag', () => {
  it('returns null when there were no peeks (undefined = legacy session)', () => {
    expect(assistedFlag(undefined)).toBeNull();
  });

  it('returns null for exactly zero peeks (default, unassisted session)', () => {
    expect(assistedFlag(0)).toBeNull();
  });

  it('returns null for a nonsensical negative count rather than a bogus flag', () => {
    expect(assistedFlag(-2)).toBeNull();
  });

  it('uses the singular "peek" for one peek', () => {
    expect(assistedFlag(1)).toBe('assisted — used 1 peek');
  });

  it('uses the plural "peeks" for more than one', () => {
    expect(assistedFlag(3)).toBe('assisted — used 3 peeks');
  });
});

describe('peekReadout (#41)', () => {
  it('reads RC, the exact TC to one decimal, and decks to two', () => {
    // 5 / 3.62 = 1.381... -> +1.4
    expect(peekReadout(5, 3.62).text).toBe('RC +5 · TC +1.4 · 3.62 decks left');
  });

  it('splits into the two lines the button draws', () => {
    const r = peekReadout(5, 3.62);
    expect(r.counts).toBe('RC +5 · TC +1.4');
    expect(r.depth).toBe('3.62 decks left');
  });

  it('divides by the exact depth, not a half-deck estimate', () => {
    // 4 / 2.25 = 1.78 -> +1.8; a half-deck estimate (2.0 or 2.5) gives 2.0 or 1.6.
    expect(peekReadout(4, 117 / 52).counts).toBe('RC +4 · TC +1.8');
    expect(peekReadout(4, 117 / 52).depth).toBe('2.25 decks left');
  });

  it('signs negatives and leaves zero unsigned', () => {
    expect(peekReadout(-7, 2.5).counts).toBe('RC -7 · TC -2.8');
    expect(peekReadout(0, 6).counts).toBe('RC 0 · TC 0.0');
    // A negative zero (0 * -1) must not print "-0" / "-0.0".
    expect(peekReadout(-0, 6).counts).toBe('RC 0 · TC 0.0');
    expect(peekReadout(-1, 6).counts).toBe('RC -1 · TC -0.2');
  });

  it('survives an empty shoe without dividing by zero', () => {
    expect(peekReadout(3, 0).text).toBe('RC +3 · TC 0.0 · 0.00 decks left');
  });
});
