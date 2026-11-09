import { describe, expect, it } from 'vitest';
import { ladder } from './nextStep';
import { DAY, NOW, iso, stateAt } from './ladderFixtures';
import type { RustStore } from '../../drills/rust';
import type { Stats } from '../../store/types';

// Track 3 (3B): what rust does to the ladder. Re-test rules: drills/rust.test.ts.
const ctx = (rust?: RustStore) => ({ sweepDone: true, now: NOW, ...(rust ? { rust } : {}) });

/** Every rung passing, count practised 20 days ago. */
function allPassed(): Stats {
  const s = stateAt(8);
  s.countDrill.history = s.countDrill.history.map((r) => ({ ...r, date: iso(20) }));
  return s;
}

const rusty: RustStore = {
  version: 1,
  rungs: { count: { step: 0, provenAt: NOW - 20 * DAY, retest: { from: NOW - 6 * DAY, baseline: { n: 0, right: 0 } } } },
};
const needsWork: RustStore = {
  version: 1,
  rungs: {
    count: {
      step: 0,
      provenAt: NOW - 40 * DAY,
      needsWork: true,
      retest: { from: NOW, baseline: { n: 0, right: 0 } },
      last: { at: NOW, passed: false, step: 0, n: 5, right: 2 },
    },
  },
};

describe('ladder with rust (3B)', () => {
  it('a rusty rung stays passed, and its re-test is the step', () => {
    const l = ladder(allPassed(), ctx(rusty));
    const count = l.rungs.find((r) => r.id === 'count')!;
    expect(count).toMatchObject({ passed: true, rust: 'rusty', progress: 'Re-test due' });
    expect(l.current).toBeNull();
    expect(l.step).toMatchObject({ card: 'retest', kind: 'count', title: 'Re-test: Running count at table pace' });
    expect(l.step.why).toMatch(/^Passed 20 days ago/);
    expect(l.rust).toBe(rusty);
  });

  it('a missed re-test un-passes the rung: it is current, with a re-test card', () => {
    const l = ladder(allPassed(), ctx(needsWork));
    const count = l.rungs.find((r) => r.id === 'count')!;
    expect(count).toMatchObject({ passed: false, rust: 'needsWork', progress: 'Re-test: 0/5 table-pace runs' });
    expect(l.current).toBe(2);
    expect(l.step).toMatchObject({ card: 'retest', kind: 'count' });
    expect(l.step.why).toMatch(/^Missed its re-test: 2 of 5\./);
  });

  it('an earlier unpassed rung comes before a later rusty one', () => {
    const s = allPassed();
    s.cellStats = {};
    const l = ladder(s, ctx(rusty));
    expect(l.current).toBe(0);
    expect(l.step.card).toBe('rung');
  });

  it('a rusty rung comes before a later unpassed one', () => {
    const s = allPassed();
    s.sessions = [];
    const l = ladder(s, ctx(rusty));
    expect(l.current).toBe(6);
    expect(l.step).toMatchObject({ card: 'retest', kind: 'count' });
  });

  it('a rung its own rule fails is not rusty, but a missed re-test still shows', () => {
    const s = allPassed();
    s.countDrill.history = [];
    expect(ladder(s, ctx(rusty)).rungs[2]).not.toHaveProperty('rust');
    expect(ladder(s, ctx(rusty)).step.card).toBe('rung');
    const l = ladder(s, ctx(needsWork));
    expect(l.rungs[2]).toMatchObject({ passed: false, rust: 'needsWork' });
    expect(l.step).toMatchObject({ card: 'retest', kind: 'count' });
  });

  it('no rust store: the ladder is as before', () => {
    const l = ladder(allPassed(), ctx());
    expect(l.step.card).toBe('stale');
    expect(l.rungs.some((r) => r.rust)).toBe(false);
  });
});
