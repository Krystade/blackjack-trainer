import type { Rank } from './cards';

export type Action = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

export type DeviationId =
  | 'ins'
  | '16v10'
  | '15v10'
  | 'TTv5'
  | 'TTv6'
  | '10v10'
  | '12v3'
  | '12v2'
  | '11vA'
  | '9v2'
  | '10vA'
  | '9v7'
  | '16v9'
  | '13v2'
  | '12v4'
  | '12v5'
  | '12v6'
  | '13v3'
  // Fab 4 surrender indices (RV3). Prefixed `sur` because the same cell can
  // carry BOTH a surrender index and a hard-total index -- 16 v 9 is a
  // surrender decision at 0 and a STAND decision at +4/+5, and they are not
  // the same play. An id collision there would have silently merged them.
  | 'sur14v10'
  | 'sur15v9'
  | 'sur15v10'
  | 'sur15vA'
  | 'sur16v8'
  | 'sur16v9'
  // BJA H17 extras (B9, opt-in per profile, H17 only). Soft cells are named
  // by their two cards (A8 = soft 19, A6 = soft 17), like the chart prints them.
  | '16vA'
  | '15vA'
  | '8v6'
  | 'A8v4'
  | 'A8v5'
  | 'A8v6'
  | 'A6v2'
  | 'TTv4';

export interface Deviation {
  id: DeviationId;
  kind: 'insurance' | 'hard' | 'soft' | 'pair10' | 'surrender';
  total?: number; // the hard total (kind 'hard'/'surrender') or the soft total (kind 'soft')
  up?: Rank; // '2'..'10','A' ('10' covers J/Q/K via upIndex)
  action: Action | 'take-insurance';
  threshold: number;
  dir: 'gte' | 'lte'; // deviate when tc >= threshold (gte) or tc <= threshold (lte)
  active: boolean; // 11vA inactive: absorbed into H17 basic
  label: string; // e.g. "16 v 10: stand at TC ≥ 0"
  extra?: true; // set on every BJA H17 extra, so surfaces can mark them as extras
  // R6: `lte` entries only -- the play at and above the published index
  // (threshold + 1). The user is always shown that form ("12 v 6: stand at
  // TC ≥ −3"), never the stored hit threshold; see drills/indexDisplay.ts.
  above?: Action;
  /**
   * C11 (audit 2026-10-29): a zero-count cell -- one the BJA H17 chart
   * (docs/sources/BJA_H17.pdf) prints as `0-` ("the deviation happens at any
   * negative running count"), and the 16 v 10 stand at 0. It is decided by
   * the running count's SIGN, not by the rounded true count: under truncate
   * or round, RC -3 with 5 decks left rounds to TC 0 and would read as "not
   * negative". A negative RC reads as TC -1, otherwise TC 0, which is what the
   * floor convention already gives, so floor is unchanged.
   */
  rcSign?: true;
}

