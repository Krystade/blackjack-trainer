import type { Settings } from '../store/types';
import { saveSettings } from '../store/persist';

/**
 * Turn audio on, changing nothing else.
 *
 * `audio.enabled` ships false, and the drill screens gate 19 controls on it
 * -- among them "Eyes-free audio", which IS this app's driving mode. The
 * result was a dead control: a new user taps the thing that turns on the
 * feature they came for, nothing happens, and the only cure is a toggle on
 * another screen, pointed at by one line of dim helper text under the very
 * control that just ignored them.
 *
 * A disabled checkbox is the worst possible affordance here because tapping
 * it produces no event at all -- not even a hint that the tap registered.
 * So the gate is gone: tapping "Eyes-free audio" is an unambiguous request
 * for audio and is now honoured by enabling it.
 *
 * Deliberately narrow. Promoting one flag on the user's behalf is
 * defensible; quietly rewriting their volume, rate or voice while doing it
 * would not be, so this touches `enabled` and nothing else.
 */
export function withAudioEnabled(settings: Settings): Settings {
  return { ...settings, audio: { ...settings.audio, enabled: true } };
}

/**
 * Enable audio and make it stick.
 *
 * `onSettingsChange` is App's `setSettings`, which is React state ONLY --
 * the drill screens pair it with an explicit `saveSettings` (see
 * CountDrillView's `updateDrill`). Doing both here means the three eyes-free
 * toggles cannot drift into the version that updates the screen but forgets
 * the disk, which is exactly the half-fix this function exists to prevent.
 */
export function enableAudioNow(
  settings: Settings,
  onSettingsChange: (next: Settings) => void,
): void {
  const next = withAudioEnabled(settings);
  saveSettings(next);
  onSettingsChange(next);
}
