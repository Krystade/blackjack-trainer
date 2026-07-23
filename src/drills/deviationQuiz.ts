import type { Card, Rank } from '../engine/cards';
import { mulberry32 } from '../engine/cards';
import { correctPlay, basicPlay, insuranceCorrect } from '../engine/strategy';
import type { PlayContext } from '../engine/strategy';
import type { Action, Deviation, DeviationId } from '../engine/deviations';
import { ILLUSTRIOUS_18, ILLUSTRIOUS_18_S17 } from '../engine/deviations';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { RuleSet } from '../engine/ruleset';
import { makeHardHand } from './buildHand';

export interface QuizItem {
  cards: [Card, Card] | null; // null for insurance items
  up: Rank;
  tc: number;
  // Omitted (undefined) for distractor items -- see drawQuizItem's
  // `distractorPct` param and buildDistractorItem below. A distractor never
  // tested whether the player knows a REAL index's threshold, so it must
  // never be attributed to that index's per-index stats. store/stats.ts's
  // applyEvents already no-ops its perIndex update when deviationId is
  // falsy, so simply omitting the field here is sufficient -- no separate
  // marker id is needed, and category/mistake tallies (which don't depend
  // on deviationId) still record the distractor honestly.
  deviationId?: DeviationId;
  isDeviationSide: boolean;
  correct: Action | 'take-insurance' | 'decline-insurance';
  label: string; // the index label for feedback
  // True for injected fake/distractor items (see drawQuizItem's
  // `distractorPct` param): the correct answer is plain basic strategy --
  // no Illustrious 18 index actually applies to this exact hand/up/tc.
  // Presentation is identical to a real item; only the post-answer label
  // differs (see distractorLabel below).
  isDistractor: boolean;
}

/**
 * Helper: construct cards for a pair10 (two ten-value cards).
 */
function makePair10Cards(): [Card, Card] {
  return [
    { rank: '10', suit: 's' },
    { rank: 'J', suit: 's' },
  ];
}

/** ctx shared by every hard/pair10 quiz item AND every distractor built from
 * one -- surrender unavailable models the standard index-play situation
 * (see the deviationQuiz surrender-masking fix note below). */
const QUIZ_CTX: PlayContext = { canDouble: true, canSplit: true, canSurrender: false };

/** tc uniform in [threshold-2, threshold+2] -- the original per-entry tc spread. */
function tcNearThreshold(threshold: number, rng: () => number): number {
  const tcMin = threshold - 2;
  const tcMax = threshold + 2;
  return tcMin + Math.floor(rng() * (tcMax - tcMin + 1));
}

/** tc 1-2 counts on the WRONG side of an entry's threshold/dir -- guaranteed
 * to not satisfy `dir`'s condition, so the deviation cannot apply. */
function tcWrongSide(entry: Deviation, rng: () => number): number {
  const delta = 1 + Math.floor(rng() * 2); // 1 or 2 counts off
  return entry.dir === 'gte' ? entry.threshold - delta : entry.threshold + delta;
}

// Dealer up-card space in index order (10 collapses J/Q/K, matching upIndex
// in engine/basicStrategy.ts) -- used to find "adjacent" up-cards for CLOSE
// distractors.
const UP_SPACE: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

function adjacentUps(up: Rank): Rank[] {
  const idx = UP_SPACE.indexOf(up);
  const out: Rank[] = [];
  if (idx > 0) out.push(UP_SPACE[idx - 1]!);
  if (idx < UP_SPACE.length - 1) out.push(UP_SPACE[idx + 1]!);
  return out;
}

function adjacentTotals(total: number): number[] {
  return [total - 1, total + 1].filter((t) => t >= 5 && t <= 19);
}

/** Fisher-Yates shuffle using a seeded rng -- local copy of the same tiny
 * algorithm Shoe uses internally (engine/cards.ts keeps it private). */
function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * THE authoritative distractor check: does an active deviation actually
 * apply to this exact hand/up/tc? Never hand-authored -- always re-derived
 * from correctPlay/basicPlay, the same engine functions the quiz grader
 * (buildQuizEvent in Drills.tsx) uses.
 */
