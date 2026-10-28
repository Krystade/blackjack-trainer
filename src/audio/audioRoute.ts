/**
 * Which route the sound and the microphone take, and what the app does about
 * it while voice answers are on.
 *
 * THREE ROUTES, one owner ask (2026-10-26): "bluetooth and speaker phone
 * working in the car, and with bluetooth ... the car speaker+mic and a
 * headphone speaker+mic combo."
 *
 *   phone      no Bluetooth: the phone's loud speaker and the phone's mic
 *   bluetooth  a Bluetooth input is listed -- the car's hands-free unit, or a
 *              headset such as AirPods (told apart only by its name)
 *
 * What the app can SEE is narrow, and every reading here is logged so a drive
 * can be read back: the input labels (WebKit hands out the port name --
 * "TOYOTA Corolla", "iPhone Microphone" -- once permission is granted), which
 * input is first (WebKit sorts the route's current input first), whether
 * `setSinkId` exists and whether any output is listed. Where the sound
 * actually came out -- car, loud speaker, earpiece -- only Jack's ears can
 * say; see docs/research/2026-10-26-audio-routes.md.
 *
 * STRATEGIES, switchable so a drive can compare them:
 *
 *   web-audio        today's behaviour: clips and chimes through Web Audio once
 *                    a mic has opened. Measured 7/7 on the loud speaker at the
 *                    desk; intermittent over the car's Bluetooth.
 *   play-and-record  declare `navigator.audioSession.type = 'play-and-record'`
 *                    BEFORE capture opens and keep it until voice stops. WebKit
 *                    then never changes the category at mic open or close
 *                    (the declared type is a category override). Unmeasured.
 *   speaker-sink     play clips on an <audio> element pointed at a listed
 *                    loud-speaker output with `setSinkId` (iOS 18.4+). Only
 *                    possible if iOS lists such an output. Unmeasured.
 *
 * And a HELD INPUT: a getUserMedia capture on a chosen input, held while voice
 * is on. WebKit turns its deviceId into `AVAudioSession setPreferredInput:`,
 * and the speech recogniser captures from the route's current input, so this
 * is the one lever a page has over which mic -- and, by iOS's hands-free
 * pairing, which output -- the route uses. Unmeasured.
 */
import { diag } from '../diag/diagnosticLog';
import { openMicStream } from './openMicStream';
import { readAudioSessionType, requestAudioSessionType } from './audioSession';

/** The owner's setting. */
export type RoutePref = 'auto' | 'phone' | 'bluetooth';
/** The sound-path setting. 'auto' picks the best-evidence strategy per route. */
export type RouteStrategySetting = 'auto' | RouteStrategy;
export type RouteStrategy = 'web-audio' | 'play-and-record' | 'speaker-sink';
/** Which input to hold open beside the recogniser. */
export type HoldInput = 'none' | 'phone' | 'bluetooth';

export interface DeviceLike {
  kind: string;
  label: string;
  deviceId: string;
}

export type RouteKind = 'phone' | 'bluetooth' | 'unknown';

export interface DetectedRoute {
  kind: RouteKind;
  /** Every audio input's label, in the order the browser listed them. */
  inputs: string[];
  /** Their deviceIds, same order; aliases and blanks left out. */
  inputIds: string[];
  /** The first listed input: WebKit sorts the route's current input first. */
  first: string | null;
  /** The non-phone input, when there is one. */
  bluetooth: { label: string; deviceId: string } | null;
  phone: { label: string; deviceId: string } | null;
  /** A guess from the name only, logged as a guess. */
  guess: 'car' | 'headset' | null;
  /** Labels of listed audio outputs (iOS may list none). */
  outputs: Array<{ label: string; deviceId: string }>;
  sinkIdSupported: boolean;
}

/** Labels are empty before permission; "(unlabelled)" means exactly that. */
const PHONE_INPUT = /iphone|built-?in|^microphone$/i;
/** Ids that alias another device rather than naming one. */
const ALIAS_IDS = new Set(['', 'default', 'communications']);

/**
 * Inputs to a route. Pure. A route is `bluetooth` when an input other than the
 * phone's own is listed; `unknown` when nothing is labelled (no permission
 * yet), because an unlabelled list cannot be told apart.
 */
