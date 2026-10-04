import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetQuietWaitersForTest } from './speechActivity';
import { readDiagnosticLog, clearDiagnosticLog } from '../diag/diagnosticLog';
import { _resetClipsForTest } from './clips';
import { _resetToneCacheForTest } from './tone';
import { setOutputRoutePreference, _resetAudioSessionForTest } from './audioSession';
import {
  speak, speakAsync, chime, chimeFrequencyForTest, isSpeechSupported, listVoices, cancelSpeech, pickBestVoice,
  getLastSpoken, repeatLast, _resetLastSpokenForTest, _resetSharedAudioContextForTest,
  lastSpeechPath, _resetSpeechPathForTest,
  setSpeechActivityListener,
  chimeWhenQuiet,
  CUE_WAIT_CEILING_MS,
  primeVoices, _resetVoiceCacheForTest,
} from './speech';

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

  /**
   * THE VOICE THE CAR ACTUALLY GOT, 2026-09-29: `voice=Bahh`, a novelty
   * voice that bleats instead of speaking. Reported from the driver's seat
   * as "the voice it was using was fucked".
   *
   * It was not a glitch, it was the guaranteed outcome. Every en-US voice on
   * iOS scores the same -- 1000 for the language, 0 for the name -- so the
   * tie-break decided it, and the tie-break is alphabetical. `Albert` and
   * `Bad News` were penalised; the next name in the alphabet is `Bahh`. The
   * penalty list named three of Apple's novelty voices and Apple ships
   * about twenty.
   *
   * The list below is iOS 18's en-US set.
   */
  const IOS_EN_US = [
    'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos',
    'Fred', 'Good News', 'Jester', 'Junior', 'Kathy', 'Organ', 'Ralph',
    'Samantha', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox',
  ];

  it('does not read the drill out in a novelty voice on an iPhone', () => {
    const voices = IOS_EN_US.map((name) =>
      fakeVoice({ name, default: name === 'Samantha' }),
    );

    const picked = pickBestVoice(voices);

    expect(picked?.name, 'the car was read to in a joke voice').toBe('Samantha');
  });

  /**
   * ...AND NOT BECAUSE `Samantha` IS SPELLED INTO THE CODE. The platform
   * says which voice it considers default and the heuristic ignored it,
   * guessing from name substrings instead while the answer was on the
   * object. A denylist of joke voices is a losing game -- one unlisted name
   * that sorts early takes the drill -- so the default is what breaks a tie,
   * and the list is only there for platforms that nominate nothing.
   */
  /**
   * WHAT HAPPENS WHEN THE PHONE NOMINATES NOTHING, which is the case the
   * first version of this fix never considered and could not survive.
   *
   * Weighting `default` only helps if some voice reports it, and nothing in
   * this app has ever logged whether that iPhone does. With no nomination
   * every en-US voice ties again, the alphabetical tie-break decides again,
   * and from the real iOS list the winner was `Fred` -- the classic robotic
   * Apple voice, unlisted because the denylist was built for the NOVELTY
   * voices. Same bug as `Bahh`, one letter further down the alphabet.
   *
   * So the platform's nomination cannot be the only safeguard, and a denylist
   * cannot be either: this is the second name that walked through it. A small
   * allowlist of the voices Apple ships for actual speech carries the
   * fallback instead, ranked under a nomination and over a plain name.
   */
  it('does not fall back to a robotic voice when the phone nominates nothing', () => {
    const voices = IOS_EN_US.map((name) => fakeVoice({ name }));

    const picked = pickBestVoice(voices);

    expect(picked?.name, 'the alphabet picked the voice again').toBe('Samantha');
  });

  it('lets the platform break a tie with its own default voice', () => {
    const plain = fakeVoice({ name: 'Aaa Plain' });
    const chosen = fakeVoice({ name: 'Zzz Chosen', default: true });

    expect(pickBestVoice([plain, chosen])).toBe(chosen);
  });

  it('still prefers a genuinely better voice over the platform default', () => {
    const dflt = fakeVoice({ name: 'Samantha', default: true });
    const premium = fakeVoice({ name: 'Google US English' });

    expect(pickBestVoice([dflt, premium])).toBe(premium);
  });

  it('ranks every one of Apple’s novelty voices below a plain voice', () => {
    const plain = fakeVoice({ name: 'Zzz Plain Voice' });
    for (const name of [
      'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Jester', 'Organ',
      'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Good News', 'Albert',
      'Bad News', 'Zarvox',
    ]) {
      const novelty = fakeVoice({ name });
      expect(pickBestVoice([novelty, plain]), `${name} beat a plain voice`).toBe(plain);
    }
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

/**
 * The minimum element a generated tone needs. The chimes play through the
 * same pooled `HTMLAudioElement` path as the recorded clips since 2026-10-03
 * -- see audio/tone.ts for the export that forced it.
 */
class FakeChimeElement {
  src = '';
  volume = 1;
  muted = false;
  paused = true;
  played = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  load(): void {}
  pause(): void {
    this.paused = true;
  }
  play(): Promise<void> {
    this.played = true;
    this.paused = false;
    return Promise.resolve();
  }
}

describe('chime() — volume', () => {
  afterEach(() => {
    _resetClipsForTest();
    _resetToneCacheForTest();
    delete (globalThis as any).window;
  });

  /**
   * The level now rides on the ELEMENT, not on a gain envelope, because the
   * tone is a generated WAV played the way the clips are played. On Jack's
   * phone the oscillator version made no sound at all -- two `chime-suspended`
   * lines in the 2026-10-03 export, eight seconds after a gesture had resumed
   * the graph, while every recorded clip played. See audio/tone.ts.
   */
  function installFakeChimeElements(): FakeChimeElement[] {
    const made: FakeChimeElement[] = [];
    class Tracked extends FakeChimeElement {
      constructor() {
        super();
        made.push(this);
      }
    }
    (globalThis as any).window = { location: { search: '' }, Audio: Tracked };
    return made;
  }

  it("scales the tone's level by opts.volume", () => {
    const made = installFakeChimeElements();
    chime('good', { volume: 0.5 });
    expect(made.length, 'no element was asked to play the tone').toBe(1);
    expect(made[0]!.volume).toBeCloseTo(0.25, 5);
    expect(made[0]!.played).toBe(true);
  });

  // The peak was 0.3 for most of this app's life. Half scale at full volume
  // keeps a beep from being as loud as a voice, which in a car is startling.
  it('uses the full-volume peak when no volume is given', () => {
    const made = installFakeChimeElements();
    chime('good');
    expect(made[0]!.volume).toBeCloseTo(0.5, 5);
  });

  // The headroom above 100% reaches the chime and nothing else, which is the
  // whole of what the slider still buys above unity (audio/volume.ts). An
  // element throws above 1, so it has to saturate rather than overshoot.
  it('rings louder at the boost ceiling, but never above full scale', () => {
    const made = installFakeChimeElements();
    chime('good', { volume: 2 });
    expect(made[0]!.volume).toBeGreaterThan(0.5);
    expect(made[0]!.volume).toBeLessThanOrEqual(1);
  });

  it('plays a real sound rather than an empty source', () => {
    const made = installFakeChimeElements();
    chime('ready');
    // A data URI of actual samples: the tone is generated, so a regression
    // that produced an empty or malformed one would still "play" silently.
    expect(made[0]!.src.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(made[0]!.src.length).toBeGreaterThan(1000);
  });

  it('gives a different kind a different tone', () => {
    const made = installFakeChimeElements();
    chime('good');
    chime('bad');
    expect(made[0]!.src).not.toBe(made[1]!.src);
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
/**
 * The deaf window, re-armed from the moment the sound actually stopped.
 *
 * It is sized up front from `estimateSpeechMs`, which is a guess and is
 * routinely short: on the 2026-10-02 drive it read 5000ms for an utterance
 * that ran 5615, so the window shut 61 milliseconds after the audio ended. It
 * held by a hair. The correction was still graded as a HIT, by a transcript
 * the engine delivered 2.3 seconds later -- which `looksLikeLateSelfEcho` now
 * catches on its words. What the words CANNOT catch is a one- or two-word echo
 * ("Surrender", 09:49:53 on the same drive), because the word floor is there
 * to protect one- and two-word answers. Those depend on the timer alone, so
 * the timer stops guessing as soon as it has a measurement.
 */
describe('the microphone is told when the app actually stopped', () => {
  afterEach(teardownFakeSpeechEnv);

  it('reports an ending, not just a beginning', async () => {
    const seen: Array<[number, string | undefined, string | undefined]> = [];
    installFakeSpeechEnv([]);
    setSpeechActivityListener((ms, text, phase) => seen.push([ms, text, phase]));
    try {
      await speakAsync('You have sixteen. Dealer shows ten.');
    } finally {
      setSpeechActivityListener(null);
    }

    expect(seen.map((s) => s[2])).toEqual(['start', 'end']);
    // The estimate goes out first and the measurement follows it.
    expect(seen[0]![0]).toBeGreaterThan(0);
    expect(seen[1]![0]).toBe(0);
  });

  it('sends no words with the ending, which is not a new utterance', async () => {
    const seen: Array<[number, string | undefined, string | undefined]> = [];
    installFakeSpeechEnv([]);
    setSpeechActivityListener((ms, text, phase) => seen.push([ms, text, phase]));
    try {
      await speakAsync('Correct play was stand.');
    } finally {
      setSpeechActivityListener(null);
    }

    const end = seen.find((s) => s[2] === 'end');
    // The sentence is already held one level up for the echo check; re-sending
    // it here would count as a fresh utterance and re-arm the cue it just gave.
    expect(end?.[1]).toBeUndefined();
  });

  it('reports the ending of a line nobody is listening to without throwing', async () => {
    installFakeSpeechEnv([]);
    setSpeechActivityListener(null);
    await expect(speakAsync('Queen.')).resolves.toBeUndefined();
  });

  it('survives a listener that throws on the ending', async () => {
    installFakeSpeechEnv([]);
    setSpeechActivityListener((_ms, _text, phase) => {
      if (phase === 'end') throw new Error('nope');
    });
    try {
      // A consumer's bookkeeping must never take out the utterance that was
      // trying to tell it something.
      await expect(speakAsync('Queen.')).resolves.toBeUndefined();
    } finally {
      setSpeechActivityListener(null);
    }
  });
});

/**
 * The cue that says "the microphone is open, speak now", held until the app
 * has actually stopped talking.
 *
 * From Jack's 2026-10-02 log, with the car off Bluetooth:
 *
 *   16:22:58.527  speak clip-chain  files="you-have-ace-five.mp3, dealer-shows-ten.mp3"
 *   16:22:58.597  speak chime kind=ready volume=1
 *   16:23:01.556  speak clip-end   ms=3029
 *
 * He reported it as a chime that never played. It played -- a 120ms sine at
 * half scale, seventy milliseconds into a three-second prompt, underneath a
 * voice at full level. There is no `chime-suspended` line, so the tone was
 * generated and simply masked.
 *
 * Holding it is not only about being audible. The cue is premature there too:
 * anything said during that prompt is suppressed as the app's own voice, so
 * the moment worth marking is when the app shuts up, not when the recogniser
 * happens to confirm.
 */
/** Which chimes the app actually asked for, from the log it already writes. */
function chimed(): string[] {
  return readDiagnosticLog()
    .filter((e) => e.event === 'chime')
    .map((e) => String((e.detail as Record<string, unknown>).kind));
}

describe('the microphone-is-open cue waits for the app to stop talking', () => {
  beforeEach(() => {
    _resetQuietWaitersForTest();
    _resetClipsForTest();
  });
  afterEach(() => {
    _resetQuietWaitersForTest();
    _resetClipsForTest();
    teardownFakeSpeechEnv();
  });

  it('sounds at once when nothing is being said', () => {
    installFakeSpeechEnv([]);
    clearDiagnosticLog();
    chimeWhenQuiet('ready');
    expect(chimed()).toEqual(['ready']);
  });

  it('holds while live speech is still running, then sounds', async () => {
    // autoEnd off: the utterance stays pending until the test ends it.
    const spoken = installFakeSpeechEnv([], { autoEnd: false });
    const pending = speakAsync('You have ace, five. Dealer shows ten.');
    clearDiagnosticLog();
    chimeWhenQuiet('ready');

    expect(chimed(), 'the cue sounded under the app’s own voice').toEqual([]);

    spoken[0]!.onend?.();
    await pending;
    expect(chimed()).toEqual(['ready']);
  });

  it('sounds only once, however many things finish', async () => {
    const spoken = installFakeSpeechEnv([], { autoEnd: false });
    const first = speakAsync('Queen.');
    clearDiagnosticLog();
    chimeWhenQuiet('ready');
    spoken[0]!.onend?.();
    await first;

    const second = speakAsync('Four.');
    spoken[1]!.onend?.();
    await second;

    expect(chimed()).toEqual(['ready']);
  });

  it('can be cancelled, so a screen that unmounts leaves no beep behind', async () => {
    const spoken = installFakeSpeechEnv([], { autoEnd: false });
    const pending = speakAsync('Queen.');
    clearDiagnosticLog();
    const cancel = chimeWhenQuiet('ready');
    cancel();
    spoken[0]!.onend?.();
    await pending;

    expect(chimed()).toEqual([]);
  });

  it('is called off by cancelSpeech, which is what a screen change does', async () => {
    /**
     * THE BEEP ON THE WRONG SCREEN. `cancelSpeech()` stops the clip chain,
     * the chain settles, and settling is exactly the signal a held cue is
     * waiting for -- so leaving a drill mid-prompt would fire the cue onto
     * whatever screen the operator just moved to, up to six seconds later.
     *
     * The mute button calls the same function, which is the worse case: the
     * one control whose entire promise is that nothing makes a noise.
     */
    vi.useFakeTimers();
    try {
      installFakeSpeechEnv([], { autoEnd: false });
      void speakAsync('You have seventeen. Dealer shows nine.');
      clearDiagnosticLog();
      chimeWhenQuiet('ready');
      expect(chimed()).toEqual([]);

      cancelSpeech();

      /**
       * THE CEILING IS WHERE THIS BITES, and it is the only place it does.
       * A cancel reports no ENDING -- `settleAllPendingSpeeches` resolves the
       * promise and the tts-end path that calls `notifySpeechEnded` is for an
       * utterance that finished, not one that was stopped. So a held cue is
       * not fired by the cancel; it is simply left waiting, and six seconds
       * later the timeout fires it onto whatever screen is up by then. The
       * assertion has to reach that timeout or it tests nothing: without the
       * drop in `cancelSpeech`, this beeps here.
       */
      vi.advanceTimersByTime(CUE_WAIT_CEILING_MS + 100);
      expect(chimed(), 'a cancelled cue sounded after the ceiling').toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps only the newest cue, because there is only one microphone', async () => {
    const spoken = installFakeSpeechEnv([], { autoEnd: false });
    const pending = speakAsync('Queen.');
    clearDiagnosticLog();
    // Two cues for one moment would beep twice for one opening. The first is
    // for a moment that has already passed.
    chimeWhenQuiet('ready');
    chimeWhenQuiet('attention');
    spoken[0]!.onend?.();
    await pending;

    expect(chimed()).toEqual(['attention']);
  });

  it('sounds anyway if no ending ever arrives', async () => {
    vi.useFakeTimers();
    try {
      installFakeSpeechEnv([], { autoEnd: false });
      void speakAsync('Queen.');
      clearDiagnosticLog();
      chimeWhenQuiet('ready');
      expect(chimed()).toEqual([]);

      // A lost `onend` must not swallow the one cue the operator is waiting
      // for: a microphone that opened and said nothing is indistinguishable
      // from one that never opened.
      vi.advanceTimersByTime(CUE_WAIT_CEILING_MS);
      expect(chimed()).toEqual(['ready']);
    } finally {
      vi.useRealTimers();
    }
  });
});

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
   * EXCEPT the one whose whole message is "start talking now".
   *
   * `ready` is played at the instant the microphone becomes live, after a wait
   * that on the 2026-09-30 drive was six seconds long. Deafening the
   * microphone for the sound that announces it is open defeats the cue: the
   * first 260ms of the window it just opened are deaf, and five voice-table
   * specs -- which speak the moment the microphone reports listening --
   * stopped hearing the word at all.
   *
   * The deafening exists to stop a FEEDBACK LOOP: a chime heard as speech can
   * be rejected, and a rejection cues another chime. `ready` cannot enter that
   * loop. It fires at most once per time the operator asks for the microphone
   * and never in response to a transcript, so the worst case is one stray
   * `attention` -- which does deafen, and ends it.
   */
  it('does not deafen for the cue that says the microphone is open', () => {
    const seen: number[] = [];
    setSpeechActivityListener((ms) => seen.push(ms));
    chime('ready');
    setSpeechActivityListener(null);
    expect(seen, 'the cue announcing the microphone deafened it').toEqual([]);
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
describe('chime() — the Web Audio graph is not involved', () => {
  afterEach(() => {
    _resetClipsForTest();
    _resetToneCacheForTest();
    _resetSharedAudioContextForTest();
    clearDiagnosticLog();
    delete (globalThis as any).window;
  });

  /**
   * THE REGRESSION THIS EXISTS TO CATCH, written from the export rather than
   * from a theory. 2026-10-03, build 89bd8db, twice on two page loads:
   *
   *   17:12:10.573  audio-unlock    reason=gesture state=suspended rate=48000
   *   17:12:18.556  cue-held        kind=ready why=quiet
   *   17:12:18.556  chime           kind=ready volume=1
   *   17:12:18.658  chime-suspended kind=ready state=suspended
   *
   * A gesture resumed the context and it was still suspended eight seconds
   * later, so the oscillator played into silence -- while recorded clips, on
   * plain elements, played perfectly throughout the same minute. The graph
   * does not reliably wake on that device. Anything that puts the chime back
   * into it puts the cue back into silence, and the operator cannot see that:
   * a chime nobody hears is indistinguishable from a microphone that never
   * opened, which is the single thing this app is most often accused of.
   */
  it('builds no AudioContext, however loud or quiet the chime', () => {
    let contexts = 0;
    class CountingContext {
      state = 'suspended';
      currentTime = 0;
      destination = {};
      constructor() {
        contexts += 1;
      }
      resume() {
        return Promise.resolve();
      }
      createOscillator() {
        return { type: '', frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} };
      }
      createGain() {
        return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} };
      }
    }
    class Tracked extends FakeChimeElement {}
    (globalThis as any).window = {
      location: { search: '' },
      AudioContext: CountingContext,
      Audio: Tracked,
    };

    chime('good');
    chime('ready', { volume: 2 });
    chime('attention', { volume: 0.2 });

    expect(contexts, 'a chime reached for the Web Audio graph').toBe(0);
  });

  it('still says it chimed, which is what the field test reads', () => {
    class Tracked extends FakeChimeElement {}
    (globalThis as any).window = { location: { search: '' }, Audio: Tracked };
    clearDiagnosticLog();

    chime('attention');

    const entry = readDiagnosticLog().find((e) => e.event === 'chime');
    expect(entry?.detail?.kind).toBe('attention');
  });

  it('reports a refused element instead of failing silently', async () => {
    // The element path has its own way of making no sound: an element that
    // has never played is locked on iOS and `play()` rejects. That has to
    // leave a trace for exactly the reason the oscillator's silence did not.
    class Refusing extends FakeChimeElement {
      play(): Promise<void> {
        return Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
      }
    }
    (globalThis as any).window = { location: { search: '' }, Audio: Refusing };
    clearDiagnosticLog();

    chime('good');
    await vi.waitFor(() => {
      const entry = readDiagnosticLog().find((e) => e.event === 'tone-broke');
      expect(entry?.detail?.name).toBe('NotAllowedError');
    });
  });

  it('does not throw where there is no Audio element at all', () => {
    (globalThis as any).window = { location: { search: '' } };
    expect(() => chime('good')).not.toThrow();
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

/**
 * THE FIRST LIVE UTTERANCE OF A PAGE LOAD FAILED SILENTLY, every time, and
 * the reason was that it was also the first `getVoices()` call.
 *
 * `getRawVoices` is reached from exactly one place -- `resolveVoice`, on the
 * live-TTS path -- and clips never touch `speechSynthesis` at all. So on a
 * phone whose whole session is clips until something falls back, the first
 * fallback utterance is the first time the voice list has ever been asked
 * for. WebKit populates it asynchronously on that first access and fires
 * `voiceschanged` when it is ready, so the utterance is constructed against
 * an empty list and dies without an `end` event.
 *
 * Observed in the car on 2026-09-29, run `vfktl7`: five live utterances, all
 * the same sentence, all Samantha. The FIRST ended `reason=watchdog ms=4615`
 * and the next four ended normally at ~1.1s. Same text, same voice, same
 * route -- the only variable that moved was which utterance it was. Elapsed
 * time does not explain it (that first one was 43s into the page load), and
 * "first access" does.
 *
 * So the list is primed at boot and kept warm by the event, and a drill
 * utterance is never the thing that opens it.
 */
describe('the voice list is warm before the first drill line', () => {
  beforeEach(() => {
    _resetVoiceCacheForTest();
  });

  afterEach(() => {
    _resetVoiceCacheForTest();
    delete (globalThis as any).window;
  });

  it('asks for the voice list without anything being spoken', () => {
    let calls = 0;
    (globalThis as any).window = {
      location: { search: '' },
      speechSynthesis: {
        getVoices: () => {
          calls += 1;
          return [];
        },
        addEventListener: () => {},
        speak: () => {},
        cancel: () => {},
      },
    };

    primeVoices();

    expect(calls, 'nothing opened the voice list, so the first drill line will').toBeGreaterThan(0);
  });

  it('subscribes to voiceschanged so the late list is not missed', () => {
    const events: string[] = [];
    (globalThis as any).window = {
      location: { search: '' },
      speechSynthesis: {
        getVoices: () => [],
        addEventListener: (name: string) => events.push(name),
        speak: () => {},
        cancel: () => {},
      },
    };

    primeVoices();

    expect(events).toContain('voiceschanged');
  });

  /**
   * The payload of the whole fix: once the list has been seen, a LATER
   * `getVoices()` that comes back empty must not erase it. WebKit returns []
   * transiently -- that is the reported shape of the bug -- and a voice
   * picked from [] is no voice at all, which is what produced the watchdog.
   */
  it('keeps the voices it has already seen when a later call comes back empty', () => {
    let list: any[] = [];
    const handlers: Record<string, () => void> = {};
    (globalThis as any).window = {
      location: { search: '' },
      speechSynthesis: {
        getVoices: () => list,
        addEventListener: (name: string, fn: () => void) => {
          handlers[name] = fn;
        },
        speak: () => {},
        cancel: () => {},
      },
    };

    primeVoices();
    expect(listVoices()).toEqual([]);

    // The list arrives, late, exactly as iOS delivers it.
    list = [{ name: 'Samantha', voiceURI: 'com.apple.Samantha', lang: 'en-US', default: true }];
    handlers['voiceschanged']?.();
    expect(listVoices().map((v) => v.name)).toEqual(['Samantha']);

    // ...and now it goes empty again under us.
    list = [];
    expect(
      listVoices().map((v) => v.name),
      'a transient empty list erased the voices and the next line speaks with none',
    ).toEqual(['Samantha']);
  });

  it('does not invent voices on a platform that genuinely has none', () => {
    (globalThis as any).window = {
      location: { search: '' },
      speechSynthesis: {
        getVoices: () => [],
        addEventListener: () => {},
        speak: () => {},
        cancel: () => {},
      },
    };

    primeVoices();

    expect(listVoices()).toEqual([]);
  });

  it('survives a speechSynthesis that throws on access', () => {
    (globalThis as any).window = {
      location: { search: '' },
      get speechSynthesis(): never {
        throw new Error('nope');
      },
    };

    expect(() => primeVoices()).not.toThrow();
  });
});


/**
 * THE WIRING, which is the part that can silently not be there.
 *
 * `audioSession.ts` can be perfect and the earpiece stays exactly where it is
 * if nothing calls it. These assert the three sounds the app makes -- a line,
 * an awaited line, and a cue -- each ask for the speaker BEFORE they play, and
 * that they ask through the preference rather than around it.
 */
describe('claiming the speaker before making a sound', () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  function installSession(): { type: string } {
    const session = { type: 'play-and-record' };
    Object.defineProperty(globalThis, 'navigator', {
      value: { audioSession: session },
      configurable: true,
      writable: true,
    });
    return session;
  }

  beforeEach(() => {
    _resetAudioSessionForTest();
    (globalThis as any).window = { location: { search: '?e2e=1' } };
  });

  afterEach(() => {
    _resetAudioSessionForTest();
    delete (globalThis as any).window;
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });

  it('speak() asks for the media category first', () => {
    const session = installSession();
    speak('You have sixteen. Dealer shows ten.');
    expect(session.type).toBe('playback');
  });

  it('speakAsync() asks too, since the field test speaks only through it', () => {
    const session = installSession();
    void speakAsync('Correct.');
    expect(session.type).toBe('playback');
  });

  it('chime() asks, because the cue is the sound most easily lost', () => {
    const session = installSession();
    chime('ready');
    expect(session.type).toBe('playback');
  });

  it('leaves the session alone when the setting says to', () => {
    // The comparison arm. If this ever stops working, the "Leave it" setting
    // silently becomes a second copy of "Speaker" and the one measurement
    // that could tell them apart is gone.
    const session = installSession();
    setOutputRoutePreference('auto');
    speak('You have sixteen. Dealer shows ten.');
    chime('ready');
    expect(session.type).toBe('play-and-record');
  });
});
