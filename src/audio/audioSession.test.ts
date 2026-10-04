import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  audioSessionSupported,
  abandonSpeechHandoff,
  beginSpeechHandoff,
  endSpeechHandoff,
  claimSpeakerForPlayback,
  readAudioSessionType,
  releaseSpeakerForListening,
  requestAudioSessionType,
  setOutputRoutePreference,
  _resetAudioSessionForTest,
  outputRoutePreference,
} from './audioSession';
import { clearDiagnosticLog, readDiagnosticLog } from '../diag/diagnosticLog';
import { DEFAULT_AUDIO } from '../store/types';

/**
 * THE API I SAID DID NOT EXIST.
 *
 * On 2026-10-03 I told Jack, in the app and in a commit message, that "Safari
 * exposes no part of the audio session to a web page: no category, no options,
 * no setSinkId, no output device list. There is nothing to call." The first
 * three clauses are right. The conclusion was not: `navigator.audioSession`
 * shipped in Safari 17 / iOS 17, and his phone is on iOS 18.7. Its `type` is
 * exactly the category intent I claimed was unreachable -- 'playback' is the
 * one that means "this is media", and 'play-and-record' is the one WebKit
 * infers the moment anything opens a microphone, which is what puts the sound
 * on the earpiece.
 *
 * Whether WebKit HONOURS a page that asks for 'playback' while capturing is
 * not specified -- the W3C draft says nothing about routing, and the question
 * cannot be answered from this machine, because no desktop browser here
 * implements it. So this module asks, READS BACK what it got, and writes both
 * down. The readback is the point: an assignment that is silently ignored
 * looks exactly like one that worked (the same trap as the volume setter), and
 * a log that says only what was requested would have me making the same claim
 * twice.
 */
describe('the audio session type', () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  function installSession(session: unknown): void {
    Object.defineProperty(globalThis, 'navigator', {
      value: session === undefined ? {} : { audioSession: session },
      configurable: true,
      writable: true,
    });
  }

  beforeEach(() => {
    clearDiagnosticLog();
    _resetAudioSessionForTest();
  });

  afterEach(() => {
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });

  it('reports no support where the API is absent', () => {
    installSession(undefined);
    expect(audioSessionSupported()).toBe(false);
    expect(readAudioSessionType()).toBeNull();
  });

  it('reads the type the browser chose', () => {
    installSession({ type: 'play-and-record' });
    expect(audioSessionSupported()).toBe(true);
    expect(readAudioSessionType()).toBe('play-and-record');
  });

  it('asks for a type and reports that it took', () => {
    const session = { type: 'play-and-record' };
    installSession(session);
    expect(requestAudioSessionType('playback')).toBe(true);
    expect(session.type).toBe('playback');

    const row = readDiagnosticLog().find((e) => e.event === 'audio-session');
    expect(row?.detail).toMatchObject({ was: 'play-and-record', wanted: 'playback', got: 'playback' });
  });

  it('reports FALSE when the assignment is silently ignored', () => {
    // The failure mode that matters, and the one a request-only log could not
    // tell from success: WebKit is free to keep its inferred category, and an
    // ignored setter is how the volume control already lies on this phone.
    const stubborn = {
      get type() {
        return 'play-and-record';
      },
      set type(_v: string) {
        /* swallowed */
      },
    };
    installSession(stubborn);
    expect(requestAudioSessionType('playback')).toBe(false);

    const row = readDiagnosticLog().find((e) => e.event === 'audio-session');
    expect(row?.detail).toMatchObject({ wanted: 'playback', got: 'play-and-record' });
  });

  it('says nothing and claims nothing where the API is absent', () => {
    installSession(undefined);
    expect(requestAudioSessionType('playback')).toBe(false);
    expect(readDiagnosticLog().find((e) => e.event === 'audio-session')?.detail).toMatchObject({
      supported: false,
    });
  });

  it('does not write a row for a type that is already set', () => {
    // A drill speaks after every answer. One row per utterance would bury the
    // transition that actually matters in a log that is read by hand.
    const session = { type: 'playback' };
    installSession(session);
    expect(requestAudioSessionType('playback')).toBe(true);
    expect(readDiagnosticLog().filter((e) => e.event === 'audio-session')).toEqual([]);
  });

  it('never throws when the setter does', () => {
    installSession({
      get type() {
        return 'auto';
      },
      set type(_v: string) {
        throw new Error('nope');
      },
    });
    expect(() => requestAudioSessionType('playback')).not.toThrow();
    expect(requestAudioSessionType('playback')).toBe(false);
  });
});


