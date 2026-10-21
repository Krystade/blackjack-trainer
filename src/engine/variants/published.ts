/**
 * Wave L: the published variant charts the computed ones are checked against.
 *
 * TRANSCRIBED, NOT COMPUTED. Every row below was read off the Wizard of Odds
 * chart images (Michael Shackleford) on 2026-10-20, from the URLs next to each
 * table. Nothing in the app reads these to decide a play: the app's charts are
 * src/engine/variants/generated.json, computed by ev.ts. These exist only so
 * variantCharts.test.ts can list every cell where the two disagree -- and every
 * disagreement must carry a reason in DISAGREEMENT_REASONS, or the test fails.
 *
 * Rows are written in the app's own cell vocabulary (chartGen.ts's header):
 *  - Free Bet's "R" (surrender if possible, otherwise hit) is written Rh and
 *    its "RS" Rs; its "D" (real-money double) is written D because the chart
 *    gives no fallback, and matches a computed Dh or Ds.
 *  - Spanish 21's "RH" is written Rh. Its ′ and ″ marks are written ' and ". Its plain "R" (surrender, the 8,8 v A
 *    cell) gives no fallback, so it is written R and matches a computed Rh/Rs/Rp.
 *  - Switch's "D" (double if possible otherwise hit) is written Dh, "DS" Ds.
 * Columns: dealer 2 3 4 5 6 7 8 9 10 A. A key range ("5-8") repeats the row.
 */

import type { PresetId } from './rules';
import type { SectionId } from './chartGen';

export const SOURCES = {
  freebet: 'https://wizardofodds.com/games/free-bet-blackjack/',
  spanish21: 'https://wizardofodds.com/games/spanish-21/',
  switch: 'https://wizardofodds.com/games/blackjack/switch/',
  switchValues: 'https://wizardofodds.com/games/blackjack/switch/appendix/1/',
  spanish21Rules: 'https://en.wikipedia.org/wiki/Spanish_21',
} as const;

export interface PublishedTable {
  preset: PresetId;
  /** The GenTable id it is compared with. */
  table: string;
  source: string;
  /** The chart image the rows were read from. */
  image: string;
  sections: Partial<Record<SectionId, string[]>>;
  note?: string;
}

const FB_IMG = 'https://wizardofodds.com/games/free-bet-blackjack/images/';

