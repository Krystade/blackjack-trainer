/**
 * Show what is playing on a car head unit / lock screen, and let the
 * steering-wheel buttons drive it.
 *
 * REACHABLE ONLY VIA THE CLIPS PATH, and that is not an implementation
 * shortcut: `speechSynthesis` is not "media" as far as a phone OS is
 * concerned. It produces no media element, claims no audio focus, and never
 * appears in the now-playing UI, so there is nothing for Media Session to
 * attach to. The pre-rendered clips play through HTMLAudioElement, which is
 * real media, which is why only that path can offer this.
 *
 * Everything here is defensive by design. `navigator.mediaSession` is absent
 * on some targets and PARTIAL on others: a browser can expose the object and
 * still throw `NotSupportedError` from `setActionHandler` for an individual
 * action. Each action is therefore registered independently and a rejection
 * of one must never prevent the others or break playback -- audio the driver
 * is relying on must not stop because a transport button was unavailable.
 */

import { appendLog } from './mediaSessionLog';

export interface MediaSessionHandlers {
  /** Repeat the last thing said. The most useful control to a driver. */
  repeat: () => void;
  /** Stop speaking now. */
  stop: () => void;
}

interface MediaSessionLike {
  metadata: unknown;
  playbackState?: string;
  setActionHandler: (action: string, handler: (() => void) | null) => void;
}

function session(): MediaSessionLike | null {
  if (typeof navigator === 'undefined') return null;
  const ms = (navigator as unknown as { mediaSession?: MediaSessionLike }).mediaSession;
  return ms && typeof ms.setActionHandler === 'function' ? ms : null;
}

function metadataCtor(): (new (init: Record<string, unknown>) => unknown) | null {
  const g = globalThis as unknown as {
    MediaMetadata?: new (init: Record<string, unknown>) => unknown;
  };
  return typeof g.MediaMetadata === 'function' ? g.MediaMetadata : null;
}

let registered = false;

/**
 * Register the transport controls once.
 *
 * The mapping is deliberate rather than literal. A driver's hands are on the
 * wheel and their eyes are on the road, so the control that matters is "say
 * that again" -- not a track skip, which would be meaningless here since
 * there is no playlist. `play` and `previoustrack` therefore BOTH repeat:
 * whichever button the head unit exposes, the useful thing happens.
 * `nexttrack` and the seek actions ARE registered, but only as diagnostic
 * probes: their handlers record the event and do nothing else, so they stay
 * inert at speed while still revealing which actions this car emits.
 */
export function initMediaSession(handlers: MediaSessionHandlers): void {
  const ms = session();
  if (!ms || registered) return;
  registered = true;

  const set = (action: string, handler: () => void): void => {
    try {
      ms.setActionHandler(action, () => {
        // Record what the CAR sent before doing anything with it. This is the
        // half that cannot be discovered from a desk, and the driver cannot
        // watch a console, so the evidence has to collect itself.
        appendLog({ kind: 'invoke', action, ok: true });
        handler();
      });
      appendLog({ kind: 'register', action, ok: true });
    } catch (e) {
      // This browser knows the action name but refuses it, or does not know
      // it at all. Either way the others must still be registered -- and a
      // refusal is itself worth recording, since it means that button can
      // never work here however the car behaves.
      appendLog({
        kind: 'register',
        action,
        ok: false,
        detail: e instanceof Error ? e.name : 'refused',
      });
    }
  };

  set('play', handlers.repeat);
  set('previoustrack', handlers.repeat);
  set('pause', handlers.stop);
  set('stop', handlers.stop);

  // PROBES. These are registered purely to find out what this car actually
  // sends; each only writes a log entry and deliberately does nothing else,
  // so behaviour is unchanged -- `nexttrack` in particular stays inert rather
  // than doing something surprising at speed. Once the log says which of
  // these a real head unit emits, the useful ones can be given real handlers.
  for (const probe of ['nexttrack', 'seekforward', 'seekbackward', 'seekto']) {
    set(probe, () => {});
  }
}

/**
 * Publish what is being said, so the head unit shows the actual prompt
 * ("Running count plus four. Two decks remaining.") rather than a static app
 * name. That readout is genuinely useful: it is a second channel for the
 * same information the drill is speaking, for a glance at a red light.
 */
export function setNowPlaying(text: string, baseUrl = ''): void {
  const ms = session();
  const Ctor = metadataCtor();
  if (!ms || !Ctor) return;
  try {
    ms.metadata = new Ctor({
      title: text,
      artist: 'Blackjack Trainer',
      artwork: [
        { src: `${baseUrl}icon-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${baseUrl}icon-512.png`, sizes: '512x512', type: 'image/png' },
      ],
    });
  } catch {
    /* metadata is a nicety; never let it break playback */
  }
}

export function setPlaybackState(state: 'playing' | 'paused' | 'none'): void {
  const ms = session();
  if (!ms) return;
  try {
    ms.playbackState = state;
  } catch {
    /* not all implementations expose a writable playbackState */
  }
}

/** Test-only: clear the one-shot registration guard. */
export function _resetMediaSessionForTest(): void {
  registered = false;
}
