import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  holdAudioFocus,
  releaseAudioFocus,
  releaseAllAudioFocus,
  audioFocusHolders,
  silentWavDataUri,
  _resetAudioFocusForTest,
} from './audioFocus';
import { readDiagnosticLog, clearDiagnosticLog } from '../diag/diagnosticLog';

/**
 * What this module is actually for.
 *
 * A phone routes a steering-wheel button to whoever it currently considers the
 * active media app, and that status comes from an element that is PLAYING --
 * not from having registered a handler. So the app is only reachable from the
 * wheel while sound is coming out, which is precisely when a driver does not
 * need to press anything. The drive of 2026-09-19 reported it exactly that
 * way: "buttons worked only when the bot was talking."
 *
 * The element below is what closes that gap, so the tests that matter here are
 * about it never stopping while anyone still wants it.
 */

interface FakeAudio {
  src: string;
  loop: boolean;
  volume: number;
  playCount: number;
  paused: boolean;
}

const created: FakeAudio[] = [];

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

function installFakeAudio(): void {
  class Fake {
    src: string;
    loop = false;
    volume = 1;
    playCount = 0;
    paused = false;
    currentTime = 0;
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
  (globalThis as unknown as { window: unknown }).window = { Audio: Fake };
  (globalThis as unknown as { btoa: (s: string) => string }).btoa = base64Encode;
}

/** iOS refusing `play()` for want of a gesture, which is the dead-wheel case. */
function installRefusingAudio(): void {
  class Refusing {
    src: string;
    loop = false;
    volume = 1;
    paused = true;
    currentTime = 0;
    constructor(src?: string) {
      this.src = src ?? '';
    }
    play(): Promise<void> {
      return Promise.reject(new DOMException('gesture required', 'NotAllowedError'));
    }
    pause(): void {
      this.paused = true;
    }
  }
  (globalThis as unknown as { window: unknown }).window = { Audio: Refusing };
}

/**
 * iOS before the first gesture, then after it: `play()` refused once, accepted
 * afterwards. The hold used to be taken once and never retried, so the refusal
 * was permanent for the whole session.
 */
function installOnceRefusingAudio(): { plays: () => number } {
  let attempts = 0;
  class OnceRefusing {
    src: string;
    loop = false;
    volume = 1;
    paused = true;
    currentTime = 0;
    constructor(src?: string) {
      this.src = src ?? '';
    }
    play(): Promise<void> {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new DOMException('gesture required', 'NotAllowedError'));
      }
      this.paused = false;
      return Promise.resolve();
    }
    pause(): void {
      this.paused = true;
    }
  }
  (globalThis as unknown as { window: unknown }).window = { Audio: OnceRefusing };
  return { plays: () => attempts };
}

beforeEach(() => {
  created.length = 0;
  _resetAudioFocusForTest();
  installFakeAudio();
  (globalThis as unknown as { localStorage?: unknown }).localStorage = undefined;
});

