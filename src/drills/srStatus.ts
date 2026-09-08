/**
 * srStatus.ts — pure, unit-testable derivations of an SrDeck's CURRENT STATE
 * for display (Stats' "Spaced repetition" panels). The scheduler
 * (spacedRepetition.ts) decides what the operator is drawn next; until now
 * nothing summarized what it's actually holding. This module turns the raw
 * per-item `box`/`dueAt`/`lapses` fields into the handful of numbers a small
 * histogram can render: a Leitner box histogram, an unseen count, due-now /
 * due-soon counts, and a lapses ranking. It also owns `boxBarPercents`, the
 * bar-height scaling itself — deliberately a PURE function here rather than
 * inline arithmetic in Stats.tsx, specifically so the "does this actually
 * read as a histogram" question can be answered by a fast unit-tested ratio
 * assertion instead of only a rendered-pixel measurement (see its own doc
 * comment for the real bug this caught: scaling against Unseen collapsed
 * the whole box distribution into six invisible slivers).
 *
 * PURE: `now` is always supplied by the caller (Stats.tsx captures ONE
 * `Date.now()` per render and threads it through every section, this one
 * included) — nothing here reads the real clock. An implementation that
 * quietly read `Date.now()` instead of its `now` argument would pass almost
 * every other test in this file by coincidence in a fast single-process
 * run — see the "actually uses now" test in srStatus.test.ts, which exists
 * specifically to catch that failure mode.
 *
 * UNIVERSE SIZE (used only to compute "unseen") is NOT owned by this module
 * — it is passed in as `universeSize` by the caller. An earlier draft of
 * this plan hardcoded the flashcard universe as the literal 330, reasoning
 * that `generateAllCells()` wasn't exported from flashcards.ts yet. That was
 * overruled by reviewer note: 330 is the DENOMINATOR of this panel's
 * headline figure ("187 of 330 studied") and of the Unseen bucket — a frozen
 * literal would silently go stale the moment the cell universe's shape ever
 * changed (a new hand type, a rules variant, a fix to makeHardHand), with
 * every percentage on the screen quietly wrong and no test failing, because
 * the test would be asserting against the same frozen number. Stats.tsx
 * instead calls `generateAllCells().length` (now exported from
 * src/drills/flashcards.ts) itself and passes the live count in here; the
 * deviation-quiz side passes `indexSetFor(rules).length` (always 18).
 */

import type { SrCard, SrDeck } from './spacedRepetition';
import { isDue, MAX_BOX } from './spacedRepetition';

/** How far ahead "due soon" looks — a display-only window, independent of
 * any scheduling constant in spacedRepetition.ts (which has no notion of
 * "soon", only "due"). */
export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

/** How many "most often forgotten" rows to surface — keeps the list a
 * quick scan rather than a second table; ties broken deterministically by
 * key, with an explicit "+N more" count for anything beyond this. */
export const MOST_LAPSED_LIMIT = 5;

/** Floor applied to any NONZERO box's bar percentage (see `boxBarPercents`
 * below) so a lone item never rounds down to a sliver that reads as
 * "empty" next to a much larger sibling box. */
export const MIN_NONZERO_BAR_PCT = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LapsedEntry {
  key: string;
  box: number;
  lapses: number;
  reviews: number;
}

export interface SrDeckSummary {
  universeSize: number;
  /** Never reviewed at all: universeSize - reviewed count, floored at 0
   * (a stale/corrupt blob larger than the declared universe must never
   * produce a negative "unseen"). */
  unseen: number;
  /** Reviewed items per Leitner box, index 0..MAX_BOX (length MAX_BOX+1). */
  byBox: number[];
  /** Reviewed items that are due right now. Excludes unseen material —
   * unseen items are always "due" by the SCHEDULER's own contract
   * (isDue(undefined, now) === true, so srWeight draws them preferentially)
   * but surfacing that literally here would make a fresh install's "Due
   * now" read as the full universe size on day one, which is technically
   * correct and completely useless as a status readout. */
  dueNow: number;
  /** Reviewed items due within DUE_SOON_MS but not yet due. */
  dueSoon: number;
  /** Days overdue (fractional) on the single most-overdue reviewed item,
   * or null if nothing in the deck is currently overdue. */
  maxOverdueDays: number | null;
  /** Top MOST_LAPSED_LIMIT reviewed items by lapses desc (ties broken by
   * key asc, for determinism), lapses > 0 only. */
  mostLapsed: LapsedEntry[];
  /** How many additional items have lapses > 0 beyond the ones listed —
   * feeds a "+N more" suffix. 0 when mostLapsed already contains every
   * lapsed item. */
  moreLapsedCount: number;
}

