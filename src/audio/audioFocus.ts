/**
 * Keep this app the phone's "now playing" app, so the wheel keeps reaching it.
 *
 * THE BUG THIS EXISTS TO FIX. Media Session routes a transport button to
 * whoever the phone currently considers the active media app, and that status
 * comes from actually playing through a media element -- not from having once
 * registered a handler. The clips path plays a clip, the clip ends, the
 * element goes idle, and the phone hands the wheel back to whatever played
 * before this app existed: the radio, a podcast, nothing at all.
 *
 * From the driver's seat that is precisely what the operator reported after
 * the drive of 2026-09-19: "buttons worked only when the bot was talking."
 * Which was true, and is the whole symptom -- the app was only the active
 * media app for the two seconds a clip was audible, and the gaps between
 * prompts are exactly when a driver wants to press something.
 *
 * THE FIX is a silent element that never stops. Hold it for as long as the
 * wheel is meant to work and the app stays the active media app between
 * utterances, so a press in a gap arrives instead of vanishing. The button
 * tester already did this for itself and its header already stated the
 * reason; this module is that mechanism pulled out to where the drills can
 * use it too, which is where it was actually needed.
 *
 * WHY KEYED rather than a bare on/off. Two independent things want the hold
 * at once -- a drill that is speaking, and the button tester -- and they
 * start and stop on their own schedules. A boolean would let the tester's
 * `stop` drop a hold the drill still needs, silently restoring the original
 * bug for the rest of the session. Holds are therefore named, and the
 * element plays while any name is outstanding.
 */

import { diag } from '../diag/diagnosticLog';
import { appendLog } from './mediaSessionLog';

/** Who wants the app to stay the active media app. */
export type AudioFocusKey = 'speech' | 'button-test' | 'car-check';

/**
 * A silent WAV as a data URI.
 *
 * One second of 8 kHz 8-bit mono, which is all zeroes after the 44-byte
 * header -- but 8-bit PCM is UNSIGNED, so digital silence is 0x80, not 0x00.
 * Filling it with zeroes instead produces a full-scale DC offset: inaudible
 * on most speakers, a thump on some, and a step every time the loop wraps.
 *
 * Generated rather than shipped: a real asset would be one more file to keep
 * in sync with the service-worker manifest, for ~700 bytes of gain.
 */
export function silentWavDataUri(): string {
  const sampleRate = 8000;
  const samples = sampleRate; // one second
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate: 1 byte per sample
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(0x80, 44); // unsigned-PCM zero

  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function audioCtor(): (new (src?: string) => HTMLAudioElement) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { Audio?: new (src?: string) => HTMLAudioElement };
  return typeof w.Audio === 'function' ? w.Audio : null;
}

const held = new Set<AudioFocusKey>();
let element: HTMLAudioElement | null = null;

/**
 * Claim the media slot on behalf of `key`, and keep it until every holder
 * has released.
 *
 * MUST BE REACHED FROM A GESTURE, at least the first time. iOS refuses
 * `play()` on an element that no tap ever started, and a refusal here is
 * silent -- the app simply is not the active media app and no button works,
 * which is indistinguishable from the bug this fixes. In practice the first
 * hold rides on a clip that is already playing (see speech.ts) or on the
 * field test's Start/Resume tap, which means the media engine is unlocked by
 * then.
 * A refusal is logged rather than thrown so a drill never dies for want of a
 * wheel.
 *
 * Volume 1 and genuinely silent, not muted: a muted element is not reliably
 * treated as playing media, which would defeat the entire point.
 */
