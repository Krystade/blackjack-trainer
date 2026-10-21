import { MINUS } from '../drills/signed';
import { money, signedMoney } from './casinoFigures';
import type { AssumedField } from '../store/casinoGameStats';
import type { CasinoGame } from '../store/casinoLog';

/**
 * Wave K: how the ranking and the stats card write the simulator's figures.
 * Pure, pinned by casinoStatsText.test.ts.
 */

/** "+$42/h", "−$9/h". */
export function evHourText(ev: number): string {
  return `${signedMoney(Math.round(ev))}/h`;
}

/** "±$4" (rounded up to a whole dollar, never "±$0" for a real interval). */
export function ciText(ci: number): string {
  if (!Number.isFinite(ci)) return '±?';
  return `±$${Math.max(1, Math.ceil(ci))}`;
}

/** Review S3: a figure with its interval, "−$65 ±$20/h". */
export function evCiText(ev: number, ci: number): string {
  return `${signedMoney(Math.round(ev))} ${ciText(ci)}/h`;
}

/** "0.62%", "−0.18%" (a player edge reads negative). */
export function pctText(fraction: number, digits = 2): string {
  const v = fraction * 100;
  const s = Math.abs(v).toFixed(digits);
  return `${v < 0 && Number(s) !== 0 ? MINUS : ''}${s}%`;
}

/** The house edge with its interval: "0.62% ±0.05%". */
export function edgeText(edge: number, ci: number): string {
  return `${pctText(edge)} ±${Number.isFinite(ci) ? (ci * 100).toFixed(2) : '?'}%`;
}

/** N0 in hours: "120 h", "1.5 h", or "never" with no edge. */
export function n0Text(hours: number | null): string {
  if (hours === null) return 'never';
  if (hours >= 10) return `${Math.round(hours).toLocaleString('en-US')} h`;
  return `${hours.toFixed(1)} h`;
}

/** Risk of ruin: "—" with no bankroll set, "<0.1%", "100%" with no edge. */
export function rorText(ror: number | null): string {
  if (ror === null) return '—';
  if (ror >= 0.9995) return '100%';
  if (ror < 0.001) return '<0.1%';
  return `${(ror * 100).toFixed(ror < 0.1 ? 1 : 0)}%`;
}

export function sdHourText(sd: number): string {
  return `${money(Math.round(sd))}/h`;
}

/** "1.2M", "850k", "4,000". */
export function roundsText(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString('en-US');
}

export const ASSUMED_TEXT: Record<AssumedField, string> = {
  decks: '6 decks',
  s17: 'dealer hits soft 17',
  das: 'no double after split',
  surrender: 'no surrender',
  payout: 'blackjack pays 6:5',
  cut: 'cut 1.5 decks from the end',
  minBet: 'min bet = your profile unit',
  // Wave M
  rsa: 'no resplitting aces',
  doubleSplitAces: 'no doubling split aces',
  maxSplitHands: 'split to 2 hands only',
  doubleOn: 'double on 10-11 only',
  commission: 'commission $1 per $100 (card room)',
};

/**
 * Wave M review S4: the assumed fields that are table RULES the simulator
 * models (everything but the cut and the min bet, which are conditions of the
 * visit). An unlogged rule is simulated at the conservative choice, and that
 * choice can decide a game's place in the ranking (split to 2 + double 10-11
 * alone cost about 0.22% of action), so rows and the stats card say so.
 */
export function assumedRules(assumed: readonly AssumedField[]): AssumedField[] {
  return assumed.filter((a) => a !== 'cut' && a !== 'minBet');
}

/**
 * What each assumed rule can cost, in % of action: the gap between the
 * conservative choice the simulator plays and the best the house could
 * really deal. Standard rules (H17, DAS, 3:2, split to 4), infinite deck,
 * from the app's own engine (engine/variants/ev.ts roundReturn), which gives
 * the published Wizard of Odds figures for the rules both list (S17 0.22, DAS
 * 0.14, RSA 0.08, double 10-11 0.18, hitting split aces 0.19).
 * casinoAssumedEffect.test.ts recomputes every engine figure. Decks: the
 * Wizard's single-deck figure, the most an unknown shoe can be better than six.
 * Doubling split aces is 0.08%, not negligible: a soft double against a weak
 * dealer card on each of two hands, on one round in 169.
 */
export const ASSUMED_EFFECT_PCT: Record<AssumedField, number> = {
  decks: 0.48,
  s17: 0.22,
  das: 0.14,
  surrender: 0.1,
  payout: 1.35,
  rsa: 0.08,
  doubleSplitAces: 0.08,
  maxSplitHands: 0.06,
  doubleOn: 0.18,
  commission: 1,
  // Conditions of the visit, not rules: never flagged as rules.
  cut: 0,
  minBet: 0,
};

/** An assumption worth flagging on a ranking row moves the house edge by at least this, % of action. */
export const MATERIAL_ASSUMED_PCT = 0.05;

/**
 * What this assumption can cost at this game, % of action. A rule that the
 * game's LOGGED rules make moot costs nothing: split aces cannot double where
 * doubling after a split is barred or doubling is 9-11 / 10-11 only (a split
 * ace is soft 12-21), and aces cannot be resplit where the split stops at 2 hands.
 */
export function assumedEffect(field: AssumedField, game: Pick<CasinoGame, 'das' | 'doubleOn' | 'maxSplitHands'>): number {
  if (field === 'doubleSplitAces' && (game.das === false || game.doubleOn === '9-11' || game.doubleOn === '10-11')) return 0;
  if (field === 'rsa' && game.maxSplitHands === 2) return 0;
  return ASSUMED_EFFECT_PCT[field];
}

/**
 * The assumed rules a ranking row flags: the material ones (merge of Wave L
 * and Wave M). The stats card still lists every assumed rule.
 */
export function materialAssumedRules(
  assumed: readonly AssumedField[],
  game: Pick<CasinoGame, 'das' | 'doubleOn' | 'maxSplitHands'>,
  threshold = MATERIAL_ASSUMED_PCT,
): AssumedField[] {
  return assumedRules(assumed).filter((a) => assumedEffect(a, game) >= threshold);
}

/** "1 rule assumed", "3 rules assumed". */
export function assumedRulesBadge(n: number): string {
  return `${n} rule${n === 1 ? '' : 's'} assumed`;
}
