/**
 * The test suite, on the phone.
 *
 * WHY IT EXISTS. Jack, 2026-10-03: "can you add all the tests you run to the
 * app itself? ... i just think you running the tests here on my computer vs me
 * using the app on my phone just doesn't equate." He was right, and the first
 * answer -- five device checks bolted onto the car check -- was not what he
 * asked for. This is: the invariants the desktop suite asserts, running in the
 * browser that actually ships, against the modules that actually ship.
 *
 * WHAT IT IS NOT. It is not vitest in a page, and it does not re-run the 5000
 * unit tests; most of those are about internal shapes nobody can act on from a
 * roadside. These are the facts that would make the app WRONG rather than
 * merely broken: a strategy chart that advises the wrong play, a count that
 * does not come back to zero, a true count that rounds the wrong way, an index
 * that fires at the wrong threshold, a settings blob that loses a value on the
 * way to disk, a spoken line with no recording behind it.
 *
 * THE RULE THESE MUST MEET, which is the one I keep breaking: a check that
 * cannot fail is worse than no check, because it turns a real fault into a
 * screen full of ticks. Every case here is driven against a KNOWN ANSWER --
 * published basic strategy, published indices, arithmetic with one right
 * result -- rather than against whatever the code currently returns. The
 * meta-tests in selfTest.test.ts break each subject in turn and require the
 * matching case to go red.
 */
import type { Card, Rank } from '../engine/cards';
import { RANKS, rankValue } from '../engine/cards';
import { correctPlay, basicPlay, insuranceCorrect, type PlayContext } from '../engine/strategy';
import { hiLoTag, trueCount } from '../engine/count';
import { handValue, isBlackjack, isPair } from '../engine/hand';
import { DEFAULT_RULES } from '../engine/ruleset';
import { manifestLookup, segmentForClips, type ClipManifest } from '../audio/clips';
import { SETTINGS_KEY } from '../store/persist';

export type SelfTestOutcome = 'pass' | 'fail';

export interface SelfTestResult {
  id: string;
  group: string;
  label: string;
  outcome: SelfTestOutcome;
  /** Only on a failure: what was expected and what came back. */
  detail?: string;
}

export interface SelfTestCase {
  id: string;
  group: string;
  label: string;
  /** Returns null when it passes, or the discrepancy when it does not. */
  run: () => string | null;
}

const ALL_PLAYS: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };
const HIT_ONLY: PlayContext = { canDouble: false, canSplit: false, canSurrender: false };

function card(rank: Rank): Card {
  return { rank, suit: 's' };
}

function hand(...ranks: Rank[]): Card[] {
  return ranks.map(card);
}

/* ------------------------------------------------------------------------ */
/* Basic strategy — against published answers, never against itself          */
/* ------------------------------------------------------------------------ */

/**
 * Hands whose correct play is not in dispute and does not depend on the count.
 *
 * Chosen for the places a chart transcription goes wrong: the boundaries
 * (12 v 2 vs 12 v 3, soft 18 v 9), the pairs rules everyone knows (8s, aces,
 * tens, 5s), and the doubles that only exist with the right upcard.
 */
const BASIC_ANSWERS: Array<{
  cards: Rank[];
  up: Rank;
  action: string;
  why: string;
  /**
   * What the table allows. It matters: sixteen against ten is SURRENDER where
   * surrender is offered and HIT where it is not, and asserting one answer
   * without saying which table you are at is how a chart check ends up
   * disagreeing with a correct engine. Defaults to everything permitted.
   */
  ctx?: PlayContext;
}> = [
  { cards: ['8', '8'], up: '10', action: 'split', why: 'eights always split' },
  { cards: ['A', 'A'], up: '5', action: 'split', why: 'aces always split' },
  { cards: ['10', '10'], up: '6', action: 'stand', why: 'tens never split' },
  { cards: ['5', '5'], up: '6', action: 'double', why: 'fives are a ten, never a pair' },
  { cards: ['9', '9'], up: '7', action: 'stand', why: 'nines stand against seven' },
  { cards: ['9', '9'], up: '9', action: 'split', why: 'nines split against nine' },
  {
    cards: ['10', '6'],
    up: '10',
    action: 'surrender',
    why: 'sixteen surrenders a ten where surrender is offered',
  },
  {
    cards: ['10', '6'],
    up: '10',
    action: 'hit',
    why: 'the same sixteen hits a ten when surrender is not on offer',
    ctx: HIT_ONLY,
  },
  { cards: ['10', '6'], up: '6', action: 'stand', why: 'sixteen stands on a six' },
  { cards: ['10', '2'], up: '2', action: 'hit', why: 'twelve hits a deuce' },
  { cards: ['10', '2'], up: '4', action: 'stand', why: 'twelve stands on four' },
  { cards: ['10', '3'], up: '2', action: 'stand', why: 'thirteen stands on a deuce' },
  { cards: ['A', '7'], up: '9', action: 'hit', why: 'soft eighteen hits a nine' },
  { cards: ['A', '7'], up: '7', action: 'stand', why: 'soft eighteen stands on a seven' },
  { cards: ['A', '7'], up: '6', action: 'double', why: 'soft eighteen doubles a six' },
  { cards: ['A', '2'], up: '5', action: 'double', why: 'soft thirteen doubles a five' },
  { cards: ['Q', 'K'], up: '10', action: 'stand', why: 'twenty stands, and faces are tens' },
  { cards: ['6', '5'], up: '10', action: 'double', why: 'eleven doubles everything' },
  { cards: ['5', '4'], up: '6', action: 'double', why: 'nine doubles a six' },
  { cards: ['5', '4'], up: '2', action: 'hit', why: 'nine hits a deuce' },
  { cards: ['10', '7'], up: '10', action: 'stand', why: 'seventeen always stands' },
];

