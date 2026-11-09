import { getStorage } from './persist';
import type { CheckKey } from '../ui/whatToCheck';

/**
 * T1-1B: first-run and suggestion choices, one small blob
 * (`bjtrainer.onboarding.v1`). Backed up and synced across tabs: a choice
 * made once should not be offered again anywhere.
 *
 * - `suggestions`: Home's "You passed X. Turn on Y in Play?" -- answered once
 *   per rung, 'on' or 'dismissed'.
 * - `migratedOff`: the switches the beginner-Play migration closed where the
 *   profile had the finer value on (Home's "turn back on" card). Emptied as
 *   each is turned back on; an empty list (or `migratedOffDismissed`) hides it.
 */

export const ONBOARDING_KEY = 'bjtrainer.onboarding.v1';

export type SuggestRung = 'count' | 'deviations' | 'betramp';
export type SuggestAnswer = 'on' | 'dismissed';

export interface Onboarding {
  suggestions?: Partial<Record<SuggestRung, SuggestAnswer>>;
  migratedOff?: CheckKey[];
  migratedOffDismissed?: true;
}

const RUNGS: readonly SuggestRung[] = ['count', 'deviations', 'betramp'];
const CHECKS: readonly CheckKey[] = ['count', 'deviations', 'bets', 'dealerMistakes', 'distractions'];

/** Whatever is readable, nothing else: an unknown value is dropped, never trusted. */
export function normalizeOnboarding(raw: unknown): Onboarding {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Onboarding = {};
  if (r.suggestions && typeof r.suggestions === 'object') {
    const s: Partial<Record<SuggestRung, SuggestAnswer>> = {};
    for (const k of RUNGS) {
      const v = (r.suggestions as Record<string, unknown>)[k];
      if (v === 'on' || v === 'dismissed') s[k] = v;
    }
    out.suggestions = s;
  }
  if (Array.isArray(r.migratedOff)) {
    out.migratedOff = r.migratedOff.filter((k): k is CheckKey => CHECKS.includes(k as CheckKey));
  }
  if (r.migratedOffDismissed === true) out.migratedOffDismissed = true;
  return out;
}

export function loadOnboarding(): Onboarding {
  try {
    const raw = getStorage().getItem(ONBOARDING_KEY);
    return raw ? normalizeOnboarding(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Read-modify-write, so two writers of different fields never undo each other. */
export function patchOnboarding(patch: Partial<Onboarding>): Onboarding {
  const next = { ...loadOnboarding(), ...patch };
  try {
    getStorage().setItem(ONBOARDING_KEY, JSON.stringify(next));
  } catch {
    /* full storage: the card is offered again next time, nothing worse */
  }
  return next;
}

export function answerSuggestion(rung: SuggestRung, answer: SuggestAnswer): Onboarding {
  const cur = loadOnboarding();
  return patchOnboarding({ suggestions: { ...cur.suggestions, [rung]: answer } });
}