// VERIFIED H17-ADJUSTED INDICES — transcribed verbatim from the task-6 brief.
// Do NOT adjust from S17 memory (10vA is +3 not +4, 16v9 is +4 not +5,
// 12v6 is -3 not -1 -- published stand index, stored as hit ≤ -4 -- and
// 11vA is inactive under H17).
export const ILLUSTRIOUS_18: Deviation[] = [
  { id: 'ins', kind: 'insurance', action: 'take-insurance', threshold: 3, dir: 'gte', active: true, label: 'Insurance: take at TC ≥ +3' },
  { id: '16v10', kind: 'hard', total: 16, up: '10', action: 'stand', threshold: 0, dir: 'gte', active: true, rcSign: true, label: '16 v 10: stand at TC ≥ 0' },
  { id: '15v10', kind: 'hard', total: 15, up: '10', action: 'stand', threshold: 4, dir: 'gte', active: true, label: '15 v 10: stand at TC ≥ +4' },
  { id: 'TTv5', kind: 'pair10', up: '5', action: 'split', threshold: 5, dir: 'gte', active: true, label: '10,10 v 5: split at TC ≥ +5' },
  { id: 'TTv6', kind: 'pair10', up: '6', action: 'split', threshold: 4, dir: 'gte', active: true, label: '10,10 v 6: split at TC ≥ +4' },
  { id: '10v10', kind: 'hard', total: 10, up: '10', action: 'double', threshold: 4, dir: 'gte', active: true, label: '10 v 10: double at TC ≥ +4' },
  { id: '12v3', kind: 'hard', total: 12, up: '3', action: 'stand', threshold: 2, dir: 'gte', active: true, label: '12 v 3: stand at TC ≥ +2' },
  { id: '12v2', kind: 'hard', total: 12, up: '2', action: 'stand', threshold: 3, dir: 'gte', active: true, label: '12 v 2: stand at TC ≥ +3' },
  { id: '11vA', kind: 'hard', total: 11, up: 'A', action: 'double', threshold: 0, dir: 'gte', active: false, label: '11 v A: always double under H17 (S17-only index)' },
  { id: '9v2', kind: 'hard', total: 9, up: '2', action: 'double', threshold: 1, dir: 'gte', active: true, label: '9 v 2: double at TC ≥ +1' },
  { id: '10vA', kind: 'hard', total: 10, up: 'A', action: 'double', threshold: 3, dir: 'gte', active: true, label: '10 v A: double at TC ≥ +3 (H17)' },
  { id: '9v7', kind: 'hard', total: 9, up: '7', action: 'double', threshold: 3, dir: 'gte', active: true, label: '9 v 7: double at TC ≥ +3' },
  { id: '16v9', kind: 'hard', total: 16, up: '9', action: 'stand', threshold: 4, dir: 'gte', active: true, label: '16 v 9: stand at TC ≥ +4 (H17)' },
  { id: '13v2', kind: 'hard', total: 13, up: '2', action: 'hit', threshold: -2, dir: 'lte', above: 'stand', active: true, label: '13 v 2: stand at TC ≥ −1; hit below' },
  { id: '12v4', kind: 'hard', total: 12, up: '4', action: 'hit', threshold: -1, dir: 'lte', above: 'stand', active: true, rcSign: true, label: '12 v 4: stand at TC ≥ 0; hit below' },
  { id: '12v5', kind: 'hard', total: 12, up: '5', action: 'hit', threshold: -3, dir: 'lte', above: 'stand', active: true, label: '12 v 5: stand at TC ≥ −2; hit below' },
  // F6: published H17 index is "stand at TC ≥ −3", so -- like every other
  // negative index here -- the stored hit threshold is the index minus one.
  { id: '12v6', kind: 'hard', total: 12, up: '6', action: 'hit', threshold: -4, dir: 'lte', above: 'stand', active: true, label: '12 v 6: stand at TC ≥ −3; hit below (H17)' },
  { id: '13v3', kind: 'hard', total: 13, up: '3', action: 'hit', threshold: -3, dir: 'lte', above: 'stand', active: true, label: '13 v 3: stand at TC ≥ −2; hit below' },
];

// VERIFIED S17-ADJUSTED INDICES — derived from H17 ILLUSTRIOUS_18 with four overrides
// per spec §3: 11vA (+1 active), 16v9 (+5), 10vA (+4), 12v6 (−1 lte).
// Insurance threshold remains +3 in both sets.
export const ILLUSTRIOUS_18_S17: Deviation[] = ILLUSTRIOUS_18.map((dev) => {
  const overrides: Record<string, Partial<Deviation>> = {
    '11vA': { active: true, threshold: 1, label: '11 v A: double at TC ≥ +1 (S17)' },
    '16v9': { threshold: 5, label: '16 v 9: stand at TC ≥ +5' },
    '10vA': { threshold: 4, label: '10 v A: double at TC ≥ +4' },
    '12v6': { threshold: -2, label: '12 v 6: stand at TC ≥ −1; hit below (S17)' },
  };
  if (dev.id in overrides) {
    return { ...dev, ...overrides[dev.id] };
  }
  return dev;
});

/**
 * Check if a deviation index is active for the given ruleset.
 *
 * @param id - The deviation ID to check
 * @param rules - The ruleset (H17 or S17)
 * @returns true if the index is active, false otherwise
 */
