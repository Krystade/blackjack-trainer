/**
 * The audio unlock, which did not exist until the 2026-10-02 drive report.
 *
 * Jack asked for the phone to be louder off Bluetooth. Volume already went to
 * 200% (MAX_VOLUME) and he was sitting at 100%, so the headroom was there --
 * except that on his phone, turning it up would have made things QUIETER.
 * Three things in a row:
 *
 *   1. `amplify()` refuses outright unless the shared AudioContext is
 *      `running`, and its own comment said "nothing in the app resumes this
 *      context from a user gesture". It did not. So: no boost.
 *   2. A chain above unity builds a BRAND NEW element rather than taking the
 *      unlocked one from the pool, so `play()` faces the iOS activation gate
 *      on every amplified line. So: `NotAllowedError`.
 *   3. The rejection falls through to live TTS, which `utteranceVolume` caps
 *      at 1.0. So: the same level, in the fallback voice.
 *
 * All three come from one missing thing -- a real user gesture that unlocks
 * the audio -- which is what this module is. The tests below use a fake that
 * MODELS the gate: `play()` rejects unless the element was played while a
 * gesture was in progress. A fake whose `play()` always resolves cannot tell
 * a primed element from a locked one, and would pass whatever the code did.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  installAudioUnlock,
  unlockAudioNow,
  isAudioUnlocked,
  _resetAudioUnlockForTest,
} from './unlock';
import {
  _resetClipsForTest,
  idleClipAudioCountForTest,
} from './clips';
import { _resetSharedAudioContextForTest } from './audioContext';

/* ------------------------------------------------------------------------ */
/* A fake that actually gates, so these tests can fail                      */
/* ------------------------------------------------------------------------ */

/** True while a synthetic "user gesture" is on the stack. */
let gestureActive = false;