export function classifyInputs(devices: readonly DeviceLike[], sinkIdSupported = false): DetectedRoute {
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  const outputs = devices
    .filter((d) => d.kind === 'audiooutput' && !ALIAS_IDS.has(d.deviceId))
    .map((d) => ({ label: d.label || '(unlabelled)', deviceId: d.deviceId }));
  const labelled = inputs.filter((d) => d.label !== '');
  const phoneDev = labelled.find((d) => PHONE_INPUT.test(d.label) && !ALIAS_IDS.has(d.deviceId)) ?? null;
  const btDev =
    labelled.find((d) => !PHONE_INPUT.test(d.label) && !ALIAS_IDS.has(d.deviceId) && !/^default\b/i.test(d.label)) ??
    null;
  const kind: RouteKind = labelled.length === 0 ? 'unknown' : btDev ? 'bluetooth' : 'phone';
  return {
    kind,
    inputs: inputs.map((d) => d.label || '(unlabelled)'),
    inputIds: inputs.map((d) => d.deviceId).filter((id) => !ALIAS_IDS.has(id)),
    first: inputs[0] ? inputs[0].label || '(unlabelled)' : null,
    bluetooth: btDev ? { label: btDev.label, deviceId: btDev.deviceId } : null,
    phone: phoneDev ? { label: phoneDev.label, deviceId: phoneDev.deviceId } : null,
    guess: btDev ? guessBluetoothKind(btDev.label) : null,
    outputs,
    sinkIdSupported,
  };
}

/**
 * Car or headset, from the name alone. A GUESS: a car names itself by make
 * ("TOYOTA Corolla") and a headset by product, and nothing else a page can
 * read separates them. Unrecognised names count as a car, since that is the
 * route this app is driven on.
 */
export function guessBluetoothKind(label: string): 'car' | 'headset' {
  return /airpods|beats|buds|headphone|headset|earphone|earbud|\bpods?\b|bose|jabra|sony wh|sony wf|powerbeats|shokz|pixel buds/i.test(label)
    ? 'headset'
    : 'car';
}

/** A loud-speaker output, if iOS lists one by a name that says so. */
export function pickSpeakerOutput(route: DetectedRoute): { label: string; deviceId: string } | null {
  return route.outputs.find((o) => /speaker/i.test(o.label) && !/receiver|earpiece/i.test(o.label)) ?? null;
}

export interface RoutePlan {
  strategy: RouteStrategy;
  hold: HoldInput;
  /**
   * 'measured' when the choice rests on a log from Jack's phone;
   * 'drive-decides' when it is a default nobody has measured on this route.
   */
  evidence: 'measured' | 'drive-decides';
  why: string;
}

/*
 * DRIVE DECIDES. The Auto defaults per route, and what each rests on. Change
 * them only from a kit log (Test kit -> Route kits); see the design note.
 *
 *   phone      web-audio  measured: loud speaker 7/7 with the mic open (2026-10-05)
 *   bluetooth  web-audio  intermittent (car 12 of 30 blind plays, five runs); no candidate
 *                         has been tried, so the default stays what was measured
 *   unknown    web-audio  the same code path as both of the above
 */
export const AUTO_STRATEGY: Record<RouteKind, RouteStrategy> = {
  phone: 'web-audio',
  bluetooth: 'web-audio',
  unknown: 'web-audio',
};

/** Pure: what to do for this setting on this route. */
export function planRoute(pref: RoutePref, strategy: RouteStrategySetting, route: DetectedRoute): RoutePlan {
  // The held input. Auto holds nothing: holding a second capture beside the
  // recogniser is unmeasured and might disturb it.
  let hold: HoldInput = 'none';
  let holdWhy = '';
  if (pref === 'phone' && route.kind === 'bluetooth') {
    hold = 'phone';
    holdWhy = 'phone mic held so the route leaves the Bluetooth mic';
  } else if (pref === 'bluetooth' && route.kind === 'bluetooth') {
    hold = 'bluetooth';
    holdWhy = `${route.bluetooth?.label ?? 'Bluetooth'} mic held so the route stays on it`;
  }
  else if (pref !== 'auto' && route.kind === 'unknown') {
    // Nothing named yet (no permission, or not read yet): hold what the
    // setting asks for, and let the hold itself look once the mic is open.
    hold = pref;
    holdWhy = `${pref} mic held once the inputs are named`;
  }

  let chosen: RouteStrategy;
  let evidence: RoutePlan['evidence'];
  let why: string;
  if (strategy === 'auto') {
    chosen = AUTO_STRATEGY[route.kind];
    evidence = route.kind === 'phone' && hold === 'none' ? 'measured' : 'drive-decides';
    why = route.kind === 'phone' ? 'Web Audio reached the loud speaker 7 of 7 with the mic open' : 'no other way has been tried on this route yet';
  } else {
    chosen = strategy;
    evidence = 'drive-decides';
    why = 'chosen by hand';
  }
  if (chosen === 'speaker-sink' && !(route.sinkIdSupported && pickSpeakerOutput(route))) {
    chosen = 'web-audio';
    why = 'no loud-speaker output is listed, so Web Audio instead';
  }
  if (hold !== 'none') why = `${why}; ${holdWhy}`;
  return { strategy: chosen, hold, evidence, why };
}

