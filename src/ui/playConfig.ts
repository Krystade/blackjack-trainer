import { strategyRulesFor } from '../store/profiles';
import type { Profile } from '../store/types';
import type { GameConfig } from '../engine/game';

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
  return {
    penetration: profile.penetration,
    // #39: the cut as decks behind it; neither set keeps `penetration`.
    ...(profile.cutDecks === undefined ? {} : { cutDecks: profile.cutDecks }),
    ...(profile.cutVary === undefined ? {} : { cutVary: profile.cutVary }),
    betSpreadOn: profile.betSpreadOn,
    ...(profile.coverBets === undefined ? {} : { coverBets: profile.coverBets }),
    ...(profile.tcRounding === undefined ? {} : { tcRounding: profile.tcRounding }),
    spread: profile.spread,
    // D-R1: absent keeps the engine's -2.
    ...(profile.wongExitTc === undefined ? {} : { wongExitTc: profile.wongExitTc }),
    // Wave J: back-counting and its entry point; absent keeps both off/default.
    ...(profile.backCount ? { backCount: true } : {}),
    ...(profile.wongInTc === undefined ? {} : { wongInTc: profile.wongInTc }),
    bankrollStart,
    countCheckEvery: profile.countCheckEvery,
    // #3 and #34: absent keeps the game's own default.
    ...(profile.countCheckAsk === undefined ? {} : { countCheckAsk: profile.countCheckAsk }),
    ...(profile.gradeDeviations === undefined ? {} : { gradeDeviations: profile.gradeDeviations }),
    rules: strategyRulesFor(profile),
    seats: profile.seats,
    dealerAlwaysPlaysOut: profile.dealerAlwaysPlaysOut,
    // B8: absent keeps the normal shoe.
    ...(profile.hotShoe ? { hotShoe: true } : {}),
    seed,
  };
}
