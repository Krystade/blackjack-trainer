/**
 * The context a voice session ran in, recorded so a bad session can be read
 * back instead of guessed at.
 *
 * Everything here is about the three questions the operator's report raises
 * and the app currently cannot answer:
 *
 *   "the mic doesn't stay active"
 *      -> did the PAGE go away (hidden, frozen, unloaded), or did the SESSION
 *         die while the page stayed up? Those have opposite fixes, and from
 *         the driver's seat they are identical.
 *
 *   "I always accept the mic request"
 *      -> and did it stay accepted? Permission can change under a running
 *         page, and Safari does not always say so out loud.
 *
 *   "it frequently doesn't hear me"
 *      -> was the microphone even the one being listened to? A car connects
 *         and disconnects Bluetooth audio constantly, and every flip
 *         re-routes the input. `devicechange` is the only event that says so.
 *
 * None of this is diagnosis. It is evidence, written down in the order it
 * happened, so that diagnosis becomes possible after the drive.
 *
 * Every listener is absence-guarded: this runs on an iPhone, in an installed
 * PWA, in Playwright's Chromium, and in node under vitest, and only the first
 * of those has all of it.
 */

import { diag, flushDiagnostics } from './diagnosticLog';
import { runningBuildId, runningBuiltAt } from '../updateCheck';
import { markInputDeviceChanged } from './deviceChurn';

/** Kept so a second mount (React strict mode, a remount) cannot double-log. */
let installed = false;

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* diagnostics may never throw into a driver */
  }
}

/**
 * The facts that do not change during a page load.
 *
 * Written once, at the top of the log, because the first question about any
 * pasted log is "what was this running on" -- an installed PWA and a Safari
 * tab behave differently for speech recognition, and the log has to say which
 * one it was without the operator having to remember.
 */
