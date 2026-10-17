import type { GradedEvent } from '../../../engine/grade';
import type { RuleSet } from '../../../engine/ruleset';
import { tallyCellIdFor } from '../../../store/stats';
import type { HandResult } from '../../handResult';
import { regionRuleFor } from '../regionRule';

/** A drill's frozen result; `missLine` is the B6 miss strip (Task 6). */
export type DrillHandResult = HandResult & { missLine?: string };

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
