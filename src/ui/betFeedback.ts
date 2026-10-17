/**
 * Wave B2, R2 (#13): a wrong bet or play-or-sit decision, said the moment it
 * is made. Play graded these and told nobody until the end-of-session report,
 * so the D1 line -- sit out at TC 0, even on round 1 -- was never taught at
 * the moment it was broken. A short strip line and a brief spoken line; never
 * a modal, because the round it belongs to is already dealt.
 *
 * The spoken line goes to live speech (no clip covers it), like the
 * settlement lines that already follow every round.
 */
import type { GradedEvent } from '../engine/grade';
import { signed } from '../drills/signed';
import { narrateTc } from '../audio/narrate';

export interface BetMiss {
  /** "Bet 8u at TC +3 — you bet 1u", "Sit out at TC −1 — you bet 2u". */
  text: string;
  /** "Your ramp bets 8 at true count plus three." */
  spoken: string;
}

const tcText = (tc: number) => `TC ${signed(tc, { plusZero: true })}`;

/** The first wrong bet or play-or-sit decision among a deal's (or sit-out's) events. */
export function betMissFeedback(events: readonly GradedEvent[]): BetMiss | null {
  const wong = events.find((e) => e.kind === 'wong' && !e.correct);
  const bets = events.filter((e) => e.kind === 'bet');
  if (wong) {
    if (wong.taken === 'sit-out') {
      return { text: `Play at ${tcText(wong.tc)} — you sat out`, spoken: `Your ramp plays at true count ${narrateTc(wong.tc)}.` };
    }
    const taken = bets[0]?.taken;
    return {
      text: `Sit out at ${tcText(wong.tc)}${taken !== undefined ? ` — you bet ${taken}u` : ' — you played'}`,
      spoken: `Your ramp sits out at true count ${narrateTc(wong.tc)}.`,
    };
  }
  const bet = bets.find((e) => !e.correct);
  if (!bet) return null;
  return {
    text: `Bet ${bet.expected}u at ${tcText(bet.tc)} — you bet ${bet.taken}u`,
    spoken: `Your ramp bets ${bet.expected} at true count ${narrateTc(bet.tc)}.`,
  };
}
