import { expect, test, describe, beforeEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  EMPTY_STATS,
  type Settings,
  type Stats,
} from './types';
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
