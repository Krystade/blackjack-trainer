import { HI_LO_TAGS } from './eor';
import type { SideBetId } from './payTables';

/**
 * Wave L: A SIDE COUNT -- how the cards seen are tallied for one side bet.
 *
 *   - 'tags': a running count of per-rank tags (thirteen, RANKS order: A, 2..10,
 *     J, Q, K), divided by decks left for a true count -- Hi-Lo is one.
 *   - 'suit': the spread between the suit seen most and the suit seen least
 *     (Jacobson's count for 21+3 and Royal Match, which are decided by suits,
 *     not ranks), divided by decks left.
 *
 * The bet is made at a true count AT OR ABOVE the trigger -- or at or below it
 * for a count that bets low (`betBelow`: Jacobson's crush count bets Under 13
 * at -5 and lower on the same count that bets Over at +3).
 */

export type SideCountKind = 'tags' | 'suit';

export interface SideCountDef {
  id: string;
  name: string;
  kind: SideCountKind;
  /** 'tags' only: thirteen tags, RANKS order. */
  tags?: readonly number[];
  /** Where it was published, when it was. */
  sourceUrl?: string;
  /** The published trigger, when the source gives one, with what it is for. */
  publishedTrigger?: { decks: number; tc: number; payTable?: string; betBelow?: boolean; note?: string }[];
  /** What the source says it earns, verbatim figures, for the report. */
  publishedResult?: string;
  note?: string;
}

export const HI_LO_COUNT: SideCountDef = { id: 'hilo', name: 'Hi-Lo', kind: 'tags', tags: HI_LO_TAGS };

const JACOBSON = 'https://advancedadvantageplay.com/side-bets/blackjack-side-bets/';

/**
 * PUBLISHED COUNTS, transcribed from Eliot Jacobson's Advanced Advantage Play
 * (the side-bet index lists each bet's tags, trigger and result). The tag
 * tuples there run A, 2, .. 9, T (ten entries) or A .. K (thirteen); they are
 * written out per rank here. counts.test.ts compares each with the count the
 * app derives from its own effects of removal.
 */
export const PUBLISHED_COUNTS: Partial<Record<SideBetId, SideCountDef[]>> = {
  luckyLadies: [
    {
      id: 'jacobson-ten',
      name: 'Ten count (Jacobson)',
      kind: 'tags',
      // (0,1,1,1,1,1,1,1,1,-2,-2,-2,-2)
      tags: [0, 1, 1, 1, 1, 1, 1, 1, 1, -2, -2, -2, -2],
      sourceUrl: 'https://advancedadvantageplay.com/2024/07/card-counting-the-lucky-ladies-blackjack-side-bet/',
      publishedTrigger: [{ decks: 2, tc: 8, payTable: '1000/200/25/10/4' }],
      publishedResult: '2 decks: bet 7.159% of hands, average edge 16.41%, 1.175 units per 100 hands. 6 decks (1000/125/19/9/4): 2.973%, 13.23%, 0.393 units per 100 (no trigger listed).',
    },
  ],
  buster: [
    {
      id: 'jacobson-buster',
      name: 'Buster count (Jacobson)',
      kind: 'tags',
      // (-2,-3,-2,0,0,0,1,1,1,1), A..T; J, Q, K as T.
      tags: [-2, -3, -2, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
      sourceUrl: JACOBSON,
      publishedTrigger: [
        { decks: 2, tc: 5, note: '"1,3,6 pay table"' },
        { decks: 6, tc: 4, note: '"1,3,6 pay table"' },
      ],
      publishedResult: '2 decks: 16.83% of hands, 7.30% average edge, 1.228 units per 100. 6 decks: 13.29%, 5.28%, 0.702 units per 100.',
      note: 'The source names its pay table only as "1,3,6"; it is not one of the Wizard of Odds tables, so its trigger is not compared directly.',
    },
  ],
  over13: [
    {
      id: 'jacobson-crush',
      name: 'Crush count (Jacobson)',
      kind: 'tags',
      // A, 2: +2; 3: +1; 4-8: 0; 9, T: -1.
      tags: [2, 2, 1, 0, 0, 0, 0, 0, -1, -1, -1, -1, -1],
      sourceUrl: 'https://advancedadvantageplay.com/2025/05/crushing-the-over-under-13-blackjack-side-bet/',
      publishedTrigger: [{ decks: 6, tc: 3 }],
      publishedResult: '6 decks, cut at 260 cards, Over at +3 and Under at -5: 19.724% of hands, 5.242% average edge, 1.034 units per 100.',
    },
  ],
  under13: [
    {
      id: 'jacobson-crush',
      name: 'Crush count (Jacobson)',
      kind: 'tags',
      tags: [2, 2, 1, 0, 0, 0, 0, 0, -1, -1, -1, -1, -1],
      sourceUrl: 'https://advancedadvantageplay.com/2025/05/crushing-the-over-under-13-blackjack-side-bet/',
      publishedTrigger: [{ decks: 6, tc: -5, betBelow: true }],
      publishedResult: 'See Over 13: one count, both bets.',
    },
  ],
  twentyOnePlus3: [
    {
      id: 'jacobson-suit',
      name: 'Suit spread (Jacobson)',
      kind: 'suit',
      sourceUrl: JACOBSON,
      publishedTrigger: [{ decks: 6, tc: 8, note: 'pay table not stated' }],
      publishedResult: '3.53% of hands, 5.04% average edge, 0.178 units per 100.',
    },
  ],
  royalMatch: [
    {
      id: 'jacobson-suit',
      name: 'Suit spread (Jacobson)',
      kind: 'suit',
      sourceUrl: JACOBSON,
      publishedTrigger: [{ decks: 1, tc: 6, note: 'single-deck running count +6 ("rule of 6")' }],
      publishedResult: '1 deck: 4.83% of hands, 2.34% average edge, 0.113 units per 100.',
    },
  ],
};

/** The running count's change for one seen card of rank index `r`. */
export function tagOf(def: SideCountDef, r: number): number {
  return def.tags?.[r] ?? 0;
}

/** "+1 2-9, -2 tens" style summary of a tag set, grouped by equal tags. */
export function describeTags(tags: readonly number[]): string {
  const names = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const groups = new Map<number, string[]>();
  tags.forEach((t, i) => {
    if (t === 0) return;
    groups.set(t, [...(groups.get(t) ?? []), names[i]!]);
  });
  const parts = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([t, rs]) => `${t > 0 ? '+' : '−'}${Math.abs(t)}: ${compactRanks(rs)}`);
  return parts.length > 0 ? parts.join(' · ') : 'no tags';
}

/** "2,3,4,5" -> "2–5"; "10,J,Q,K" -> "10–K". */
function compactRanks(rs: string[]): string {
  const order = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const idx = rs.map((r) => order.indexOf(r)).sort((a, b) => a - b);
  const out: string[] = [];
  let start = idx[0]!;
  let prev = start;
  for (let i = 1; i <= idx.length; i++) {
    const cur = idx[i];
    if (cur !== undefined && cur === prev + 1) {
      prev = cur;
      continue;
    }
    out.push(prev - start >= 2 ? `${order[start]}–${order[prev]}` : start === prev ? order[start]! : `${order[start]},${order[prev]}`);
    if (cur !== undefined) {
      start = cur;
      prev = cur;
    }
  }
  return out.join(',');
}