export function holdAudioFocus(key: AudioFocusKey): void {
  const first = held.size === 0;
  // WAS THIS KEY ALREADY HOLDING? Asked before the add, because `joined: true`
  // was written for every re-hold of a key already in the set -- the field test
  // calls this on every step change, so a 22-step run carried 21 entries
  // claiming a holder had joined while the set never grew. `joined` is the
  // field a reader uses to reconstruct who was contending for the slot.
  const rehold = held.has(key);
  held.add(key);
  // LOGGED BEFORE THE EARLY RETURN, so every acquire appears. The return
  // below skipped `diag('focus','hold')` whenever a second key joined an
  // existing hold, so `key=speech` was the only one an export ever showed --
  // `button-test` and `car-check` acquired and released invisibly, and the
  // `holders=` number was a lower bound presented as a count.
  //
  // NAMED APART from the acquire below, which was also `focus hold`. Two
  // different facts under one name — "another key joined the hold" and "the
  // silent element was started for this key" — and on the retry path a
  // single call emitted BOTH, so counting `focus hold` lines in an export
  // over-reported acquisitions and the `joined`/`rehold` fields appeared to
  // come and go at random.
  if (!first) diag('focus', 'hold-joined', { key, holders: held.size, joined: !rehold, rehold });
  // RETRIED WHEN THE ELEMENT IS NOT ACTUALLY PLAYING, not skipped because an
  // element object exists.
  //
  // `play()` rejecting leaves `element` non-null, and this return then made the
  // refusal permanent: every later hold -- from the field test's step effect,
  // from `announceToMediaSession` on every clip -- short-circuited here and
  // never tried again. One refusal at the first hold killed the media slot for
  // the whole session, which reads in an export as a car that ignores the app.
  // `paused === false` is the real question, the same one the car check asks.
  //
  // ...AND NOT SKIPPED WHEN A RE-TAKE IS STILL OWED. `paused === false` is
  // not proof the slot is held: iOS detaches the app from the car's
  // remote-command target when the microphone reconfigures the audio
  // session, and leaves the element playing. The attempt made on the close
  // may have been too early (see `REASSERT`), so the first hold after one
  // stops trusting `paused` for exactly one play.
  if (!first && element && !element.paused && !retakeOwed) return;
  // Spent here rather than after `play()` settles: a refusal leaves the
  // element paused, so every later hold retries through the gate above
  // anyway, and holding the flag open would re-play the loop all session.
  retakeOwed = false;

  const Ctor = audioCtor();
  if (!Ctor) return;
  try {
    // `??=`, so a retry re-plays the element we already have rather than
    // orphaning it and starting another.
    element ??= new Ctor(silentWavDataUri());
    element.loop = true;
    element.volume = 1;
    const el = element;
    // THE HOLD LAPSING is the one event this category exists to record and
    // the one it could not. Every other `focus` entry is app-initiated, so
    // an OS interruption -- a call, another app taking the slot -- left no
    // trace, and "a press that reached nothing" could not be told from "a
    // press into a gap where the hold had already gone". `audioFocusElement
    // IsPlaying()` existed for exactly this and only the car check ever
    // asked it.
    //
    // ATTACHED BEFORE `play()`, not once it resolves: iOS can pause the
    // element between the request and the promise settling, and a pause
    // that early fired into nothing. The app's own stop is not a lapse
    // because `releaseAudioFocus` clears these before it pauses.
    el.onpause = () => diag('focus', 'lapsed', { holders: held.size, paused: true });
    el.onended = () => diag('focus', 'lapsed', { holders: held.size, ended: true });
    void el
      .play()
      .then(() => {
        // `play()` resolving is not the element PLAYING -- report what it
        // actually is, because that is what the head unit reads.
        diag('focus', 'holding', { key, paused: el.paused, holders: held.size });
      })
      .catch((e: unknown) => {
        appendLog({ kind: 'note', action: 'audio-focus-refused', ok: false });
        // The silent failure that makes every wheel button dead. iOS refuses
        // `play()` with no gesture behind it, and before this line the only
        // symptom was a car that ignored the app.
        diag('focus', 'refused', { key, why: e instanceof Error ? e.name : String(e) });
      });
    appendLog({ kind: 'note', action: `audio-focus-hold:${key}`, ok: true });
    // THE ELEMENT WAS STARTED, which is the fact this line reports. `restart`
    // separates the retry after a refusal — the path that brings a dead
    // media slot back — from the session's first acquisition.
    diag('focus', 'hold', { key, holders: held.size, restart: !first || undefined });
  } catch (e) {
    // Was silent. `new Ctor(...)`, the data URI, or the `loop`/`volume`
    // setters throwing leaves `key` in `held` -- so `audioFocusHolders()`
    // reports a holder while nothing is playing, the wheel is dead, and the
    // export says nothing at all. That is the precise failure this file's
    // header says it exists to end.
    diag('focus', 'hold-failed', { key, why: e instanceof Error ? e.message : String(e) });
    element = null;
  }
}

/**
 * Drop `key`'s claim. The element stops only once nothing holds it.
 *
 * Releasing matters: a silent loop that ran forever would hold the car's
 * media slot after the user had gone back to their music, and every wheel
 * press would then land on a trainer that is not on screen.
 */
export function releaseAudioFocus(key: AudioFocusKey): void {
  if (!held.delete(key)) return;
  // Same asymmetry as the acquire above: a release that leaves other holders
  // standing is still a release, and it was invisible.
  if (held.size > 0) {
    diag('focus', 'release', { key, holders: held.size, remaining: true });
    return;
  }
  appendLog({ kind: 'note', action: `audio-focus-release:${key}`, ok: true });
  diag('focus', 'release', { key, holders: held.size });
  if (!element) return;
  try {
    // Cleared first: `pause()` here is deliberate, and firing `lapsed` for the
    // app's own release would make the entry meaningless.
    element.onpause = null;
    element.onended = null;
    element.pause();
    element.currentTime = 0;
  } catch {
    /* releasing the hold must never throw on the way out */
  }
}

/** Release every hold, whoever placed it. Used when audio is switched off. */
export function releaseAllAudioFocus(): void {
  for (const key of [...held]) releaseAudioFocus(key);
}

/**
 * Whether the hold is genuinely PLAYING, not merely requested.
 *
 * The distinction the car check turns on: `play()` resolving means the
 * browser accepted the request, while `paused === false` means the element is
 * actually the thing producing media. iOS pulls those apart routinely, and
 * the wheel follows the second one.
 */
export function audioFocusElementIsPlaying(): boolean {
  return element !== null && element.paused === false;
}

export type AudioFocusReassertReason = 'play-request' | 'after-speech' | 'mic-closed';