class GatedAudioElement {
  src = '';
  preservesPitch = false;
  defaultPlaybackRate = 1;
  playbackRate = 1;
  volume = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = true;
  unlocked = false;
  playCalls = 0;
  load(): void {}
  play(): Promise<void> {
    this.playCalls += 1;
    // The real rule: an element that has played once is unlocked for the life
    // of the page; one that never has is subject to the activation check.
    if (gestureActive) this.unlocked = true;
    if (!this.unlocked) {
      return Promise.reject(new DOMException('gesture required', 'NotAllowedError'));
    }
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  resumeCalls = 0;
  resume(): Promise<void> {
    this.resumeCalls += 1;
    // Only a gesture gets it running, which is the whole point.
    if (gestureActive) this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}

interface FakeEnv {
  elements: GatedAudioElement[];
  contexts: FakeAudioContext[];
  listeners: Map<string, Set<EventListener>>;
  /** Fire a listener the way a real tap does: inside a user gesture. */
  tap: (type?: string) => void;
}

function installEnv(): FakeEnv {
  const elements: GatedAudioElement[] = [];
  const contexts: FakeAudioContext[] = [];
  const listeners = new Map<string, Set<EventListener>>();

  class TrackedAudio extends GatedAudioElement {
    constructor() {
      super();
      elements.push(this);
    }
  }
  class TrackedContext extends FakeAudioContext {
    constructor() {
      super();
      contexts.push(this);
    }
  }

  (globalThis as any).window = {
    Audio: TrackedAudio,
    AudioContext: TrackedContext,
    addEventListener: (type: string, fn: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      listeners.get(type)?.delete(fn);
    },
  };

  return {
    elements,
    contexts,
    listeners,
    tap: (type = 'pointerdown') => {
      gestureActive = true;
      try {
        for (const fn of [...(listeners.get(type) ?? [])]) fn(new Event(type));
      } finally {
        gestureActive = false;
      }
    },
  };
}

describe('the audio unlock', () => {
  beforeEach(() => {
    gestureActive = false;
    _resetAudioUnlockForTest();
    _resetClipsForTest();
    _resetSharedAudioContextForTest();
  });
  afterEach(() => {
    gestureActive = false;
    _resetAudioUnlockForTest();
    _resetClipsForTest();
    _resetSharedAudioContextForTest();
    delete (globalThis as any).window;
  });

  it('starts locked, so nothing claims an unlock the page never got', () => {
    installEnv();
    expect(isAudioUnlocked()).toBe(false);
  });

  it('resumes the shared AudioContext from the gesture, not from playback', () => {
    const env = installEnv();
    installAudioUnlock();

    env.tap();

    expect(env.contexts.length, 'no context was built during the gesture').toBe(1);
    expect(env.contexts[0]!.resumeCalls).toBeGreaterThan(0);
    // The assertion that matters: RUNNING. `resume()` outside a gesture
    // resolves and leaves the context suspended, which is the state
    // `amplify()` refuses to route into.
    expect(env.contexts[0]!.state, 'the context was resumed outside the gesture').toBe('running');
  });

  it('leaves behind clip elements that have already played', async () => {
    const env = installEnv();
    installAudioUnlock();

    env.tap();

    expect(env.elements.length, 'no element was primed').toBeGreaterThan(0);
    for (const el of env.elements) {
      // Synchronous, and it has to be: the activation is spent the moment
      // `play()` is called, so an element primed one microtask after the
      // gesture returns is an element that was never primed at all.
      expect(el.unlocked, 'an element was created but never played in the gesture').toBe(true);
    }
    // Parked afterwards, which is necessarily async -- `play()` returns a
    // promise and the element is paused when it settles. The cabin must hear
    // nothing from this.
    await vi.waitFor(() => {
      for (const el of env.elements) expect(el.paused, 'a primed element was left playing').toBe(true);
    });
  });

  it('puts the primed elements where the clip chain will find them', async () => {
    const env = installEnv();
    installAudioUnlock();

    env.tap();
    await vi.waitFor(() => expect(idleClipAudioCountForTest()).toBeGreaterThan(0));

    // More than one, because overlapping chains are the case that was
    // failing: `speak()` is fire-and-forget, so a dealt round starts several
    // chains inside one millisecond and the second one used to build a fresh,
    // locked element. Jack's 2026-10-02 log has that twice.
    expect(idleClipAudioCountForTest()).toBeGreaterThan(1);
  });

  it('runs once, however many times the operator taps', () => {
    const env = installEnv();
    installAudioUnlock();

    env.tap();
    const afterFirst = env.elements.length;
    env.tap();
    env.tap();

    expect(env.elements.length, 'a second tap primed another batch').toBe(afterFirst);
    expect(env.contexts.length, 'a second tap built another context').toBe(1);
  });

  it('stops listening once it has unlocked', () => {
    const env = installEnv();
    installAudioUnlock();

    env.tap();

    const remaining = [...env.listeners.values()].reduce((n, s) => n + s.size, 0);
    expect(remaining, 'the listeners outlived the unlock they were waiting for').toBe(0);
  });

  it('unlocks on a click too, for a button reached from the keyboard', () => {
    const env = installEnv();
    installAudioUnlock();

    env.tap('click');

    expect(isAudioUnlocked()).toBe(true);
  });

  it('reports itself unlocked afterwards, so the diagnostics can say so', () => {
    const env = installEnv();
    installAudioUnlock();
    expect(isAudioUnlocked()).toBe(false);
    env.tap();
    expect(isAudioUnlocked()).toBe(true);
  });

  it('survives a page with no Audio constructor at all', () => {
    installEnv();
    delete (globalThis as any).window.Audio;
    installAudioUnlock();
    expect(() => unlockAudioNow('test')).not.toThrow();
    expect(isAudioUnlocked()).toBe(true);
  });

  it('survives a page with no AudioContext at all', () => {
    const env = installEnv();
    delete (globalThis as any).window.AudioContext;
    installAudioUnlock();
    env.tap();
    // The elements still get primed: the two halves fail independently, and
    // the element gate is the one that silenced a clip on the drive.
    expect(env.elements.length).toBeGreaterThan(0);
    expect(isAudioUnlocked()).toBe(true);
  });

  it('does not install anything when there is no window', () => {
    delete (globalThis as any).window;
    expect(() => installAudioUnlock()()).not.toThrow();
  });

  it('can be removed without having fired, so a screen can unmount cleanly', () => {
    const env = installEnv();
    const remove = installAudioUnlock();
    const before = [...env.listeners.values()].reduce((n, s) => n + s.size, 0);
    expect(before).toBeGreaterThan(0);

    remove();

    const after = [...env.listeners.values()].reduce((n, s) => n + s.size, 0);
    expect(after).toBe(0);
    expect(isAudioUnlocked()).toBe(false);
  });

  it('swallows a resume that rejects, because a refused resume is not a crash', () => {
    const env = installEnv();
    installAudioUnlock();
    const spy = vi.spyOn(FakeAudioContext.prototype, 'resume').mockImplementation(() => {
      return Promise.reject(new DOMException('no', 'NotAllowedError'));
    });
    try {
      expect(() => env.tap()).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
