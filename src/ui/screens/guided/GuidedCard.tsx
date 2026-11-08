import { useState } from 'react';
import type { Screen } from '../../App';
import type { Profile, Settings } from '../../../store/types';
import { loadStats, saveSettings } from '../../../store/persist';
import { localDayKey } from '../../../store/practiceDays';
import { habitClock } from '../../../habits/clock';
import { PRESETS, planBlurb, planSession, segmentDef, type GuidedPreset } from '../../../guided/plan';
import { isResumable, resume, type GuidedSession } from '../../../guided/session';
import { loadGuided } from '../../../guided/store';
import { noteGuidedPriorModes, setGuidedLaunch } from '../../../guided/launch';
import { GUIDED_INTRO, driveIntroLine, introLine } from '../../../guided/lines';
import { setDrillLaunch } from '../../drillLaunch';
import { isEyesFreeOn, setEyesFreeOn } from '../../eyesFreeSession';
import { isVoiceOn, setVoiceOn } from '../../voiceSession';
import { withAudioEnabled } from '../../audioGate';
import { speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { planInputFor, startGuided } from './guidedStart';
import type { Ladder } from '../nextStep';
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
  ladder,
}: {
  settings: Settings;
  activeProfile: Profile;
  onSettingsChange: (s: Settings) => void;
  onNavigate: (screen: Screen) => void;
  /** Home's ladder, so the card describes the plan from the same judgement. */
  ladder?: Ladder;
}) {
  const [store] = useState(() => loadGuided());
  // B33: the habit clock, so the guided day moves with every other habit day.
  const nowMs = habitClock();
  const today = localDayKey(new Date(nowMs));
  const active = isResumable(store.active, today, nowMs) ? store.active : null;
  const [preset, setPreset] = useState<GuidedPreset>(() => store.history[0]?.preset ?? 15);

  const launch = (session: GuidedSession, spoken: string | null) => {
    noteGuidedPriorModes({ eyesFree: isEyesFreeOn(), voice: isVoiceOn() });
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
      setVoiceOn(false, 'guided-start');
    }
    setGuidedLaunch(session);
    setDrillLaunch('guided');
    onNavigate('drills');
  };

  const start = (drive: boolean) => launch(startGuided(preset, drive, loadStats(), activeProfile, Date.now()), drive ? driveIntroLine(preset) : introLine(preset));
  // Track 1 (1A): the line says what THIS preset's plan covers -- only the
  // steps reached so far, and which one joins next.
  const blurb = active ? '' : (() => {
    const input = planInputFor(loadStats(), activeProfile, Date.now(), ladder);
    return planBlurb(planSession(preset, input), input);
  })();

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
          <button type="button" className="u-btn guided-card-go" onClick={() => launch(resume(active), GUIDED_INTRO)}>
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
          <p className="guided-card-why" data-testid="guided-card-blurb">{blurb}</p>
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
          Start<span className="guided-card-go-more"> guided session</span>
        </button>
        <button type="button" className="u-btn guided-card-alt" onClick={() => start(true)}>
          Drive
        </button>
      </div>
    </section>
  );
}