/* ------------------------------------------------------------------------ */
/* Runtime                                                                   */
/* ------------------------------------------------------------------------ */

let prefs: { pref: RoutePref; strategy: RouteStrategySetting } = { pref: 'auto', strategy: 'auto' };
let lastRoute: DetectedRoute = classifyInputs([]);
let activePlan: RoutePlan | null = null;
let held: MediaStream | null = null;
let declared = false;
let captureGen = 0;
let holdSettled: Promise<void> = Promise.resolve();

/**
 * What became of the plan's hold. Anything but `held` means the step ran
 * WITHOUT the input it was meant to test, and a kit summary says so (M4).
 */
export type HoldState =
  | 'none'
  | 'pending'
  | 'held'
  | 'failed'
  | 'no-track'
  | 'unlabelled'
  | 'no-such-input'
  | 'not-needed';
let holdState: HoldState = 'none';
let heldTrack: MediaStreamTrack | null = null;

/** The hold as it stands now: its state and, when held, the live track's. */
export function holdStatus(): { state: HoldState; got: string | null; readyState: string | null; muted: boolean | null } {
  return {
    state: holdState,
    got: heldTrack ? heldTrack.label || '(unlabelled)' : null,
    readyState: heldTrack ? (heldTrack.readyState ?? 'unknown') : null,
    muted: heldTrack ? (heldTrack.muted ?? null) : null,
  };
}

/** Resolves once the plan's held input is open, refused or not wanted. */
export function captureRouteSettled(): Promise<void> {
  return holdSettled;
}

/** From the settings, whenever they change. */
export function setRoutePreferences(pref: RoutePref | undefined, strategy: RouteStrategySetting | undefined): void {
  // Belt and braces with the load-time check in store/persist.ts: an unknown
  // route would otherwise become a Bluetooth hold (review L4).
  prefs = {
    pref: pref === 'phone' || pref === 'bluetooth' ? pref : 'auto',
    strategy: strategy === 'web-audio' || strategy === 'play-and-record' || strategy === 'speaker-sink' ? strategy : 'auto',
  };
}

export function routePreferences(): { pref: RoutePref; strategy: RouteStrategySetting } {
  return prefs;
}

export function lastDetectedRoute(): DetectedRoute {
  return lastRoute;
}

/** The plan in force while voice is on, or null. */
export function activeRoutePlan(): RoutePlan | null {
  return activePlan;
}

function sinkIdSupported(): boolean {
  try {
    return typeof HTMLMediaElement !== 'undefined' && typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === 'function';
  } catch {
    return false;
  }
}

/** Read the devices now. Never throws; labels are blank before permission. */
export async function detectRoute(): Promise<DetectedRoute> {
  try {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md?.enumerateDevices) {
      lastRoute = classifyInputs([], sinkIdSupported());
      return lastRoute;
    }
    const devices = await md.enumerateDevices();
    lastRoute = classifyInputs(
      devices.map((d) => ({ kind: d.kind, label: d.label, deviceId: d.deviceId })),
      sinkIdSupported(),
    );
  } catch {
    lastRoute = classifyInputs([], sinkIdSupported());
  }
  return lastRoute;
}

/** One line with everything the app can see about the route. */
export async function logRouteSnapshot(reason: string): Promise<DetectedRoute> {
  const route = await detectRoute();
  // The plan IN FORCE when there is one (a drill's, or a kit trial's), so
  // the line agrees with route-plan; the Settings plan only when idle (M1/L7).
  const active = activePlan;
  const plan = active ?? planRoute(prefs.pref, prefs.strategy, route);
  diag('route', 'route-snapshot', {
    reason,
    kind: route.kind,
    guess: route.guess ?? 'none',
    first: route.first ?? 'none',
    inputs: route.inputs.join(' | ') || 'none',
    outputs: route.outputs.map((o) => o.label).join(' | ') || 'none',
    sinkId: route.sinkIdSupported,
    session: readAudioSessionType() ?? 'unsupported',
    pref: prefs.pref,
    strategySetting: prefs.strategy,
    plan: plan.strategy,
    hold: plan.hold,
    evidence: plan.evidence,
    planSource: active ? 'in-force' : 'settings',
  });
  return route;
}