export function isIndexActive(
  id: DeviationId,
  rules: { s17: boolean; surrenderIndices?: boolean; bjaExtras?: boolean },
): boolean {
  // Goes through indexSetFor rather than the two base arrays so a surrender id
  // answers honestly: absent when the profile has indices off, and absent under
  // S17 for the two cells (16 v 8, 16 v 9) that set does not carry. A lookup
  // against ILLUSTRIOUS_18 alone would have said `false` for every Fab 4 id
  // even with the feature switched on, silently hiding them from the quiz
  // filter that calls this.
  const deviation = indexSetFor({ decks: 6, ...rules }).find((d) => d.id === id);
  return deviation?.active ?? false;
}

/**
 * The index set for a ruleset, keyed by dealer soft-17 rule AND deck count
 * (operator request).
 *
 * The charts have always selected by deck class (d1/d2/d68 in engine/charts),
 * so a single-deck profile was already graded against single-deck BASIC
 * strategy — but its INDICES were the shoe set. This closes that gap.
 *
 * Deliberately, only ONE per-deck delta ships: the insurance index, published
 * by multiple sources as 1D 1.4 / 2D 2.4 / 6D 3.0. Because this app's true
 * count is an integer (see engine/count.ts), 2.4 and 3.0 both mean "take at
 * TC >= 3", and only single deck actually moves — to TC >= 2.
 *
 * The remaining seventeen are NOT varied by deck. The published Illustrious 18
 * is a single set; the differences that exist between 4- and 6-deck tables are
 * small and disputed between sources, and practitioners commonly run shoe
 * indices at every deck count because the EV cost is negligible. Inventing
 * per-deck thresholds to look thorough is precisely how a trainer starts
 * teaching something no book says — so a verified delta is a data addition
 * here, and nothing more.
 *
 * The BJA H17 extras (B9) are opt-in (`bjaExtras`, absent = off) and exist
 * under H17 only: the chart they come from is an H17 chart and no S17 values
 * were sourced, so an S17 profile with the option on gets no extras rather
 * than invented ones. Like the I18 above they are shoe values applied at every
 * deck count, and they come after the Fab 4 so every existing entry keeps its
 * position in the set.
 */
export function indexSetFor(rules: {
  decks: number;
  s17: boolean;
  surrenderIndices?: boolean;
  bjaExtras?: boolean;
}): Deviation[] {
  const base = rules.s17 ? ILLUSTRIOUS_18_S17 : ILLUSTRIOUS_18;
  const withSurrender = rules.surrenderIndices && rules.decks >= FAB_4_MIN_DECKS
    ? [...base, ...(rules.s17 ? FAB_4_S17 : FAB_4_H17)]
    : base;
  const withExtras = rules.bjaExtras && !rules.s17
    ? [...withSurrender, ...BJA_H17_EXTRAS]
    : withSurrender;
  if (rules.decks > 1) return withExtras;

  return withExtras.map((dev) =>
    dev.id === 'ins'
      ? { ...dev, threshold: 2, label: 'Insurance: take at TC ≥ +2 (single deck)' }
      : dev,
  );
}

/**
 * C1 (audit 2026-10-29): the Fab 4 are SHOE values -- Wizard of Odds and
 * CountingEdge publish them for six decks, and the BJA H17 chart is a shoe
 * chart. The app's single- and double-deck basic charts (transcribed from the
 * Wizard of Odds 1D/2D charts) disagree with them at TC 0: 1D plays 15 v 10 and
 * 16 v 9 as hits and 7,7 v 10 as Rs, 2D H17 hits 16 v 9. So below four decks the
 * set is absent rather than invented, the policy already used for the S17
 * 16 v 8 / 16 v 9 cells: those tables surrender by their own basic chart.
 */
export const FAB_4_MIN_DECKS = 4;

