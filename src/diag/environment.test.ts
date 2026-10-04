import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  logEnvironment,
  logSelectedInput,
  logHardwareRate,
  _resetRateProbesForTest,
} from './environment';
import { clearDiagnosticLog, readDiagnosticLog } from './diagnosticLog';

/**
 * WHICH MICROPHONE, not which microphones.
 *
 * `logAudioInputs` calls `enumerateDevices`, which lists the inputs that
 * EXIST. It says nothing about the one in use -- and "in use" is the whole
 * question, because the phone switching its input to the car's hands-free
 * unit is the one machine-readable signature of the Bluetooth profile flip
 * that this entire protocol is built to measure the effects of. The only row
 * that ever named the input in use was the ambient step's, taken last.
 *
 * This reads the label off a live track and stops the track at once. It is
 * the caller's job to open it only where a second capture costs nothing.
 */

interface FakeTrack {
  label: string;
  getSettings: () => { deviceId?: string };
  stop: () => void;
}

function installMediaDevices(getUserMedia: () => Promise<unknown>): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia } },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  clearDiagnosticLog();
});

afterEach(() => {
  delete (globalThis as { navigator?: unknown }).navigator;
});

describe('logSelectedInput', () => {
  it('records the label and id of the input actually in use, then lets it go', async () => {
    const track: FakeTrack = {
      label: 'Corolla Hands-Free',
      getSettings: () => ({ deviceId: 'bt-1' }),
      stop: vi.fn(),
    };
    installMediaDevices(async () => ({
      getAudioTracks: () => [track],
      getTracks: () => [track],
    }));

    await logSelectedInput('mic-settled');

    const row = readDiagnosticLog().find(
      (e) => e.category === 'route' && e.event === 'input-selected',
    );
    expect(row, 'nothing said which input the phone was using').toBeTruthy();
    expect(row?.detail).toMatchObject({
      reason: 'mic-settled',
      label: 'Corolla Hands-Free',
      deviceId: 'bt-1',
    });
    expect(track.stop, 'the probe left a microphone open').toHaveBeenCalledTimes(1);
  });

  it('records a refusal rather than throwing into the step that asked', async () => {
    installMediaDevices(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });

    await expect(logSelectedInput('mic-settled')).resolves.toBeUndefined();

    const row = readDiagnosticLog().find(
      (e) => e.category === 'route' && e.event === 'input-selected',
    );
    expect(row?.detail).toMatchObject({ reason: 'mic-settled', state: 'threw' });
  });

  it('records the absence of the API on a platform without it', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });

    await logSelectedInput('boot');

    const row = readDiagnosticLog().find(
      (e) => e.category === 'route' && e.event === 'input-selected',
    );
    expect(row?.detail).toMatchObject({ reason: 'boot', state: 'unavailable' });
  });
});


/**
 * THE ONE READING THAT NAMES THE OUTPUT ROUTE.
 *
 * "It's still coming from the top quiet phone speaker instead of the bottom
 * loud speaker" was the loudest complaint from the 2026-10-02 drive and the
 * only one with nothing measured behind it -- iOS gives a web page no output
 * route API whatsoever. An AudioContext takes the hardware's rate at the
 * moment it is built, and that rate names the session: 48000 is ordinary
 * playback, 16000 or 8000 is play-and-record or Bluetooth HFP, which is the
 * earpiece and the car's phone-call path.
 */