/**
 * THE THREE SETTINGS, and why there are three rather than one.
 *
 * Nothing specifies what WebKit does with a page that asks for 'playback'
 * while a recogniser is capturing, and it cannot be found out from this
 * machine -- no desktop browser here implements the API at all. The plausible
 * outcomes are: it works (sound returns to the loud speaker), it is ignored
 * (nothing changes), or it works and takes the microphone down with it. Those
 * want different answers, and each costs a drive to tell apart.
 *
 * So the choice is Jack's to make in the car in one sitting, not mine to guess
 * across three builds: 'auto' leaves the session alone, 'playback' pins the
 * media intent and never asks for the recording one, 'switch' alternates.
 */
describe('the output-route preference', () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  function installSession(initial: string): { type: string } {
    const s = { type: initial };
    Object.defineProperty(globalThis, 'navigator', {
      value: { audioSession: s },
      configurable: true,
      writable: true,
    });
    return s;
  }

  beforeEach(() => {
    clearDiagnosticLog();
    _resetAudioSessionForTest();
  });

  afterEach(() => {
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });

  it('leaves the session alone on auto, which is the behaviour that shipped', () => {
    const s = installSession('play-and-record');
    setOutputRoutePreference('auto');
    claimSpeakerForPlayback();
    releaseSpeakerForListening();
    expect(s.type).toBe('play-and-record');
  });

  it('claims the speaker before speaking on playback', () => {
    const s = installSession('play-and-record');
    setOutputRoutePreference('playback');
    claimSpeakerForPlayback();
    expect(s.type).toBe('playback');
  });

  it('never hands the session back on playback, since that is what costs the speaker', () => {
    const s = installSession('play-and-record');
    setOutputRoutePreference('playback');
    claimSpeakerForPlayback();
    releaseSpeakerForListening();
    expect(s.type).toBe('playback');
  });

  it('alternates on switch, which is the setting that may cost the microphone', () => {
    const s = installSession('auto');
    setOutputRoutePreference('switch');
    claimSpeakerForPlayback();
    expect(s.type).toBe('playback');
    releaseSpeakerForListening();
    expect(s.type).toBe('play-and-record');
  });
});


/**
 * THE HANDOFF, and why "Switch" as first shipped could not have worked.
 *
 * The 2026-10-04 drive ran entirely on `playback`: `got=playback ok=true`,
 * `session-at-mic-open type=playback`, `session-at-mic-close type=playback` --
 * the page held the category it asked for from end to end, and the sound was
 * on the earpiece the whole time. Declaring a category while something is
 * capturing does not move the route, because WebKit set the real one when
 * capture began (bug 218012: `AllowBluetooth | MixWithOthers`, never
 * `defaultToSpeaker`).
 *
 * The workaround in that thread is an order of operations, not a flag: stop
 * capturing, THEN declare playback, then make the sound. So the handoff has to
 * take the microphone down, and these pin the two things that make that
 * affordable -- it only happens for speech, and it only reopens what it closed.
 */
