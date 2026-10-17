import type { Settings } from '../../../store/types';
import { enableAudioNow } from '../../audioGate';

/**
 * C-R1: the "Eyes-free audio" switch for a drill with no microphone path
 * (Speed, Bet sizing), where DrillModeControls' Voice toggle and Dim-screen
 * option would be inert. Same contract as DrillModeControls' checkbox: ticking
 * it IS a request for audio, so it turns audio on rather than sitting dead.
 */
export function EyesFreeCheckbox({
  settings,
  onSettingsChange,
  eyesFree,
  onChange,
}: {
  settings: Settings;
  onSettingsChange?: (settings: Settings) => void;
  eyesFree: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="count-toggle">
      <input
        type="checkbox"
        checked={eyesFree}
        onChange={(e) => {
          if (e.target.checked && !settings.audio.enabled && onSettingsChange) {
            enableAudioNow(settings, onSettingsChange);
          }
          onChange(e.target.checked);
        }}
      />
      Eyes-free audio
    </label>
  );
}
