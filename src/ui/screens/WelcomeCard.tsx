import type { Profile } from '../../store/types';
import { patchOnboarding, type WelcomeChoice } from '../../store/onboarding';
import type { RungId } from './nextStep';
import { playCheckOnPatch, type PlayCheckKey } from '../whatToCheck';
import { useTabSettings } from '../tabSettingsContext';
import './welcomeCard.css';

/**
 * Track 1 (1C): the first-launch question, a card at the top of Home -- not a
 * modal, and not in place of Next step (a phone passed round, a spec on fresh
 * storage: nothing is blocked). Answering moves the ladder's start; it never
 * marks a rung passed.
 */

const CHOICES: readonly { choice: Exclude<WelcomeChoice, 'skipped'>; label: string; note: string; start?: RungId }[] = [
  { choice: 'new', label: 'New to blackjack', note: 'Start with the basic strategy chart.' },
  { choice: 'basic', label: 'I know basic strategy', note: 'Skip ahead to counting.', start: 'count' },
  { choice: 'counter', label: 'I count already', note: 'Skip to deviations; Play checks your count and bets.', start: 'deviations' },
];

const COUNTER_CHECKS: readonly PlayCheckKey[] = ['count', 'deviations', 'bets'];

/** "I count already": Count checks, Deviations and Bet checks on, as one profile patch. */
export function counterPatch(profile: Profile): Partial<Profile> {
  let patch: Partial<Profile> = {};
  for (const k of COUNTER_CHECKS) patch = { ...patch, ...playCheckOnPatch(k, { ...profile, ...patch }) };
  return patch;
}

export function WelcomeCard({ activeProfile, onChosen }: { activeProfile: Profile; onChosen: () => void }) {
  const ctx = useTabSettings();
  const choose = (choice: WelcomeChoice, start?: RungId) => {
    patchOnboarding(start ? { welcome: choice, startRung: start } : { welcome: choice });
    if (choice === 'counter') ctx?.applyProfile(counterPatch(activeProfile));
    onChosen();
  };
  return (
    <section className="welcome-card" aria-labelledby="welcome-title" data-testid="welcome-card">
      <h2 className="welcome-title" id="welcome-title">
        Welcome
      </h2>
      <p className="welcome-ask">Where are you starting from?</p>
      <div className="welcome-choices">
        {CHOICES.map((c) => (
          <button key={c.choice} type="button" className="welcome-choice" data-choice={c.choice} onClick={() => choose(c.choice, c.start)}>
            <span className="welcome-choice-label">{c.label}</span>
            <span className="welcome-choice-note">{c.note}</span>
          </button>
        ))}
      </div>
      <button type="button" className="welcome-skip" onClick={() => choose('skipped')}>
        Skip
      </button>
    </section>
  );
}
