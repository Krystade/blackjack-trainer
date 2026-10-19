/**
 * Wave B2, R2 (#13): a wrong bet or play-or-sit decision, said the moment it
 * is made. Play graded these and told nobody until the end-of-session report,
 * so the D1 line -- sit out at TC 0, even on round 1 -- was never taught at
 * the moment it was broken. A short strip line and a brief spoken line; never
 * a modal, because the round it belongs to is already dealt.
 *
 * C-R5: the spoken line is recorded (Kokoro clips, see narrateRampBets) and
 * queued through speak(), so it no longer talks over the deal narration.
 */
import type { GradedEvent } from '../engine/grade';
import { signed } from '../drills/signed';
import { narrateRampBets, narrateRampPlays, narrateRampSitsOut } from '../audio/narrate';

export interface BetMiss {
  /** "Bet 8u at TC +3 — you bet 1u", "Sit out at TC −1 — you bet 2u". */
  text: string;
  /** "Your ramp bets eight. True count plus three." */
  spoken: string;
}

const tcText = (tc: number) => `TC ${signed(tc, { plusZero: true })}`;

/**
 * Wave J: the back-counter's entry, said against the entry point -- "TC +2 —
 * sit in (you enter at +1)". The spoken line keeps the ramp lines' shape and
 * their recordings: "Your ramp plays" is the count calling for a seat, "Your
 * ramp sits out" the count calling for watching. Both are already clips, so a
 * miss never drops the car's head unit to live speech.
 */
function entryMiss(e: GradedEvent): BetMiss {
  const at = `you enter at ${signed(e.wongInTc ?? 1, { plusZero: true })}`;
  return e.taken === 'watch'
    ? { text: `${tcText(e.tc)} — sit in (${at})`, spoken: narrateRampPlays(e.tc) }
    : { text: `${tcText(e.tc)} — keep watching (${at})`, spoken: narrateRampSitsOut(e.tc) };
}

/** The first wrong bet or play-or-sit decision among a deal's (or sit-out's) events. */
export function betMissFeedback(events: readonly GradedEvent[]): BetMiss | null {
  // Wave J: the entry is the round's one play-or-sit decision when present.
  const entry = events.find((e) => e.kind === 'wongIn' && !e.correct);
  if (entry) return entryMiss(entry);
  const wong = events.find((e) => e.kind === 'wong' && !e.correct);
  const bets = events.filter((e) => e.kind === 'bet');
  if (wong) {
    if (wong.taken === 'sit-out') {
      return { text: `Play at ${tcText(wong.tc)} — you sat out`, spoken: narrateRampPlays(wong.tc) };
    }
    // Wave J: leaving a back-count table above the exit point.
    if (wong.taken === 'leave') {
      return { text: `Play at ${tcText(wong.tc)} — you left`, spoken: narrateRampPlays(wong.tc) };
    }
    const taken = bets[0]?.taken;
    return {
      text: `Sit out at ${tcText(wong.tc)}${taken !== undefined ? ` — you bet ${taken}u` : ' — you played'}`,
      spoken: narrateRampSitsOut(wong.tc),
    };
  }
  const bet = bets.find((e) => !e.correct);
  if (!bet) return null;
  return {
    text: `Bet ${bet.expected}u at ${tcText(bet.tc)} — you bet ${bet.taken}u`,
    spoken: narrateRampBets(Number(bet.expected), bet.tc),
  };
}
