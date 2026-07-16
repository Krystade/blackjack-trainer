import { expect, test, describe, beforeEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  EMPTY_STATS,
  type Settings,
  type Stats,
} from './types';
import { DEFAULT_SPREAD } from '../engine/game';
import {
  _setStorage,
  loadSettings,
  saveSettings,
  loadStats,
  saveStats,
  exportAll,
  importAll,
} from './persist';
import { applyEvents } from './stats';
import type { GradedEvent } from '../engine/grade';

describe('store/persist', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    _setStorage({
      getItem: (key) => storage[key] ?? null,
      setItem: (key, value) => {
        storage[key] = value;
      },
    });
  });

  describe('settings', () => {
    test('loadSettings returns DEFAULT_SETTINGS when empty', () => {
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    });

    test('saveSettings and loadSettings round-trip', () => {
      const customSettings: Settings = {
        ...DEFAULT_SETTINGS,
        feedbackMode: 'test',
        bankrollStart: 500,
      };
      saveSettings(customSettings);
      const loaded = loadSettings();
      expect(loaded).toEqual(customSettings);
    });

    test('corrupt JSON returns DEFAULT_SETTINGS without throwing', () => {
      storage['bjtrainer.settings.v1'] = '{oops';
      expect(() => loadSettings()).not.toThrow();
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    });

    test('wrong version returns DEFAULT_SETTINGS', () => {
      storage['bjtrainer.settings.v1'] = JSON.stringify({
        version: 99,
        feedbackMode: 'test',
      });
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    });

    test('mutating a loaded settings object does not pollute the defaults', () => {
      const first = loadSettings();
      // Deep mutation of the returned object
      first.drill.flashCategory = 'pairs';
      first.spread[0]!.units = 999;
      first.bankrollStart = -1;

      // Fresh loads (and the module singletons) must be unpolluted
      const second = loadSettings();
      expect(second.drill.flashCategory).toBe('all');
      expect(second.spread[0]!.units).toBe(1);
      expect(second.bankrollStart).toBe(100);
      expect(DEFAULT_SETTINGS.drill.flashCategory).toBe('all');
      expect(DEFAULT_SETTINGS.spread[0]!.units).toBe(1);
    });

    test('partial {version:1} blob loads as complete DEFAULT_SETTINGS shape', () => {
      storage['bjtrainer.settings.v1'] = '{"version":1}';
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    });

    test('partial blob keeps its fields and defaults the rest', () => {
      storage['bjtrainer.settings.v1'] = '{"version":1,"bankrollStart":250}';
      const loaded = loadSettings();
      expect(loaded.bankrollStart).toBe(250);
      expect(loaded).toEqual({ ...DEFAULT_SETTINGS, bankrollStart: 250 });
    });

    test('partial nested drill is merged over the default drill', () => {
      storage['bjtrainer.settings.v1'] = '{"version":1,"drill":{"countGroup":3}}';
      const loaded = loadSettings();
      expect(loaded.drill.countGroup).toBe(3);
      expect(loaded.drill.flashCategory).toBe('all');
      expect(loaded.drill.countIntervalMs).toBe(800);
      expect(loaded.drill.countLengthCards).toBe(52);
    });

    test('a stored v1-drill blob without countManual/quizIndex backfills both from defaults', () => {
      // Simulates a pre-Cycle-1 stored blob: drill object present but missing
      // the new fields entirely.
      storage['bjtrainer.settings.v1'] = JSON.stringify({
        version: 1,
        drill: {
          flashCategory: 'hard',
          countGroup: 2,
          countIntervalMs: 900,
          countLengthCards: 104,
        },
      });
      const loaded = loadSettings();
      expect(loaded.drill.countManual).toBe(false);
      expect(loaded.drill.quizIndex).toBe('all');
      // Existing fields still preserved
      expect(loaded.drill.flashCategory).toBe('hard');
      expect(loaded.drill.countGroup).toBe(2);
    });
  });

  describe('stats', () => {
    test('loadStats returns EMPTY_STATS when empty', () => {
      expect(loadStats()).toEqual(EMPTY_STATS);
    });

    test('saveStats and loadStats round-trip', () => {
      const customStats: Stats = {
        ...EMPTY_STATS,
        categories: {
          hard: { right: 10, wrong: 2 },
          soft: { right: 5, wrong: 1 },
          pairs: { right: 3, wrong: 0 },
          surrender: { right: 1, wrong: 0 },
          insurance: { right: 2, wrong: 1 },
          bet: { right: 4, wrong: 0 },
          countCheck: { right: 1, wrong: 0 },
        },
      };
      saveStats(customStats);
      const loaded = loadStats();
      expect(loaded).toEqual(customStats);
    });

    test('corrupt JSON returns EMPTY_STATS without throwing', () => {
      storage['bjtrainer.stats.v1'] = '{oops';
      expect(() => loadStats()).not.toThrow();
      expect(loadStats()).toEqual(EMPTY_STATS);
    });

    test('wrong version returns EMPTY_STATS', () => {
      storage['bjtrainer.stats.v1'] = JSON.stringify({
        version: 99,
        categories: {},
      });
      expect(loadStats()).toEqual(EMPTY_STATS);
    });

    test('mutating a loaded stats object does not pollute EMPTY_STATS', () => {
      const first = loadStats();
      first.categories.hard.right = 42;
      first.mistakes['basic-error'] = 7;
      first.sessions.push({ date: 'x', rounds: 1, graded: 1, correct: 1, bankrollDelta: 0 });

      const second = loadStats();
      expect(second.categories.hard.right).toBe(0);
      expect(second.mistakes['basic-error']).toBe(0);
      expect(second.sessions).toEqual([]);
      expect(EMPTY_STATS.categories.hard.right).toBe(0);
      expect(EMPTY_STATS.mistakes['basic-error']).toBe(0);
      expect(EMPTY_STATS.sessions).toEqual([]);
    });

    test('partial {version:1} stats blob loads as complete EMPTY_STATS shape', () => {
      storage['bjtrainer.stats.v1'] = '{"version":1}';
      expect(loadStats()).toEqual(EMPTY_STATS);
    });

    test('partial stats blob keeps its sections and defaults the rest', () => {
      storage['bjtrainer.stats.v1'] =
        '{"version":1,"mistakes":{"basic-error":3},"perIndex":{"16v10":{"right":1,"wrong":2}}}';
      const loaded = loadStats();
      expect(loaded.mistakes['basic-error']).toBe(3);
      expect(loaded.mistakes.correct).toBe(0); // defaulted within merged section
      expect(loaded.perIndex['16v10']).toEqual({ right: 1, wrong: 2 });
      expect(loaded.categories).toEqual(EMPTY_STATS.categories);
      expect(loaded.countDrill).toEqual(EMPTY_STATS.countDrill);
      expect(loaded.sessions).toEqual([]);
    });
  });

  describe('missing-localStorage fallback', () => {
    test('save→load round-trips through the persistent in-memory fallback', () => {
      // Remove the injected storage; in node there is no window.localStorage,
      // so persist falls back to its module-level in-memory store.
      _setStorage(null);

      const custom: Settings = { ...DEFAULT_SETTINGS, dealSpeedMs: 1234 };
      saveSettings(custom);
      expect(loadSettings()).toEqual(custom); // NOT defaults: fallback persists

      // Re-inject for safety (beforeEach also does this for the next test)
      _setStorage({
        getItem: (key) => storage[key] ?? null,
        setItem: (key, value) => {
          storage[key] = value;
        },
      });
    });
  });

  describe('export/import', () => {
    test('exportAll returns JSON with both settings and stats', () => {
      const customSettings: Settings = {
        ...DEFAULT_SETTINGS,
        feedbackMode: 'test',
      };
      const customStats: Stats = {
        ...EMPTY_STATS,
        categories: {
          hard: { right: 5, wrong: 1 },
          soft: { right: 0, wrong: 0 },
          pairs: { right: 0, wrong: 0 },
          surrender: { right: 0, wrong: 0 },
          insurance: { right: 0, wrong: 0 },
          bet: { right: 0, wrong: 0 },
          countCheck: { right: 0, wrong: 0 },
        },
      };
      saveSettings(customSettings);
      saveStats(customStats);

      const exported = exportAll();
      const parsed = JSON.parse(exported);
      expect(parsed.settings).toEqual(customSettings);
      expect(parsed.stats).toEqual(customStats);
    });

    test('export → import round-trip', () => {
      const customSettings: Settings = {
        ...DEFAULT_SETTINGS,
        countCheckEvery: 10,
      };
      const customStats: Stats = {
        ...EMPTY_STATS,
        categories: {
          hard: { right: 8, wrong: 2 },
          soft: { right: 3, wrong: 1 },
          pairs: { right: 2, wrong: 0 },
          surrender: { right: 1, wrong: 0 },
          insurance: { right: 1, wrong: 0 },
          bet: { right: 2, wrong: 0 },
          countCheck: { right: 1, wrong: 0 },
        },
      };
      saveSettings(customSettings);
      saveStats(customStats);

      const exported = exportAll();
      storage = {}; // Clear storage
      const result = importAll(exported);

      expect(result.ok).toBe(true);
      expect(loadSettings()).toEqual(customSettings);
      expect(loadStats()).toEqual(customStats);
    });

    test('importAll with garbage JSON returns {ok:false} and does not mutate storage', () => {
      const initialSettings = { ...DEFAULT_SETTINGS, feedbackMode: 'test' as const };
      saveSettings(initialSettings);

      const result = importAll('garbage{not}json');
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();

      // Verify storage was not touched
      expect(loadSettings()).toEqual(initialSettings);
    });

    test('importAll with missing fields returns {ok:false}', () => {
      const result = importAll(JSON.stringify({ settings: DEFAULT_SETTINGS })); // missing stats
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

describe('store/stats', () => {
  test('applyEvents is pure (does not mutate input)', () => {
    const stats = { ...EMPTY_STATS };
    const originalStats = JSON.stringify(stats);

    const events: GradedEvent[] = [
      {
        kind: 'action',
        category: 'hard',
        correct: true,
        classification: 'correct',
        taken: 'stand',
        expected: 'stand',
        reason: 'Basic strategy',
        tc: 0,
      },
    ];

    applyEvents(stats, events);
    expect(JSON.stringify(stats)).toBe(originalStats);
  });

  test('applyEvents tallies a correct stand hard action', () => {
    const stats = EMPTY_STATS;
    const events: GradedEvent[] = [
      {
        kind: 'action',
        category: 'hard',
        correct: true,
        classification: 'correct',
        taken: 'stand',
        expected: 'stand',
        reason: 'Basic strategy',
        tc: 0,
      },
    ];

    const result = applyEvents(stats, events);
    expect(result.categories.hard.right).toBe(1);
    expect(result.categories.hard.wrong).toBe(0);
    expect(result.mistakes.correct).toBe(1);
  });

  test('applyEvents tallies missed-deviation on 16v10', () => {
    const stats = EMPTY_STATS;
    const events: GradedEvent[] = [
      {
        kind: 'action',
        category: 'hard',
        correct: false,
        classification: 'missed-deviation',
        taken: 'hit',
        expected: 'stand',
        reason: '16 v 10: stand at TC ≥ 0',
        deviationId: '16v10',
        tc: 1,
        hand: '16 v 10',
      },
    ];

    const result = applyEvents(stats, events);
    expect(result.categories.hard.right).toBe(0);
    expect(result.categories.hard.wrong).toBe(1);
    expect(result.perIndex['16v10']).toEqual({ right: 0, wrong: 1 });
    expect(result.mistakes['missed-deviation']).toBe(1);
  });

  test('applyEvents tallies wrong insurance', () => {
    const stats = EMPTY_STATS;
    const events: GradedEvent[] = [
      {
        kind: 'insurance',
        category: 'insurance',
        correct: false,
        classification: 'basic-error',
        taken: 'no',
        expected: 'yes',
        reason: 'Insurance incorrect',
        tc: 0,
      },
    ];

    const result = applyEvents(stats, events);
    expect(result.categories.insurance.wrong).toBe(1);
    expect(result.mistakes['basic-error']).toBe(1);
  });

  test('applyEvents tallies wrong bet', () => {
    const stats = EMPTY_STATS;
    const events: GradedEvent[] = [
      {
        kind: 'bet',
        category: 'bet',
        correct: false,
        classification: 'basic-error',
        taken: '2',
        expected: '4',
        reason: 'Incorrect bet spread',
        tc: 2,
      },
    ];

    const result = applyEvents(stats, events);
    expect(result.categories.bet.wrong).toBe(1);
    expect(result.mistakes['basic-error']).toBe(1);
  });

  test('applyEvents tallies right countCheck', () => {
    const stats = EMPTY_STATS;
    const events: GradedEvent[] = [
      {
        kind: 'countCheck',
        category: 'countCheck',
        correct: true,
        classification: 'correct',
        taken: '2',
        expected: '2',
        reason: 'Count check correct',
        tc: 2,
      },
    ];

    const result = applyEvents(stats, events);
    expect(result.categories.countCheck.right).toBe(1);
    expect(result.mistakes.correct).toBe(1);
  });

  test('applyEvents fixture with mixed events', () => {
    const stats = EMPTY_STATS;
    const events: GradedEvent[] = [
      // correct stand hard
      {
        kind: 'action',
        category: 'hard',
        correct: true,
        classification: 'correct',
        taken: 'stand',
        expected: 'stand',
        reason: 'Basic strategy',
        tc: 0,
      },
      // missed-deviation 16v10
      {
        kind: 'action',
        category: 'hard',
        correct: false,
        classification: 'missed-deviation',
        taken: 'hit',
        expected: 'stand',
        reason: '16 v 10: stand at TC ≥ 0',
        deviationId: '16v10',
        tc: 1,
        hand: '16 v 10',
      },
      // wrong insurance
      {
        kind: 'insurance',
        category: 'insurance',
        correct: false,
        classification: 'basic-error',
        taken: 'no',
        expected: 'yes',
        reason: 'Insurance incorrect',
        tc: 0,
      },
      // wrong bet
      {
        kind: 'bet',
        category: 'bet',
        correct: false,
        classification: 'basic-error',
        taken: '2',
        expected: '4',
        reason: 'Incorrect bet spread',
        tc: 2,
      },
      // right countCheck
      {
        kind: 'countCheck',
        category: 'countCheck',
        correct: true,
        classification: 'correct',
        taken: '2',
        expected: '2',
        reason: 'Count check correct',
        tc: 2,
      },
    ];

    const result = applyEvents(stats, events);

    // Category tallies
    expect(result.categories.hard).toEqual({ right: 1, wrong: 1 });
    expect(result.categories.insurance).toEqual({ right: 0, wrong: 1 });
    expect(result.categories.bet).toEqual({ right: 0, wrong: 1 });
    expect(result.categories.countCheck).toEqual({ right: 1, wrong: 0 });

    // perIndex
    expect(result.perIndex['16v10']).toEqual({ right: 0, wrong: 1 });

    // mistakes
    expect(result.mistakes.correct).toBe(2); // 1 hard + 1 countCheck
    expect(result.mistakes['missed-deviation']).toBe(1);
    expect(result.mistakes['basic-error']).toBe(2); // insurance + bet
  });

  test('applyEvents with phantom-deviation and wrong-anyway classifications', () => {
    const stats = EMPTY_STATS;
    const events: GradedEvent[] = [
      {
        kind: 'action',
        category: 'hard',
        correct: false,
        classification: 'phantom-deviation',
        taken: 'double',
        expected: 'stand',
        reason: 'Not at TC threshold',
        tc: 0,
      },
      {
        kind: 'action',
        category: 'pairs',
        correct: false,
        classification: 'wrong-anyway',
        taken: 'split',
        expected: 'hit',
        reason: 'Completely wrong',
        deviationId: 'TTv5',
        tc: 2,
      },
    ];

    const result = applyEvents(stats, events);
    expect(result.mistakes['phantom-deviation']).toBe(1);
    expect(result.mistakes['wrong-anyway']).toBe(1);
    expect(result.perIndex['TTv5']).toEqual({ right: 0, wrong: 1 });
  });
});

describe('DEFAULT_SETTINGS.spread aliasing', () => {
  test('DEFAULT_SETTINGS.spread is an independent copy, not the DEFAULT_SPREAD singleton', () => {
    expect(DEFAULT_SETTINGS.spread).not.toBe(DEFAULT_SPREAD);
    expect(DEFAULT_SETTINGS.spread[0]).not.toBe(DEFAULT_SPREAD[0]);
    expect(DEFAULT_SETTINGS.spread).toEqual(DEFAULT_SPREAD);
  });

  test('mutating DEFAULT_SETTINGS.spread[0].units does not change DEFAULT_SPREAD[0].units', () => {
    const original = DEFAULT_SPREAD[0].units;
    DEFAULT_SETTINGS.spread[0].units = original + 999;
    try {
      expect(DEFAULT_SPREAD[0].units).toBe(original);
    } finally {
      DEFAULT_SETTINGS.spread[0].units = original;
    }
  });
});
