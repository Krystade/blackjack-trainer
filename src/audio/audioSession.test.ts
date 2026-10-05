import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  audioSessionSupported,
  claimSpeakerForPlayback,
  readAudioSessionType,
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
 * THE SETTINGS, and why there was more than one.
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
 * media intent and never asks for the recording one. ('switch', which
 * alternated, is gone -- see audio/audioSession.ts.)
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
    expect(s.type).toBe('play-and-record');
  });

  it('claims the speaker before speaking on playback', () => {
    const s = installSession('play-and-record');
    setOutputRoutePreference('playback');
    claimSpeakerForPlayback();
    expect(s.type).toBe('playback');
  });

});


describe('the shipped default', () => {
  it('is Auto, because both of the other two were disproved on the road', () => {
    // THE MOST CONSEQUENTIAL LINE IN THIS FILE, and for a long time nothing
    // asserted it: changing it broke no test, while deciding what every
    // drive actually does.
    //
    // It was 'playback' until 2026-10-04, when a drive settled that
    // declaring the category while capturing does nothing -- `got=playback
    // ok=true` with the sound on the earpiece throughout. It was then
    // 'switch' for one evening, which was the untried order the WebKit bug
    // thread recommends: stop capturing, declare playback, then speak. That
    // evening's 17:00 log ran it exactly -- `mic stop`, then
    // `session-at-mic-close type=playback`, then a 3089ms clip to its
    // natural end with nothing capturing -- and Jack still could not hear
    // the app on the loud speaker. So both are dead, and 'switch' costs a
    // recogniser restart per line on top of not working.
    expect(DEFAULT_AUDIO.outputRoute).toBe('auto');
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
