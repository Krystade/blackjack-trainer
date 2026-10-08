import { useEffect, useMemo, useState } from 'react';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { OfflineSection } from './OfflineSection';
import type { Screen } from '../App';
import type { AudioSettings, Settings as SettingsData } from '../../store/types';
import { THEMES, normalizeTheme } from '../theme';
import { aliasProblem, aliasTargets, normaliseAlias } from '../../audio/voiceAliases';
import { saveSettings } from '../../store/persist';
import {
  chime,
  isSpeechSupported,
  listVoices,
  speak,
} from '../../audio';
import {
  setClipVoice,
  loadClipIndex,
  prewarmClips,
  type ClipVoiceInfo,
} from '../../audio/clips';
import { micSessionCostPaid } from '../../audio/micSessionCost';
import { MAX_VOLUME, effectiveVolume } from '../../audio/volume';
import { SHOT_CLOCK_OPTIONS, shotClockLabel } from '../../drills/shotClock';
import {
  readVoiceHistory,
  clearVoiceHistory,
  summariseHistory,
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
  // so it drives clips.ts's module-level clip voice directly on change --
  // see clips.ts's header comment for the full wiring picture.
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
            Voice was used. Recorded lines and alert tones stay on the loud speaker.
            Lines spoken by the phone&rsquo;s own voice may still come from the earpiece.
          </div>
        )}

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

      {/* PLAY AND DRILLS, ONE SECTION. "Drills" used to hold six rows, five of
          them second copies of controls each drill already shows on its own
          setup screen: category on Flashcards; length, group size and speed on
          the count drill; depth resolution on Deck Estimation. The shot clock
          is the one drill setting with no other home. */}
      <CollapsibleSection
        title={<>Play</>}
        defaultOpen={false}
      >
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
          <Stepper
            label="Deal speed"
            value={settings.dealSpeedMs}
            min={0}
            max={1000}
            step={100}
            format={(v) => `${v}ms`}
            onChange={(v) => update({ dealSpeedMs: v })}
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
            A time limit on flashcard and deviation-quiz answers. Running out counts the card
            as missed and puts it back in the review deck.
          </p>
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Audio &mdash; the app speaking</>}
        defaultOpen={false}
      >
          {clipVoices.length > 0 && (
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
          {/* For the lines no recording covers. The automatic pick is a
              heuristic over voice names that once landed on Apple's bleating
              novelty voice (2026-09-29); this is the way out of a bad pick. */}
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
          <div className="settings-note-row u-note">
            Thinking time in an eyes-free drill before the answer is said.
          </div>
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
                chime('good', { volume: effectiveVolume(settings.audio) });
              }}
            >
              Test audio
            </button>
          </div>
      </CollapsibleSection>

      <OfflineSection clipVoice={settings.audio.clipVoice} />

      <CollapsibleSection title={<>Tests</>} defaultOpen={false}>
        <div className="settings-note-row u-note">
          Every test that still has an open question is in the Test kit, grouped by where you
          are: at your desk, in the car with Bluetooth, or in the car without.
        </div>
        <button
          type="button"
          className="u-btn u-btn-primary"
          data-testid="settings-testkit-open"
          onClick={() => onNavigate('testkit')}
        >
          Open the Test kit
        </button>
      </CollapsibleSection>

      <VoiceAliasPanel
        aliases={settings.audio.voiceAliases ?? {}}
        onChange={(voiceAliases) => updateAudio({ voiceAliases })}
      />
      <DiagnosticLogPanel />
    </div>
  );
}

/**
 * Words the operator teaches the app, taken from what it actually misheard.
 *
 * WHY IT IS SEEDED RATHER THAN A BLANK BOX. Jack asked for "a setting where I
 * can put in a bunch of different aliases for the different words just to help
 * so I can say something that's easier for it to pick out." A free-text field
 * would make him guess what the engine returns, and the engine's guesses are
 * not guessable -- his 2026-10-04 log has `heard=Strength`, `heard=Touch`,
 * `heard=Definitely`, `heard="That's for sure"`, none of which anyone would
 * think to type. The app already keeps every rejection, so the list offers
 * them and he says what each one meant. One tap per word, no typing.
 *
 * It is also the only honest way to find out whether any of this helps. The
 * log records what the ENGINE returned and never what was said, so nothing in
 * it can score recognition -- I claimed from those lines that multi-word
 * commands "graded correctly every time" and Jack's reply was "This is
 * straight up wrong", with `heard="That's for sure" verdict=rejected` sitting
 * in the log twice. Binding a rejection to an action is the first record of
 * intent this app has ever had.
 */
