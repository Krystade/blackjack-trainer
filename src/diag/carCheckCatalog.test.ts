import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  audioGraphCheck,
  audioOutCheck,
  chimeAudibleCheck,
  clipSpeedCheck,
  elementVolumeCheck,
  outputRouteCheck,
  wheelPressCheck,
  ambientCheck,
  clipVoiceCheck,
  measureWithWebAudio,
  listAudioInputs,
} from './carCheckCatalog';
import { foldFrames } from './ambientNoise';
import { _resetSharedAudioContextForTest } from '../audio/audioContext';
import { narrateAnswerEcho, ANSWER_ECHO_LABELS } from '../audio/narrate';

/** An element that accepts play() and may or may not actually render audio. */
function fakeAudio(opts: { advances?: boolean; refuses?: boolean } = {}): HTMLAudioElement {
  const el = {
    currentTime: 0,
    play: () =>
      opts.refuses
        ? Promise.reject(new DOMException('no gesture', 'NotAllowedError'))
        : Promise.resolve(void (opts.advances !== false && (el.currentTime = 0.8))),
    pause: () => {},
  };
  return el as unknown as HTMLAudioElement;
}

describe('did sound actually come out', () => {
  it('passes when the clock moved while it played', async () => {
    const result = await audioOutCheck(() => fakeAudio({ advances: true })).run();
    expect(result.outcome).toBe('pass');
  });

  /**
   * The distinction the whole check exists for. `play()` resolving means the
   * browser ACCEPTED the request; a currentTime that never moves means
   * nothing was rendered. A check that trusted the promise would report
   * working audio into a silent car.
   */
  it('fails when play() was accepted but nothing was rendered', async () => {
    const result = await audioOutCheck(() => fakeAudio({ advances: false })).run();
    expect(result.outcome).toBe('fail');
    expect(result.summary).toContain('never advanced');
  });

  it('fails, without throwing, when the phone refuses outright', async () => {
    const result = await audioOutCheck(() => fakeAudio({ refuses: true })).run();
    expect(result.outcome).toBe('fail');
    expect(result.detail?.why).toBe('NotAllowedError');
  });

  it('fails when the browser has no audio element at all', async () => {
    const result = await audioOutCheck(() => null).run();
    expect(result.outcome).toBe('fail');
  });
});

describe('which button the car sent', () => {
  /**
   * Driven through the probe the check actually registers, so the assertion
   * is about the app naming a real arrival -- not about a promise resolving.
   */
  it('names the action that arrived', async () => {
    vi.resetModules();
    let registered: ((action: string) => void) | null = null;
    vi.doMock('../audio/mediaSession', async () => {
      const real =
        await vi.importActual<typeof import('../audio/mediaSession')>('../audio/mediaSession');
      return {
        ...real,
        setMediaSessionProbe: (fn: ((action: string) => void) | null) => {
          registered = fn;
        },
      };
    });
    const { wheelPressCheck: check } = await import('./carCheckCatalog');

    const running = check(4000).run();
    // Wait for the check to install its probe, then send a button as the car would.
    for (let i = 0; i < 20 && !registered; i++) await new Promise((r) => setTimeout(r, 10));
    expect(registered).not.toBeNull();
    registered!('nexttrack');

    const result = await running;
    expect(result.outcome).toBe('pass');
    expect(result.detail?.actions).toEqual(['nexttrack']);
    // Named for a human, not echoed as a raw action string.
    expect(result.summary).toContain('The car sent:');
    expect(result.summary).not.toBe('The car sent: nexttrack.');

    vi.doUnmock('../audio/mediaSession');
    vi.resetModules();
  });

  /**
   * A timeout must WARN, never fail. "Nobody pressed a button" and "the car
   * sent it to the radio" are opposite diagnoses, and a red cross against the
   * first would send the operator hunting a bug that is not there.
   */
  it('warns rather than fails when nothing arrives', async () => {
    const result = await wheelPressCheck(150).run();
    expect(result.outcome).toBe('warn');
    expect(result.summary).toContain('No button arrived');
  });
});

