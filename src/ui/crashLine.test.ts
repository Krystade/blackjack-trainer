import { describe, it, expect, vi, beforeEach } from 'vitest';

const speak = vi.fn();
vi.mock('../audio/speech', () => ({ speak: (...a: unknown[]) => speak(...a) }));
const loadSettings = vi.fn();
vi.mock('../store/persist', () => ({ loadSettings: () => loadSettings() }));
vi.mock('../diag/diagnosticLog', () => ({ diag: vi.fn() }));

import { CRASH_LINE, crashLineWanted, sayCrashLine } from './crashLine';
import { _resetEyesFreeForTest, setEyesFreeOn } from './eyesFreeSession';
import { DEFAULT_SETTINGS } from '../store/types';

/**
 * D1b: the crash line goes out PROTECTED and INTERRUPTING. In the browser the
 * crashed drill's unmount cleanups cancel speech after the boundary has
 * caught the throw; a line without `protect` was cut off there. The e2e
 * harness swallows speech, so only this can see the options.
 */
describe('crash line (D1b)', () => {
  beforeEach(() => {
    speak.mockReset();
    loadSettings.mockReset();
    _resetEyesFreeForTest();
  });

  it('is wanted only eyes-free', () => {
    expect(crashLineWanted()).toBe(false);
    setEyesFreeOn(true, 'test');
    expect(crashLineWanted()).toBe(true);
  });

  it('is spoken protected and interrupting, at the stored voice and rate', () => {
    const audio = { ...DEFAULT_SETTINGS.audio, rate: 1.3, voiceURI: 'v-test' };
    loadSettings.mockReturnValue({ ...DEFAULT_SETTINGS, audio });
    sayCrashLine();
    expect(speak).toHaveBeenCalledTimes(1);
    const [text, opts] = speak.mock.calls[0] as [string, Record<string, unknown>];
    expect(text).toBe(CRASH_LINE);
    expect(opts).toMatchObject({ interrupt: true, protect: true, rate: 1.3, voiceURI: 'v-test' });
  });

  it('still speaks when the settings cannot be read', () => {
    loadSettings.mockImplementation(() => {
      throw new Error('storage gone');
    });
    sayCrashLine();
    expect(speak).toHaveBeenCalledWith(CRASH_LINE, { interrupt: true, protect: true });
  });

  it('never throws into the crash path', () => {
    loadSettings.mockReturnValue(DEFAULT_SETTINGS);
    speak.mockImplementation(() => {
      throw new Error('no audio');
    });
    expect(() => sayCrashLine()).not.toThrow();
  });
});
