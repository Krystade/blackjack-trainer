import type { Card, Rank } from '../../engine/cards';
import type { MistakeClass } from '../../engine/grade';
import type { RuleSet } from '../../engine/ruleset';
import { dealerBustChance } from '../../engine/dealerOdds';
import { highlightForHand, upcardColumn } from './chartRows';
import { regionRuleFor } from './regionRule';

/**
 * Wave E, E6 (W2-22): the reason line on Play's wrong-play card.
 *
 * The engine's reason for a basic play is "Basic hit vs dealer 7" -- it names
 * the verdict again and teaches nothing. A basic error now reads the chart
 * REGION the hand sits in, as the drill strips do (B7, regionRule.ts), then
 * how often the dealer busts from that up card:
 *
 *   "Hard 12–16 v 7–9: hit. Dealer busts 26% with a 7 up."
 *
 * Screen only. The spoken correction still goes through narrateCorrection on
 * the event's own reason: it is built from Kokoro clips, and a combinatorial
 * rule line has no clip, so it would fall back to the iOS voice.
 *
 * Index errors (missed / phantom / wrong-anyway) keep the engine's index
 * label, which is itself the thing to learn.
 */
export function playMissReason(args: {
  reason: string;
  classification: MistakeClass | undefined;
  /** The hand as it stood when graded (OverlayInfo.cards). */
  cards: Card[] | undefined;
  dealerUp: Rank | undefined;
  /** Whether splitting was legal for THAT decision (OverlayInfo.canSplit). */
  canSplit: boolean | undefined;
  rules: RuleSet;
}): string {
  const { reason, classification, cards, dealerUp, canSplit, rules } = args;
  if (classification !== 'basic-error' || !cards || cards.length === 0 || !dealerUp) return reason;
  const bust = bustLine(dealerUp, rules);
  const cellId = cellIdForPlay(cards, dealerUp, rules, canSplit);
  const rule = cellId === null ? null : regionRuleFor(cellId, rules);
  return rule ? `${rule.text} ${bust}` : bust;
}

/**
 * The cell the engine consulted, in the drills' cell-id form. Routed through
 * highlightForHand, which mirrors strategy.ts: a pair that could not be split
 * (or has no PAIRS row) is read as its total, exactly as it was graded.
 */
function cellIdForPlay(cards: Card[], up: Rank, rules: RuleSet, canSplit: boolean | undefined): string | null {
  const h = highlightForHand(cards, up, rules, { canSplit });
  if (!h) return null;
  const kind = h.section === 'PAIRS' ? 'pair' : h.section === 'SOFT' ? 'soft' : 'hard';
  return `${kind}-${h.row}-v-${h.dealerUp}`;
}

/**
 * "Dealer busts 26% with a 7 up." Peek-conditioned: the table always peeks, so
 * by the time the player acts a ten or ace up has no natural behind it -- the
 * same state handEv prices every decision in.
 */
export function bustLine(up: Rank, rules: RuleSet): string {
  const pct = Math.round(dealerBustChance(up, rules, { excludeBlackjack: true }) * 100);
  // No-break spaces keep "a 7 up." on one line: at 375px the sentence wraps
  // and an orphaned "up." reads as a typo.
  return `Dealer busts ${pct}% with ${upPhrase(up)}${NBSP}up.`;
}

const NBSP = '\u00a0';

function upPhrase(up: Rank): string {
  const col = upcardColumn(up);
  if (col === 'A') return `an${NBSP}ace`;
  if (col === '8') return `an${NBSP}8`;
  return `a${NBSP}${col}`;
}
