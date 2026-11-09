import { strategyRulesFor } from '../store/profiles';
import type { Profile } from '../store/types';
import type { GameConfig } from '../engine/game';
import { startShoeOutOf } from '../engine/wong';
import { sideBetConfigFor } from './sideBetConfig';
import { betsGateClosed, countGateClosed, effectivePlayFields } from './whatToCheck';

/**
 * The Play table's GameConfig, built from the ACTIVE PROFILE. Every grading,
 * payout and dealer-behaviour surface reads the profile, not Settings
 * (Cycle-1 Task 13). Pure, so what each profile option does to the game is
 * unit-testable without React.
 *
 * `bankrollStart` is THIS SESSION's start (#42: the bankroll carries over, see
 * playBankroll.ts), which is what the session report's delta is measured from.
 */
export function playConfigFor(
  profile: Profile,
  bankrollStart: number,
  seed: number | undefined,
): GameConfig {
  // T1-1B: the What-to-check gates over the finer values (ui/whatToCheck.ts).
  const fx = effectivePlayFields(profile);
  const betsOff = betsGateClosed(profile);
  const side = countGateClosed(profile) ? undefined : sideBetConfigFor(profile);
  return {
    penetration: profile.penetration,
    // #39: the cut as decks behind it; neither set keeps `penetration`.
    ...(profile.cutDecks === undefined ? {} : { cutDecks: profile.cutDecks }),
    ...(profile.cutVary === undefined ? {} : { cutVary: profile.cutVary }),
    betSpreadOn: fx.betSpreadOn,
    ...(profile.coverBets === undefined ? {} : { coverBets: profile.coverBets }),
    ...(profile.tcRounding === undefined ? {} : { tcRounding: profile.tcRounding }),
    ...(profile.playDepth === undefined ? {} : { playDepth: profile.playDepth }),
    spread: profile.spread,
    // D-R1: absent keeps the engine's -2.
    ...(profile.wongExitTc === undefined ? {} : { wongExitTc: profile.wongExitTc }),
    // Wave J: "start each shoe out" (or the legacy backCount) and the entry point.
    // T1-1B: both hang off the ramp, so a closed Bet checks gate drops them.
    ...(!betsOff && startShoeOutOf(profile) ? { startShoeOut: true } : {}),
    ...(betsOff || profile.wongInTc === undefined ? {} : { wongInTc: profile.wongInTc }),
    bankrollStart,
    countCheckEvery: fx.countCheckEvery,
    // #3 and #34: absent keeps the game's own default.
    ...(profile.countCheckAsk === undefined ? {} : { countCheckAsk: profile.countCheckAsk }),
    ...(profile.playChecks == null && profile.gradeDeviations === undefined ? {} : { gradeDeviations: fx.gradeDeviations }),
    rules: strategyRulesFor(profile),
    seats: profile.seats,
    dealerAlwaysPlaysOut: profile.dealerAlwaysPlaysOut,
    // B8: absent keeps the normal shoe.
    ...(profile.hotShoe ? { hotShoe: true } : {}),
    // Wave L: the side bet, when the profile offers one this build can read.
    // T1-1B: a side bet is graded on its own count, so it needs Count checks on.
    ...(side ? { sideBet: side } : {}),
    seed,
  };
}
