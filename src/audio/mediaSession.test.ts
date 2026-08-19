import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initMediaSession,
  setNowPlaying,
  setPlaybackState,
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
  it('registers repeat on both the play and previous-track buttons', () => {
    const actions = new Map<string, () => void>();
    withMediaSession({
      metadata: null,
      setActionHandler: (a: string, h: () => void) => actions.set(a, h),
    });

    let repeated = 0;
    initMediaSession({ repeat: () => (repeated += 1), stop: () => {} });

    // Whichever button the head unit exposes, the driver gets "say it again".
    actions.get('play')!();
    actions.get('previoustrack')!();
    expect(repeated).toBe(2);
  });

  it('maps pause and stop onto stopping', () => {
    const actions = new Map<string, () => void>();
    withMediaSession({
      metadata: null,
      setActionHandler: (a: string, h: () => void) => actions.set(a, h),
    });

    let stopped = 0;
    initMediaSession({ repeat: () => {}, stop: () => (stopped += 1) });
    actions.get('pause')!();
    actions.get('stop')!();
    expect(stopped).toBe(2);
  });

  // nexttrack would be meaningless -- there is no playlist -- so it must stay
  // inert rather than doing something surprising at 70mph.
  it('leaves next-track unregistered', () => {
    const actions = new Map<string, () => void>();
    withMediaSession({
      metadata: null,
      setActionHandler: (a: string, h: () => void) => actions.set(a, h),
    });
    initMediaSession({ repeat: () => {}, stop: () => {} });
    expect(actions.has('nexttrack')).toBe(false);
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

    expect(() => initMediaSession({ repeat: () => {}, stop: () => {} })).not.toThrow();
    expect(actions.has('previoustrack')).toBe(true);
    expect(actions.has('pause')).toBe(true);
  });

  it('does nothing at all when mediaSession is absent', () => {
    setNavigator({});
    expect(() => initMediaSession({ repeat: () => {}, stop: () => {} })).not.toThrow();
  });

  it('only registers once', () => {
    let calls = 0;
    withMediaSession({
      metadata: null,
      setActionHandler: () => {
        calls += 1;
      },
    });
    initMediaSession({ repeat: () => {}, stop: () => {} });
    const afterFirst = calls;
    initMediaSession({ repeat: () => {}, stop: () => {} });
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
