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
      diag('route', 'devicechange');
      void logAudioInputs('devicechange');
    });
  });
}

export { installed as _diagnosticsInstalledForTest };