function isBasicOnly(cards: [Card, Card], up: Rank, tc: number, rules: RuleSet): { ok: boolean; action: Action } {
  const withCount = correctPlay(cards, up, tc, QUIZ_CTX, rules);
  const basicOnly = basicPlay(cards, up, QUIZ_CTX, rules);
  return { ok: withCount.action === basicOnly.action, action: basicOnly.action };
}

type Candidate = { cards: [Card, Card]; up: Rank; tc: number };

/**
 * CLOSE distractor for a 'hard' kind entry: perturb exactly ONE dimension
 * (tc-wrong-side / adjacent up-card / adjacent hand total) so the scenario
 * LOOKS like the studied spot but no index actually triggers. Every
 * candidate is engine-verified (isBasicOnly) before being accepted; attempts
 * are tried in a seeded-random order so all three perturbation kinds get a
 * turn across many draws, not just the always-safe fallback. The
 * tc-wrong-side attempt (same total/up as `entry`) is analytically
 * guaranteed to pass -- no two Illustrious 18 entries share a (total, up)
 * pair -- so this can only return null if makeHardHand keeps failing, which
 * never happens for the constructible 5..19 range.
 */
function buildCloseHardCandidate(entry: Deviation, rng: () => number, rules: RuleSet): Candidate | null {
  const attempts: Array<() => Candidate | null> = [
    () => {
      const cards = makeHardHand(entry.total!);
      return cards ? { cards, up: entry.up!, tc: tcWrongSide(entry, rng) } : null;
    },
    ...adjacentUps(entry.up!).map(
      (up) => () => {
        const cards = makeHardHand(entry.total!);
        return cards ? { cards, up, tc: tcNearThreshold(entry.threshold, rng) } : null;
      },
    ),
    ...adjacentTotals(entry.total!).map(
      (total) => () => {
        const cards = makeHardHand(total);
        return cards ? { cards, up: entry.up!, tc: tcNearThreshold(entry.threshold, rng) } : null;
      },
    ),
  ];

  for (const attempt of shuffled(attempts, rng)) {
    const candidate = attempt();
    if (candidate && isBasicOnly(candidate.cards, candidate.up, candidate.tc, rules).ok) {
      return candidate;
    }
  }
  return null;
}

/**
 * CLOSE distractor for a 'pair10' kind entry (TTv5/TTv6): only tc-wrong-side
 * and adjacent-up-card apply (the hand is always the fixed 10,10 pair, so
 * there's no "adjacent hand total" axis). Same engine-verified-attempts
 * shape as buildCloseHardCandidate.
 */
function buildClosePair10Candidate(entry: Deviation, rng: () => number, rules: RuleSet): Candidate | null {
  const attempts: Array<() => Candidate | null> = [
    () => ({ cards: makePair10Cards(), up: entry.up!, tc: tcWrongSide(entry, rng) }),
    ...adjacentUps(entry.up!).map(
      (up) => () => ({ cards: makePair10Cards(), up, tc: tcNearThreshold(entry.threshold, rng) }),
    ),
  ];

  for (const attempt of shuffled(attempts, rng)) {
    const candidate = attempt();
    if (candidate && isBasicOnly(candidate.cards, candidate.up, candidate.tc, rules).ok) {
      return candidate;
    }
  }
  return null;
}

const RANDOM_HARD_TOTALS: number[] = Array.from({ length: 15 }, (_, i) => i + 5); // 5..19
const RANDOM_TC_MIN = -6;
const RANDOM_TC_MAX = 6;
const RANDOM_MAX_ATTEMPTS = 30;

/**
 * RANDOM distractor: any hard, non-pair, two-card hand vs any up-card at any
 * tc in a wide band, engine-verified to NOT be within any active
 * deviation's trigger zone. Bounded retries -- collisions with an active
 * index's zone are rare (18 entries against a ~2000-scenario space), so 30
 * attempts succeeds essentially always; a null return (never observed in
 * the 300+-seed sweep test) falls back to a CLOSE candidate at the call
 * site.
 */
