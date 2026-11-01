import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { measureWithWebAudio, listAudioInputs } from './audioInputs';

/* Moved from carCheckCatalog.test.ts with the helpers (A122). */

/**
 * The measurement has to be stoppable, because the operator can leave.
 *
 * `measureWithWebAudio` polled to a fixed deadline and stopped the microphone
 * tracks only in its `finally`, so nothing on the screen could shorten it.
 * `measureRun.current += 1` in the field test's step cleanup discarded the
 * RESULT but could not close the stream -- so an answer or a Pause tapped
 * mid-measurement left the microphone open for the rest of the five seconds,
 * across the next step or after the screen was gone. On this app that is not
 * only a privacy surprise: the open microphone is the variable under test, so
 * it corrupts the following sample too.
 */
describe('measureWithWebAudio — stopping early', () => {
  function installAudioStack(): { stopped: () => number } {
    let stopped = 0;
    const track = {
      label: 'Fake microphone',
      stop: () => {
        stopped += 1;
      },
      getSettings: () => ({ autoGainControl: false, noiseSuppression: false }),
    };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    class FakeCtx {
      createMediaStreamSource() {
        return { connect: () => {} };
      }
      createAnalyser() {
        return {
          fftSize: 2048,
          getFloatTimeDomainData: (buf: Float32Array) => buf.fill(0.01),
          connect: () => {},
        };
      }
      close() {
        return Promise.resolve();
      }
    }
    (globalThis as unknown as { window: unknown }).window = { AudioContext: FakeCtx };
    // `navigator` is a getter-only global under node, so it has to be
    // redefined rather than assigned.
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { getUserMedia: () => Promise.resolve(stream) } },
      configurable: true,
      writable: true,
    });
    return { stopped: () => stopped };
  }

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { navigator?: unknown }).navigator;
  });

  it('returns at once when the signal is already aborted, and frees the microphone', async () => {
    const { stopped } = installAudioStack();
    const controller = new AbortController();
    controller.abort();

    const began = Date.now();
    const reading = await measureWithWebAudio(5000, controller.signal);

    expect(Date.now() - began, 'the loop ran on after being aborted').toBeLessThan(1000);
    expect(reading.frames).toBe(0);
    expect(stopped(), 'the microphone was left open after the abort').toBe(1);
  });

  it('stops when the signal aborts partway through', async () => {
    const { stopped } = installAudioStack();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 250);

    const began = Date.now();
    await measureWithWebAudio(5000, controller.signal);

    expect(Date.now() - began, 'the five seconds ran to the end anyway').toBeLessThan(2000);
    expect(stopped()).toBe(1);
  });

  it('still runs the full window when nothing aborts it', async () => {
    const { stopped } = installAudioStack();
    const reading = await measureWithWebAudio(300);
    expect(reading.frames).toBeGreaterThan(0);
    expect(stopped()).toBe(1);
  });
});

/**
 * WHICH MICROPHONE, ASKED RATHER THAN ACCEPTED.
 *
 * The open product question from 2026-09-29 is whether the phone's own
 * microphone is better than the car's hands-free unit under road noise. The
 * app has never chosen: it takes whatever the phone hands over, and `ulq6vs`
 * shows that changing run to run -- the iPhone's on one step, the Corolla's
 * on another -- with the readings taken on different hardware with different
 * DSP. A number with no device beside it cannot be compared to anything.
 */
describe('the inputs the phone will actually offer', () => {
  function installDevices(devices: unknown[], opts?: { throws?: boolean }) {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: () => Promise.resolve({ getAudioTracks: () => [], getTracks: () => [] }),
          enumerateDevices: () =>
            opts?.throws === true ? Promise.reject(new Error('nope')) : Promise.resolve(devices),
        },
      },
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    delete (globalThis as unknown as { navigator?: unknown }).navigator;
  });

  it('lists the audio inputs and nothing else', async () => {
    installDevices([
      { kind: 'audioinput', deviceId: 'a', label: 'iPhone Microphone' },
      { kind: 'videoinput', deviceId: 'cam', label: 'Front Camera' },
      { kind: 'audiooutput', deviceId: 'out', label: 'Speaker' },
      { kind: 'audioinput', deviceId: 'b', label: 'Corolla hands-free' },
    ]);

    const inputs = await listAudioInputs();

    expect(inputs.map((i) => i.label)).toEqual(['iPhone Microphone', 'Corolla hands-free']);
    expect(inputs.map((i) => i.deviceId)).toEqual(['a', 'b']);
  });

  /**
   * An input the browser will not name is still an input, and on iOS a label
   * is empty until permission has been granted at least once. Dropping the
   * unnamed ones would silently reduce a two-microphone sweep to one and the
   * export would look like a phone with a single input.
   */
  it('keeps an input the browser refuses to name', async () => {
    installDevices([{ kind: 'audioinput', deviceId: 'a', label: '' }]);

    const inputs = await listAudioInputs();

    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.label, 'an unnamed input vanished from the sweep').toBe('(unnamed)');
  });

  it('returns nothing rather than throwing when the browser has no enumerateDevices', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: {} },
      configurable: true,
      writable: true,
    });

    await expect(listAudioInputs()).resolves.toEqual([]);
  });

  it('returns nothing rather than throwing when enumerateDevices rejects', async () => {
    installDevices([], { throws: true });

    await expect(listAudioInputs()).resolves.toEqual([]);
  });
});

describe('measuring one named input', () => {
  let asked: unknown = null;

  function installAudioStackCapturing() {
    const track = {
      label: 'Corolla hands-free',
      stop: () => {},
      getSettings: () => ({}),
    };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    class FakeCtx {
      createMediaStreamSource() {
        return { connect: () => {} };
      }
      createAnalyser() {
        return {
          fftSize: 2048,
          getFloatTimeDomainData: (buf: Float32Array) => buf.fill(0.01),
          connect: () => {},
        };
      }
      close() {
        return Promise.resolve();
      }
    }
    (globalThis as unknown as { window: unknown }).window = { AudioContext: FakeCtx };
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: (c: unknown) => {
            asked = c;
            return Promise.resolve(stream);
          },
        },
      },
      configurable: true,
      writable: true,
    });
  }

  beforeEach(() => {
    asked = null;
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { navigator?: unknown }).navigator;
  });

  it('asks for the exact device it was given, and keeps the processing off', async () => {
    installAudioStackCapturing();
    const controller = new AbortController();
    controller.abort();

    await measureWithWebAudio(10, controller.signal, 'dev-1');

    const audio = (asked as { audio?: Record<string, unknown> }).audio ?? {};
    // EXACT, not `ideal`. A preference the browser is free to ignore would
    // give two readings from the same microphone labelled as two devices,
    // which is worse than no comparison at all.
    expect(audio.deviceId).toEqual({ exact: 'dev-1' });
    // ...and the constraints the absolute level depends on are still off:
    // AGC converges a loud cabin and a quiet one toward the same number.
    expect(audio.autoGainControl).toBe(false);
    expect(audio.noiseSuppression).toBe(false);
    expect(audio.echoCancellation).toBe(false);
  });

  it('asks for no particular device when it was not given one', async () => {
    installAudioStackCapturing();
    const controller = new AbortController();
    controller.abort();

    await measureWithWebAudio(10, controller.signal);

    const audio = (asked as { audio?: Record<string, unknown> }).audio ?? {};
    expect(audio.deviceId, 'pinned a device nobody asked for').toBeUndefined();
  });
});
