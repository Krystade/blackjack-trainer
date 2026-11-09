import { useState } from 'react';
import type { Profile, Settings } from '../../store/types';
import { RUNG_LABELS, rungDone, type Ladder } from './nextStep';
import {
  CHECK_LABELS,
  checksShown,
  isPlayCheck,
  playCheckOnPatch,
  tableCheckOnPatch,
  type CheckKey,
  type PlayCheckKey,
} from '../whatToCheck';
import { answerSuggestion, loadOnboarding, patchOnboarding, type Onboarding, type SuggestRung } from '../../store/onboarding';
import { useTabSettings } from '../tabSettingsContext';
import './switchSuggestion.css';

/**
 * T1-1B: Home's nudge to the next What-to-check switch, a slim inline card
 * under the ladder (never a modal: Home is passed round a table too).
 *
 * Two shapes:
 * - after the beginner-Play migration, ONE card listing the switches it closed
 *   that were on before, one tap each to turn back on;
 * - for everyone else, "You passed {rung}. Turn on {switch} in Play?", once
 *   per rung, in ladder order.
 */

export const SUGGEST_ORDER: readonly { rung: SuggestRung; check: PlayCheckKey }[] = [
  { rung: 'count', check: 'count' },
  { rung: 'deviations', check: 'deviations' },
  { rung: 'betramp', check: 'bets' },
];

/** The first rung passed whose switch is off and not yet answered, or null. */
export function pendingSuggestion(
  ladder: Pick<Ladder, 'rungs'>,
  shown: Record<CheckKey, boolean>,
  onboarding: Onboarding,
): { rung: SuggestRung; check: PlayCheckKey } | null {
  // The migration's card stands in for these: it already named every switch.
  if (onboarding.migratedOff !== undefined) return null;
  for (const s of SUGGEST_ORDER) {
    const r = ladder.rungs.find((x) => x.id === s.rung);
    if (!r || !rungDone(r)) continue;
    if (shown[s.check]) continue;
    if (onboarding.suggestions?.[s.rung] !== undefined) continue;
    return s;
  }
  return null;
}

/** The migrated switches still off, in the gear's order; empty once dismissed. */
export function migratedStillOff(shown: Record<CheckKey, boolean>, onboarding: Onboarding): CheckKey[] {
  if (onboarding.migratedOffDismissed) return [];
  return (onboarding.migratedOff ?? []).filter((k) => !shown[k]);
}

export function SwitchSuggestion({
  ladder,
  activeProfile,
  settings,
  onSettingsChange,
}: {
  ladder: Ladder;
  activeProfile: Profile;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}) {
  const ctx = useTabSettings();
  const [ob, setOb] = useState<Onboarding>(() => loadOnboarding());
  const shown = checksShown(activeProfile, settings);

  const turnOn = (key: CheckKey) => {
    if (isPlayCheck(key)) ctx?.applyProfile(playCheckOnPatch(key, activeProfile));
    else onSettingsChange({ ...settings, ...tableCheckOnPatch(key, settings) });
  };

  const back = migratedStillOff(shown, ob);
  if (back.length > 0) {
    return (
      <section className="switch-suggest" aria-label="Play's checks" data-testid="migrated-off-card">
        <p className="switch-suggest-text">
          Play now checks basic strategy only. Turn back on:
        </p>
        <div className="switch-suggest-actions">
          {back.map((k) => (
            <button key={k} type="button" className="u-btn switch-suggest-on" data-check={k} onClick={() => turnOn(k)}>
              {CHECK_LABELS[k]}
            </button>
          ))}
          <button
            type="button"
            className="u-btn switch-suggest-later"
            onClick={() => setOb(patchOnboarding({ migratedOffDismissed: true }))}
          >
            Not now
          </button>
        </div>
      </section>
    );
  }

  const s = pendingSuggestion(ladder, shown, ob);
  if (!s) return null;
  return (
    <section className="switch-suggest" aria-label="Next switch" data-testid="switch-suggestion" data-rung={s.rung}>
      <p className="switch-suggest-text">
        You passed {RUNG_LABELS[s.rung].toLowerCase()}. Turn on {CHECK_LABELS[s.check]} in Play?
      </p>
      <div className="switch-suggest-actions">
        <button
          type="button"
          className="u-btn switch-suggest-on"
          onClick={() => {
            setOb(answerSuggestion(s.rung, 'on'));
            turnOn(s.check);
          }}
        >
          Turn on
        </button>
        <button
          type="button"
          className="u-btn switch-suggest-later"
          onClick={() => setOb(answerSuggestion(s.rung, 'dismissed'))}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
