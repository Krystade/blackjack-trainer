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
import { narrateRampBets, narrateRampHands, narrateRampPlays, narrateRampSitsOut } from '../audio/narrate';

export interface BetMiss {
  /** "Bet 8u at TC +3 — you bet 1u", "Sit out at TC −1 — you bet 2u". */
  text: string;
  /** "Your ramp bets eight. True count plus three." */
  spoken: string;
  /**
   * Wave J: "Two hands." -- the hand count a two-hand ramp called for, when
   * the player opened the wrong number. Said as its own utterance after
   * `spoken`. Absent on every other miss.
   */
  spokenAfter?: string;
}

const tcText = (tc: number) => `TC ${signed(tc, { plusZero: true })}`;

/** Wave J: "two hands of 8u", "one hand of 8u". */
export function handsOf(hands: number, units: string): string {
  return `${hands === 2 ? 'two hands' : 'one hand'} of ${units}u`;
}

/**
 * Wave J toggle rework: an entry decision (you were Out), said against the
 * entry point -- "TC +2 — get in (you enter at +1)", "TC +0 — stay out (you
 * enter at +1)". The spoken line keeps the ramp lines' shape and their
 * recordings: "Your ramp plays" is the count calling for In, "Your ramp sits
 * out" for Out. Both are already clips, so a miss never drops the car's head
 * unit to live speech.
 */
function entryMiss(e: GradedEvent): BetMiss {
  const at = `you enter at ${signed(e.wongInTc ?? 1, { plusZero: true })}`;
  return e.taken === 'watch'
    ? { text: `${tcText(e.tc)} — get in (${at})`, spoken: narrateRampPlays(e.tc) }
    : { text: `${tcText(e.tc)} — stay out (${at})`, spoken: narrateRampSitsOut(e.tc) };
}

/**
 * An exit decision (you were In), said against the exit point -- "TC −3 — get
 * out (you leave at −2)", "TC +0 — stay in (you leave at −2)". Events from
 * before the toggle carry no exit point and keep their old wording.
 */
function exitMiss(e: GradedEvent, betTaken: string | undefined): BetMiss {
  const gotOut = e.taken === 'sit-out' || e.taken === 'leave';
  if (e.wongExitTc !== undefined) {
    const at = `you leave at ${signed(e.wongExitTc, { plusZero: true })}`;
    return gotOut
      ? { text: `${tcText(e.tc)} — stay in (${at})`, spoken: narrateRampPlays(e.tc) }
      : { text: `${tcText(e.tc)} — get out (${at})`, spoken: narrateRampSitsOut(e.tc) };
  }
  if (gotOut) {
    return { text: `Play at ${tcText(e.tc)} — you ${e.taken === 'leave' ? 'left' : 'sat out'}`, spoken: narrateRampPlays(e.tc) };
  }
  return {
    text: `Sit out at ${tcText(e.tc)}${betTaken !== undefined ? ` — you bet ${betTaken}u` : ' — you played'}`,
    spoken: narrateRampSitsOut(e.tc),
  };
}

/** The first wrong bet or play-or-sit decision among a deal's (or sit-out's) events. */
export function betMissFeedback(events: readonly GradedEvent[]): BetMiss | null {
  // Wave J: the entry is the round's one play-or-sit decision when present.
  const entry = events.find((e) => e.kind === 'wongIn' && !e.correct);
  if (entry) return entryMiss(entry);
  const wong = events.find((e) => e.kind === 'wong' && !e.correct);
  const bets = events.filter((e) => e.kind === 'bet');
  if (wong) return exitMiss(wong, bets[0]?.taken);
  const bet = bets.find((e) => !e.correct);
  if (!bet) return null;
  // Wave J: a ramp that spreads to two hands grades the hand count with the
  // stake. Named whenever two hands were called for or opened.
  const { handsTaken, handsExpected } = bet;
  if (handsTaken !== undefined && handsExpected !== undefined && (handsTaken === 2 || handsExpected === 2)) {
    return {
      text: `Bet ${handsOf(handsExpected, bet.expected)} at ${tcText(bet.tc)} — you bet ${handsOf(handsTaken, bet.taken)}`,
      spoken: narrateRampBets(Number(bet.expected), bet.tc),
      ...(handsTaken !== handsExpected ? { spokenAfter: narrateRampHands(handsExpected) } : {}),
    };
  }
  return {
    text: `Bet ${bet.expected}u at ${tcText(bet.tc)} — you bet ${bet.taken}u`,
    spoken: narrateRampBets(Number(bet.expected), bet.tc),
  };
}
