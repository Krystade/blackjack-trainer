import {
  resolveSpoken,
  SPOKEN_ALTERNATIVES,
  type SpokenMatch,
  type VoiceAction,
} from './voiceRecognition';

/**
 * A speech-recognition session that survives being left running.
 *
 * The device probe settled three facts that this module is built around, all
 * measured rather than assumed:
 *
 *   1. A backgrounded Chrome tab KEEPS delivering transcripts. The feature is
 *      viable while the operator does something else, which is what it was
 *      asked for.
 *   2. A session dies on its own roughly every ninety seconds -- in the probe
 *      it died while the tab was still visible, so this is the engine's own
 *      timer, not a backgrounding penalty. Without a restart the feature
 *      appears to work and then silently stops, which is worse than not
 *      working at all.
 *   3. Two recognisers cannot cover for each other. Starting a second one
 *      ended the first 11ms later, against a control where a lone recogniser
 *      left alone for 3s did not end at all: there is one microphone session
 *      per page. So the restart gap cannot be overlapped away. It can only be
 *      MOVED, which is what `cycleIfStale` is for.
 *
 * The hazard that outranks all of them: THE APPLICATION TALKS. It speaks the
 * prompt and it speaks the correction -- "Correct. Stand." -- and over a car
 * speaker the microphone hears every word of it. An ungated recogniser would
 * transcribe the app's own voice and grade an answer the operator never gave:
 * the same class of failure as the "it" alias, but continuous and
 * self-sustaining. Hence the suppression window.
 */

export type ListenState =
  | 'off'
  | 'starting'
  | 'listening'
  /** Between a session ending and its replacement starting: the deaf window. */
  | 'restarting'
  /** Microphone permission refused. Terminal -- retrying would loop. */
  | 'denied'
  | 'unsupported'
  | 'error';

export interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  /**
   * How many readings of the same audio to hand back. Optional because not
   * every engine offers it, and one guess is still workable.
   */
  maxAlternatives?: number;
  start: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onresult:
    | ((e: {
        results?: ArrayLike<ArrayLike<{ transcript?: string }> & { length?: number }>;
      }) => void)
    | null;
}

/** What the microphone did with one utterance, for the operator to read. */
export type HeardVerdict = VoiceAction | 'rejected' | 'suppressed' | (string & {});

export interface VoiceControllerDeps {
  /** Returns null when the browser has no recognition API. */
  createRecognition: () => RecognitionLike | null;
  now: () => number;
  schedule: (fn: () => void, ms: number) => number;
  cancel: (handle: number) => void;
  onAction: (action: VoiceAction) => void;
  onState: (state: ListenState) => void;
  /**
   * Everything heard, matched or not. The UI shows this so a silent screen
   * has a reason on it: a misheard word and a dead microphone look identical
   * otherwise, and the operator cannot debug either while driving.
   */
  onHeard?: (heard: string, verdict: HeardVerdict) => void;
  /**
   * First refusal on every transcript, before the command vocabulary sees it.
   *
   * A modal owns the microphone while it is up. A count check asks for a
   * NUMBER, which is not in the command vocabulary at all and would otherwise
   * be rejected as noise -- and while it is open, "hit" must not play a hand
   * behind it either. Returning a label consumes the transcript and reports
   * that label; returning null passes it on to the ordinary matcher.
   *
   * Given every reading the engine offered, not just its winner, for exactly
   * the reason the command matcher is: a spoken number over a car microphone
   * is ranked the same way a spoken word is, and "minus three" sitting behind
   * "minus tree" is the same failure with a worse consequence -- a running
   * count is harder to say twice than a hand is to play twice.
   */
  onTranscript?: (heard: string, offered: readonly string[]) => string | null;
  /**
   * Words to bias the engine toward. Chrome accepts a phrase list with a
   * boost per phrase, which is the single largest accuracy lever available
   * for a closed vocabulary heard over road noise -- the engine is otherwise
   * choosing from all of English for a one-syllable word.
   */
  biasPhrases?: string[];
  /**
   * Run recognition on an installed local model instead of over the network.
   *
   * Only ever set when a model is confirmed INSTALLED -- see
   * onDeviceSpeech.ts. Switching to local processing without one risks a
   * recogniser that starts and then hears nothing, and failing silently in a
   * car is worse than using the network path that already works.
   */
  processLocally?: boolean;
  /**
   * Where the session's life story goes.
   *
   * A sink rather than a direct import, for the same reason every other side
   * effect here is injected: this module is the one piece of the voice stack
   * that can be tested in plain node, and it stays that way only while it
   * knows nothing about localStorage. The app wires this to diag('mic', ...).
   */
  log?: (event: string, detail?: Record<string, unknown>) => void;
  /**
   * Whether a microphone session has demonstrably worked earlier in this PAGE
   * LOAD, outside this controller's own life.
   *
   * The controller is rebuilt on every navigation, so its own evidence resets
   * with it -- and the first `not-allowed` after a screen change, which iOS
   * produces for a `start()` with no user gesture behind it, would then be
   * read as a fresh refusal and stop voice for the rest of the drive. The page
   * knows better than the controller does; this is how it says so.
   */
  hasWorked?: () => boolean;
  /** Told the first time a session demonstrably works, so the page can remember. */
  onWorked?: () => void;
}

