import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { playChimeTone, _resetClipsForTest } from './clips';
import { chime } from './speech';
import { _resetSharedAudioContextForTest } from './audioContext';
import { readDiagnosticLog, clearDiagnosticLog } from '../diag/diagnosticLog';
import { markMicSessionOpened, setVoiceCaptureActive, _resetMicSessionCostForTest } from './micSessionCost';
import { toneSamples } from './tone';

interface Started {
  sample3: number;
  length: number;
  gain: number;
}

let started: Started[];
let elements: { src: string; volume: number; played: boolean }[];

function install(state: 'running' | 'suspended' | 'stuck' = 'running') {
  started = [];
  elements = [];
  class FakeAudio {
    src = '';
    volume = 1;
    played = false;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    load() {}
    pause() {}
    play() {
      this.played = true;
      elements.push(this);
      return Promise.resolve();
    }
  }
  class FakeCtx {
    state: string = state === 'stuck' ? 'suspended' : state;
    sampleRate = 48000;
    destination = {};
    async resume() {
      if (state === 'suspended') this.state = 'running';
      if (state === 'stuck') await new Promise(() => {});
    }
    createBuffer(_ch: number, length: number) {
      const data = new Float32Array(length);
      return { length, getChannelData: () => data, data };
    }
    createGain() {
      return { gain: { value: 1 }, connect() {}, disconnect() {} };
    }
    createBufferSource() {
      const src: any = {
        buffer: null,
        onended: null,
        gainRef: null,
        connect(g: any) {
          src.gainRef = g;
        },
        start() {
          started.push({ sample3: src.buffer.data[3], length: src.buffer.length, gain: src.gainRef.gain.value });
        },
      };
      return src;
    }
  }
  (globalThis as any).window = { Audio: FakeAudio, AudioContext: FakeCtx };
  (globalThis as any).Audio = FakeAudio;
}

describe('chime output path', () => {
  beforeEach(() => {
    _resetClipsForTest();
    _resetSharedAudioContextForTest();
    _resetMicSessionCostForTest();
    clearDiagnosticLog();
  });
  afterEach(() => {
    _resetClipsForTest();
    _resetSharedAudioContextForTest();
    _resetMicSessionCostForTest();
    delete (globalThis as any).window;
    delete (globalThis as any).Audio;
    vi.useRealTimers();
  });

  it('uses the element before any mic has been opened', () => {
    install();
    playChimeTone(880, 0.5);
    expect(started).toHaveLength(0);
    expect(elements).toHaveLength(1);
  });

  it('uses Web Audio, with the same samples and the peak as gain, once the mic has been opened', () => {
    install();
    markMicSessionOpened();
    playChimeTone(880, 0.75);
    expect(elements).toHaveLength(0);
    expect(started).toHaveLength(1);
    expect(started[0]!.gain).toBe(0.75);
    expect(started[0]!.length).toBe(2880);
    expect(started[0]!.sample3).toBeCloseTo(toneSamples(880)[3]!, 6);
  });

  it('uses Web Audio while voice capture is active even if the mic flag is not set', () => {
    install();
    setVoiceCaptureActive(true);
    playChimeTone(660, 0.5);
    expect(started).toHaveLength(1);
    expect(elements).toHaveLength(0);
  });

  it('resumes a suspended context and then plays on Web Audio', async () => {
    install('suspended');
    markMicSessionOpened();
    playChimeTone(880, 0.5);
    await vi.waitFor(() => expect(started).toHaveLength(1));
    expect(elements).toHaveLength(0);
  });

  it('falls back to the element when the context cannot run', async () => {
    vi.useFakeTimers();
    install('stuck');
    markMicSessionOpened();
    playChimeTone(880, 0.5);
    await vi.advanceTimersByTimeAsync(1500);
    expect(started).toHaveLength(0);
    expect(elements).toHaveLength(1);
    expect(readDiagnosticLog().some((e) => e.event === 'chime-suspended')).toBe(true);
  });

  it('chime() logs path=element before the mic and path=webaudio after, with volume kept', () => {
    install();
    chime('good');
    markMicSessionOpened();
    chime('turn', { volume: 2 });
    const lines = readDiagnosticLog().filter((e) => e.event === 'chime');
    expect(lines.map((e) => e.detail?.path)).toEqual(['element', 'webaudio']);
    expect(lines[1]!.detail?.volume).toBe(2);
    // volume 200% -> full-scale gain on the Web Audio path.
    expect(started[0]!.gain).toBe(1);
  });
});
