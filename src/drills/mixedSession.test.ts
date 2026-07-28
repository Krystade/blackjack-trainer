import { describe, it, expect } from 'vitest';
import { pickMixedType, DEFAULT_MIX_RATIO } from './mixedSession';

describe('mixedSession interleave schedule (R4)', () => {
  it('is deterministic: same (seed, index, ratio) always yields the same type', () => {
    for (let i = 0; i < 50; i++) {
      expect(pickMixedType(12345, i)).toBe(pickMixedType(12345, i));
    }
  });

  it('is balanced ~50/50 by default over many positions', () => {
    let flash = 0;
    const n = 10_000;
    for (let i = 0; i < n; i++) {
      if (pickMixedType(999, i) === 'flash') flash++;
    }
    const ratio = flash / n;
    expect(Math.abs(ratio - DEFAULT_MIX_RATIO)).toBeLessThan(0.05);
  });

  it('produces BOTH types (not blocked, not single-type) across a session', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(pickMixedType(420_000_000, i));
    expect(seen.has('flash')).toBe(true);
    expect(seen.has('quiz')).toBe(true);
  });

  it('allows consecutive same-type runs (true random interleave, NOT rigid A-B-A alternation)', () => {
    // A rigid alternation would never repeat a type; the interleaving
    // prescription requires that it CAN. Prove at least one same-type
    // back-to-back pair exists in a representative sequence.
    let sawRepeat = false;
    for (let i = 1; i < 40; i++) {
      if (pickMixedType(2024, i) === pickMixedType(2024, i - 1)) {
        sawRepeat = true;
        break;
      }
    }
    expect(sawRepeat).toBe(true);
  });

  it('ratio param skews the blend (ratio=1 => all flash, ratio=0 => all quiz)', () => {
    for (let i = 0; i < 30; i++) {
      expect(pickMixedType(7, i, 1)).toBe('flash');
      expect(pickMixedType(7, i, 0)).toBe('quiz');
    }
  });

  it('different seeds give different sequences (sessions vary)', () => {
    const a = Array.from({ length: 24 }, (_, i) => pickMixedType(111, i)).join('');
    const b = Array.from({ length: 24 }, (_, i) => pickMixedType(222, i)).join('');
    expect(a).not.toBe(b);
  });

  it('the pinned e2e seed (Math.random=0.42 => 420000000) shows both types within the first 6 positions', () => {
    // Locks the exact schedule the mixed-mode e2e relies on: quiz,quiz,quiz,
    // flash,flash,flash,... so answering 6 items deterministically grades
    // both a quiz-type and a flashcard-type item.
    const seq = Array.from({ length: 6 }, (_, i) => pickMixedType(420_000_000, i));
    expect(seq).toEqual(['quiz', 'quiz', 'quiz', 'flash', 'flash', 'flash']);
  });
});
