import { useEffect, useRef, useState } from 'react';
import {
  createVoiceController,
  browserRecognition,
  type ListenState,
  type HeardVerdict,
  type VoiceController,
} from '../audio/voiceControl';
import { setSpeechActivityListener } from '../audio/speech';
import { onDeviceStatus, prefersOnDevice, shouldProcessLocally } from '../audio/onDeviceSpeech';
import { recordHeard } from '../audio/voiceHistory';
import { looksLikeAnAttempt, type VoiceAction } from '../audio/voiceRecognition';
import { looksLikeSelfEcho } from '../audio/selfEcho';
import { requestWakeLock, releaseWakeLock } from '../audio/wakeLock';
import { diag } from '../diag/diagnosticLog';
import { reassertAudioFocus } from '../audio/audioFocus';
import { logAudioInputs, logMicPermission } from '../diag/environment';
import { micHasWorked, markMicWorked } from './voiceSession';

/**
 * Speech recognition, wired to a screen.
 *
 * Two things live here that the controller deliberately does not know about:
 * React's render cycle, and the app's own voice. The second is the important
 * one -- this hook subscribes to `speak()` so that every utterance the app
 * makes deafens the microphone for its duration, and the drill screens do not
 * each have to remember to do it at every call site.
 */

export interface VoiceStatus {
  state: ListenState;
  /** The last thing the microphone heard, matched or not. */
  heard: string | null;
  verdict: HeardVerdict | null;
}

const IDLE: VoiceStatus = { state: 'off', heard: null, verdict: null };

/**
 * How often to write a line saying nothing happened.
 *
 * Thirty seconds is chosen against the failure being chased: a session dies
 * roughly every ninety, so a heartbeat this size puts two or three lines
 * inside every session and makes a gap in them obvious at a glance. Cheap --
 * the log is capped and buffered -- and it is the only thing that can
 * distinguish "the microphone was listening and the operator said nothing"
 * from "the app was not running at all".
 */
export const HEARTBEAT_MS = 30_000;

