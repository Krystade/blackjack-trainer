/**
 * Every sentence the app can speak that a pre-rendered clip could cover.
 *
 * The clip generator (`generate-audio-clips.py`) mirrors the app's wording by
 * hand, in Python, and its own header records what that costs: when soft
 * flashcard prompts changed to card-by-card, the generator did not, and every
 * soft prompt silently dropped to live TTS -- taking the already-covered half
 * of the same line down with it, because clip segmentation is all-or-nothing.
 *
 * Corrections are the largest piece of that, and they cannot be mirrored by
 * hand at all: the reason text comes from the strategy engine and the
 * deviation set, runs through `narrateReason`'s nine-step rewrite, and is then
 * composed by `narrateCorrection`. So it is DERIVED here, from the real
 * modules, and written to `scripts/spoken-phrases.json` for the generator to
 * read. `spokenPhrases.test.ts` fails if the committed file no longer matches,
 * which is the drift alarm the Python file never had.
 *
 * NOT here, and deliberately: settlement lines ("Win, plus one point five.").
 * The amount is a bankroll figure with no upper bound, so that sentence set is
 * unbounded and no clip library can cover it. Those stay on live TTS.
 *
 * This module is build tooling. Nothing in the app imports it.
 */

import { correctPlay } from '../src/engine/strategy';
import { DEFAULT_RULES } from '../src/engine/ruleset';
import type { RuleSet } from '../src/engine/ruleset';
import type { Card, Rank, Suit } from '../src/engine/cards';
import { indexSetFor } from '../src/engine/deviations';
import type { Action } from '../src/engine/deviations';
import { drawQuizItem } from '../src/drills/deviationQuiz';
import { narrateBotAction, narrateCorrection, narrateSitOut } from '../src/audio/narrate';
import type { GradedEvent } from '../src/engine/grade';

const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const UPS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const SUITS: Suit[] = ['s', 'h', 'd', 'c'];
const SEAT_LABELS = ['P1', 'P2', 'P3', 'P4', 'P5'];
const ACTIONS: Action[] = ['hit', 'stand', 'double', 'split', 'surrender'];

/** Every action `narrateCorrection` can name as the right play. */
const EXPECTED_ACTIONS = ['hit', 'stand', 'double', 'split', 'surrender'];

/**
 * The true counts worth a clip. Wider than any shoe reaches in practice --
 * the drills' own generators stop well short -- because a clip that is never
 * played costs one file, and a missing one costs the whole utterance.
 */
const TC_MIN = -20;
const TC_MAX = 20;

/** Ruleset variants that change what the engine says, not merely what it does. */
function ruleVariants(): RuleSet[] {
  return [
    DEFAULT_RULES,
    { ...DEFAULT_RULES, s17: true },
    { ...DEFAULT_RULES, das: false },
    { ...DEFAULT_RULES, ls: false },
    { ...DEFAULT_RULES, decks: 2 },
  ];
}

/** Deliberately mirrors clips.ts's splitter -- the unit of a clip is a sentence. */
function splitIntoSentences(text: string): string[] {
  return text.split(/(?<=[.?!]) /);
}

function card(rank: Rank): Card {
  return { rank, suit: 's' };
}

/**
 * Every `reason` string reachable from the graded drills.
 *
 * Three sources, and all three are needed: the strategy engine's own advice
 * (flashcards, mixed, mastery, table play), the raw index labels (the quiz's
 * on-index items), and the quiz's COMPOSED labels -- "No index applies here
 * — basic strategy. (near ...)" is built by the quiz and appears nowhere
 * else, so it can only come from asking the quiz.
 */
export function reachableReasons(): Set<string> {
  const reasons = new Set<string>();

  const hands: Card[][] = [];
  for (const a of RANKS) for (const b of RANKS) hands.push([card(a), card(b)]);
  // A third card takes the double/split/surrender contexts away, which the
  // engine reports in the reason itself ("(double unavailable)").
  for (const a of RANKS) for (const b of RANKS) hands.push([card(a), card(b), card('2')]);

  const contexts = [
    { canDouble: true, canSplit: true, canSurrender: true },
    { canDouble: false, canSplit: false, canSurrender: false },
    { canDouble: true, canSplit: false, canSurrender: false },
  ];

  for (const rules of ruleVariants()) {
    for (const hand of hands) {
      for (const up of UPS) {
        for (let tc = -12; tc <= 12; tc++) {
          for (const ctx of contexts) {
            // Busted and otherwise unplayable shapes return nothing.
            const advice = correctPlay(hand, up, tc, ctx, rules) as { reason: string } | undefined;
            if (advice) reasons.add(advice.reason);
          }
        }
      }
    }

    for (const idx of indexSetFor(rules)) reasons.add(idx.label);

    // Seeded, so this is deterministic; wide, so the composed near-miss
    // labels are all reached. `distractorPct: 50` forces both item shapes.
    for (let seed = 0; seed < 4000; seed++) {
      reasons.add(drawQuizItem(seed, undefined, rules, 50).label);
    }
  }

  return reasons;
}

/** Every sentence a spoken correction can consist of. */
export function correctionSentences(): string[] {
  const sentences = new Set<string>();
  for (const reason of reachableReasons()) {
    for (const expected of EXPECTED_ACTIONS) {
      for (let tc = TC_MIN; tc <= TC_MAX; tc++) {
        const event = { correct: false, reason, expected, tc } as unknown as GradedEvent;
        for (const sentence of splitIntoSentences(narrateCorrection(event))) {
          sentences.add(sentence);
        }
      }
    }
  }
  return [...sentences];
}

/**
 * What the TABLE says, beyond the prompts the generator already mirrors.
 *
 * Bot turns are the most frequent utterance at a table and were entirely
 * unclipped: one clause with a comma is ONE sentence, so covering
 * "Player two hits, ten of clubs." would have taken a file per seat x action
 * x card -- thirteen hundred a voice. `narrateBotAction` speaks two sentences
 * instead, which brings the whole set inside a hundred.
 */
export function tableSentences(): string[] {
  const sentences = new Set<string>();
  sentences.add(narrateSitOut());

  for (const seat of SEAT_LABELS) {
    for (const action of ACTIONS) {
      // Without a card this is already one whole sentence.
      sentences.add(narrateBotAction(seat, action));
      // With one it is two, and BOTH halves have to be covered or the whole
      // line falls back anyway.
      for (const rank of RANKS) {
        for (const suit of SUITS) {
          for (const part of splitIntoSentences(narrateBotAction(seat, action, { rank, suit }))) {
            sentences.add(part);
          }
        }
      }
    }
  }
  return [...sentences];
}

/** The sorted, de-duplicated list the generator turns into clips. */
export function spokenSentences(): string[] {
  return [...new Set([...correctionSentences(), ...tableSentences()])].sort();
}
