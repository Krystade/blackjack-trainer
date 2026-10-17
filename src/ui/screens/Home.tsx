import type { Screen } from '../App';
import type { Profile, Settings } from '../../store/types';
import { loadStats, saveSettings } from '../../store/persist';
import { readiness, weakestCategories } from './readiness';
import { buildLabel, formatBuiltAt, runningBuildId, runningBuiltAt } from '../../updateCheck';
import { CATEGORY_LABELS } from './categoryLabels';
import { pctOfPercent } from './statsFormat';
import { masterySweepDone, nextStep } from './nextStep';
import { loadMasteryRun } from '../../drills/masteryChallenge';
import { launchSettings, setDrillLaunch } from '../drillLaunch';
import { strategyRulesFor } from '../../store/profiles';
import { CATEGORY_TARGET, MIN_CATEGORY_ANSWERS, goalPct, pctDown } from './handProgress';
import './nextStep.css';

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
  const stats = loadStats();
  // F11: the index set the active profile is graded on (S17, Fab 4).
  const gradedRules = strategyRulesFor(activeProfile);
  const r = readiness(stats, gradedRules);
  const weak = weakestCategories(stats);
  // #28: one recommendation, with its reason.
  const step = nextStep(stats, {
    sweepDone: (stats.masterySweepsCompleted ?? 0) > 0 || masterySweepDone(loadMasteryRun()),
    rules: gradedRules,
  });
  const openStep = () => {
    if (step.kind === 'play') {
      onNavigate('table');
      return;
    }
    // F21 / s07: the drill opens on the hand type the step names, and on the
    // chart rather than a leftover Custom deck. Persisted and lifted before
    // Drills mounts, so its first render already has them.
    const next = launchSettings(step.kind, step.scope, settings);
    if (next !== settings) {
      saveSettings(next);
      onSettingsChange(next);
    }
    setDrillLaunch(step.kind);
    onNavigate('drills');
  };
  // s02: once hard, soft and pairs all meet the goal, the card says so
  // instead of listing three ticks on every later step.
  const basicMet = step.progress?.every((c) => c.onTarget) ?? false;

  return (
    <div className="home-screen">
      <header className="home-head">
        <h1 className="home-title">Blackjack Trainer</h1>
        <button
          type="button"
          className="home-profile-chip"
          title="Switch or edit profiles"
          onClick={() => onNavigate('profiles')}
        >
          {activeProfile.name}
        </button>
      </header>

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
              {r.indicesKnown}/{r.indicesTotal}
            </span>
            <span className="readiness-label">indices seen</span>
          </div>
        </div>

        {r.decisions === 0 ? (
          <p className="u-note">
            Nothing answered yet. Start with the next step below.
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

        <button type="button" className="home-stats-link" onClick={() => onNavigate('stats')}>
          All stats
        </button>
      </section>

      <section className="next-step" aria-label="Next step" data-step={step.kind}>
        <span className="readiness-label">Next step</span>
        <h2 className="next-step-title">{step.title}</h2>
        <p className="next-step-why">{step.why}</p>
        {/* s02: progress on each category, and a tick once its goal is met,
            beside Start so the card still fits the 812px fold. Once all
            three are met, one line confirms it. */}
        <div className="next-step-foot">
          {basicMet && step.progress && (
            <p className="next-step-goal-met" data-testid="basic-goal-met">
              <span aria-hidden="true">✓ </span>
              Basic strategy goal met ({step.progress
                .map((c) => `${c.scope} ${goalPct(c.pct)}`)
                .join(', ')})
            </p>
          )}
          {!basicMet && step.progress && (
            <ul className="next-step-progress" aria-label="Basic strategy progress">
              {step.progress.map((c) => (
                <li
                  key={c.prefix}
                  className="next-step-progress-row"
                  data-hand={c.prefix}
                  data-on-target={c.onTarget ? 'true' : 'false'}
                >
                  <span className="next-step-progress-label">{c.label}</span>
                  <span className="next-step-progress-value">
                    {c.thin
                      ? `${c.n}/${MIN_CATEGORY_ANSWERS} answers`
                      : c.onTarget
                        ? `✓ ${goalPct(c.pct)}`
                        : `${goalPct(c.pct)} (goal ${pctDown(CATEGORY_TARGET)})`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* W13: the one gold primary on Home. */}
          <button type="button" className="u-btn u-btn-primary next-step-btn" onClick={openStep}>
            Start
          </button>
        </div>
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
