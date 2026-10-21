import { SIDE_BET_ROWS } from './generated';
import { HI_LO_COUNT } from './counts';
import type { SideCountDef } from './counts';
import type { SideBetId } from './payTables';

/**
 * Wave L: what the app knows about one side bet at one game, read from the
 * generated table (scripts/sideBetsGenerate.test.ts writes generated.ts:
 * every preset pay table at 1, 2, 6 and 8 decks, Buster at S17 and H17,
 * simulated with every candidate count -- see select.ts).
 *
 * The house edge and effects of removal are exact; the triggers and the
 * per-100 figures are simulated at the cut in CUT_FOR_DECKS.
 */

/** Decks left behind the cut in the generated table's simulations. */
export const CUT_FOR_DECKS: Record<number, number> = { 1: 0.5, 2: 0.5, 6: 1, 8: 1.5 };

export interface CandidateRow {
  id: string;
  name: string;
  kind: SideCountDef['kind'];
  tags?: number[];
  betBelow?: boolean;
  sourceUrl?: string;
  correlation: number | null;
  trigger: number | null;
  freq: number;
  edge: number;
  per100: number;
}

export interface SideBetRow {
  bet: SideBetId;
  payTable: string;
  decks: number;
  /** Buster only (the dealer's soft-17 rule); null for every other bet. */
  s17: boolean | null;
  cutDecks: number;
  rounds: number;
  seed: number;
  /** Exact house edge, as a fraction. */
  edge: number;
  /** Rounds priced by the linear estimate (Buster). */
  linear: boolean;
  /** Effects of removal per rank (RANKS order), per unit. */
  eor: number[];
  /** Positive off the top: bet every round. */
  always: boolean;
  /** The candidate used, or null when none makes the bet positive. */
  chosen: string | null;
  candidates: CandidateRow[];
}

export function sideBetRow(bet: SideBetId, payTable: string, decks: number, s17: boolean): SideBetRow | null {
  return (
    SIDE_BET_ROWS.find((r) => r.bet === bet && r.payTable === payTable && r.decks === decks && (r.s17 === null || r.s17 === s17)) ?? null
  );
}

/** How the bet is played at this game. */
export interface SidePlan {
  row: SideBetRow;
  always: boolean;
  /** Null when the bet is never worth making (and `always` is false). */
  count: SideCountDef | null;
  trigger: number | null;
  betBelow: boolean;
  candidate: CandidateRow | null;
}

export function countDefOf(c: CandidateRow): SideCountDef {
  if (c.id === 'hilo') return HI_LO_COUNT;
  return { id: c.id, name: c.name, kind: c.kind, tags: c.tags, sourceUrl: c.sourceUrl };
}

export function sidePlan(bet: SideBetId, payTable: string, decks: number, s17: boolean): SidePlan | null {
  const row = sideBetRow(bet, payTable, decks, s17);
  if (!row) return null;
  const candidate = row.chosen === null ? null : (row.candidates.find((c) => c.id === row.chosen) ?? null);
  return {
    row,
    always: row.always,
    count: candidate ? countDefOf(candidate) : null,
    trigger: candidate?.trigger ?? null,
    betBelow: candidate?.betBelow ?? false,
    candidate,
  };
}

/** Whether a bet placed at this true count is the right call. */
export function sideBetCorrect(plan: SidePlan, tc: number): boolean {
  if (plan.always) return true;
  if (plan.trigger === null) return false;
  return plan.betBelow ? tc <= plan.trigger : tc >= plan.trigger;
}