export const PUBLISHED: readonly PublishedTable[] = [
  {
    preset: 'freebet',
    table: 'real',
    source: SOURCES.freebet,
    image: `${FB_IMG}free-bet-bj-real-bet.gif`,
    sections: {
      HARD: [
        '5-8:H H H H H H H H H H',
        '9-11:FD FD FD FD FD FD FD FD FD FD',
        '12:H H H S S H H H H H',
        '13:H S S S S H H H H H',
        '14:S S S S S H H H H H',
        '15:S S S S S H H H Rh Rh',
        '16:S S S S S H H Rh Rh Rh',
        '17:S S S S S S S S S Rs',
        '18-21:S S S S S S S S S S',
      ],
      SOFT: [
        '13-15:H H H H H H H H H H',
        '16:H H H H D H H H H H',
        '17:H H H D D H H H H H',
        '18:S S S D D S S H H H',
        '19-21:S S S S S S S S S S',
      ],
      PAIRS: [
        '2-4:FP FP FP FP FP FP FP FP FP FP',
        '5:FD FD FD FD FD FD FD FD FD FD',
        '6-9:FP FP FP FP FP FP FP FP FP FP',
        '10:S S S S S S S S S S',
        '11:FP FP FP FP FP FP FP FP FP FP',
      ],
    },
    note: 'The "Splits" chart is one table for both kinds of hand; it is compared with the real-money hand here and with the free hand below.',
  },
  {
    preset: 'freebet',
    table: 'free',
    source: SOURCES.freebet,
    image: `${FB_IMG}free-bet-bj-free-bet.gif`,
    sections: {
      HARD: [
        '4-8:H H H H H H H H H H',
        '9-11:FD FD FD FD FD FD FD FD FD FD',
        '12:H H H S S H H H H H',
        '13:H S S S S H H H H H',
        '14:H S S S S H H H H H',
        '15:S S S S S H H H H H',
        '16:S S S S S H H H H H',
        '17:S S S S S H H H S H',
        '18-21:S S S S S S S S S S',
      ],
      SOFT: [
        '13-15:H H H H H H H H H H',
        '16:H H H H D H H H H H',
        '17:H H H D D H H H H H',
        '18:H H D D D S H H H H',
        '19:S S S D D S S S S S',
        '20:S S S S D S S S S S',
        '21:S S S S S S S S S S',
      ],
      PAIRS: [
        '2-4:FP FP FP FP FP FP FP FP FP FP',
        '5:FD FD FD FD FD FD FD FD FD FD',
        '6-9:FP FP FP FP FP FP FP FP FP FP',
        '10:S S S S S S S S S S',
        '11:FP FP FP FP FP FP FP FP FP FP',
      ],
    },
  },
  {
    preset: 's21-h17',
    table: 'main',
    source: SOURCES.spanish21,
    image: 'https://wizardofodds.com/blackjack/images/spanish21h17.gif',
    sections: {
      HARD: [
        '4-8:H H H H H H H H H H',
        '9:H H H H D H H H H H',
        '10:D5 D5 D D D D4 D3 H H H',
        '11:D4 D5 D5 D5 D5 D4 D4 D4 D3 D3',
        '12:H H H H H H H H H H',
        '13:H H H H S4* H H H H H',
        "14:H H S4* S5' S6\" H H H H H",
        "15:S4* S5' S6 S6 S H H H H H",
        '16:S6 S6 S6 S S H H H H Rh',
        '17:S S S S S S S6 S6 S6 Rh',
        '18-21:S S S S S S S S S S',
      ],
      SOFT: [
        '13-14:H H H H H H H H H H',
        '15:H H H H D4 H H H H H',
        '16:H H H D3 D4 H H H H H',
        '17:H H D3 D4 D5 H H H H H',
        '18:S4 S4 D4 D5 D6 S6 S4 H H H',
        '19:S S S S S S S S S6 S6',
        '20-21:S S S S S S S S S S',
      ],
      PAIRS: [
        '2:P P P P P P P H H H',
        '3:P P P P P P P H H H',
        '6:H H P P P H H H H H',
        '7:P P P P P P$ H H H H',
        '8:P P P P P P P P P R',
        '9:S P P P P S P P S S',
        '11:P P P P P P P P P P',
      ],
    },
    note: 'The chart stops at soft 19; soft 20-21 are written as stand. 4,4 / 5,5 / 10,10 are "never split" on the chart and play as their totals, so they are not compared as pairs.',
  },
  {
    preset: 's21-s17',
    table: 'main',
    source: SOURCES.spanish21,
    image: 'https://wizardofodds.com/blackjack/images/spanish21s17.gif',
    sections: {
      HARD: [
        '4-8:H H H H H H H H H H',
        '9:H H H H D4 H H H H H',
        '10:D5 D5 D D D D4 D3 H H H',
        '11:D4 D5 D5 D5 D5 D4 D4 D4 D3 D3',
        '12:H H H H H H H H H H',
        '13:H H H H H H H H H H',
        '14:H H S4* S5* S4* H H H H H',
        '15:S4* S5* S5" S6 S6" H H H H H',
        '16:S5 S6 S6 S S H H H H H',
        '17:S S S S S S S6 S6 S6 Rh',
        '18-21:S S S S S S S S S S',
      ],
      SOFT: [
        '13-15:H H H H H H H H H H',
        '16:H H H H D4 H H H H H',
        '17:H H D3 D4 D5 H H H H H',
        '18:S4 S4 D4 D5 D5 S6 S4 H H H',
        '19-21:S S S S S S S S S6 S',
      ],
      PAIRS: [
        '2:P P P P P P P H H H',
        '3:P P P P P P P H H H',
        '6:H H P P P H H H H H',
        '7:P P P P P P$ H H H H',
        '8:P P P P P P P P P P',
        '9:S P P P P S P P S S',
        '11:P P P P P P P P P P',
      ],
    },
  },
  {
    preset: 's21-h17-rdd',
    table: 'main',
    source: SOURCES.spanish21,
    image: 'https://wizardofodds.com/blackjack/images/spanish21dd1.gif',
    sections: {
      HARD: [
        '5-7:H H H H D H H H H H',
        '8:H H H D D H H H H H',
        '9:H D4 D D D H H H H H',
        '10:D5 D5 D D D D D5 H H H',
        '11:D4 D5 D5 D5 D5 D5 D5 D4 D3 D3',
        '12:H H H H H H H H H H',
        '13:H H H H S4* H H H H H',
        "14:H H S4* S5' S6\" H H H H H",
        "15:S4* S5' S6 S6 S H H H H H",
        '16:S6 S6 S6 S S H H H H Rh',
        '17:S S S S S S6 S6 S6 S6 Rh',
      ],
      SOFT: [
        '13:H D3 D D D H H H H H',
        '14:H D3 D4 D D H H H H H',
        '15:H H D4 D4 D5 H H H H H',
        '16:H H D3 D4 D5 H H H H H',
        '17:H H D3 D4 D5 H H H H H',
        '18:S4 S4 D4 D5 D6 S6 S4 H H H',
        '19:S S S S S S S S S6 S6',
      ],
      PAIRS: [
        '2:P P P P P P P H H H',
        '3:P P P P P P P H H H',
        '6:H H P P P H H H H H',
        '7:P P P P P P$ H H H H',
        '8:P P P P P P P P P R',
        '9:S P P P P S P P S S',
        '11:P P P P P P P P P P',
      ],
    },
    note: '"Player has not already doubled" chart. Its 9,9 row colours v 7 / v 10 / v A red but prints S; the printed letter is transcribed.',
  },
  {
    preset: 'switch',
    table: 'main',
    source: SOURCES.switch,
    image: 'https://wizardofodds.com/blackjack/images/bjswitch-lasvegas.gif',
    sections: {
      HARD: [
        '5-8:H H H H H H H H H H',
        // "If 6 decks are used the player should double 9 against a 5." The
        // preset is six decks, so the note is applied to the eight-deck row.
        '9:H H H Dh Dh H H H H H',
        '10:Dh Dh Dh Dh Dh Dh Dh H H H',
        '11:Dh Dh Dh Dh Dh Dh Dh Dh H H',
        '12:H H H S S H H H H H',
        '13:H S S S S H H H H H',
        '14-16:S S S S S H H H H H',
        '17-21:S S S S S S S S S S',
      ],
      SOFT: [
        '13-15:H H H H H H H H H H',
        '16:H H H H Dh H H H H H',
        '17:H H H Dh Dh H H H H H',
        '18:S S S Ds Ds S S H H H',
        '19-21:S S S S S S S S S S',
      ],
      PAIRS: [
        '2:H H H P P P H H H H',
        '3:H H H P P P H H H H',
        '4:H H H H H H H H H H',
        '5:Dh Dh Dh Dh Dh Dh Dh H H H',
        '6:H H P P P H H H H H',
        '7:S P P P P P H H H H',
        '8:P P P P P P P P H H',
        '9:S S P P P S P P S S',
        '10:S S S S S S S S S S',
        '11:P P P P P P P P P P',
      ],
    },
    note: 'Eight-deck Las Vegas rules chart, with the page\'s six-deck note applied: "If 6 decks are used the player should double 9 against a 5."',
  },
];