describe('handing the speaker back and forth', () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  function installSession(initial: string): { type: string } {
    const s = { type: initial };
    Object.defineProperty(globalThis, 'navigator', {
      value: { audioSession: s },
      configurable: true,
      writable: true,
    });
    return s;
  }

  beforeEach(() => {
    clearDiagnosticLog();
    _resetAudioSessionForTest();
  });

  afterEach(() => {
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });

  it('closes the microphone and claims playback before a spoken line', () => {
    const s = installSession('play-and-record');
    setOutputRoutePreference('switch');
    expect(beginSpeechHandoff(true)).toBe('close-mic');
    expect(s.type).toBe('playback');
  });

  it('gives the microphone back when the line ends', () => {
    const s = installSession('play-and-record');
    setOutputRoutePreference('switch');
    beginSpeechHandoff(true);
    expect(endSpeechHandoff()).toBe('open-mic');
    expect(s.type).toBe('play-and-record');
  });

  it('does NOT take the microphone down for a chime', () => {
    /**
     * The cost that would make this unusable. A recogniser needs about 1.2
     * seconds to come back (`confirmedInMs=1233`, 2026-10-04), and the app
     * chimes after every single answer. Trading a second of deafness for a
     * 120ms beep would cost more than the earpiece does.
     */
    const s = installSession('play-and-record');
    setOutputRoutePreference('switch');
    expect(beginSpeechHandoff(false)).toBe('none');
    expect(s.type).toBe('play-and-record');
  });

  it('reopens nothing it did not close', () => {
    // An ending that belongs to a chime, or to a line that began before the
    // setting was switched on, must not start a recogniser nobody asked for.
    installSession('play-and-record');
    setOutputRoutePreference('switch');
    expect(endSpeechHandoff()).toBe('none');
  });

  it('does not close it twice for one utterance', () => {
    installSession('play-and-record');
    setOutputRoutePreference('switch');
    expect(beginSpeechHandoff(true)).toBe('close-mic');
    expect(beginSpeechHandoff(true)).toBe('none');
  });

  it('stays out of the way entirely on the other two settings', () => {
    for (const pref of ['auto', 'playback'] as const) {
      _resetAudioSessionForTest();
      const s = installSession('play-and-record');
      setOutputRoutePreference(pref);
      expect(beginSpeechHandoff(true)).toBe('none');
      expect(endSpeechHandoff()).toBe('none');
      // 'playback' still claims the category on its own path; what it must
      // never do is take the microphone down.
      expect(s.type).toBe('play-and-record');
    }
  });
});

describe('abandoning a handoff', () => {
  beforeEach(() => {
    _resetAudioSessionForTest();
    setOutputRoutePreference('switch');
  });

  it('lets the next utterance close the microphone again', () => {
    expect(beginSpeechHandoff(true)).toBe('close-mic');
    // The screen goes away while the microphone is still down.
    abandonSpeechHandoff();
    // Without this, the next session's first line would see a handoff already
    // in progress and never close the microphone -- the setting would appear
    // to work once and then stop, which is the hardest kind of fault to
    // report from a car.
    expect(beginSpeechHandoff(true)).toBe('close-mic');
  });

  it('does not ask anyone to reopen a microphone that has gone', () => {
    expect(beginSpeechHandoff(true)).toBe('close-mic');
    abandonSpeechHandoff();
    expect(endSpeechHandoff()).toBe('none');
  });

  it('is harmless when no handoff is outstanding', () => {
    abandonSpeechHandoff();
    expect(endSpeechHandoff()).toBe('none');
    expect(beginSpeechHandoff(true)).toBe('close-mic');
  });
});

describe('the shipped default', () => {
  it('is Switch, the only mode that takes the microphone down', () => {
    // THE MOST CONSEQUENTIAL LINE IN THIS FILE, and until now nothing
    // asserted it: changing it broke no test, while deciding what every drive
    // actually does. 'playback' was the default until 2026-10-04, when the
    // drive log settled that declaring the category while capturing does
    // nothing -- `got=playback ok=true` with the sound on the earpiece
    // throughout.
    expect(DEFAULT_AUDIO.outputRoute).toBe('switch');
  });

  it('agrees with the preference this module starts in', () => {
    /*
     * TWO DECLARATIONS OF ONE DEFAULT, in two files, and they can drift.
     *
     * `DEFAULT_AUDIO` seeds the stored settings and is what the screen shows.
     * This module's own initial value is what the audio path uses before any
     * settings have loaded -- so the first utterance after a cold launch runs
     * on it. If they disagree, the app spends that utterance in a mode the
     * screen is not showing, which is unreportable from a car.
     */
    _resetAudioSessionForTest();
    expect(outputRoutePreference()).toBe(DEFAULT_AUDIO.outputRoute);
  });
});
