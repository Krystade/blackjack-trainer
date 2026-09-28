import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hasClips, playClipsResumable } from './clips';
import { speakAsync } from './speech';
import { _resetAudioFocusForTest } from './audioFocus';
import { clearDiagnosticLog, readDiagnosticLog } from '../diag/diagnosticLog';

/**
 * THE GAP BETWEEN UTTERANCES IS WHERE THE WHEEL IS PRESSED.
 *
 * `announceToMediaSession` takes the silent-element hold BEFORE a clip plays,
 * and `holdAudioFocus` sees a playing element and returns. If the platform
 * then pauses the silent loop to play the clip -- which is the suspected
 * mechanism behind "buttons worked only when the bot was talking" -- nothing
 * re-starts it when the clip ends. The app was the active media app for the
 * two seconds a clip was audible, and for none of the silence after it, which
 * is precisely the 2026-09-19 symptom with the fix in place.
 *
 * So the clip path must re-assert the hold once the chain has settled. This
 * is the test that fails against the code as it was.
 */

vi.mock('./clips', () => ({
  hasClips: vi.fn(() => true),
  isClipsEnabled: () => true,
  playClipsResumable: vi.fn(),
  stopClips: vi.fn(),
}));

interface FakeAudio {
  paused: boolean;
  playCount: number;
  onpause?: (() => void) | null;
}

const created: FakeAudio[] = [];

function installFakeAudio(): void {
  class Fake {
    src: string;
    loop = false;
    volume = 1;
    paused = false;
    playCount = 0;
    currentTime = 0;
    onpause: (() => void) | null = null;
    onended: (() => void) | null = null;
    constructor(src?: string) {
      this.src = src ?? '';
      created.push(this as unknown as FakeAudio);
    }
    play(): Promise<void> {
      this.playCount += 1;
      this.paused = false;
      return Promise.resolve();
    }
    pause(): void {
      this.paused = true;
    }
  }
  (globalThis as unknown as { window: unknown }).window = {
    Audio: Fake,
    location: { search: '' },
  };
}

beforeEach(() => {
  created.length = 0;
  _resetAudioFocusForTest();
  clearDiagnosticLog();
  installFakeAudio();
  (globalThis as unknown as { localStorage?: unknown }).localStorage = undefined;
});

afterEach(() => {
  _resetAudioFocusForTest();
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { SpeechSynthesisUtterance?: unknown })
    .SpeechSynthesisUtterance;
  vi.mocked(playClipsResumable).mockReset();
  vi.mocked(hasClips).mockReset();
  vi.mocked(hasClips).mockReturnValue(true);
});

/**
 * THE SAME HOLD, ON THE PATH WITH NO CLIP. Every field-test instruction and
 * every line that has no phrase in the manifest is live `speechSynthesis`,
 * and that path re-asserted nothing: a silent loop the platform paused to
 * speak the line stayed paused after it, so `wheel-back` -- whose line is a
 * TTS instruction -- was dead for the same reason `wheel-gap` was suspected
 * to be, and the two could not be told apart.
 */
describe('the hold across live TTS', () => {
  class FakeUtterance {
    text: string;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    volume = 1;
    rate = 1;
    voice: unknown = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  let endLine: () => void = () => {};
  beforeEach(() => {
    vi.mocked(hasClips).mockReturnValue(false);
    (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
      FakeUtterance;
    const w = globalThis as unknown as { window: Record<string, unknown> };
    w.window.speechSynthesis = {
      getVoices: () => [],
      speak: (u: FakeUtterance) => {
        endLine = () => u.onend?.();
      },
      cancel: () => {},
    };
  });

  it('is re-asserted once the utterance ends', async () => {
    const spoken = speakAsync('The microphone is still on. Press skip-forward again.');
    expect(created, 'a live line took no hold at all').toHaveLength(1);
    const el = created[0]!;

    // The platform pauses the silent loop to speak.
    await Promise.resolve();
    await Promise.resolve();
    el.paused = true;
    el.onpause?.();

    endLine();
    await spoken;

    expect(el.paused, 'the line ended and the app is no longer the active media app').toBe(
      false,
    );
    expect(el.playCount).toBe(2);
  });
});

describe('the hold across a clip', () => {
  it('is re-asserted once the clip chain settles, so a lapse under the clip does not outlive it', async () => {
    let finishClip: (r: { played: boolean; remainder: string | null }) => void = () => {};
    vi.mocked(playClipsResumable).mockReturnValue(
      new Promise((resolve) => {
        finishClip = resolve;
      }),
    );

    const spoken = speakAsync('Basic hit versus dealer nine.');
    // The hold was taken before the clip started: one element, playing.
    expect(created).toHaveLength(1);
    const el = created[0]!;
    expect(el.paused).toBe(false);

    // The platform pauses the silent loop to play the clip.
    await Promise.resolve();
    await Promise.resolve();
    el.paused = true;
    el.onpause?.();
    expect(
      readDiagnosticLog().some((e) => e.category === 'focus' && e.event === 'lapsed'),
      'the lapse itself went unrecorded',
    ).toBe(true);

    // The clip ends. This is the moment the wheel is about to be pressed.
    finishClip({ played: true, remainder: null });
    await spoken;

    expect(
      el.paused,
      'the clip ended and the app is no longer the active media app: a press now goes to the radio',
    ).toBe(false);
    expect(el.playCount).toBe(2);
  });
});

describe('the hold across a clip, on the fire-and-forget twin', () => {
  /**
   * `speak()` is what the drills call; `speakAsync()` is what the field test
   * calls. Same clip chain, same hold, same lapse -- and the count drill's
   * wheel entry submits in the silence after a line, which makes the gap
   * the whole interaction there.
   */
  it('is re-asserted by speak() too, not only by speakAsync()', async () => {
    let finishClip: (r: { played: boolean; remainder: string | null }) => void = () => {};
    vi.mocked(playClipsResumable).mockReturnValue(
      new Promise((resolve) => {
        finishClip = resolve;
      }),
    );
    const { speak } = await import('./speech');

    speak('Basic stand versus dealer six.');
    expect(created).toHaveLength(1);
    const el = created[0]!;

    await Promise.resolve();
    await Promise.resolve();
    el.paused = true;
    el.onpause?.();

    finishClip({ played: true, remainder: null });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(el.paused, 'a drill line ended and the wheel is dead until the next one').toBe(false);
    expect(el.playCount).toBe(2);
  });
});
