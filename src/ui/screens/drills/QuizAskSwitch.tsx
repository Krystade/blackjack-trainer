import type { Settings } from '../../../store/types';
import { saveSettings } from '../../../store/persist';
import { Segmented } from '../Settings';

/**
 * B3: what the Deviation quiz asks. "Best play" is the quiz as it was (a count
 * and a hand, name the play); "Index test" shows the hand and asks for the
 * index. "Best play" rather than "Play", which collides with the tab bar.
 */
export function QuizAskSwitch({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}) {
  return (
    <div className="settings-row">
      <span className="settings-label">Ask</span>
      <Segmented
        options={[
          { value: 'play', label: 'Best play' },
          { value: 'index', label: 'Index test' },
        ]}
        value={settings.drill.quizAsk ?? 'play'}
        onChange={(quizAsk) => {
          const next: Settings = { ...settings, drill: { ...settings.drill, quizAsk } };
          saveSettings(next);
          onSettingsChange(next);
        }}
      />
    </div>
  );
}
