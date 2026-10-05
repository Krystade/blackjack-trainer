/**
 * The audio session category, which a web page CAN set after all.
 *
 * WHAT I GOT WRONG. On 2026-10-03 I told Jack the earpiece was unfixable
 * because "Safari exposes no part of the audio session to a web page: no
 * category, no options, no `setSinkId`, no output device list." The last three
 * are true. The first is not: `navigator.audioSession` shipped in Safari 17 /
 * iOS 17, and its `type` IS the category intent. His phone is iOS 18.7.
 *
 * WHAT THE TYPES MEAN. 'playback' declares "this page is playing media", which
 * is the intent that belongs on a loud speaker. 'play-and-record' is what
 * WebKit infers the instant anything opens a microphone, and it is the one
 * that routes output to the receiver -- the quiet earpiece at the top of the
 * phone. The W3C draft (First Public Working Draft, Nov 2024) defines the
 * values and says NOTHING about routing or about what happens to a live
 * capture when a page asks for 'playback' mid-session. So whether WebKit
 * honours the request, ignores it, or honours it and kills the recogniser is
 * an open question about his specific phone.
 *
 * WHICH IS WHY EVERYTHING HERE READS BACK. An assignment that is silently
 * swallowed looks exactly like one that worked -- the same trap the volume
 * setter already laid on this device -- and a log that recorded only what was
 * ASKED FOR would let me make the same confident claim a second time. Every
 * row carries `wanted` and `got`, and `got` is read from the browser.
 */
import { DEFAULT_AUDIO } from '../store/types';
import { diag } from '../diag/diagnosticLog';

/** The values the spec defines. 'auto' means "stop declaring anything". */
export type AudioSessionType =
  | 'auto'
  | 'playback'
  | 'transient'
  | 'transient-solo'
  | 'ambient'
  | 'play-and-record';

interface AudioSessionLike {
  type: string;
}

