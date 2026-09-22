import { describe, it, expect, vi } from 'vitest';
import {
  audioOutCheck,
  wheelPressCheck,
  ambientCheck,
  clipVoiceCheck,
} from './carCheckCatalog';
import { foldFrames } from './ambientNoise';
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
