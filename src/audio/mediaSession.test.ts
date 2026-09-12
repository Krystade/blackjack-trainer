import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initMediaSession,
  setNowPlaying,
  setPlaybackState,
  setMediaSessionProbe,
  MEDIA_SESSION_ACTIONS,
  MEDIA_SESSION_LABEL,
  _resetMediaSessionForTest,
} from './mediaSession';

/**
 * The driving case is the whole point of this module, and the driving case is
 * also where a thrown exception is least acceptable: audio the user is
 * relying on at speed must not stop because a head unit asked for a transport
 * button this browser does not implement. These specs are mostly about that
 * -- that every hostile shape of `navigator.mediaSession` degrades quietly.
 */

const g = globalThis as unknown as {
  navigator?: unknown;
  MediaMetadata?: unknown;
};

const originalNavigator = g.navigator;
const originalMetadata = g.MediaMetadata;

// `globalThis.navigator` is a read-only getter under Node, so a plain
// assignment throws. defineProperty is the only way to stand in a fake.
function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
}

function withMediaSession(ms: unknown): void {
  setNavigator({ mediaSession: ms });
}

beforeEach(() => {
  _resetMediaSessionForTest();
  // A plain field, not a parameter property: `erasableSyntaxOnly` forbids
  // the shorthand.
  g.MediaMetadata = class {
    init: Record<string, unknown>;
    constructor(init: Record<string, unknown>) {
      this.init = init;
    }
  };
});

afterEach(() => {
  setNavigator(originalNavigator);
  g.MediaMetadata = originalMetadata;
  _resetMediaSessionForTest();
});

describe('initMediaSession', () => {
  let advanced = 0;
  beforeEach(() => {
    advanced = 0;
  });

  it('repeats on skip-back and advances on skip-forward', () => {
    const actions = new Map<string, () => void>();
    withMediaSession({
      metadata: null,
      setActionHandler: (a: string, h: () => void) => actions.set(a, h),
    });

    let repeated = 0;
    initMediaSession({ repeat: () => (repeated += 1), stop: () => {}, advance: () => (advanced += 1) });

    // Neither is ever sent by a car of its own accord, so both are real
    // presses -- and they must not mean the same thing: skip-forward is the
    // only way to ANSWER a drill without the microphone that kills the wheel.
    actions.get('previoustrack')!();
    actions.get('nexttrack')!();
    expect([repeated, advanced]).toEqual([1, 1]);
  });

  /**
   * The regression that made the recorded voice unusable in a car.
   *
   * `play` means "resume", and a head unit sends it by itself every time it
   * thinks playback stopped -- which is every time a clip ends. Mapped to
   * repeat, that looped: repeat spoke, the clip ended, the car asked to
   * resume, repeat spoke again. The 2026-09-11 drive logged nine of them at
   * five-second intervals with nobody touching anything.
   */
  it('never acts on play, which the car sends itself whenever a clip ends', () => {
    const actions = new Map<string, () => void>();
    withMediaSession({
      metadata: null,
      setActionHandler: (a: string, h: () => void) => actions.set(a, h),
    });

    let repeated = 0;
    let stopped = 0;
    initMediaSession({ repeat: () => (repeated += 1), stop: () => (stopped += 1), advance: () => (advanced += 1) });

    // Registered, so the slot is not handed back to whatever was playing
    // before -- and inert, so an unattended resume cannot speak.
    expect(actions.has('play')).toBe(true);
    actions.get('play')!();
    actions.get('play')!();
    actions.get('play')!();
    // Advancing on an unattended resume would be worse than repeating: it
    // would submit answers to a drill nobody was touching.
    expect([repeated, stopped, advanced]).toEqual([0, 0, 0]);
  });

  it('maps pause and stop onto stopping', () => {
    const actions = new Map<string, () => void>();
    withMediaSession({
      metadata: null,
      setActionHandler: (a: string, h: () => void) => actions.set(a, h),
    });

    let stopped = 0;
    initMediaSession({ repeat: () => {}, stop: () => (stopped += 1), advance: () => (advanced += 1) });
    actions.get('pause')!();
    actions.get('stop')!();
    expect(stopped).toBe(2);
  });

  /**
   * The seeks used to be bare probes -- registered to see whether any car sends
   * one, doing nothing if it did. A probe that stays a probe is a button that
   * reads as broken to whoever presses it, so each now does what its short press
   * does (a long-press of skip is the usual source of a seek on a head unit).
   */
  it('makes the seek actions do what their short presses do', () => {
    const actions = new Map<string, () => void>();
    withMediaSession({
      metadata: null,
      setActionHandler: (a: string, h: () => void) => actions.set(a, h),
    });

    let repeated = 0;
    let stopped = 0;
    initMediaSession({ repeat: () => (repeated += 1), stop: () => (stopped += 1), advance: () => (advanced += 1) });

    actions.get('seekbackward')!();
    expect(repeated).toBe(1);
    actions.get('seekforward')!();
    expect(advanced).toBe(1);
    expect(stopped).toBe(0);
  });

  /**
   * `seekto` is the one exception, and not for want of a spare action: it
   * carries an absolute position into a track, and there is no track here to
   * have a position in.
   */
  it('leaves seekto inert, because a position means nothing here', () => {
    const actions = new Map<string, () => void>();
    withMediaSession({
      metadata: null,
      setActionHandler: (a: string, h: () => void) => actions.set(a, h),
    });

    let repeated = 0;
    let stopped = 0;
    initMediaSession({ repeat: () => (repeated += 1), stop: () => (stopped += 1), advance: () => (advanced += 1) });

    expect(actions.has('seekto')).toBe(true);
    actions.get('seekto')!();
    expect([repeated, stopped, advanced]).toEqual([0, 0, 0]);
  });

  /**
   * The button tester (audio/buttonTester.ts). Its whole value rests on a press
   * being REPORTED and going no further: learning what the ring's left click is
   * called must not also repeat a prompt or answer a drill question.
   */
  describe('under the button-test probe', () => {
    it('reports every action by name and runs none of them', () => {
      const actions = new Map<string, () => void>();
      withMediaSession({
        metadata: null,
        setActionHandler: (a: string, h: () => void) => actions.set(a, h),
      });

      let repeated = 0;
      let stopped = 0;
      initMediaSession({
        repeat: () => (repeated += 1),
        stop: () => (stopped += 1),
        advance: () => (advanced += 1),
      });

      const seen: string[] = [];
      setMediaSessionProbe((action) => seen.push(action));

      for (const action of MEDIA_SESSION_ACTIONS) actions.get(action)!();

      expect(seen).toEqual([...MEDIA_SESSION_ACTIONS]);
      // Not one real handler ran.
      expect([repeated, stopped, advanced]).toEqual([0, 0, 0]);
    });

    it('gives the buttons back when the test stops', () => {
      const actions = new Map<string, () => void>();
      withMediaSession({
        metadata: null,
        setActionHandler: (a: string, h: () => void) => actions.set(a, h),
      });

      let repeated = 0;
      initMediaSession({ repeat: () => (repeated += 1), stop: () => {}, advance: () => (advanced += 1) });

      setMediaSessionProbe(() => {});
      actions.get('previoustrack')!();
      expect(repeated).toBe(0);

      // Leaving the test armed would strand every wheel button dead -- which is
      // exactly what happens if the panel forgets to stop on unmount.
      setMediaSessionProbe(null);
      actions.get('previoustrack')!();
      expect(repeated).toBe(1);
    });

    it('names a label for every action it can report, so none prints raw', () => {
      for (const action of MEDIA_SESSION_ACTIONS) {
        expect(MEDIA_SESSION_LABEL[action], action).toBeTruthy();
      }
    });
  });

  /**
   * The partial-support case that motivates the per-action try/catch: a
   * browser exposes mediaSession but throws NotSupportedError for one action.
   * The rest must still be registered.
   */
  it('keeps registering after one action is refused', () => {
    const actions = new Map<string, () => void>();
    withMediaSession({
      metadata: null,
      setActionHandler: (a: string, h: () => void) => {
        if (a === 'play') throw new Error('NotSupportedError');
        actions.set(a, h);
      },
    });

    expect(() => initMediaSession({ repeat: () => {}, stop: () => {}, advance: () => (advanced += 1) })).not.toThrow();
    expect(actions.has('previoustrack')).toBe(true);
    expect(actions.has('pause')).toBe(true);
  });

  it('does nothing at all when mediaSession is absent', () => {
    setNavigator({});
    expect(() => initMediaSession({ repeat: () => {}, stop: () => {}, advance: () => (advanced += 1) })).not.toThrow();
  });

  it('only registers once', () => {
    let calls = 0;
    withMediaSession({
      metadata: null,
      setActionHandler: () => {
        calls += 1;
      },
    });
    initMediaSession({ repeat: () => {}, stop: () => {}, advance: () => (advanced += 1) });
    const afterFirst = calls;
    initMediaSession({ repeat: () => {}, stop: () => {}, advance: () => (advanced += 1) });
    expect(calls).toBe(afterFirst);
  });
});

