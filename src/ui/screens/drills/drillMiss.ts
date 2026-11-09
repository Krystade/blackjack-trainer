import type { GradedEvent } from '../../../engine/grade';
import type { RuleSet } from '../../../engine/ruleset';
import { tallyCellIdFor } from '../../../store/stats';
import type { HandResult } from '../../handResult';
import { regionRuleFor } from '../regionRule';
import { missHistoryLine } from '../../../drills/missHistory';
import type { CellTally } from '../../../store/cellStats';
import { missWhy } from './missWhy';

/**
 * A drill's frozen result; `missLine` is the B6 miss strip (Task 6), `why`
 * the T2-2B principle behind the chart's play (missWhy.ts).
 */
export type DrillHandResult = HandResult & { missLine?: string; why?: string };

/** T2-2B: the "why" for a basic-strategy miss in Flashcards or Mastery. */
export function whyForMiss(event: GradedEvent, rules: RuleSet): string | undefined {
  if (event.correct) return undefined;
  if (event.source !== 'flashcard' && event.source !== 'mastery') return undefined;
  const cellId = tallyCellIdFor(event);
  if (cellId === null) return undefined;
  return missWhy(cellId, rules) ?? undefined;
}

/**
 * B7: a basic-strategy miss in Flashcards or Mastery reads the chart region it
 * sits in ("Hard 12–16 v 7–A: hit.") instead of the bare cell label. Quiz and
 * index misses keep their own reason (the index label).
 */
export function withRegionRule(result: HandResult, event: GradedEvent, rules: RuleSet): HandResult {
  if (event.correct) return result;
  if (event.source !== 'flashcard' && event.source !== 'mastery') return result;
  const cellId = tallyCellIdFor(event);
  if (cellId === null) return result;
  const rule = regionRuleFor(cellId, rules);
  if (!rule) return result;
  return { ...result, reason: rule.text };
}

/**
 * B6: the region rule above plus the miss strip's history line (cost, which
 * miss on the cell, misses of the last five). `cellBefore` is the cell's
 * tally as it stood before this answer.
 */
export function withMissDetail(
  result: HandResult,
  event: GradedEvent,
  cellBefore: CellTally | null,
  rules: RuleSet,
): DrillHandResult {
  return {
    ...withRegionRule(result, event, rules),
    missLine: missHistoryLine(event, cellBefore) ?? undefined,
    why: whyForMiss(event, rules),
  };
}
