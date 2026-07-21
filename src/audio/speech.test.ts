import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { speak, speakAsync, chime, isSpeechSupported, listVoices, cancelSpeech, pickBestVoice } from './speech';

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
      cancel: () => {},
    },
  };
  return spoken;
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