describe('setNowPlaying', () => {
  it('publishes the spoken text as the title', () => {
    const ms: { metadata: { init?: Record<string, unknown> } | null; setActionHandler: () => void } = {
      metadata: null,
      setActionHandler: () => {},
    };
    withMediaSession(ms);

    setNowPlaying('Running count plus four. Two decks remaining.');
    expect(ms.metadata!.init!.title).toBe('Running count plus four. Two decks remaining.');
  });

  // Artwork has to survive the project-subpath deploy like everything else.
  it('builds artwork urls from the supplied base', () => {
    const ms: { metadata: { init?: Record<string, unknown> } | null; setActionHandler: () => void } = {
      metadata: null,
      setActionHandler: () => {},
    };
    withMediaSession(ms);

    setNowPlaying('Hit.', '/blackjack-trainer/');
    const art = ms.metadata!.init!.artwork as { src: string }[];
    expect(art[0]!.src).toBe('/blackjack-trainer/icon-192.png');
  });

  it('survives a missing MediaMetadata constructor', () => {
    withMediaSession({ metadata: null, setActionHandler: () => {} });
    g.MediaMetadata = undefined;
    expect(() => setNowPlaying('Hit.')).not.toThrow();
  });

  it('survives a metadata setter that throws', () => {
    withMediaSession({
      set metadata(_v: unknown) {
        throw new Error('nope');
      },
      setActionHandler: () => {},
    });
    expect(() => setNowPlaying('Hit.')).not.toThrow();
  });
});

describe('setPlaybackState', () => {
  it('sets the state when supported and stays quiet when not', () => {
    const ms: { playbackState?: string; metadata: unknown; setActionHandler: () => void } = {
      metadata: null,
      setActionHandler: () => {},
    };
    withMediaSession(ms);
    setPlaybackState('playing');
    expect(ms.playbackState).toBe('playing');

    setNavigator({});
    expect(() => setPlaybackState('paused')).not.toThrow();
  });
});
