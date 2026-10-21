import { signed } from '../drills/signed';
import { normaliseAlias } from '../audio/voiceAliases';
import { capitalizeSpoken, narrateCountAnswer, narrateDecksRemaining } from '../audio/narrate';
import { OUTCOME_LABELS } from '../engine/sideBets/settle';
import type { SideBetConfig, SideBetDecision } from '../engine/sideBets/tableBet';

/**
 * Wave L: the side bet at the table, in words.
 *
 * A wrong side-bet call is said the moment the deal goes down, in the bet-miss
 * style (betFeedback.ts): a strip line that names the count and the call --
 * "Lucky Ladies count +6 — bet it (from +6)" -- and a short recorded line.
 * Never a modal.
 */

export interface SideMiss {
  text: string;
  spoken: string;
}

export const SIDE_SAYS_BET = 'Side count says bet.';
export const SIDE_SAYS_SKIP = 'Side count says no bet.';
export const SIDE_ON_LINE = 'Side bet on.';
export const SIDE_OFF_LINE = 'Side bet off.';
export const SIDE_WINS_LINE = 'Side bet wins.';

/** The side count drill's questions. */
export const SIDE_COUNT_PROMPT = 'Side count?';
export const HILO_COUNT_PROMPT = 'Hi-Lo count?';
export const BET_SIDE_PROMPT = 'Bet the side?';

/** "Two decks remaining. Bet the side?" */
export function narrateBetSidePrompt(decksLeft: number): string {
  return `${capitalizeSpoken(narrateDecksRemaining(decksLeft))}. ${BET_SIDE_PROMPT}`;
}

/** Side counts run wider than a true count: the suit spread and a level-2 count over a deck. */
export const SIDE_COUNT_SPOKEN_MAX = 40;

/** Every line above, for the clip list (scripts/spokenPhrases.ts). */
export const SIDE_BET_LINES: readonly string[] = [
  SIDE_SAYS_BET,
  SIDE_SAYS_SKIP,
  SIDE_ON_LINE,
  SIDE_OFF_LINE,
  SIDE_WINS_LINE,
  SIDE_COUNT_PROMPT,
  HILO_COUNT_PROMPT,
  BET_SIDE_PROMPT,
];

/** Every sentence the side bet says, composed ones included -- what the clips cover. */
export function sideBetSentences(deckDepths: readonly number[]): string[] {
  const out = new Set<string>(SIDE_BET_LINES);
  for (const d of deckDepths) out.add(`${capitalizeSpoken(narrateDecksRemaining(d))}.`);
  for (let rc = -SIDE_COUNT_SPOKEN_MAX; rc <= SIDE_COUNT_SPOKEN_MAX; rc++) out.add(narrateCountAnswer(rc));
  return [...out];
}

/** "from +6", "at −5 and below", "every hand", "never". */
export function triggerText(plan: SideBetConfig['plan']): string {
  if (plan.always) return 'every hand';
  if (plan.trigger === null) return 'never — counting does not beat it';
  return plan.betBelow ? `at ${signed(plan.trigger, { plusZero: true })} and below` : `from ${signed(plan.trigger, { plusZero: true })}`;
}

export function sideMissFeedback(cfg: SideBetConfig, d: SideBetDecision): SideMiss | null {
  if (d.correct) return null;
  const count = `${cfg.name} count ${signed(d.tc, { plusZero: true })}`;
  return d.expected
    ? { text: `${count} — bet it (${triggerText(cfg.plan)})`, spoken: SIDE_SAYS_BET }
    : { text: `${count} — no side bet (${triggerText(cfg.plan)})`, spoken: SIDE_SAYS_SKIP };
}

/** "$225", "−$25". */
export function dollars(n: number): string {
  const abs = Math.abs(n);
  const s = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `${n < 0 ? '−' : n > 0 ? '+' : ''}$${s}`;
}

/** The settled bet's line: "Lucky Ladies: suited 20 — +$225". */
export function sideResultText(cfg: SideBetConfig, d: SideBetDecision): string | null {
  if (!d.placed || d.net === undefined) return null;
  const what = d.outcome ? OUTCOME_LABELS[d.outcome] : 'lost';
  return `${cfg.name}: ${what} — ${dollars(d.net)}`;
}

/**
 * The chip's words at the table, between rounds. Two words at most (the
 * self-echo ceiling, voiceAliases.ts), and none of them a command, a toggle
 * or a deal word: sideBetFeedback.test.ts checks every one against those
 * lists. "Side" alone is not taken -- it is one sound from "sit".
 */
export const SIDE_ON_WORDS: readonly string[] = ['side on', 'side bet'];
export const SIDE_OFF_WORDS: readonly string[] = ['side off', 'skip side'];
export const SIDE_BIAS: readonly string[] = [...SIDE_ON_WORDS, ...SIDE_OFF_WORDS];

/** The chip state asked for, or null. Only the TOP reading counts, as for the In/Out toggle. */
export function sideWordIn(readings: readonly string[]): boolean | null {
  const top = readings[0];
  if (top === undefined) return null;
  const said = normaliseAlias(top);
  if (SIDE_ON_WORDS.includes(said)) return true;
  if (SIDE_OFF_WORDS.includes(said)) return false;
  return null;
}