/**
 * Apply a plan as capture opens. SYNCHRONOUS up to the declaration, so a
 * caller inside a tap can still start the recogniser in the same gesture; the
 * held input opens in the background. Returns the plan applied.
 *
 * `planOverride` is for the test kit, which compares strategies on purpose.
 */
let pageHideWatched = false;

/**
 * The page is going (closed, navigated, or into the back-forward cache): the
 * held mic and any declared type go with it, whoever began the plan -- a
 * drill, a Route kit or Settings (review L2). `pagehide`, not hidden: a
 * glance at the notification shade must not end voice.
 */
function watchPageHide(): void {
  if (pageHideWatched || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  pageHideWatched = true;
  window.addEventListener('pagehide', () => endCaptureRoute('pagehide'));
}

export function beginCaptureRoute(reason: string, planOverride?: RoutePlan): RoutePlan {
  watchPageHide();
  const plan = planOverride ?? planRoute(prefs.pref, prefs.strategy, lastRoute);
  // NO BEGIN INHERITS AN EARLIER PLAN, whoever forgot to end it: a mic held
  // for a Settings test must not still be open in the next drill, and an
  // Auto drill must not run under an earlier declaration (review H1).
  stopHeld();
  if (declared && plan.strategy !== 'play-and-record') {
    declared = false;
    requestAudioSessionType('auto');
  }
  activePlan = plan;
  holdState = plan.hold !== 'none' ? 'pending' : 'none';
  const gen = ++captureGen;
  if (plan.strategy === 'play-and-record') {
    declared = true;
    requestAudioSessionType('play-and-record');
  }
  diag('route', 'route-plan', {
    reason,
    strategy: plan.strategy,
    hold: plan.hold,
    evidence: plan.evidence,
    why: plan.why,
    session: readAudioSessionType() ?? 'unsupported',
  });
  if (!planOverride && prefs.pref !== 'auto') {
    // The cached route may be hours old (read at home, the car connected
    // since): the hold is decided again from a fresh read (review M1).
    holdSettled = replanHold(plan, gen);
  } else {
    holdSettled = plan.hold !== 'none' ? holdInput(plan.hold, gen) : Promise.resolve();
  }
  return plan;
}

/**
 * The asynchronous half of a settings-driven plan: read the devices, plan the
 * hold from that, and say so when it differs from the synchronous guess. The
 * strategy (and any declaration) stays as begun: it had to be in force before
 * the recogniser started.
 */
async function replanHold(begun: RoutePlan, gen: number): Promise<void> {
  const route = await detectRoute();
  if (gen !== captureGen) return;
  const fresh = planRoute(prefs.pref, prefs.strategy, route);
  if (fresh.hold !== begun.hold || fresh.evidence !== begun.evidence) {
    activePlan = { ...begun, hold: fresh.hold, evidence: fresh.evidence, why: fresh.why };
    diag('route', 'route-plan-revised', {
      from: begun.hold,
      hold: fresh.hold,
      evidence: fresh.evidence,
      route: route.kind,
      why: fresh.why,
    });
  }
  holdState = fresh.hold !== 'none' ? 'pending' : 'none';
  if (fresh.hold !== 'none') await holdInput(fresh.hold, gen, route);
}

async function holdInput(which: Exclude<HoldInput, 'none'>, gen: number, readNow?: DetectedRoute): Promise<void> {
  // A fresh read: the labels may only now exist (permission), and the
  // Bluetooth device may have come or gone since the last one.
  const route = readNow ?? (await detectRoute());
  // Voice went off (or another plan began) during the read: open nothing.
  // Opening a capture is the event that flips the route (review L1).
  if (gen !== captureGen) return;
  const inputs = route.inputs.join(' | ') || 'none';
  if (which === 'phone' && route.kind === 'phone') {
    // Nothing to steer away from: the phone mic is the route already.
    holdState = 'not-needed';
    diag('route', 'route-hold', { which, state: 'not-needed', inputs });
    return;
  }
  const pick = pickHoldTarget(which, route);
  if (pick === 'unlabelled' || pick === null) {
    // 'unlabelled' is "cannot tell", not "nothing to do": no permission yet,
    // so the names that tell the phone's mic from the car's are blank (M4).
    holdState = pick === null ? 'no-such-input' : 'unlabelled';
    diag('route', 'route-hold', { which, state: holdState, inputs });
    return;
  }
  const constraints: MediaStreamConstraints =
    pick.deviceId === null ? { audio: true } : { audio: { deviceId: { exact: pick.deviceId } } };
  try {
    const stream = await openMicStream(constraints);
    if (gen !== captureGen || activePlan === null) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') {
      // A stream with no live audio track holds nothing: say so (M4).
      for (const t of stream.getTracks()) t.stop();
      holdState = 'no-track';
      diag('route', 'route-hold', { which, state: 'no-track', wanted: pick.label, match: pick.match, gotTrack: false });
      return;
    }
    stopHeld();
    held = stream;
    heldTrack = track;
    holdState = 'held';
    // iOS may end or mute the held capture when the recogniser (re)starts or
    // the route changes; nothing else would notice (review M2).
    const label = track.label || '(unlabelled)';
    const note = (event: string) => () => {
      if (heldTrack !== track) return;
      diag('route', 'route-hold-track', { which, event, got: label, readyState: track.readyState ?? 'unknown' });
    };
    track.addEventListener?.('ended', note('ended'));
    track.addEventListener?.('mute', note('mute'));
    track.addEventListener?.('unmute', note('unmute'));
    const settings = (track.getSettings?.() ?? {}) as MediaTrackSettings;
    diag('route', 'route-hold', {
      which,
      state: 'held',
      wanted: pick.label,
      match: pick.match,
      gotTrack: true,
      got: track.label || '(unlabelled)',
      trackSampleRate: settings.sampleRate ?? 'unknown',
    });
  } catch (e) {
    holdState = 'failed';
    diag('route', 'route-hold', {
      which,
      state: 'failed',
      wanted: pick.label,
      match: pick.match,
      why: e instanceof Error ? e.name : String(e),
    });
  }
}

