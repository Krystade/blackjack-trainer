/**
 * Wave L: the blackjack variants Jack meets at the table, as rules.
 *
 * Every field is something the HOUSE decides, exactly like RuleSet. Strategy
 * is never typed in for these games: src/engine/variants/ev.ts computes it from
 * these rules (infinite deck), scripts/variantCharts.test.ts writes the charts
 * it implies to generated.json, and published.ts holds the Wizard of Odds
 * charts they are checked against.
 *
 * The presets are the "typical rule set" each game is dealt under, from the
 * Wizard of Odds rule lists (URLs in published.ts):
 *  - Free Bet: six decks, dealer hits soft 17, 3:2, DAS, resplit to four hands
 *    including aces, no surrender; free doubles on hard 9-11, free splits on
 *    every pair but tens, dealer 22 pushes.
 *  - Spanish 21: six Spanish (48-card, no tens) decks, late surrender, DAS,
 *    resplit and draw to split aces, double on any number of cards, double-down
 *    rescue, player 21 always wins, player blackjack beats dealer blackjack,
 *    card-count and 6-7-8 / 7-7-7 bonuses. H17 or S17, with or without redouble.
 *  - Blackjack Switch: six decks, H17, blackjack pays 1:1, dealer 22 pushes,
 *    DAS, resplit to four (not aces), no surrender.
 */

export type VariantId = 'freebet' | 'spanish21' | 'switch';

/** The Charts tab's picker: the standard chart, or one of the variants. */
export type ChartVariant = 'standard' | VariantId;

/** One concrete rule set a variant chart is computed for. */
export type PresetId = 'freebet' | 's21-h17' | 's21-s17' | 's21-h17-rdd' | 'switch';

export interface VariantRules {
  preset: PresetId;
  variant: VariantId;
  /** Decks in the shoe. The math is infinite-deck either way (see ev.ts). */
  decks: 6 | 8;
  s17: boolean;
  /** 48-card decks: the four tens are gone, the J/Q/K stay. */
  spanishDeck: boolean;
  /** A dealer 22 pushes every player hand still standing (bar a natural). */
  dealer22Push: boolean;
  /** What a natural pays: 1.5 (3:2), 1.2 (6:5) or 1 (even money). */
  bjPays: number;
  /** Spanish 21: a player natural still wins against a dealer natural. */
  playerBjBeatsDealerBj: boolean;
  /** Late surrender on the first two cards (not after a split). */
  ls: boolean;
  das: boolean;
  /** Most hands a pair may be split into. */
  maxHands: number;
  /** Aces may be resplit (up to maxHands). */
  rsa: boolean;
  /** Split aces may be hit and doubled (Spanish 21); otherwise one card each. */
  splitAcesDraw: boolean;
  /** Double on any number of cards (Spanish 21), not just the first two. */
  doubleAnyCards: boolean;
  /** Doubles allowed on one hand: 1, or 3 for "double double down" (redouble). */
  maxDoubles: number;
  /** Double-down rescue: after doubling, give up half the stake (the original bet). */
  rescue: boolean;
  /** Spanish 21: a player 21 wins at once, whatever the dealer makes. */
  player21Wins: boolean;
  /** Spanish 21: 5/6/7+-card 21 and 6-7-8 / 7-7-7 bonuses (not after doubling or splitting). */
  cardBonuses: boolean;
  /**
   * Pay the card-count bonuses on split hands too (the game's original design;
   * most casinos do not). Off in every preset; the disagreement analysis turns
   * it on to show which published cells depend on it.
   */
  bonusAfterSplit?: boolean;
  /** Free Bet: free doubles on two-card hard 9, 10 and 11. */
  freeDoubles: boolean;
  /** Free Bet: free splits on every pair except tens. */
  freeSplits: boolean;
  /**
   * Standard-blackjack rules no preset sets (every preset doubles any two
   * cards, and gives split aces what `splitAcesDraw` says). Only the casino
   * log's assumption costs read them (ui/casinoStatsText.ts ASSUMED_EFFECT_PCT,
   * pinned by casinoAssumedEffect.test.ts):
   *  - doubleSplitAces: a split ace that may not draw may still double its one card;
   *  - doubleOn: the first two cards may be doubled only on a total of 9-11 / 10-11.
   */
  doubleSplitAces?: boolean;
  doubleOn?: '9-11' | '10-11';
}

