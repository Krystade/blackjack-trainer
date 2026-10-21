import type { Screen } from '../App';
import type { Profile, Settings } from '../../store/types';
import { loadStats, saveSettings } from '../../store/persist';
import { readiness, weakestCategories } from './readiness';
import { buildLabel, formatBuiltAt, runningBuildId, runningBuiltAt } from '../../updateCheck';
import { CATEGORY_LABELS } from './categoryLabels';
import { pctOfPercent } from './statsFormat';
import { ladder as buildLadder, masterySweepDone } from './nextStep';
import type { NextStep, StartTarget } from './nextStep';
import { loadMasteryRun } from '../../drills/masteryChallenge';
import { launchSettings, reviewIndexesLaunch, reviewLaunch, setDrillLaunch, weakCellsLaunch } from '../drillLaunch';
import { loadFlashSr, loadQuizSr } from '../../drills/gradeAnswer';
import { LadderCard } from './LadderCard';
import { strategyRulesFor } from '../../store/profiles';
import './nextStep.css';
import { driveTarget, setDriveAutoStart } from '../driveLaunch';
import { setEyesFreeOn } from '../eyesFreeSession';
import { setVoiceOn } from '../voiceSession';
import { speak } from '../../audio/speech';
import { speechOptsFrom } from '../../audio/speechOpts';
import { withAudioEnabled } from '../audioGate';
import { useDayTick } from '../useDayTick';
import { StreakCard } from '../components/StreakCard';

