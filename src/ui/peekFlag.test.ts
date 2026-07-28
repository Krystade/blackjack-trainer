import { describe, it, expect } from 'vitest';
import { assistedFlag } from './peekFlag';

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