export function logEnvironment(): void {
  safe(() => {
    const w = window as unknown as Record<string, unknown>;
    const nav = navigator as unknown as {
      standalone?: boolean;
      userAgent?: string;
      language?: string;
      hardwareConcurrency?: number;
      mediaDevices?: unknown;
      permissions?: unknown;
      wakeLock?: unknown;
    };
    const standalone =
      nav.standalone === true ||
      (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);

    diag('env', 'page-load', {
      ua: nav.userAgent ?? 'unknown',
      standalone,
      lang: nav.language ?? 'unknown',
      online: typeof navigator.onLine === 'boolean' ? navigator.onLine : 'unknown',
      visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
      url: typeof location !== 'undefined' ? location.href : 'unknown',
      // WHICH CODE WROTE THIS. The app deploys continuously from `main` and
      // reloads ITSELF mid-drive when a new build lands, so one exported log
      // routinely spans two different builds with nothing marking the seam --
      // and a reader attributes behaviour to code that was not running. The
      // id was already in the bundle and the logger simply never asked for
      // it. `url` sometimes carries `?v=<id>` from the update check's reload,
      // which is the id of the build the PREVIOUS load was navigating toward:
      // a build-ish token that misleads rather than merely omits.
      build: runningBuildId() ?? 'unknown',
      builtAt: runningBuiltAt() ?? 'unknown',
    });

    diag('env', 'capabilities', {
      // Which constructor exists decides everything downstream: the standard
      // one is Chrome's (phrase biasing, on-device models); the webkit one is
      // Safari's (no biasing, server-backed, ends after each utterance).
      recognition: w.SpeechRecognition ? 'standard' : w.webkitSpeechRecognition ? 'webkit' : 'none',
      phraseBias: typeof w.SpeechRecognitionPhrase === 'function',
      mediaDevices: !!nav.mediaDevices,
      permissionsApi: !!nav.permissions,
      wakeLock: !!nav.wakeLock,
      speechSynthesis: typeof w.speechSynthesis !== 'undefined',
    });

    /**
     * WHICH VOICES EXIST, AND WHETHER THE PHONE NOMINATES ONE.
     *
     * The voice heuristic in speech.ts weights `SpeechSynthesisVoice.default`
     * and falls back to a name allowlist when nothing is nominated, and until
     * now nothing recorded which of those two paths a given phone takes. That
     * gap produced two shipped bugs in one evening: the drill was read out by
     * `Bahh` on 2026-09-29 because every en-US voice tied and the tie-break is
     * alphabetical, and the first fix for it would have returned `Fred` on any
     * phone that nominates nothing -- a case nobody could check, because the
     * flag was never in a log.
     *
     * `count` also stands as the readiness reading. iOS populates the list
     * asynchronously, so an utterance spoken early resolves against a partial
     * list. A `tts-end` with a voice name that could not have won a full list
     * is evidence the list was still filling, which is a candidate explanation
     * for the six silent utterances of 2026-09-29 that is otherwise
     * unfalsifiable.
     *
     * AND READ AGAIN IF IT WAS EMPTY. `count=0` appeared on one page load of
     * the 2026-10-03 export and means two opposite things -- a phone with no
     * speech synthesis at all, or a list that had simply not filled yet -- so
     * on its own it is not a reading. `speech.ts` has subscribed to
     * `voiceschanged` since `primeVoices` landed, and this takes the same
     * event for the log: one correcting row, only where the first was empty,
     * so silence afterwards means the list genuinely never arrived.
     */
    try {
      const synth = (w as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
      const report = (voices: SpeechSynthesisVoice[], when: 'boot' | 'late'): void => {
        diag('env', 'voices', {
          when,
          count: voices.length,
          nominated: voices.find((v) => v.default === true)?.name,
          names: voices
            .filter((v) => v.lang?.toLowerCase().startsWith('en'))
            .map((v) => v.name)
            .join(', '),
        });
      };
      const voices: SpeechSynthesisVoice[] = synth?.getVoices?.() ?? [];
      report(voices, 'boot');
      if (voices.length === 0 && typeof synth?.addEventListener === 'function') {
        let corrected = false;
        synth.addEventListener('voiceschanged', () => {
          try {
            // ONCE. A phone that fires the event repeatedly would otherwise
            // write a row per fire into a log read by hand.
            if (corrected) return;
            const later: SpeechSynthesisVoice[] = synth.getVoices?.() ?? [];
            if (later.length === 0) return;
            corrected = true;
            report(later, 'late');
          } catch {
            /* the late reading is an improvement on silence, never a cost */
          }
        });
      }
    } catch {
      /* a voice inventory is a diagnostic; never let it break boot */
    }
  });
}

/**
 * What the browser will admit about microphone permission.
 *
 * Safari does not implement `permissions.query({name:'microphone'})` at all --
 * it throws a TypeError on the name rather than returning 'prompt' -- so an
 * absent answer here is itself a fact worth recording, not a failure. It is
 * the difference between "permission was revoked" and "this browser will not
 * say", and only one of those is worth chasing.
 */
export async function logMicPermission(reason: string): Promise<void> {
  try {
    const permissions = navigator.permissions as
      | { query: (d: { name: string }) => Promise<{ state: string }> }
      | undefined;
    if (!permissions?.query) {
      diag('perm', 'mic-state', { reason, state: 'unavailable' });
      return;
    }
    const status = await permissions.query({ name: 'microphone' });
    diag('perm', 'mic-state', { reason, state: status.state });
    const withChange = status as unknown as { onchange?: (() => void) | null };
    if (withChange.onchange === null) {
      withChange.onchange = () => {
        diag('perm', 'mic-changed', { state: (status as { state: string }).state });
      };
    }
  } catch (e) {
    diag('perm', 'mic-state', { reason, state: 'query-threw', error: String(e) });
  }
}

/**
 * Which audio inputs exist right now.
 *
 * Labels are empty until microphone permission has been granted, which is
 * itself informative -- an empty label set during a session that believes it
 * is listening says the permission is not what the app thinks it is. The
 * count alone is enough to see a car's hands-free device appear and vanish.
 */
export async function logAudioInputs(reason: string): Promise<void> {
  try {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) {
      diag('route', 'inputs', { reason, state: 'unavailable' });
      return;
    }
    const devices = await md.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    diag('route', 'inputs', {
      reason,
      count: inputs.length,
      // Labels are the useful part in a car -- "iPhone Microphone" versus the
      // car's own hands-free unit is exactly the flip being hunted.
      labels: inputs.map((d) => d.label || '(unlabelled)').join(' | '),
    });
  } catch (e) {
    diag('route', 'inputs', { reason, state: 'threw', error: String(e) });
  }
}

/**
 * WHICH OUTPUT THE PHONE IS ON, read through the one thing a web page can see.
 *
 * This is the question the 2026-10-02 drive could not answer. "It's still
 * coming from the top quiet phone speaker instead of the bottom loud speaker"
 * is the loudest complaint in the log and the only one with no measurement
 * behind it: iOS exposes no output-route API to a web page at all -- no
 * `setSinkId`, no device list for outputs, nothing.
 *
 * But an AudioContext is built at the rate the HARDWARE is on at the moment it
 * is constructed, and that rate names the route:
 *
 *   48000  -> the ordinary playback session, which is the loud bottom speaker
 *   16000 or 8000 -> play-and-record or Bluetooth HFP, which is the earpiece
 *                    at the top of the phone and the car's phone-call path
 *
 * iOS moves the session into play-and-record whenever a microphone is open,
 * and play-and-record defaults its output to the receiver. That is the leading
 * explanation for the earpiece, and this is what settles it -- read before the
 * microphone opens and again after, the pair says whether the session moved.
 *
 * THROWAWAY ON PURPOSE. The shared context (audio/audioContext.ts) is fixed at
 * whatever rate it was built with and cannot answer this twice; a fresh one
 * reports the rate right now. It is closed immediately, and the count is
 * capped, because a drill that opens the microphone every few seconds would
 * otherwise build hundreds of them over a drive.
 */