interface ReassertPolicy {
  /**
   * Whether this reason is evidence the slot may be gone WHILE THE ELEMENT
   * STILL REPORTS PLAYING, and so may act without waiting for a pause.
   *
   * `paused === true` proves the hold lapsed. `paused === false` proves
   * nothing, because iOS detaches the app from the remote-command target
   * without touching the element -- see `reassertAudioFocus`.
   */
  readonly onALiveElement: boolean;
  /**
   * Whether the attempt may land BEFORE the audio session has finished
   * changing, in which case the next hold tries once more.
   */
  readonly mayBeTooEarly: boolean;
}

const REASSERT: Record<AudioFocusReassertReason, ReassertPolicy> = {
  /**
   * THE MICROPHONE JUST CLOSED. Opening it reconfigured the audio session
   * underneath the loop, which is exactly when the slot goes without a
   * pause, and the app is the only thing that knows the moment it let go.
   *
   * ...AND IT KNOWS TOO EARLY. Run `ulq6vs` recorded `appLetGoAfterMs=102`
   * while the output route did not reach the car again until
   * `msSinceAppLetGo=1634`, so a `play()` on the close goes into a session
   * still in record mode. `devicechange` would have said when it settled and
   * is not available: in that run it fired twice, both times while the
   * microphone was open, and never on the close.
   */
  'mic-closed': { onALiveElement: true, mayBeTooEarly: true },
  /**
   * THE CAR ASKED TO PLAY, which a head unit sends precisely when it
   * believes playback stopped -- the same evidence from the other side of
   * the link. Gated on `paused` this discarded the one request that could
   * restore the slot whenever the element lied about playing, which made the
   * only recovery path in the file unreachable in the case it was written
   * for.
   *
   * Not too early: the car asks at a moment of its own choosing, with the
   * session long settled. Arming a retry here would also arm one on every
   * clip end, which is when this arrives most.
   */
  'play-request': { onALiveElement: true, mayBeTooEarly: false },
  /**
   * A LINE FINISHED, and that is not evidence of anything. It fires after
   * every utterance, so forcing here would call `play()` fifty times a run
   * and write fifty rows reporting that nothing needed doing. It stays for
   * the documented case: the platform pausing the loop in order to speak.
   */
  'after-speech': { onALiveElement: false, mayBeTooEarly: false },
};

/**
 * A re-take that may have been issued too early, owed one more attempt.
 *
 * Consumed by the next `holdAudioFocus` -- the next thing the drill says,
 * seconds away and long after the session has settled. A remembered fact
 * rather than a timer, so there is nothing to cancel on unmount and no retry
 * loop to bound.
 */
let retakeOwed = false;

/**
 * Play the silent loop again, so the app is the active media app once more;
 * add no holder and start nothing that was not already wanted.
 *
 * WHY THIS CANNOT ASK `paused`. The drive of 2026-09-29 (run `ulq6vs`) logged
 * one `focus hold`, one `focus holding`, no `focus lapsed` at all, and not a
 * single wheel press arriving in the nine minutes after the microphone first
 * opened. Fifty holds in between each returned early on `!element.paused`.
 * The element was not lying idly: iOS had taken the app off the car's
 * remote-command target when the microphone reconfigured the audio session,
 * and left the element playing. Output routing recovered on its own 1.6s
 * after the microphone shut, because iOS re-decides that per sound; the
 * buttons never did, because the slot is only ever handed to a fresh
 * `play()`.
 *
 * So `paused === true` means the hold lapsed, `paused === false` means
 * nothing, and which reasons may act on a live element is stated in
 * `RETAKES_A_LIVE_ELEMENT` above rather than inferred here.
 *
 * Never a claim on the slot: with no holder, a `play` is the car asking for
 * music and a closing microphone is a screen that wants no wheel, and taking
 * the slot for either would steal the car from the radio.
 *
 * A `restart` row when there is something to do (`why` says which caller),
 * then the same `holding` or `refused` row a hold writes once `play()`
 * settles -- so the reader can tell a restart that took from one that did
 * not, with `refused why=` meaning the same thing on both. Nothing at all
 * when there is nothing to do: the car can ask every five seconds for as
 * long as it likes.
 */
export function reassertAudioFocus(why: AudioFocusReassertReason): void {
  if (held.size === 0 || !element) return;
  const policy = REASSERT[why];
  if (element.paused === false && !policy.onALiveElement) return;
  if (policy.mayBeTooEarly) retakeOwed = true;
  const el = element;
  void el
    .play()
    .then(() => diag('focus', 'holding', { restart: why, paused: el.paused, holders: held.size }))
    .catch((e: unknown) => {
      diag('focus', 'refused', { restart: why, why: e instanceof Error ? e.name : String(e) });
    });
  diag('focus', 'restart', { why, holders: held.size });
}

/** Whether anything currently holds the slot. Exposed for tests and the panel. */
export function audioFocusHolders(): AudioFocusKey[] {
  return [...held];
}

/** Test-only: forget the element and every hold. */
export function _resetAudioFocusForTest(): void {
  held.clear();
  element = null;
  retakeOwed = false;
}