describe('how loud it is', () => {
  const loud = () => Float32Array.from([0.5, -0.5, 0.5, -0.5]);
  const quiet = () => Float32Array.from([0.001, -0.001, 0.001, -0.001]);

  it('reports a number and a band from real frames', async () => {
    const result = await ambientCheck(async (ms) => foldFrames([loud(), loud()], ms), 10).run();
    expect(result.outcome).toBe('pass');
    expect(result.detail?.band).toBe('loud');
    expect(typeof result.detail?.dbfs).toBe('number');
  });

  /**
   * A loud car is not a broken app. Marking it red would teach the operator
   * that red means nothing, which costs the reds that do matter.
   */
  it('does not treat a loud room as a failure', async () => {
    const result = await ambientCheck(async (ms) => foldFrames([loud()], ms), 10).run();
    expect(result.outcome).toBe('pass');
  });

  it('still reads a quiet room as a reading, not an error', async () => {
    const result = await ambientCheck(async (ms) => foldFrames([quiet()], ms), 10).run();
    expect(result.outcome).toBe('pass');
    expect(result.detail?.band).toBe('quiet');
  });

  /**
   * Zero frames is a measurement that did not happen. Reporting it as a quiet
   * room would be a check that cannot fail -- and in a moving car it is the
   * signature of listening to the wrong input entirely.
   */
  it('fails when the microphone produced nothing at all', async () => {
    const result = await ambientCheck(async (ms) => foldFrames([], ms), 10).run();
    expect(result.outcome).toBe('fail');
    expect(result.summary).toContain('not the same as a quiet room');
  });
});

describe('the recorded voice covers what the drill says', () => {
  /**
   * The regression guard for the 2026-09-20 voice switch: an utterance with
   * no clip falls back to the phone voice, which under road noise is the
   * utterance disappearing.
   */
  it('fails, and names them, when a line has no clip', async () => {
    vi.resetModules();
    vi.doMock('../audio/clips', async () => {
      const real = await vi.importActual<typeof import('../audio/clips')>('../audio/clips');
      return {
        ...real,
        activeClipVoice: async () => 'test-voice',
        // A manifest that covers the verdicts but not the answer echo, which
        // is exactly the state that shipped.
        loadVoiceManifest: async () => ({ 'Correct.': 'a.mp3', 'Wrong.': 'b.mp3' }),
      };
    });
    const { clipVoiceCheck: checkWithGap } = await import('./carCheckCatalog');
    const result = await checkWithGap().run();
    expect(result.outcome).toBe('fail');
    const missing = (result.detail?.missing ?? []) as string[];
    expect(missing.length).toBe(ANSWER_ECHO_LABELS.length);
    expect(result.detail?.missing).toContain(narrateAnswerEcho('Hit'));
    vi.doUnmock('../audio/clips');
    vi.resetModules();
  });

  it('passes when every checked line resolves', async () => {
    vi.resetModules();
    vi.doMock('../audio/clips', async () => {
      const real = await vi.importActual<typeof import('../audio/clips')>('../audio/clips');
      const full: Record<string, string> = { 'Correct.': 'a.mp3', 'Wrong.': 'b.mp3' };
      for (const l of ANSWER_ECHO_LABELS) full[narrateAnswerEcho(l)] = `${l}.mp3`;
      return { ...real, activeClipVoice: async () => 'test-voice', loadVoiceManifest: async () => full };
    });
    const { clipVoiceCheck: checkFull } = await import('./carCheckCatalog');
    const result = await checkFull().run();
    expect(result.outcome).toBe('pass');
    vi.doUnmock('../audio/clips');
    vi.resetModules();
  });

  it('is wired to the real catalog export', () => {
    expect(typeof clipVoiceCheck).toBe('function');
  });
});