afterEach(() => {
  _resetAudioFocusForTest();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('holding the media slot', () => {
  it('starts a looping, audible-but-silent element on the first hold', () => {
    holdAudioFocus('speech');

    expect(created).toHaveLength(1);
    const el = created[0]!;
    expect(el.playCount).toBe(1);
    expect(el.loop).toBe(true);
    // Muted would be the easy shortcut, and a muted element is not reliably
    // treated as playing media -- which defeats the whole hold.
    expect(el.volume).toBe(1);
    expect(el.paused).toBe(false);
  });

  it('keeps ONE element however many holders there are', () => {
    holdAudioFocus('speech');
    holdAudioFocus('button-test');
    holdAudioFocus('speech');

    expect(created).toHaveLength(1);
    expect(audioFocusHolders().sort()).toEqual(['button-test', 'speech']);
  });

  /**
   * The reason holds are named at all. Two things want the slot on their own
   * schedules -- a drill that is speaking and the button tester -- and with a
   * bare boolean the tester's stop would drop a hold the drill still needed,
   * silently restoring the original bug for the rest of the session.
   */
  it('keeps playing while any other holder remains', () => {
    holdAudioFocus('speech');
    holdAudioFocus('button-test');

    releaseAudioFocus('button-test');

    expect(created[0]!.paused).toBe(false);
    expect(audioFocusHolders()).toEqual(['speech']);
  });

  it('stops only once the last holder lets go', () => {
    holdAudioFocus('speech');
    holdAudioFocus('button-test');
    releaseAudioFocus('button-test');
    releaseAudioFocus('speech');

    expect(created[0]!.paused).toBe(true);
    expect(audioFocusHolders()).toEqual([]);
  });

  /**
   * A release from someone who never held must not take the slot away from
   * someone who does -- the app calls release on navigation whether or not a
   * drill ever spoke.
   */
  it('ignores a release from a key that never held', () => {
    holdAudioFocus('speech');
    releaseAudioFocus('button-test');

    expect(created[0]!.paused).toBe(false);
    expect(audioFocusHolders()).toEqual(['speech']);
  });

  it('re-plays the same element when a hold is taken again after release', () => {
    holdAudioFocus('speech');
    releaseAudioFocus('speech');
    holdAudioFocus('speech');

    expect(created).toHaveLength(1);
    expect(created[0]!.playCount).toBe(2);
    expect(created[0]!.paused).toBe(false);
  });

  it('drops every holder at once when asked', () => {
    holdAudioFocus('speech');
    holdAudioFocus('button-test');
    releaseAllAudioFocus();

    expect(audioFocusHolders()).toEqual([]);
    expect(created[0]!.paused).toBe(true);
  });

  /** No Audio constructor must not throw -- the app just is not reachable. */
  it('survives a platform with no Audio at all', () => {
    (globalThis as unknown as { window: unknown }).window = {};
    expect(() => holdAudioFocus('speech')).not.toThrow();
    expect(created).toHaveLength(0);
    expect(() => releaseAudioFocus('speech')).not.toThrow();
  });
});

describe('the silence it plays', () => {
  /**
   * 8-bit PCM is UNSIGNED, so digital silence is 0x80. A buffer of zeroes is a
   * full-scale DC offset: inaudible on most speakers, a thump on some, and a
   * step every time the one-second loop wraps -- which, for an element that
   * now runs for a whole drill rather than a whole test, would be a tick once
   * a second for as long as the operator is driving.
   */
  it('is real silence, not a DC offset', () => {
    const bytes = base64Decode(silentWavDataUri().split(',')[1]!);
    expect(bytes.slice(0, 4).map((b) => String.fromCharCode(b)).join('')).toBe('RIFF');
    const samples = bytes.slice(44);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((b) => b === 0x80)).toBe(true);
  });

  it('is a WAV the browser will accept', () => {
    expect(silentWavDataUri().startsWith('data:audio/wav;base64,')).toBe(true);
  });
});

/**
 * The hold has to be visible in the log the operator actually exports.
 *
 * It shipped writing only to `mediaSessionLog`, which the pasteable
 * diagnostic log does not include -- so the 2026-09-20 drive produced five
 * wheel stamps in total silence and no way to tell whether the hold was even
 * running. Two opposite diagnoses (the fix is broken / the fix never started)
 * had identical evidence, which is the exact failure the diagnostic log
 * exists to prevent.
 */
describe('the hold is visible in the exported log', () => {
  beforeEach(() => {
    clearDiagnosticLog();
  });

  it('records taking and dropping the slot, with who holds it', () => {
    holdAudioFocus('speech');
    const taken = readDiagnosticLog().filter((e) => e.category === 'focus');
    expect(taken.map((e) => e.event)).toContain('hold');
    expect(taken.find((e) => e.event === 'hold')?.detail?.key).toBe('speech');

    releaseAudioFocus('speech');
    const after = readDiagnosticLog().filter((e) => e.category === 'focus');
    expect(after.map((e) => e.event)).toContain('release');
  });

  /**
   * The refusal is the one that matters most: iOS rejects `play()` with no
   * gesture behind it, and before this line the only symptom was every wheel
   * button silently doing nothing.
   */
  it('records a refused play, which is what a dead wheel looks like', async () => {
    installRefusingAudio();
    holdAudioFocus('speech');
    await Promise.resolve();
    await Promise.resolve();
    const events = readDiagnosticLog()
      .filter((e) => e.category === 'focus')
      .map((e) => e.event);
    expect(events).toContain('refused');
  });
});

describe('a refused hold is not permanent', () => {
  beforeEach(() => {
    clearDiagnosticLog();
  });

  /**
   * The whole media slot used to die on one refusal.
   *
   * `holdAudioFocus` returned early on `!first && element`, and a rejected
   * `play()` leaves `element` non-null -- so once the first hold was refused,
   * every later hold short-circuited and never tried again. The field test
   * takes its first hold from the step effect before any audio has played,
   * which is exactly what iOS refuses, and the module's own header admits the
   * contract it is breaking: "in practice the first hold rides on a clip that
   * is already playing". One refusal at step 1 meant five wheel steps produced
   * no arrival at all, and the export read as a car that ignores the app.
   */
  it('retries the element when a previous play() was refused', async () => {
    const { plays } = installOnceRefusingAudio();
    _resetAudioFocusForTest();

    holdAudioFocus('speech');
    await Promise.resolve();
    await Promise.resolve();
    expect(plays()).toBe(1);

    // The next step's hold. Before the fix this returned at the early guard.
    holdAudioFocus('speech');
    await Promise.resolve();
    await Promise.resolve();
    expect(plays(), 'a refused hold was never retried').toBe(2);
  });

  it('does not re-play an element that is already going', async () => {
    holdAudioFocus('speech');
    await Promise.resolve();
    const first = created.length;
    const playsBefore = created[0]!.playCount;

    holdAudioFocus('speech');
    await Promise.resolve();

    expect(created).toHaveLength(first);
    expect(created[0]!.playCount, 'a healthy hold was restarted for no reason').toBe(playsBefore);
  });

  /**
   * `joined: true` was written for a key already in the set, so a 22-step run
   * carried 21 entries claiming a second holder had joined while the set never
   * grew -- and that is the field a reader uses to work out who was contending
   * for the slot.
   */
  it('calls a re-hold a re-hold, not a second holder joining', () => {
    holdAudioFocus('speech');
    clearDiagnosticLog();
    holdAudioFocus('speech');

    const hold = readDiagnosticLog().find((e) => e.category === 'focus' && e.event === 'hold');
    expect(hold?.detail?.rehold).toBe(true);
    expect(hold?.detail?.joined, 'a re-hold was reported as a new holder').toBe(false);
  });

  it('still calls a genuinely new holder a join', () => {
    holdAudioFocus('speech');
    clearDiagnosticLog();
    holdAudioFocus('car-check');

    const hold = readDiagnosticLog().find((e) => e.category === 'focus' && e.event === 'hold');
    expect(hold?.detail?.joined).toBe(true);
    expect(hold?.detail?.rehold).toBe(false);
  });
});