/**
 * Spanish 21 after a double (redouble game, "player has already doubled"):
 * S stand, D double again, R rescue. Hard 6-21 then soft 13-21.
 */
export const PUBLISHED_AFTER_DOUBLE = {
  preset: 's21-h17-rdd' as PresetId,
  source: SOURCES.spanish21,
  image: 'https://wizardofodds.com/blackjack/images/spanish21dd2.gif',
  hard: [
    '6:S D D D D D R R R R',
    '7:D D D D D D R R R R',
    '8:D D D D D D D D R R',
    '9-11:D D D D D D D D D D',
    '12:S S S S S D D R R R',
    '13-16:S S S S S S R R R R',
    '17:S S S S S S S S S R',
    '18-21:S S S S S S S S S S',
  ],
  soft: ['13-17:D D D D D D D D D D', '18:S S D D D S S S S S', '19-21:S S S S S S S S S S'],
};

/** The non-redouble charts' rescue line: "Double down surrender: 12-16 vs 8-A; 17 vs A". */
export const PUBLISHED_RESCUE: readonly { total: number; ups: number[] }[] = [
  { total: 12, ups: [8, 9, 10, 11] },
  { total: 13, ups: [8, 9, 10, 11] },
  { total: 14, ups: [8, 9, 10, 11] },
  { total: 15, ups: [8, 9, 10, 11] },
  { total: 16, ups: [8, 9, 10, 11] },
  { total: 17, ups: [11] },
];

