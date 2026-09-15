export interface RuleSet {
  decks: 1 | 2 | 6 | 8;
  s17: boolean; // true = dealer stands soft 17
  das: boolean;
  ls: boolean; // late surrender offered
  rsa: boolean; // resplit aces (gameplay only; chart unaffected at this granularity)
  bj65: boolean; // 6:5 blackjack payout (payout only)
}

/**
 * The rules a strategy lookup runs under, plus the one TRAINING preference that
 * changes what the correct play is: surrender indices (RV3).
 *
 * It is deliberately not a field on RuleSet. RuleSet describes the GAME -- what
 * the casino offers -- and every field in it is something the house decides.
 * Whether you play the Fab 4 is something the LEARNER decides, so it lives on
 * the profile (see store/types.ts Profile.surrenderIndices) and arrives here
 * only at the call.
 *
 * Every existing caller passes a plain RuleSet, which is assignable to this
 * with the flag undefined -- i.e. off. That is the whole point of the shape:
 * adding surrender indices could not change a single existing call site.
 */
export interface StrategyRules extends RuleSet {
  surrenderIndices?: boolean;
}

/** v1's game: 6 decks, dealer hits soft 17, DAS + late surrender on, no RSA, 3:2 BJ. */
export const DEFAULT_RULES: RuleSet = {
  decks: 6,
  s17: false,
  das: true,
  ls: true,
  rsa: false,
  bj65: false,
};