/**
 * Summarize an SrDeck's current state. Single pass over `Object.entries`;
 * O(n log n) only for the final lapses sort. Never mutates `deck`, never
 * touches localStorage, never reads the real clock — read-only, by design
 * (a status view that could edit the scheduler it's reporting on would
 * defeat the point of having an honest one).
 */
export function summarizeSrDeck(deck: SrDeck, universeSize: number, now: number): SrDeckSummary {
  const entries = Object.entries(deck);
  const byBox = new Array(MAX_BOX + 1).fill(0) as number[];
  let dueNow = 0;
  let dueSoon = 0;
  let maxOverdueDays: number | null = null;
  const lapsed: LapsedEntry[] = [];

  for (const [key, card] of entries) {
    byBox[card.box] = (byBox[card.box] ?? 0) + 1;

    if (isDue(card, now)) {
      dueNow += 1;
      const overdueDays = (now - card.dueAt) / DAY_MS;
      if (maxOverdueDays === null || overdueDays > maxOverdueDays) maxOverdueDays = overdueDays;
    } else if (card.dueAt - now <= DUE_SOON_MS) {
      dueSoon += 1;
    }

    if (card.lapses > 0) {
      lapsed.push({ key, box: card.box, lapses: card.lapses, reviews: card.reviews });
    }
  }

  lapsed.sort((a, b) => (b.lapses !== a.lapses ? b.lapses - a.lapses : a.key.localeCompare(b.key)));

  return {
    universeSize,
    unseen: Math.max(0, universeSize - entries.length),
    byBox,
    dueNow,
    dueSoon,
    maxOverdueDays,
    mostLapsed: lapsed.slice(0, MOST_LAPSED_LIMIT),
    moreLapsedCount: Math.max(0, lapsed.length - MOST_LAPSED_LIMIT),
  };
}

/**
 * Per-box bar heights, as a percentage of THIS ROW'S OWN largest BOX count
 * (Design Decision D4) — `Unseen` is DELIBERATELY EXCLUDED from this scale.
 *
 * REGRESSION this function exists to prevent: the first version of this
 * panel scaled all seven bars (six Leitner boxes plus an "Unseen" column)
 * against one shared maximum. Measured live with a representative 15-card
 * deck against the real 330-cell flashcard universe: Unseen = 315, every
 * box = 2-3. Against a shared max of 315, every box bar rendered at
 * 3px/64px — six near-invisible slivers next to one dominant Unseen
 * column, i.e. the ENTIRE Leitner distribution this panel exists to show
 * was practically invisible. It also gets WORSE the more representative
 * the state is: Unseen only stops dominating once most of the universe has
 * been studied. Unseen is already fully and exactly conveyed by the
 * panel's headline ("187 of 330 studied"), so it does not need — and must
 * not be given — a seat on the same scale as the six boxes.
 *
 * `count === 0` always renders as exactly 0% (never floored) so an empty
 * box is visually distinguishable from a merely-small one. Every NONZERO
 * count is floored at `MIN_NONZERO_BAR_PCT` so a lone item survives next to
 * a much larger sibling box instead of rounding down to nothing — the
 * degenerate, single-item version of the same "invisible bar" bug.
 */
export function boxBarPercents(byBox: readonly number[]): number[] {
  const maxBox = Math.max(1, ...byBox);
  return byBox.map((count) => {
    if (count <= 0) return 0;
    return Math.max(MIN_NONZERO_BAR_PCT, Math.min(100, (count / maxBox) * 100));
  });
}

/** Re-exported so callers building an SrCard-shaped test fixture or display
 * row don't need a second import from spacedRepetition.ts just for the type. */
export type { SrCard, SrDeck };