/** House edges as published, percent, for the preset's rules (finite decks). */
export const PUBLISHED_HOUSE_EDGE: Readonly<Record<PresetId, { edge: number; decks: number; source: string; quote: string }>> = {
  freebet: { edge: 1.04, decks: 6, source: SOURCES.freebet, quote: 'The house edge under the standard rules above is 1.04%.' },
  's21-h17': { edge: 0.76, decks: 6, source: SOURCES.spanish21, quote: 'Dealer hits on soft 17, redoubling not allowed: 0.76%' },
  's21-s17': { edge: 0.4, decks: 6, source: SOURCES.spanish21, quote: 'Dealer stands on soft 17: 0.40%' },
  's21-h17-rdd': { edge: 0.42, decks: 6, source: SOURCES.spanish21, quote: 'Dealer hits on soft 17, redoubling allowed: 0.42%' },
  switch: { edge: 0.58, decks: 6, source: SOURCES.switch, quote: 'six decks, the dealer hits a soft 17 ... the house edge is 0.58%' },
};

/** Free Bet / Switch page: P(dealer draws to 22), six decks, H17. */
export const PUBLISHED_P22 = { p: 0.073536, source: SOURCES.switch };

/**
 * Wikipedia's Spanish 21 rule-change table ("Rule Changes" / "Change in House
 * Edge"), percent, transcribed row by row: what removing a preset's rule costs
 * the player. Checked against the engine in scripts/variantCharts.test.ts.
 */
export const PUBLISHED_S21_RULE_EFFECTS: readonly { rule: 'ls' | 'splitAcesDraw'; preset: PresetId; effect: number; quote: string }[] = [
  { rule: 'ls', preset: 's21-h17', effect: 0.018, quote: 'No surrender (H17) | 0.018%' },
  { rule: 'ls', preset: 's21-s17', effect: 0.006, quote: 'No surrender (S17) | 0.006%' },
  { rule: 'splitAcesDraw', preset: 's21-h17', effect: 0.28, quote: 'No draws on split Aces (H17 or S17) | 0.28%' },
  { rule: 'splitAcesDraw', preset: 's21-s17', effect: 0.28, quote: 'No draws on split Aces (H17 or S17) | 0.28%' },
  { rule: 'splitAcesDraw', preset: 's21-h17-rdd', effect: 0.29, quote: 'No draws on split Aces (H17 with redoubling) | 0.29%' },
];

/**
 * Wizard of Odds Blackjack Switch appendix 1: each starting hand's expected
 * value by dealer up card (2..A), "under the usual rules" (six decks, H17,
 * switched blackjack counts 21), after the peek.
 */