describe('a microphone that will not open', () => {
  /**
   * A refused microphone is a fact about the device, not a crash. Left to the
   * runner's catch-all it rendered as "The check itself failed: Not
   * supported", which tells the operator nothing they can act on.
   */
  it('reports a refusal in words, not as a thrown check', async () => {
    const check = ambientCheck(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    }, 10);
    const result = await check.run();
    expect(result.outcome).toBe('fail');
    expect(result.summary).toContain('could not be opened');
    expect(result.summary).not.toContain('The check itself failed');
    expect(result.detail?.why).toBe('NotAllowedError');
  });
});

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


/* ------------------------------------------------------------------------ */
/* The checks that run on the phone because they cannot run anywhere else   */
/* ------------------------------------------------------------------------ */

/**
 * THE TESTS FOR THE TESTS, and the reason they matter more than usual.
 *
 * These five checks exist because Jack said, on 2026-10-03, "you running the
 * tests here on my computer vs me using the app on my phone just doesn't
 * equate" -- and he was right: every fault that reached the car this week was
 * green on the desktop suite. The checks are the answer to that, so a check
 * that cannot report a fault is worse than no check at all. It would turn a
 * real fault into a screen full of ticks.
 *
 * So each one is driven here with a fake that FAILS in the exact way the phone
 * failed, as well as one that works.
 */
