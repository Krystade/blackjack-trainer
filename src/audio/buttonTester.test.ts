import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startButtonTest, unheardActions } from './buttonTester';
import {
  initMediaSession,
  MEDIA_SESSION_ACTIONS,
  _resetMediaSessionForTest,
} from './mediaSession';

/**
 * The tester's two jobs, and neither is obvious from its size.
 *
 * It must REDIRECT presses rather than add to them -- a test press that also
 * answers a drill question teaches you nothing about the button and costs you a
 * card. And it must HOLD a media element playing for as long as it runs, because
 * a car only routes transport buttons to whoever it considers the active media
 * app. Without the hold, a button that works perfectly reports as dead, and a
 * negative result from this panel would be worthless.
 */

interface FakeAudio {
  src: string;
  loop: boolean;
  volume: number;
  played: boolean;
  paused: boolean;
}

const created: FakeAudio[] = [];

function installFakeAudio(): void {
  class Fake {
    src: string;
    loop = false;
    volume = 1;
    played = false;
    paused = false;
    constructor(src?: string) {
      this.src = src ?? '';
      created.push(this as unknown as FakeAudio);
    }
    play(): Promise<void> {
      this.played = true;
      return Promise.resolve();
    }
    pause(): void {
      this.paused = true;
    }
  }
  (globalThis as unknown as { window: unknown }).window = { Audio: Fake };
  (globalThis as unknown as { btoa: (s: string) => string }).btoa = base64Encode;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** vitest runs this suite in the `node` environment, where btoa is absent. */
function base64Encode(binary: string): string {
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : NaN;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : NaN;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)];
    out += Number.isNaN(b) ? '=' : B64[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)];
    out += Number.isNaN(c) ? '=' : B64[c & 63];
  }
  return out;
}

/** The inverse, so the generated WAV can be inspected byte by byte. */
function base64Decode(text: string): number[] {
  const clean = text.replace(/=+$/, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return bytes;
}

/** `navigator` is a getter-only global in node, so it has to be redefined. */
function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

function actionMap(): Map<string, () => void> {
  const actions = new Map<string, () => void>();
  setNavigator({
    mediaSession: {
      metadata: null,
      setActionHandler: (a: string, h: () => void) => actions.set(a, h),
    },
  });
  return actions;
}

beforeEach(() => {
  created.length = 0;
  _resetMediaSessionForTest();
  installFakeAudio();
  (globalThis as unknown as { localStorage?: unknown }).localStorage = undefined;
});

afterEach(() => {
  _resetMediaSessionForTest();
  delete (globalThis as unknown as { window?: unknown }).window;
  setNavigator(undefined);
});

describe('startButtonTest', () => {
  it('reports the name of every action the car sends, and runs none of them', () => {
    const actions = actionMap();
    let advanced = 0;
    initMediaSession({ repeat: () => {}, stop: () => {}, advance: () => (advanced += 1) });

    const seen: string[] = [];
    const handle = startButtonTest((press) => seen.push(press.action));

    actions.get('nexttrack')!();
    actions.get('previoustrack')!();

    expect(seen).toEqual(['nexttrack', 'previoustrack']);
    expect(advanced).toBe(0);
    handle.stop();
  });

  it('timestamps each press, so two presses a second apart read as two', () => {
    const actions = actionMap();
    initMediaSession({ repeat: () => {}, stop: () => {}, advance: () => {} });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T01:00:00Z'));
    const presses: number[] = [];
    const handle = startButtonTest((p) => presses.push(p.at));

    actions.get('play')!();
    vi.setSystemTime(new Date('2026-09-12T01:00:01Z'));
    actions.get('play')!();

    expect(presses).toHaveLength(2);
    expect(presses[1]! - presses[0]!).toBe(1000);
    handle.stop();
    vi.useRealTimers();
  });

  /**
   * The hold is the difference between "your car does not send that" and "your
   * car sent it to the radio". Without a playing element there is no honest
   * negative result to report.
   */
  it('keeps a looping element playing for as long as it runs', () => {
    actionMap();
    initMediaSession({ repeat: () => {}, stop: () => {}, advance: () => {} });

    const handle = startButtonTest(() => {});

    expect(created).toHaveLength(1);
    const holder = created[0]!;
    expect(holder.played).toBe(true);
    expect(holder.loop).toBe(true);
    // Muted, not silent, would be the easy shortcut -- and a muted element is
    // not reliably treated as playing media, which defeats the whole hold.
    expect(holder.volume).toBe(1);
    expect(holder.src.startsWith('data:audio/wav;base64,')).toBe(true);

    handle.stop();
    expect(holder.paused).toBe(true);
  });

  /**
   * 8-bit PCM is UNSIGNED, so digital silence is 0x80. A buffer of zeroes is a
   * full-scale DC offset: inaudible on most speakers, a thump on some, and a
   * step every time the one-second loop wraps.
   */
  it('generates real silence, not a DC offset', () => {
    actionMap();
    initMediaSession({ repeat: () => {}, stop: () => {}, advance: () => {} });
    const handle = startButtonTest(() => {});

    const bytes = base64Decode(created[0]!.src.split(',')[1]!);
    const riff = bytes.slice(0, 4).map((b) => String.fromCharCode(b)).join('');
    expect(riff).toBe('RIFF');
    // Every sample past the 44-byte header is the unsigned-PCM zero point.
    const samples = bytes.slice(44);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((b: number) => b === 0x80)).toBe(true);

    handle.stop();
  });

  it('gives the buttons back on stop, so leaving the panel cannot strand them', () => {
    const actions = actionMap();
    let advanced = 0;
    initMediaSession({ repeat: () => {}, stop: () => {}, advance: () => (advanced += 1) });

    const handle = startButtonTest(() => {});
    handle.stop();

    actions.get('nexttrack')!();
    expect(advanced).toBe(1);
  });

  /** No Audio and no Media Session must not throw -- it just hears nothing. */
  it('runs without an Audio constructor rather than throwing', () => {
    (globalThis as unknown as { window: unknown }).window = {};
    actionMap();
    initMediaSession({ repeat: () => {}, stop: () => {}, advance: () => {} });

    expect(() => startButtonTest(() => {}).stop()).not.toThrow();
    expect(created).toHaveLength(0);
  });
});

describe('unheardActions', () => {
  /**
   * The more useful half of the result. "Skip forward is nexttrack" is worth
   * knowing; "nothing on this wheel emits previoustrack" is worth more, because
   * it means any mapping resting on it can never work in this car.
   */
  it('names what never arrived', () => {
    expect(unheardActions(['play', 'nexttrack', 'pause'])).toEqual([
      'stop',
      'previoustrack',
      'seekbackward',
      'seekforward',
      'seekto',
    ]);
  });

  it('is empty only when all eight arrived', () => {
    expect(unheardActions([...MEDIA_SESSION_ACTIONS])).toEqual([]);
    expect(unheardActions([])).toEqual([...MEDIA_SESSION_ACTIONS]);
  });

  it('ignores a name that is not one of the armed actions', () => {
    // A car cannot send one, but a corrupt log could carry one, and it must not
    // silently subtract from the "never arrived" list.
    expect(unheardActions(['skipad'])).toEqual([...MEDIA_SESSION_ACTIONS]);
  });
});
