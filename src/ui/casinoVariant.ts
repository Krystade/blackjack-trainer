/**
 * Wave L (review S3): a variant casino game's flat house edge, and the logged
 * rules that do not match the variant preset named rather than buried.
 * C22 follow-up: the edge is worked out for the game's logged rules, not
 * taken from the preset.
 */

import type { Casino, CasinoGame } from '../store/casinoLog';
import { ASSUMED_COMMISSION_PER_100 } from '../store/casinoGameStats';
import { PRESETS, PRESET_LABEL, presetSummary } from '../engine/variants/rules';
import type { PresetId, VariantRules } from '../engine/variants/rules';
import { presetData } from '../engine/variants/strategy';

/**
 * C22 follow-up: the logged rules a variant game's edge is worked out for.
 * Each logged rule the variant engine plays replaces the preset's; an
 * unlogged one is the preset's. Left as the preset's: the decks (the maths
 * is infinite-deck), Switch's 1:1 natural (the game's design), and a logged
 * "no doubling on split aces" against Spanish 21's split aces that hit and
 * double (no doubling is not no drawing). `variantMismatches` names those.
 */
export type LoggedVariantFields = Pick<CasinoGame, 's17' | 'payout'> &
  Partial<Pick<CasinoGame, 'decks' | 'das' | 'surrender' | 'rsa' | 'doubleSplitAces' | 'maxSplitHands' | 'doubleOn'>>;

export function loggedVariantRules(game: LoggedVariantFields, preset: PresetId): VariantRules {
  const r: VariantRules = { ...PRESETS[preset] };
  if (game.s17 != null) r.s17 = game.s17;
  if (game.das != null) r.das = game.das;
  if (game.surrender != null) r.ls = game.surrender;
  if (game.rsa != null) r.rsa = game.rsa;
  if (game.maxSplitHands != null) r.maxHands = game.maxSplitHands;
  if (game.doubleOn === '9-11' || game.doubleOn === '10-11') r.doubleOn = game.doubleOn;
  if (game.doubleSplitAces === true && !r.splitAcesDraw) r.doubleSplitAces = true;
  if (game.payout != null && r.variant !== 'switch') r.bjPays = game.payout === '6:5' ? 1.2 : 1.5;
  return r;
}

/** One key per rule set: the same rules, however built, are worked out once. */
export function variantRulesKey(rules: VariantRules): string {
  const entries = Object.entries(rules).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

/**
 * The edge for these rules where the committed figures already hold it: a
 * preset as dealt (generated.json houseEdge), or Free Bet at 6:5 (houseEdge65).
 * Null when it has to be worked out (variantEdgeRunner.ts).
 */
export function knownVariantEdge(rules: VariantRules): number | null {
  const preset = PRESETS[rules.preset];
  const key = variantRulesKey(rules);
  const data = presetData(rules.preset);
  if (key === variantRulesKey(preset)) return data.houseEdge;
  if (data.houseEdge65 !== undefined && key === variantRulesKey({ ...preset, bjPays: 1.2 })) return data.houseEdge65;
  return null;
}

export interface VariantEdge {
  /** Percent, for the logged rules; null while it is being worked out. */
  edge: number | null;
  /** What blackjack pays in the rules used, as shown. */
  payout: string;
  /** The rules the edge is for. */
  rules: VariantRules;
  /** Some logged rule is unlike the preset's, so this is not the preset's figure. */
  fromLogged: boolean;
}

/** The edge for a rule set: a committed figure, else whatever `lookup` has (the worker's figure). */
export type VariantEdgeLookup = (rules: VariantRules) => number | null;

export function variantEdgeFor(game: LoggedVariantFields, preset: PresetId, lookup: VariantEdgeLookup = () => null): VariantEdge {
  const rules = loggedVariantRules(game, preset);
  const edge = knownVariantEdge(rules) ?? lookup(rules);
  const payout = rules.bjPays === 1.5 ? '3:2' : rules.bjPays === 1 ? '1:1' : '6:5';
  return { edge, payout, rules, fromLogged: variantRulesKey(rules) !== variantRulesKey(PRESETS[preset]) };
}

/** C22 follow-up: the rules used, in words: presetSummary plus the split and double rules it leaves out. */
export function variantRulesSummary(rules: VariantRules): string {
  const parts = [presetSummary(rules)];
  if (!rules.das) parts.push('no double after split');
  parts.push(`split to ${rules.maxHands} hands`);
  if (!rules.rsa) parts.push('no resplitting aces');
  if (rules.doubleOn !== undefined) parts.push(`double on ${rules.doubleOn} only`);
  if (rules.doubleSplitAces === true) parts.push('double on split aces');
  return parts.join(' · ');
}

/**
 * Merge of Wave L and Wave M: what a variant game costs per hand. A card
 * room's commission is charged on a variant game's bet like any other, so it
 * is added to the flat edge (a fee of $1 per $100 is 1% of the bet, whatever
 * the play). C22 follow-up: the edge is for the logged rules
 * (loggedVariantRules); a rule left unlogged is the preset's, so it is not
 * "assumed" -- a card room's unlogged commission is the one assumption.
 */
export interface VariantCost extends VariantEdge {
  /** Dollars per $100 wagered = percent of the bet; 0 for none. */
  commissionPer100: number;
  /** A card room that logged no commission: the usual $1 per $100 is assumed. */
  commissionAssumed: boolean;
  /** Percent: the edge plus the commission; null while the edge is worked out. */
  total: number | null;
}

export function variantCostFor(
  game: LoggedVariantFields & Pick<CasinoGame, 'commissionPer100'>,
  preset: PresetId,
  kind: Casino['kind'],
  lookup?: VariantEdgeLookup,
): VariantCost {
  const base = variantEdgeFor(game, preset, lookup);
  let fee = game.commissionPer100 ?? null;
  const commissionAssumed = fee === null && kind === 'cardroom';
  if (fee === null) fee = commissionAssumed ? ASSUMED_COMMISSION_PER_100 : 0;
  return { ...base, commissionPer100: fee, commissionAssumed, total: base.edge === null ? null : base.edge + fee };
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
