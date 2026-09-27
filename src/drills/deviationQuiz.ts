import type { Card, Rank } from '../engine/cards';
import { mulberry32 } from '../engine/cards';
import { correctPlay, basicPlay, insuranceCorrect } from '../engine/strategy';
import type { PlayContext } from '../engine/strategy';
import type { Action, Deviation, DeviationId } from '../engine/deviations';
import { indexSetFor } from '../engine/deviations';
import { DEFAULT_RULES } from '../engine/ruleset';
import { drillLegalActions } from './legalActions';
import type { StrategyRules } from '../engine/ruleset';
import { makeHardHand } from './buildHand';
import { weightedIndex } from './weightedDraw';
import { srWeight } from './spacedRepetition';
import type { SrDeck } from './spacedRepetition';

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

/**
 * ctx for a SURRENDER index (RV3), and the one place QUIZ_CTX's assumption has
 * to be reversed.
 *
 * QUIZ_CTX turns surrender OFF so that basic surrender cannot mask the
 * 16v10/15v10/16v9 STAND indices. A surrender index needs the exact opposite:
 * with `canSurrender: false` the engine can never return 'surrender', so every
 * Fab 4 item would be graded against a play the quiz had made unreachable --
 * the same masking bug as the original, pointed the other way, and it would
 * have marked a correct surrender wrong at every true count.
 */
const QUIZ_CTX_SURRENDER: PlayContext = { ...QUIZ_CTX, canSurrender: true };

/** The ctx an entry must be asked under: surrender indices need the play to
 *  be available, every other kind needs it unavailable. */
function ctxFor(entry: Deviation): PlayContext {
  return entry.kind === 'surrender' ? QUIZ_CTX_SURRENDER : QUIZ_CTX;
}

/**
 * The ctx an ITEM was drawn under, for everyone downstream of the draw.
 *
 * The grader and the action bar both need the same answer as `ctxFor`, and
 * both used to hardcode their own: the grader's was `canSurrender: false`
 * for every item, and the action bar's came from `rules.ls`. One derivation,
 * from the item.
 *
 * A distractor carries no `deviationId` and is by construction a cell where
 * no index applies, so it takes the ordinary hard ctx.
 */
export function quizCtxFor(item: QuizItem, rules: StrategyRules): PlayContext {
  if (!item.deviationId) return QUIZ_CTX;
  const entry = indexSetFor(rules).find((d) => d.id === item.deviationId);
  return entry ? ctxFor(entry) : QUIZ_CTX;
}

/**
 * The actions an item may be answered with.
 *
 * Not `drillLegalActions` alone: that answers "what can this HAND do at this
 * TABLE", and a quiz item is also asked under a ctx of the draw's choosing --
 * surrender off for a stand index so basic surrender cannot mask it, on for a
 * Fab 4 item, which is about surrender. An action the ctx excludes can never
 * be the graded-correct answer, so offering it is offering a button that is
 * always wrong: 16 v 10 at TC -2 on the default profile lit Surrender, and
 * surrendering was recorded as a basic error while the table and the chart
 * both said surrender.
 *
 * Lives here rather than in the screen because every input path needs the
 * same answer -- the ActionBar, the keyboard, and the blind ZonePad -- and
 * the one that had its own copy was the ZonePad, which is the one used while
 * driving.
 */