/**
 * How long a session may run before we prefer to cycle it at a moment of our
 * choosing. Comfortably under the ~87s the probe measured, so the engine's
 * own timer is rarely the one that fires.
 */
export const CYCLE_AFTER_MS = 45_000;

/**
 * Silence after the app stops speaking, before the microphone is trusted
 * again. Recognition results arrive well behind the audio that produced them,
 * so a tail is required; too short and the app grades its own voice.
 */
export const SPEECH_TAIL_MS = 700;

/**
 * Delay before re-starting. Restarting synchronously inside `onend` throws on
 * some engines and busy-loops on others when the microphone is unavailable.
 */
export const RESTART_DELAY_MS = 250;

/**
 * The ceiling on backing off, and what counts as a session that worked.
 *
 * From the drive of 2026-09-10, one probe run over 194 seconds:
 *
 *   6 sessions ended, 5 auto-restarts, repeated `audio-capture` errors,
 *   the last two sessions lasting 9s and 0.5s before dying again.
 *
 * `audio-capture` means the microphone became unavailable -- on an iPhone in
 * a car that is the Bluetooth route flipping to hands-free, or iOS taking the
 * input for something else. Restarting 250ms later, forever, neither fixes it
 * nor gives it a chance to settle; it just re-opens the microphone every
 * quarter second, which costs battery and re-triggers the route-change
 * crackle each time.
 *
 * So a run of failures backs off, and one working session clears it. A
 * session that produced a result, or simply lasted, was working.
 */
export const MAX_RESTART_DELAY_MS = 8000;
export const PRODUCTIVE_SESSION_MS = 10_000;

/**
 * How long to wait before the next attempt, given how many have just failed.
 *
 * The first retry is immediate in human terms: a single dropped session is
 * routine -- the cloud recogniser ends one roughly every ninety seconds by
 * design -- and must not introduce a pause. Only a RUN of them backs off.
 */
export function restartDelayFor(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return RESTART_DELAY_MS;
  const backedOff = RESTART_DELAY_MS * 2 ** Math.min(consecutiveFailures, 10);
  return Math.min(backedOff, MAX_RESTART_DELAY_MS);
}

/**
 * How long to wait for a started session to confirm itself.
 *
 * The probe found an environment where the API is fully present -- every
 * constructor, every method -- and then fires NO events whatsoever: no start,
 * no error, nothing. Without a watchdog that case shows "Starting..." forever
 * and looks identical to a microphone that simply has not heard anything yet.
 * Saying so is the whole value: an inert engine is not something the operator
 * can fix by talking louder.
 */
export const START_TIMEOUT_MS = 5000;

