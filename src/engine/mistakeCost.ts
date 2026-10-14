import type { Card, Rank } from './cards';
import type { MistakeClass } from './grade';
import { actionEvs, evCostBetween } from './handEv';
import type { EvAction } from './handEv';
import type { Advice, PlayContext } from './strategy';
import type { StrategyRules } from './ruleset';

/**
 * What a wrong hand decision cost, in units -- or `undefined` when pricing it
 * would be dishonest. The engine's copy of the drills' `priceMistake`
 * (drills/gradeAnswer.ts), so Play prices its basic errors exactly as the
 * hand drills do (#25); the two must stay identical.
 *
 * ONLY a `basic-error` gets a number, which is exactly the set of wrong
 * answers where no index is involved on either side. A correct answer is
 * unpriced; `missed-deviation` and `wrong-anyway` mean the count called for an
 * index, and the EV engine is count-blind by construction -- it would price the
 * index play as the worse one; `phantom-deviation` priced at neutral-count
 * weights overstates what it cost at the count it was made at. An action the
 * hand could not take is unpriced too (`evCostBetween` gives null). See
 * `GradedEvent.evCost` for the full contract.
 */
export function priceMistake(
  cards: Card[],
  up: Rank,
  ctx: PlayContext,
  rules: StrategyRules,
  expected: Advice,
  taken: string,
  classification: MistakeClass,
): number | undefined {
  if (classification !== 'basic-error') return undefined;
  const evs = actionEvs(cards, up, ctx, rules);
  const cost = evCostBetween(evs, expected.action as EvAction, taken as EvAction);
  return cost ?? undefined;
}
