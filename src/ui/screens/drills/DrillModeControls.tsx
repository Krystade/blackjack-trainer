import type { ReactNode } from 'react';
import type { Settings } from '../../../store/types';
import { saveSettings } from '../../../store/persist';
import { enableAudioNow } from '../../audioGate';
import { VoiceStatusBar } from '../../components/VoiceStatusBar';
import type { VoiceStatus } from '../../useVoiceControl';
import type { CarStatus } from '../../carStatus';
import { CarStatusLine } from '../../components/CarStatusLine';

/* ---------------------------------------------------------------- */
/* Answer-mode switches + Options, shared by the three hand drills.  */
/* ---------------------------------------------------------------- */

/**
 * How you answer (Eyes-free audio, Voice answers), the listening line, and an
 * "Options" disclosure for everything that is set once rather than every hand.
 *
 * Shared by Flashcards, Deviation Quiz and Mixed. The three had grown five
 * stacked full-width checkboxes plus a three-line listening panel each, which
 * on a 375x812 phone pushed the action bar below the fold -- you had to scroll
 * to answer, and the scroll tucked the top controls under the status bar.
 *
 * - The two answer modes stay in view: they are the first taps of a driving
 *   session and the only way into it.
 * - "Dim screen" only does anything while eyes-free is on, so it appears only
 *   then, inside Options, instead of sitting disabled on every visit.
 * - The listening line is one row: state + what was last heard. The command
 *   list is dropped here because the five plays are already the buttons on
 *   screen, and the earpiece explanation is dropped because Settings carries
 *   its own copy (`.settings-earpiece`) and the setting it pointed to cannot
 *   bring the loud speaker back (see ec67e35).
 *
 * Options is a native <details>, closed by default (also under ?e2e=1 -- a
 * layout test has to see what a real visitor sees).
 */
export function DrillModeControls({
  settings,
  onSettingsChange,
  eyesFree,
  onEyesFreeChange,
  voiceSupported,
  voiceOn,
  onVoiceChange,
  voiceStatus,
  options,
  car,
}: {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  eyesFree: boolean;
  onEyesFreeChange: (on: boolean) => void;
  voiceSupported: boolean;
  voiceOn: boolean;
  onVoiceChange: (on: boolean) => void;
  voiceStatus: VoiceStatus;
  options?: ReactNode;
  /** F7: the car status line, shown only eyes-free. */
  car?: CarStatus;
}) {
  const carLine = eyesFree ? car : undefined;
  const hasOptions = Boolean(options) || eyesFree;
  return (
    <>
      <div className="drill-mode-row">
        <label className="count-toggle">
          <input
            type="checkbox"
            checked={eyesFree}
            onChange={(e) => {
              // Tapping this IS a request for audio, so honour it instead of
              // refusing: the control used to sit disabled whenever
              // `audio.enabled` was false -- which is the shipped default --
              // making the app's whole driving mode a dead checkbox curable
              // only from another screen. See ui/audioGate.ts.
              if (e.target.checked && !settings.audio.enabled) {
                enableAudioNow(settings, onSettingsChange);
              }
              onEyesFreeChange(e.target.checked);
            }}
          />
          Eyes-free audio
        </label>
        {/* Hidden rather than disabled where there is no speech API at all:
            an inert control invites the operator to keep tapping it. */}
        {voiceSupported && (
          <label className="count-toggle">
            <input
              type="checkbox"
              checked={voiceOn}
              onChange={(e) => {
                // Answering out loud is worthless without hearing the reply,
                // so this turns audio on the way Eyes-free does.
                if (e.target.checked && !settings.audio.enabled) {
                  enableAudioNow(settings, onSettingsChange);
                }
                onVoiceChange(e.target.checked);
              }}
            />
            Voice answers
          </label>
        )}
      </div>
      {/* What the microphone last heard, whether or not it meant anything:
          a misheard word and a dead microphone look identical without it. */}
      {voiceOn ? (
        <div className="drill-voice-line">
          <VoiceStatusBar status={voiceStatus} car={carLine} />
        </div>
      ) : (
        carLine && (
          <div className="drill-voice-line">
            <CarStatusLine {...carLine} />
          </div>
        )
      )}
      {hasOptions && (
        <details className="drill-options">
          <summary>Options</summary>
          <div className="drill-options-body">
            {options}
            {/* The ZonePad is labelled by default so its layout can be
                learned; this blanks it (still tappable) for real driving. */}
            {eyesFree && (
              <label className="count-toggle">
                <input
                  type="checkbox"
                  checked={settings.audio.dimZones}
                  onChange={(e) => {
                    const nextSettings: Settings = {
                      ...settings,
                      audio: { ...settings.audio, dimZones: e.target.checked },
                    };
                    saveSettings(nextSettings);
                    onSettingsChange(nextSettings);
                  }}
                />
                Dim screen (tap zones stay live)
              </label>
            )}
          </div>
        </details>
      )}
    </>
  );
}
