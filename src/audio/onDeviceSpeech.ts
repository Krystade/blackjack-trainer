/**
 * On-device speech recognition.
 *
 * Chrome's Web Speech API is normally a CLOUD service: audio is streamed to
 * Google's recognisers, which is why it is as accurate as it is, and also why
 * it has the two properties that hurt most in a car --
 *
 *   - a server-side session limit, which is what kills a listening session
 *     roughly every ninety seconds. The restart after it is deaf, and every
 *     restart re-opens the microphone, which is the crackle heard on each
 *     cycle. Neither can be designed away: a second recogniser ends the first
 *     rather than covering for it, so there is one session per page.
 *   - a hard dependency on the network. A tunnel or a dead zone stops it.
 *
 * A locally installed model has no server, so in principle it has neither
 * problem. Chrome exposes this as `processLocally`, gated behind a model that
 * must be downloaded first.
 *
 * WHAT IS ACTUALLY KNOWN, from probing Chrome 152 rather than from
 * documentation:
 *
 *   available({langs:['en-US']})                      -> "available"
 *   available({langs:['en-US'], processLocally:true}) -> "downloadable"
 *   available({langs:['xx-XX'], processLocally:true}) -> "unavailable"
 *   install({langs:['en-US']})                        -> Promise<boolean>
 *
 * And the part that shapes this whole module: in a headless browser
 * `install()` resolves FALSE IN ZERO MILLISECONDS, with a real user gesture,
 * without throwing and without any reason attached. A refusal is not an
 * error, carries no explanation, and is indistinguishable from a decision not
 * to bother. So nothing here may report success on its own say-so: the only
 * trustworthy signal is asking `available()` again afterwards.
 *
 * THE QUERY CAN KILL THE TAB. Measured across two builds of the same browser:
 *
 *   Chrome 152   available({langs:['en-US'], processLocally:true}) -> "downloadable"
 *   Chromium 149 available({langs:['en-US'], processLocally:true}) -> RENDERER CRASH
 *
 * Only `processLocally: true` does it; the same call without that option
 * resolves normally on both. The two builds expose an identical API surface
 * -- same statics, same prototype properties -- so there is nothing to
 * feature-detect, and the promise never settles, so there is nothing to
 * catch either. The page simply dies.
 *
 * Two rules follow, and they are why this module is shaped the way it is:
 *
 *   1. NOTHING ASKS ON ITS OWN. The query happens only when the operator
 *      explicitly asks for it, or has already opted in on a browser where it
 *      previously worked. Opening Settings must never be able to kill the app.
 *   2. IT IS ASKED AT MOST ONCE ON A BROWSER THAT CANNOT SURVIVE IT. A
 *      breadcrumb is written before the call and cleared after it. Finding
 *      that breadcrumb still set on a later load means the last call never
 *      returned -- so it is never made again on this device.
 */

/** Chrome's own vocabulary, plus the two cases it cannot describe. */
export type OnDeviceStatus =
  /** No such API on this browser. */
  | 'unsupported'
  /** The API exists but has no model for this language, ever. */
  | 'unavailable'
  /** A model exists and could be fetched. */
  | 'downloadable'
  /** A fetch is in progress. */
  | 'downloading'
  /** Installed and usable offline. */
  | 'available'
  /** The query itself failed, which is not the same as "no". */
  | 'unknown';

export const SPEECH_LANG = 'en-US';

const PREFERENCE_KEY = 'bjtrainer.voiceLocal.v1';

/**
 * The breadcrumb for rule 2 above: set while a query is in flight, cleared
 * the moment it returns either way.
 *
 * Best effort by nature. The write is synchronous, so it normally reaches
 * storage before a crash takes the renderer, but a device that loses it pays
 * one more crash and no worse -- which is still bounded, and still better
 * than asking on every load forever.
 */
const PROBE_KEY = 'bjtrainer.voiceLocalProbe.v1';

/**
 * Whether the last capability query never came back.
 *
 * This is not "the query failed": a failure returns, and is reported as
 * 'unknown'. This is the query having taken the page down with it.
 */
export function onDeviceProbeCrashed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PROBE_KEY) === 'pending';
  } catch {
    return false;
  }
}

function markProbeInFlight(inFlight: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (inFlight) localStorage.setItem(PROBE_KEY, 'pending');
    else localStorage.removeItem(PROBE_KEY);
  } catch {
    /* private mode: the breadcrumb is simply not kept */
  }
}

/**
 * Allow the query to be attempted again after it once took the tab down.
 *
 * Offered because a browser update can fix the underlying crash, and there
 * would otherwise be no way back short of clearing site data.
 */