export function useVoiceControl({
  enabled,
  onAction,
  onTranscript,
  onNotUnderstood,
  isAttempt,
  biasPhrases,
  context,
}: {
  enabled: boolean;
  onAction: (action: VoiceAction) => void;
  /** First refusal on every transcript, for a modal that owns the
   * microphone -- a count check asking for a number the command vocabulary
   * does not contain. Return a label to consume it, null to pass it on. */
  onTranscript?: (heard: string, offered: readonly string[]) => string | null;
  /**
   * Called when something that looked like an answer was not understood.
   *
   * Eyes-free, a rejection is silence, and silence cannot be told apart from
   * a dead microphone. Screens wire this to a chime so the operator knows to
   * say it again instead of waiting on a card that will never turn.
   */
  onNotUnderstood?: (why: 'rejected' | 'suppressed') => void;
  /**
   * What counts as an attempt worth cueing, when the default does not fit.
   *
   * `looksLikeAnAttempt` is tuned to the DRILL vocabulary -- short, one or
   * two words -- and it is right there: chiming at every sentence someone
   * says in a moving car is worse than the silence it replaces. The field
   * test's answers are not that shape ("that one came from the car"), so
   * under the default a real answer thrown away by the echo window makes no
   * sound at all, which is indistinguishable from a dead microphone. A
   * screen that can say precisely whether a transcript was one of ITS
   * answers passes that judgement in here instead.
   */
  isAttempt?: (heard: string) => boolean;
  /** Words to bias the engine toward, where the browser supports it. */
  biasPhrases?: string[];
  /**
   * Which screen is listening, recorded with every utterance. A word means
   * different things in each -- "yes" deals a hand at the table and confirms
   * a count in the prompt -- so a log without it cannot be read back.
   */
  context: string;
}): { status: VoiceStatus; cycleIfStale: () => void } {
  // Resolved once, asynchronously, then applied to every session this hook
  // starts. Both halves are required: the operator asked for it AND a model
  // is actually installed.
  const [processLocally, setProcessLocally] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    // Nobody who has not opted in is worth asking about. The query kills the
    // renderer on some builds (see onDeviceSpeech), and for someone who never
    // turned this on the answer could only ever have been "stay on the
    // network" -- which is what not asking already does.
    if (!prefersOnDevice()) return;

    let cancelled = false;
    void onDeviceStatus().then((status) => {
      if (!cancelled) setProcessLocally(shouldProcessLocally(status, true));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const [status, setStatus] = useState<VoiceStatus>(IDLE);

  // The handler closes over drill state that changes every render. Holding
  // the latest one in a ref means the recogniser is never torn down and
  // rebuilt just because a card changed -- a rebuild costs a real gap in
  // listening, and would land in the middle of an answer.
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  // Same reasoning: this closes over the prompt's own state, and rebuilding
  // the recogniser whenever that changes would cost a deaf gap at exactly the
  // moment an answer is due.
  const transcriptRef = useRef(onTranscript);
  transcriptRef.current = onTranscript;

  /**
   * THROUGH A REF, not through the dependency array.
   *
   * `context` names the screen a log line came from, and every use of it below
   * is inside a callback that outlives the render it was created in. Left out
   * of the effect entirely, the recogniser kept logging under the context
   * captured when it started, so every `mic` and `heard` entry after a screen
   * change was filed under the PREVIOUS screen -- in the field test, every
   * transcript from `mic-heard` landed under `mic-route`, the step before it.
   *
   * Adding it to the deps instead would be worse than the bug: the effect
   * tears the recogniser down and builds a new one, and the field test changes
   * context on EVERY step. On iOS that is a microphone stopping and restarting
   * eleven times mid-protocol, each restart re-arming the hands-free profile
   * whose theft of the wheel is the thing under test -- the instrument would
   * manufacture the signal it is measuring.
   */
  const contextRef = useRef(context);
  contextRef.current = context;

  const unheardRef = useRef(onNotUnderstood);
  unheardRef.current = onNotUnderstood;
  // Held in a ref for the same reason as the handlers above: the predicate
  // closes over the screen's current step, and rebuilding the recogniser
  // because a step changed costs a real gap in listening.
  const attemptRef = useRef(isAttempt);
  attemptRef.current = isAttempt;
  // What the app is currently saying, so a suppressed utterance can be told
  // apart from the app hearing its own voice. See audio/selfEcho.ts.
  const saidRef = useRef<string | null | undefined>(null);
  // Which utterance the "I was still talking" cue has already been given for.
  //
  // At most one cue per thing the app says, and this is load-bearing rather
  // than tidy: the cue is a CHIME, a chime is a sound, and a sound deafens the
  // microphone for its own duration (CHIME_ACTIVITY_MS). Cue every suppressed
  // utterance and each one extends the deaf window that caused it -- a
  // self-sustaining deafness where talking to the app keeps it from ever
  // hearing you. Caught by the count drill's voice suite, which polls an
  // utterance every 400ms and never got back out of suppression.
  const speechGenRef = useRef(0);
  const cuedGenRef = useRef(-1);

  const controllerRef = useRef<VoiceController | null>(null);

  useEffect(() => {
    if (!enabled) return;

    diag('mic', 'listen-on', { context: contextRef.current });
    void logMicPermission('listen-on');
    void logAudioInputs('listen-on');

    // The screen must stay awake for as long as the microphone is open, not
    // merely for as long as EYES-FREE is on.
    //
    // The wake lock was wired to the eyes-free toggle, which is a different
    // switch: voice can be on with eyes-free off (it is, at the table), and in
    // that combination the display slept on its usual timer, the page went
    // hidden, and recognition stopped -- with nothing on screen to say so,
    // because the screen was off. That is precisely "the mic doesn't stay
    // active", and it is the most mundane explanation available for it.
    void requestWakeLock('voice');

    const controller = createVoiceController({
      createRecognition: browserRecognition,
      now: () => Date.now(),
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (handle) => window.clearTimeout(handle),
      onAction: (action) => actionRef.current(action),
      onTranscript: (heard, offered) => transcriptRef.current?.(heard, offered) ?? null,
      biasPhrases,
      processLocally,
      log: (event, detail) => diag('mic', event, { ...detail, context: contextRef.current }),
      hasWorked: micHasWorked,
      onWorked: markMicWorked,
      onState: (state) => {
        setStatus((prev) => ({ ...prev, state }));
        /**
         * THE MICROPHONE CLOSING TAKES THE STEERING WHEEL WITH IT, and
         * nothing used to put it back.
         *
         * Opening the microphone reconfigures the audio session, and iOS
         * detaches the app from the car's remote-command target when it
         * does -- without pausing the silent loop that holds the slot
         * (audio/audioFocus.ts). The drive of 2026-09-29, run `ulq6vs`,
         * recorded the whole shape of it: nine wheel presses arriving
         * before the microphone opened, a single unsolicited `pause` from
         * the head unit 143ms after it did, and then not one press in the
         * remaining nine minutes -- across two wheel steps the operator
         * pressed and answered "the car did nothing else" on. Output
         * routing came back to the car 1.6s after the microphone shut,
         * because iOS re-decides that for each new sound; the buttons
         * never did, because the slot is only handed to a fresh `play()`.
         *
         * `setState` de-duplicates, so this is one call per real close, not
         * one per heartbeat. It claims nothing: with no holder outstanding
         * the re-take is a no-op, so a microphone closing on a screen that
         * wants no wheel cannot take the car from the radio.
         */
        if (state === 'off') reassertAudioFocus('mic-closed');
      },
      onHeard: (heard, verdict) => {
        setStatus((prev) => ({ ...prev, heard, verdict }));
        // Kept so the vocabulary can grow from evidence rather than from a
        // lucky glance at the screen mid-drill, which is how "stant" was
        // found and is not a method that works while driving.
        recordHeard(heard, verdict, contextRef.current);
        diag('heard', 'utterance', { heard, verdict, context: contextRef.current });

        // Only a short utterance earns a cue. A rejected sentence was someone
        // talking, and chiming at every one of those in a moving car would be
        // worse than the silence it replaces.
        //
        // SUPPRESSED counts too, and did not used to. Reported from the car:
        // an answer given over the tail of a prompt is thrown away with no
        // sound at all, which is exactly what a dead microphone does. The one
        // suppressed utterance that must stay silent is the app hearing
        // itself -- hence the echo check rather than a blanket cue.
        const attempt = attemptRef.current?.(heard) ?? looksLikeAnAttempt(heard);
        if (verdict === 'rejected' && attempt) unheardRef.current?.('rejected');
        else if (
          verdict === 'suppressed' &&
          attempt &&
          !looksLikeSelfEcho(heard, saidRef.current) &&
          cuedGenRef.current !== speechGenRef.current
        ) {
          cuedGenRef.current = speechGenRef.current;
          unheardRef.current?.('suppressed');
        }
      },
    });
    controllerRef.current = controller;

    // Deafen the microphone whenever the app talks. Registered only while
    // listening, so nothing pays for this when voice is off.
    setSpeechActivityListener((ms, text) => {
      diag('speak', 'deafen', { ms, said: text, context: contextRef.current });
      // A chime reports no text, and must not count as a new utterance: the
      // cue below IS a chime, so counting it would start the next generation
      // and re-arm the cue it just gave -- the same self-sustaining deafness
      // the generation counter exists to stop, one level up.
      if (text !== undefined) {
        saidRef.current = text;
        speechGenRef.current += 1;
      }
      controller.suppressFor(ms);
    });
    controller.start();

    // Everything below is a nudge from outside the controller, for the events
    // it cannot see: the page coming back, the network returning, the car's
    // Bluetooth route settling. Each one leaves a session dead or backed off
    // while the operator is already talking, and each is cheap to recover from
    // the moment it is noticed -- but only if something is watching.
    const wake = (reason: string) => () => {
      if (document.visibilityState === 'hidden') return;
      // Re-taking the lock matters as much as restarting: the browser drops a
      // screen wake lock whenever the page is hidden and does not give it back.
      void requestWakeLock('voice');
      controller.resume(reason);
    };
    const onVisible = () => {
      diag('mic', 'visibility', { state: document.visibilityState, context: contextRef.current });
      if (document.visibilityState === 'visible') wake('visible')();
    };
    const onOnline = wake('online');
    const onDeviceChange = () => {
      void logAudioInputs('devicechange-voice');
      wake('devicechange')();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const media = navigator.mediaDevices as unknown as {
      addEventListener?: (t: string, fn: () => void) => void;
      removeEventListener?: (t: string, fn: () => void) => void;
    } | undefined;
    media?.addEventListener?.('devicechange', onDeviceChange);

    // A heartbeat, so the log shows dead air rather than merely failing to
    // show anything. Silence in a log is ambiguous -- nothing happened, or
    // nothing was recorded -- and that ambiguity is what made the last three
    // bad drives unreadable.
    const heartbeat = window.setInterval(() => {
      diag('mic', 'heartbeat', {
        state: controller.state(),
        visibility: document.visibilityState,
        online: navigator.onLine,
        context: contextRef.current,
      });
    }, HEARTBEAT_MS);

    /**
     * Close the microphone when the PAGE goes away, not merely when this
     * screen unmounts.
     *
     * The stop below runs from React's cleanup, and React cleanup does not
     * run when the app is swiped out of the switcher -- so the recognition
     * session outlived the app. The operator saw exactly that (2026-09-21):
     * "I swiped up and closed the app after activating the mic and my iPhone
     * showed the time with an orange bubble around it", which is iOS saying
     * the microphone is still live. The 2026-09-20 log has it too: session
     * [6dl] reaches `session-start n=2`, then `visibility hidden`, then
     * `pagehide`, and never a `stop` or a `listen-off`.
     *
     * `pagehide` and NOT `visibilitychange`, deliberately. Hidden fires for
     * every transient glance away -- the notification shade, the switcher --
     * and tearing the microphone down on those would re-create the complaint
     * this whole subsystem exists to answer ("it seems like the mic doesn't
     * stay active"). `pagehide` means the page is actually going.
     */
    const onPageHide = () => {
      if (controllerRef.current) {
        diag('mic', 'stop-pagehide', { context: contextRef.current });
        controller.stop();
      }
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      media?.removeEventListener?.('devicechange', onDeviceChange);
      setSpeechActivityListener(null);
      controller.stop();
      controllerRef.current = null;
      void releaseWakeLock('voice');
      diag('mic', 'listen-off', { context: contextRef.current });
      setStatus(IDLE);
    };
    // `biasPhrases` is intentionally absent: callers build the list inline, so
    // a fresh array every render would tear the recogniser down and rebuild it
    // continuously. The vocabulary is fixed for a session's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, processLocally]);

  return {
    status,
    // Called at a moment the screen knows is quiet -- just after an answer,
    // while feedback is showing -- so the restart gap lands there instead of
    // over the next answer. The gap cannot be removed: one microphone session
    // exists per page, so a spare recogniser would end this one rather than
    // cover for it.
    cycleIfStale: () => controllerRef.current?.cycleIfStale(),
  };
}