describe('the device-only checks', () => {
  const realWindow = (globalThis as any).window;
  afterEach(() => {
    _resetSharedAudioContextForTest();
    if (realWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = realWindow;
  });

  /** An element that honours, ignores, or refuses a volume assignment. */
  function volumeElement(mode: 'honours' | 'ignores'): HTMLAudioElement {
    const el: Record<string, unknown> = {};
    let stored = 1;
    Object.defineProperty(el, 'volume', {
      get: () => (mode === 'ignores' ? 1 : stored),
      set: (v: number) => {
        stored = v;
      },
    });
    return el as unknown as HTMLAudioElement;
  }

  describe('the Web Audio graph', () => {
    function installContext(state: string, resumesTo?: string) {
      class Ctx {
        state = state;
        sampleRate = 48_000;
        resume() {
          if (resumesTo) this.state = resumesTo;
          return Promise.resolve();
        }
      }
      (globalThis as any).window = { AudioContext: Ctx };
    }

    it('passes when a resume wakes it', async () => {
      installContext('suspended', 'running');
      const r = await audioGraphCheck().run();
      expect(r.outcome).toBe('pass');
      expect(r.detail).toMatchObject({ state: 'running', rate: 48_000 });
    });

    it('warns when it stays asleep, which is what the phone did', async () => {
      // 2026-10-03: `audio-unlock state=suspended` from a gesture, and
      // `chime-suspended state=suspended` eight seconds later. Twice.
      installContext('suspended');
      const r = await audioGraphCheck().run();
      expect(r.outcome).toBe('warn');
      expect(r.detail).toMatchObject({ state: 'suspended' });
    });

    it('warns rather than failing where there is no graph at all', async () => {
      (globalThis as any).window = {};
      expect((await audioGraphCheck().run()).outcome).toBe('warn');
    });
  });

  describe('whether the app can set its own volume', () => {
    it('passes when the assignment reaches the audio', async () => {
      const r = await elementVolumeCheck(() => volumeElement('honours')).run();
      expect(r.outcome).toBe('pass');
      expect(r.detail).toMatchObject({ wanted: 0.37, got: 0.37 });
    });

    it('fails when the setter is a no-op, which is WebKit on iOS', async () => {
      // The open question the whole Volume setting rests on: assignment is
      // IGNORED rather than refused, so a dead slider and a quiet clip look
      // identical from inside the app.
      const r = await elementVolumeCheck(() => volumeElement('ignores')).run();
      expect(r.outcome).toBe('fail');
      expect(r.detail).toMatchObject({ wanted: 0.37, got: 1 });
      expect(r.summary).toContain('hardware buttons');
    });

    it('fails rather than throwing where there is no element', async () => {
      expect((await elementVolumeCheck(() => null).run()).outcome).toBe('fail');
    });
  });

  describe('whether the microphone cue makes a sound', () => {
    function installToneElement(behaviour: 'ends' | 'stalls' | 'refuses' | 'errors') {
      class ToneEl {
        src = '';
        volume = 1;
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        play(): Promise<void> {
          if (behaviour === 'refuses') {
            return Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
          }
          if (behaviour === 'ends') setTimeout(() => this.onended?.(), 10);
          if (behaviour === 'errors') setTimeout(() => this.onerror?.(), 10);
          return Promise.resolve();
        }
      }
      (globalThis as any).window = { Audio: ToneEl };
    }

    it('passes when the tone plays to the end', async () => {
      installToneElement('ends');
      const r = await chimeAudibleCheck().run();
      expect(r.outcome).toBe('pass');
      expect(r.detail).toMatchObject({ how: 'ended' });
    });

    it('fails when it starts and never finishes', async () => {
      // Both shapes of "I didn't hear any chime": masked under a prompt, then
      // synthesised into a suspended graph. The app believed it chimed.
      vi.useFakeTimers();
      try {
        installToneElement('stalls');
        const pending = chimeAudibleCheck().run();
        await vi.advanceTimersByTimeAsync(2_500);
        const r = await pending;
        expect(r.outcome).toBe('fail');
        expect(r.detail).toMatchObject({ how: 'timeout' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('fails when the phone refuses to play it', async () => {
      installToneElement('refuses');
      const r = await chimeAudibleCheck().run();
      expect(r.outcome).toBe('fail');
      expect(r.detail).toMatchObject({ why: 'NotAllowedError' });
    });
  });

  describe('a warn that can be acted on', () => {
    it('says how long it waited and whether the slot was held', async () => {
      /**
       * THE 2026-10-04 READING: `car-check:wheel-press outcome=warn`, twice,
       * with no detail at all. The verdict is right -- "nobody pressed" and
       * "the car sent it elsewhere" genuinely cannot be told apart from inside
       * the app -- but a bare warn gives the operator nothing to weigh. Twelve
       * seconds or one and a half? Was the media hold even playing at the
       * time, which is the precondition for a press arriving at all?
       *
       * Both are known at the moment the warn is written, and both change what
       * to do next.
       */
      const r = await wheelPressCheck(120).run();
      expect(r.outcome).toBe('warn');
      expect(r.detail).toMatchObject({ waitedMs: 120, slotHeld: false });
      expect(r.summary).toContain('0.1 seconds');
    });
  });

  describe('whether a recorded line plays at its own speed', () => {
    /**
     * `startMs` is how long the element takes to actually START -- decode,
     * buffer, and on a phone the audio route being set up. `playMs` is the
     * sound itself.
     */
    function timedClip(durationS: number, playMs: number, startMs = 0): HTMLAudioElement {
      const el: Record<string, unknown> = {
        duration: durationS,
        readyState: 1,
        pause: () => {},
        load: () => {},
        onended: null,
        onerror: null,
        onplaying: null,
        onloadedmetadata: null,
      };
      el.play = () => {
        setTimeout(() => {
          (el.onplaying as (() => void) | null)?.();
          setTimeout(() => (el.onended as (() => void) | null)?.(), playMs);
        }, startMs);
        return Promise.resolve();
      };
      return el as unknown as HTMLAudioElement;
    }

    it('times the SOUND, not the wait before it', async () => {
      /**
       * THE 2026-10-04 READING: ratio 1.26 and 1.23 on two runs of a clip that
       * was not being stretched at all. The clock started at the `play()` CALL,
       * so ~170ms of decode and audio-route setup on a 696ms line was reported
       * as a 25% stretch.
       *
       * Two costs, and the second is the one that matters. It accuses the phone
       * of a fault it does not have -- and it eats the detection margin: with a
       * 1.4 tolerance and a 1.25 baseline there was 0.15 left, and the fault
       * this check exists for measured 1.47x. One more slow start and a real
       * stretch would have passed as normal.
       */
      vi.useFakeTimers();
      try {
        const pending = clipSpeedCheck(() => timedClip(1.0, 1_000, 400)).run();
        await vi.advanceTimersByTimeAsync(3_000);
        const r = await pending;
        expect(r.outcome).toBe('pass');
        const d = r.detail as { ratio: number; startMs: number };
        // 1.4 would be the old reading: 400ms of startup on a 1000ms line.
        expect(d.ratio).toBeLessThanOrEqual(1.05);
        // And the wait is not thrown away -- a slow first word is its own
        // symptom in a car, so it is reported rather than silently excluded.
        expect(d.startMs).toBeGreaterThanOrEqual(400);
      } finally {
        vi.useRealTimers();
      }
    });

    it('passes when the wall time matches the recording', async () => {
      const r = await clipSpeedCheck(() => timedClip(1.0, 30)).run();
      expect(r.outcome).toBe('pass');
      expect((r.detail as { ratio: number }).ratio).toBeLessThanOrEqual(1.4);
    });

    it('fails when something stretches it, which is what the gain node did', async () => {
      /**
       * The readings this exists for, from the phone on 2026-10-02:
       *   3029ms -> 4455ms at 200%   (1.47x)
       *   3099ms -> 7687ms at 150%   (2.48x)
       * Reported as "150% is choppy and 200% is just silent".
       */
      vi.useFakeTimers();
      try {
        const pending = clipSpeedCheck(() => timedClip(1.0, 2_500)).run();
        await vi.advanceTimersByTimeAsync(3_000);
        const r = await pending;
        expect(r.outcome).toBe('fail');
        expect((r.detail as { ratio: number }).ratio).toBeGreaterThan(2);
        expect(r.summary).toContain('choppy');
      } finally {
        vi.useRealTimers();
      }
    });

    it('warns rather than failing when the clip never loads', async () => {
      // "We did not find out" is not "it is broken", and the two must not
      // share a verdict on a roadside.
      vi.useFakeTimers();
      try {
        const el = { readyState: 0, load: () => {}, onloadedmetadata: null, onerror: null };
        const pending = clipSpeedCheck(() => el as unknown as HTMLAudioElement).run();
        await vi.advanceTimersByTimeAsync(6_000);
        expect((await pending).outcome).toBe('warn');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('which speaker the voice came out of', () => {
    it('runs in the microphone phase, because that is what moves the route', () => {
      // An output-route question asked before anything opened the microphone
      // would be asked in the one state where the answer is never in doubt.
      expect(outputRouteCheck(async () => 'ended').phase).toBe('microphone');
    });

    it('asks the operator rather than answering itself', async () => {
      (globalThis as any).window = {};
      Object.defineProperty(globalThis, 'navigator', {
        value: { audioSession: { type: 'play-and-record' } },
        configurable: true,
        writable: true,
      });
      const check = outputRouteCheck(async () => 'ended');
      expect(check.askOperator).toBeTruthy();
      const r = await check.run();
      // Never a pass: the session type says what the app ASKED for, and the
      // speaker is what the cabin HEARD. Those came apart once already.
      expect(r.outcome).toBe('warn');
      expect(r.detail).toMatchObject({ sessionType: 'play-and-record', how: 'ended' });
      delete (globalThis as { navigator?: unknown }).navigator;
    });

    it('fails rather than asking when nothing played', async () => {
      /**
       * THE 2026-10-04 READING, which is why this test exists.
       * `car-check:output-route outcome=fail why=NotAllowedError`, twice in
       * one sitting, and Jack was never asked the question. A fresh `Audio`
       * forty seconds past the gesture is locked; the pool's elements are not.
       *
       * A check with nothing to listen to must say THAT, not grade the route.
       */
      const r = await outputRouteCheck(async () => 'NotAllowedError').run();
      expect(r.outcome).toBe('fail');
      expect(r.summary).toContain('Nothing played');
      expect(r.detail).toMatchObject({ how: 'NotAllowedError' });
    });
  });
});
