import { describe, it, expect } from 'vitest';
import { mergeSettings, _setStorage, loadSettings, saveSettings, SETTINGS_KEY, loadStats, saveStats } from './persist';
import { EMPTY_STATS, type Stats } from './types';

/**
 * RETIRED SETTINGS, AND WHAT A STORED BLOB THAT STILL HAS THEM BECOMES.
 *
 * The 2026-10-05 settings cull removed six settings whose default was the only
 * value worth having (see RETIRED_* in persist.ts). `mergeSettings` spreads the
 * stored blob over the defaults, so without the drop each one would ride along
 * in memory and be written back by the next save, forever.
 */
describe('settings retired in the cull', () => {
  it('drops every retired key from a stored blob', () => {
    const s = mergeSettings({
      version: 1,
      countPeek: false,
      drill: { pushToTalkMs: 8000 },
      audio: { chimes: false, cardDetail: 'face', handStyle: 'total', outputRoute: 'switch' },
    }) as unknown as Record<string, Record<string, unknown>>;
    expect('countPeek' in s).toBe(false);
    expect('pushToTalkMs' in s.drill!).toBe(false);
    for (const k of ['chimes', 'cardDetail', 'handStyle', 'outputRoute']) {
      expect(k in s.audio!, `audio.${k} survived the load`).toBe(false);
    }
  });

  it('drops the drill settings retired on 2026-10-14 through a load and save', () => {
    // 6f74cc6 removed the types but not the stored values, so an install that
    // once saved them carried both keys through every later save.
    const map = new Map<string, string>();
    _setStorage({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } });
    try {
      map.set(SETTINGS_KEY, JSON.stringify({
        version: 1,
        drill: { flashByFrequency: true, masteryDistractionFreq: 'relentless', wheelMode: 'answer' },
      }));
      saveSettings(loadSettings());
      const written = JSON.parse(map.get(SETTINGS_KEY)!) as { drill: Record<string, unknown> };
      expect('flashByFrequency' in written.drill).toBe(false);
      expect('masteryDistractionFreq' in written.drill).toBe(false);
      expect(written.drill.wheelMode).toBe('answer');
    } finally {
      _setStorage(null);
    }
  });

  it('keeps the rest of the stored settings', () => {
    // A migration that reset the whole audio section would take the voice,
    // rate and volume with it -- a worse outcome than the settings it drops.
    const s = mergeSettings({
      version: 1,
      dealSpeedMs: 500,
      drill: { pushToTalkMs: 8000, wheelMode: 'answer' },
      audio: { outputRoute: 'switch', rate: 1.4, volume: 0.5, voiceURI: 'Samantha' },
    });
    expect(s.dealSpeedMs).toBe(500);
    expect(s.drill.wheelMode).toBe('answer');
    expect(s.audio.rate).toBe(1.4);
    expect(s.audio.volume).toBe(0.5);
    expect(s.audio.voiceURI).toBe('Samantha');
  });

  it('turns the recorded voice back on, since there is no control left to do it', () => {
    // Shipped off once, so an install that saved anything back then has
    // `useClips: false` on disk -- and live speech is invisible to the car.
    const s = mergeSettings({ version: 1, audio: { useClips: false } });
    expect(s.audio.useClips).toBe(true);
  });
});

describe('audio route settings (Wave U)', () => {
  it('keeps every allowed value', () => {
    for (const audioRoute of ['auto', 'phone', 'bluetooth'] as const) {
      expect(mergeSettings({ version: 1, audio: { audioRoute } }).audio.audioRoute).toBe(audioRoute);
    }
    for (const routeStrategy of ['auto', 'web-audio', 'play-and-record', 'speaker-sink'] as const) {
      expect(mergeSettings({ version: 1, audio: { routeStrategy } }).audio.routeStrategy).toBe(routeStrategy);
    }
  });

  it('drops a value not on the list, so it reads as Auto', () => {
    const s = mergeSettings({ version: 1, audio: { audioRoute: 'usb', routeStrategy: 'half-duplex', voiceURI: 'Samantha' } });
    expect(s.audio.audioRoute).toBeUndefined();
    expect(s.audio.routeStrategy).toBeUndefined();
    expect('audioRoute' in s.audio).toBe(false);
    expect(s.audio.voiceURI).toBe('Samantha');
    expect(mergeSettings({ version: 1, audio: { audioRoute: 7 } }).audio.audioRoute).toBeUndefined();
  });
});

/**
 * The two microphone-experiment arms are fixed behaviour now, so a stored
 * control arm must not ride along through every save -- and must not be
 * mistaken for a live setting by anything that reads the blob.
 */
describe('retired microphone-experiment fields', () => {
  it('drops a stored micCueOn and voiceAlternatives, keeping the rest', () => {
    const s = mergeSettings({
      version: 1,
      audio: { micCueOn: 'start', voiceAlternatives: 3, rate: 1.2 },
    });
    const audio = s.audio as unknown as Record<string, unknown>;
    expect('micCueOn' in audio).toBe(false);
    expect('voiceAlternatives' in audio).toBe(false);
    expect(s.audio.rate).toBe(1.2);
  });
});

/**
 * EVERY STATS SECTION SURVIVES A SAVE AND A LOAD.
 *
 * Every caller of the stats is load, modify, save. A section the load merge
 * stops carrying is overwritten on disk by the first graded answer after a
 * reload. Iterating EMPTY_STATS's keys covers a section added later without
 * this test naming it; the optional sections absent from EMPTY_STATS are
 * seeded by hand.
 */
describe('stats round trip', () => {
  it('saves and loads every section unchanged', () => {
    const map = new Map<string, string>();
    _setStorage({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } });
    try {
      const stats = structuredClone(EMPTY_STATS) as unknown as Record<string, unknown>;
      let historySections = 0;
      for (const key of Object.keys(EMPTY_STATS)) {
        const value = stats[key];
        if (value && typeof value === 'object' && Array.isArray((value as { history?: unknown }).history)) {
          (value as { history: unknown[] }).history.push({ date: 'D-' + key, marker: key });
          historySections++;
        }
      }
      // A guard against the loop above silently matching nothing.
      expect(historySections).toBeGreaterThanOrEqual(11);
      const s = stats as unknown as Stats;
      s.sessions.push({ date: 'D-sessions' } as unknown as Stats['sessions'][number]);
      s.latencyHistory.push({ date: 'D-latency' } as unknown as Stats['latencyHistory'][number]);
      s.categories.hard = { right: 3, wrong: 1 };
      s.categories.wongIn = { right: 1, wrong: 2 };
      s.mistakes['basic-error'] = 4;
      s.perIndex = { '16v10': { right: 2, wrong: 5 } } as Stats['perIndex'];
      // Optional sections and counters EMPTY_STATS leaves out.
      Object.assign(s, {
        betSizing: { history: [{ date: 'D-betSizing' }] },
        tableDecisions: { history: [{ elapsedMs: 900, date: 'D-table' }] },
        misclicks: 2,
        masterySweepsCompleted: 1,
        practiceDays: ['2026-10-30'],
        cellStats: { 'hard-16-10': { right: 1, wrong: 1, lastAt: '2026-10-30' } },
        wongInMisses: { missed: 1, early: 0 },
      });

      expect(saveStats(s)).toBe(true);
      expect(loadStats()).toEqual(s);
    } finally {
      _setStorage(null);
    }
  });
});
