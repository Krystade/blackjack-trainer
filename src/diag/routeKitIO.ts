/**
 * The Route kits' and the Settings "Test this route" button's contact with
 * the phone: apply a route plan, open the recogniser, play the route clip by
 * one path, then ask "Where did that come from?" and take the answer by voice.
 *
 * Kept apart from routeKit.ts so the step data and matcher stay pure.
 */
import { diag } from './diagnosticLog';
import { matchRouteAlternatives, ROUTE_LINES, type RouteAnswer, type TrialMic, type TrialPath } from './routeKit';
import { playThrough, routeClipUrl, sayRecorded, unlockWebAudio, waitForRouteQuiet, type HeldMic } from './testKitIO';
import {
  activeRoutePlan,
  applyRouteSink,
  beginCaptureRoute,
  captureRouteSettled,
  endCaptureRoute,
  logRouteSnapshot,
  type RoutePlan,
} from '../audio/audioRoute';
import { readAudioSessionType } from '../audio/audioSession';
import { getSharedAudioContext } from '../audio/audioContext';
import { releaseAllAudioFocus } from '../audio/audioFocus';

/** How long everything stays silent in a quiet-close trial: WebKit drops an idle category after 2 s. */
export const QUIET_MS = 2500;
/** How long a voice answer is waited for before the screen just waits for a tap. */
export const ANSWER_WINDOW_MS = 10_000;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface TrialOptions {
  id: string;
  plan: RoutePlan;
  path: TrialPath;
  mic: TrialMic;
  /** The screen's mic holder: opens a fresh recogniser, or closes it. */
  ensureMic: (want: 'open' | 'closed') => Promise<string | null>;
  /**
   * Set when the step is answered, left or replayed (review H2/M3). Checked
   * after every await: an abandoned trial touches nothing shared again -- no
   * plan, no mic, no sound -- because by then the mic and the plan may
   * already belong to the next step.
   */
  signal?: { aborted: boolean };
}

/** What an abandoned trial resolves with. */
export const TRIAL_ABORTED = 'aborted';

/**
 * Play the route clip under a plan. Resolves with how the play went; the
 * microphone is OPEN again when it resolves, ready for the spoken answer.
 */
export async function runRouteTrial(o: TrialOptions): Promise<{ played: string; micError: string | null }> {
  const gone = () => o.signal?.aborted === true;
  const abandoned = { played: TRIAL_ABORTED, micError: null };
  unlockWebAudio();
  // A fresh start per trial: a plan from the step before must not leak in.
  await o.ensureMic('closed');
  if (gone()) return abandoned;
  endCaptureRoute('trial-reset');
  beginCaptureRoute(`trial:${o.id}`, o.plan);
  await captureRouteSettled();
  if (gone()) return abandoned;
  let micError = await o.ensureMic('open');
  if (gone()) return abandoned;
  await waitForRouteQuiet(1500, 4000);
  if (gone()) return abandoned;
  await logRouteSnapshot(`trial:${o.id}`);
  if (gone()) return abandoned;

  if (o.mic === 'quiet-close') {
    // Everything this page plays, stopped: the recogniser, the focus loop,
    // and the shared Web Audio clock. WebKit keeps play-and-record after the
    // mic closes while anything is still playing (MediaSessionManagerCocoa
    // updateSessionState), so this is the only honest "mic closed" state.
    await o.ensureMic('closed');
    if (gone()) return abandoned;
    endCaptureRoute(`trial:${o.id}:quiet`);
    releaseAllAudioFocus();
    try {
      await getSharedAudioContext()?.suspend();
    } catch {
      /* logged below as the context state */
    }
    await wait(QUIET_MS);
    if (gone()) return abandoned;
  }

  const url = await routeClipUrl();
  if (gone()) return abandoned;
  let played = 'no-clip';
  if (url) {
    const ctxState = getSharedAudioContext()?.state ?? 'none';
    diag('test', 'kit-route-play', {
      step: o.id,
      path: o.path,
      strategy: o.plan.strategy,
      hold: o.plan.hold,
      // What the audio layer actually has in force as the line plays, not
      // what the step asked for (review T1/M3): 'none' once the plan ended.
      applied: activeRoutePlan()?.strategy ?? 'none',
      appliedHold: activeRoutePlan()?.hold ?? 'none',
      mic: o.mic,
      session: readAudioSessionType() ?? 'unsupported',
      audioContext: ctxState,
    });
    played = o.path === 'element' && o.plan.strategy === 'speaker-sink' ? await playElementWithSink(url) : await playThrough(o.path, url);
  }

  if (gone()) return abandoned;
  if (o.mic === 'quiet-close') {
    // Back on, for the answer. The question below then plays as drills do.
    beginCaptureRoute(`trial:${o.id}:answer`, { ...o.plan, hold: 'none' });
    micError = await o.ensureMic('open');
  }
  return { played, micError };
}

async function playElementWithSink(url: string): Promise<string> {
  try {
    const audio = new Audio(url);
    const sunk = await applyRouteSink(audio);
    diag('test', 'kit-route-sink', { applied: sunk, sinkId: (audio as { sinkId?: string }).sinkId ?? 'none' });
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      setTimeout(resolve, 10000);
    });
    return 'ended';
  } catch (e) {
    return e instanceof Error ? e.name : 'failed';
  }
}

export interface Listening {
  /** Resolves with the first reading that names an answer, or null at the window's end. */
  result: Promise<{ answer: RouteAnswer; heard: string; rank: number } | null>;
  cancel: () => void;
}

/**
 * Ask the question, then take the first final transcript that names an
 * answer. Transcripts that name nothing are logged and ignored, so a cough or
 * a late reading of the app's own line costs nothing.
 */
export function listenForRouteAnswer(mic: HeldMic, step: string, windowMs = ANSWER_WINDOW_MS): Listening {
  let finish: (v: { answer: RouteAnswer; heard: string; rank: number } | null) => void = () => {};
  const result = new Promise<{ answer: RouteAnswer; heard: string; rank: number } | null>((r) => (finish = r));
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = (v: { answer: RouteAnswer; heard: string; rank: number } | null) => {
    if (done) return;
    done = true;
    mic.onFinal = null;
    if (timer) clearTimeout(timer);
    finish(v);
  };
  void (async () => {
    await sayRecorded(ROUTE_LINES.ask);
    if (done) return;
    mic.onFinal = (alts) => {
      const heard = alts.map((a) => a.transcript);
      const m = matchRouteAlternatives(heard);
      if (!m.answer) {
        diag('test', 'kit-route-unheard', { step, heard: heard.join(' / ') });
        return;
      }
      stop({ answer: m.answer, heard: heard[m.rank] ?? '', rank: m.rank });
    };
    timer = setTimeout(() => {
      diag('test', 'kit-route-no-answer', { step, windowMs });
      stop(null);
    }, windowMs);
  })();
  return { result, cancel: () => stop(null) };
}