export const PUBLISHED_SWITCH_VALUES: readonly string[] = [
  '5:-0.2695 -0.1883 -0.1509 -0.1121 -0.0723 -0.1566 -0.2219 -0.2979 -0.3448 -0.3484',
  '6:-0.2832 -0.2004 -0.1626 -0.1236 -0.0823 -0.1891 -0.2520 -0.3250 -0.3696 -0.3732',
  '7:-0.2551 -0.1721 -0.1347 -0.0954 -0.0561 -0.1166 -0.2558 -0.3266 -0.3607 -0.3908',
  '8:-0.1694 -0.0884 -0.0528 -0.0172 0.0178 0.0347 -0.1049 -0.2526 -0.2918 -0.3059',
  '9:-0.0721 0.0075 0.0384 0.0715 0.1334 0.1245 0.0534 -0.0956 -0.1957 -0.1669',
  '10:0.0593 0.2213 0.2792 0.3386 0.3940 0.2704 0.1697 0.0722 -0.0185 -0.0088',
  '11:0.1728 0.3313 0.3851 0.4401 0.4926 0.3362 0.2296 0.1150 0.0734 0.0639',
  '12:-0.3561 -0.3005 -0.2783 -0.2538 -0.2108 -0.2482 -0.3055 -0.3722 -0.4086 -0.4128',
  '13:-0.4026 -0.3439 -0.2989 -0.2551 -0.2110 -0.3021 -0.3553 -0.4130 -0.4507 -0.4544',
  '14:-0.4389 -0.3436 -0.2993 -0.2553 -0.2110 -0.3526 -0.3977 -0.4552 -0.4901 -0.4933',
  '15:-0.4382 -0.3436 -0.2993 -0.2556 -0.2117 -0.3946 -0.4406 -0.4943 -0.5267 -0.5297',
  '16:-0.4385 -0.3442 -0.2998 -0.2561 -0.2131 -0.4348 -0.4774 -0.5272 -0.5575 -0.5605',
  '17:-0.3081 -0.2175 -0.1767 -0.1382 -0.0984 -0.1731 -0.4444 -0.4789 -0.4751 -0.5677',
  '18:-0.0416 0.0406 0.0709 0.1022 0.1315 0.3343 0.0442 -0.2419 -0.2324 -0.2772',
  '19:0.2264 0.2986 0.3187 0.3439 0.3618 0.5510 0.5318 0.2277 0.0103 0.1376',
  '20:0.4829 0.5466 0.5594 0.5752 0.5873 0.7077 0.7307 0.7001 0.5009 0.5472',
  'A,2:-0.0895 -0.0208 0.0105 0.0432 0.0766 0.0754 0.0106 -0.0749 -0.1428 -0.1378',
  'A,3:-0.1226 -0.0444 -0.0118 0.0216 0.0564 0.0338 -0.0248 -0.1098 -0.1761 -0.1713',
  'A,4:-0.1462 -0.0659 -0.0336 0.0006 0.0365 -0.0054 -0.0665 -0.1478 -0.2102 -0.2061',
  'A,5:-0.1673 -0.0863 -0.0531 -0.0185 0.0217 -0.0470 -0.1061 -0.1849 -0.2453 -0.2412',
  'A,6:-0.1471 -0.0658 -0.0327 0.0068 0.0745 0.0037 -0.1189 -0.1911 -0.2399 -0.2628',
  'A,7:-0.0401 0.0439 0.0752 0.1168 0.1779 0.3364 0.0473 -0.1433 -0.1884 -0.2023',
  'A,8:0.2272 0.3020 0.3222 0.3463 0.3634 0.5518 0.5353 0.2311 0.0049 0.1355',
  'A,9:0.4837 0.5492 0.5609 0.5767 0.5884 0.7090 0.7310 0.7025 0.4974 0.5510',
  'BJ (switched):0.7282 0.7866 0.7921 0.7980 0.8032 0.8613 0.8703 0.8829 0.9060 0.8505',
  'BJ (natural):1.0000 1.0000 1.0000 1.0000 1.0000 1.0000 1.0000 1.0000 1.0000 1.0000',
  'A,A:0.1795 0.3383 0.3923 0.4474 0.5018 0.3487 0.2428 0.1265 0.0717 0.0155',
  '2,2:-0.2548 -0.1748 -0.1389 -0.0831 0.0147 -0.1101 -0.1933 -0.2720 -0.3204 -0.3247',
  '3,3:-0.2833 -0.2013 -0.1622 -0.1101 -0.0103 -0.1661 -0.2520 -0.3249 -0.3696 -0.3733',
  '4,4:-0.1692 -0.0884 -0.0522 -0.0160 0.0196 0.0359 -0.1041 -0.2525 -0.2912 -0.3049',
  '5,5:0.0603 0.2224 0.2808 0.3429 0.4005 0.2739 0.1705 0.0719 -0.0186 -0.0086',
  '6,6:-0.3571 -0.3004 -0.2599 -0.1645 -0.0624 -0.2517 -0.3083 -0.3741 -0.4106 -0.4142',
  '7,7:-0.4369 -0.2850 -0.1968 -0.1061 -0.0102 -0.1829 -0.4016 -0.4600 -0.4962 -0.4984',
  '8,8:-0.2984 -0.0946 -0.0146 0.0627 0.1461 0.1814 -0.1555 -0.5026 -0.5576 -0.5595',
  '9,9:-0.0401 0.0417 0.0988 0.1730 0.2442 0.3359 0.1220 -0.1844 -0.2297 -0.2738',
  '10,10:0.4829 0.5466 0.5594 0.5752 0.5873 0.7077 0.7307 0.7001 0.5009 0.5472',
];

/**
 * Why each computed cell differs from the published one. Keyed
 * `preset:table:SECTION:row:up` (up 2-11), or `preset:afterDouble:hard|soft:row:up`.
 * variantCharts.test.ts fails on any disagreement without an entry here, and
 * on any entry here that no longer disagrees -- so this list is always exactly
 * the current set.
 */
