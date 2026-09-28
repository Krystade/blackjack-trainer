import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  speak, speakAsync, chime, chimeFrequencyForTest, isSpeechSupported, listVoices, cancelSpeech, pickBestVoice,
  getLastSpoken, repeatLast, _resetLastSpokenForTest, _resetSharedAudioContextForTest,
  lastSpeechPath, _resetSpeechPathForTest,
  setSpeechActivityListener,
} from './speech';
import { readDiagnosticLog, clearDiagnosticLog } from '../diag/diagnosticLog';

describe('speech wrapper — absence guards (no browser APIs in jsdom/node)', () => {
  it('speak() does not throw when speechSynthesis is unavailable', () => {
    expect(() => speak('hello')).not.toThrow();
  });
  it('chime() does not throw when AudioContext is unavailable', () => {
    expect(() => chime('good')).not.toThrow();
  });
  it('isSpeechSupported() returns false without speechSynthesis', () => {
    expect(isSpeechSupported()).toBe(false);
  });
  it('listVoices() returns [] without speechSynthesis', () => {
    expect(listVoices()).toEqual([]);
  });
  it('cancelSpeech() does not throw when speechSynthesis is unavailable', () => {
    expect(() => cancelSpeech()).not.toThrow();
  });
});

describe('speech wrapper — e2e log mode', () => {
  beforeEach(() => {
    (globalThis as any).window = {
      location: { search: '?e2e=1' },
    };
    (globalThis as any).window.__speechLog = undefined;
  });
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('records speak() text into window.__speechLog instead of speaking', () => {
    speak('Win, plus two');
    expect((globalThis as any).window.__speechLog).toEqual(['Win, plus two']);
  });
  it('records chimes in the same ordered log', () => {
    speak('Correct');
    chime('good');
    expect((globalThis as any).window.__speechLog).toEqual(['Correct', 'chime:good']);
  });

  /**
   * F2b: every chime reaches the diagnostic log.
   *
   * The only line `chime()` used to write was `chime-suspended`, so a sound
   * the app made was in the export exactly when it FAILED to make it. On this
   * app that is not cosmetic: a chime is a Web Audio activation and an audio
   * session event, and the field test's route samples measure where an audio
   * session sends things. Only the post-microphone cells were getting an
   * arrival chime, which correlated the acoustic run-up with the independent
   * variable and left no trace of it at all.
   */
  it('writes every chime to the diagnostic log, not only the failures', () => {
    clearDiagnosticLog();
    chime('good');
    chime('blocked');
    chime('mark', { volume: 0.5 });
    const chimes = readDiagnosticLog().filter((e) => e.category === 'speak' && e.event === 'chime');
    expect(chimes.map((e) => e.detail?.kind)).toEqual(['good', 'blocked', 'mark']);
    expect(chimes[2]?.detail?.volume, 'the volume a chime played at is not recorded').toBe(0.5);
  });

  /**
   * E3/E4: arming and refusal are audibly distinct from answering.
   *
   * A `modifier` answer arms a marker and leaves the step open while every
   * other answer stamps and advances, and both chimed `attention` -- so the
   * one fact an eyes-free operator needs after a tap was the one the sound
   * did not carry. A tap the screen refuses (the microphone gates, up to ten
   * seconds at a stretch, and the bounce guard) made no sound at all, which
   * is indistinguishable from missing the button.
   */
  it('gives arming and refusal tones of their own', () => {
    const tones = new Map<string, number>();
    for (const kind of ['good', 'bad', 'attention', 'mark', 'blocked'] as const) {
      clearDiagnosticLog();
      chime(kind);
      tones.set(kind, chimeFrequencyForTest(kind));
    }
    expect(tones.get('mark'), 'arming sounds exactly like answering').not.toBe(
      tones.get('attention'),
    );
    expect(tones.get('blocked'), 'a refused tap sounds like an answer').not.toBe(tones.get('bad'));
    expect(new Set(tones.values()).size, 'two tones are the same sound').toBe(tones.size);
  });
});

/* ------------------------------------------------------------------------ */
/* pickBestVoice — pure heuristic, plain-object fixtures, no browser needed */
/* ------------------------------------------------------------------------ */

function fakeVoice(overrides: {
  name: string;
  lang?: string;
  voiceURI?: string;
  localService?: boolean;
  default?: boolean;
}): SpeechSynthesisVoice {
  return {
    name: overrides.name,
    lang: overrides.lang ?? 'en-US',
    voiceURI: overrides.voiceURI ?? overrides.name,
    localService: overrides.localService ?? true,
    default: overrides.default ?? false,
  } as unknown as SpeechSynthesisVoice;
}