/**
 * How hard to bias the engine toward the vocabulary. Chrome accepts 0 to 10
 * and rejects anything outside that with a SyntaxError. Deliberately short of
 * the maximum: the point is to make "stand" beat "stan" and "sand", not to
 * make every noise in the car resolve to a command.
 */
export const PHRASE_BOOST = 3;

/**
 * Bias the engine toward the words we actually expect, where the browser
 * supports it. Silently skipped everywhere else -- this is an accuracy
 * improvement, never a requirement.
 */
function applyBias(recognition: RecognitionLike, phrases: string[] | undefined): void {
  if (!phrases || phrases.length === 0) return;
  const g = globalThis as unknown as {
    SpeechRecognitionPhrase?: new (phrase: string, boost: number) => unknown;
  };
  const Phrase = g.SpeechRecognitionPhrase;
  if (typeof Phrase !== 'function') return;
  try {
    (recognition as unknown as { phrases: unknown[] }).phrases = phrases.map(
      (phrase) => new Phrase(phrase, PHRASE_BOOST),
    );
  } catch {
    /* an engine that will not be biased still works unbiased */
  }
}

/**
 * Whether a session has run long enough to be worth cycling at a quiet moment
 * instead of waiting for the engine to kill it mid-answer.
 */
export function shouldCycle(startedAt: number, now: number, after = CYCLE_AFTER_MS): boolean {
  if (startedAt <= 0) return false;
  return now - startedAt >= after;
}

/**
 * How one match reads in the microphone log.
 *
 * Marked rather than flattened, because the three kinds carry different news:
 * a rescue means the engine had the word and ranked it wrong, an approximate
 * match means it never produced the word at all, and the tally of the second
 * kind is what would justify tightening or loosening the near-miss rule.
 */
export function verdictFor(match: SpokenMatch): string {
  switch (match.via) {
    case 'direct':
      return match.action;
    case 'alternative':
      return `${match.action} (rescued)`;
    case 'approximate':
      return `${match.action} (approximate)`;
  }
}

/** Whether the microphone is currently hearing the app rather than the operator. */
export function isSuppressed(now: number, suppressedUntil: number): boolean {
  return now < suppressedUntil;
}

/**
 * Errors that mean stop: retrying them either loops forever or re-prompts the
 * operator for permission. Everything else -- `no-speech`, `network`,
 * `aborted` -- is a normal interruption of a long-running session and is
 * simply restarted.
 */
function isPermissionError(error: string | undefined): boolean {
  return error === 'not-allowed' || error === 'service-not-allowed';
}

/**
 * How many permission errors in a row are tolerated AFTER a session has
 * already worked.
 *
 * `not-allowed` was treated as terminal outright, which is right the first
 * time -- someone who declines the prompt must not be asked again in a loop.
 * It is wrong every time after that, and the operator's report is exactly
 * that case: "I get the request to allow the mic and always accept it but it
 * seems like the mic doesn't stay active."
 *
 * On iOS a `start()` that is not tied to a user gesture can come back
 * `not-allowed` even with permission granted, and an auto-restart is by
 * definition not tied to a gesture. So the FIRST successful session is the
 * evidence that permission exists; after that, a permission error is treated
 * as one more transient failure and backed off like any other, and only a run
 * of them is accepted as a real revocation.
 *
 * The asymmetry is deliberate. Before any session has worked, one refusal is
 * conclusive and retrying would nag. After one has, a refusal is more likely
 * to be the platform being particular about gestures than the operator having
 * changed their mind mid-drive.
 */
export const MAX_PERMISSION_RETRIES = 4;