/**
 * Which play the drill grades in a disagreeing cell, and which the chart shows:
 *  - 'published': the published (finite six-deck) play. These are composition
 *    effects the infinite deck cannot see; scripts/variantFinite.test.ts checks
 *    a six-deck shoe flips each class tested to the published play.
 *  - 'computed': the computed play (the published cell is a slip, a merged
 *    row, or a rule this app does not model).
 *  - 'either': both plays are graded right (a rule the casino decides, or a
 *    call a six-deck shoe leaves too close to name).
 * The other play is shown as a note on the chart cell.
 */
export type DisagreementGrade = 'published' | 'computed' | 'either';

const BUILT = buildReasons();
export const DISAGREEMENT_REASONS: Readonly<Record<string, string>> = BUILT.reasons;
export const DISAGREEMENT_GRADES: Readonly<Record<string, DisagreementGrade>> = BUILT.grades;

function buildReasons(): { reasons: Record<string, string>; grades: Record<string, DisagreementGrade> } {
  const out: Record<string, string> = {};
  const grades: Record<string, DisagreementGrade> = {};
  const add = (reason: string, grade: DisagreementGrade, keys: string[]) => {
    for (const k of keys) {
      out[k] = reason;
      grades[k] = grade;
    }
  };

  // A two-card call the infinite deck makes the other way by a few
  // thousandths. These are the deck-count-sensitive cells: the standard
  // one-deck and six-deck charts in docs/sources/ differ on exactly this kind
  // of soft double too.
  const BORDERLINE =
    'Borderline: under the infinite deck the computed play is better by the margin shown (a few thousandths of a bet); ' +
    "a six-deck shoe, with the player's own cards removed, tips it the other way (scripts/variantFinite.test.ts). " +
    'Graded as published; the infinite-deck play is the note.';
  add(BORDERLINE, 'published', [
    'freebet:real:SOFT:16:6',
    'freebet:real:SOFT:17:5',
    'freebet:free:SOFT:17:5',
    'switch:main:SOFT:16:6',
    'switch:main:SOFT:17:5',
    's21-s17:main:HARD:9:6',
    's21-h17:main:SOFT:16:5',
  ]);

  add(
    'The published "Splits" chart is one table for real and free hands alike. On a free hand a loss costs nothing, which makes ' +
      'free-splitting 5,5 v 6 worth 0.004 more than the free double here; the real-money hand matches the chart (FD). Graded as computed.',
    'computed',
    ['freebet:free:PAIRS:5:6'],
  );

  // Spanish 21's card-count steps. An n-card hand of a low total is made of
  // small cards; in a real 6-deck shoe that leaves the rest of the shoe a
  // little richer in J/Q/K, which favours standing (and doubling) a card
  // longer. The infinite deck cannot see that, and every one of these goes the
  // same way: computed hits one card sooner.
  const CARD_STEP =
    'Card-count step one card earlier than published: an n-card hand of this total is all small cards, and removing them ' +
    'from a real six-deck shoe makes standing or doubling a little better than the infinite deck allows. Every step ' +
    'disagreement goes this one way (computed hits sooner); the margin is what the published step costs under the infinite deck. ' +
    'A six-deck shoe flips the cells tested to the published step (scripts/variantFinite.test.ts), so the published step is graded.';
  add(CARD_STEP, 'published', [
    's21-h17:main:HARD:9:6',
    's21-h17:main:HARD:10:4',
    's21-h17:main:HARD:14:5',
    's21-h17:main:HARD:14:6',
    's21-h17:main:HARD:15:4',
    's21-h17:main:HARD:15:6',
    's21-h17:main:HARD:16:2',
    's21-h17:main:SOFT:15:6',
    's21-h17:main:SOFT:18:6',
    's21-s17:main:HARD:10:2',
    's21-s17:main:HARD:10:4',
    's21-s17:main:HARD:14:5',
    's21-s17:main:HARD:15:3',
    's21-s17:main:HARD:16:5',
    's21-s17:main:HARD:16:6',
    's21-s17:main:SOFT:19:11',
    's21-h17-rdd:main:HARD:8:5',
    's21-h17-rdd:main:HARD:10:4',
    's21-h17-rdd:main:HARD:14:5',
    's21-h17-rdd:main:HARD:14:6',
    's21-h17-rdd:main:HARD:15:4',
    's21-h17-rdd:main:HARD:15:6',
    's21-h17-rdd:main:HARD:16:2',
    's21-h17-rdd:main:SOFT:18:6',
  ]);
  add(
    'Card-count step (redouble game): a six-deck shoe still hits the 4-card 10 v 7 / 10 v 8 by 0.004 / 0.0015 for the compositions ' +
      'tried, against the published double; too close, and too composition-dependent, to name one. Either is graded right.',
    'either',
    ['s21-h17-rdd:main:HARD:10:7', 's21-h17-rdd:main:HARD:10:8'],
  );

  add(
    'Spade-only 6-7-8 mark: computed stands on a spaded 7-8 v 6 too; the published S17 chart hits it. Not a deck effect: a six-deck ' +
      'shoe still stands, by 0.016 (0.018 infinite), and the H17 chart has no mark here. A chart or transcription slip; graded as computed.',
    'computed',
    ['s21-s17:main:HARD:15:6'],
  );

  add(
    'The published S17 chart merges soft 19-21 into one row, so its S6 v 10 reads onto soft 20 and soft 21 as well. Computed: ' +
      'soft 19 v 10 is S6 (matching), a soft 20 stands whatever its card count, and 21 always wins in Spanish 21. Graded as computed.',
    'computed',
    ['s21-s17:main:SOFT:20:10', 's21-s17:main:SOFT:21:10'],
  );

  add(
    'Rule assumption: bonuses are not paid on split hands (most casinos, per the Wizard; ev.ts header). With them paid after a ' +
      'split (bonusAfterSplit, the game as designed) the computed play flips to split, matching the chart -- ' +
      'variantCharts.test.ts checks that flip. Whether bonuses are paid after a split is the casino\'s rule, so either play is graded right.',
    'either',
    [
      's21-h17:main:PAIRS:2:2',
      's21-h17:main:PAIRS:2:8',
      's21-s17:main:PAIRS:2:8',
      's21-s17:main:PAIRS:3:2',
      's21-h17-rdd:main:PAIRS:2:2',
      's21-h17-rdd:main:PAIRS:2:8',
    ],
  );
  add(
    'Rule assumption plus a borderline call: with bonuses paid after a split 3,3 v 2 still hits by 0.0008 under H17; the split ' +
      'the chart shows needs the finite-shoe effect as well. Graded as published.',
    'published',
    ['s21-h17:main:PAIRS:3:2', 's21-h17-rdd:main:PAIRS:3:2'],
  );

  add(
    'P$ is "split, except hit with suited sevens": the Super Bonus (suited 7-7-7 v a dealer 7 pays $1000/$5000, a dollar amount, ' +
      'not odds) is not modelled. Unsuited, both say split; the drill deals only unsuited sevens.',
    'computed',
    ['s21-h17:main:PAIRS:7:7', 's21-s17:main:PAIRS:7:7', 's21-h17-rdd:main:PAIRS:7:7'],
  );

  add(
    "Likely a chart slip: a redouble cannot change how a 6-card 17 is played (it is not a doubling decision), so this cell should " +
      'match the no-redouble H17 chart, which says S -- as computed. Hitting costs 0.133 here. Graded as computed.',
    'computed',
    ['s21-h17-rdd:main:HARD:17:7'],
  );
  add(
    'Likely a chart slip: the no-redouble H17 chart says D4 here, as computed, and a redouble only helps a double of 11 when ' +
      'the card is an ace (12, redoubled v 7/8): it adds about 0.013 to the double, against a 0.065 / 0.124 gap. A six-deck ' +
      'shoe still hits by 0.046 / 0.113. Graded as computed.',
    'computed',
    ['s21-h17-rdd:main:HARD:11:7', 's21-h17-rdd:main:HARD:11:8'],
  );

  add(
    'After a double (redouble game): a doubled hard 6 is all small cards (2,2 then a 2). Computed stands; the published ' +
      'redouble is worth 0.024-0.033 less under the infinite deck, and a six-deck shoe only narrows that to 0.006 / 0.002, so ' +
      'computed still wins. Graded as computed.',
    'computed',
    ['s21-h17-rdd:afterDouble:hard:6:3', 's21-h17-rdd:afterDouble:hard:6:7'],
  );

  add(
    'Six decks: the Switch page\'s strategy table is for eight decks and adds "If 6 decks are used the player should double 9 ' +
      'against a 5." The preset is six decks; the infinite deck hits by the margin shown, a six-deck shoe doubles ' +
      '(scripts/variantFinite.test.ts). Graded as published.',
    'published',
    ['switch:main:HARD:9:5'],
  );
  return { reasons: out, grades };
}