describe('pickBestVoice', () => {
  it('prefers a Google-named voice over legacy Microsoft Zira', () => {
    const google = fakeVoice({ name: 'Google US English' });
    const zira = fakeVoice({ name: 'Microsoft Zira Desktop' });
    expect(pickBestVoice([zira, google])).toBe(google);
  });

  it('prefers Natural/Neural voices over legacy David/Mark', () => {
    const natural = fakeVoice({ name: 'Microsoft Aria Online (Natural)' });
    const david = fakeVoice({ name: 'Microsoft David Desktop' });
    const mark = fakeVoice({ name: 'Microsoft Mark Desktop' });
    expect(pickBestVoice([david, mark, natural])).toBe(natural);
  });

  it('ranks macOS novelty voices below a neutral built-in voice', () => {
    const albert = fakeVoice({ name: 'Albert' });
    const badNews = fakeVoice({ name: 'Bad News' });
    const zarvox = fakeVoice({ name: 'Zarvox' });
    const neutral = fakeVoice({ name: 'Samantha' });
    expect(pickBestVoice([albert, badNews, zarvox, neutral])).toBe(neutral);
  });

  it('scores eSpeak (any case) below a neutral voice', () => {
    const espeak = fakeVoice({ name: 'espeak-ng English' });
    const neutral = fakeVoice({ name: 'Samantha' });
    expect(pickBestVoice([espeak, neutral])).toBe(neutral);
  });

  it('prefers an en-US voice over an fr-FR voice (default target lang)', () => {
    const en = fakeVoice({ name: 'Voice', lang: 'en-US', voiceURI: 'en-voice' });
    const fr = fakeVoice({ name: 'Voice', lang: 'fr-FR', voiceURI: 'fr-voice' });
    expect(pickBestVoice([fr, en])).toBe(en);
  });

  it('prefers other en-* voices over non-English when no exact target match exists', () => {
    const enGB = fakeVoice({ name: 'Voice', lang: 'en-GB', voiceURI: 'engb-voice' });
    const fr = fakeVoice({ name: 'Voice', lang: 'fr-FR', voiceURI: 'fr-voice' });
    expect(pickBestVoice([fr, enGB], 'en-US')).toBe(enGB);
  });

  it('honors an explicit target lang argument other than en-US', () => {
    const en = fakeVoice({ name: 'Voice', lang: 'en-US', voiceURI: 'en-voice' });
    const fr = fakeVoice({ name: 'Voice', lang: 'fr-FR', voiceURI: 'fr-voice' });
    expect(pickBestVoice([en, fr], 'fr-FR')).toBe(fr);
  });

  it('returns null for an empty list', () => {
    expect(pickBestVoice([])).toBeNull();
  });

  it('is deterministic: repeated calls on the same list return the same voice', () => {
    const voices = [
      fakeVoice({ name: 'Google UK English', voiceURI: 'a' }),
      fakeVoice({ name: 'Google US English', voiceURI: 'b' }),
      fakeVoice({ name: 'Samantha', voiceURI: 'c' }),
    ];
    const first = pickBestVoice(voices);
    const second = pickBestVoice(voices);
    expect(first).toBe(second);
    expect(first).not.toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* speak()/speakAsync() — voice resolution + pacing, fake browser env       */
/* ------------------------------------------------------------------------ */

class FakeUtterance {
  text: string;
  rate?: number;
  // Left undefined until speech.ts explicitly assigns it, so a test can tell
  // "never set" apart from "set to a value" (0 included).
  volume?: number;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function installFakeSpeechEnv(
  voices: SpeechSynthesisVoice[],
  fakeOpts?: { autoEnd?: boolean; search?: string },
): FakeUtterance[] {
  const spoken: FakeUtterance[] = [];
  cancelCount = 0;
  (globalThis as any).SpeechSynthesisUtterance = FakeUtterance;
  (globalThis as any).window = {
    location: { search: fakeOpts?.search ?? '' },
    speechSynthesis: {
      getVoices: () => voices,
      speak: (u: FakeUtterance) => {
        spoken.push(u);
        if (fakeOpts?.autoEnd !== false) {
          queueMicrotask(() => u.onend?.());
        }
      },
      cancel: () => {
        cancelCount += 1;
      },
    },
  };
  return spoken;
}

/** How many times the fake `speechSynthesis.cancel()` has been called since
 * the last `installFakeSpeechEnv` — the observable proof that a call
 * interrupted whatever was already speaking. */
let cancelCount = 0;
function fakeCancelCount(): number {
  return cancelCount;
}

function teardownFakeSpeechEnv(): void {
  delete (globalThis as any).window;
  delete (globalThis as any).SpeechSynthesisUtterance;
}

describe('speak() — automatic voice resolution', () => {
  afterEach(teardownFakeSpeechEnv);

  it('matches a stored voiceURI by name when voiceURI values differ (iOS/Safari)', () => {
    // Safari can report an empty/different voiceURI for the same voice the
    // user previously selected by name on desktop — matching must fall back
    // to name so switching voices actually works there.
    const safariVoice = fakeVoice({ name: 'Samantha', voiceURI: '' });
    const spoken = installFakeSpeechEnv([safariVoice]);
    speak('hello', { voiceURI: 'Samantha' });
    expect(spoken[0].voice).toBe(safariVoice);
  });

  it('matches a stored voiceURI by voiceURI when it matches directly', () => {
    const voice = fakeVoice({ name: 'Google US English', voiceURI: 'Google US English' });
    const other = fakeVoice({ name: 'Other Voice', voiceURI: 'other-uri' });
    const spoken = installFakeSpeechEnv([other, voice]);
    speak('hello', { voiceURI: 'Google US English' });
    expect(spoken[0].voice).toBe(voice);
  });

  it('auto-picks the best voice when voiceURI is missing', () => {
    const google = fakeVoice({ name: 'Google US English', voiceURI: 'g' });
    const zira = fakeVoice({ name: 'Microsoft Zira Desktop', voiceURI: 'z' });
    const spoken = installFakeSpeechEnv([zira, google]);
    speak('hello');
    expect(spoken[0].voice).toBe(google);
  });

  it('auto-picks the best voice when voiceURI is "default"', () => {
    const google = fakeVoice({ name: 'Google US English', voiceURI: 'g' });
    const spoken = installFakeSpeechEnv([google]);
    speak('hello', { voiceURI: 'default' });
    expect(spoken[0].voice).toBe(google);
  });

  it('leaves voice unset (does not silently substitute) when an explicit voiceURI matches nothing', () => {
    const google = fakeVoice({ name: 'Google US English', voiceURI: 'g' });
    const spoken = installFakeSpeechEnv([google]);
    expect(() => speak('hello', { voiceURI: 'some-stale-uri' })).not.toThrow();
    expect(spoken[0].voice).toBeNull();
  });
});

describe('speakAsync()', () => {
  afterEach(teardownFakeSpeechEnv);

  it('resolves immediately in an unsupported environment (no window)', async () => {
    await expect(speakAsync('hello')).resolves.toBeUndefined();
  });

  it('resolves and logs in e2e mode, without touching real speech APIs', async () => {
    (globalThis as any).window = { location: { search: '?e2e=1' } };
    await expect(speakAsync('Win, plus two')).resolves.toBeUndefined();
    expect((globalThis as any).window.__speechLog).toEqual(['Win, plus two']);
  });

  it('resolves once the utterance fires onend', async () => {
    installFakeSpeechEnv([], { autoEnd: true });
    await expect(speakAsync('hi')).resolves.toBeUndefined();
  });

  it('resolves once the utterance fires onerror', async () => {
    (globalThis as any).SpeechSynthesisUtterance = FakeUtterance;
    (globalThis as any).window = {
      location: { search: '' },
      speechSynthesis: {
        getVoices: () => [],
        speak: (u: FakeUtterance) => queueMicrotask(() => u.onerror?.()),
        cancel: () => {},
      },
    };
    await expect(speakAsync('hi')).resolves.toBeUndefined();
  });

  it('cancelSpeech() settles a pending speakAsync promise (onend never fires)', async () => {
    installFakeSpeechEnv([], { autoEnd: false });
    const promise = speakAsync('hi');
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);
    cancelSpeech();
    await promise;
    expect(settled).toBe(true);
  });

  it('an {interrupt: true} call settles the previous pending promise', async () => {
    installFakeSpeechEnv([], { autoEnd: false });
    const first = speakAsync('first');
    let firstSettled = false;
    void first.then(() => {
      firstSettled = true;
    });
    expect(firstSettled).toBe(false);
    const second = speakAsync('second', { interrupt: true });
    await first;
    expect(firstSettled).toBe(true);
    // second is still pending (autoEnd: false); settle it via cancelSpeech so
    // the test doesn't wait out the watchdog.
    cancelSpeech();
    await second;
  });
});

/* ------------------------------------------------------------------------ */
/* opts.volume — speaking volume, 0..1                                      */
/* ------------------------------------------------------------------------ */

describe('speak()/speakAsync() — opts.volume', () => {
  afterEach(teardownFakeSpeechEnv);

  it('applies opts.volume to the utterance', () => {
    const spoken = installFakeSpeechEnv([]);
    speak('hello', { volume: 0.4 });
    expect(spoken[0].volume).toBe(0.4);
  });

  it('applies a volume of 0 (silence is a real setting, not "unset")', () => {
    // The rate path guards with a truthiness check, which would silently drop
    // a 0 here — volume must be presence-checked instead.
    const spoken = installFakeSpeechEnv([]);
    speak('hello', { volume: 0 });
    expect(spoken[0].volume).toBe(0);
  });

  it('leaves the utterance volume untouched when none is given (engine default)', () => {
    const spoken = installFakeSpeechEnv([]);
    speak('hello');
    expect(spoken[0].volume).toBeUndefined();
  });

  it('applies opts.volume on the speakAsync path too', async () => {
    const spoken = installFakeSpeechEnv([], { autoEnd: true });
    await speakAsync('hello', { volume: 0.25 });
    expect(spoken[0].volume).toBe(0.25);
  });
});

/* ------------------------------------------------------------------------ */
/* chime() — volume scaling of the tone's gain peak                         */
/* ------------------------------------------------------------------------ */

interface RampCall {
  value: number;
  time: number;
}

/**
 * Minimal Web Audio stand-in that records the gain envelope chime() builds,
 * so the peak can be asserted without a real AudioContext.
 */
function installFakeAudioContextEnv(): { ramps: RampCall[] } {
  const ramps: RampCall[] = [];
  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    createOscillator() {
      return {
        type: '',
        frequency: { value: 0 },
        connect: () => {},
        start: () => {},
        stop: () => {},
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: () => {},
          linearRampToValueAtTime: (value: number, time: number) => {
            ramps.push({ value, time });
          },
        },
        connect: () => {},
      };
    }
  }
  (globalThis as any).window = { location: { search: '' }, AudioContext: FakeAudioContext };
  return { ramps };
}

describe('chime() — volume', () => {
  // The shared AudioContext is memoized for the page's lifetime, so without
  // this each test after the first would chime into the PREVIOUS test's fake
  // and record nothing into its own `ramps`.
  beforeEach(() => _resetSharedAudioContextForTest());
  afterEach(() => {
    _resetSharedAudioContextForTest();
    delete (globalThis as any).window;
  });

  it('scales the tone\'s gain peak by opts.volume', () => {
    const env = installFakeAudioContextEnv();
    chime('good', { volume: 0.5 });
    // First ramp is the attack to the peak; second is the release to silence.
    expect(env.ramps[0].value).toBeCloseTo(0.25, 5);
    expect(env.ramps[1].value).toBe(0);
  });

  // The peak was 0.3 for most of this app's life, leaving most of the
  // available headroom unused -- a bare oscillator reaches full scale at 1.0.
  // The operator asked for more volume, and the chime was the one path with
  // room to give it for free (see audio/volume.ts). Now 0.5 at full volume.
  it('uses the full-volume peak when no volume is given', () => {
    const env = installFakeAudioContextEnv();
    chime('good');
    expect(env.ramps[0].value).toBeCloseTo(0.5, 5);
  });

  // The boost ceiling reaches the chime too, but a bare oscillator clips
  // above full scale, so the envelope must saturate rather than overshoot.
  it('never rings above full scale even at the boost ceiling', () => {
    const env = installFakeAudioContextEnv();
    chime('good', { volume: 2 });
    expect(env.ramps[0].value).toBeLessThanOrEqual(1);
    expect(env.ramps[0].value).toBeGreaterThan(0.5);
  });
});

/* ------------------------------------------------------------------------ */
/* Last-utterance tracking — getLastSpoken / repeatLast                     */
/* ------------------------------------------------------------------------ */

describe('last-utterance tracking', () => {
  beforeEach(() => {
    _resetLastSpokenForTest();
    _resetSpeechPathForTest();
  });
  afterEach(() => {
    _resetLastSpokenForTest();
    teardownFakeSpeechEnv();
  });

  it('reports nothing spoken before anything has been said', () => {
    expect(getLastSpoken()).toBeNull();
  });

  it('remembers the text passed to speak()', () => {
    installFakeSpeechEnv([]);
    speak('You have ace, three.');
    expect(getLastSpoken()).toBe('You have ace, three.');
  });

  it('remembers the text passed to speakAsync()', async () => {
    installFakeSpeechEnv([], { autoEnd: true });
    await speakAsync('Dealer shows ten.');
    expect(getLastSpoken()).toBe('Dealer shows ten.');
  });

  it('remembers text spoken in e2e log mode as well', () => {
    (globalThis as any).window = { location: { search: '?e2e=1' } };
    speak('Win, plus two');
    expect(getLastSpoken()).toBe('Win, plus two');
  });

  it('does NOT count a chime as an utterance', () => {
    installFakeSpeechEnv([]);
    speak('Correct.');
    chime('good');
    expect(getLastSpoken()).toBe('Correct.');
  });

  it('does not count a chime in e2e log mode either', () => {
    (globalThis as any).window = { location: { search: '?e2e=1' } };
    speak('Correct.');
    chime('bad');
    expect(getLastSpoken()).toBe('Correct.');
  });

  it('repeatLast() re-speaks the stored text and reports that it did', () => {
    const spoken = installFakeSpeechEnv([]);
    speak('You have sixteen.');
    expect(repeatLast()).toBe(true);
    expect(spoken.map((u) => u.text)).toEqual(['You have sixteen.', 'You have sixteen.']);
  });

  it('repeatLast() applies the opts it is given', () => {
    const spoken = installFakeSpeechEnv([]);
    speak('You have sixteen.');
    repeatLast({ rate: 2, volume: 0.5 });
    expect(spoken[1].rate).toBe(2);
    expect(spoken[1].volume).toBe(0.5);
  });

  it('repeatLast() interrupts whatever is speaking, without being told to', () => {
    // A repeat that queues behind the utterance being repeated would leave
    // the user waiting through it twice.
    installFakeSpeechEnv([]);
    speak('You have sixteen.');
    const before = fakeCancelCount();
    repeatLast();
    expect(fakeCancelCount()).toBe(before + 1);
  });

  it('repeatLast() re-speaks at the volume the line was said with, not the engine default', () => {
    // THE WHEEL BUG. `previoustrack` calls `repeatLast()` with no arguments,
    // so before the options were remembered the repeat reached the engine
    // with `volume === undefined` and played at 1 -- out loud, at full
    // volume, while the app was muted. Muting is implemented AS volume zero,
    // so this is the mute switch failing, not a cosmetic difference.
    const spoken = installFakeSpeechEnv([]);
    speak('You have sixteen.', { volume: 0, rate: 1.4 });
    expect(repeatLast()).toBe(true);
    expect(spoken[1].volume).toBe(0);
    expect(spoken[1].rate).toBe(1.4);
  });

  it("repeatLast()'s own opts still win over the remembered ones", () => {
    const spoken = installFakeSpeechEnv([]);
    speak('You have sixteen.', { volume: 0.2, rate: 1.4 });
    repeatLast({ volume: 0.9 });
    expect(spoken[1].volume).toBe(0.9);
    // Not overridden, so the remembered one still applies.
    expect(spoken[1].rate).toBe(1.4);
  });

  it('repeating twice does not let the options drift either', () => {
    // `speak()` inside `repeatLast()` re-records, so without care the second
    // repeat would inherit the FIRST repeat's merged options rather than the
    // original utterance's -- the same reason the text is restored.
    const spoken = installFakeSpeechEnv([]);
    speak('You have sixteen.', { volume: 0.2 });
    repeatLast({ volume: 0.9 });
    repeatLast();
    expect(spoken[2].volume).toBe(0.2);
  });

  it('a repeat is not tagged as the utterance that asked for the original', () => {
    // A tag correlates ONE request with ONE `speak path` entry. Carrying it
    // onto the repeat would file the repeat's path record under the original
    // request, which is precisely the adjacency confusion tags exist to end.
    const spoken = installFakeSpeechEnv([]);
    speak('You have sixteen.', { volume: 0.2, tag: 'route-1#1' });
    repeatLast();
    expect(spoken).toHaveLength(2);
    expect(lastSpeechPath()?.tag).toBeUndefined();
  });

  it('repeatLast() does nothing and returns false with nothing to repeat', () => {
    const spoken = installFakeSpeechEnv([]);
    expect(repeatLast()).toBe(false);
    expect(spoken).toEqual([]);
  });

  it('a repeat does not itself become a new "last spoken" entry to chime over', () => {
    installFakeSpeechEnv([]);
    speak('You have sixteen.');
    repeatLast();
    chime('good');
    expect(getLastSpoken()).toBe('You have sixteen.');
  });
});

/**
 * A chime deafens the microphone for its own duration.
 *
 * The cue that says "I did not understand you" plays in response to something
 * not understood, while the microphone is open. If the microphone could hear
 * that tone and reject it in turn, the cue would answer itself -- so the
 * speaker tells the microphone about every sound it makes, not just words.
 */
describe('chime and the microphone', () => {
  it('tells the microphone how long it will be making a noise', () => {
    const seen: number[] = [];
    setSpeechActivityListener((ms) => seen.push(ms));
    chime('attention');
    setSpeechActivityListener(null);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThan(0);
  });

  it('does so for every kind of chime, not only the cue', () => {
    const seen: number[] = [];
    setSpeechActivityListener((ms) => seen.push(ms));
    chime('good');
    chime('bad');
    chime('attention');
    setSpeechActivityListener(null);
    expect(seen).toHaveLength(3);
  });

  /**
   * IN E2E MODE TOO, which is the case that actually needs pinning.
   *
   * Under `?e2e=1` the tone is never synthesised -- it is written to a log
   * instead -- but the microphone's bookkeeping is behaviour under test, not
   * part of the sound. Notifying after that short-circuit would leave every
   * end-to-end run exercising a chime that does not deafen anything, which is
   * precisely the arrangement the real app must not ship.
   */
  it('deafens the microphone even where the tone is only logged', () => {
    (globalThis as unknown as { window: unknown }).window = {
      location: { search: '?e2e=1' },
    };
    const seen: number[] = [];
    setSpeechActivityListener((ms) => seen.push(ms));
    chime('attention');
    setSpeechActivityListener(null);
    const logged = (globalThis as unknown as { window: { __speechLog?: string[] } }).window
      .__speechLog;
    delete (globalThis as unknown as { window?: unknown }).window;

    expect(logged).toEqual(['chime:attention']);
    expect(seen, 'the microphone must be told even in e2e mode').toHaveLength(1);
  });

  // A listener that throws is a bug in the microphone's bookkeeping, and must
  // never stop the app making a sound.
  it('still chimes when the listener throws', () => {
    setSpeechActivityListener(() => {
      throw new Error('bookkeeping broke');
    });
    expect(() => chime('attention')).not.toThrow();
    setSpeechActivityListener(null);
  });
});

/* ------------------------------------------------------------------------ */
/* Both entry points deafen the microphone, not just one                     */
/* ------------------------------------------------------------------------ */

/**
 * `speakAsync` did not tell the microphone it was talking, and nothing noticed
 * for as long as the function existed.
 *
 * `notifySpeechActivity` had exactly one call site in `speak()`. The field
 * test speaks EXCLUSIVELY through `speakAsync`, so `suppressFor()` was never
 * called on any microphone step: the live recogniser heard the app's own line
 * and transcribed it as the operator's answer. On `mic-heard` the app asks
 * "Did you have it?", the operator is told to say "double", and "It heard the
 * wrong thing" became the honest tap for a microphone working perfectly --
 * manufacturing the exact fault the step exists to detect. `looksLikeSelfEcho`
 * cannot help: it is only consulted on a `suppressed` verdict, and there were
 * none. The count drill is the other caller and lost suppression too.
 *
 * Asserted as a property of BOTH functions from one table, so a third entry
 * point cannot be added with only half the contract.
 */
describe('every speaking entry point tells the microphone', () => {
  const entryPoints: [string, (text: string, opts?: { rate?: number }) => unknown][] = [
    ['speak', speak],
    ['speakAsync', speakAsync],
  ];

  afterEach(() => {
    setSpeechActivityListener(null);
    delete (globalThis as { window?: unknown }).window;
  });

  for (const [name, fn] of entryPoints) {
    it(`${name}() opens the suppression window`, () => {
      const seen: number[] = [];
      setSpeechActivityListener((ms) => seen.push(ms));
      fn('Basic hit versus dealer nine.');
      expect(seen, `${name} never notified the microphone`).toHaveLength(1);
      expect(seen[0]).toBeGreaterThan(0);
    });

    it(`${name}() notifies even where the utterance is only logged`, () => {
      // The e2e short-circuit is BELOW the notification in both, because the
      // microphone's bookkeeping is behaviour under test rather than part of
      // the sound. Notifying after it would leave every browser test
      // exercising speech that deafens nothing.
      (globalThis as unknown as { window: unknown }).window = {
        location: { search: '?e2e=1' },
      };
      const seen: number[] = [];
      setSpeechActivityListener((ms) => seen.push(ms));
      fn('Basic hit versus dealer nine.');
      expect(seen).toHaveLength(1);
    });

    it(`${name}() scales the window by the rate it was given`, () => {
      const slow: number[] = [];
      setSpeechActivityListener((ms) => slow.push(ms));
      fn('Basic hit versus dealer nine.', { rate: 0.5 });
      setSpeechActivityListener(null);

      const fast: number[] = [];
      setSpeechActivityListener((ms) => fast.push(ms));
      fn('Basic hit versus dealer nine.', { rate: 2 });

      expect(slow[0]).toBeGreaterThan(fast[0]!);
    });
  }
});

/**
 * A suspended context makes the chime SILENT, not quiet -- and the field test
 * now leans on chimes for two things it cannot do without: the arrival cue on
 * its six silent steps, and "I did not understand you" on the microphone step.
 *
 * `resumeSharedAudioContext` had exactly one caller in the app, inside
 * `amplify()`, which runs only when the volume is above 1. So on any run where
 * the boost is not in play -- clips off, or after a step pins the volume to 1
 * -- nothing ever nudged the context, the chime made no sound, and `chime()`
 * logged nothing at all. A cue that silently does not happen is worse than no
 * cue: on the microphone step it manufactures the fault it exists to rule out.
 */
describe('chime() — a context that is asleep', () => {
  beforeEach(() => _resetSharedAudioContextForTest());
  afterEach(() => {
    _resetSharedAudioContextForTest();
    clearDiagnosticLog();
    delete (globalThis as any).window;
  });

  function installSuspendedContext(opts: { resumesTo?: string } = {}) {
    const calls = { resume: 0 };
    class SuspendedContext {
      state = 'suspended';
      currentTime = 0;
      destination = {};
      resume() {
        calls.resume += 1;
        if (opts.resumesTo) this.state = opts.resumesTo;
        return Promise.resolve();
      }
      createOscillator() {
        return {
          type: '',
          frequency: { value: 0 },
          connect: () => {},
          start: () => {},
          stop: () => {},
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
          connect: () => {},
        };
      }
    }
    (globalThis as any).window = { location: { search: '' }, AudioContext: SuspendedContext };
    return calls;
  }

  it('nudges a suspended context awake before sounding', () => {
    const calls = installSuspendedContext({ resumesTo: 'running' });
    clearDiagnosticLog();
    chime('good');
    expect(calls.resume, 'the chime played into a suspended context').toBe(1);
  });

  it('says so in the log when the context is still not running', () => {
    installSuspendedContext();
    clearDiagnosticLog();
    chime('attention');

    const entry = readDiagnosticLog().find((e) => e.event === 'chime-suspended');
    expect(entry, 'a chime that could make no sound left no trace').toBeTruthy();
    expect(entry?.detail?.kind).toBe('attention');
    expect(entry?.detail?.state).toBe('suspended');
  });

  it('says nothing when the context is running', () => {
    installSuspendedContext({ resumesTo: 'running' });
    clearDiagnosticLog();
    chime('good');
    expect(readDiagnosticLog().some((e) => e.event === 'chime-suspended')).toBe(false);
  });
});

/**
 * The TTS path had no ending at all, and it is every drill line in the app.
 *
 * `speak path path=tts said="..."` is written BEFORE the engine is touched, and
 * `speakAsyncLive` resolved identically whether speech was unsupported (no
 * utterance ever existed), the utterance errored, the watchdog gave up, or it
 * ran cleanly to the end. So the one question the log exists to answer -- did it
 * actually say it? -- was unanswerable for most of the log. The clips path has
 * carried a reason code since round 2; this is its counterpart.
 */
describe('speak tts-end — how a live utterance finished', () => {
  function installSynth(opts: { fire?: 'end' | 'error' | 'none' } = {}) {
    const spoken: string[] = [];
    let lastUtterance: FakeUtterance | null = null;
    class FakeUtterance {
      text: string;
      rate = 1;
      volume = 1;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    (globalThis as any).window = {
      location: { search: '' },
      SpeechSynthesisUtterance: FakeUtterance,
      speechSynthesis: {
        speak: (u: FakeUtterance) => {
          spoken.push(u.text);
          lastUtterance = u;
          const fire = opts.fire ?? 'end';
          if (fire === 'end') queueMicrotask(() => u.onend?.());
          if (fire === 'error') queueMicrotask(() => u.onerror?.());
        },
        cancel: () => {},
        getVoices: () => [],
      },
    };
    (globalThis as any).SpeechSynthesisUtterance = FakeUtterance;
    return { spoken, last: () => lastUtterance };
  }

  afterEach(() => {
    clearDiagnosticLog();
    delete (globalThis as any).window;
    delete (globalThis as any).SpeechSynthesisUtterance;
    _resetLastSpokenForTest();
  });

  /**
   * The fire-and-forget twin goes through the same retained, watched
   * utterance as the awaited one. Its own live path wrote no `tts-end` and
   * kept no reference to the utterance, so on a Safari that collects it the
   * hold re-assert hung on `onend` never ran and the log never said the
   * line had ended.
   */
  it('is written for speak() too, not only for speakAsync()', async () => {
    installSynth({ fire: 'end' });
    clearDiagnosticLog();
    speak('Did you have it?');
    await Promise.resolve();
    await Promise.resolve();

    const end = readDiagnosticLog().find((e) => e.event === 'tts-end');
    expect(end, 'the fire-and-forget line ended without a tts-end row').toBeTruthy();
    expect(end?.detail).toMatchObject({ reason: 'ended', said: 'Did you have it?' });
  });

  /**
   * `say-start volume=1.5` records a REQUEST. `utteranceVolume` clamps live TTS
   * at 1 -- only the clips path can exceed it -- so the reader takes a number
   * for a setting the engine never honoured.
   */
  it('records the volume the engine actually got, not the one asked for', async () => {
    installSynth({ fire: 'end' });
    clearDiagnosticLog();
    await speakAsync('Loud please', { volume: 1.5 });

    const end = readDiagnosticLog().find((e) => e.event === 'tts-end');
    expect(end?.detail?.volume, 'the clamped volume was reported as the requested one').toBe(1);
  });

  it('says when the chosen voice was not available and another was used', async () => {
    installSynth({ fire: 'end' });
    clearDiagnosticLog();
    await speakAsync('Hit or stand', { voiceURI: 'a-voice-not-installed-here' });

    const end = readDiagnosticLog().find((e) => e.event === 'tts-end');
    expect(end?.detail?.voiceSubstituted, 'a silent voice substitution left no trace').toBe(true);
  });

  it('does not call the default voice a substitution', async () => {
    installSynth({ fire: 'end' });
    clearDiagnosticLog();
    await speakAsync('Hit or stand');

    const end = readDiagnosticLog().find((e) => e.event === 'tts-end');
    expect(end?.detail?.voiceSubstituted).toBeUndefined();
  });

  it('records a clean utterance as ended, with what was said', async () => {
    installSynth({ fire: 'end' });
    clearDiagnosticLog();
    await speakAsync('Hit or stand');

    const end = readDiagnosticLog().find((e) => e.event === 'tts-end');
    expect(end, 'a live utterance finished with no entry at all').toBeTruthy();
    expect(end?.detail?.reason).toBe('ended');
    expect(end?.detail?.said).toBe('Hit or stand');
  });

  it('distinguishes an errored utterance from a clean one', async () => {
    installSynth({ fire: 'error' });
    clearDiagnosticLog();
    await speakAsync('Hit or stand');

    const end = readDiagnosticLog().find((e) => e.event === 'tts-end');
    expect(end?.detail?.reason, 'an error was indistinguishable from success').toBe('error');
  });

  it('says so when there is no synthesiser at all, rather than claiming an utterance', async () => {
    // No `window.speechSynthesis` -- the path record is already written by the
    // caller at this point, so silence here means the export asserts a line the
    // device could never have spoken.
    clearDiagnosticLog();
    await speakAsync('Hit or stand');

    const end = readDiagnosticLog().find((e) => e.event === 'tts-end');
    expect(end?.detail?.reason).toBe('error');
    expect(end?.detail?.why).toBe('unsupported');
  });

  it('reports an interrupted utterance as cancelled, not as ended', async () => {
    installSynth({ fire: 'none' });
    clearDiagnosticLog();
    const inFlight = speakAsync('A long line nobody hears the end of');
    cancelSpeech();
    await inFlight;

    const ends = readDiagnosticLog().filter((e) => e.event === 'tts-end');
    expect(ends, 'an interrupted line had no ending at all').toHaveLength(1);
    expect(ends[0]?.detail?.reason).toBe('cancelled');
  });

  /**
   * Safari delivers a late `onend` after a cancel, and the watchdog can fire
   * before either. Without the settled guard the same utterance reports twice
   * with different reasons, and a reader counting endings counts more lines
   * than were ever spoken.
   */
  it('reports one ending even if the engine settles the same utterance twice', async () => {
    const synth = installSynth({ fire: 'none' });
    clearDiagnosticLog();
    const inFlight = speakAsync('One line');

    const u = synth.last();
    u?.onend?.();
    u?.onend?.();
    u?.onerror?.();
    await inFlight;

    const ends = readDiagnosticLog().filter((e) => e.event === 'tts-end');
    expect(ends, 'one utterance produced more than one ending').toHaveLength(1);
    expect(ends[0]?.detail?.reason).toBe('ended');
  });

  it('reports one ending per utterance, even when onend races the cancel', async () => {
    const synth = installSynth({ fire: 'none' });
    clearDiagnosticLog();
    const inFlight = speakAsync('One line');
    cancelSpeech();
    await inFlight;
    // A late onend, which Safari can still deliver after a cancel.
    expect(synth.spoken).toHaveLength(1);

    expect(readDiagnosticLog().filter((e) => e.event === 'tts-end')).toHaveLength(1);
  });
});
