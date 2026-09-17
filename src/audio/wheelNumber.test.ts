import { describe, it, expect } from 'vitest';
import { createWheelNumberEntry, READBACK_MS, COMMIT_MS } from './wheelNumber';

/**
 * A fake clock, because every property worth testing here is a property about
 * TIME: what happens after 0.9s of quiet, what happens after 3s of quiet, and
 * -- the one that matters most -- what happens when a press arrives before
 * either has elapsed.
 */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    schedule: (fn: () => void, ms: number) => {
      const id = seq++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    cancel: (id: number) => {
      pending.delete(id);
    },
    advance: (ms: number) => {
      const target = now + ms;
      // Fire in due order, since a later callback may schedule more work.
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of pending) {
          if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) next = entry;
        }
        if (!next) break;
        pending.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = target;
    },
    pendingCount: () => pending.size,
  };
}

function harness(clamp?: (v: number) => number) {
  const clock = fakeClock();
  const readbacks: number[] = [];
  const commits: number[] = [];
  const entry = createWheelNumberEntry<number>({
    schedule: clock.schedule,
    cancel: clock.cancel,
    readback: (v) => readbacks.push(v),
    commit: (v) => commits.push(v),
    ...(clamp ? { clamp } : {}),
  });
  return { clock, readbacks, commits, entry };
}

describe('walking a number with two buttons', () => {
  it('starts from zero, whichever direction is pressed first', () => {
    const a = harness();
    expect(a.entry.press('forward')).toBe(1);

    const b = harness();
    // Negative counts are ordinary, so back from nothing is -1 rather than a
    // floor at zero: a running count of -3 has to be reachable.
    expect(b.entry.press('back')).toBe(-1);
  });

  it('accumulates presses in both directions', () => {
    const { entry } = harness();
    entry.press('forward');
    entry.press('forward');
    entry.press('forward');
    expect(entry.press('back')).toBe(2);
  });

  it('says nothing at all until the pressing stops', () => {
    const { entry, clock, readbacks } = harness();
    entry.press('forward');
    clock.advance(READBACK_MS - 1);
    expect(readbacks).toEqual([]);

    // A second press before the readback restarts it -- otherwise the app
    // talks over a finger that is still counting.
    entry.press('forward');
    clock.advance(READBACK_MS - 1);
    expect(readbacks).toEqual([]);

    clock.advance(2);
    expect(readbacks).toEqual([2]);
  });

  it('submits the proposal after a longer silence', () => {
    const { entry, clock, commits } = harness();
    entry.press('forward');
    entry.press('forward');
    clock.advance(COMMIT_MS - 1);
    expect(commits).toEqual([]);
    clock.advance(1);
    expect(commits).toEqual([2]);
  });

  /**
   * The one the whole design rests on.
   *
   * The gap between the readback and the commit is the only chance to correct
   * a wrong count, and it is taken with eyes on the road. If a press in that
   * window did not push the commit back, the drill would grade an answer the
   * operator was visibly in the middle of changing.
   */
  it('lets a correction after the readback push the submission back', () => {
    const { entry, clock, readbacks, commits } = harness();
    entry.press('forward');
    entry.press('forward');
    entry.press('forward');
    entry.press('forward');

    clock.advance(READBACK_MS);
    expect(readbacks).toEqual([4]);
    expect(commits).toEqual([]); // vacuity guard: nothing submitted yet

    // "plus four" was heard, and it should have been five.
    entry.press('forward');
    clock.advance(COMMIT_MS - 1);
    expect(commits).toEqual([]);

    clock.advance(1);
    expect(commits).toEqual([5]);
    expect(readbacks).toEqual([4, 5]);
  });

  it('forgets the proposal once it is submitted, so the next card starts clean', () => {
    const { entry, clock, commits } = harness();
    entry.press('forward');
    entry.press('forward');
    clock.advance(COMMIT_MS);
    expect(commits).toEqual([2]);
    expect(entry.value()).toBeNull();

    // A press now is the FIRST press of a new answer, not a sixth of an old one.
    expect(entry.press('forward')).toBe(1);
  });

  it('abandons everything on reset, with no late readback or submission', () => {
    const { entry, clock, readbacks, commits } = harness();
    entry.press('forward');
    entry.reset();
    expect(entry.value()).toBeNull();

    clock.advance(COMMIT_MS * 2);
    expect(readbacks).toEqual([]);
    expect(commits).toEqual([]);
    // Nothing left armed to fire into a question that has moved on.
    expect(clock.pendingCount()).toBe(0);
  });

  it('clamps on every press, so a readback can never name a refused value', () => {
    // The countdown tag: -1, 0 or +1 and nothing else.
    const { entry, clock, readbacks } = harness((v) => Math.max(-1, Math.min(1, v)));
    entry.press('forward');
    entry.press('forward');
    entry.press('forward');
    expect(entry.value()).toBe(1);

    clock.advance(READBACK_MS);
    expect(readbacks).toEqual([1]);

    // And it comes back off the ceiling on one press, rather than needing
    // three to undo three -- a clamp that stored the overshoot would feel
    // broken in exactly the moment it was being corrected.
    expect(entry.press('back')).toBe(0);
  });
});
