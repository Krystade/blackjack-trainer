import { describe, it, expect } from 'vitest';
import { withAudioEnabled } from './audioGate';
import { DEFAULT_SETTINGS } from '../store/types';

/**
 * `audio.enabled` ships false, and 19 controls across the drill screens are
 * gated on it -- including the "Eyes-free audio" toggle, which IS the app's
 * driving mode. So out of the box the whole eyes-free feature was a dead
 * control: tapping it did nothing, and the only cure lived on a different
 * screen behind a line of dim helper text.
 *
 * Tapping "Eyes-free audio" is an unambiguous request for audio, so it now
 * turns audio on rather than refusing. These specs pin that the promotion
 * changes ONLY that flag -- a control that silently rewrote the user's other
 * audio preferences would be a worse bug than the one it replaced.
 */

describe('withAudioEnabled', () => {
  it('turns audio on', () => {
    const off = { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio, enabled: false } };
    expect(withAudioEnabled(off).audio.enabled).toBe(true);
  });

  it('leaves every other audio preference untouched', () => {
    const off = {
      ...DEFAULT_SETTINGS,
      audio: {
        ...DEFAULT_SETTINGS.audio,
        enabled: false,
        volume: 0.4,
        rate: 1.6,
        useClips: true,
        handStyle: 'total' as const,
      },
    };
    const on = withAudioEnabled(off);
    expect(on.audio).toMatchObject({
      volume: 0.4,
      rate: 1.6,
      useClips: true,
      handStyle: 'total',
    });
  });

  it('leaves non-audio settings untouched', () => {
    const off = { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio, enabled: false } };
    const on = withAudioEnabled(off);
    expect(on.drill).toEqual(off.drill);
    expect(on.theme).toBe(off.theme);
  });

  it('does not mutate the input', () => {
    const off = { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio, enabled: false } };
    withAudioEnabled(off);
    expect(off.audio.enabled).toBe(false);
  });

  it('is a no-op when audio is already on', () => {
    const on = { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio, enabled: true } };
    expect(withAudioEnabled(on).audio.enabled).toBe(true);
  });
});
