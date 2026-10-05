/**
 * "hard-13-v-3" as words: "Hard 13 vs 3". The raw id is what the grader and
 * the specs key on; it is not something to put in front of a driver. Anything
 * that is not a cell id is returned unchanged.
 */
export function plainCellLabel(cellId: string): string {
  const m = /^(hard|soft|pair)-(\w+)-v-(\w+)$/.exec(cellId);
  if (!m) return cellId;
  const kind = m[1] === 'hard' ? 'Hard' : m[1] === 'soft' ? 'Soft' : 'Pair of';
  const value = m[1] === 'pair' ? `${m[2]}s` : m[2];
  return `${kind} ${value} vs ${m[3]}`;
}
