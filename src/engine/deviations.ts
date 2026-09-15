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
  | 'sur16v9';

export interface Deviation {
  id: DeviationId;
  kind: 'insurance' | 'hard' | 'pair10' | 'surrender';
  total?: number; // for kind 'hard'
  up?: Rank; // '2'..'10','A' ('10' covers J/Q/K via upIndex)
  action: Action | 'take-insurance';
  threshold: number;
  dir: 'gte' | 'lte'; // deviate when tc >= threshold (gte) or tc <= threshold (lte)
  active: boolean; // 11vA inactive: absorbed into H17 basic
  label: string; // e.g. "16 v 10: stand at TC ≥ 0"
}

// VERIFIED H17-ADJUSTED INDICES — transcribed verbatim from the task-6 brief.
// Do NOT adjust from S17 memory (10vA is +3 not +4, 16v9 is +4 not +5,
// 12v6 is -3 not -1, 11vA is inactive under H17).
export const ILLUSTRIOUS_18: Deviation[] = [
  { id: 'ins', kind: 'insurance', action: 'take-insurance', threshold: 3, dir: 'gte', active: true, label: 'Insurance: take at TC ≥ +3' },
  { id: '16v10', kind: 'hard', total: 16, up: '10', action: 'stand', threshold: 0, dir: 'gte', active: true, label: '16 v 10: stand at TC ≥ 0' },
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
  { id: '13v2', kind: 'hard', total: 13, up: '2', action: 'hit', threshold: -2, dir: 'lte', active: true, label: '13 v 2: hit at TC ≤ −2' },
  { id: '12v4', kind: 'hard', total: 12, up: '4', action: 'hit', threshold: -1, dir: 'lte', active: true, label: '12 v 4: hit at any negative TC' },
  { id: '12v5', kind: 'hard', total: 12, up: '5', action: 'hit', threshold: -3, dir: 'lte', active: true, label: '12 v 5: hit at TC ≤ −3' },
  { id: '12v6', kind: 'hard', total: 12, up: '6', action: 'hit', threshold: -3, dir: 'lte', active: true, label: '12 v 6: hit at TC ≤ −3 (H17)' },
  { id: '13v3', kind: 'hard', total: 13, up: '3', action: 'hit', threshold: -3, dir: 'lte', active: true, label: '13 v 3: hit at TC ≤ −3' },
];

// VERIFIED S17-ADJUSTED INDICES — derived from H17 ILLUSTRIOUS_18 with four overrides
// per spec §3: 11vA (+1 active), 16v9 (+5), 10vA (+4), 12v6 (−1 lte).
// Insurance threshold remains +3 in both sets.
export const ILLUSTRIOUS_18_S17: Deviation[] = ILLUSTRIOUS_18.map((dev) => {
  const overrides: Record<string, Partial<Deviation>> = {
    '11vA': { active: true, threshold: 1, label: '11 v A: double at TC ≥ +1 (S17)' },
    '16v9': { threshold: 5, label: '16 v 9: stand at TC ≥ +5' },
    '10vA': { threshold: 4, label: '10 v A: double at TC ≥ +4' },
    '12v6': { threshold: -2, label: '12 v 6: hit at TC ≤ −2 (S17)' },
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
  rules: { s17: boolean; surrenderIndices?: boolean },
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
 */
export function indexSetFor(rules: {
  decks: number;
  s17: boolean;
  surrenderIndices?: boolean;
}): Deviation[] {
  const base = rules.s17 ? ILLUSTRIOUS_18_S17 : ILLUSTRIOUS_18;
  const withSurrender = rules.surrenderIndices
    ? [...base, ...(rules.s17 ? FAB_4_S17 : FAB_4_H17)]
    : base;
  if (rules.decks > 1) return withSurrender;

  return withSurrender.map((dev) =>
    dev.id === 'ins'
      ? { ...dev, threshold: 2, label: 'Insurance: take at TC ≥ +2 (single deck)' }
      : dev,
  );
}

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
  { id: 'sur15v10', kind: 'surrender', total: 15, up: '10', action: 'surrender', threshold: 0, dir: 'gte', active: true, label: '15 v 10: surrender at TC ≥ 0' },
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
  { id: 'sur15v10', kind: 'surrender', total: 15, up: '10', action: 'surrender', threshold: 0, dir: 'gte', active: true, label: '15 v 10: surrender at TC ≥ 0' },
  { id: 'sur15vA', kind: 'surrender', total: 15, up: 'A', action: 'surrender', threshold: 1, dir: 'gte', active: true, label: '15 v A: surrender at TC ≥ +1 (S17)' },
  { id: 'sur14v10', kind: 'surrender', total: 14, up: '10', action: 'surrender', threshold: 3, dir: 'gte', active: true, label: '14 v 10: surrender at TC ≥ +3' },
];