const FREE_BET: VariantRules = {
  preset: 'freebet',
  variant: 'freebet',
  decks: 6,
  s17: false,
  spanishDeck: false,
  dealer22Push: true,
  bjPays: 1.5,
  playerBjBeatsDealerBj: false,
  ls: false,
  das: true,
  maxHands: 4,
  rsa: true,
  splitAcesDraw: false,
  doubleAnyCards: false,
  maxDoubles: 1,
  rescue: false,
  player21Wins: false,
  cardBonuses: false,
  freeDoubles: true,
  freeSplits: true,
};

const S21_H17: VariantRules = {
  preset: 's21-h17',
  variant: 'spanish21',
  decks: 6,
  s17: false,
  spanishDeck: true,
  dealer22Push: false,
  bjPays: 1.5,
  playerBjBeatsDealerBj: true,
  ls: true,
  das: true,
  maxHands: 4,
  rsa: true,
  splitAcesDraw: true,
  doubleAnyCards: true,
  maxDoubles: 1,
  rescue: true,
  player21Wins: true,
  cardBonuses: true,
  freeDoubles: false,
  freeSplits: false,
};

const SWITCH: VariantRules = {
  preset: 'switch',
  variant: 'switch',
  decks: 6,
  s17: false,
  spanishDeck: false,
  dealer22Push: true,
  bjPays: 1,
  playerBjBeatsDealerBj: false,
  ls: false,
  das: true,
  maxHands: 4,
  rsa: false,
  splitAcesDraw: false,
  doubleAnyCards: false,
  maxDoubles: 1,
  rescue: false,
  player21Wins: false,
  cardBonuses: false,
  freeDoubles: false,
  freeSplits: false,
};

export const PRESETS: Readonly<Record<PresetId, VariantRules>> = {
  freebet: FREE_BET,
  's21-h17': S21_H17,
  's21-s17': { ...S21_H17, preset: 's21-s17', s17: true },
  's21-h17-rdd': { ...S21_H17, preset: 's21-h17-rdd', maxDoubles: 3 },
  switch: SWITCH,
};

export const PRESET_IDS: readonly PresetId[] = ['freebet', 's21-h17', 's21-s17', 's21-h17-rdd', 'switch'];

/** Names as the picker and the casino log show them. */
export const VARIANT_LABEL: Readonly<Record<ChartVariant, string>> = {
  standard: 'Standard',
  freebet: 'Free Bet',
  spanish21: 'Spanish 21',
  switch: 'Switch',
};

export const PRESET_LABEL: Readonly<Record<PresetId, string>> = {
  freebet: 'Free Bet',
  's21-h17': 'Spanish 21, H17',
  's21-s17': 'Spanish 21, S17',
  's21-h17-rdd': 'Spanish 21, H17, redouble',
  switch: 'Blackjack Switch',
};

/** The rule set a variant opens on: the first of its presets. */
export const DEFAULT_PRESET: Readonly<Record<VariantId, PresetId>> = {
  freebet: 'freebet',
  spanish21: 's21-h17',
  switch: 'switch',
};

export function presetsOf(variant: VariantId): PresetId[] {
  return PRESET_IDS.filter((id) => PRESETS[id].variant === variant);
}

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && (PRESET_IDS as readonly string[]).includes(value);
}

export function isVariantId(value: unknown): value is VariantId {
  return value === 'freebet' || value === 'spanish21' || value === 'switch';
}

/** One line under the chart heading, like rulesetSummary() for the standard chart. */
export function presetSummary(rules: VariantRules): string {
  const parts: string[] = [`${rules.decks} decks${rules.spanishDeck ? ' (Spanish, no tens)' : ''}`];
  parts.push(rules.s17 ? 'dealer stands soft 17' : 'dealer hits soft 17');
  if (rules.dealer22Push) parts.push('dealer 22 pushes');
  parts.push(rules.bjPays === 1.5 ? 'blackjack 3:2' : rules.bjPays === 1 ? 'blackjack 1:1' : 'blackjack 6:5');
  if (rules.freeDoubles) parts.push('free doubles on 9-11');
  if (rules.freeSplits) parts.push('free splits (not tens)');
  if (rules.doubleAnyCards) parts.push('double any number of cards');
  if (rules.maxDoubles > 1) parts.push('redouble');
  if (rules.rescue) parts.push('double-down rescue');
  if (rules.ls) parts.push('late surrender');
  return parts.join(' · ');
}