interface HomeProps {
  onNavigate: (screen: Screen) => void;
  activeProfile: Profile;
  /** F21: the live settings, so Start can open the drill on what Next step names. */
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

/** F23: never rounds 99.6% up to 100% (statsFormat). */
const pct = pctOfPercent;

function secs(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Home as a dashboard (C4).
 *
 * It used to be five big buttons — a menu the bottom tab bar now renders
 * redundant. Freed of navigation, the launch screen can do the job only it
 * can: answer "am I ready?" before you decide what to practise, and name the
 * hands you are actually worst at rather than a single blended percentage.
 *
 * Stats has its own tab since #32, and the summary still links to it. Home
 * is also where the global Settings screen is reached from now that it has
 * left the tab bar (#32): the per-tab settings sit behind each tab's gear.
 */
export function Home({ onNavigate, activeProfile, settings, onSettingsChange }: HomeProps) {
  // H8: re-render at local midnight and on return, so the 7-day line and the
  // ladder's due dates follow the clock while the app stays open.
  useDayTick();
  const stats = loadStats();
  // F11: the index set the active profile is graded on (S17, Fab 4).
  const gradedRules = strategyRulesFor(activeProfile);
  const r = readiness(stats, gradedRules);
  const weak = weakestCategories(stats);
  // #28 / B2: the seven-rung ladder, and the one step it recommends.
  const ladder = buildLadder(stats, {
    sweepDone: (stats.masterySweepsCompleted ?? 0) > 0 || masterySweepDone(loadMasteryRun()),
    rules: gradedRules,
    flashSr: loadFlashSr(),
    quizSr: loadQuizSr(),
    now: Date.now(),
  });
  const step = ladder.step;
  const openStep = (t: StartTarget & Pick<NextStep, 'reviewCells' | 'reviewIndexes'>) => {
    if (t.kind === 'play') {
      onNavigate('table');
      return;
    }
    // F21 / s07: the drill opens on the hand type the step names, and on the
    // chart rather than a leftover Custom deck. Persisted and lifted before
    // Drills mounts, so its first render already has them. B2 Review (Task 4
    // ruling): the due cells go over in memory and the settings come back
    // unchanged, so the saved Custom deck survives the review. Wave B2 #38:
    // an index review hands its due indexes to the quiz the same way.
    // Wave B2 #43: "Fix weak cells" starts Flashcards on the Auto-filled
    // Custom deck rather than opening the editor.
    const next = t.reviewCells
      ? reviewLaunch(settings, t.reviewCells)
      : t.reviewIndexes
        ? reviewIndexesLaunch(settings, t.reviewIndexes)
        : t.kind === 'custom'
          ? weakCellsLaunch(settings, stats.cellStats)
          : launchSettings(t.kind, t.scope, settings);
    if (next !== settings) {
      saveSettings(next);
      onSettingsChange(next);
    }
    setDrillLaunch(t.kind === 'custom' ? 'flash' : t.kind);
    onNavigate('drills');
  };

  /**
   * C-R3 (W10): Drive. The tap IS the audio-unlock gesture, so the first line
   * is spoken here, synchronously, inside it -- protected, so the drill that
   * mounts a moment later queues its own opening line behind it instead of
   * cutting it off. Eyes-free on, voice as it was, and the drill starts itself.
   */
  const drive = driveTarget(settings);
  const startDrive = () => {
    if (!drive) return;
    const next = settings.audio.enabled ? settings : withAudioEnabled(settings);
    if (next !== settings) {
      saveSettings(next);
      onSettingsChange(next);
    }
    setEyesFreeOn(true, 'home-drive');
    setVoiceOn(drive.voice, 'home-drive');
    speak(`${drive.label}.`, { ...speechOptsFrom(next.audio, { interrupt: true }), protect: true });
    setDriveAutoStart();
    setDrillLaunch(drive.mode);
    onNavigate('drills');
  };

  return (
    <div className="home-screen">
      <header className="home-head">
        {/* Wave I: one row at 320 and 375. The tail drops first on a narrow
            phone (layoutFit.css); the text stays whole for screen readers. */}
        <h1 className="home-title">
          Blackjack<span className="home-title-tail"> Trainer</span>
        </h1>
        {/* One line, ellipsised when it must be. The clip is visual only:
            the text (the accessible name) and the tooltip keep the whole name. */}
        <button
          type="button"
          className="home-profile-chip"
          title={`${activeProfile.name}: switch or edit profiles`}
          onClick={() => onNavigate('profiles')}
        >
          <span className="home-profile-chip-name">{activeProfile.name}</span>
        </button>
      </header>

      {/* Wave N: the streak card, above everything else. */}
      <StreakCard settings={settings} onOpen={() => onNavigate('progress')} />

      {/* B2: the ladder first, so Start sits above the fold. */}
      <LadderCard
        ladder={ladder}
        onStart={openStep}
        drive={drive ? { label: drive.label, onDrive: startDrive } : undefined}
      />

      <section className="readiness" aria-label="Readiness">
        <div className="readiness-figures">
          <div className="readiness-stat">
            <span className="readiness-value">{pct(r.accuracyPct)}</span>
            <span className="readiness-label">accuracy</span>
          </div>
          <div className="readiness-stat">
            <span className="readiness-value">{secs(r.medianMs)}</span>
            <span className="readiness-label">median decision time</span>
          </div>
          <div className="readiness-stat">
            <span className="readiness-value">
              {r.indicesPractised}/{r.indicesTotal}
            </span>
            {/* Wave B2 #10: the ladder's own figure and word. */}
            <span className="readiness-label">indices practised</span>
          </div>
        </div>

        {r.decisions === 0 && r.indexAnswers === 0 ? (
          <p className="u-note">
            Nothing answered yet. Start with the next step above.
          </p>
        ) : r.decisions === 0 ? (
          // H1 fix round: index answers are not graded decisions, but they
          // are answers -- "Nothing answered yet" beside "1/17 indices
          // practised" was false.
          <p className="u-note" data-testid="readiness-index-only">
            No basic-strategy decisions graded yet · {r.indexAnswers} index{' '}
            {r.indexAnswers === 1 ? 'answer' : 'answers'}
          </p>
        ) : (
          <p className="u-note">
            {r.decisions} decisions graded
            {weak.length > 0 && (
              <> · weakest: {weak
                  .map((w) => (CATEGORY_LABELS[w as keyof typeof CATEGORY_LABELS] ?? w).toLowerCase())
                  .join(', ')}</>
            )}
          </p>
        )}

        {/* Wave N: F10's "Practised N of the last 7 days" line is gone; the
            streak card's week dots above say it. */}

        <button type="button" className="home-stats-link" onClick={() => onNavigate('stats')}>
          All stats
        </button>
      </section>


      {/* Play, and Settings (which has no tab). Drills and
          Charts are one tap away in the tab bar, and repeating them would
          make Home a menu again -- the exact thing the tab bar replaces. */}
      <div className="home-actions">
        {/* W13: secondary to Next step, and gone when Next step is the shoe
            itself -- two buttons for the same thing compete. */}
        {step.kind !== 'play' && (
          <button type="button" className="u-btn home-play-btn" onClick={() => onNavigate('table')}>
            Play a shoe
          </button>
        )}
        {/* #32: Settings left the tab bar. The accessible name is exactly
            "Settings" -- the glyph is decoration. */}
        <button type="button" className="u-btn home-settings-btn" onClick={() => onNavigate('settings')}>
          <span aria-hidden="true">⚙ </span>Settings
        </button>
      </div>

      {/* The installed app can sit on a cached bundle without saying so. This
          is the one place to check that a deploy actually landed: it is the
          same string version.json carries. */}
      <p className="home-build" data-build={runningBuildId() ?? ''} data-built-at={runningBuiltAt() ?? ''}>
        build {buildLabel()}
        {formatBuiltAt() && <span className="home-build-at">{formatBuiltAt()}</span>}
      </p>
      {/* Diagnostics, not play: a small link under the build line rather
          than a second full-width button beside "Play a shoe". */}
      <button type="button" className="home-testkit-link" data-testid="testkit-open" onClick={() => onNavigate('testkit')}>
        Test kit
      </button>
    </div>
  );
}