export function quizLegalActions(item: QuizItem, rules: StrategyRules): Action[] {
  if (!item.cards) return [];
  const ctx = quizCtxFor(item, rules);
  const legal = drillLegalActions(item.cards, rules);
  return ctx.canSurrender ? legal : legal.filter((a) => a !== 'surrender');
}

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
function isBasicOnly(cards: [Card, Card], up: Rank, tc: number, rules: StrategyRules): { ok: boolean; action: Action } {
  const withCount = correctPlay(cards, up, tc, QUIZ_CTX, rules);
  const basicOnly = basicPlay(cards, up, QUIZ_CTX, rules);
  /*
   * ...AND AT THE TABLE THE OPERATOR IS ACTUALLY SITTING AT.
   *
   * This check is the only thing behind the sentence "No index applies here
   * -- basic strategy", and it asked ONLY under `QUIZ_CTX`, where surrender
   * does not exist and a Fab 4 index therefore cannot fire. Every cell that
   * carries one passed: the quiz put 16 v 8 at TC +6 on screen -- the
   * highest-value surrender index in the set -- printed that sentence over
   * it, and graded `hit` correct.
   *
   * Comparing count-play with basic-play under the surrender ctx is not
   * enough either: on 16 v 9 the basic play WITH surrender is surrender and
   * `sur16v9` also says surrender, so they agree and the cell still looks
   * clean -- while the item the operator sees says `hit`.
   *
   * So the cell has to be plain basic BOTH ways, and both ways have to give
   * the same answer. A cell that fails that is one where the quiz would be
   * teaching a play the table contradicts.
   */
  if (rules.ls) {
    const atTable = correctPlay(cards, up, tc, QUIZ_CTX_SURRENDER, rules);
    if (atTable.source !== 'basic' || atTable.action !== basicOnly.action) {
      return { ok: false, action: basicOnly.action };
    }
  }
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
 * The tc-wrong-side attempt (same total/up as `entry`) used to be
 * analytically guaranteed to pass, on the grounds that no two Illustrious 18
 * entries share a (total, up) pair. RV3 ended that: `sur16v9` sits on the same
 * cell as the `16v9` STAND index, and `sur15v10` on the same cell as `15v10`,
 * so a tc on the wrong side of one can still be on the trigger side of the
 * other. It is now a strong heuristic rather than a proof -- which costs
 * nothing, because every candidate was already engine-verified by
 * `isBasicOnly` before acceptance and the call site already falls back. The
 * guarantee was load-bearing for the COMMENT, never for the code.
 */
function buildCloseHardCandidate(entry: Deviation, rng: () => number, rules: StrategyRules): Candidate | null {
  const attempts: Array<() => Candidate | null> = [
    () => {
      const cards = makeHardHand(entry.total!, rng);
      return cards ? { cards, up: entry.up!, tc: tcWrongSide(entry, rng) } : null;
    },
    ...adjacentUps(entry.up!).map(
      (up) => () => {
        const cards = makeHardHand(entry.total!, rng);
        return cards ? { cards, up, tc: tcNearThreshold(entry.threshold, rng) } : null;
      },
    ),
    ...adjacentTotals(entry.total!).map(
      (total) => () => {
        const cards = makeHardHand(total, rng);
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
function buildClosePair10Candidate(entry: Deviation, rng: () => number, rules: StrategyRules): Candidate | null {
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
function buildRandomCandidate(rng: () => number, rules: StrategyRules): Candidate | null {
  for (let i = 0; i < RANDOM_MAX_ATTEMPTS; i++) {
    const total = RANDOM_HARD_TOTALS[Math.floor(rng() * RANDOM_HARD_TOTALS.length)]!;
    const up = UP_SPACE[Math.floor(rng() * UP_SPACE.length)]!;
    const tc = RANDOM_TC_MIN + Math.floor(rng() * (RANDOM_TC_MAX - RANDOM_TC_MIN + 1));
    const cards = makeHardHand(total, rng);
    if (!cards) continue;
    if (isBasicOnly(cards, up, tc, rules).ok) {
      return { cards, up, tc };
    }
  }
  return null;
}

/**
 * A distractor cell for `entry` that no index claims, found by walking the
 * count outwards from the wrong side of the threshold.
 *
 * Every step is verified with `isBasicOnly`, the same check every other
 * candidate passes. If nothing in range is clean -- which would mean the
 * cell carries indices at every count the quiz asks about -- the wrong-side
 * count is returned anyway, because a distractor that looks slightly wrong
 * is better than a throw inside a drill; the caller's own label is derived
 * from `isBasicOnly` either way.
 */
function fallbackCandidate(
  entry: Deviation,
  rng: () => number,
  rules: StrategyRules,
): Candidate | null {
  const cards = entry.kind === 'pair10' ? makePair10Cards() : makeHardHand(entry.total!, rng)!;
  const up = entry.up!;
  const first = tcWrongSide(entry, rng);
  const tries = [first, ...[1, 2, 3, 4, 5, 6].flatMap((d) => [first - d, first + d])];
  for (const tc of tries) {
    if (tc < -10 || tc > 10) continue;
    if (isBasicOnly(cards, up, tc, rules).ok) return { cards, up, tc };
  }
  // Nothing on this cell is clean at any count the quiz asks about. Saying
  // so is the point: the caller draws a real item rather than printing a
  // claim that is false.
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
  rules: StrategyRules,
  deviationSet: readonly Deviation[],
): QuizItem | null {
  const activeEntries = deviationSet.filter((d) => d.active);
  const baseEntry = pinnedEntry ?? activeEntries[Math.floor(rng() * activeEntries.length)]!;

  if (baseEntry.kind === 'insurance') {
    const tc = tcWrongSide(baseEntry, rng);
    return {
      cards: null,
      up: 'A',
      tc,
      isDeviationSide: false,
      correct: insuranceCorrect(tc, rules) ? 'take-insurance' : 'decline-insurance',
      label: distractorLabel(baseEntry),
      isDistractor: true };
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
        isDistractor: true };
    }
    // Bounded random search failed (not observed in practice) -- fall
    // through to a CLOSE candidate from baseEntry below instead of throwing.
  }

  /*
   * TRIED PROPERLY BEFORE GIVING UP. Each call shuffles its three
   * perturbations and takes the first that verifies; one call is one pass,
   * and with the stricter check above a single pass can plausibly miss on a
   * cell like 16 v 9 where the neighbours are ambiguous too. Eight passes
   * costs nothing (it is arithmetic on two cards) and turns "no clean
   * distractor found" back into what it should be -- rare.
   */
  let candidate: Candidate | null = null;
  for (let attempt = 0; attempt < 8 && candidate === null; attempt += 1) {
    candidate =
      baseEntry.kind === 'pair10'
        ? buildClosePair10Candidate(baseEntry, rng, rules)
        : buildCloseHardCandidate(baseEntry, rng, rules);
  }

  /*
   * THE LAST RESORT, WHICH IS NOT GUARANTEED AND IS NOW CHECKED.
   *
   * This was documented as safe on the grounds that "no two Illustrious 18
   * entries share a (total, up) pair" -- which RV3 ended, as the comment on
   * `buildCloseHardCandidate` above already says: `sur16v9` sits on the
   * same cell as the `16v9` stand index. So when the bounded search failed,
   * this branch put the operator on a cell where a surrender index fires
   * and labelled it "No index applies here". It was the ONE candidate path
   * with no engine verification behind it, and with surrender indices on it
   * was reached often enough to be most of the distractors for `16v9`.
   *
   * It is now tried like any other candidate, and if it is not clean the
   * search widens outwards from the threshold until it finds a count where
   * nothing fires. `tcWrongSide` stays the first choice so the distractor
   * still looks like the spot being studied.
   */
  /*
   * ...AND NO LAST RESORT THAT LIES.
   *
   * There used to be a "guaranteed-safe" fallback here: same total and up
   * as the studied entry, count pushed to the wrong side, justified by "no
   * two Illustrious 18 entries share a (total, up) pair". RV3 ended that --
   * `sur16v9` sits on the same cell as the `16v9` stand index -- so the one
   * candidate path with no engine verification behind it was the one that
   * printed "no index applies" over a cell carrying an index.
   *
   * `fallbackCandidate` walks the count outwards looking for a clean one.
   * If even that fails, the honest answer is that this index has no clean
   * distractor near it, and the caller draws a REAL item instead.
   */
  const resolved: Candidate | null = candidate ?? fallbackCandidate(baseEntry, rng, rules);
  if (resolved === null) return null;

  return {
    cards: resolved.cards,
    up: resolved.up,
    tc: resolved.tc,
    isDeviationSide: false,
    correct: isBasicOnly(resolved.cards, resolved.up, resolved.tc, rules).action,
    label: distractorLabel(baseEntry),
    isDistractor: true };
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
 * @param srDeck - RV4 (docs/BACKLOG.md, spaced-repetition): optional SR deck
 *   (deviationId -> SrCard), mirroring flashcards.ts. ONLY affects the no-filter
 *   real-item entry pick (the `!entry` branch below) -- a pinned `filter` always
 *   draws that exact entry regardless (weighting is moot when pinned), and
 *   distractor base-entry selection stays uniform. An empty/omitted deck (the
 *   default) makes every entry weight SR_NEW_WEIGHT (all equal) -- a uniform pick
 *   identical to the pre-weighting `Math.floor(rng() * n)` (weightedIndex's
 *   "matches Math.floor" test).
 * @param now - wall-clock epoch ms, used to weight entries by SR due-ness
 * @returns A quiz item
 */
export function drawQuizItem(
  seed?: number,
  filter?: DeviationId,
  rules: StrategyRules = DEFAULT_RULES,
  distractorPct = 0,
  srDeck: SrDeck = {},
  now = 0,
): QuizItem {
  const rng = mulberry32(seed ?? Date.now());
  const deviationSet = indexSetFor(rules);

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
    // `null` when no cell near this index is plain basic strategy both in
    // the quiz's ctx and at the table -- see buildDistractorItem. A real
    // item is always available, so the drill continues.
    const distractor = buildDistractorItem(rng, entry, rules, deviationSet);
    if (distractor) return distractor;
  }

  // No filter: pick an entry from the active ruleset's set, weighted by SR
  // due-ness (RV4) -- this rng() draw only happens here, exactly as before
  // distractorPct existed.
  if (!entry) {
    const weights = deviationSet.map((d) => srWeight(srDeck[d.id], now));
    const entryIndex = weightedIndex(rng, weights);
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
    correct = insuranceCorrect(tc, rules) ? 'take-insurance' : 'decline-insurance';
  } else if (entry.kind === 'pair10') {
    // pair10: two ten-value cards
    cards = makePair10Cards();
    // canSurrender: false models the standard index-play situation (surrender
    // unavailable, e.g. a multi-card or post-split hand) — see deviationQuiz
    // surrender-masking fix: with surrender on, basic surrender beats the
    // 16v10/15v10/16v9 deviations at every TC, making those thresholds
    // unlearnable and contradicting the displayed index label.
    const advice = correctPlay(cards, entry.up!, tc, ctxFor(entry), rules);
    correct = advice.action;
  } else {
    // hard: construct a truly hard (non-pair, non-ace) hand with the specified total
    // V4-2: vary the composition. The index is on the TOTAL, so the cards
    // may change freely -- and must, or "16 v 10" is learned as one card pair.
    const totalCards = makeHardHand(entry.total!, rng);
    if (!totalCards) {
      // Fallback: should not happen for valid entries
      throw new Error(`Cannot construct hard total ${entry.total}`);
    }
    cards = totalCards;
    // canSurrender per ctxFor: false for a hard index (so basic surrender
    // cannot mask it), true for a surrender index (so the play it teaches is
    // reachable at all).
    const advice = correctPlay(cards, entry.up!, tc, ctxFor(entry), rules);
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
    isDistractor: false };
}
