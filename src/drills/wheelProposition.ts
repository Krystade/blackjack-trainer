import { narrateDealerUp, narrateHandPhrase, narrateTc, narrateTcQuestion, numberWord } from '../audio/narrate';
import {
  betAnswerLabel,
  betSizingOptions,
  correctBetAnswer,
  gradeBetSizing,
  scenarioDecksRemaining,
  scenarioTc,
  type BetAnswer,
  type BetGradeProfile,
  type BetSizingRow,
  type BetSizingScenario,
} from './betSizing';
import { SPEED_QUESTION, type SpeedQuestion } from './speedDrill';

/**
 * C-R1 (W9): Speed and Bet sizing, answered from the steering wheel.
 *
 * The wheel has two buttons, so an eyes-free drill on it has to be a yes/no
 * question: the app states a PROPOSITION and forward means yes, back means no.
 * Speed already is one ("Surrender?"). Bet sizing is a pick from the spread,
 * so here the app proposes a bet -- the right one about half the time, a wrong
 * one from a neighbouring rung or Sit otherwise -- and the driver agrees or
 * not. Either way the answer is graded like any other: right when the yes/no
 * matches whether the proposal is what the ramp calls.
 *
 * Every spoken line is built from sentences the clip library records
 * (scripts/spokenPhrases.ts walks them), so none falls to the phone's voice.
 */

/** Spread units with a recorded "Bet n units?" line; beyond, live speech. */
export const BET_UNIT_WORDS_MAX = 20;

export interface BetProposition {
  proposed: BetAnswer;
  /** Is the proposal what the ramp calls (cover bets included)? */
  right: boolean;
}

/**
 * Propose a bet. A fair coin decides right or wrong; a wrong proposal is a
 * neighbouring rung of the right answer or Sit, and only one the grader
 * actually marks wrong -- with cover bets on, a neighbouring rung passes, so
 * it is not offered as "wrong". With no wrong neighbour the right one is
 * proposed.
 */
export function proposeBet(rng: () => number, tc: number, p: BetGradeProfile): BetProposition {
  const correct = correctBetAnswer(tc, p.spread, p.wongExitTc);
  const wantRight = rng() < 0.5;
  if (!wantRight) {
    const options = betSizingOptions(p.spread);
    const k = options.indexOf(correct);
    const wrong = [...new Set<BetAnswer>([options[k - 1], options[k + 1], 'sit'].filter((o): o is BetAnswer => o !== undefined))]
      .filter((o) => o !== correct && !gradeBetSizing(o, tc, p));
    if (wrong.length > 0) {
      const proposed = wrong[Math.floor(rng() * wrong.length)]!;
      return { proposed, right: false };
    }
  }
  return { proposed: correct, right: gradeBetSizing(correct, tc, p) };
}

function unitsWords(units: number): string {
  return units === 1 ? 'one unit' : `${numberWord(units)} units`;
}

/** "Bet four units?" / "Sit out?" */
export function narrateBetQuestion(proposed: BetAnswer): string {
  return proposed === 'sit' ? 'Sit out?' : `Bet ${unitsWords(proposed)}?`;
}

/** "Running count plus three. Two decks remaining. Bet four units?" */
export function narrateBetProposition(s: BetSizingScenario, proposed: BetAnswer): string {
  return `${narrateTcQuestion(s.rc, scenarioDecksRemaining(s))} ${narrateBetQuestion(proposed)}`;
}

/** "Correct." / "Wrong. The ramp says four units." */
export function narrateBetVerdict(ok: boolean, correct: BetAnswer): string {
  if (ok) return 'Correct.';
  return `Wrong. The ramp says ${correct === 'sit' ? 'sit out' : unitsWords(correct)}.`;
}

/** The Stats row for a yes/no on a proposal (see the `saidYes` field). */
export function betPropositionRow(
  s: BetSizingScenario,
  p: BetGradeProfile,
  proposed: BetAnswer,
  saidYes: boolean,
  date: string,
): BetSizingRow {
  const tc = scenarioTc(s, p.tcRounding);
  return {
    date,
    rc: s.rc,
    decksRemaining: scenarioDecksRemaining(s),
    tc,
    taken: proposed,
    correct: correctBetAnswer(tc, p.spread, p.wongExitTc),
    ok: saidYes === gradeBetSizing(proposed, tc, p),
    saidYes,
  };
}

/** "You have sixteen. Dealer shows ten. [True count minus one.] Surrender?" */
export function narrateSpeedPrompt(q: SpeedQuestion): string {
  const count = q.tc === null ? '' : ` True count ${narrateTc(q.tc)}.`;
  return `You have ${narrateHandPhrase(q.cards)}. ${narrateDealerUp(q.up)}${count} ${SPEED_QUESTION[q.mode]}`;
}

/** "Correct." / "Wrong. The answer is yes." */
export function narrateYesNoVerdict(correct: boolean, answer: boolean): string {
  return correct ? 'Correct.' : `Wrong. The answer is ${answer ? 'yes' : 'no'}.`;
}

/** The screen's question for a proposal: "Bet 4u?" / "Sit out?" */
export function betPropositionLabel(proposed: BetAnswer): string {
  return proposed === 'sit' ? 'Sit out?' : `Bet ${betAnswerLabel(proposed)}?`;
}

/** The result strip's verdict for a yes/no on a proposal. */
export function betPropositionVerdictText(proposed: BetAnswer, saidYes: boolean, correct: BetAnswer, ok: boolean): string {
  const said = `You said ${saidYes ? 'yes' : 'no'} to ${proposed === 'sit' ? 'sitting out' : betAnswerLabel(proposed)}`;
  return ok ? `Correct — ${said}` : `${said} · Right ${betAnswerLabel(correct)}`;
}