export function clearOnDeviceProbeGuard(): void {
  markProbeInFlight(false);
}

interface RecognitionStatic {
  available?: (opts: { langs: string[]; processLocally?: boolean }) => Promise<string>;
  install?: (opts: { langs: string[] }) => Promise<boolean>;
}

function recognitionStatic(): RecognitionStatic | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionStatic;
    webkitSpeechRecognition?: RecognitionStatic;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function asStatus(raw: string): OnDeviceStatus {
  switch (raw) {
    case 'available':
    case 'downloadable':
    case 'downloading':
    case 'unavailable':
      return raw;
    default:
      // A value this build does not know about. Reporting it as unavailable
      // would be a guess; "unknown" at least says so.
      return 'unknown';
  }
}

/**
 * Whether a local model is installed, fetchable, or out of the question.
 *
 * Never call this on mount or on a timer: on some builds it does not return
 * at all, it kills the renderer (see the header). Call it from an explicit
 * request, or where the operator has already opted in on this device.
 */
export async function onDeviceStatus(lang: string = SPEECH_LANG): Promise<OnDeviceStatus> {
  const SR = recognitionStatic();
  if (!SR || typeof SR.available !== 'function') return 'unsupported';
  // The last attempt on this device never came back. Asking again would just
  // take the tab down a second time.
  if (onDeviceProbeCrashed()) return 'unknown';

  markProbeInFlight(true);
  try {
    const raw = await SR.available({ langs: [lang], processLocally: true });
    markProbeInFlight(false);
    return asStatus(raw);
  } catch {
    // A malformed language, or a build that rejects the option shape. It
    // returned, so the breadcrumb comes back off: this browser survives it.
    markProbeInFlight(false);
    return 'unknown';
  }
}

export interface InstallOutcome {
  /** What `install()` itself claimed. False is a refusal, not a failure. */
  accepted: boolean;
  /** What `available()` says AFTERWARDS, which is the part worth believing. */
  status: OnDeviceStatus;
}

/**
 * Ask for the model.
 *
 * MUST be called straight from a click handler: this needs a user gesture,
 * and awaiting anything first spends it. The caller therefore does the
 * awaiting on the promise this returns, never before calling it.
 */
export async function installOnDevice(lang: string = SPEECH_LANG): Promise<InstallOutcome> {
  const SR = recognitionStatic();
  if (!SR || typeof SR.install !== 'function') {
    return { accepted: false, status: 'unsupported' };
  }

  let accepted = false;
  try {
    accepted = (await SR.install({ langs: [lang] })) === true;
  } catch {
    accepted = false;
  }

  // Asked again regardless of what install() claimed. A refusal is silent and
  // unexplained, and a browser that has already fetched the model reports
  // "available" here whatever it returned above.
  return { accepted, status: await onDeviceStatus(lang) };
}

/**
 * The stored preference.
 *
 * Unlike the voice toggle itself -- which is per-session, because a persisted
 * one would open a microphone on page load -- this is a capability choice,
 * not an activation. Remembering it opens nothing.
 */
export function prefersOnDevice(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PREFERENCE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPrefersOnDevice(on: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (on) localStorage.setItem(PREFERENCE_KEY, '1');
    else localStorage.removeItem(PREFERENCE_KEY);
  } catch {
    /* private mode: the preference is simply not remembered */
  }
}

/**
 * Whether to actually run locally right now.
 *
 * Requires BOTH the preference and an installed model. Turning
 * `processLocally` on without one risks a recogniser that starts and never
 * hears anything -- and failing silently in a car is worse than using the
 * cloud path that already works.
 */
export function shouldProcessLocally(status: OnDeviceStatus, preferred: boolean): boolean {
  return preferred && status === 'available';
}

/** Plain English for a status line, saying what can be done about it. */
export function describeOnDeviceStatus(status: OnDeviceStatus): string {
  switch (status) {
    case 'available':
      return 'Installed. Recognition runs on this device, with no network and no session limit.';
    case 'downloadable':
      return 'Not installed yet. Downloading it lets recognition work with no signal, and should stop the session dropping every ~90 seconds.';
    case 'downloading':
      return 'Downloading now. This can take a few minutes; it continues in the background.';
    case 'unavailable':
      return 'This browser has no on-device model for English. Recognition will keep using the network.';
    case 'unsupported':
      return 'This browser cannot do on-device recognition at all. Recognition will keep using the network.';
    case 'unknown':
      return 'Could not tell whether an on-device model is available. Recognition will keep using the network.';
  }
}
