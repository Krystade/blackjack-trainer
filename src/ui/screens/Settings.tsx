import { useEffect, useRef, useState } from 'react';
import type { Screen } from '../App';
import type { AudioSettings, Settings as SettingsData } from '../../store/types';
import { THEMES, normalizeTheme } from '../theme';
import { saveSettings } from '../../store/persist';
import {
  chime,
  ensureMediaSessionHandlers,
  isSpeechSupported,
  listVoices,
  speak,
} from '../../audio';
import {
  setClipsEnabled,
  setClipVoice,
  loadClipIndex,
  prewarmClips,
  type ClipVoiceInfo,
} from '../../audio/clips';
import { carControlsBlockers, describeCarControlsBlocker } from '../../audio/carControls';
import { readLog, clearLog, formatLog } from '../../audio/mediaSessionLog';
import { startButtonTest, unheardActions } from '../../audio/buttonTester';
import type { ButtonPress, ButtonTesterHandle } from '../../audio/buttonTester';
import { MEDIA_SESSION_LABEL } from '../../audio/mediaSession';
import type { MediaSessionAction } from '../../audio/mediaSession';
import { MAX_VOLUME } from '../../audio/volume';
import { detectVoiceSupport } from '../../audio/voiceRecognition';
import { SHOT_CLOCK_OPTIONS, shotClockLabel } from '../../drills/shotClock';
import {
  readVoiceHistory,
  clearVoiceHistory,
  summariseHistory,
  formatVoiceHistory,
  type HeardEntry,
} from '../../audio/voiceHistory';
import {
  clearOnDeviceProbeGuard,
  onDeviceProbeCrashed,
  onDeviceStatus,
  installOnDevice,
  prefersOnDevice,
  setPrefersOnDevice,
  describeOnDeviceStatus,
  type OnDeviceStatus,
} from '../../audio/onDeviceSpeech';
import { startVoiceProbe, readProbeLog, clearProbeLog, formatProbeLog } from '../../audio/voiceProbe';
import type { ProbeEntry, ProbeHandle } from '../../audio/voiceProbe';
import type { LogEntry } from '../../audio/mediaSessionLog';

interface SettingsProps {
  settings: SettingsData;
  onNavigate: (screen: Screen) => void;
  onSettingsChange: (settings: SettingsData) => void;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`segmented-btn${opt.value === value ? ' segmented-btn-active' : ''}`}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="settings-toggle-row">
      <span className="settings-label">{label}</span>
      <input
        type="checkbox"
        className="settings-toggle"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
    </label>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const dec = () => onChange(clamp(round2(value - step), min, max));
  const inc = () => onChange(clamp(round2(value + step), min, max));
  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      <div className="stepper">
        <button type="button" className="stepper-btn" onClick={dec} disabled={disabled || value <= min}>
          &minus;
        </button>
        <span className="stepper-value">{format ? format(value) : value}</span>
        <button type="button" className="stepper-btn" onClick={inc} disabled={disabled || value >= max}>
          +
        </button>
      </div>
    </div>
  );
}

