import { useState } from 'react';
import type { Screen } from '../../App';
import type { Profile, Settings } from '../../../store/types';
import { loadStats, saveSettings } from '../../../store/persist';
import { localDayKey } from '../../../store/practiceDays';
import { PRESETS, segmentDef, type GuidedPreset } from '../../../guided/plan';
import { isResumable, type GuidedSession } from '../../../guided/session';
import { loadGuided } from '../../../guided/store';
import { setGuidedLaunch } from '../../../guided/launch';
import { GUIDED_INTRO, introLine } from '../../../guided/lines';
import { setDrillLaunch } from '../../drillLaunch';
import { setEyesFreeOn } from '../../eyesFreeSession';
import { setVoiceOn } from '../../voiceSession';
import { withAudioEnabled } from '../../audioGate';
import { speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { startGuided } from './guidedStart';
import './guidedCard.css';

/**
 * Wave L (lane v): Home's guided session card -- a length (5 / 15 / 30 min)
 * and two ways in: tapped, or Drive (eyes-free, answered by voice, the first
 * line spoken inside the tap that unlocks audio, as Home's Drive does). An
 * unfinished session from today offers Resume first.
 */
export function GuidedCard({
  settings,
  activeProfile,
  onSettingsChange,
  onNavigate,
}: {
  settings: Settings;
  activeProfile: Profile;
  onSettingsChange: (s: Settings) => void;
  onNavigate: (screen: Screen) => void;
}) {
  const [store] = useState(() => loadGuided());
  const today = localDayKey(new Date());
  const active = isResumable(store.active, today) ? store.active : null;
  const [preset, setPreset] = useState<GuidedPreset>(() => store.history[0]?.preset ?? 15);

  const launch = (session: GuidedSession, spoken: string | null) => {
    if (session.drive) {
      const next = settings.audio.enabled ? settings : withAudioEnabled(settings);
      if (next !== settings) {
        saveSettings(next);
        onSettingsChange(next);
      }
      setEyesFreeOn(true, 'guided-start');
      setVoiceOn(true, 'guided-start');
      if (spoken) speak(spoken, { ...speechOptsFrom(next.audio, { interrupt: true }), protect: true });
    } else {
      setEyesFreeOn(false, 'guided-start');
    }
    setGuidedLaunch(session);
    setDrillLaunch('guided');
    onNavigate('drills');
  };

  const start = (drive: boolean) => launch(startGuided(preset, drive, loadStats(), activeProfile, Date.now()), introLine(preset));

  if (active) {
    const seg = active.plan[active.index]!;
    return (
      <section className="guided-card" aria-label="Guided session" data-state="resume">
        <div className="guided-card-head">
          <div className="guided-card-text">
            <h2 className="guided-card-title">Guided session</h2>
            <p className="guided-card-why">
              Unfinished from today: {segmentDef(seg.id).label}, segment {active.index + 1} of {active.plan.length}
              {active.drive ? ' (Drive)' : ''}.
            </p>
          </div>
        </div>
        <div className="guided-card-buttons">
          <button type="button" className="u-btn guided-card-go" onClick={() => launch(active, GUIDED_INTRO)}>
            Resume
          </button>
          <button type="button" className="u-btn guided-card-alt" onClick={() => start(active.drive)}>
            Start over
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="guided-card" aria-label="Guided session" data-state="start">
      <div className="guided-card-head">
        <div className="guided-card-text">
          <h2 className="guided-card-title">Guided session</h2>
          <p className="guided-card-why">One tap, a routine: warm-up, speed, counting, deviations, bets. Weak spots get longer.</p>
        </div>
        <div className="guided-card-presets" role="radiogroup" aria-label="Length">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={preset === p}
              aria-label={`${p} minutes`}
              className="guided-card-preset"
              onClick={() => setPreset(p)}
            >
              {p}
              <span className="guided-card-preset-unit">m</span>
            </button>
          ))}
        </div>
      </div>
      <div className="guided-card-buttons">
        <button type="button" className="u-btn guided-card-go" onClick={() => start(false)}>
          Start guided session
        </button>
        <button type="button" className="u-btn guided-card-alt" onClick={() => start(true)}>
          Drive
        </button>
      </div>
    </section>
  );
}
