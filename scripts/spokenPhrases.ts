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

import { CALIBRATION_INTRO, CALIBRATION_RETRY, calibrationOrderLine } from '../src/diag/testKit';
import { DC_LINES } from '../src/diag/driveChecks';
import { ROUTE_LINES } from '../src/diag/routeKit';
import { DRIVE_LABELS } from '../src/ui/driveLaunch';
import { correctPlay } from '../src/engine/strategy';
import { DEFAULT_RULES } from '../src/engine/ruleset';
import type { RuleSet } from '../src/engine/ruleset';
import type { Card, Rank, Suit } from '../src/engine/cards';
import { indexSetFor } from '../src/engine/deviations';
import type { Action } from '../src/engine/deviations';
import { drawQuizItem } from '../src/drills/deviationQuiz';
import { indexTestSet, everyIndexTestItem, narrateIndexTestPrompt, narrateIndexTestCorrection } from '../src/drills/indexTest';
import type { StrategyRules } from '../src/engine/ruleset';
import {
  narrateBotAction,
  narrateCorrection,
  narrateSitOut,
  narrateRampBets,
  narrateRampPlays,
  narrateRampSitsOut,
  narrateRampHands,
  narrateInOut,
  narrateNotATag,
  narrateReadback,
  narrateAnswerEcho,
  ANSWER_ECHO_LABELS,
  VOICE_CONVERSATION_LINES,
  narrateTcQuestion,
  narrateProduceTcPrompt,
  narrateSelfCheckReveal,
  narrateActionNotAsked,
  narrateCountdownVerdict,
  narrateTableCountPrompt,
  narrateResult,
  narrateCountAnswer,
  narrateRewindFrom,
} from '../src/audio/narrate';
import { hiLoTag } from '../src/engine/count';
import { VARIANT_OPENERS, narrateVariantCorrection, narrateVariantTotal } from '../src/audio/narrateVariant';
import { SPEED_QUESTION } from '../src/drills/speedDrill';
import { COUNT_AGAIN_PREFIX, COUNT_PAUSED_LINE, COUNT_RESUMING_LINE } from '../src/drills/countPause';
import { sideBetSentences } from '../src/ui/sideBetFeedback';
import {
  BET_UNIT_WORDS_MAX,
  narrateBetQuestion,
  narrateBetVerdict,
  narrateYesNoVerdict,
} from '../src/drills/wheelProposition';
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

/**
 * Every sentence a spoken correction can consist of.
 *
 * Both openers are walked, not just the wrong-play one: R1's shot clock makes
 * `classification: 'timeout'` say "Out of time." where a wrong play says
 * "Wrong.", and an opener with no clip sends the ENTIRE correction to live TTS
 * (clips.ts is all-or-nothing per utterance). The rest of the sentence is
 * identical between the two, so this costs exactly one extra clip per voice.
 */
const CORRECTION_CLASSES = ['basic-error', 'timeout'] as const;