describe('logHardwareRate', () => {
  const realWindow = (globalThis as { window?: unknown }).window;

  function installFakeContexts(rate: number): { built: number; closed: number } {
    const counts = { built: 0, closed: 0 };
    class FakeCtx {
      sampleRate = rate;
      state = 'running';
      constructor() {
        counts.built += 1;
      }
      close(): Promise<void> {
        counts.closed += 1;
        return Promise.resolve();
      }
    }
    (globalThis as { window?: unknown }).window = { AudioContext: FakeCtx };
    return counts;
  }

  beforeEach(() => {
    clearDiagnosticLog();
    _resetRateProbesForTest();
  });
  afterEach(() => {
    _resetRateProbesForTest();
    if (realWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = realWindow;
  });

  it('records the rate the hardware is actually on', () => {
    installFakeContexts(48_000);

    logHardwareRate('mic-open');

    const row = readDiagnosticLog().find(
      (e) => e.category === 'route' && e.event === 'hardware-rate',
    );
    expect(row?.detail).toMatchObject({ reason: 'mic-open', rate: 48_000 });
  });

  it('closes every context it builds, so a drive does not accumulate them', () => {
    const counts = installFakeContexts(16_000);

    logHardwareRate('mic-open');
    logHardwareRate('mic-closed');

    expect(counts.built).toBe(2);
    // iOS caps concurrent AudioContexts, and this one runs on the open and
    // close of every recogniser session -- a leak here would eventually take
    // the chimes down with it.
    expect(counts.closed).toBe(2);
  });

  it('stops after a bounded number of readings', () => {
    const counts = installFakeContexts(48_000);

    // A count drill opens the microphone every few seconds. Unbounded, an
    // hour's drive would build hundreds of contexts for a measurement whose
    // whole value is in the first few.
    for (let i = 0; i < 200; i++) logHardwareRate('mic-open');

    expect(counts.built).toBeLessThan(50);
    expect(counts.built).toBeGreaterThan(0);
  });

  it('says so rather than throwing where there is no AudioContext', () => {
    (globalThis as { window?: unknown }).window = {};

    expect(() => logHardwareRate('boot')).not.toThrow();
    const row = readDiagnosticLog().find(
      (e) => e.category === 'route' && e.event === 'hardware-rate',
    );
    expect(row?.detail).toMatchObject({ reason: 'boot', state: 'unavailable' });
  });
});


/**
 * THE VOICE LIST, READ TWICE, because once answers the wrong question.
 *
 * `env voices count=0` appeared on one page load of the 2026-10-03 export and
 * it is unreadable on its own: iOS fills the list asynchronously, so zero at
 * boot means either "this phone has no speech synthesis" or "ask again in a
 * moment", and those two want opposite responses from whoever reads the log.
 * The probe's own comment claimed there was no `voiceschanged` listener, which
 * stopped being true when `primeVoices` was added to speech.ts -- so the one
 * reading in the log was the pessimistic one and nothing ever corrected it.
 *
 * A second entry when the list fills makes the distinction, and the silence
 * when it does not is then meaningful too.
 */
describe('the voice inventory', () => {
  interface FakeSynth {
    getVoices: () => unknown[];
    addEventListener: (type: string, fn: () => void) => void;
  }

  function installSynth(initial: unknown[]): { fill: (later: unknown[]) => void } {
    let current = initial;
    const listeners: Record<string, Array<() => void>> = {};
    const synth: FakeSynth = {
      getVoices: () => current,
      addEventListener: (type, fn) => {
        (listeners[type] ??= []).push(fn);
      },
    };
    (globalThis as { window?: unknown }).window = { speechSynthesis: synth };
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'fake', language: 'en-GB' },
      configurable: true,
      writable: true,
    });
    return {
      fill: (later) => {
        current = later;
        for (const fn of listeners.voiceschanged ?? []) fn();
      },
    };
  }

  const voiceRows = () =>
    readDiagnosticLog().filter((e) => e.category === 'env' && e.event === 'voices');

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('writes the late list down when the first reading was empty', () => {
    const synth = installSynth([]);
    logEnvironment();
    expect(voiceRows()[0]?.detail).toMatchObject({ count: 0 });

    synth.fill([{ name: 'Samantha', lang: 'en-US', default: true }]);

    const rows = voiceRows();
    expect(rows.length, 'an empty first reading was never corrected').toBe(2);
    expect(rows[1]!.detail).toMatchObject({ count: 1, nominated: 'Samantha', when: 'late' });
  });

  it('says nothing more when the list was already there', () => {
    // The other half of the instrument. A second row on every page load would
    // be noise, and a reader counting `voices` rows to spot the slow phones
    // would count every phone.
    const synth = installSynth([{ name: 'Daniel', lang: 'en-GB', default: true }]);
    logEnvironment();
    synth.fill([
      { name: 'Daniel', lang: 'en-GB', default: true },
      { name: 'Samantha', lang: 'en-US' },
    ]);
    expect(voiceRows().length).toBe(1);
  });

  it('stays silent where the list never fills, which is the real absence', () => {
    installSynth([]);
    logEnvironment();
    expect(voiceRows().length).toBe(1);
    expect(voiceRows()[0]!.detail).toMatchObject({ count: 0 });
  });

  it('ignores a voiceschanged that brought nothing with it', () => {
    // WebKit fires this event more than once, and an early fire can still
    // hand back an empty list. A `count=0 when=late` row would say the list
    // had been re-read and found empty, which is true and useless -- it is
    // the same non-answer as the boot row, written twice.
    const synth = installSynth([]);
    logEnvironment();
    synth.fill([]);
    expect(voiceRows().length).toBe(1);

    // And the correcting row still arrives when the list actually turns up.
    synth.fill([{ name: 'Samantha', lang: 'en-US', default: true }]);
    expect(voiceRows().length).toBe(2);
  });
});