function buildRandomCandidate(rng: () => number, rules: RuleSet): Candidate | null {
  for (let i = 0; i < RANDOM_MAX_ATTEMPTS; i++) {
    const total = RANDOM_HARD_TOTALS[Math.floor(rng() * RANDOM_HARD_TOTALS.length)]!;
    const up = UP_SPACE[Math.floor(rng() * UP_SPACE.length)]!;
    const tc = RANDOM_TC_MIN + Math.floor(rng() * (RANDOM_TC_MAX - RANDOM_TC_MIN + 1));
    const cards = makeHardHand(total);
    if (!cards) continue;
    if (isBasicOnly(cards, up, tc, rules).ok) {
      return { cards, up, tc };
    }
  }
  return null;
}

const NO_INDEX_LABEL = 'No index applies here — basic strategy.';

function distractorLabel(near?: Deviation): string {
  return near ? `${NO_INDEX_LABEL} (near ${near.label})` : NO_INDEX_LABEL;
}

/**
 * Build a distractor QuizItem: a scenario that looks like a studied index
 * spot but where no active deviation actually applies, so the correct play
 * is plain basic strategy. See drawQuizItem's `distractorPct` param.
 *
 * Design decisions:
 * - Insurance has only a tc dimension (dealer always shows an Ace) -- CLOSE
 *   and RANDOM collapse to the identical "tc below +3" treatment.
 * - A pinned `filter` means the operator is drilling ONE specific index --
 *   every distractor stays CLOSE to it (perturbed FROM it) rather than
 *   wandering to an unrelated random hand, which would defeat the point of
 *   filtering to that index. With no filter ("all indices"), a coin flip
 *   picks CLOSE (near a random active entry) vs RANDOM.
 */
function buildDistractorItem(
  rng: () => number,
  pinnedEntry: Deviation | undefined,
  rules: RuleSet,
  deviationSet: readonly Deviation[],
): QuizItem {
  const activeEntries = deviationSet.filter((d) => d.active);
  const baseEntry = pinnedEntry ?? activeEntries[Math.floor(rng() * activeEntries.length)]!;

  if (baseEntry.kind === 'insurance') {
    const tc = tcWrongSide(baseEntry, rng);
    return {
      cards: null,
      up: 'A',
      tc,
      isDeviationSide: false,
      correct: insuranceCorrect(tc) ? 'take-insurance' : 'decline-insurance',
      label: distractorLabel(baseEntry),
      isDistractor: true,
    };
  }

  const flavor: 'close' | 'random' = pinnedEntry ? 'close' : rng() < 0.5 ? 'close' : 'random';

  if (flavor === 'random') {
    const random = buildRandomCandidate(rng, rules);
    if (random) {
      return {
        cards: random.cards,
        up: random.up,
        tc: random.tc,
        isDeviationSide: false,
        correct: isBasicOnly(random.cards, random.up, random.tc, rules).action,
        label: distractorLabel(),
        isDistractor: true,
      };
    }
    // Bounded random search failed (not observed in practice) -- fall
    // through to a CLOSE candidate from baseEntry below instead of throwing.
  }

  const candidate =
    baseEntry.kind === 'pair10'
      ? buildClosePair10Candidate(baseEntry, rng, rules)
      : buildCloseHardCandidate(baseEntry, rng, rules);

  const resolved: Candidate =
    candidate ?? {
      // Guaranteed-safe last resort: identical total/up to baseEntry, tc
      // pushed to the wrong side of its threshold. No two Illustrious 18
      // entries share a (total, up) pair, so no OTHER active deviation can
      // apply here either.
      cards: baseEntry.kind === 'pair10' ? makePair10Cards() : makeHardHand(baseEntry.total!)!,
      up: baseEntry.up!,
      tc: tcWrongSide(baseEntry, rng),
    };

  return {
    cards: resolved.cards,
    up: resolved.up,
    tc: resolved.tc,
    isDeviationSide: false,
    correct: isBasicOnly(resolved.cards, resolved.up, resolved.tc, rules).action,
    label: distractorLabel(baseEntry),
    isDistractor: true,
  };
}

