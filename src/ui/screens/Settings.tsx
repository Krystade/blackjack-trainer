import { useEffect, useMemo, useRef, useState } from 'react';
import { CollapsibleSection } from '../components/CollapsibleSection';
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
  loadVoiceManifest,
  type ClipVoiceInfo,
  type ClipManifest,
} from '../../audio/clips';
import { carControlsBlockers, describeCarControlsBlocker } from '../../audio/carControls';
import { readLog, clearLog, formatLog } from '../../audio/mediaSessionLog';
import { startButtonTest, unheardActions } from '../../audio/buttonTester';
import type { ButtonPress, ButtonTesterHandle } from '../../audio/buttonTester';
import { MEDIA_SESSION_LABEL } from '../../audio/mediaSession';
import type { MediaSessionAction } from '../../audio/mediaSession';
import { micSessionCostPaid } from '../../audio/micSessionCost';
import { MAX_VOLUME, effectiveVolume } from '../../audio/volume';
import { FIELD_TEST_CONDITIONS, FIELD_TEST_STEPS } from '../../diag/fieldTest';
import {
  clipCoverageCases,
  pureCases,
  runCases,
  settingsCases,
  summarise,
  type SelfTestResult,
  type SelfTestStorage,
} from '../../diag/selfTest';
import { CarCheckPanel } from '../components/CarCheckPanel';
import { readFieldTestRun, subscribeFieldTestRun } from '../../diag/fieldTestRun';
import {
  PUSH_TO_TALK_MAX_MS,
  PUSH_TO_TALK_MIN_MS,
  PUSH_TO_TALK_STEP_MS,
} from '../voiceSession';
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
  readDiagnosticLog,
  clearDiagnosticLog,
  formatDiagnosticLog,
  summariseDiagnostics,
  subscribeDiagnostics,
  flushDiagnostics,
  diag,
  type DiagEntry,
} from '../../diag/diagnosticLog';
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

      {/*
        THE SWITCHES A DRIVE NEEDS, IN ONE PLACE.

        They were spread from the Audio section to the bottom of Car controls:
        the on switch, the recorded voice, and -- 1700px further down, past a
        button-mapping diagnostic and five hundred words -- the one control
        that decides what the wheel does at all. Setting the phone up in a
        parked car meant scrolling a six-thousand-pixel page twice.

        First and open by default, because this is the screen's purpose. The
        explanation that used to be its own section four headings above the
        controls now sits beside them.
      */}
      <CollapsibleSection title={<>In the car</>} defaultOpen={true}>
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
        {/* A Stepper rather than a range input, matching Speech rate: the
            eyes-free use case is a phone in a car mount, where a discrete +/-
            target is hittable without looking and a thin slider thumb is not.
            0% is reachable on purpose -- see AudioSettings.volume.

            HERE, and not under Audio, since 2026-10-02: asked for from the
            driver's seat with the car off Bluetooth, where the phone's own
            speaker has to carry the cabin. It is the one audio control a drive
            actually reaches for. */}
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
        {settings.audio.volume > 1 && (
          <div className="settings-note-row u-note">
            Above 100% raises the alert tones only. Neither voice can go past 100% on
            iOS &mdash; use the car or phone volume buttons for that.
          </div>
        )}
        {micSessionCostPaid() && (
          /**
           * Only after a microphone has opened, and then for the rest of the
           * page -- which is exactly how long the earpiece lasts. The listening
           * strip says the same thing, but the strip is gone the moment voice
           * is switched off, and that is precisely when the cabin goes quiet
           * and the operator comes looking. See audio/micSessionCost.ts for
           * what iOS does here and why no part of it is callable from a page.
           */
          <div className="settings-note-row u-note settings-earpiece">
            Voice was used, so iOS may have moved the sound to the earpiece.{' '}
            <strong>Sound with the mic on</strong>, under <strong>Audio</strong>, is the
            control for it; reopening the app also clears it.
          </div>
        )}

        <div className="settings-note-row u-note">
          How much it says, how fast, and which voice: under <strong>Audio</strong>.
        </div>

        <div className="settings-row">
          <span className="settings-label">The two wheel buttons</span>
          <Segmented
            options={[
              { value: 'answer', label: 'Answer' },
              { value: 'talk', label: 'Talk' },
            ]}
            value={settings.drill.wheelMode}
            onChange={(wheelMode) => updateDrill({ wheelMode })}
          />
        </div>
        {settings.drill.wheelMode === 'talk' && (
          <>
            <Stepper
              label="Listen for"
              value={settings.drill.pushToTalkMs}
              min={PUSH_TO_TALK_MIN_MS}
              max={PUSH_TO_TALK_MAX_MS}
              step={PUSH_TO_TALK_STEP_MS}
              format={(v) => `${(v / 1000).toFixed(2)} s`}
              onChange={(pushToTalkMs) => updateDrill({ pushToTalkMs })}
            />
            <div className="settings-note-row u-note">
              A ceiling, not a cost: a recognised word closes the window at once.
            </div>
          </>
        )}
        {settings.drill.wheelMode === 'answer' ? (
          <div className="settings-note-row u-note">
            No microphone at all. Where one button cannot pick one of five plays, forward
            says the correct play and asks &ldquo;had it?&rdquo; &mdash; forward yes, back no.
          </div>
        ) : (
          <div className="settings-note-row u-note">
            Forward opens the microphone and closes it on the first word it hears; back
            repeats. The only mode where the five plays can be <em>spoken</em> and the wheel
            still comes back between windows.
          </div>
        )}
        <div className="settings-note-row u-note">
          Two tones: the press, then the microphone going live. The second one is when to
          speak &mdash; if it never sounds, the microphone never opened.
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Theme</>}
        defaultOpen={false}
      >
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
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Play</>}
        defaultOpen={false}
      >
          {/* Was a section of its own holding this one switch, unlabelled and
              unexplained -- a heading to collapse, for a control that fits on
              a line among the others that decide how a hand plays. */}
          <div className="settings-row">
            <span className="settings-label">Feedback</span>
            <Segmented
              options={[
                { value: 'training', label: 'Training' },
                { value: 'test', label: 'Test' },
              ]}
              value={settings.feedbackMode}
              onChange={(v) => update({ feedbackMode: v })}
            />
          </div>
          <div className="settings-note-row u-note">
            <strong>Training</strong> corrects as you go. <strong>Test</strong> scores at the end.
          </div>
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
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Drills</>}
        defaultOpen={false}
      >
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
            <span className="settings-label">Depth resolution</span>
            <Segmented
              options={[
                { value: 'half', label: 'Half' },
                { value: 'last-deck', label: 'Last deck' },
                { value: 'quarter', label: 'Quarter' },
              ]}
              value={settings.drill.depthResolution}
              onChange={(v) => updateDrill({ depthResolution: v })}
            />
          </div>
          <p className="settings-note">
            How finely you read the discard tray. &ldquo;Last deck&rdquo; asks for quarters
            in the last deck only, which is where the precision pays.
          </p>
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
            A time limit on flashcard and deviation-quiz answers. Running out counts the card
            as missed and puts it back in the review deck.
          </p>
      </CollapsibleSection>


      <CollapsibleSection
        title={<>Audio &mdash; the app speaking</>}
        defaultOpen={false}
      >
          <div className="settings-note-row u-note">
            The on switch and the recorded voice are in <strong>In the car</strong> at the
            top, with the rest of what a drive needs. This is the detail behind them.
          </div>

          {/* HERE RATHER THAN "In the car": that section opens by default and
              is held to under two phone screens by
              e2e/collapsible-sections.spec.ts, which this one row broke on its
              own. "In the car" points here once voice has been used. */}
          <div className="settings-row">
            <span className="settings-label">Sound with the mic on</span>
            <Segmented
              options={[
                { value: 'playback', label: 'Speaker' },
                { value: 'switch', label: 'Switch' },
                { value: 'auto', label: 'Auto' },
              ]}
              value={settings.audio.outputRoute}
              onChange={(outputRoute) => updateAudio({ outputRoute })}
            />
          </div>
          <div className="settings-note-row u-note">
            Opening the microphone moves iOS output to the earpiece. <strong>Speaker</strong>
            declares media mode and never asks to record. <strong>Switch</strong> closes the
            microphone while the app talks &mdash; about a second of deafness per line, and
            the only lever so far that moves the sound back. <strong>Auto</strong> leaves
            iOS alone.
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
          {/* Volume itself lives under "In the car": it was asked for from
              the driver's seat (2026-10-02) while sitting four collapsed
              sections above here. Mute stays, because there is a Mute button
              in the app chrome on every screen -- so the argument that paired
              them, that mute must be findable without reading, is already
              answered without opening Settings at all. It does NOT touch
              `volume` -- see AudioSettings.muted. */}
          <Toggle
            label="Mute"
            checked={settings.audio.muted}
            onChange={(v) => updateAudio({ muted: v })}
            disabled={audioDisabled}
          />
          {settings.audio.muted && (
            <div className="settings-note-row u-note">
              Everything is silent, including the test button. Your volume is still{' '}
              {Math.round(settings.audio.volume * 100)}% and comes back when you unmute.
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
                    volume: effectiveVolume(settings.audio),
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
                  volume: effectiveVolume(settings.audio),
                });
                if (settings.audio.chimes) {
                  chime('good', { volume: effectiveVolume(settings.audio) });
                }
              }}
            >
              Test audio
            </button>
          </div>
      </CollapsibleSection>

      <CarDiagnostics audio={settings.audio} />

      <CarCheckSection onNavigate={onNavigate} />
      <SelfTestSection live={settings} />

      <VoiceProbePanel />
      <VoiceHistoryPanel />
      <DiagnosticLogPanel />
    </div>
  );
}

