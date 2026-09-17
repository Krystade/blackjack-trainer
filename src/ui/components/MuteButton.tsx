import { saveSettings } from '../../store/persist';
import { cancelSpeech } from '../../audio/speech';
import type { Settings } from '../../store/types';

/**
 * One button that silences the app, reachable from every screen.
 *
 * WHY IT FLOATS. The requirement (operator, 2026-09-16) is "be able to use it
 * in public without turning my sound all the way down and being forced to
 * have noise playing" -- which is a thing you need HALFWAY THROUGH a drill,
 * with a hand already committed and somebody now standing next to you. A
 * control for that cannot live three taps away inside Settings, and it cannot
 * live in a drill's own top bar either: the table and the eyes-free drills are
 * immersive screens that stand the tab bar down and own their whole layout, so
 * a per-screen button would be absent from exactly the screens that make
 * noise.
 *
 * So it is rendered once, by the app shell, above everything.
 *
 * IT IS NOT A PAUSE. Pressing it stops what is being said mid-sentence rather
 * than muting the rest of it -- a sentence that keeps playing silently and
 * then resumes audibly is not what anyone means by mute. The drill underneath
 * carries on, because its pacing is driven by timers, not by the audio.
 *
 * Hidden when audio is off, which is not the same state: `enabled: false`
 * means the app has no voice at all, and a mute button for silence that is
 * already total is just a control that does nothing.
 */
export function MuteButton({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}) {
  if (!settings.audio.enabled) return null;

  const muted = settings.audio.muted;

  const toggle = () => {
    const next: Settings = {
      ...settings,
      audio: { ...settings.audio, muted: !muted },
    };
    // Stop the current utterance on the way INTO mute only. On the way out,
    // there is nothing to stop and cutting the queue would swallow whatever
    // the drill was about to say next.
    if (!muted) cancelSpeech();
    saveSettings(next);
    onSettingsChange(next);
  };

  return (
    <button
      type="button"
      className={`mute-btn${muted ? ' mute-btn-on' : ''}`}
      data-testid={`mute-btn${muted ? ' mute-btn-on' : ''}`}
      onClick={toggle}
      aria-pressed={muted}
      // The accessible name says what pressing it DOES, not what the state
      // is: eyes-free, a control that announces "Muted" is ambiguous about
      // which way it is about to go.
      aria-label={muted ? 'Unmute' : 'Mute'}
      title={muted ? 'Unmute' : 'Mute'}
    >
      <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
    </button>
  );
}