/**
 * Draw a random quiz item from the Illustrious 18.
 *
 * @param seed - Optional seed for reproducibility
 * @param filter - Optional deviation id; when set, always draws that entry
 *   (tc is still randomized within ±2 of its threshold). Additive param —
 *   omitting it preserves the original random-entry behavior exactly.
 * @param rules - Optional ruleset (defaults to DEFAULT_RULES). Selects the
 *   H17 vs S17 Illustrious-18 variant (both the entry pool and the
 *   correctPlay grading) so quiz thresholds/labels and grading stay
 *   consistent with the active profile — additive param, omitting it
 *   preserves v1 (H17) behavior exactly.
 * @param distractorPct - Optional 0-100 chance (default 0, additive) that
 *   this draw is a DISTRACTOR (fake) item instead of a real deviation item:
 *   a scenario that looks like a studied index spot but where the correct
 *   answer is plain basic strategy. See buildDistractorItem. 0 (the
 *   default) never draws a rng() sample for this decision, so omitting the
 *   param preserves today's behavior byte-for-byte.
 * @returns A quiz item
 */
export function drawQuizItem(
  seed?: number,
  filter?: DeviationId,
  rules: RuleSet = DEFAULT_RULES,
  distractorPct = 0,
): QuizItem {
  const rng = mulberry32(seed ?? Date.now());
  const deviationSet = rules.s17 ? ILLUSTRIOUS_18_S17 : ILLUSTRIOUS_18;

  // Resolve the filtered entry up front (if given) so both the distractor
  // and real-item paths below can share it -- identical to the original
  // eager lookup/throw, just hoisted above the new branch point.
  let entry: (typeof deviationSet)[number] | undefined;
  if (filter) {
    const found = deviationSet.find((d) => d.id === filter);
    if (!found) {
      throw new Error(`drawQuizItem: unknown deviation id "${filter}"`);
    }
    entry = found;
  }

  if (distractorPct > 0 && rng() * 100 < distractorPct) {
    return buildDistractorItem(rng, entry, rules, deviationSet);
  }

  // No filter: pick a random entry from the active ruleset's set (this rng()
  // draw only happens here, exactly as before distractorPct existed).
  if (!entry) {
    const entryIndex = Math.floor(rng() * deviationSet.length);
    entry = deviationSet[entryIndex];
  }

  // Generate tc: integer uniform in [threshold - 2, threshold + 2]
  const tc = tcNearThreshold(entry.threshold, rng);

  // Determine isDeviationSide
  const isDeviationSide = entry.dir === 'gte' ? tc >= entry.threshold : tc <= entry.threshold;

  // Construct cards and correct action
  let cards: [Card, Card] | null;
  let correct: Action | 'take-insurance' | 'decline-insurance';

  if (entry.kind === 'insurance') {
    // Insurance: no cards, correct is take/decline based on tc
    cards = null;
    correct = insuranceCorrect(tc) ? 'take-insurance' : 'decline-insurance';
  } else if (entry.kind === 'pair10') {
    // pair10: two ten-value cards
    cards = makePair10Cards();
    // canSurrender: false models the standard index-play situation (surrender
    // unavailable, e.g. a multi-card or post-split hand) — see deviationQuiz
    // surrender-masking fix: with surrender on, basic surrender beats the
    // 16v10/15v10/16v9 deviations at every TC, making those thresholds
    // unlearnable and contradicting the displayed index label.
    const advice = correctPlay(cards, entry.up!, tc, QUIZ_CTX, rules);
    correct = advice.action;
  } else {
    // hard: construct a truly hard (non-pair, non-ace) hand with the specified total
    const totalCards = makeHardHand(entry.total!);
    if (!totalCards) {
      // Fallback: should not happen for valid entries
      throw new Error(`Cannot construct hard total ${entry.total}`);
    }
    cards = totalCards;
    // canSurrender: false — see note above.
    const advice = correctPlay(cards, entry.up!, tc, QUIZ_CTX, rules);
    // Note: no special-casing for 11vA. Under h17 it's inactive, so the engine's
    // basic chart (HARD[11] = Dh) already yields 'double' at every tc; under
    // s17 it's active (vs A the S17 basic chart is H) so correctPlay(rules)
    // applies the index (double at tc >= +1) via the S17 deviations set.
    correct = advice.action;
  }

  return {
    cards,
    up: entry.up || ('A' as Rank), // insurance has no up, use 'A' as placeholder
    tc,
    deviationId: entry.id,
    isDeviationSide,
    correct,
    label: entry.label,
    isDistractor: false,
  };
}