function session(): AudioSessionLike | null {
  try {
    if (typeof navigator === 'undefined') return null;
    const s = (navigator as unknown as { audioSession?: AudioSessionLike }).audioSession;
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}

/** Does this browser admit to having an audio session at all? */
export function audioSessionSupported(): boolean {
  return session() !== null;
}

/** The category the browser currently believes it is in, or null. */
export function readAudioSessionType(): string | null {
  try {
    return session()?.type ?? null;
  } catch {
    return null;
  }
}

/**
 * Tracks what the last row said, so a drill that speaks after every answer
 * does not write a row per utterance into a log that is read by hand. Only
 * CHANGES and FAILURES are worth a line.
 */
let lastLogged: string | null = null;

/**
 * Ask for a category, and report whether the browser actually took it.
 *
 * Returns true only when the readback matches. False covers every other case:
 * no API, a swallowed assignment, a throwing setter.
 */
export function requestAudioSessionType(wanted: AudioSessionType): boolean {
  const s = session();
  if (!s) {
    if (lastLogged !== 'unsupported') {
      lastLogged = 'unsupported';
      diag('route', 'audio-session', { supported: false, wanted });
    }
    return false;
  }
  let was: string | null = null;
  try {
    was = s.type;
    if (was === wanted) return true;
    s.type = wanted;
  } catch {
    // A throwing setter is a refusal, and the readback below records it.
  }
  const got = readAudioSessionType();
  const ok = got === wanted;
  const key = `${was}>${wanted}=${got}`;
  if (lastLogged !== key) {
    lastLogged = key;
    diag('route', 'audio-session', { supported: true, was, wanted, got, ok });
  }
  return ok;
}

/**
 * WHAT THE APP SHOULD DO ABOUT THE ROUTE.
 *
 *   'auto'     -- never touch the session. The behaviour that shipped, and the
 *                 one where the earpiece wins.
 *   'playback' -- claim the media intent before speaking and NEVER hand it
 *                 back, because handing it back is the thing that costs the
 *                 loud speaker. The default: the alternative is a known
 *                 failure, and this is the single most likely remedy.
 *   'switch'   -- claim it to speak, return it to listen. Honest about what
 *                 the recogniser needs, and the one most likely to cost the
 *                 microphone instead -- which is why it is a choice and not
 *                 the default.
 */
export type OutputRoutePreference = 'auto' | 'playback' | 'switch';

/*
 * ONE DECLARATION OF THE DEFAULT, taken from the stored defaults themselves.
 *
 * There were three: this, `DEFAULT_AUDIO.outputRoute`, and a literal inside
 * `_resetAudioSessionForTest`. The last one was still saying 'playback' after
 * the other two moved to 'switch', so every unit test ran in a mode the app
 * does not ship -- which is how a default nothing asserts goes wrong.
 */
let preference: OutputRoutePreference = DEFAULT_AUDIO.outputRoute;

export function setOutputRoutePreference(next: OutputRoutePreference): void {
  preference = next;
}

export function outputRoutePreference(): OutputRoutePreference {
  return preference;
}

/** About to make a sound: ask for the category that belongs on a speaker. */
export function claimSpeakerForPlayback(): void {
  if (preference === 'auto') return;
  requestAudioSessionType('playback');
}

/**
 * About to listen. Only 'switch' gives the session back -- under 'playback'
 * this is deliberately a no-op, since the whole point is to stop declaring
 * the recording intent that moves the output to the earpiece. WebKit still
 * infers what it likes from `getUserMedia`; this only stops the app from
 * asking for it as well.
 */
export function releaseSpeakerForListening(): void {
  if (preference !== 'switch') return;
  requestAudioSessionType('play-and-record');
}

/**
 * THE HANDOFF, which is the part "Switch" was missing.
 *
 * Flipping the declared `type` while the recogniser is still capturing changes
 * nothing: WebKit set the real category when capture started, and the 2026-10-04
 * drive proved it -- `got=playback ok=true` and `session-at-mic-open
 * type=playback` all the way through, with the sound still on the earpiece.
 * The category the page declares and the category the audio session is in are
 * two different things once something is recording.
 *
 * WebKit bug 218012 (open since 2020, unresolved at iOS 18.6): Safari sets
 * `AllowBluetooth | MixWithOthers` and never `defaultToSpeaker`, so "when the
 * mic turns on the receiver speaker becomes the only one active" -- a WebKit
 * engineer's own words. The workaround reported in that thread is not a flag,
 * it is an ORDER: record while capturing, then STOP capturing and declare
 * playback before making a sound.
 *
 * So the handoff actually takes the microphone down. That is the cost, and it
 * is a real one: the recogniser needs roughly 1.2 seconds to come back, and it
 * cannot hear anything said over the app. It is only worth paying for speech;
 * a chime is 120ms and the app chimes after every answer, so trading a second
 * of deafness for each of those would make the drill unusable.
 */
let micClosedForSpeech = false;

/**
 * When the handoff last took the microphone down, so the route's handover can
 * be waited out before anything worth hearing is played.
 */
let micClosedAt: number | null = null;

/**
 * HOW LONG iOS TAKES TO GIVE THE LOUD SPEAKER BACK after capture ends.
 *
 * The 2026-09-29 drive measured output routing returning to the car about 1.6
 * seconds after the microphone shut, because iOS re-decides the route for each
 * new sound rather than on a state change. Everything that starts inside that
 * window is still routed as though something were recording.
 *
 * Jack's 2026-10-04 log is the cost of not waiting -- the words began 62ms
 * after `mic stop`, so the first clip of the chain went to the earpiece and
 * only the second arrived on the car: "anytime I said repeat I wouldn't hear
 * what hand I had just what the dealer had."
 *
 * A measured figure rather than a guess, but one measurement on one phone in
 * one car, so `route settle-wait` records every wait and the next drive's log
 * says whether it is enough.
 */
export const ROUTE_SETTLE_MS = 1600;

/**
 * How much longer to wait before making a sound, having closed the microphone.
 *
 * Takes `now` rather than reading the clock so the wait is testable and so it
 * is wall-clock: whatever the handoff spent on its own bookkeeping between
 * closing capture and the first byte of audio is time the route has already
 * had, and should not be charged twice.
 *
 * CONSUMED ON READ, which is what keeps a four-clip correction from waiting
 * six seconds. Only the first sound after the close is routed wrong; by the
 * second the route has moved, which is exactly the shape of what Jack heard.
 */
export function routeSettleWaitMs(now: number): number {
  if (preference !== 'switch' || micClosedAt === null) return 0;
  const elapsed = now - micClosedAt;
  micClosedAt = null;
  const remaining = ROUTE_SETTLE_MS - elapsed;
  if (remaining <= 0) return 0;
  diag('route', 'settle-wait', { ms: remaining, since: elapsed });
  return remaining;
}

/**
 * Say that something is about to record, at the moment it really is.
 *
 * SEPARATED FROM `endSpeechHandoff` because of a flap in Jack's 2026-10-04
 * log, three times, mid-utterance:
 *
 *   17:17:06.462  route handoff       to=microphone why=deadline
 *   17:17:06.462  route audio-session wanted=play-and-record got=play-and-record ok=true
 *   17:17:06.462  route audio-session wanted=playback got=playback ok=true
 *   17:17:06.462  mic   mic-deferred  why=deadline
 *   17:17:07.356  speak clip-end      ms=5223
 *
 * The backstop fired with 894ms of clip still to play -- the deaf window is
 * sized from a text estimate of 2375ms and the real recording ran 5223ms --
 * and the gate rightly refused to open the microphone over the app's own
 * voice. But ending the handoff had already declared the capture category, so
 * the session went to 'play-and-record' and back inside one millisecond while
 * audio was coming out. Ending the handoff is bookkeeping about a debt; it is
 * not the microphone opening, and only the opening should say so.
 */
export function declareRecordingIntent(): void {
  if (preference !== 'switch') return;
  requestAudioSessionType('play-and-record');
}

/**
 * The app is about to speak. Returns whether the caller must close the
 * microphone first.
 *
 * `hasWords` is false for a chime -- see above.
 */
export function beginSpeechHandoff(
  hasWords: boolean,
  now: number = Date.now(),
): 'close-mic' | 'none' {
  if (preference !== 'switch' || !hasWords || micClosedForSpeech) return 'none';
  micClosedForSpeech = true;
  // The clock the settle is measured from. Taken here rather than at the
  // close's call site so the two cannot drift apart.
  micClosedAt = now;
  requestAudioSessionType('playback');
  return 'close-mic';
}

/**
 * The app has stopped speaking. Returns whether the caller must reopen the
 * microphone it was told to close.
 *
 * Nothing happens unless this handoff actually closed it, so an ending that
 * belongs to a chime, or to an utterance that began before the setting was
 * switched on, cannot start a recogniser the operator never asked for.
 */
export function endSpeechHandoff(): 'open-mic' | 'none' {
  if (!micClosedForSpeech) return 'none';
  micClosedForSpeech = false;
  // NO DECLARATION HERE -- see `declareRecordingIntent`. This says the debt
  // may now be paid, which is not the same as a microphone being live, and
  // conflating the two flapped the session mid-utterance three times in the
  // 2026-10-04 log.
  return 'open-mic';
}

/**
 * OPEN THE MICROPHONE, BUT NOT OVER THE APP'S OWN VOICE.
 *
 * THE BUG, from Jack's 2026-10-04 drive on build 47500a2e7ce8 with the route
 * setting already on 'switch':
 *
 *   15:44:16.646  speak path-chosen   said="You have ace, nine. Dealer shows two."
 *   15:44:16.653  mic listen-on                              <- 7ms later
 *   15:44:16.780  route session-at-mic-open type=play-and-record
 *   15:44:21.143  speak clip-end      ms=4489
 *
 * Not one `route handoff` row in 155 entries: `beginSpeechHandoff` was never
 * reached. The handoff hung off the START of an utterance, and the utterance
 * always starts first -- the prompt begins, and seven milliseconds later the
 * screen opens the microphone and registers the listener that would have been
 * told. The 'start' phase had already gone by. The app then talked for four
 * and a half seconds with capture live in `play-and-record`: exactly the
 * earpiece condition this setting exists to escape, arrived at down the
 * setting's own code path.
 *
 * SO THE LEVER IS THE OPEN, NOT THE START. Jack, on hearing the shape of the
 * fix: "im not the one that controls when the mic opens either, its automatic
 * no? no button for me or anything so it needs to wait and allow it to finish
 * talking." The rule is that the microphone is open only while the app is not
 * speaking, and this is the half of it that no event ordering can lose --
 * it is a question asked at the moment of opening rather than a notification
 * sent beforehand and hopefully heard.
 *
 * NOTHING IS GIVEN UP BY WAITING. Every utterance deafens the recogniser for
 * its own duration anyway (`suppressFor` one level up), so a session opened
 * over the app's voice could never have heard a word of the answer. It only
 * ever cost the loud speaker. The wait is also where the declaration goes:
 * capture is not running, so asking for 'playback' here is the ORDER that
 * WebKit bug 218012 reports as the one thing that works, rather than the
 * mid-capture request that drive proved inert.
 *
 * Returns a canceller, because a screen that leaves while waiting must not
 * open a microphone onto whatever is on screen next.
 */
export function openMicWhenQuiet(deps: {
  /** Is the app making a noise right now? */
  speaking: () => boolean;
  /** Register for the next time it stops; returns an unregister. */
  whenQuiet: (fn: () => void) => () => void;
  /** Actually start the recogniser. */
  open: () => void;
  /** For the log: which path asked. */
  why: string;
}): () => void {
  // 'auto' is defined as never touching the session, and 'playback' is the
  // mode that keeps the declaration and accepts the deafness. Only 'switch'
  // promises to sequence the two, so only 'switch' pays for it.
  if (preference !== 'switch' || !deps.speaking()) {
    deps.open();
    return () => {};
  }
  // The utterance now runs with nothing capturing and the media intent
  // declared, which is the entire point of the wait.
  requestAudioSessionType('playback');
  diag('mic', 'mic-deferred', { why: deps.why });
  let done = false;
  let unregister: (() => void) | null = null;
  const attempt = (): void => {
    if (done) return;
    // A prompt is a CHAIN of clips and each one settles, so this runs more
    // than once per utterance. Opening twice would mean two recognisers, and
    // the second ends the first.
    if (deps.speaking()) {
      unregister = deps.whenQuiet(attempt);
      return;
    }
    done = true;
    unregister = null;
    deps.open();
  };
  unregister = deps.whenQuiet(attempt);
  return () => {
    if (done) return;
    done = true;
    unregister?.();
    unregister = null;
  };
}

/**
 * Forget any outstanding handoff, without reopening anything.
 *
 * For the case where the screen that closed the microphone has gone: voice
 * switched off, or the operator left the drill. The debt cannot be paid --
 * there is no controller left to start -- and carrying it would mean the next
 * session's first utterance saw a handoff already in progress and never closed
 * the microphone at all.
 */
export function abandonSpeechHandoff(): void {
  micClosedForSpeech = false;
  micClosedAt = null;
}

/** Test-only: forget what has been logged, and the preference. */
export function _resetAudioSessionForTest(): void {
  lastLogged = null;
  preference = DEFAULT_AUDIO.outputRoute;
  micClosedForSpeech = false;
  micClosedAt = null;
}