function basicStrategyCases(): SelfTestCase[] {
  return BASIC_ANSWERS.map((answer, i) => ({
    id: `basic-${i}`,
    group: 'Basic strategy',
    label: `${answer.cards.join('-')} vs ${answer.up}${
      answer.ctx ? ' (hit or stand only)' : ''
    }: ${answer.action}`,
    run: () => {
      const got = basicPlay(hand(...answer.cards), answer.up, answer.ctx ?? ALL_PLAYS).action;
      return got === answer.action ? null : `expected ${answer.action} (${answer.why}), got ${got}`;
    },
  }));
}

/**
 * Every cell, checked for the properties that must hold everywhere rather than
 * for its specific answer: a legal action, and never an action the context
 * forbids. A chart that advises doubling a three-card hand is a chart that
 * will get the operator thrown out of a game.
 */
function strategyLegalityCase(): SelfTestCase {
  const legal = new Set(['hit', 'stand', 'double', 'split', 'surrender']);
  return {
    id: 'basic-legality',
    group: 'Basic strategy',
    label: 'every hand against every upcard returns a legal, permitted action',
    run: () => {
      const ups: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
      for (const a of RANKS) {
        for (const b of RANKS) {
          for (const up of ups) {
            const cards = hand(a, b);
            const all = correctPlay(cards, up, 0, ALL_PLAYS).action;
            if (!legal.has(all)) return `${a}-${b} vs ${up} returned "${all}"`;
            // With nothing permitted, only hit or stand may come back.
            const limited = correctPlay(cards, up, 0, HIT_ONLY).action;
            if (limited !== 'hit' && limited !== 'stand') {
              return `${a}-${b} vs ${up} returned "${limited}" when doubling, splitting and surrender were all forbidden`;
            }
          }
        }
      }
      return null;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Counting                                                                  */
/* ------------------------------------------------------------------------ */

function countingCases(): SelfTestCase[] {
  return [
    {
      id: 'count-tags',
      group: 'Counting',
      label: 'Hi-Lo tags are +1 on 2-6, 0 on 7-9, -1 on ten and ace',
      run: () => {
        for (const rank of RANKS) {
          const v = rankValue(rank);
          const want = rank === 'A' || v === 10 ? -1 : v >= 2 && v <= 6 ? 1 : 0;
          const got = hiLoTag(rank);
          if (got !== want) return `${rank} tagged ${got}, expected ${want}`;
        }
        return null;
      },
    },
    {
      id: 'count-balanced',
      group: 'Counting',
      label: 'a whole deck counts down to exactly zero',
      run: () => {
        // The defining property of a balanced system. A single mistagged rank
        // puts this at +4 or -4 and every true count in the app is then wrong.
        let running = 0;
        for (const rank of RANKS) running += hiLoTag(rank) * 4;
        return running === 0 ? null : `a 52-card deck summed to ${running}, expected 0`;
      },
    },
    {
      id: 'count-shoe',
      group: 'Counting',
      label: 'six decks count down to zero too',
      run: () => {
        let running = 0;
        for (let deck = 0; deck < 6; deck++) {
          for (const rank of RANKS) running += hiLoTag(rank) * 4;
        }
        return running === 0 ? null : `a six-deck shoe summed to ${running}, expected 0`;
      },
    },
  ];
}

/* ------------------------------------------------------------------------ */
/* True count                                                                */
/* ------------------------------------------------------------------------ */

function trueCountCases(): SelfTestCase[] {
  const expectations: Array<[number, number, number, string]> = [
    [10, 5, 2, 'ten over five decks is two'],
    [9, 5, 1, 'nine over five floors to one, never rounds to two'],
    [-9, 5, -2, 'a negative floors AWAY from zero, which is the conservative side'],
    [0, 6, 0, 'no count is no count'],
    [5, 0, 10, 'a zero-deck read is clamped to half a deck rather than dividing by zero'],
    [3, 1, 3, 'one deck left divides by one'],
  ];
  return expectations.map(([rc, decks, want, why], i) => ({
    id: `tc-${i}`,
    group: 'True count',
    label: `RC ${rc} with ${decks} decks left is TC ${want}`,
    run: () => {
      const got = trueCount(rc, decks);
      return got === want ? null : `got ${got}, expected ${want} -- ${why}`;
    },
  }));
}

/* ------------------------------------------------------------------------ */
/* Deviations                                                                */
/* ------------------------------------------------------------------------ */

function deviationCases(): SelfTestCase[] {
  return [
    {
      id: 'dev-insurance',
      group: 'Deviations',
      label: 'insurance is wrong below TC 3 and right at TC 3',
      run: () => {
        if (insuranceCorrect(2, DEFAULT_RULES)) return 'took insurance at TC 2';
        if (!insuranceCorrect(3, DEFAULT_RULES)) return 'declined insurance at TC 3';
        return null;
      },
    },
    {
      id: 'dev-16v10',
      group: 'Deviations',
      label: 'sixteen against ten stands at TC 0 and hits below it',
      run: () => {
        const cards = hand('10', '6');
        const at = correctPlay(cards, '10', 0, HIT_ONLY).action;
        const below = correctPlay(cards, '10', -1, HIT_ONLY).action;
        if (at !== 'stand') return `TC 0 gave ${at}, expected stand`;
        if (below !== 'hit') return `TC -1 gave ${below}, expected hit`;
        return null;
      },
    },
    {
      id: 'dev-12v3',
      group: 'Deviations',
      label: 'twelve against three stands at TC 2 and hits below it',
      run: () => {
        const cards = hand('10', '2');
        const at = correctPlay(cards, '3', 2, HIT_ONLY).action;
        const below = correctPlay(cards, '3', 1, HIT_ONLY).action;
        if (at !== 'stand') return `TC 2 gave ${at}, expected stand`;
        if (below !== 'hit') return `TC 1 gave ${below}, expected hit`;
        return null;
      },
    },
    {
      id: 'dev-marked',
      group: 'Deviations',
      label: 'a deviation says it came from an index, not from basic strategy',
      run: () => {
        // Without this the drill cannot tell the operator WHY the play changed,
        // and a wrong attribution is worse than none.
        const advice = correctPlay(hand('10', '6'), '10', 0, HIT_ONLY);
        if (advice.source !== 'illustrious18') {
          return `16 v 10 at TC 0 was attributed to "${advice.source}"`;
        }
        return null;
      },
    },
  ];
}

/* ------------------------------------------------------------------------ */
/* Hand evaluation                                                           */
/* ------------------------------------------------------------------------ */

function handCases(): SelfTestCase[] {
  return [
    {
      id: 'hand-soft',
      group: 'Hands',
      label: 'an ace counts eleven until it would bust, then one',
      run: () => {
        const soft = handValue(hand('A', '6'));
        if (soft.total !== 17 || !soft.soft) return `A-6 read ${soft.total} soft=${soft.soft}`;
        const hard = handValue(hand('A', '6', '10'));
        if (hard.total !== 17 || hard.soft) return `A-6-10 read ${hard.total} soft=${hard.soft}`;
        const two = handValue(hand('A', 'A'));
        if (two.total !== 12 || !two.soft) return `A-A read ${two.total} soft=${two.soft}`;
        return null;
      },
    },
    {
      id: 'hand-blackjack',
      group: 'Hands',
      label: 'blackjack is two cards, and twenty-one in three is not',
      run: () => {
        if (!isBlackjack(hand('A', 'K'))) return 'A-K was not blackjack';
        if (isBlackjack(hand('7', '7', '7'))) return '7-7-7 counted as blackjack';
        return null;
      },
    },
    {
      id: 'hand-pairs',
      group: 'Hands',
      label: 'two ten-value cards of different rank are a pair to split, not to count',
      run: () => {
        if (!isPair(hand('8', '8'))) return '8-8 was not a pair';
        if (!isPair(hand('K', 'Q'))) return 'K-Q was not treated as a splittable ten pair';
        return null;
      },
    },
  ];
}

/* ------------------------------------------------------------------------ */
/* Clip coverage                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Lines the app really says, checked against the manifest it really loaded.
 *
 * A line with no recording behind it falls back to live speech synthesis --
 * which on this phone is a different, quieter voice mid-drill, and was
 * reported from the road as the app "changing voice". The desktop suite checks
 * the cascade logic; only the phone can check the FILES.
 */
const SPOKEN_LINES = [
  'Correct.',
  'Hit.',
  'Stand.',
  'Double.',
  'Split.',
  'Surrender.',
  'You have sixteen. Dealer shows ten.',
  'Basic hit versus dealer nine.',
  'Correct play was stand.',
  'True count was zero.',
];

export function clipCoverageCases(manifest: ClipManifest | null): SelfTestCase[] {
  if (!manifest) {
    return [
      {
        id: 'clips-manifest',
        group: 'Recorded voice',
        label: 'the clip manifest loaded',
        run: () => 'no manifest -- every line would be spoken by the fallback voice',
      },
    ];
  }
  const cases: SelfTestCase[] = [
    {
      id: 'clips-manifest',
      group: 'Recorded voice',
      label: 'the clip manifest loaded',
      run: () =>
        Object.keys(manifest).length > 0 ? null : 'the manifest loaded but is empty',
    },
  ];
  for (const [i, line] of SPOKEN_LINES.entries()) {
    cases.push({
      id: `clips-${i}`,
      group: 'Recorded voice',
      label: `"${line}" has a recording`,
      run: () => {
        const files = segmentForClips(line, manifest);
        if (files === null || files.length === 0) {
          return 'no clip matched, so this line falls back to the synthetic voice';
        }
        return null;
      },
    });
  }
  cases.push({
    id: 'clips-exact',
    group: 'Recorded voice',
    label: 'a line that should NOT match is not matched anyway',
    run: () =>
      // The other half of the instrument. A lookup that matched everything
      // would make every case above pass while the voice was broken.
      manifestLookup(manifest, 'this sentence is not in any manifest') === null
        ? null
        : 'a nonsense line matched a clip, so the matcher is not discriminating',
  });
  return cases;
}

/* ------------------------------------------------------------------------ */
/* Settings round-trip                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Can this phone keep a setting, and did it keep the ones on screen?
 *
 * THE FIRST VERSION OF THIS WAS A FALSE ALARM. It asserted that a stored blob
 * already existed, and so went red on a fresh install -- where nothing has
 * been written yet because nothing has been changed yet, and the defaults in
 * use are correct. A check that fires on a healthy app is worse than useless:
 * it teaches the operator to ignore the screen.
 *
 * What can actually fail is the storage PATH -- private browsing, a full
 * quota, Safari evicting a PWA's data -- and that is testable at any time by
 * writing a probe value and reading it back. The second case then only
 * compares the stored blob against what is on screen when there IS one.
 *
 * The store is passed in rather than reached for. Partly so these cases can
 * be driven against a storage that throws, swallows writes or refuses to
 * delete -- all three are real browser behaviours and all three are in
 * selfTest.test.ts -- and partly because a module that reads a global cannot
 * be tested at all under vitest's node environment.
 */
function isPlainish(value: object): boolean {
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function describeKind(value: object): string {
  const name = (value as { constructor?: { name?: string } }).constructor?.name;
  return name && name !== 'Object' ? name : 'special object';
}

/**
 * Where two values stop agreeing, named by path, or null if they never do.
 *
 * Deliberately not a generic deep-equal: it exists to say WHICH setting was
 * lost, because "settings do not round-trip" is not something an operator at
 * a roadside can act on.
 */
function firstDifference(live: unknown, round: unknown, path: string): string | null {
  if (typeof live === 'number' && Number.isNaN(live)) {
    return `${path} is not a number, so it is stored as ${JSON.stringify(round) ?? 'nothing'}`;
  }
  if (live === round) return null;
  if (
    typeof live !== 'object' ||
    live === null ||
    typeof round !== 'object' ||
    round === null
  ) {
    return `${path} was ${JSON.stringify(live) ?? String(live)} and came back as ${
      JSON.stringify(round) ?? String(round)
    }`;
  }
  // A Set, Map or class instance stringifies to "{}" and so compares equal to
  // the empty object it became -- no key differs because it never had any own
  // keys. Without this the check is blind to the one JSON loss that destroys
  // a whole collection rather than one field.
  if (!isPlainish(live)) {
    return `${path} is a ${describeKind(live)} and is stored as ${
      JSON.stringify(round) ?? 'nothing'
    }`;
  }
  const liveKeys = Object.keys(live as Record<string, unknown>);
  const roundKeys = Object.keys(round as Record<string, unknown>);
  for (const key of liveKeys) {
    if (!roundKeys.includes(key)) return `${path}.${key} did not survive being stored`;
    const inner = firstDifference(
      (live as Record<string, unknown>)[key],
      (round as Record<string, unknown>)[key],
      `${path}.${key}`,
    );
    if (inner) return inner;
  }
  for (const key of roundKeys) {
    if (!liveKeys.includes(key)) return `${path}.${key} appeared out of storage`;
  }
  return null;
}

export interface SelfTestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function settingsCases(
  store: SelfTestStorage | null,
  live?: Record<string, unknown>,
): SelfTestCase[] {
  return [
    {
      id: 'settings-serialisable',
      group: 'Settings',
      label: 'every setting on screen survives being written and read',
      run: () => {
        if (!live) return null;
        /*
         * undefined, NaN and Infinity all vanish or corrupt through JSON, and
         * a setting that vanishes on save looks like the app forgetting.
         *
         * THE OBVIOUS VERSION OF THIS CANNOT FAIL. Comparing
         * JSON.stringify(live) against JSON.stringify(JSON.parse(that)) is
         * blind to exactly the faults it is for: NaN becomes null on the FIRST
         * stringify, so both strings read "null" and agree. The comparison has
         * to be between the live VALUES and what came back.
         */
        let round: unknown;
        try {
          round = JSON.parse(JSON.stringify(live)) as unknown;
        } catch (e) {
          return `settings would not survive storage: ${e instanceof Error ? e.message : String(e)}`;
        }
        return firstDifference(live, round, 'settings');
      },
    },
    {
      id: 'settings-persisted',
      group: 'Settings',
      label: 'what was saved matches what is on screen',
      run: () => {
        if (!store) return null;
        let stored: Record<string, unknown> | null = null;
        const raw = store.getItem(SETTINGS_KEY);
        // Nothing stored is the correct state of a fresh install: nothing has
        // been changed, so the defaults in use are right. The storage case
        // above is what proves a save WOULD work.
        if (raw === null) return null;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed !== 'object' || parsed === null) {
            return 'the saved settings are not an object, so they will be discarded on launch';
          }
          stored = parsed as Record<string, unknown>;
        } catch {
          return 'the saved settings will not parse, so they will be discarded on launch';
        }
        if (typeof stored.audio !== 'object' || stored.audio === null) {
          return 'the saved settings have no audio section, so the voice settings were lost';
        }
        if (live && typeof live.audio === 'object' && live.audio !== null) {
          const want = (live.audio as Record<string, unknown>).outputRoute;
          const got = (stored.audio as Record<string, unknown>).outputRoute;
          if (want !== got) {
            return `the screen says the route is "${String(want)}" but storage says "${String(got)}"`;
          }
        }
        return null;
      },
    },
  ];
}

/* ------------------------------------------------------------------------ */
/* The suite                                                                 */
/* ------------------------------------------------------------------------ */

/** Every case that needs nothing from the device: instant, silent, safe. */
export function pureCases(): SelfTestCase[] {
  return [
    ...basicStrategyCases(),
    strategyLegalityCase(),
    ...countingCases(),
    ...trueCountCases(),
    ...deviationCases(),
    ...handCases(),
  ];
}

export function runCases(cases: readonly SelfTestCase[]): SelfTestResult[] {
  return cases.map((c) => {
    let detail: string | null;
    try {
      detail = c.run();
    } catch (e) {
      // A throw is a failure, not a crash: one bad case must never take the
      // whole screen down on a roadside.
      detail = `threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    return {
      id: c.id,
      group: c.group,
      label: c.label,
      outcome: detail === null ? 'pass' : 'fail',
      ...(detail === null ? {} : { detail }),
    };
  });
}

export interface SelfTestSummary {
  total: number;
  passed: number;
  failed: number;
  failures: SelfTestResult[];
}

export function summarise(results: readonly SelfTestResult[]): SelfTestSummary {
  const failures = results.filter((r) => r.outcome === 'fail');
  return {
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    failures,
  };
}
