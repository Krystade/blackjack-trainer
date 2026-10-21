import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { playClipsAsync, prewarmClips, setClipsEnabled, _resetClipsForTest } from './clips';
import { chime, speak, _resetLastSpokenForTest, _resetSpeakQueueForTest, _resetChimeLevelsForTest, setChimeLevels } from './speech';
import { _resetToneCacheForTest } from './tone';
import { _resetMicSessionCostForTest } from './micSessionCost';
import { readDiagnosticLog, clearDiagnosticLog } from '../diag/diagnosticLog';
import { effectiveVolume } from './volume';

/**
 * Wave M, owner report: "mute does not silence chimes in regular flashcards".
 *
 * His log (k6u/h39): `audio.muted: true`, then `speak chime kind=good volume=0
 * path=element` -- still audible -- and `speak clip-chain files=correct.mp3`.
 * iOS Safari makes `HTMLMediaElement.volume` read-only: the setter is a no-op
 * and the getter is always 1. So a "volume 0" element plays at FULL level.
 *
 * This element models exactly that, and the assertion is the only one that
 * survives it: while muted, `play()` is never called on anything.
 */
class IosAudioElement {
  static plays = 0;
  src = '';
  preservesPitch = false;
  playbackRate = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  get volume(): number {
    return 1;
  }
  set volume(_v: number) {
    /* iOS: ignored */
  }
  load(): void {}
  pause(): void {}
  play(): Promise<void> {
    IosAudioElement.plays += 1;
    return Promise.resolve();
  }
}

const realFetch = (globalThis as { fetch?: unknown }).fetch;
let utterances: unknown[];

function installIos(): void {
  IosAudioElement.plays = 0;
  utterances = [];
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    const body = url.includes('index.json')
      ? { voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }
      : url.includes('manifest.json')
        ? { clips: { correct: 'correct.mp3' } }
        : null;
    return body ? { ok: true, json: async () => body } : { ok: false };
  });
  (globalThis as any).SpeechSynthesisUtterance = class {
    constructor(public text: string) {
      utterances.push(this);
    }
  };
  (globalThis as any).window = {
    location: { search: '' },
    Audio: IosAudioElement,
    speechSynthesis: {
      speak: (u: unknown) => utterances.push(u),
      cancel: () => {},
      getVoices: () => [],
      speaking: false,
      pending: false,
    },
  };
}

describe('mute on iOS, where element.volume is ignored', () => {
  beforeEach(() => {
    _resetClipsForTest();
    _resetToneCacheForTest();
    _resetMicSessionCostForTest();
    _resetLastSpokenForTest();
    _resetSpeakQueueForTest();
    _resetChimeLevelsForTest();
    clearDiagnosticLog();
    installIos();
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetClipsForTest();
    _resetChimeLevelsForTest();
    (globalThis as any).fetch = realFetch;
    delete (globalThis as any).window;
    delete (globalThis as any).SpeechSynthesisUtterance;
  });

  it('a muted chime (volume 0, the k6u line) starts no playback', async () => {
    chime('good', { volume: effectiveVolume({ volume: 1, muted: true }) });
    await Promise.resolve();
    expect(IosAudioElement.plays).toBe(0);
  });

  it('a chime with no options (turn, heard) obeys mute via the synced levels', async () => {
    setChimeLevels(effectiveVolume({ volume: 1, muted: true }), 0.35);
    chime('turn');
    chime('heard');
    await Promise.resolve();
    expect(IosAudioElement.plays).toBe(0);
    const logged = readDiagnosticLog().filter((e) => e.event === 'chime');
    expect(logged.map((e) => e.detail?.volume)).toEqual([0, 0]);
  });

  it('control: an unmuted chime does play (the stub can observe a play)', async () => {
    chime('good', { volume: 1 });
    await Promise.resolve();
    expect(IosAudioElement.plays).toBe(1);
  });

  it('a muted recorded line (correct.mp3) starts no element and no live voice', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setClipsEnabled(true);
    await prewarmClips();
    speak('correct', { volume: 0 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(IosAudioElement.plays).toBe(0);
    expect(utterances).toHaveLength(0);
  });

  it('the clip layer refuses a muted chain on its own too (backstop)', async () => {
    setClipsEnabled(true);
    await expect(playClipsAsync('correct', { volume: 0 })).resolves.toBe(true);
    expect(IosAudioElement.plays).toBe(0);
  });

  it('control: the same line unmuted does reach the element', async () => {
    setClipsEnabled(true);
    await prewarmClips();
    speak('correct', { volume: 1 });
    await vi.waitFor(() => expect(IosAudioElement.plays).toBe(1));
  });
});