/**
 * Every surrender index in the app, and the ONLY place a surrender threshold is
 * written down. Sourced in `docs/sources/verified-surrender-indices.md`; nothing
 * here came from memory.
 *
 * Direction is `gte` for all of them, and that is the whole reading. The
 * Blackjack Apprenticeship chart prints some of these cells with a trailing `-`
 * ("the deviation happens at that true count and below"), which looks like an
 * `lte` threshold and is not one: those cells sit on hands where basic strategy
 * ALREADY surrenders, so the deviation below the index is to STOP. Supply the
 * basic action and every cell resolves to the same plain sentence --
 * **surrender when TC >= index** -- which is why one rule covers all six and
 * why `dir` is uniform. An implementation that transcribed the `-` cells
 * literally would have inverted them.
 *
 * The rule is genuinely bidirectional even so: it ADDS surrender where basic
 * hits (16 v 8 at +4) and REMOVES it where basic surrenders (15 v 10 below 0).
 *
 * Cells with no index here surrender per the basic chart and are untouched:
 * 16 v 10, 16 v A, and 17 v A under H17.
 */
export const FAB_4_H17: Deviation[] = [
  // Two sources agree: BJA H17 chart `2+`, and the Fab 4 as published by both
  // Wizard of Odds and CountingEdge.
  { id: 'sur15v9', kind: 'surrender', total: 15, up: '9', action: 'surrender', threshold: 2, dir: 'gte', active: true, label: '15 v 9: surrender at TC ≥ +2' },
  // Three sources: BJA chart `0-`, WoO Fab 4 (+0), CountingEdge Fab 4 (0).
  { id: 'sur15v10', kind: 'surrender', total: 15, up: '10', action: 'surrender', threshold: 0, dir: 'gte', active: true, rcSign: true, label: '15 v 10: surrender at TC ≥ 0' },
  // One chart plus a structural argument (see the doc's §1a): BJA prints this
  // cell `-1+`, and on this grid a `+` suffix marks a hand their own basic does
  // NOT surrender. Weakest-justified row in the set.
  { id: 'sur15vA', kind: 'surrender', total: 15, up: 'A', action: 'surrender', threshold: -1, dir: 'gte', active: true, label: '15 v A: surrender at TC ≥ −1 (H17)' },
  // Single source (BJA chart `4+`) after a second search pass.
  { id: 'sur16v8', kind: 'surrender', total: 16, up: '8', action: 'surrender', threshold: 4, dir: 'gte', active: true, label: '16 v 8: surrender at TC ≥ +4' },
  // Single source (BJA chart `-1-`). NOT the same play as the Illustrious 18's
  // 16 v 9 STAND index (+4 H17 / +5 S17) -- same cell, different decision.
  { id: 'sur16v9', kind: 'surrender', total: 16, up: '9', action: 'surrender', threshold: 0, dir: 'gte', active: true, label: '16 v 9: surrender at TC ≥ 0' },
  // Two sources (WoO + CountingEdge) but BOTH S17: the BJA H17 chart has no 14
  // row at all, so no H17-specific source exists for the highest-value Fab 4
  // play. Carried at the S17 value deliberately and flagged in the doc.
  { id: 'sur14v10', kind: 'surrender', total: 14, up: '10', action: 'surrender', threshold: 3, dir: 'gte', active: true, label: '14 v 10: surrender at TC ≥ +3' },
];

/**
 * The S17 set is the Fab 4 proper, two-sourced cell-for-cell (Wizard of Odds
 * and CountingEdge, which attributes them to Schlesinger).
 *
 * It is FOUR entries, not six. No S17 source was found for 16 v 8 or 16 v 9, so
 * they are absent rather than carried over from the H17 chart -- under S17 those
 * two cells simply play basic (16 v 9 surrenders always, 16 v 8 hits always),
 * which is the correct basic play and costs nothing. Inventing the two missing
 * numbers to make the table look symmetrical is exactly how a trainer starts
 * teaching something no source says.
 *
 * 15 v A differs from H17 by two counts (+1 vs −1), which is the expected
 * direction: H17 makes 15 v A worse, so surrender starts sooner.
 */
export const FAB_4_S17: Deviation[] = [
  { id: 'sur15v9', kind: 'surrender', total: 15, up: '9', action: 'surrender', threshold: 2, dir: 'gte', active: true, label: '15 v 9: surrender at TC ≥ +2' },
  { id: 'sur15v10', kind: 'surrender', total: 15, up: '10', action: 'surrender', threshold: 0, dir: 'gte', active: true, rcSign: true, label: '15 v 10: surrender at TC ≥ 0' },
  { id: 'sur15vA', kind: 'surrender', total: 15, up: 'A', action: 'surrender', threshold: 1, dir: 'gte', active: true, label: '15 v A: surrender at TC ≥ +1 (S17)' },
  { id: 'sur14v10', kind: 'surrender', total: 14, up: '10', action: 'surrender', threshold: 3, dir: 'gte', active: true, label: '14 v 10: surrender at TC ≥ +3' },
];

