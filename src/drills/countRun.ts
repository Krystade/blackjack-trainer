import type { Card } from '../engine/cards';
import { hiLoTag } from '../engine/count';

/**
 * Wave E E5 (W2-8): the dealt run, laid out for the count drill's result.
 *
 * The result used to say only "you entered 3; it was 5", so a wrong run could
 * not be replayed to find the card that was missed. This lists every dealt
 * card (or group, or table round) with its Hi-Lo tag and the running count
 * after it, and pins each checkpoint answer to the row it was asked at.
 */

/** A checkpoint answer, as the run listing marks it. */
export interface CountRunCheckpoint {
  /** Group index the run paused at. */
  atGroup: number;
  /** What was said. */
  answer: number;
}

export interface CountRunRow {
  /** 1-based, in deal order. */
  n: number;
  cards: readonly Card[];
  /** The row's net Hi-Lo tag: +1/0/−1 for one card, the sum for a group. */
  tag: number;
  /** The running count after this row. */
  total: number;
  /** A checkpoint asked after this row: what was said, against the true count. */
  checkpoint?: { said: number; was: number; right: boolean };
  /** Countdown's hidden card, shown last: the one the run asked about. */
  hidden?: boolean;
}

/**
 * One row per group, in deal order. `hidden` is Countdown's undealt card, added
 * as a last row so the column visibly closes the deck at zero.
 */
export function countRunRows(
  groups: readonly (readonly Card[])[],
  checkpoints: readonly CountRunCheckpoint[] = [],
  hidden?: Card,
): CountRunRow[] {
  const byGroup = new Map(checkpoints.map((c) => [c.atGroup, c]));
  const rows: CountRunRow[] = [];
  let total = 0;
  groups.forEach((cards, i) => {
    const tag = cards.reduce((s, c) => s + hiLoTag(c.rank), 0);
    total += tag;
    const cp = byGroup.get(i);
    rows.push({
      n: i + 1,
      cards,
      tag,
      total,
      // `was` is this row's own total, read off the cards listed above it.
      ...(cp ? { checkpoint: { said: cp.answer, was: total, right: cp.answer === total } } : {}),
    });
  });
  if (hidden) {
    const tag = hiLoTag(hidden.rank);
    rows.push({ n: rows.length + 1, cards: [hidden], tag, total: total + tag, hidden: true });
  }
  return rows;
}