const MAX_RATE_PROBES = 24;
let rateProbes = 0;

export function logHardwareRate(reason: string): void {
  if (rateProbes >= MAX_RATE_PROBES) return;
  rateProbes += 1;
  try {
    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      diag('route', 'hardware-rate', { reason, state: 'unavailable' });
      return;
    }
    const ctx = new Ctor();
    diag('route', 'hardware-rate', { reason, rate: ctx.sampleRate, state: ctx.state });
    // Fire and forget: `close()` returns a promise, and a rejection here is of
    // no interest -- the reading is already taken.
    void Promise.resolve(ctx.close()).catch(() => {});
  } catch (e) {
    diag('route', 'hardware-rate', { reason, state: 'threw', error: String(e) });
  }
}

/** Test-only: let a suite take more than one drive's worth of readings. */
export function _resetRateProbesForTest(): void {
  rateProbes = 0;
}

/**
 * WHICH microphone, not which microphones.
 *
 * `logAudioInputs` above lists the inputs that EXIST. Nothing in it says
 * which one the phone is USING -- and that is the whole question, because
 * the input switching to the car's hands-free unit is the one thing a web
 * page can observe about the Bluetooth profile flip this protocol measures
 * the effects of. The recogniser exposes no stream, so the only way to read
 * the label is a short capture of our own, stopped at once.
 *
 * THE CALLER DECIDES WHERE. On iOS this is a second capture beside a live
 * recogniser and may restart it (unverified), so it is only safe on a step
 * whose own measurement is not a route sample. `fieldTest.ts` marks that
 * step with `probeInput`; nothing else should call this mid-run.
 */
export async function logSelectedInput(reason: string): Promise<void> {
  try {
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      diag('route', 'input-selected', { reason, state: 'unavailable' });
      return;
    }
    const stream = await md.getUserMedia({ audio: true });
    try {
      const track = stream.getAudioTracks()[0];
      diag('route', 'input-selected', {
        reason,
        label: track?.label || '(unlabelled)',
        deviceId: track?.getSettings?.().deviceId ?? '(unknown)',
      });
    } finally {
      // The probe must never be the thing that leaves a microphone open.
      for (const track of stream.getTracks()) track.stop();
    }
  } catch (e) {
    diag('route', 'input-selected', { reason, state: 'threw', error: String(e) });
  }
}

/**
 * Install the page-level watchers. Idempotent.
 *
 * Called once from the app root, not from the voice hook: the events being
 * watched happen whether or not voice is on, and the ones that matter most
 * (the page being frozen, the route flipping) happen precisely when the voice
 * hook is not running to see them.
 */
export function startDiagnostics(): void {
  if (installed) return;
  installed = true;

  logEnvironment();
  void logMicPermission('boot');
  void logAudioInputs('boot');

  safe(() => {
    document.addEventListener('visibilitychange', () => {
      diag('life', 'visibility', { state: document.visibilityState });
      // A hidden page is the single most likely explanation for a microphone
      // that "stopped", so the log must not lose the lines leading up to it.
      if (document.visibilityState === 'hidden') flushDiagnostics();
    });

    window.addEventListener('pagehide', (e) => {
      diag('life', 'pagehide', { persisted: (e as PageTransitionEvent).persisted });
      flushDiagnostics();
    });

    window.addEventListener('pageshow', (e) => {
      diag('life', 'pageshow', { persisted: (e as PageTransitionEvent).persisted });
    });

    // Chrome's freeze/resume for a backgrounded tab. Not in Safari, harmless
    // where absent, and the only positive evidence that the browser -- rather
    // than the speech engine -- is what stopped the microphone.
    document.addEventListener('freeze', () => {
      diag('life', 'freeze');
      flushDiagnostics();
    });
    document.addEventListener('resume', () => {
      diag('life', 'resume');
    });

    window.addEventListener('online', () => diag('life', 'online'));
    window.addEventListener('offline', () => {
      // Webkit recognition is server-backed: offline means deaf, not merely slow.
      diag('life', 'offline');
    });

    window.addEventListener('error', (e) => {
      diag('err', 'window-error', { message: e.message, source: e.filename, line: e.lineno });
    });
    window.addEventListener('unhandledrejection', (e) => {
      diag('err', 'unhandled-rejection', { reason: String((e as PromiseRejectionEvent).reason) });
    });

    const md = navigator.mediaDevices as unknown as {
      addEventListener?: (t: string, fn: () => void) => void;
    };
    md?.addEventListener?.('devicechange', () => {
      // Stamped before anything async: the correlation on a `session-error`
      // is only worth having if it is accurate to the event rather than to
      // whenever `enumerateDevices` happened to come back.
      markInputDeviceChanged(Date.now());
      diag('route', 'devicechange');
      void logAudioInputs('devicechange');
    });
  });
}

export { installed as _diagnosticsInstalledForTest };