/**
 * B9: the eight indices the Blackjack Apprenticeship H17 chart prints beyond
 * the Illustrious 18 and the Fab 4, opt-in per profile (`bjaExtras`) and H17
 * only -- see `indexSetFor`. Every value below was read off the chart itself
 * (`docs/sources/BJA_H17.pdf`, re-read 2026-10-17), not from memory.
 *
 * Chart legend, as printed:
 *   `+` after the index: "the deviation happens at that true count and above"
 *   `-` after the index: "the deviation happens at the true count and below"
 *   `0-`: "the deviation happens at any negative running count"
 *   `0+`: "the deviation occurs at any positive running count"
 *
 * A,8 v 6's "0-" is stored the way 12 v 4's "0-" already is: `stand` at
 * TC <= -1 on the app's integer true count, published index 0.
 *
 * 16 v A and 15 v A are stand indices on cells this chart surrenders, so with
 * late surrender offered on a two-card hand the surrender step in
 * `resolveAsTotal` settles them first; the stand index decides only when
 * surrender is unavailable.
 */
// The cells, as printed (index, then the basic play the cell's colour encodes):
// 16 v A — BJA H17 chart, hard 16 row, dealer A: "3+" on an H cell (surrender table: "SUR")
// 15 v A — BJA H17 chart, hard 15 row, dealer A: "5+" on an H cell (surrender table: "-1+")
// 8 v 6 — BJA H17 chart, hard 8 row, dealer 6: "2+" on an H cell
// A,8 v 4 — BJA H17 chart, soft A,8 row, dealer 4: "3+" on an S cell
// A,8 v 5 — BJA H17 chart, soft A,8 row, dealer 5: "1+" on an S cell
// A,8 v 6 — BJA H17 chart, soft A,8 row, dealer 6: "0-" on a Ds cell
// A,6 v 2 — BJA H17 chart, soft A,6 row, dealer 2: "1+" on an H cell
// 10,10 v 4 — BJA H17 chart, pairs T,T row, dealer 4: "6+" on an N cell (no split: stands as hard 20)
export const BJA_H17_EXTRAS: Deviation[] = [
  { id: '16vA', kind: 'hard', total: 16, up: 'A', action: 'stand', threshold: 3, dir: 'gte', active: true, extra: true, label: '16 v A: stand at TC ≥ +3 (no surrender)' },
  { id: '15vA', kind: 'hard', total: 15, up: 'A', action: 'stand', threshold: 5, dir: 'gte', active: true, extra: true, label: '15 v A: stand at TC ≥ +5 (no surrender)' },
  { id: '8v6', kind: 'hard', total: 8, up: '6', action: 'double', threshold: 2, dir: 'gte', active: true, extra: true, label: '8 v 6: double at TC ≥ +2' },
  { id: 'A8v4', kind: 'soft', total: 19, up: '4', action: 'double', threshold: 3, dir: 'gte', active: true, extra: true, label: 'A,8 v 4: double at TC ≥ +3' },
  { id: 'A8v5', kind: 'soft', total: 19, up: '5', action: 'double', threshold: 1, dir: 'gte', active: true, extra: true, label: 'A,8 v 5: double at TC ≥ +1' },
  { id: 'A8v6', kind: 'soft', total: 19, up: '6', action: 'stand', threshold: -1, dir: 'lte', above: 'double', active: true, extra: true, rcSign: true, label: 'A,8 v 6: double at TC ≥ 0; stand below' },
  { id: 'A6v2', kind: 'soft', total: 17, up: '2', action: 'double', threshold: 1, dir: 'gte', active: true, extra: true, label: 'A,6 v 2: double at TC ≥ +1' },
  { id: 'TTv4', kind: 'pair10', up: '4', action: 'split', threshold: 6, dir: 'gte', active: true, extra: true, label: '10,10 v 4: split at TC ≥ +6' },
];