function VoiceAliasPanel({
  aliases,
  onChange,
}: {
  aliases: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [entries, setEntries] = useState<HeardEntry[]>(() => readVoiceHistory());
  const [typed, setTyped] = useState('');
  const [target, setTarget] = useState<string>('stand');

  const summary = summariseHistory(entries);
  const bound = (phrase: string) => normaliseAlias(phrase) in aliases;

  // The rejections worth offering: ranked by how often they happened, and
  // only the ones not already taught, so the list shrinks as he works.
  const offers = summary.candidates.filter((c) => !bound(c.heard)).slice(0, 8);

  const add = (phrase: string, action: string) => {
    const key = normaliseAlias(phrase);
    if (!key || aliasProblem(phrase)) return;
    onChange({ ...aliases, [key]: action });
  };

  const remove = (phrase: string) => {
    const next = { ...aliases };
    delete next[phrase];
    onChange(next);
  };

  const typedProblem = typed.trim() ? aliasProblem(typed) : null;
  const taught = Object.entries(aliases);

  return (
    <CollapsibleSection title={<>Teach it your words</>} defaultOpen={false}>
      <div className="settings-note-row u-note">
        When the app mishears a command, tell it what you meant. It listens for
        these on top of the words it already knows.{' '}
        <strong>Two words at most</strong> — longer and it can no longer tell
        your voice from its own.
      </div>

      {offers.length > 0 && (
        <>
          <div className="settings-note-row u-note">
            Heard but not understood, commonest first:
          </div>
          {offers.map((c) => (
            <div className="settings-row" key={c.heard}>
              <span className="settings-label">
                &ldquo;{c.heard}&rdquo; &times;{c.count}
              </span>
              <span className="settings-value">
                <select
                  className="settings-select"
                  aria-label={`What "${c.heard}" meant`}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) add(c.heard, e.target.value);
                  }}
                >
                  <option value="">meant…</option>
                  {aliasTargets().map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          ))}
        </>
      )}

      {/* The typed route stays, for a word he has decided to use BEFORE the
          engine has ever mangled it -- picking a command that survives a car
          is the other half of what he asked for. */}
      <div className="settings-row">
        <span className="settings-label">
          <input
            className="settings-input"
            type="text"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="a word to listen for"
            aria-label="A word to listen for"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </span>
        <span className="settings-value">
          <select
            className="settings-select"
            aria-label="What it should mean"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {aliasTargets().map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="settings-mini-btn"
            disabled={!typed.trim() || typedProblem !== null}
            onClick={() => {
              add(typed, target);
              setTyped('');
            }}
          >
            Add
          </button>
        </span>
      </div>

      {typedProblem && (
        <div className="settings-note-row u-note" role="status">
          {typedProblem}
        </div>
      )}

      {taught.length === 0 ? (
        <div className="settings-note-row u-note">
          Nothing taught yet. Drive with voice on, then come back — whatever it
          failed to understand will be listed above.
        </div>
      ) : (
        taught.map(([phrase, action]) => (
          <div className="settings-row" key={phrase}>
            <span className="settings-label">
              &ldquo;{phrase}&rdquo; means {action}
            </span>
            <span className="settings-value">
              <button
                type="button"
                className="settings-mini-btn"
                onClick={() => remove(phrase)}
              >
                Remove
              </button>
            </span>
          </div>
        ))
      )}

      {/* The only control left over the stored list of what the microphone
          heard (the panel that read it back is gone -- every phrase is in the
          diagnostic log too). Forgetting it empties the offers above, and is
          the privacy half: it is a record of what an open microphone heard. */}
      <div className="settings-row">
        <button
          type="button"
          className="settings-mini-btn"
          onClick={() => setEntries(readVoiceHistory())}
        >
          Refresh what it heard
        </button>
        <button
          type="button"
          className="settings-mini-btn"
          onClick={() => {
            clearVoiceHistory();
            setEntries([]);
          }}
          disabled={entries.length === 0}
        >
          Forget what it heard
        </button>
      </div>
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
