/**
 * Meta-tests for the on-device suite.
 *
 * The suite in selfTest.ts is an INSTRUMENT, and the way an instrument fails
 * is by reading green while the thing it measures is broken. Asserting that
 * it passes against a working engine proves almost nothing -- a suite of
 * `return null` would pass that too.
 *
 * So each block here breaks exactly one subject -- mistags a rank, rounds the
 * true count the wrong way, strips the deviation attribution, makes the clip
 * matcher match everything -- and requires the matching case to go RED. A
 * mutation that survives means that case is decoration and should be deleted
 * or rewritten.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pureCases, runCases, summarise, clipCoverageCases, settingsCases } from './selfTest';
import type { ClipManifest } from '../audio/clips';
import type { SelfTestStorage } from './selfTest';
import { SETTINGS_KEY } from '../store/persist';

/** The ids that went red, sorted, for comparing against an expectation. */
function failedIds(results: ReturnType<typeof runCases>): string[] {
  return results
    .filter((r) => r.outcome === 'fail')
    .map((r) => r.id)
    .sort();
}

/**
 * Reloads selfTest.ts with one engine module mutated, and returns the ids of
 * the cases that caught it. Everything the module exports stays real except
 * the named overrides, so a mutation is one wrong answer rather than a
 * module-shaped hole that would fail everything for the wrong reason.
 */
async function idsCaughtWhen(
  path: string,
  overrides: Record<string, unknown>,
): Promise<string[]> {
  vi.resetModules();
  const actual = await import(path);
  vi.doMock(path, () => ({ ...actual, ...overrides }));
  const mutated = await import('./selfTest');
  const ids = failedIds(mutated.runCases(mutated.pureCases()));
  vi.doUnmock(path);
  vi.resetModules();
  return ids;
}

