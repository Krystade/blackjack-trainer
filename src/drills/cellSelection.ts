import type { CustomSelection, Stats } from '../store/types';

/**
 * B2 (#9): the Custom drill's selection as draw weights. STUB placed by the
 * orchestrator so the drills lane can wire decks while the custom lane
 * implements it: every listed cell weighs 1.
 *
 * Contract: returns a weight > 0 for every cell in `cellIds` that the
 * selection includes, and omits the rest. Weights are relative.
 */
export function customWeights(
  _sel: CustomSelection | undefined,
  cellIds: readonly string[],
  _cellStats?: Stats['cellStats'],
): Map<string, number> {
  return new Map(cellIds.map((id) => [id, 1]));
}
