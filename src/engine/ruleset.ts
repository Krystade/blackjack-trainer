export interface RuleSet {
  decks: 1 | 2 | 6 | 8;
  s17: boolean; // true = dealer stands soft 17
  das: boolean;
  ls: boolean; // late surrender offered
  rsa: boolean; // resplit aces (gameplay only; chart unaffected at this granularity)
  bj65: boolean; // 6:5 blackjack payout (payout only)
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
