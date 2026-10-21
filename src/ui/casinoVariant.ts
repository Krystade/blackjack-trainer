/**
 * Wave L (review S3): a variant casino game's flat house edge, with the game's
 * logged payout applied where the app has the figure, and the logged rules
 * that do not match the variant preset named rather than buried.
 */

import type { CasinoGame } from '../store/casinoLog';
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

/** Logged rules that differ from the preset's, each as one line. */
export function variantMismatches(game: Pick<CasinoGame, 'decks' | 's17' | 'payout'>, preset: PresetId): string[] {
  const rules = PRESETS[preset];
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
  return out;
}