/**
 * The input to hold. By label when there are labels. Without them (a page
 * that has only used the recogniser may never have been granted them -- see
 * testKitIO listInputsAfterGrant), by position, logged as such:
 *
 *   bluetooth  the FIRST listed input: WebKit sorts the route's current input
 *              first, and iOS makes a connected hands-free device the current
 *              one. No usable id at all: any audio input (`audio: true`).
 *   phone      the second listed input, when there are two or more -- a
 *              guess, since only the first is known to be the current one.
 *              One input or none: 'unlabelled', nothing held.
 */
export function pickHoldTarget(
  which: Exclude<HoldInput, 'none'>,
  route: DetectedRoute,
): { deviceId: string | null; label: string; match: 'label' | 'first-input' | 'other-input' | 'any-input' } | 'unlabelled' | null {
  const named = which === 'phone' ? route.phone : route.bluetooth;
  if (named) return { deviceId: named.deviceId, label: named.label, match: 'label' };
  if (route.kind !== 'unknown') return null;
  const ids = route.inputIds;
  if (which === 'bluetooth') {
    return ids[0]
      ? { deviceId: ids[0], label: '(unlabelled, first)', match: 'first-input' }
      : { deviceId: null, label: '(any input)', match: 'any-input' };
  }
  return ids.length >= 2 ? { deviceId: ids[1], label: '(unlabelled, second)', match: 'other-input' } : 'unlabelled';
}

function stopHeld(): void {
  heldTrack = null;
  if (!held) return;
  for (const t of held.getTracks()) t.stop();
  held = null;
}

/** Undo whatever `beginCaptureRoute` did. Idempotent. */
export function endCaptureRoute(reason: string): void {
  captureGen += 1;
  const had = activePlan;
  activePlan = null;
  holdState = 'none';
  stopHeld();
  if (declared) {
    declared = false;
    requestAudioSessionType('auto');
  }
  if (had) diag('route', 'route-plan-end', { reason, strategy: had.strategy, hold: had.hold });
}

/**
 * The output to point clip elements at, when the plan says `speaker-sink`.
 * Null means "use the ordinary path".
 */
export function routeSinkId(): string | null {
  if (activePlan?.strategy !== 'speaker-sink') return null;
  return pickSpeakerOutput(lastRoute)?.deviceId ?? null;
}

/** Point an element at the plan's output. Never throws; logs a refusal. */
export async function applyRouteSink(el: HTMLMediaElement): Promise<boolean> {
  const id = routeSinkId();
  if (!id) return false;
  const withSink = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof withSink.setSinkId !== 'function') return false;
  try {
    await withSink.setSinkId(id);
    return true;
  } catch (e) {
    diag('route', 'route-sink-failed', { why: e instanceof Error ? e.name : String(e) });
    return false;
  }
}

/** Test-only. */
export function _resetAudioRouteForTest(): void {
  prefs = { pref: 'auto', strategy: 'auto' };
  lastRoute = classifyInputs([]);
  activePlan = null;
  held = null;
  heldTrack = null;
  holdState = 'none';
  declared = false;
  captureGen = 0;
  holdSettled = Promise.resolve();
}