export function Settings({ settings, onNavigate, onSettingsChange }: SettingsProps) {
  const commit = (next: SettingsData) => {
    saveSettings(next);
    onSettingsChange(next);
  };

  const update = (patch: Partial<SettingsData>) => {
    commit({ ...settings, ...patch });
  };

  const updateDrill = (patch: Partial<SettingsData['drill']>) => {
    update({ drill: { ...settings.drill, ...patch } });
  };

  const updateAudio = (patch: Partial<AudioSettings>) => {
    update({ audio: { ...settings.audio, ...patch } });
  };

  // Settings renders without calling useAudio() (unlike Table/Drills/Stats),
  // so it has to update speech.ts's clip-enable flag directly on toggle
  // rather than relying on useAudio's effect -- see clips.ts's header
  // comment for the full wiring picture.
  const updateUseClips = (v: boolean) => {
    setClipsEnabled(v);
    if (v) void prewarmClips();
    updateAudio({ useClips: v });
  };

  // Same wiring rationale as updateUseClips above -- Settings renders
  // without calling useAudio(), so it drives clips.ts's module-level clip
  // voice directly on change too.
  const updateClipVoice = (v: string) => {
    setClipVoice(v);
    void prewarmClips();
    updateAudio({ clipVoice: v });
  };

  const speechSupported = isSpeechSupported();
  const [voices, setVoices] = useState(() => listVoices());

  // Chrome loads voices asynchronously — the list is often empty on first
  // read and fires `voiceschanged` once the real list is ready.
  useEffect(() => {
    if (!speechSupported) return;
    const synth = window.speechSynthesis;
    const handleVoicesChanged = () => setVoices(listVoices());
    synth.onvoiceschanged = handleVoicesChanged;
    return () => {
      synth.onvoiceschanged = null;
    };
  }, [speechSupported]);

  // public/clips/index.json's voice list, for the clip-voice picker below.
  // Absent/failed assets resolve `null` (see clips.ts) and the picker simply
  // doesn't render -- no error state to show.
  const [clipVoices, setClipVoices] = useState<ClipVoiceInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    void loadClipIndex().then((idx) => {
      if (!cancelled && idx) setClipVoices(idx.voices);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const audioDisabled = !settings.audio.enabled;

  return (
    <div className="settings-screen">
      <div className="settings-topbar">
        <button type="button" className="settings-back-btn" onClick={() => onNavigate('home')}>
          Back to Home
        </button>
        <div className="settings-heading">Settings</div>
      </div>

      <section className="settings-section">
        <h2 className="settings-section-title">Theme</h2>
        {/* Picked by PURPOSE, not by swatch: which one you want depends on
            where you are using the app -- a dark car, bright daylight, or a
            chart-study session -- so each option states its deciding factor. */}
        <div className="theme-picker">
          {THEMES.map((t) => {
            const selected = normalizeTheme(settings.theme) === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={`theme-option${selected ? ' theme-option-selected' : ''}`}
                aria-pressed={selected}
                data-theme-id={t.id}
                onClick={() => update({ theme: t.id })}
              >
                <span className="theme-option-head">
                  <span className="theme-swatch" data-swatch={t.id} aria-hidden="true" />
                  <span className="theme-option-name">{t.name}</span>
                </span>
                <span className="theme-option-note">{t.note}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Feedback mode</h2>
        <Segmented
          options={[
            { value: 'training', label: 'Training' },
            { value: 'test', label: 'Test' },
          ]}
          value={settings.feedbackMode}
          onChange={(v) => update({ feedbackMode: v })}
        />
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Play</h2>
        <Toggle
          label="Count peek"
          checked={settings.countPeek}
          onChange={(v) => update({ countPeek: v })}
        />
        <Stepper
          label="Deal speed"
          value={settings.dealSpeedMs}
          min={0}
          max={1000}
          step={100}
          format={(v) => `${v}ms`}
          onChange={(v) => update({ dealSpeedMs: v })}
        />
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Drills</h2>
        <div className="settings-row">
          <span className="settings-label">Flashcard category</span>
          <Segmented
            options={[
              { value: 'all', label: 'All' },
              { value: 'hard', label: 'Hard' },
              { value: 'soft', label: 'Soft' },
              { value: 'pairs', label: 'Pairs' },
            ]}
            value={settings.drill.flashCategory}
            onChange={(v) => updateDrill({ flashCategory: v })}
          />
        </div>
        <div className="settings-row">
          <span className="settings-label">Count group size</span>
          <Segmented
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
            value={String(settings.drill.countGroup)}
            onChange={(v) => updateDrill({ countGroup: Number(v) as 1 | 2 | 3 })}
          />
        </div>
        <Stepper
          label="Count interval"
          value={settings.drill.countIntervalMs}
          min={300}
          max={3000}
          step={100}
          format={(v) => `${v}ms`}
          onChange={(v) => updateDrill({ countIntervalMs: v })}
        />
        <Stepper
          label="Count length"
          value={settings.drill.countLengthCards}
          min={13}
          max={312}
          step={13}
          format={(v) => `${v} cards`}
          onChange={(v) => updateDrill({ countLengthCards: v })}
        />
        <div className="settings-row">
          <span className="settings-label">Shot clock</span>
          <Segmented
            options={SHOT_CLOCK_OPTIONS.map((ms) => ({
              value: String(ms),
              label: shotClockLabel(ms),
            }))}
            value={String(settings.drill.shotClockMs)}
            onChange={(v) => updateDrill({ shotClockMs: Number(v) })}
          />
        </div>
        <p className="settings-note">
          A time limit on flashcard and deviation-quiz answers. Running out counts the card as
          missed — under "Ran out of time" on Stats, kept apart from wrong plays — and puts it back
          in the review deck. Off by default: pressure before accuracy inflates the score without
          building the recall.
        </p>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Audio</h2>
        <Toggle
          label="Audio enabled"
          checked={settings.audio.enabled}
          onChange={(v) => updateAudio({ enabled: v })}
        />
        <Toggle
          label="Use recorded voice (higher quality)"
          checked={settings.audio.useClips}
          onChange={updateUseClips}
          disabled={audioDisabled}
        />
        <div className="settings-note-row u-note">
          Recorded clips cover any card/count/prompt phrase by concatenating per-sentence and
          per-item clips; anything not covered falls back to live speech. Speech rate applies to
          both -- clip playback speeds up without changing pitch.
        </div>
        {settings.audio.useClips && clipVoices.length > 0 && (
          <div className="settings-row">
            <span className="settings-label">Clip voice</span>
            <select
              className="settings-select"
              value={settings.audio.clipVoice}
              onChange={(e) => updateClipVoice(e.target.value)}
              disabled={audioDisabled}
            >
              <option value="">Automatic (default)</option>
              {clipVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="settings-row">
          <span className="settings-label">Verbosity</span>
          <Segmented
            options={[
              { value: 'off', label: 'Off' },
              { value: 'results', label: 'Results' },
              { value: 'full', label: 'Full' },
            ]}
            value={settings.audio.verbosity}
            onChange={(v) => updateAudio({ verbosity: v })}
            disabled={audioDisabled}
          />
        </div>
        <div className="settings-row">
          <span className="settings-label">Card detail</span>
          <Segmented
            options={[
              { value: 'full', label: 'Full' },
              { value: 'rank', label: 'Rank' },
              { value: 'face', label: 'Face' },
            ]}
            value={settings.audio.cardDetail}
            onChange={(v) => updateAudio({ cardDetail: v })}
            disabled={audioDisabled}
          />
        </div>
        <div className="settings-row">
          <span className="settings-label">Hand announcement</span>
          <Segmented
            options={[
              { value: 'cards', label: 'Cards' },
              { value: 'total', label: 'Total' },
            ]}
            value={settings.audio.handStyle}
            onChange={(v) => updateAudio({ handStyle: v })}
            disabled={audioDisabled}
          />
        </div>
        <Stepper
          label="Speech rate"
          value={settings.audio.rate}
          min={0.5}
          max={3.0}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(v) => updateAudio({ rate: v })}
          disabled={audioDisabled}
        />
        {/* A Stepper rather than a range input, matching Speech rate: the
            eyes-free use case is a phone in a car mount, where a discrete
            +/- target is hittable without looking and a thin slider thumb
            is not. 0% is reachable on purpose -- see AudioSettings.volume. */}
        <Stepper
          label="Volume"
          value={settings.audio.volume}
          min={0}
          max={MAX_VOLUME}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => updateAudio({ volume: v })}
          disabled={audioDisabled}
        />
        {settings.audio.volume > 1 && !settings.audio.useClips && (
          <div className="settings-note-row u-note">
            Above 100% only applies to the recorded voice. Live speech is capped at 100% by
            the browser and cannot be amplified — turn on the recorded voice to use the boost.
          </div>
        )}
        <div className="settings-row">
          <span className="settings-label">Voice</span>
          {speechSupported ? (
            <select
              className="settings-select"
              value={settings.audio.voiceURI}
              onChange={(e) => {
                const voiceURI = e.target.value;
                updateAudio({ voiceURI });
                speak('Queen. True count plus three.', {
                  interrupt: true,
                  rate: settings.audio.rate,
                  voiceURI,
                  volume: settings.audio.volume,
                });
              }}
              disabled={audioDisabled}
            >
              <option value="default">Automatic (best available)</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
          ) : (
            <select className="settings-select" disabled>
              <option>Speech not supported on this device</option>
            </select>
          )}
        </div>
        <Toggle
          label="Chimes"
          checked={settings.audio.chimes}
          onChange={(v) => updateAudio({ chimes: v })}
          disabled={audioDisabled}
        />
        <Stepper
          label="Answer pause"
          value={settings.audio.answerPauseMs}
          min={0}
          max={5000}
          step={500}
          format={(v) => `${(v / 1000).toFixed(1)} s`}
          onChange={(v) => updateAudio({ answerPauseMs: v })}
          disabled={audioDisabled}
        />
        <div className="settings-row">
          <button
            type="button"
            className="settings-test-audio-btn"
            disabled={audioDisabled}
            onClick={() => {
              speak('Audio is working. True count plus three.', {
                interrupt: true,
                rate: settings.audio.rate,
                voiceURI: settings.audio.voiceURI,
                volume: settings.audio.volume,
              });
              if (settings.audio.chimes) {
                chime('good', { volume: settings.audio.volume });
              }
            }}
          >
            Test audio
          </button>
        </div>
      </section>

      <CarDiagnostics audio={settings.audio} />

      <VoiceProbePanel />
      <VoiceHistoryPanel />
    </div>
  );
}

/**
 * Press a wheel button; be told what it is called.
 *
 * The one question a drive cannot otherwise answer. A ring selector with five
 * directions plus volume and call keys is nine physical controls, the browser
 * can hear at most eight Media Session names, and which physical button emits
 * which name is decided inside the head unit. Guessing produced a mapping that
 * looped for five minutes on the last drive.
 *
 * WHILE THE TEST RUNS, EVERY BUTTON IS INERT. A press reports its name and does
 * nothing else -- learning that the ring's left click is `previoustrack` must
 * not simultaneously repeat a prompt or answer a drill question. Normal
 * behaviour comes back on Stop, and on unmount, so leaving Settings mid-test
 * cannot strand the app with dead controls.
 *
 * The silent loop that keeps the car listening is audio/buttonTester.ts's, and
 * its header says why it has to be there.
 */
function ButtonTester({ onPressed }: { onPressed: () => void }) {
  const [running, setRunning] = useState(false);
  const [presses, setPresses] = useState<ButtonPress[]>([]);
  const handleRef = useRef<ButtonTesterHandle | null>(null);

  // Stop on unmount. Without this, navigating away mid-test leaves the probe
  // armed and every wheel button silently dead for the rest of the session.
  useEffect(() => {
    return () => {
      handleRef.current?.stop();
      handleRef.current = null;
    };
  }, []);

  const start = () => {
    setPresses([]);
    // Claim the transport controls first. They are normally registered by the
    // first clip that plays, and a driver can easily reach this panel before
    // the app has said anything -- in which case there is nothing listening,
    // and every button would report as dead.
    ensureMediaSessionHandlers();
    handleRef.current = startButtonTest((press) => {
      setPresses((prev) => [press, ...prev].slice(0, 40));
      // Spoken, because the whole point is to work from the driver's seat.
      // Live speech deliberately: the clip library has no recording of
      // "Skip forward. Answers yes." and never should -- this is a diagnostic
      // sentence, not something a drill says.
      const label = MEDIA_SESSION_LABEL[press.action as MediaSessionAction];
      speak(label ?? press.action, { interrupt: true });
      onPressed();
    });
    setRunning(true);
  };

  const stop = () => {
    handleRef.current?.stop();
    handleRef.current = null;
    setRunning(false);
  };

  const heard = [...new Set(presses.map((p) => p.action))];
  const unheard = unheardActions(heard);

  return (
    <>
      <div className="settings-row">
        <span className="settings-label">Test the wheel buttons</span>
        <button type="button" className="settings-mini-btn" onClick={running ? stop : start}>
          {running ? 'Stop test' : 'Start test'}
        </button>
      </div>

      {!running && presses.length === 0 && (
        <div className="settings-note-row u-note">
          Start this, then press every button on the wheel one at a time — the ring in all
          four directions and its centre, volume up and down, and the call keys. Each one
          that reaches the app says its own name out loud, so you can do this parked without
          looking. Nothing you press during the test does anything else. Your car will only
          send some of these; the ones it never sends are worth knowing too.
        </div>
      )}

      {running && (
        <div className="settings-note-row u-note">
          Listening. A silent track is playing to keep the car pointed at this app — that is
          what makes the buttons reach it at all. Press one.
        </div>
      )}

      {presses.length > 0 && (
        <>
          <div className="settings-row">
            <span className="settings-label">Heard so far</span>
            <span className="settings-value">{heard.join(', ')}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Never arrived</span>
            <span className="settings-value">{unheard.length ? unheard.join(', ') : 'none — all eight reached the app'}</span>
          </div>
          <ul className="car-press-list">
            {presses.map((press, i) => (
              <li className="car-press-row" key={`${press.at}-${i}`}>
                <span className="car-press-action">{press.action}</span>
                <span className="car-press-label">
                  {MEDIA_SESSION_LABEL[press.action as MediaSessionAction] ?? 'Unknown action'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * What the car actually did, read back after the drive.
 *
 * Media Session is the one feature here that cannot be verified from a desk,
 * and the only person who can observe it is driving -- no console, no
 * devtools. So the app records every transport action the head unit sends
 * (see audio/mediaSessionLog.ts) and this panel reads it back once parked.
 *
 * Deliberately last in Settings and empty-by-default: it is diagnostic, not
 * a control, and it says nothing at all until there is something to report.
 */
function CarDiagnostics({ audio }: { audio: AudioSettings }) {
  const [entries, setEntries] = useState<LogEntry[]>(() => readLog());
  const [shown, setShown] = useState(false);
  const blockers = carControlsBlockers(audio);

  const invoked = [...new Set(entries.filter((e) => e.kind === 'invoke').map((e) => e.action))];
  const accepted = [...new Set(entries.filter((e) => e.kind === 'register' && e.ok).map((e) => e.action))];
  const refused = [...new Set(entries.filter((e) => e.kind === 'register' && !e.ok).map((e) => e.action))];

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Car controls</h2>

      <div className="settings-note-row u-note">
        Records which steering-wheel buttons your car sends, so the mapping can be
        matched to it. Fills in by itself while you drive.
      </div>

      {/* Why the readout below can stay empty forever. Both conditions are
          invisible from the driver's seat, and the first drive met neither:
          the wheel did nothing, and the car showed the app as a phone call. */}
      <div className="settings-row">
        <span className="settings-label">Can the wheel reach this app?</span>
        <span className="settings-value" data-car-ready={blockers.length === 0}>
          {blockers.length === 0 ? 'Yes — settings are right' : 'Not yet'}
        </span>
      </div>
      {blockers.map((b) => (
        <div key={b} className="settings-note-row u-note">
          {describeCarControlsBlocker(b)}
        </div>
      ))}
      <div className="settings-note-row u-note">
        Leave the microphone off. Turning voice on switches the car to its hands-free
        CALL route — which is why the app showed up as a phone call — and the
        wheel&rsquo;s buttons then go to that call, not to this app. Talking to it and
        steering-wheel control cannot both work at once, which is why skip forward
        answers for you: with the microphone off, the wheel is the whole loop.
      </div>

      <ButtonTester onPressed={() => setEntries(readLog())} />

      <div className="settings-row">
        <span className="settings-label">Buttons your car sent</span>
        <span className="settings-value">{invoked.length ? invoked.join(', ') : 'none yet'}</span>
      </div>
      {/* What those buttons now do, stated because the mapping is no longer a
          guess: the 2026-09-11 drive showed this car sends skip and pause on a
          press, and sends `play` on its own every time a clip ends. */}
      <div className="settings-note-row u-note">
        Skip forward answers &ldquo;yes&rdquo; — it submits, confirms, and deals the next
        hand, so a drill can be run from the wheel with the microphone off. Skip back
        repeats the last thing said, and pause stops it. Play is ignored on purpose:
        your car sends it by itself every time a clip finishes, and acting on it made
        the question repeat without end.
      </div>
      <div className="settings-row">
        <span className="settings-label">Accepted by this phone</span>
        <span className="settings-value">{accepted.length ? accepted.join(', ') : 'none yet'}</span>
      </div>
      {refused.length > 0 && (
        <div className="settings-row">
          <span className="settings-label">Refused</span>
          <span className="settings-value">{refused.join(', ')}</span>
        </div>
      )}

      <div className="settings-row">
        <button type="button" className="settings-mini-btn" onClick={() => setEntries(readLog())}>
          Refresh
        </button>
        <button type="button" className="settings-mini-btn" onClick={() => setShown((v) => !v)}>
          {shown ? 'Hide detail' : 'Show detail'}
        </button>
        <button
          type="button"
          className="settings-mini-btn"
          onClick={() => {
            clearLog();
            setEntries([]);
          }}
        >
          Clear
        </button>
      </div>

      {shown && (
        <>
          <div className="settings-row">
            <button
              type="button"
              className="settings-mini-btn"
              onClick={() => {
                // Clipboard can be unavailable or denied; the text is on
                // screen regardless, so a failure needs no alarm.
                void navigator.clipboard?.writeText(formatLog(entries)).catch(() => {});
              }}
            >
              Copy report
            </button>
          </div>
          <pre className="car-log">{formatLog(entries)}</pre>
        </>
      )}
    </section>
  );
}

/**
 * The voice-recognition spike.
 *
 * Whether voice input is buildable at all cannot be settled from a
 * development machine: Playwright's Chromium exposes the whole
 * SpeechRecognition surface and then fires no events, because there is no
 * microphone and no speech backend behind it. So this panel exists to be RUN
 * BY THE OPERATOR on the devices that matter -- an iPhone in a car, and a
 * backgrounded Chrome tab -- and to record what happened for reading
 * afterwards, since in both cases they cannot watch a screen while it runs.
 */
/**
 * The offline speech model.
 *
 * Recognition normally streams audio to Google's servers, which is why it is
 * accurate and also why it has the two failures that hurt in a car: a
 * server-side session limit that kills listening roughly every ninety seconds
 * -- each restart deaf, and each one re-opening the microphone, which is the
 * crackle heard on every cycle -- and a hard dependency on signal, so a
 * tunnel stops it.
 *
 * A local model has no server and so, in principle, neither problem. It has
 * to be downloaded first, which is a decision for the operator and their data
 * plan, not something to start behind their back.
 *
 * Nothing here claims success on its own say-so. `install()` was measured
 * resolving FALSE immediately, with a real user gesture, without throwing and
 * without a reason -- so what gets reported is what `available()` says
 * afterwards, and a refusal is described as a refusal.
 *
 * AND NOTHING HERE ASKS UNTIL ASKED. The capability query kills the renderer
 * outright on some builds of Chrome -- measured, and with an identical API
 * surface to the builds where it works, so there is nothing to feature-detect.
 * Opening Settings must not be able to close the app, so the query sits
 * behind a button. Someone who never presses it is never exposed to it.
 */
function OnDeviceModelPanel() {
  const [status, setStatus] = useState<OnDeviceStatus | null>(null);
  const [preferred, setPreferred] = useState(() => prefersOnDevice());
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const [checking, setChecking] = useState(false);
  const crashedBefore = onDeviceProbeCrashed();

  const refresh = () => {
    setChecking(true);
    void onDeviceStatus().then((next) => {
      setStatus(next);
      setChecking(false);
    });
  };

  // A download continues in the background and reports no progress, so the
  // only way to notice it finishing is to keep asking. Safe to poll: getting
  // here at all means the query already returned once on this browser.
  useEffect(() => {
    if (status !== 'downloading') return;
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [status]);

  const download = () => {
    setBusy(true);
    setRefused(false);
    // Called straight from the click: this needs the user gesture, and
    // awaiting anything before it would spend it.
    void installOnDevice().then((outcome) => {
      setStatus(outcome.status);
      // Refused AND still not installed. Either alone is not a failure: a
      // browser that already holds the model declines and is ready anyway.
      setRefused(!outcome.accepted && outcome.status !== 'available');
      setBusy(false);
    });
  };

  // Not asked yet. The query is the dangerous part, so it waits to be asked
  // for by name rather than happening because a screen was opened.
  if (status === null) {
    return (
      <>
        <div className="settings-row">
          <button
            type="button"
            className="settings-mini-btn"
            onClick={refresh}
            disabled={checking || crashedBefore}
          >
            {checking ? 'Checking…' : 'Check for an offline model'}
          </button>
        </div>
        <div className="settings-note-row u-note">
          {crashedBefore ? (
            <>
              This browser closed the app the last time it was asked whether an
              offline model exists, so it will not be asked again here. Voice keeps
              working over the network. A browser update may fix it &mdash; use
              &ldquo;Ask this browser again&rdquo; below to retry.
            </>
          ) : (
            <>
              Recognition normally needs a signal. Checking asks whether this browser
              can install a speech model that runs on the device instead &mdash; worth
              having in a tunnel.
            </>
          )}
        </div>
        {crashedBefore && (
          <div className="settings-row">
            <button
              type="button"
              className="settings-mini-btn"
              onClick={() => {
                clearOnDeviceProbeGuard();
                refresh();
              }}
            >
              Ask this browser again
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="settings-row">
        <span className="settings-label">Offline model</span>
        <span className="settings-value">{status}</span>
      </div>

      <div className="settings-note-row u-note">{describeOnDeviceStatus(status)}</div>

      {(status === 'downloadable' || status === 'downloading') && (
        <div className="settings-row">
          <button
            type="button"
            className="settings-mini-btn"
            onClick={download}
            disabled={busy || status === 'downloading'}
          >
            {busy ? 'Asking…' : 'Download offline model'}
          </button>
        </div>
      )}

      {refused && (
        <div className="settings-note-row u-note">
          The browser declined to install it, without saying why. That is what this
          build does when it cannot fetch the model &mdash; on a phone it usually
          means Wi-Fi, storage or a battery-saver restriction. Voice keeps working
          over the network either way.
        </div>
      )}

      {status === 'available' && (
        <Toggle
          label="Use the offline model"
          checked={preferred}
          onChange={(on) => {
            setPrefersOnDevice(on);
            setPreferred(on);
          }}
        />
      )}
    </>
  );
}

/**
 * Everything the microphone heard, read back.
 *
 * The alias table only improves when a real mishearing is caught, and the
 * one that has been caught so far -- "Stant" for "stand" -- was found because
 * the operator happened to glance at the screen mid-drill. That does not work
 * in a car, which is exactly where road noise and a phone microphone produce
 * substitutions nobody would think to invent. So the app writes them all down
 * and this reads them back, commonest rejection first: a substitution the
 * engine keeps making is worth adding to the table, a one-off usually is not.
 *
 * It is also, plainly, a record of what an open microphone heard. Text only,
 * on this device only, capped, and clearable right here.
 */
function VoiceHistoryPanel() {
  const [entries, setEntries] = useState<HeardEntry[]>(() => readVoiceHistory());
  const [shown, setShown] = useState(false);

  const summary = summariseHistory(entries);

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">What the microphone heard</h2>

      <div className="settings-note-row u-note">
        Every phrase heard while voice is on, with what the app made of it. Kept so
        misheard words like &ldquo;Stant&rdquo; can be found and taught, instead of
        waiting to catch one by eye. <strong>Text only, stored on this device,
        never uploaded</strong> &mdash; and clearable below.
      </div>

      <div className="settings-row">
        <span className="settings-label">Phrases recorded</span>
        <span className="settings-value">
          {summary.total === 0
            ? 'none yet'
            : `${summary.matched} understood, ${summary.rejected} not`}
        </span>
      </div>

      {/* How many needed help, and of what kind. A drive full of rescues says
          the engine hears fine and only ranks badly; a drive full of near
          misses says that rule is carrying real weight and is worth checking
          for false positives. Hidden when neither happened, because a row of
          zeroes is noise. */}
      {summary.rescued + summary.approximate > 0 && (
        <div className="settings-row">
          <span className="settings-label">Needed help</span>
          <span className="settings-value">
            {summary.rescued} ranked second, {summary.approximate} near miss
          </span>
        </div>
      )}

      {/* The ranked rejections are the actionable part, so they get a row of
          their own rather than being buried in the timeline. */}
      {summary.candidates.length > 0 && (
        <div className="settings-row">
          <span className="settings-label">Commonest miss</span>
          <span className="settings-value">
            &ldquo;{summary.candidates[0]!.heard}&rdquo; &times;{summary.candidates[0]!.count}
          </span>
        </div>
      )}

      <div className="settings-row">
        <button
          type="button"
          className="settings-mini-btn"
          onClick={() => setEntries(readVoiceHistory())}
        >
          Refresh
        </button>
        <button
          type="button"
          className="settings-mini-btn"
          onClick={() => setShown((v) => !v)}
          disabled={summary.total === 0}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          className="settings-mini-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(formatVoiceHistory(entries)).catch(() => {});
          }}
          disabled={summary.total === 0}
        >
          Copy
        </button>
        <button
          type="button"
          className="settings-mini-btn"
          onClick={() => {
            clearVoiceHistory();
            setEntries([]);
            setShown(false);
          }}
          disabled={summary.total === 0}
        >
          Delete recording
        </button>
      </div>

      {shown && <pre className="car-log">{formatVoiceHistory(entries)}</pre>}
    </section>
  );
}

function VoiceProbePanel() {
  const [entries, setEntries] = useState<ProbeEntry[]>(() => readProbeLog());
  const [running, setRunning] = useState(false);
  const [shown, setShown] = useState(false);
  const [autoRestart, setAutoRestart] = useState(true);
  const handleRef = useRef<ProbeHandle | null>(null);

  const support = detectVoiceSupport();

  // Tearing the session down on unmount matters more than usual here: a live
  // recognition session holds the microphone, and leaving one running after
  // the operator navigates away is both a battery cost and a privacy one.
  useEffect(() => {
    return () => {
      handleRef.current?.stop();
      handleRef.current = null;
    };
  }, []);

  const start = () => {
    handleRef.current?.stop();
    clearProbeLog();
    handleRef.current = startVoiceProbe({ autoRestart });
    setRunning(true);
    setEntries(readProbeLog());
  };

  const stop = () => {
    handleRef.current?.stop();
    handleRef.current = null;
    setRunning(false);
    setEntries(readProbeLog());
  };

  const heard = entries.filter((e) => e.kind === 'result');
  const matched = heard.filter((e) => !e.detail.includes('REJECTED')).length;
  const hiddenEnds = entries.filter(
    (e) => e.kind === 'end' && e.detail.includes('visibility=hidden'),
  ).length;

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Voice control (experiment)</h2>

      <div className="settings-note-row u-note">
        Say <strong>hit</strong>, <strong>stand</strong>, <strong>double</strong>,{' '}
        <strong>split</strong>, <strong>surrender</strong>, <strong>yes</strong>,{' '}
        <strong>no</strong> or <strong>repeat</strong>. Start it, talk, then come back and
        read what it heard. Works while this tab is in the background &mdash; that is
        one of the things being measured.
      </div>

      <div className="settings-row">
        <span className="settings-label">This browser</span>
        <span className="settings-value">
          {support.api ? `supported (${support.flavour})` : 'not supported'}
          {support.media ? '' : ' · no microphone'}
        </span>
      </div>

      <OnDeviceModelPanel />

      <Toggle
        label="Keep restarting when it stops"
        checked={autoRestart}
        onChange={setAutoRestart}
        disabled={running}
      />

      <div className="settings-row">
        <span className="settings-label">Heard</span>
        <span className="settings-value">
          {heard.length === 0 ? 'nothing yet' : `${matched} matched of ${heard.length}`}
        </span>
      </div>
      {hiddenEnds > 0 && (
        <div className="settings-row">
          <span className="settings-label">Stopped while backgrounded</span>
          <span className="settings-value">{hiddenEnds}&times;</span>
        </div>
      )}

      <div className="settings-row">
        {running ? (
          <button type="button" className="settings-mini-btn" onClick={stop}>
            Stop listening
          </button>
        ) : (
          <button
            type="button"
            className="settings-mini-btn"
            onClick={start}
            disabled={!support.api}
          >
            Start listening
          </button>
        )}
        <button type="button" className="settings-mini-btn" onClick={() => setEntries(readProbeLog())}>
          Refresh
        </button>
        <button type="button" className="settings-mini-btn" onClick={() => setShown((v) => !v)}>
          {shown ? 'Hide log' : 'Show log'}
        </button>
      </div>

      {shown && (
        <>
          <div className="settings-row">
            <button
              type="button"
              className="settings-mini-btn"
              onClick={() => {
                void navigator.clipboard?.writeText(formatProbeLog(entries)).catch(() => {});
              }}
            >
              Copy report
            </button>
          </div>
          <pre className="car-log">{formatProbeLog(entries)}</pre>
        </>
      )}
    </section>
  );
}
