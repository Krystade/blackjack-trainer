import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  audioSessionSupported,
  readAudioSessionType,
  requestAudioSessionType,
  _resetAudioSessionForTest,
} from './audioSession';
import { clearDiagnosticLog, readDiagnosticLog } from '../diag/diagnosticLog';

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

