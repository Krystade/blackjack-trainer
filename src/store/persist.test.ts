import { describe, it, expect } from 'vitest';
import { mergeSettings } from './persist';

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
