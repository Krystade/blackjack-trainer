import { describe, it, expect, beforeEach } from 'vitest';
import {
  setMicTuning,
  micCueOn,
  micAlternatives,
  _resetMicTuningForTest,
} from './micTuning';
import { DEFAULT_AUDIO } from '../store/types';
import { _setStorage, SETTINGS_KEY } from '../store/persist';

describe('the microphone experiments reach the recogniser', () => {
  beforeEach(() => {
    _resetMicTuningForTest();
  });

  it('ships gated on real audio, not on the engine saying it started', () => {
    /*
     * THE SHIPPED DEFAULT, asserted where a reader will find it.
     *
     * `mergeSettings` spreads the stored blob over `DEFAULT_AUDIO`, so this
     * value is what a FRESH install gets -- and it is the whole point of the
     * change. An install that already exists keeps whatever it stored, which
     * is correct here: the setting is an experiment, and silently flipping an
     * existing install's arm mid-investigation would confound the next drive.
     */
    expect(DEFAULT_AUDIO.micCueOn).toBe('audiostart');
  });

  it('asks for more readings than anyone has asked iOS for', () => {
    expect(DEFAULT_AUDIO.voiceAlternatives).toBe(10);
  });

  it('is already on the right arm before any effect has run', () => {
    /*
     * REWRITTEN. This used to assert the opposite -- that the module sat on
     * the old behaviour until `useAudio` applied the setting -- and that was
     * a real hole, not a safe default.
     *
     * `useAudio` is mounted per SCREEN rather than once at the app root, so
     * nothing orders it before the voice controller's first session. A first
     * session on the control arm while the settings screen showed the
     * treatment arm would contaminate the drive invisibly: the exported log
     * would name the wrong condition. So the first read resolves from stored
     * settings instead of waiting to be told.
     */
    expect(micCueOn()).toBe(DEFAULT_AUDIO.micCueOn);
    expect(micAlternatives()).toBe(DEFAULT_AUDIO.voiceAlternatives);
  });

  it('takes a stored choice over the default, with no effect involved', () => {
    _setStorage({
      getItem: (k: string) =>
        k === SETTINGS_KEY
          ? // `version: 1` is required: `isVersion1Object` rejects a blob
            // without it and `loadSettings` quarantines it and returns the
            // defaults -- which is how the first draft of this test passed
            // through to the defaults and asserted nothing.
            JSON.stringify({
              version: 1,
              audio: { micCueOn: 'start', voiceAlternatives: 5 },
            })
          : null,
      setItem: () => {},
    });
    _resetMicTuningForTest();

    expect(micCueOn()).toBe('start');
    expect(micAlternatives()).toBe(5);
    _setStorage(null);
  });

  it('falls back to the shipped behaviour when storage throws', () => {
    // A private window can throw on read. That costs the experiment, which is
    // acceptable; it must not cost the drive.
    _setStorage({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    });
    _resetMicTuningForTest();

    expect(micCueOn()).toBe('start');
    expect(micAlternatives()).toBe(3);
    _setStorage(null);
  });

  it('takes what the operator set', () => {
    setMicTuning({ cueOn: 'audiostart', alternatives: 10 });
    expect(micCueOn()).toBe('audiostart');
    expect(micAlternatives()).toBe(10);
  });

  it('leaves the other half alone when told about one', () => {
    setMicTuning({ cueOn: 'audiostart', alternatives: 10 });
    setMicTuning({ alternatives: 5 });
    expect(micCueOn()).toBe('audiostart');
    expect(micAlternatives()).toBe(5);
  });

  it('refuses a stored value the engine would throw on', () => {
    /*
     * A settings blob written by an older build, or edited by hand, can carry
     * anything -- and this value is assigned straight onto the recogniser.
     * Chrome throws a SyntaxError on an out-of-range `maxAlternatives`, and a
     * throw there kills the session, which in a car is silence for the rest
     * of the drive.
     */
    setMicTuning({ alternatives: 0 });
    expect(micAlternatives()).toBe(1);

    setMicTuning({ alternatives: 9999 });
    expect(micAlternatives()).toBe(20);

    setMicTuning({ alternatives: Number.NaN });
    expect(micAlternatives()).toBe(20);

    setMicTuning({ alternatives: 4.7 });
    expect(micAlternatives()).toBe(5);
  });
});
