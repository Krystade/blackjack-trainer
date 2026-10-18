/**
 * G2 (L-8): what Play says about the dealer's mistakes and the Foul call.
 * The engine (engine/dealerErrors.ts) decides; this only words it.
 */
import { toDealerMistakesMode } from '../engine/dealerErrors';
import type { DealerError, DealerErrorTally, DealerMistakesMode } from '../engine/dealerErrors';
import type { FoulVerdict } from '../engine/game';
import type { Settings, Stats } from '../store/types';

type SessionRow = Stats['sessions'][number];

type MistakesSettings = Pick<Settings, 'dealerMistakes' | 'dealerMistakesMode'>;

/**
 * Wave I: the saved setting. `dealerMistakesMode` when set; otherwise a G2
 * save's boolean, where true was the one rate there was ('occasional').
 */
export function dealerMistakesSetting(settings: MistakesSettings): DealerMistakesMode {
  const mode = settings.dealerMistakesMode;
  if (mode === 'off' || mode === 'occasional' || mode === 'training') return mode;
  return toDealerMistakesMode(settings.dealerMistakes === true);
}

/** The patch the Play sheet writes: the mode, and the G2 boolean kept in step. */
export function dealerMistakesPatch(mode: DealerMistakesMode): Pick<Settings, 'dealerMistakes' | 'dealerMistakesMode'> {
  return { dealerMistakesMode: mode, dealerMistakes: mode !== 'off' };
}

/** The mode Play deals with: the setting, forced off eyes-free. */
export function dealerMistakesModeIn(settings: MistakesSettings, eyesFree: boolean): DealerMistakesMode {
  return eyesFree ? 'off' : dealerMistakesSetting(settings);
}

/** The setting, forced off eyes-free: a payout nobody is looking at cannot be called. */
export function dealerMistakesOn(settings: MistakesSettings, eyesFree: boolean): boolean {
  return dealerMistakesModeIn(settings, eyesFree) !== 'off';
}

/** The session report's label for a Training session, like Hot shoe's. */
export const DEALER_TRAINING_REPORT =
  'Dealer mistakes training: about one round in 5 had a payout error on purpose. Missed errors stay in your bankroll.';

/** "overpaid your win by 1 unit" -- after "The dealer ". */
export function dealerErrorWords(e: Pick<DealerError, 'kind'>): string {
  switch (e.kind) {
    case 'overpay':
      return 'overpaid your win by 1 unit';
    case 'underpay':
      return 'underpaid your win by 1 unit';
    case 'pay-push':
      return 'paid your push as a win';
    case 'take-win':
      return 'took your winning hand';
  }
}

/** The strip after Foul is called. */
export function foulVerdictText(v: FoulVerdict): string {
  if (v.correct && v.error) return `Foul called. The dealer ${dealerErrorWords(v.error)}. Payout corrected.`;
  return 'No foul: that payout was right.';
}

/** The strip on the round after an error nobody called. */
export function missedErrorText(e: Pick<DealerError, 'kind'>): string {
  return `Missed: last hand the dealer ${dealerErrorWords(e)}.`;
}

/** "2/3" -- caught of made. */
export function caughtFraction(t: Pick<DealerErrorTally, 'made' | 'caught'>): string {
  return `${t.caught}/${t.made}`;
}

/** The report's and Stats' value: "2/3", plus " · 1 false call" when there were any. */
export function dealerErrorsValue(t: Pick<DealerErrorTally, 'made' | 'caught' | 'falseCalls'>): string {
  const calls = t.falseCalls > 0 ? ` · ${t.falseCalls} false ${t.falseCalls === 1 ? 'call' : 'calls'}` : '';
  return `${caughtFraction(t)}${calls}`;
}

/**
 * The session row's fields, or nothing for a session played with the setting
 * off. Wave I: `dealerMistakesTraining` when some round was dealt on Training.
 */
export function sessionDealerErrors(
  t: DealerErrorTally,
  used: boolean,
  training = false,
):
  | {
      dealerErrors: { made: number; caught: number; falseCalls: number };
      dealerMistakesTraining?: true;
    }
  | Record<string, never> {
  if (!used && t.made === 0 && t.falseCalls === 0) return {};
  return {
    dealerErrors: { made: t.made, caught: t.caught, falseCalls: t.falseCalls },
    ...(training ? { dealerMistakesTraining: true as const } : {}),
  };
}

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/** Pooled over the rows that played with Dealer mistakes on; null when none did. */
export function sessionsDealerErrors(
  rows: readonly SessionRow[],
): { made: number; caught: number; falseCalls: number } | null {
  let any = false;
  const t = { made: 0, caught: 0, falseCalls: 0 };
  for (const r of rows) {
    if (!r.dealerErrors) continue;
    any = true;
    t.made += count(r.dealerErrors.made);
    t.caught += count(r.dealerErrors.caught);
    t.falseCalls += count(r.dealerErrors.falseCalls);
  }
  return any ? t : null;
}
