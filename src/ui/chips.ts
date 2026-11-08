import type { PlayerHand } from '../engine/game';
import type { Profile, Settings } from '../store/types';
import { money } from './casinoFigures';

/**
 * TRACK 3: UNITS FIRST, CHIPS AS A TOGGLE (2026-11-07).
 *
 * Bets are learned in units. "Show chips" (Settings.showChips, drawn in the
 * profile's Bankroll section) turns Play's bets and the Bet sizing drill into
 * dollars and casino chips at the profile's dollar value of a unit: what a
 * bet looks like in the circle, what a 3:2 natural pays ($187.50 on $125),
 * and how much to pull back before the next bet.
 *
 * Pure: the components (ChipStack, BetCircle) only draw what this says.
 */

/** Chip values, high to low. 0.5 is the half-dollar coin a dealer pays a $1 natural with. */
export const CHIP_DENOMS = [1000, 500, 100, 25, 5, 2.5, 1, 0.5] as const;
export type ChipDenom = (typeof CHIP_DENOMS)[number];

/** The dollar value of a unit when the profile sets none (casinoGameStats' FALLBACK_UNIT). */
export const CHIP_FALLBACK_UNIT = 25;

export interface ChipMoney {
  /** Dollars per unit. */
  unit: number;
}

/** Chips on, at the profile's unit; null with chips off (the units view). */
export function chipMoney(settings: Pick<Settings, 'showChips'>, profile: Pick<Profile, 'unitDollars'>): ChipMoney | null {
  if (settings.showChips !== true) return null;
  const u = profile.unitDollars;
  return { unit: typeof u === 'number' && Number.isFinite(u) && u > 0 ? u : CHIP_FALLBACK_UNIT };
}

export interface ChipCount {
  denom: ChipDenom;
  count: number;
}

/**
 * The chips a dealer would stack for `dollars`: the fewest of the standard
 * chips for the whole dollars, and a half dollar paid as a pink $2.50 (two
 * of the dollars with it) when there are dollars to take it from, else as a
 * half-dollar coin. So $187.50 is a black, three greens, two reds and a pink.
 * Cents under a half dollar are not drawn (the label stays exact).
 */
export function chipBreakdown(dollars: number): ChipCount[] {
  if (!Number.isFinite(dollars) || dollars <= 0) return [];
  const halves = Math.floor(Math.round(dollars * 100) / 50);
  let whole = Math.floor(halves / 2);
  const out: ChipCount[] = [];
  let pink = 0;
  let coin = 0;
  if (halves % 2 === 1) {
    if (whole >= 2) {
      pink = 1;
      whole -= 2;
    } else {
      coin = 1;
    }
  }
  for (const d of [1000, 500, 100, 25, 5] as const) {
    const n = Math.floor(whole / d);
    if (n > 0) out.push({ denom: d, count: n });
    whole -= n * d;
  }
  if (pink) out.push({ denom: 2.5, count: 1 });
  if (whole > 0) out.push({ denom: 1, count: whole });
  if (coin) out.push({ denom: 0.5, count: 1 });
  return out;
}

/** What a chip's face says: "1k", "100", "2½", "½". */
export function chipFaceLabel(d: ChipDenom): string {
  if (d === 1000) return '1k';
  if (d === 2.5) return '2½';
  if (d === 0.5) return '½';
  return String(d);
}

/** The colour family a stack shows, by its highest chip: "100" for a black-topped stack. */
export function topDenom(dollars: number): ChipDenom | null {
  return chipBreakdown(dollars)[0]?.denom ?? null;
}

/** "$25", "$187.50", "$2,537.50", "−$100" (casinoFigures.money). */
export const dollars = money;

/** A chip button's face: "$25", "$300", "$1.2k". */
export function shortDollars(d: number): string {
  if (Math.abs(d) < 1000) return money(d);
  const k = Math.round(Math.abs(d) / 100) / 10;
  return `${d < 0 ? '−' : ''}$${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

export interface CircleView {
  /** What was riding on the hand: the bet, doubled when doubled. */
  stake: number;
  /** What the dealer paid beside it (wins); 0 otherwise. */
  paid: number;
  /** What stays in the circle for the player to take: the stake back (win, push), half (surrender), nothing (loss). */
  back: number;
  /** Before the result: the hand is still in play. */
  live: boolean;
}

/** One hand's circle, in dollars, from its bet and (once settled) its net. A dealer's mispay shows as paid. */
export function circleAfter(hand: Pick<PlayerHand, 'bet' | 'doubled' | 'result' | 'net'>, unit: number): CircleView {
  const stake = hand.bet * (hand.doubled ? 2 : 1) * unit;
  if (hand.result === undefined || hand.net === undefined) return { stake, paid: 0, back: stake, live: true };
  const net = hand.net * unit;
  if (net > 0) return { stake, paid: net, back: stake, live: false };
  return { stake, paid: 0, back: Math.max(0, stake + net), live: false };
}

/** Everything left on the felt for the player after a round: stakes back plus payouts. */
export function onFeltAfter(hands: readonly Pick<PlayerHand, 'bet' | 'doubled' | 'result' | 'net'>[], unit: number): number {
  return hands.reduce((sum, h) => {
    const c = circleAfter(h, unit);
    return sum + (c.live ? 0 : c.back + c.paid);
  }, 0);
}

/**
 * Between rounds: "On the felt $312.50 · next bet $100 · pull back $212.50"
 * (or "· add $25"); null when there is nothing on the felt or it is already
 * the next bet.
 */
export function pullBackLine(onFelt: number, nextBet: number): string | null {
  if (!(onFelt > 0)) return null;
  const diff = Math.round((onFelt - nextBet) * 100) / 100;
  if (diff === 0) return null;
  const move = diff > 0 ? `pull back ${money(diff)}` : `add ${money(-diff)}`;
  return `On the felt ${money(onFelt)} · next bet ${money(nextBet)} · ${move}`;
}

/** The profile editor's note under the toggle. */
export function showChipsNote(unitDollars: number | undefined): string {
  const set = typeof unitDollars === 'number' && Number.isFinite(unitDollars) && unitDollars > 0;
  const at = set ? `${money(unitDollars)} a unit` : `${money(CHIP_FALLBACK_UNIT)} a unit until you set $ per unit`;
  return `Bets stay in units. On, Play and Bet sizing show dollars and casino chips at ${at}. Applies to every profile.`;
}
