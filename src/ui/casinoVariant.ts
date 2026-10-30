/**
 * Wave L (review S3): a variant casino game's flat house edge, with the game's
 * logged payout applied where the app has the figure, and the logged rules
 * that do not match the variant preset named rather than buried.
 */

import type { Casino, CasinoGame } from '../store/casinoLog';
import { ASSUMED_COMMISSION_PER_100 } from '../store/casinoGameStats';
import { PRESETS, PRESET_LABEL } from '../engine/variants/rules';
import type { PresetId } from '../engine/variants/rules';
import { presetData } from '../engine/variants/strategy';

export interface VariantEdge {
  /** Percent. */
  edge: number;
  /** What the figure assumes about blackjack's payout, as shown. */
  payout: string;
}

export function variantEdgeFor(game: Pick<CasinoGame, 'payout'>, preset: PresetId): VariantEdge {
  const data = presetData(preset);
  const rules = PRESETS[preset];
  if (rules.variant === 'freebet' && game.payout === '6:5' && data.houseEdge65 !== undefined) {
    return { edge: data.houseEdge65, payout: '6:5' };
  }
  return { edge: data.houseEdge, payout: rules.bjPays === 1.5 ? '3:2' : rules.bjPays === 1 ? '1:1' : '6:5' };
}

/**
 * Merge of Wave L and Wave M: what a variant game costs per hand. A card
 * room's commission is charged on a variant game's bet like any other, so it
 * is added to the chart's flat edge (a fee of $1 per $100 is 1% of the bet,
 * whatever the play). It is the one Wave M assumption that applies to a
 * variant: the rest (resplitting and doubling aces, the split cap, double-on)
 * are rules the variant preset fixes, so an unlogged one is not "assumed" --
 * the preset's rule is used -- and a logged one that differs is listed by
 * `variantMismatches`.
 */
export interface VariantCost extends VariantEdge {
  /** Dollars per $100 wagered = percent of the bet; 0 for none. */
  commissionPer100: number;
  /** A card room that logged no commission: the usual $1 per $100 is assumed. */
  commissionAssumed: boolean;
  /** Percent: the chart's edge plus the commission. */
  total: number;
}

export function variantCostFor(
  game: Pick<CasinoGame, 'payout' | 'commissionPer100'>,
  preset: PresetId,
  kind: Casino['kind'],
): VariantCost {
  const base = variantEdgeFor(game, preset);
  let fee = game.commissionPer100 ?? null;
  const commissionAssumed = fee === null && kind === 'cardroom';
  if (fee === null) fee = commissionAssumed ? ASSUMED_COMMISSION_PER_100 : 0;
  return { ...base, commissionPer100: fee, commissionAssumed, total: base.edge + fee };
}

/** Logged rules that differ from the preset's, each as one line. */
export function variantMismatches(
  game: Pick<CasinoGame, 'decks' | 's17' | 'payout' | 'rsa' | 'doubleSplitAces' | 'maxSplitHands' | 'doubleOn'> &
    Partial<Pick<CasinoGame, 'das' | 'surrender'>>,
  preset: PresetId,
): string[] {
  const rules = PRESETS[preset];
  const label = PRESET_LABEL[preset];
  const out: string[] = [];
  if (game.decks != null && game.decks !== rules.decks) {
    out.push(`Logged ${game.decks} decks; the ${PRESET_LABEL[preset]} figures are for ${rules.decks}.`);
  }
  if (game.s17 != null && game.s17 !== rules.s17) {
    const sibling =
      rules.variant === 'spanish21'
        ? game.s17
          ? ' Pick "Spanish 21, S17" for this game.'
          : ' Pick "Spanish 21, H17" for this game.'
        : '';
    out.push(`Logged ${game.s17 ? 'S17' : 'H17'}; this preset is ${rules.s17 ? 'S17' : 'H17'}.${sibling}`);
  }
  if (game.payout != null) {
    if (rules.variant === 'switch') {
      out.push(`Logged blackjack ${game.payout}; Blackjack Switch pays a blackjack 1:1, as these figures assume.`);
    } else if (rules.variant === 'spanish21' && game.payout === '6:5') {
      out.push('Logged blackjack 6:5; the Spanish 21 figures assume 3:2.');
    }
  }
  // C22 (audit 2026-10-29): double after split and late surrender too.
  if (game.das != null && game.das !== rules.das) {
    out.push(game.das ? `Logged doubling after a split; the ${label} figures do not double after splitting.` : `Logged no doubling after a split; the ${label} figures double after splitting.`);
  }
  if (game.surrender != null && game.surrender !== rules.ls) {
    out.push(game.surrender ? `Logged late surrender; the ${label} figures have no surrender.` : `Logged no surrender; the ${label} figures surrender late.`);
  }
  // Wave M's split and double rules, where logged and unlike the preset's.
  if (game.rsa != null && game.rsa !== rules.rsa) {
    out.push(game.rsa ? `Logged resplitting aces; the ${label} figures do not resplit aces.` : `Logged no resplitting aces; the ${label} figures resplit them.`);
  }
  if (game.maxSplitHands != null && game.maxSplitHands !== rules.maxHands) {
    out.push(`Logged split to ${game.maxSplitHands} hands; the ${label} figures split to ${rules.maxHands}.`);
  }
  if (game.doubleOn != null && game.doubleOn !== 'any2') {
    out.push(`Logged doubling on ${game.doubleOn} only; the ${label} figures double on any two cards.`);
  }
  if (game.doubleSplitAces != null && game.doubleSplitAces !== rules.splitAcesDraw) {
    out.push(
      game.doubleSplitAces
        ? `Logged doubling on split aces; the ${label} figures give split aces one card each.`
        : `Logged no doubling on split aces; the ${label} figures let split aces hit and double.`,
    );
  }
  return out;
}
