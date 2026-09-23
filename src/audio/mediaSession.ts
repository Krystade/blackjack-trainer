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
import { diag } from '../diag/diagnosticLog';

export interface MediaSessionHandlers {
  /**
   * Go on: start, answer, reveal, next, "I had it", plus one. What it means
   * is the screen's business -- see audio/wheelCommands.ts.
   */
  forward: () => void;
  /** Go back: repeat, "I missed it", minus one. */
  back: () => void;
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
 * Every transport action this app registers, in the order the panel shows them.
 *
 * Named here rather than inline so the button tester and the registration below
 * cannot disagree about the set -- a probe that armed a different list from the
 * real one would report a button as dead when it merely was not being listened
 * for.
 */
export const MEDIA_SESSION_ACTIONS = [
  'play',
  'pause',
  'stop',
  'previoustrack',
  'nexttrack',
  'seekbackward',
  'seekforward',
  'seekto',
] as const;

export type MediaSessionAction = (typeof MEDIA_SESSION_ACTIONS)[number];

/**
 * What each action does, in words a driver would use.
 *
 * The tester speaks these, and the Settings panel prints them, so "what is this
 * button called and what will it do" has exactly one answer in the codebase.
 */
export const MEDIA_SESSION_LABEL: Record<MediaSessionAction, string> = {
  play: 'Play. Ignored — the car sends this by itself.',
  pause: 'Pause. Ignored — the car sends this by itself.',
  stop: 'Stop. Ignored — the car sends this by itself.',
  previoustrack: 'Skip back. Goes BACK: repeat, minus one, “I missed it”.',
  nexttrack: 'Skip forward. Goes FORWARD: start, answer, plus one, “I had it”.',
  seekbackward: 'Seek back. Same as Skip back.',
  seekforward: 'Seek forward. Same as Skip forward.',
  seekto: 'Seek to. Ignored — it carries a position, which means nothing here.',
};

/**
 * When set, EVERY action reports its name here instead of doing its job.
 *
 * This is the button tester (audio/buttonTester.ts). The point of it is that a
 * car's physical buttons and the Media Session names are related by a mapping
 * only the head unit knows: a ring selector with five directions plus volume
 * and call keys emits some unknown subset of eight action names, and the only
 * way to learn which is which is to press one and be told. Redirecting rather
 * than adding is deliberate -- a test press must not also answer a drill
 * question, repeat a prompt, or stop speech mid-sentence.
 */
let probe: ((action: string) => void) | null = null;

export function setMediaSessionProbe(fn: ((action: string) => void) | null): void {
  probe = fn;
}

/**
 * Register the transport controls once.
 *
 * The mapping is deliberate rather than literal. A driver's hands are on the
 * wheel and their eyes are on the road, so the control that matters is "say
 * that again" -- not a track skip, which would be meaningless here since
 * there is no playlist.
 *
 * THE CAR SENDS THREE OF THESE BY ITSELF, and only two are real presses.
 * Settled by the operator, 2026-09-16: "nexttrack/seekforward and
 * previoustrack/seekbackward are the only two buttons i can hit and are
 * caught. play and stop are automatic and i dont control them."
 *
 * `play` was the first one caught. A head unit sends it to mean "resume", on
 * its own, whenever it believes playback has stopped -- which is every time a
 * clip ends, because a finished clip is a finished track as far as the car can
 * tell. Mapped to repeat, as it once was, that closed a loop: repeat spoke a
 * clip, the clip ended, the car asked to resume, repeat spoke it again. The
 * drive of 2026-09-11 logged exactly that -- nine `play` invokes at
 * five-second intervals with nobody touching anything, and a question that
 * would not stop repeating long enough to be answered.
 *
 * `pause` and `stop` are the same problem wearing the opposite face, and they
 * survived that fix because nothing had yet said they were automatic. That
 * same 2026-09-11 log has `pause` arriving unprompted twice -- once 0.2s
 * after a `play`, once minutes later -- and they were wired to CANCEL SPEECH.
 * So the car has been able to cut a prompt off mid-sentence at a moment of
 * its own choosing, which from the driver's seat is indistinguishable from
 * the app having gone deaf or died. All three are now registered and inert:
 * registered, because refusing the slot hands it back to whatever was playing
 * before; inert, because a command the driver did not give should not move
 * the drill.
 *
 * That leaves the two real buttons, and they carry the whole vocabulary.
 * `nexttrack`/`seekforward` go FORWARD and `previoustrack`/`seekbackward` go
 * BACK -- one direction each, meaning whatever the screen that is up decides
 * (audio/wheelCommands.ts). Seek is included because a long-press of skip is
 * the usual source of one on a head unit, and a button that reads as broken
 * is worse than a button that does the obvious thing twice.
 *
 * `seekto` is the one exception, and not for want of a spare action: it
 * carries an absolute position into a track, and there is no track here to
 * have a position in. Registered so the log can still say whether this car
 * emits it.
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
        // ...and into the log the operator actually exports. Without this
        // line a press is invisible to every diagnosis made from a drive.
        diag('wheel', 'invoke', { action, probed: probe !== null });
        // Under test, the press is REPORTED and goes no further. Doing both
        // would mean learning what the ring's left click is called by having it
        // answer a drill question at the same time.
        if (probe) {
          probe(action);
          return;
        }
        handler();
      });
      appendLog({ kind: 'register', action, ok: true });
      diag('wheel', 'register', { action, ok: true });
    } catch (e) {
      // This browser knows the action name but refuses it, or does not know
      // it at all. Either way the others must still be registered -- and a
      // refusal is itself worth recording, since it means that button can
      // never work here however the car behaves.
      const why = e instanceof Error ? e.name : 'refused';
      appendLog({ kind: 'register', action, ok: false, detail: why });
      // A refusal means that button can never work here, whatever the car
      // does -- which is a different diagnosis from one that never arrives.
      diag('wheel', 'register', { action, ok: false, why });
    }
  };

  // Registered and intentionally inert -- all three. See the note above: the
  // car sends these of its own accord, so acting on one moves the drill for a
  // press nobody made. The log entries are still written, which is how the
  // next drive can show how often the car asks.
  set('play', () => {});
  set('pause', () => {});
  set('stop', () => {});
  set('seekto', () => {});

  // The two the driver can actually reach.
  set('nexttrack', handlers.forward);
  set('seekforward', handlers.forward);
  set('previoustrack', handlers.back);
  set('seekbackward', handlers.back);
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

/** Test-only: clear the one-shot registration guard and any armed probe. */
export function _resetMediaSessionForTest(): void {
  registered = false;
  probe = null;
}