function CarCheckSection({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const [run, setRun] = useState(() => readFieldTestRun());
  useEffect(() => subscribeFieldTestRun(() => setRun(readFieldTestRun())), []);
  const condition =
    FIELD_TEST_CONDITIONS.find((c) => c.id === run.condition) ?? FIELD_TEST_CONDITIONS[0]!;

  return (
    <CollapsibleSection title={<>Car check</>} defaultOpen={false}>
      <CarCheckPanel />

      {/* The field test used to be its own section with its own paragraph.
          The screen is kept -- it is the only thing that measures the
          speaker-versus-wheel trade, and e2e/field-test-audio.spec.ts drives
          it -- but the way in is one button, here with the rest of the
          measuring, rather than a heading of its own. */}
      <button
        type="button"
        className="fieldtest-stamp"
        data-testid="fieldtest-open"
        onClick={() => onNavigate('fieldtest')}
      >
        {run.active
          ? `Back to the field test \u2014 step ${run.stepIndex + 1} of ${FIELD_TEST_STEPS.length}`
          : `Open the field test (${FIELD_TEST_STEPS.length} steps) \u2014 ${condition.label}`}
      </button>
    </CollapsibleSection>
  );
}


/**
 * THE TEST SUITE, ON THE PHONE.
 *
 * Asked for twice. Jack, 2026-10-03: "can you add all the tests you run to the
 * app itself? ... me using the app on my phone just doesn't equate", and again
 * on 2026-10-04 when the first answer -- device checks bolted onto the car
 * check -- turned out not to be it. What runs here are the invariants that
 * would make the app WRONG rather than merely broken: the strategy chart, the
 * count, the true-count rounding, the indices, the clip coverage, the settings
 * round trip. Nothing speaks, nothing records, nothing touches the car; it is
 * safe to press at a red light.
 *
 * The cases themselves are in diag/selfTest.ts, and the meta-tests in
 * diag/selfTest.test.ts break each subject in turn to prove a case can fail.
 */
function selfTestStorage(): SelfTestStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function SelfTestSection({ live }: { live: SettingsData }) {
  const [results, setResults] = useState<SelfTestResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = () => {
    setRunning(true);
    // The clip manifest is the one subject that needs a fetch, so the whole
    // run is async even though every case itself is synchronous. The voice
    // checked is the one the app would actually SPEAK with -- checking the
    // default while a different voice is selected would report coverage the
    // operator never hears.
    void (async () => {
      let manifest: ClipManifest | null = null;
      try {
        const index = await loadClipIndex();
        const voiceId = live.audio.clipVoice || index?.default || '';
        if (voiceId) manifest = await loadVoiceManifest(voiceId);
      } catch {
        manifest = null;
      }
      setResults(
        runCases([
          ...pureCases(),
          ...clipCoverageCases(manifest),
          ...settingsCases(
            selfTestStorage(),
            live as unknown as Record<string, unknown>,
          ),
        ]),
      );
      setRunning(false);
    })();
  };

  const summary = results ? summarise(results) : null;
  const groups = results
    ? [...new Set(results.map((r) => r.group))].map((group) => ({
        group,
        total: results.filter((r) => r.group === group).length,
        failed: results.filter((r) => r.group === group && r.outcome === 'fail').length,
      }))
    : [];

  return (
    <CollapsibleSection title={<>Strategy and counting check</>} defaultOpen={false}>
      {/*
        NAMED FOR WHAT IT IS, not "Test suite". Jack, 2026-10-04: "This wasn't
        the main thing I wanted to test. Supposed to test functionality more
        like the field test rather than the logic which can start testing on
        the computer." He is right, and the device functionality now lives in
        Car check above. What is left here is the arithmetic -- worth having on
        the phone because it runs against the bundle that actually shipped,
        but not the thing a drive depends on.
      */}
      <div className="settings-note-row u-note">
        The chart, the count, the indices and the recorded voice, checked against the build
        on this phone. Silent and instant. Device faults are under <strong>Car check</strong>.
      </div>

      <button
        type="button"
        className="fieldtest-stamp"
        data-testid="selftest-run"
        disabled={running}
        onClick={run}
      >
        {running ? 'Running\u2026' : summary ? 'Run again' : 'Run the tests'}
      </button>

      {summary && (
        <>
          <div
            className="settings-row"
            data-testid={summary.failed === 0 ? 'selftest-pass' : 'selftest-fail'}
          >
            <span className="settings-label">
              {summary.failed === 0 ? 'All passed' : `${summary.failed} failed`}
            </span>
            <span className="settings-value">
              {summary.passed}/{summary.total}
            </span>
          </div>

          {groups.map((g) => (
            <div className="settings-row" key={g.group}>
              <span className="settings-label">{g.group}</span>
              <span className="settings-value">
                {g.failed === 0 ? `${g.total} ok` : `${g.failed} of ${g.total} failed`}
              </span>
            </div>
          ))}

          {/* The whole point of the screen. A count of failures with no names
              would leave the operator exactly where a green tick does. */}
          {summary.failures.length > 0 && (
            <ul className="selftest-failures" data-testid="selftest-failures">
              {summary.failures.map((f) => (
                <li key={f.id}>
                  <strong>{f.label}</strong>
                  <br />
                  {f.detail}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </CollapsibleSection>
  );
}

/**
 * The field test's door, and nothing more.
 *
 * THE STEPS ARE NOT HERE, and neither is the run. They were here once, and
 * following them meant walking back to this screen after every step -- which
 * threw the run away each time and stopped the first real run after four
 * (2026-09-19). Then they floated over a drill, which kept the run but left
 * the operator running a drill and a test at once (2026-09-22: "I don't know
 * why we have to go to a drill in the first place"). Now the protocol has its
 * own screen and its own voice; this is only the way in.
 */
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
          Press every wheel button one at a time. Each one that reaches the app says its own
          name out loud, and does nothing else while the test runs.
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
    <CollapsibleSection
      title={<>Car controls</>}
      defaultOpen={false}
    >

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
        {/* This paragraph used to say "leave the microphone off", which was
            right when the wheel always answered and is wrong now that it opens
            the microphone by default. The route fact behind it is unchanged
            and still belongs here, next to the readout it explains; the choice
            it was attached to has moved to "In the car", and the phone-mic
            answer (asked directly, 2026-09-16) moved with it rather than being
            said twice on one screen. */}
        <div className="settings-note-row u-note">
          An open microphone flips the car to its hands-free route &mdash; the app shows up
          as a <strong>phone call</strong> &mdash; and the wheel&rsquo;s buttons go to that
          call. Which of the two the buttons do is set under <strong>In the car</strong>.
        </div>

        {/* Asked directly (2026-09-16): "can we use my phone mic". Kept because
            it is a platform fact that looks like a missing feature; cut to one
            line because the paragraph it used to be gets read once. */}
        <div className="settings-note-row u-note">
          <strong>The phone&rsquo;s own microphone?</strong> Not while the car is connected
          &mdash; recognition uses whatever the phone is routing through, and nothing in a
          page can override it.
        </div>

        {/* The wheel's own MODE lives in "In the car" at the top, beside the
            other switches a drive needs. What is left here is the mapping
            diagnostic: which buttons this car actually sends. */}
        <ButtonTester onPressed={() => setEntries(readLog())} />

        <div className="settings-row">
          <span className="settings-label">Buttons your car sent</span>
          <span className="settings-value">{invoked.length ? invoked.join(', ') : 'none yet'}</span>
        </div>
        {/* What those buttons now do, stated because the mapping is no longer a
            guess: the 2026-09-11 drive showed this car sends skip and pause on a
            press, and sends `play` on its own every time a clip ends. */}
        <div className="settings-note-row u-note">
          <strong>Skip forward goes forward</strong>, <strong>skip back goes back</strong>.
          Where a drill wants a number the two walk it and read it back. Play, pause and
          stop are ignored on purpose &mdash; this car sends them unprompted.
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
    </CollapsibleSection>
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
              This browser closed the app the last time it was asked, so it is not asked
              again here. Voice still works over the network.
            </>
          ) : (
            <>
              Asks whether this browser can install a speech model that runs on the device
              &mdash; worth having in a tunnel.
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
    <CollapsibleSection
      title={<>What the microphone heard</>}
      defaultOpen={false}
    >

        <div className="settings-note-row u-note">
          Every phrase heard while voice is on, with what the app made of it.{' '}
          <strong>Text only, on this device, never uploaded.</strong>
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
    </CollapsibleSection>
  );
}

/**
 * The whole session, written down and ready to hand over.
 *
 * The workflow this is built for, in the operator's own words: "let's have a
 * global log accessible in the settings where I can attempt a session and then
 * I can copy and paste it to you to check everything."
 *
 * So the panel is not a dashboard. It is a clipboard button with enough
 * context around it to be used at the side of the road: what is in the log,
 * how to bracket the part that matters, and how to get rid of it afterwards.
 *
 * MARK is the only non-obvious control and it is the important one. A log of a
 * fifteen-minute drive is long, and "the bit where it stopped hearing me"
 * cannot be found by timestamp after the fact. Pressing Mark before and after
 * an attempt brackets it, and the marker lines survive the copy, so the part
 * worth reading can be pointed at rather than described.
 */
function DiagnosticLogPanel() {
  const [entries, setEntries] = useState<DiagEntry[]>(() => readDiagnosticLog());
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');

  // Live, because the operator will be watching this while toggling voice on
  // the screen behind it, and a panel that needed a manual refresh to show
  // anything would read as "the logging is broken too".
  // NOT ALSO ON `visibilitychange`, which was tried and removed: the app logs
  // its own line on every visibility change, so the subscription below already
  // re-reads there, and the extra listener could not be told from nothing.
  useEffect(() => subscribeDiagnostics(() => setEntries(readDiagnosticLog())), []);

  const summary = summariseDiagnostics(entries);
  // MEMOISED, AND ONLY WHEN IT IS NEEDED.
  //
  // This ran on every render, including with the panel collapsed, and the
  // effect above re-renders on EVERY diag event -- so with voice on and
  // Settings open the app rebuilt an ~800KB string per logged line. The log is
  // supposed to cost less than what it measures; formatting it for nobody is
  // the clearest way it did not.
  // ON `shown` ALONE. `copied` was in this condition, and it latches: one
  // Copy and the guard is true for the life of the panel, so the ~800KB
  // rebuild the memo exists to prevent ran on every logged line again, with
  // the panel collapsed and nobody reading it. The failed-clipboard path,
  // which is why `copied` was here, sets `shown` itself.
  const text = useMemo(() => (shown ? formatDiagnosticLog(entries) : ''), [entries, shown]);

  return (
    <CollapsibleSection title={<>Diagnostic log</>} defaultOpen={false}>
      <div className="settings-note-row u-note">
        Everything the app saw during a voice session. Press <strong>Mark</strong>, try a
        session, press <strong>Mark</strong> again, then <strong>Copy</strong>.
        <br />
        <strong>On this device, never uploaded</strong> &mdash; it does contain what the
        microphone heard.
      </div>

      <div className="settings-row">
        <span className="settings-label">Recorded</span>
        <span className="settings-value">
          {summary.total === 0 ? 'nothing yet' : `${summary.total} entries`}
        </span>
      </div>

      {summary.total > 0 && (
        <div className="settings-row">
          <span className="settings-label">Microphone</span>
          <span className="settings-value">
            {summary.micStarts} started, {summary.micEnds} ended, {summary.micErrors} failed
          </span>
        </div>
      )}

      {summary.total > 0 && (
        <div className="settings-row">
          <span className="settings-label">Phrases heard</span>
          <span className="settings-value">{summary.heard}</span>
        </div>
      )}

      <div className="settings-row">
        <button
          type="button"
          className="settings-mini-btn"
          onClick={() => {
            diag('nav', 'operator-mark');
            setEntries(readDiagnosticLog());
          }}
        >
          Mark
        </button>
        <button
          type="button"
          className="settings-mini-btn"
          onClick={() => {
            // RE-READ ON OPENING. Nothing notifies this tab when ANOTHER
            // one logs — the app is deliberately usable as both an installed
            // PWA and a Safari tab, and each flushes to the same storage —
            // so the panel's copy can be arbitrarily old while Copy, which
            // reads storage fresh, produces something longer. One screen
            // giving two different answers is the log arguing with itself.
            if (!shown) setEntries(readDiagnosticLog());
            setShown((v) => !v);
          }}
          disabled={summary.total === 0}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          className="settings-mini-btn"
          onClick={() => {
            // Flush first: up to a second of the most recent events is still
            // sitting in the write buffer, and the most recent second is the
            // one the operator just went to the trouble of producing.
            flushDiagnostics();
            const full = formatDiagnosticLog(readDiagnosticLog());
            const clipboard = navigator.clipboard;
            if (!clipboard?.writeText) {
              // No clipboard (an insecure context, or an older iOS): open the
              // text instead so it can be selected by hand, rather than
              // reporting a success that did not happen.
              setShown(true);
              setCopied('failed');
              return;
            }
            void clipboard
              .writeText(full)
              .then(() => setCopied('ok'))
              .catch(() => {
                setShown(true);
                setCopied('failed');
              });
          }}
          disabled={summary.total === 0}
        >
          {copied === 'ok' ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className="settings-mini-btn"
          onClick={() => {
            clearDiagnosticLog();
            setEntries([]);
            setShown(false);
            setCopied('idle');
          }}
          disabled={summary.total === 0}
        >
          Clear
        </button>
      </div>

      {copied === 'failed' && (
        <div className="settings-note-row u-note">
          This browser would not take the clipboard. The log is shown below &mdash; select
          it and copy by hand.
        </div>
      )}

      {shown && <pre className="car-log">{text}</pre>}
    </CollapsibleSection>
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
    <CollapsibleSection
      title={<>Voice control</>}
      defaultOpen={false}
    >

        <div className="settings-note-row u-note">
          Say <strong>hit</strong>, <strong>stand</strong>, <strong>double</strong>,{' '}
          <strong>split</strong>, <strong>surrender</strong>, <strong>yes</strong>,{' '}
          <strong>no</strong> or <strong>repeat</strong>, then come back and read what it heard.
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
    </CollapsibleSection>
  );
}