export function correctionSentences(): string[] {
  const sentences = new Set<string>();
  for (const reason of reachableReasons()) {
    for (const expected of EXPECTED_ACTIONS) {
      for (let tc = TC_MIN; tc <= TC_MAX; tc++) {
        for (const classification of CORRECTION_CLASSES) {
          const event = { correct: false, classification, reason, expected, tc } as unknown as GradedEvent;
          for (const sentence of splitIntoSentences(narrateCorrection(event))) {
            sentences.add(sentence);
          }
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

  // C-R5: the bet-miss lines, said before the deal. Every count the TC
  // sentences already cover, every bet a ramp row is likely to name.
  for (let tc = -20; tc <= 20; tc++) {
    const lines = [narrateRampPlays(tc), narrateRampSitsOut(tc)];
    for (let units = 1; units <= 20; units++) lines.push(narrateRampBets(units, tc));
    for (const line of lines) for (const sentence of splitIntoSentences(line)) sentences.add(sentence);
  }
  // Wave J: the hand count a two-hand ramp called for, said after the stake.
  sentences.add(narrateRampHands(1));
  sentences.add(narrateRampHands(2));
  // Wave J toggle rework: the In/Out toggle's new state.
  sentences.add(narrateInOut(true));
  sentences.add(narrateInOut(false));

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

/**
 * What the app says WHILE LISTENING (D2, docs/BACKLOG.md).
 *
 * The whole conversational half of eyes-free mode was unclipped -- the count
 * read-back it asks you to confirm, the refusals, "Did you have it?", every
 * "say yes" -- because those sentences were composed inline in three view
 * files where no derivation could see them. They are in narrate.ts now, and
 * this walks them.
 *
 * It matters more than the count suggests: clip segmentation is all-or-nothing
 * per utterance, and in a car live speech opens no media element, so each of
 * these dropped the head unit at the exact moment the app was asking a
 * question and waiting for an answer.
 *
 * The read-back's number is the only moving part, and it runs over the same
 * TC_MIN..TC_MAX band as everything else here. Outside it -- a genuinely wild
 * misrecognition -- the utterance falls back to live TTS, which is the
 * documented behaviour for anything unenumerable.
 */
export function voiceSentences(): string[] {
  const sentences = new Set<string>(VOICE_CONVERSATION_LINES);
  // A19: Home's Drive button says the drill's name first (Home.tsx startDrive).
  for (const label of Object.values(DRIVE_LABELS)) sentences.add(`${label}.`);
  for (let value = TC_MIN; value <= TC_MAX; value++) {
    for (const part of splitIntoSentences(narrateReadback(value))) sentences.add(part);
    // Shares its first sentence with the read-back by construction; walked
    // anyway, so that splitting it differently one day cannot go unnoticed.
    for (const part of splitIntoSentences(narrateNotATag(value))) sentences.add(part);
  }
  return [...sentences];
}

/**
 * The echo the drill speaks back the instant an answer lands.
 *
 * Its own group because it is neither a correction nor a table line nor part
 * of the listening conversation -- it is the drill confirming what it thinks
 * you said, and it fires on EVERY answer, which made it the most frequent
 * unclipped utterance in the app. It was unclipped because it was assembled
 * in ui/screens/Drills.tsx and this file only walks src/audio/narrate.ts.
 */
export function answerEchoSentences(): string[] {
  const sentences = new Set<string>();
  for (const label of ANSWER_ECHO_LABELS) {
    for (const part of splitIntoSentences(narrateAnswerEcho(label))) sentences.add(part);
  }
  return [...sentences];
}

/** Shoe depths the drills deal: half a deck to six, in half steps. */
export const DECK_DEPTHS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];

/**
 * The drill and table lines that used to be composed inline in views
 * (docs/research/2026-10-05-sound-paths.md section 2). Walking them here is
 * what lets clipCoverage.test.ts hold them against the shipped manifests.
 * Some of these sentences have no recording yet; the generator reads this
 * list, so the next run records them.
 */
export function drillSentences(): string[] {
  const sentences = new Set<string>();
  const add = (text: string) => {
    for (const part of splitIntoSentences(text)) sentences.add(part);
  };
  for (let rc = TC_MIN; rc <= TC_MAX; rc++) {
    for (const decks of DECK_DEPTHS) add(narrateTcQuestion(rc, decks));
    add(narrateCountAnswer(rc));
    add(narrateRewindFrom(rc));
  }
  for (const decks of DECK_DEPTHS) add(narrateProduceTcPrompt(decks));
  for (const action of ACTIONS) {
    add(narrateSelfCheckReveal(action));
    add(narrateActionNotAsked(action));
  }
  for (const rank of RANKS) {
    for (const correct of [true, false]) add(narrateCountdownVerdict(correct, card(rank), hiLoTag(rank)));
  }
  add(narrateTableCountPrompt('rc'));
  add(narrateTableCountPrompt('tc'));
  add(narrateResult('push', 0));
  // C-R1: Speed and Bet sizing on the wheel -- the questions, the proposed
  // bets and the verdicts. The hand and count sentences are the flashcard and
  // true-count ones above; the deeper trays of a 7- and 8-deck shoe are not.
  for (const q of Object.values(SPEED_QUESTION)) add(q);
  for (const answer of [true, false]) add(narrateYesNoVerdict(false, answer));
  add(narrateYesNoVerdict(true, true));
  add(narrateBetQuestion('sit'));
  add(narrateBetVerdict(false, 'sit'));
  for (let units = 1; units <= BET_UNIT_WORDS_MAX; units++) {
    add(narrateBetQuestion(units));
    add(narrateBetVerdict(false, units));
  }
  for (const decks of [6.5, 7, 7.5, 8]) add(narrateTcQuestion(0, decks));
  // C-R2: a count run paused from the wheel.
  add(COUNT_PAUSED_LINE);
  // Review of A12: the unheard-card hold's probe, and a replayed card's marker.
  add(COUNT_RESUMING_LINE);
  add(COUNT_AGAIN_PREFIX);
  // The Test kit's word step: its intro, order and spoken retry.
  add(CALIBRATION_INTRO);
  add(calibrationOrderLine());
  add(CALIBRATION_RETRY);
  // Wave L: the Variant hands drill -- its openers, and a correction for every
  // play against every up card (a variant can surrender where the standard
  // chart never does, e.g. Spanish 21's doubled hands).
  for (const opener of Object.values(VARIANT_OPENERS)) add(opener);
  // Three or more cards are said as a total: hard 6-17, soft 13-19.
  for (let total = 6; total <= 17; total++) add(narrateVariantTotal(total, false));
  for (let total = 13; total <= 19; total++) add(narrateVariantTotal(total, true));
  for (const action of ACTIONS) {
    for (const up of UPS) add(narrateVariantCorrection(false, action, `Basic ${action} vs dealer ${up}`));
  }
  // Drive checks (review S2): every fixed line, WHOLE -- each is recorded as
  // one clip, so splitting it would ask for sentences nobody says alone.
  // QUEUE_TTS_LINE is left out on purpose: check 4 needs it live.
  for (const line of Object.values(DC_LINES)) sentences.add(line);
  // Wave U: the route question and the Route kits' intro, whole.
  for (const line of Object.values(ROUTE_LINES)) sentences.add(line);
  return [...sentences];
}

/**
 * Wave O: every WHOLE utterance the Index test can speak -- its prompt for
 * every index under every rule variant and training option, on every hand it
 * can deal for that index (review N2: everyIndexTestItem enumerates them, no
 * rng sample), and both corrections. The full prompt ("... Index to
 * double?") never had a recording and fell to live TTS.
 */
export function indexTestUtterances(): string[] {
  const out = new Set<string>();
  const variants: StrategyRules[] = ruleVariants().flatMap((r) => [
    r,
    { ...r, surrenderIndices: true },
    { ...r, bjaExtras: true },
    { ...r, surrenderIndices: true, bjaExtras: true },
  ]);
  for (const rules of variants) {
    for (const dev of indexTestSet(rules)) {
      for (const item of everyIndexTestItem(dev, rules)) {
        out.add(narrateIndexTestPrompt(item));
        out.add(narrateIndexTestCorrection(item, true));
        out.add(narrateIndexTestCorrection(item, false));
      }
    }
  }
  return [...out];
}

/** The sorted, de-duplicated list the generator turns into clips. */
export function spokenSentences(): string[] {
  return [
    ...new Set([
      ...correctionSentences(),
      ...tableSentences(),
      ...voiceSentences(),
      ...answerEchoSentences(),
      ...drillSentences(),
      ...indexTestUtterances().flatMap(splitIntoSentences),
      // Wave L: the side bet at the table and in its drill.
      // Wave O: a two-deck side count snaps the last deck to quarters (0.75).
      ...sideBetSentences([0.75, ...DECK_DEPTHS]).flatMap(splitIntoSentences),
    ]),
  ].sort();
}