describe('the suite against the engine that actually ships', () => {
  it('passes, every case, with nothing mocked', () => {
    const summary = summarise(runCases(pureCases()));
    // Printed on failure so a real engine regression names itself here rather
    // than only on the phone.
    expect(summary.failures.map((f) => `${f.id}: ${f.detail}`)).toEqual([]);
    expect(summary.failed).toBe(0);
  });

  it('is big enough to be worth running', () => {
    // Not a quality bar, a tripwire: if a refactor empties a group, the screen
    // would still say "all passed".
    const cases = pureCases();
    expect(cases.length).toBeGreaterThanOrEqual(30);
    const groups = new Set(cases.map((c) => c.group));
    expect([...groups].sort()).toEqual([
      'Basic strategy',
      'Counting',
      'Deviations',
      'Hands',
      'True count',
    ]);
  });

  it('gives every case a distinct id, so a failure can be pointed at', () => {
    const ids = pureCases().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('breaking the engine turns the right cases red', () => {
  afterEach(() => {
    vi.doUnmock('../engine/count');
    vi.doUnmock('../engine/strategy');
    vi.doUnmock('../engine/hand');
    vi.resetModules();
  });

  it('catches a mistagged rank', async () => {
    const caught = await idsCaughtWhen('../engine/count', {
      // Sevens are neutral in Hi-Lo. Tagging one +1 unbalances the system.
      hiLoTag: (rank: string) =>
        rank === '7' ? 1 : rank === 'A' || rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K' ? -1 : Number(rank) >= 2 && Number(rank) <= 6 ? 1 : 0,
    });
    expect(caught).toContain('count-tags');
    expect(caught).toContain('count-balanced');
    expect(caught).toContain('count-shoe');
  });

  it('catches a true count that rounds instead of flooring', async () => {
    const caught = await idsCaughtWhen('../engine/count', {
      trueCount: (rc: number, decks: number) => Math.round(rc / Math.max(decks, 0.5)),
    });
    // RC 9 over 5 decks is 1.8: floors to 1, rounds to 2. One of these must bite.
    expect(caught.some((id) => id.startsWith('tc-'))).toBe(true);
  });

  it('catches a true count that divides by zero', async () => {
    const caught = await idsCaughtWhen('../engine/count', {
      trueCount: (rc: number, decks: number) => Math.floor(rc / decks),
    });
    expect(caught.some((id) => id.startsWith('tc-'))).toBe(true);
  });

  it('catches a strategy chart that advises the wrong play', async () => {
    const caught = await idsCaughtWhen('../engine/strategy', {
      basicPlay: () => ({ action: 'hit', source: 'basic' }),
    });
    expect(caught.filter((id) => id.startsWith('basic-')).length).toBeGreaterThan(5);
  });

  it('catches a chart that recommends a forbidden action', async () => {
    const actual = await import('../engine/strategy');
    const caught = await idsCaughtWhen('../engine/strategy', {
      // Doubling a hand the rules will not let you double -- the fault that
      // gets the operator thrown out of a game.
      correctPlay: (cards: unknown, up: unknown, tc: number, ctx: { canDouble: boolean }) =>
        ctx.canDouble
          ? (actual.correctPlay as never as (...a: unknown[]) => unknown)(cards, up, tc, ctx)
          : { action: 'double', source: 'basic' },
    });
    expect(caught).toContain('basic-legality');
  });

  it('catches a deviation that stopped firing', async () => {
    const actual = await import('../engine/strategy');
    const caught = await idsCaughtWhen('../engine/strategy', {
      // Ignore the count entirely: pure basic strategy, which is what the app
      // would silently fall back to if the index table failed to load.
      correctPlay: (cards: unknown, up: unknown, _tc: number, ctx: unknown) =>
        (actual.basicPlay as never as (...a: unknown[]) => unknown)(cards, up, ctx),
    });
    expect(caught).toContain('dev-16v10');
    expect(caught).toContain('dev-12v3');
    expect(caught).toContain('dev-marked');
  });

  it('catches a deviation attributed to basic strategy', async () => {
    const actual = await import('../engine/strategy');
    const caught = await idsCaughtWhen('../engine/strategy', {
      // Right answer, wrong reason. The drill would tell Jack the count did
      // not matter on a hand where it did.
      correctPlay: (...args: unknown[]) => ({
        ...((actual.correctPlay as never as (...a: unknown[]) => object)(...args)),
        source: 'basic',
      }),
    });
    expect(caught).toEqual(['dev-marked']);
  });

  it('catches insurance taken at the wrong threshold', async () => {
    const caught = await idsCaughtWhen('../engine/strategy', {
      insuranceCorrect: (tc: number) => tc >= 2,
    });
    expect(caught).toContain('dev-insurance');
  });

  it('catches an ace that stays at eleven through a bust', async () => {
    const caught = await idsCaughtWhen('../engine/hand', {
      handValue: (cards: Array<{ rank: string }>) => ({
        total: cards.reduce((n, c) => n + (c.rank === 'A' ? 11 : ['10', 'J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank)), 0),
        soft: cards.some((c) => c.rank === 'A'),
      }),
    });
    expect(caught).toContain('hand-soft');
  });

  it('catches blackjack awarded to a three-card twenty-one', async () => {
    const caught = await idsCaughtWhen('../engine/hand', {
      isBlackjack: (cards: Array<{ rank: string }>) =>
        cards.reduce((n, c) => n + (c.rank === 'A' ? 11 : ['10', 'J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank)), 0) === 21,
    });
    expect(caught).toContain('hand-blackjack');
  });

  it('catches a pair test that compares rank instead of value', async () => {
    const caught = await idsCaughtWhen('../engine/hand', {
      isPair: (cards: Array<{ rank: string }>) =>
        cards.length === 2 && cards[0].rank === cards[1].rank,
    });
    expect(caught).toEqual(['hand-pairs']);
  });
});

describe('the recorded-voice cases', () => {
  // One real entry, in the manifest's real shape (text -> filename). Nine of
  // the ten spoken lines have nothing behind them, which is the point.
  const manifest: ClipManifest = { 'Correct.': 'correct.wav' };

  it('fails every line when the manifest never loaded', () => {
    const results = runCases(clipCoverageCases(null));
    expect(summarise(results).failed).toBe(results.length);
    expect(results[0].detail).toContain('fallback voice');
  });

  it('fails the lines that have no recording behind them', () => {
    // A one-entry manifest: the suite must notice the other nine lines have
    // nothing to play rather than reporting coverage.
    const summary = summarise(runCases(clipCoverageCases(manifest)));
    expect(summary.failed).toBeGreaterThan(0);
  });

  it('fails when the matcher matches a line that is not there', async () => {
    vi.resetModules();
    const actual = await import('../audio/clips');
    vi.doMock('../audio/clips', () => ({
      ...actual,
      // The mutation that would make every coverage case above pass while the
      // voice was broken.
      manifestLookup: () => ({ file: 'anything.wav' }),
      segmentForClips: () => [{ file: 'anything.wav' }],
    }));
    const mutated = await import('./selfTest');
    const ids = failedIds(mutated.runCases(mutated.clipCoverageCases(manifest)));
    vi.doUnmock('../audio/clips');
    vi.resetModules();
    expect(ids).toContain('clips-exact');
  });
});

describe('the settings cases', () => {
  const live = { audio: { outputRoute: 'playback', volume: 1 } };

  /** A storage that behaves, unless told to misbehave in one specific way. */
  /** A plain working store. Misbehaving ones belong to the device suite. */
  function fakeStore(seed: Record<string, string> = {}): SelfTestStorage {
    const map = new Map(Object.entries(seed));
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
      removeItem: (k) => {
        map.delete(k);
      },
    };
  }

  const stored = (blob: unknown) => ({ [SETTINGS_KEY]: JSON.stringify(blob) });

  it('does NOT fail a fresh install that has saved nothing yet', () => {
    // The first version of these cases did, which is the false alarm that
    // teaches an operator to stop reading the screen. Nothing saved means
    // nothing changed, and the defaults in use are correct.
    const results = runCases(settingsCases(fakeStore(), live));
    expect(summarise(results).failures.map((f) => f.id)).toEqual([]);
  });





  it('writes nothing at all, now that the storage probe has moved', () => {
    // The probe belongs to the device suite (diag/deviceChecks.ts), which is
    // where a question about THIS PHONE belongs. Two implementations of one
    // check is how they drift apart, so these cases must not write either.
    const store = fakeStore(stored({ audio: { outputRoute: 'playback' } }));
    const wrote: string[] = [];
    const watched: SelfTestStorage = {
      getItem: (k) => store.getItem(k),
      setItem: (k, v) => {
        wrote.push(k);
        store.setItem(k, v);
      },
      removeItem: (k) => {
        wrote.push(k);
        store.removeItem(k);
      },
    };
    runCases(settingsCases(watched, live));
    expect(wrote).toEqual([]);
  });

  it('fails when the stored blob lost its audio section', () => {
    const failures = summarise(
      runCases(settingsCases(fakeStore(stored({ rules: {} })), live)),
    ).failures;
    expect(failures.map((f) => f.id)).toEqual(['settings-persisted']);
    expect(failures[0].detail).toContain('voice settings were lost');
  });

  it('fails when storage disagrees with what is on screen', () => {
    // The fault that looks like the app forgetting: the control moved, the
    // write silently did not land.
    const failures = summarise(
      runCases(settingsCases(fakeStore(stored({ audio: { outputRoute: 'auto' } })), live)),
    ).failures;
    expect(failures.map((f) => f.id)).toEqual(['settings-persisted']);
    expect(failures[0].detail).toContain('"playback"');
    expect(failures[0].detail).toContain('"auto"');
  });

  it('fails when the stored blob will not parse', () => {
    const failures = summarise(
      runCases(settingsCases(fakeStore({ [SETTINGS_KEY]: '{not json' }), live)),
    ).failures;
    expect(failures.map((f) => f.id)).toEqual(['settings-persisted']);
    expect(failures[0].detail).toContain('will not parse');
  });

  it('fails when a setting cannot survive being written', () => {
    const failures = summarise(
      runCases(
        settingsCases(fakeStore(stored({ audio: { outputRoute: 'playback' } })), {
          // NaN serialises to null and comes back as a different value.
          audio: { outputRoute: 'playback', volume: NaN },
        }),
      ),
    ).failures;
    expect(failures.map((f) => f.id)).toEqual(['settings-serialisable']);
  });

  it('names which setting was lost, not merely that one was', () => {
    // A verdict of "settings do not round-trip" is not actionable at a
    // roadside. Each of these is a different way JSON loses a value.
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ audio: { volume: NaN } }, 'settings.audio.volume'],
      [{ audio: { rate: Infinity } }, 'settings.audio.rate'],
      [{ audio: { clipVoice: undefined } }, 'settings.audio.clipVoice'],
      [{ drill: { seen: new Set([1]) } }, 'settings.drill.seen'],
    ];
    for (const [blob, path] of cases) {
      const failures = summarise(
        runCases(settingsCases(fakeStore(stored({ audio: {} })), blob)),
      ).failures;
      expect(failures.map((f) => f.id)).toEqual(['settings-serialisable']);
      expect(failures[0].detail).toContain(path);
    }
  });

  it('does not fire on settings that round-trip perfectly well', () => {
    // The other half. A check that flagged every nested object would catch
    // all the cases above and be worthless.
    const fat = {
      audio: { volume: 0.8, outputRoute: 'playback', clipVoice: 'en-GB-1', enabled: true },
      drill: { pushToTalkMs: 2500, wheelMode: 'answer', shotClockMs: 0 },
      rules: { decks: 6, h17: false, surrender: 'late' },
      profiles: [{ name: 'home', bankroll: 1000 }],
    };
    const failures = summarise(
      runCases(settingsCases(fakeStore(stored({ audio: { outputRoute: 'playback' } })), fat)),
    ).failures;
    expect(failures).toEqual([]);
  });

  it('passes when storage and the screen agree', () => {
    const results = runCases(
      settingsCases(fakeStore(stored({ audio: { outputRoute: 'playback' } })), live),
    );
    expect(summarise(results).failed).toBe(0);
  });
});

describe('running the cases', () => {
  it('reports a case that throws as a failure instead of taking the screen down', () => {
    const results = runCases([
      {
        id: 'boom',
        group: 'Fake',
        label: 'throws',
        run: () => {
          throw new Error('kaboom');
        },
      },
    ]);
    expect(results[0].outcome).toBe('fail');
    expect(results[0].detail).toContain('kaboom');
  });

  it('counts passes and failures separately and keeps the failures', () => {
    const summary = summarise([
      { id: 'a', group: 'g', label: 'l', outcome: 'pass' },
      { id: 'b', group: 'g', label: 'l', outcome: 'fail', detail: 'why' },
    ]);
    expect(summary).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      failures: [{ id: 'b', group: 'g', label: 'l', outcome: 'fail', detail: 'why' }],
    });
  });

  it('leaves no detail on a passing case, so the screen stays quiet', () => {
    const results = runCases([
      { id: 'ok', group: 'g', label: 'l', run: () => null },
    ]);
    expect(results[0].detail).toBeUndefined();
  });
});

describe('a suite that cannot fail', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('would be caught by the no-mock expectation above', () => {
    // Guards the one assumption everything else rests on: that runCases
    // actually reports failures rather than swallowing them. If this ever
    // passes with a `fail` outcome missing, every green run above is a lie.
    const results = runCases([
      { id: 'always-fails', group: 'g', label: 'l', run: () => 'broken' },
    ]);
    expect(results[0].outcome).toBe('fail');
    expect(summarise(results).failed).toBe(1);
  });
});
