import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _setStorage, exportAll, importAll, inspectBackup, loadSettings } from './persist';
import { deviceClass } from './deviceAudio';
import { importConfirmText } from '../ui/screens/backupText';

/**
 * B16: a desktop's speaker route, system voice and chime level do not ride a
 * backup onto the iPhone; a phone restoring its own backup gets them back.
 * Everything else in the file is restored either way.
 */
function memStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const on = (ua: string) => vi.stubGlobal('navigator', { userAgent: ua, maxTouchPoints: ua === IPHONE ? 5 : 0 });

let store: ReturnType<typeof memStore>;
beforeEach(() => {
  store = memStore();
  _setStorage(store);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const audioOf = (o: Record<string, unknown>) => ({
  version: 1,
  audio: { rate: 1.4, audioRoute: 'phone', routeStrategy: 'speaker-sink', voiceURI: 'Microsoft Zira - English (United States)', chimeVolume: 0.9, ...o },
});

/** A backup made on `ua` with the desktop's sound settings and 1.4x speech. */
function backupOn(ua: string): string {
  on(ua);
  store.setItem('bjtrainer.settings.v1', JSON.stringify(audioOf({})));
  store.setItem('bjtrainer.stats.v1', JSON.stringify({ version: 1 }));
  const json = exportAll();
  store.map.clear();
  return json;
}

describe('device sound settings on restore (B16)', () => {
  it('classifies the devices', () => {
    expect(deviceClass(IPHONE)).toBe('ios');
    expect(deviceClass(WINDOWS)).toBe('desktop');
    expect(deviceClass('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
  });

  it("a computer's backup onto the iPhone keeps the iPhone's route, voice and chime, and restores the rest", () => {
    const json = backupOn(WINDOWS);
    on(IPHONE);
    store.setItem('bjtrainer.settings.v1', JSON.stringify({ version: 1, audio: { audioRoute: 'bluetooth', voiceURI: 'com.apple.voice.Samantha', chimeVolume: 0.2 } }));
    expect(importAll(json).ok).toBe(true);
    const a = loadSettings().audio;
    expect([a.audioRoute, a.voiceURI, a.chimeVolume, a.routeStrategy]).toEqual(['bluetooth', 'com.apple.voice.Samantha', 0.2, undefined]);
    expect(a.rate).toBe(1.4);
    const inspected = inspectBackup(json);
    expect(inspected.ok && inspected.deviceNote).toContain('made on a computer');
    if (inspected.ok) expect(importConfirmText(inspected, { answers: 0, sessions: 0, profiles: 0, reviewCards: 0, newest: null }, true)).toContain('keeps its own speaker route');
  });

  it("the iPhone's own backup, restored after its storage was cleared, gets its route back", () => {
    const json = backupOn(IPHONE);
    on(IPHONE);
    expect(importAll(json).ok).toBe(true);
    const a = loadSettings().audio;
    expect([a.audioRoute, a.routeStrategy, a.chimeVolume]).toEqual(['phone', 'speaker-sink', 0.9]);
    const inspected = inspectBackup(json);
    expect(inspected.ok && inspected.deviceNote).toBeFalsy();
  });

  it('a file from before the device was recorded is restored whole, as before', () => {
    const json = backupOn(WINDOWS);
    const blob = JSON.parse(json) as { meta: Record<string, unknown> };
    delete blob.meta.device;
    on(IPHONE);
    store.setItem('bjtrainer.settings.v1', JSON.stringify({ version: 1, audio: { audioRoute: 'bluetooth' } }));
    expect(importAll(JSON.stringify(blob)).ok).toBe(true);
    expect(loadSettings().audio.audioRoute).toBe('phone');
  });
});