export interface VoiceController {
  start: () => void;
  stop: () => void;
  /**
   * Called by the app as it begins speaking, with how long it expects to
   * talk. Results are discarded until then, plus a tail.
   */
  suppressFor: (ms: number) => void;
  /**
   * Cycle the session now if it is old, so its deaf window lands here --
   * during answer feedback, say -- instead of in the middle of the next
   * answer. This is the only mitigation available, since a second recogniser
   * would kill this one rather than cover for it.
   */
  cycleIfStale: () => void;
  /**
   * Start listening again now, from the outside.
   *
   * For the events the controller cannot see and must not have to: the page
   * coming back from hidden or frozen, the network returning, an audio route
   * settling after a Bluetooth flip. Each of those leaves a dead or backed-off
   * session that would otherwise wait out its timer while the operator talks
   * into nothing. Resets the backoff, because the condition that caused it has
   * just changed.
   */
  resume: (reason: string) => void;
  state: () => ListenState;
}

export function createVoiceController(deps: VoiceControllerDeps): VoiceController {
  let recognition: RecognitionLike | null = null;
  let running = false;
  let sessionStartedAt = 0;
  let suppressedUntil = 0;
  let restartHandle: number | null = null;
  /** Sessions that have died in a row without doing any work. */
  let failedStreak = 0;
  /** Whether the CURRENT session ever heard anything. */
  let heardThisSession = false;
  let watchdogHandle: number | null = null;
  let state: ListenState = 'off';
  /**
   * Whether the microphone has demonstrably been OPEN since start().
   *
   * This is the permission evidence, and it is deliberately not "a session
   * reached `listening`". Engines differ on whether `onstart` fires before a
   * permission refusal, so `listening` can be reached by a session that never
   * had a microphone at all -- and licensing retries off that would mean
   * re-asking someone who has just declined the prompt.
   *
   * What cannot be faked is a session that produced a transcript, or one that
   * simply stayed up: both require a live input. That is the same test
   * `onend` already uses to decide whether a session was working, so there is
   * one definition of "worked" here rather than two.
   */
  let everWorked = false;
  const worksProven = (): boolean => everWorked || (deps.hasWorked?.() ?? false);
  const markWorked = (): void => {
    if (everWorked) return;
    everWorked = true;
    try {
      deps.onWorked?.();
    } catch {
      /* remembering must never break listening */
    }
  };
  /** Permission errors in a row. Cleared by any session that reaches listening. */
  let permissionStreak = 0;
  /** Attempts since start(), for reading the log back. */
  let attempt = 0;
  /** When the current attempt called start(), to measure how long it took to confirm. */
  let beganAt = 0;

  const log = (event: string, detail?: Record<string, unknown>): void => {
    try {
      deps.log?.(event, detail);
    } catch {
      /* a logger must never take the microphone down with it */
    }
  };

  const setState = (next: ListenState): void => {
    if (state === next) return;
    const previous = state;
    state = next;
    log('state', { from: previous, to: next });
    try {
      deps.onState(next);
    } catch {
      /* a status callback must never take the microphone down with it */
    }
  };

  const clearRestart = (): void => {
    if (restartHandle !== null) {
      deps.cancel(restartHandle);
      restartHandle = null;
    }
  };

  const clearWatchdog = (): void => {
    if (watchdogHandle !== null) {
      deps.cancel(watchdogHandle);
      watchdogHandle = null;
    }
  };

  const teardown = (): void => {
    const dying = recognition;
    recognition = null;
    if (!dying) return;
    // Detach BEFORE aborting: an abort fires `onend`, and a live handler
    // would read it as an unexpected death and schedule a restart of a
    // session we are deliberately ending.
    dying.onstart = null;
    dying.onend = null;
    dying.onerror = null;
    dying.onresult = null;
    try {
      dying.abort();
    } catch {
      /* tearing down must never throw into a driver */
    }
  };

  const begin = (): void => {
    if (!running) return;
    clearRestart();
    teardown();
    attempt++;
    beganAt = deps.now();
    log('attempt', { n: attempt, failedStreak, permissionStreak });

    let fresh: RecognitionLike | null = null;
    try {
      fresh = deps.createRecognition();
    } catch {
      fresh = null;
    }
    if (!fresh) {
      running = false;
      log('unsupported');
      setState('unsupported');
      return;
    }

    recognition = fresh;
    fresh.continuous = true;
    fresh.interimResults = false;
    fresh.lang = 'en-US';
    // Ask for runners-up. Harmless where unsupported: the list simply
    // arrives with one entry, which is what it was before.
    fresh.maxAlternatives = SPOKEN_ALTERNATIVES;
    applyBias(fresh, deps.biasPhrases);
    if (deps.processLocally) {
      try {
        (fresh as unknown as { processLocally: boolean }).processLocally = true;
      } catch {
        /* an engine that will not go local still works over the network */
      }
    }

    fresh.onstart = () => {
      clearWatchdog();
      sessionStartedAt = deps.now();
      heardThisSession = false;
      log('session-start', { n: attempt, confirmedInMs: sessionStartedAt - beganAt });
      setState('listening');
    };

    fresh.onerror = (e) => {
      clearWatchdog();
      const error = e?.error ?? 'unknown';
      if (isPermissionError(error)) {
        permissionStreak++;
        // A refusal before anything ever worked is the operator declining the
        // prompt, and asking again would nag. A refusal after a session has
        // worked is usually iOS objecting to a restart with no user gesture
        // behind it, so it is retried like any other failure -- but only a few
        // times, because a genuine revocation must still come to rest.
        const proven = worksProven();
        const giveUp = !proven || permissionStreak > MAX_PERMISSION_RETRIES;
        log('session-error', {
          error,
          permissionStreak,
          everWorked: proven,
          giveUp,
        });
        if (giveUp) {
          running = false;
          setState('denied');
          teardown();
          return;
        }
        // Fall through to `onend`, which backs off and retries.
        return;
      }
      log('session-error', { error, sessionMs: sessionStartedAt > 0 ? deps.now() - sessionStartedAt : 0 });
      // Everything else is left to `onend`, which always follows it, so one
      // failure produces exactly one restart rather than two.
    };

    fresh.onend = () => {
      clearWatchdog();
      if (!running) {
        setState('off');
        return;
      }

      // A session that heard something, or simply stayed up, was working --
      // whatever ended it, the microphone is fine. Only a session that did
      // neither counts against the streak.
      const lasted = sessionStartedAt > 0 ? deps.now() - sessionStartedAt : 0;
      const worked = heardThisSession || lasted >= PRODUCTIVE_SESSION_MS;
      if (worked) {
        failedStreak = 0;
        markWorked();
        // Cleared HERE and not in `onstart`: some engines fire onstart and
        // then refuse, so clearing on start would mean the retry cap could
        // never be reached and a real revocation would retry forever.
        permissionStreak = 0;
      } else {
        failedStreak++;
      }

      const delay = restartDelayFor(failedStreak);
      log('session-end', {
        n: attempt,
        sessionMs: lasted,
        heard: heardThisSession,
        failedStreak,
        restartInMs: delay,
      });
      setState('restarting');
      restartHandle = deps.schedule(begin, delay);
    };

    fresh.onresult = (e) => {
      const results = e?.results;
      if (!results) return;
      const last = results[results.length - 1];
      if (!last) return;

      // Every reading the engine offered, best first. On a car microphone the
      // winner is often an ordinary word with the command ranked behind it.
      const offered: string[] = [];
      const count = last.length ?? 1;
      for (let i = 0; i < count; i++) {
        const text = (last[i]?.transcript ?? '').trim();
        if (text) offered.push(text);
      }
      const heard = offered[0] ?? '';
      if (!heard) return;
      // Proof the microphone is alive, whatever is made of the words below --
      // and the standing evidence that permission was really granted.
      heardThisSession = true;
      markWorked();
      permissionStreak = 0;
      log('result', {
        heard,
        alternatives: offered.length - 1,
        sessionMs: sessionStartedAt > 0 ? deps.now() - sessionStartedAt : 0,
      });

      // The app's own voice, arriving back through the microphone.
      if (isSuppressed(deps.now(), suppressedUntil)) {
        log('suppressed', { heard, forMs: suppressedUntil - deps.now() });
        deps.onHeard?.(heard, 'suppressed');
        return;
      }

      // A modal that owns the microphone answers first, or not at all.
      const claimed = deps.onTranscript?.(heard, offered);
      if (claimed) {
        deps.onHeard?.(heard, claimed);
        return;
      }

      const match = resolveSpoken(offered);
      // How it matched is worth keeping. An engine that ranked the word
      // second, and one that never produced it at all, are different problems
      // -- and only the log can tell them apart after the drive.
      const action = match?.action ?? null;
      const verdict = match === null ? 'rejected' : verdictFor(match);
      log('verdict', { heard, verdict });
      deps.onHeard?.(heard, verdict);
      if (!action) return;
      try {
        deps.onAction(action);
      } catch {
        /* a consumer throwing must not end the session */
      }
    };

    setState('starting');
    // An engine that never confirms is not merely a reporting problem.
    //
    // This used to set 'error' and stop there, on the reasoning that a session
    // which confirms late still works. That is true, and it left the other
    // case -- a session that never confirms at all -- parked in 'error' for
    // the rest of the drive with nothing scheduled to rescue it. On an iPhone
    // whose audio route has just flipped, `start()` returning quietly and
    // firing nothing is a routine outcome, so the state the operator ends up
    // in most often was the one with no way out.
    //
    // Now it is treated as the failed session it is: torn down, counted, and
    // retried on the same backoff as any other failure. A late `onstart` is
    // still handled -- it belongs to a recogniser that has already been
    // detached, so it cannot correct a state it no longer owns.
    clearWatchdog();
    watchdogHandle = deps.schedule(() => {
      watchdogHandle = null;
      if (state !== 'starting') return;
      failedStreak++;
      const delay = restartDelayFor(failedStreak);
      log('start-timeout', { n: attempt, afterMs: START_TIMEOUT_MS, failedStreak, restartInMs: delay });
      teardown();
      if (!running) return;
      setState('restarting');
      clearRestart();
      restartHandle = deps.schedule(begin, delay);
    }, START_TIMEOUT_MS);

    try {
      fresh.start();
    } catch (e) {
      // Already-started is the usual cause and resolves itself; anything
      // else surfaces through onerror/onend.
      clearWatchdog();
      log('start-threw', { error: String(e) });
      setState('error');
    }
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      attempt = 0;
      failedStreak = 0;
      permissionStreak = 0;
      everWorked = false;
      log('start');
      begin();
    },
    stop: () => {
      running = false;
      clearRestart();
      clearWatchdog();
      teardown();
      sessionStartedAt = 0;
      log('stop');
      setState('off');
    },
    suppressFor: (ms: number) => {
      const until = deps.now() + Math.max(0, ms) + SPEECH_TAIL_MS;
      // Never shorten an existing window: back-to-back utterances would
      // otherwise unmute the microphone while the app is still talking.
      if (until > suppressedUntil) suppressedUntil = until;
    },
    cycleIfStale: () => {
      if (!running) return;
      if (!shouldCycle(sessionStartedAt, deps.now())) return;
      log('cycle', { ageMs: deps.now() - sessionStartedAt });
      begin();
    },
    resume: (reason: string) => {
      if (!running) {
        log('resume-ignored', { reason, state });
        return;
      }
      // A confirmed session is doing its job; restarting it would cost a real
      // deaf window for nothing. Anything else -- backing off, stuck starting,
      // parked in error -- is a session the operator is currently talking into
      // for no result, and the condition that broke it has just changed.
      if (state === 'listening') {
        log('resume-ignored', { reason, state });
        return;
      }
      log('resume', { reason, state, failedStreak });
      failedStreak = 0;
      permissionStreak = 0;
      begin();
    },
    state: () => state,
  };
}

/**
 * The browser's recognition constructor, or null. Kept out of the controller
 * so that stays free of globals and testable in plain node.
 */
export function browserRecognition(): RecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}
