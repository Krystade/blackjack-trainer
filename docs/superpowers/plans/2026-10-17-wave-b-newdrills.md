# Wave B lane N: New drills (B4 Bet sizing, B10 Rules differences) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-answer Bet or sit drill with a Bet sizing drill (RC + Play's discard tray in, the spread rung or Sit out, graded exactly as Play grades), and add an opt-in Rules differences drill that asks only the plays that change between two rulesets.

**Architecture:** B4 is a pure module `src/drills/betSizing.ts` that grades through `engine/wong.ts` (`spreadUnitsFor`, `sitOutIsCorrect`) and `engine/coverBets.ts` (`betWithinStep`), with the same depth snapping (`snapDecksRemaining`) and TC rounding (`trueCount`) as `Game.trueCountNow`. A parity test runs a real `Game` on a rigged shoe to prove it. B10 is an engine diff (`src/engine/rulesDiff.ts`: chart cells from `getChart`, index entries from `indexSetFor`) plus a drill layer (`src/drills/rulesDiffDrill.ts`) that turns the diff into questions, keeping only (cell, TC) pairs where `correctPlay`/`basicPlay` disagree between the two rulesets. Both views are thin React screens in new files; `Drills.tsx` gets only the union, branch and picker lines.

**Tech Stack:** React 19, TypeScript, Vite, Vitest (node env, `src/**/*.test.ts` only), Playwright (chromium, `E2E_PORT=4730`), oxlint.

**Spec:** `docs/superpowers/specs/2026-10-16-wave-b-design.md` (B4, B10; Global constraints). Lane contracts: `docs/superpowers/plans/2026-10-17-wave-b-contracts.md` (lane N, contract 1, rules for every lane). Evidence: `docs/superpowers/specs/2026-10-16-swarm-backlog.md` W8, D1.

**Branch / worktree:** `wave-b-newdrills`, in its own git worktree. E2E port **4730**.

> **CONTROLLER NOTE (cross-lane, from lane H):** the new drill views (Bet sizing, Rules differences) must use the existing drill top-bar classes `.drill-topbar` and `.drill-back-btn` (as the other drill views do) so lane H's mute seat applies to them. From lane D: BJA H17 soft extras arrive in index sets as entries with `kind: 'soft'` and `extra: true`; the rules diff must not crash on them (listing them is enough).

## Global Constraints

- iPhone 13 mini: 375×812, notch insets, every tap target ≥ 44px, no sideways scroll, nothing under the status bar or the mute control.
- Low friction: no new required inputs; anything new is a default-off option or a derived screen. (Rules differences is opt-in because it is a separate picker entry that changes nothing else. See "Spec ambiguities resolved".)
- Strategy truth comes only from `src/engine/*` (charts in `src/engine/charts`, indices in `deviations.ts`, `indexSetFor(strategyRulesFor(profile))`). No hard-coded strategy in UI code.
- Signed counts use a real minus sign (U+2212): use `signed()` from `src/drills/signed.ts`.
- New drills must at least work by touch and not break when eyes-free is on.
- New CSS in new files, never appended to `app.css`. `store/types.ts`: additive optional fields only.
- Contract 1, verbatim: drill mode key `'betsizing'`; `Stats` gains `betSizing?: { history: { date: string; rc: number; decksRemaining: number; tc: number; taken: number | 'sit'; correct: number | 'sit'; ok: boolean }[] }`; grading through `src/engine/wong.ts`, no second implementation; old `betSitLeave.history` stays readable.
- File ownership (lane N): new files for the two drills; delete `BetSitLeaveView.tsx` + `drills/betSitLeave.ts`; in `Drills.tsx` only the `DrillMode` union, the `if (mode === …)` branches, the view imports, and the picker `entry(…)` lines.
- Pure helpers live in `.ts` files. Exporting a non-component from a `.tsx` adds a lint warning, and the baseline is exactly 13.
- TDD; mutation-check every new test: back the file up with `cp` to the scratchpad, break it, watch the test fail, restore with `cp`. Never `git checkout --`.
- Commit explicit paths only (never `git add -A` / `.` / `src`); never commit `docs/sources/chart-view-*.png`. No audible audio, no headed browsers; read headless 375×812 screenshots.
- Do not edit source while a Playwright suite is running (vite HMR feeds half-written files to it).

## Review Focus

1. **Hand-edited spread** (unsorted rows, duplicate units, a single row, a ramp with no −99 floor). Options and grading must still match Play, and the scenario generator must not loop or crash. Tests: Task 1 parity sweep profiles `unsorted ramp` and `no floor row`, plus `single-row ramp` in the scenario tests.
2. **Double-tapped answer.** The second touch must not skip the result or record two rows. Test: Task 2 e2e `double tap records one answer`.
3. **Late surrender off.** Rules differences must never offer a Surrender button or ask a surrender cell. Test: Task 4 `no-LS plan never offers surrender`.
4. **"Other game" identical to the profile.** It must say the games play the same, with no Start and no crash. Tests: Task 4 `identical rules: nothing to ask`, Task 5 e2e `Other game identical to your game`.
5. **Profile training options flow into the comparison** (Fab 4 today, D's BJA extras after merge). Both sides keep them, and an index kind this lane does not know is listed, not crashed on. Tests: Task 3 `comparisonRules keeps the profile's options` and `cellIdForDeviation unknown kind`, Task 4 Fab 4 pool.

---

## Engine facts this plan pins (read from the engine 2026-10-17, read-only scratch scripts)

Rules base: DAS on, LS on, no Fab 4, unless stated. Chart values are raw `ChartAction`s from `getChart`. "Play" values are what `basicPlay`/`correctPlay` return for a fresh two-card hand.

**H17 → S17 chart cells**
- 6D and 8D (identical): hard 11 v A `Dh→H`, hard 15 v A `Rh→H`, hard 17 v A `Rs→S`, soft 18 (A,7) v 2 `Ds→S`, soft 19 (A,8) v 6 `Ds→S`, pair 8,8 v A `Rp→P`. **The spec's list (11vA, A7v2, A8v6, 15vA/17vA/88vA surrender) is exactly right for 6D.**
- 6D with LS off: only hard 11 v A, soft 18 v 2, soft 19 v 6 (the three surrender cells collapse).
- 2D: hard 15 v A, hard 17 v A, soft 14 (A,3) v 4 `Dh→H`, soft 18 v 2, soft 19 v 6 (no 11 v A, no 8,8 v A).
- 1D: hard 15 v A, hard 17 v A, soft 18 v A `H→S`, pair 7,7 v A `Rh→H`, pair 9,9 v A `P→S`.

**H17 → S17 index entries (`indexSetFor`, same at 1/2/6/8 decks)**
- `11vA`: inactive under H17 → `gte +1` under S17. `10vA`: `gte +3 → gte +4`. `16v9`: `gte +4 → gte +5`. `12v6`: `lte −4 → lte −2` (stored hit threshold).
- With Fab 4 on, also: `sur15vA` `gte −1 → gte +1`; `sur16v8` (`gte +4`) and `sur16v9` (`gte 0`) are H17-only.

**Where the plays actually differ (correctPlay, TC window −6..+6)**
- 6D: 12 v 6 at TC −3, −2 (H17 stands, S17 hits); 10 v A at TC +3 (H17 doubles, S17 hits); 11 v A at TC ≤ 0 (H17 doubles, S17 hits; both double from +1). The five other chart cells differ at every TC. **16 v 9 never changes a play at 6D/8D with LS on**: both sets surrender 16 v 9 before the stand index applies. It does change a play with LS off (TC +4) and at 2D/1D (TC +4).
- 6D + Fab 4: 15 v A only at TC −1, 0; 16 v 8 at TC +4 and up (H17 surrenders); 16 v 9 at TC −1 and below (H17 hits, S17 surrenders).
- 2D: 11 v A never differs (both double), so `11vA` is inert there.

**6 vs 8 decks:** zero chart cells, zero index entries (H17 and S17, Fab 4 on or off). Same `d68` chart.
**6 vs 1 deck (H17):** 17 chart cells; one index entry, `ins` `gte 3 → gte 2` (insurance differs at TC +2).

## File structure

| File | Responsibility |
|---|---|
| `src/drills/betSizing.ts` (new) | Bet sizing scenario, options, correct answer, grading (wong.ts + coverBets.ts), working text, stats row |
| `src/drills/betSizing.test.ts` (new) | Parity with a real `Game`, scenario, text, stats row |
| `src/store/types.ts` (append) | `betSizing?` on `Stats` (contract 1) |
| `src/ui/screens/drills/BetSizingView.tsx` + `betSizing.css` (new) | Bet sizing screen |
| `src/engine/rulesDiff.ts` (+ `.test.ts`) (new) | Chart and index diff of two `StrategyRules`, comparison presets, ruleset names |
| `src/drills/rulesDiffDrill.ts` (+ `.test.ts`) (new) | Question pool, draw, grade, prompt and explanation copy, tray questions |
| `src/ui/screens/drills/RulesDiffView.tsx` + `rulesDiff.css` (new) | Rules differences screen |
| `src/ui/screens/Drills.tsx` | Union, two branches, imports, picker entries only |
| deleted: `src/ui/screens/drills/BetSitLeaveView.tsx`, `src/drills/betSitLeave.ts`, `src/drills/betSitLeave.test.ts` | retired drill |
| `e2e/bet-sizing.spec.ts`, `e2e/rules-diff.spec.ts` (new) | e2e |
| `e2e/drills.spec.ts`, `smoke.spec.ts`, `offline.spec.ts`, `gutters.spec.ts`, `drill-shoe-size.spec.ts` | Only their Bet or sit lines, moved to Bet sizing |

---

### Task 1: Bet sizing grading module, proven equal to Play

**Files:**
- Create: `src/drills/betSizing.ts`
- Create: `src/drills/betSizing.test.ts`
- Modify (append only): `src/store/types.ts`. Add after the `betSitLeave` member of `interface Stats` (~line 677):
  ```ts
  // Wave B B4 (contract 1): one row per Bet sizing answer. `taken`/`correct`
  // are units, or 'sit'. Optional: absent = no history (EMPTY_STATS unchanged).
  betSizing?: {
    history: { date: string; rc: number; decksRemaining: number; tc: number; taken: number | 'sit'; correct: number | 'sit'; ok: boolean }[];
  };
  ```
  Do not touch `EMPTY_STATS` or `persist.ts`. `mergeStats` passes unknown optional sections through `...p`, and `repairStats`/`capHistories` already handle any `{ history }` section generically.

**Interfaces:**
- Consumes: `spreadUnitsFor`, `sitOutIsCorrect` (`engine/wong.ts`); `betWithinStep`, `spreadSteps` (`engine/coverBets.ts`); `snapDecksRemaining`, `mulberry32` (`engine/cards.ts`); `trueCount`, `TcRounding` (`engine/count.ts`); `SpreadRow` (`engine/game.ts`); `signed` (`drills/signed.ts`); `Stats` (`store/types.ts`).
- Produces (later tasks and lane H rely on these names):
  ```ts
  export type BetAnswer = number | 'sit';
  export interface BetSizingScenario { rc: number; cardsDealt: number; totalDecks: number }
  export interface BetGradeProfile { spread: readonly SpreadRow[]; coverBets?: boolean; tcRounding?: TcRounding } // a Profile satisfies it
  export type BetSizingRow = NonNullable<Stats['betSizing']>['history'][number];
  export function scenarioDecksRemaining(s: BetSizingScenario): number;            // snapDecksRemaining(totalDecks*52 - cardsDealt, totalDecks): Shoe.decksRemaining's rule
  export function scenarioTc(s: BetSizingScenario, rounding?: TcRounding): number; // trueCount(rc, scenarioDecksRemaining(s), rounding)
  export function betSizingOptions(spread: readonly SpreadRow[]): BetAnswer[];      // ['sit', ...spreadSteps(spread)]
  export function correctBetAnswer(tc: number, spread: readonly SpreadRow[]): BetAnswer; // sitOutIsCorrect ? 'sit' : spreadUnitsFor
  export function gradeBetSizing(taken: BetAnswer, tc: number, p: BetGradeProfile): boolean;
  export function makeBetSizingScenario(seed: number, totalDecks: number, spread: readonly SpreadRow[]): BetSizingScenario;
  export function betAnswerLabel(a: BetAnswer): string;                             // 'Sit' | `${n}u`
  export function betSizingWorking(s: BetSizingScenario, p: BetGradeProfile): string; // 'RC +7 ÷ 2.5 decks → TC +2 → 4u'
  export function betSizingRow(s: BetSizingScenario, p: BetGradeProfile, taken: BetAnswer, date: string): BetSizingRow;
  export function appendBetSizingRow(stats: Stats, row: BetSizingRow): Stats;      // pure; creates the section when absent
  ```

- [ ] **Step 1: Write the failing tests** in `src/drills/betSizing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Game, DEFAULT_SPREAD } from '../engine/game';
import { RANKS, type Card } from '../engine/cards';
import { makeDefaultProfile } from '../store/profiles';
import { playConfigFor } from '../ui/playConfig';
import { EMPTY_STATS, type Profile, type Stats } from '../store/types';
import {
  appendBetSizingRow, betAnswerLabel, betSizingOptions, betSizingRow, betSizingWorking, correctBetAnswer,
  gradeBetSizing, makeBetSizingScenario, scenarioTc, type BetAnswer,
} from './betSizing';

/** Play's own verdict on one pre-deal decision: every bet/wong event it grades is correct. */
function playVerdict(profile: Profile, rc: number, cardsDealt: number, taken: BetAnswer): boolean {
  const cfg = { ...playConfigFor({ ...profile, betSpreadOn: true }, 1000, 1), penetration: 1 };
  const cards: Card[] = Array.from({ length: profile.rules.decks * 52 }, (_, i) => ({ rank: RANKS[i % 13], suit: 's' }));
  const game = Game.withRiggedShoe(cfg, cards);
  game.discardRiggedCards(cardsDealt);
  game.runningCount = rc;
  if (taken === 'sit') game.sitOut();
  else game.startRound(taken);
  const graded = game.events.filter((e) => e.kind === 'bet' || e.kind === 'wong');
  expect(graded.length).toBeGreaterThan(0);
  return graded.every((e) => e.correct);
}

const base = makeDefaultProfile();
const PROFILES: [string, Profile][] = [
  ['default ramp', base],
  ['cover bets', { ...base, coverBets: true }],
  ['truncate rounding', { ...base, tcRounding: 'truncate' }],
  ['round rounding', { ...base, tcRounding: 'round' }],
  ['no floor row', { ...base, spread: [{ minTc: 0, units: 2 }, { minTc: 3, units: 5 }] }],
  ['unsorted ramp', { ...base, spread: [{ minTc: 3, units: 6 }, { minTc: -99, units: 1 }, { minTc: 1, units: 3 }, { minTc: 2, units: 3 }] }],
  ['one deck', { ...base, rules: { ...base.rules, decks: 1 } }],
  ['two decks', { ...base, rules: { ...base.rules, decks: 2 } }],
  ['eight decks', { ...base, rules: { ...base.rules, decks: 8 } }],
];
const RCS = [-12, -7, -4, -2, -1, 0, 1, 2, 3, 5, 8, 12];

describe('Bet sizing grades exactly as Play (D1, contract 1)', () => {
  it.each(PROFILES)('%s: same verdict as a real Game for every (RC, depth, answer)', (_, profile) => {
    const totalDecks = profile.rules.decks;
    let right = 0;
    let wrong = 0;
    // Step 17 is deliberately off the half-deck grid: Play snaps depth, the drill must too.
    for (let cardsDealt = 0; cardsDealt <= totalDecks * 52 - 26; cardsDealt += 17) {
      for (const rc of RCS) {
        const tc = scenarioTc({ rc, cardsDealt, totalDecks }, profile.tcRounding);
        for (const taken of betSizingOptions(profile.spread)) {
          const drill = gradeBetSizing(taken, tc, profile);
          expect(drill, `rc ${rc} dealt ${cardsDealt} taken ${taken}`).toBe(playVerdict(profile, rc, cardsDealt, taken));
          if (drill) right++;
          else wrong++;
        }
      }
    }
    expect(right).toBeGreaterThan(0);
    expect(wrong).toBeGreaterThan(0);
  });

  it('vacuity: cover and rounding really change some verdicts in the sweep', () => {
    let coverDiffers = 0;
    let roundingDiffers = 0;
    for (let cardsDealt = 0; cardsDealt <= 286; cardsDealt += 17) {
      for (const rc of RCS) {
        const s = { rc, cardsDealt, totalDecks: 6 };
        if (scenarioTc(s, 'truncate') !== scenarioTc(s)) roundingDiffers++;
        for (const t of betSizingOptions(DEFAULT_SPREAD)) {
          if (gradeBetSizing(t, scenarioTc(s), base) !== gradeBetSizing(t, scenarioTc(s), { ...base, coverBets: true })) coverDiffers++;
        }
      }
    }
    expect(coverDiffers).toBeGreaterThan(0);
    expect(roundingDiffers).toBeGreaterThan(0);
  });
});

describe('answers', () => {
  it('sits wherever the default ramp bets its minimum, else bets the rung', () => {
    expect(correctBetAnswer(-3, DEFAULT_SPREAD)).toBe('sit');
    expect(correctBetAnswer(0, DEFAULT_SPREAD)).toBe('sit');
    expect(correctBetAnswer(1, DEFAULT_SPREAD)).toBe(2);
    expect(correctBetAnswer(2, DEFAULT_SPREAD)).toBe(4);
    expect(correctBetAnswer(5, DEFAULT_SPREAD)).toBe(12);
    expect(correctBetAnswer(9, DEFAULT_SPREAD)).toBe(12);
  });
  it('offers Sit then every distinct rung ascending, even from a hand-edited spread', () => {
    expect(betSizingOptions(DEFAULT_SPREAD)).toEqual(['sit', 1, 2, 4, 8, 10, 12]);
    expect(betSizingOptions([{ minTc: 3, units: 5 }, { minTc: 0, units: 2 }, { minTc: 5, units: 5 }])).toEqual(['sit', 2, 5]);
  });
  it('labels', () => {
    expect(betAnswerLabel('sit')).toBe('Sit');
    expect(betAnswerLabel(4)).toBe('4u');
  });
  it('shows RC ÷ decks → TC → rung with real minus signs', () => {
    expect(betSizingWorking({ rc: 7, cardsDealt: 182, totalDecks: 6 }, base)).toBe('RC +7 ÷ 2.5 decks → TC +2 → 4u');
    expect(betSizingWorking({ rc: -3, cardsDealt: 156, totalDecks: 6 }, base)).toBe('RC −3 ÷ 3 decks → TC −1 → Sit');
    expect(betSizingWorking({ rc: 2, cardsDealt: 260, totalDecks: 6 }, base)).toBe('RC +2 ÷ 1 deck → TC +2 → 4u');
  });
});

describe('makeBetSizingScenario', () => {
  it('is seeded', () => {
    expect(makeBetSizingScenario(42, 6, DEFAULT_SPREAD)).toEqual(makeBetSizingScenario(42, 6, DEFAULT_SPREAD));
  });
  it.each([1, 2, 6, 8])('%i decks: a half-deck tray and a count the dealt cards could produce', (decks) => {
    for (let seed = 0; seed < 300; seed++) {
      const s = makeBetSizingScenario(seed, decks, DEFAULT_SPREAD);
      expect(s.totalDecks).toBe(decks);
      expect(s.cardsDealt % 26).toBe(0);
      expect(s.cardsDealt).toBeGreaterThanOrEqual(0);
      expect(s.cardsDealt).toBeLessThan(decks * 52);
      expect(Math.abs(s.rc)).toBeLessThanOrEqual(Math.round((2 * s.cardsDealt) / 52) + 1);
    }
  });
  it.each([2, 6, 8])('%i decks: every answer the ramp can call comes up, and Sit is no free pass', (decks) => {
    const counts = new Map<BetAnswer, number>();
    for (let seed = 0; seed < 600; seed++) {
      const a = correctBetAnswer(scenarioTc(makeBetSizingScenario(seed, decks, DEFAULT_SPREAD)), DEFAULT_SPREAD);
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    for (const a of ['sit', 2, 4, 8, 10, 12] as const) expect(counts.get(a) ?? 0).toBeGreaterThanOrEqual(48);
    expect(counts.get('sit') ?? 0).toBeLessThanOrEqual(240);
    expect(counts.get(1) ?? 0).toBe(0); // D1: the minimum rung is never the answer, Sit is
  });
  it('single-row ramp: terminates and always asks Sit', () => {
    const flat = [{ minTc: -99, units: 1 }];
    for (let seed = 0; seed < 50; seed++) {
      expect(correctBetAnswer(scenarioTc(makeBetSizingScenario(seed, 6, flat)), flat)).toBe('sit');
    }
  });
});

describe('stats row (contract 1)', () => {
  it('builds the row the drill records', () => {
    expect(betSizingRow({ rc: 7, cardsDealt: 182, totalDecks: 6 }, base, 2, '2026-10-17T00:00:00.000Z')).toEqual({
      date: '2026-10-17T00:00:00.000Z', rc: 7, decksRemaining: 2.5, tc: 2, taken: 2, correct: 4, ok: false,
    });
  });
  it('starts the history when absent, appends after, leaves Bet or sit history alone, and is pure', () => {
    const old: Stats = {
      ...structuredClone(EMPTY_STATS),
      betSitLeave: { history: [{ date: 'x', taken: 'bet', correctAction: 'bet', correct: true }] },
    };
    const row = betSizingRow({ rc: 7, cardsDealt: 182, totalDecks: 6 }, base, 4, '2026-10-17T00:00:00.000Z');
    const next = appendBetSizingRow(old, row);
    expect(next.betSizing).toEqual({ history: [row] });
    expect(next.betSitLeave).toEqual(old.betSitLeave);
    expect(appendBetSizingRow(next, { ...row, ok: false }).betSizing!.history).toHaveLength(2);
    expect(old.betSizing).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/drills/betSizing.test.ts`
Expected: FAIL, `Failed to resolve import "./betSizing"`.

- [ ] **Step 3: Implement `src/drills/betSizing.ts`** with the Interfaces above. Pinned decisions:
  - `gradeBetSizing` mirrors the events Play emits for that action. For `'sit'`, return `sitOutIsCorrect(tc, spread)`. For a number `n`, both must hold: `(p.coverBets ? betWithinStep(n, spreadUnitsFor(tc, spread), spread) : n === spreadUnitsFor(tc, spread))` and `!sitOutIsCorrect(tc, spread)`.
  - `makeBetSizingScenario` follows the old `drawScenario`: `decksRemaining = 0.5 * (1 + floor(rng() * totalDecks * 2))`, `cardsDealt = (totalDecks - decksRemaining) * 52`, `rcMax = round(2 * decksDealt) + 1`, `rc` uniform in `[-rcMax, rcMax]`. There is no TC clamp. Balance it by answer: pick the target uniformly from `['sit', ...spreadSteps(spread).slice(1)]`, then redraw up to 100 times until `correctBetAnswer(scenarioTc(s), spread)` equals the target (keep the last draw otherwise). `rng = mulberry32(seed)`.
  - The working text decks part reads `1 deck` for exactly 1, otherwise `${n} decks` (`0.5 decks`, `2.5 decks`). The TC uses `signed(tc)` ("TC 0" at zero). The rung uses `betAnswerLabel`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/drills/betSizing.test.ts`
Expected: PASS. The parity block should take a few seconds. If it is over 15 s, raise the `cardsDealt` step to 23. Keep it off the 26 grid.

- [ ] **Step 5: Mutation-check** (back up with `cp src/drills/betSizing.ts <scratch>/`, restore with `cp`). Each break must turn the named test red:
  1. Drop `!sitOutIsCorrect` from the numeric branch → parity `default ramp` fails (min rung at TC ≤ 0).
  2. `scenarioDecksRemaining` returns `(totalDecks*52 - cardsDealt)/52` → parity fails on the off-grid depths.
  3. Ignore `coverBets` → parity `cover bets` fails.
  4. Ignore `rounding` in `scenarioTc` → parity `truncate rounding` fails.
  5. Remove the answer balancing → the `every answer … comes up` test fails.

- [ ] **Step 6: Commit**

```bash
git add src/drills/betSizing.ts src/drills/betSizing.test.ts src/store/types.ts
git commit -m "feat(drills): bet sizing grading module, proven equal to Play's bet and wong grading"
```

---

### Task 2: Bet sizing screen replaces Bet or sit

**Files:**
- Create: `src/ui/screens/drills/BetSizingView.tsx`, `src/ui/screens/drills/betSizing.css`
- Modify: `src/ui/screens/Drills.tsx`. Swap the `BetSitLeaveView` import (line 88) for `BetSizingView`. In the `DrillMode` union (~2946) replace `| 'betsitleave'` with `| 'betsizing'`. Replace the branch at ~3087 with `if (mode === 'betsizing') return <BetSizingView settings={settings} activeProfile={activeProfile} onBack={() => setMode('picker')} />;`. Replace the picker entry at ~3161 with `{entry('betsizing', 'Bet sizing', 'Read the running count and the tray, then bet your ramp, or sit out.', true)}`. Nothing else in the file changes.
- Delete (`git rm`): `src/ui/screens/drills/BetSitLeaveView.tsx`, `src/drills/betSitLeave.ts`, `src/drills/betSitLeave.test.ts`
- Create: `e2e/bet-sizing.spec.ts`
- Modify (Bet or sit lines only):
  - `e2e/drills.spec.ts`: delete the `bet/sit/leave: answering a scenario…` test (~1599–1631; superseded by `bet-sizing.spec.ts`). In the soft-gate test (~1694–1705), change the comment and the two `'Bet or sit'` strings to `'Bet sizing'`. The `.drills-nav-note` count stays 2.
  - `e2e/smoke.spec.ts` ~255–262 and `e2e/offline.spec.ts` ~398–403: `'Bet or sit'` → `'Bet sizing'`, `.bsl-answers .action-btn` → `.bet-sizing-answers button`.
  - `e2e/gutters.spec.ts:73`: `'Bet or sit'` → `'Bet sizing'`.
  - `e2e/drill-shoe-size.spec.ts` ~86–92: rename to `bet sizing: the tray is labelled with the profile shoe` and open `'Bet sizing'`. The assertion is unchanged.

**Interfaces:**
- Consumes: Task 1's exports; `DiscardTray` (`components/DiscardTray.tsx`, props `{ cardsDealt, decks }`); `ResultStrip` (`{ id, tone, children }`); `DrillPrimaryBar`; `answerTooSoon` (`ui/answerBounce`); `focusSwallowsKey` (`ui/keyboardFocus`); `loadStats`/`saveStats`; `useAudio(settings.audio).ding('good'|'bad')`; `signed`.
- Produces: `export function BetSizingView({ settings, activeProfile, onBack }: { settings: Settings; activeProfile: Profile; onBack: () => void })`.
- DOM contract (e2e reads these):
  - Snapshot `<div className="bet-sizing-snapshot" data-rc data-cards-dealt data-decks>` holding `.bet-rc` ("RC +7"), `<DiscardTray cardsDealt decks />`, and `.deck-tray-context` ("6-deck shoe").
  - Answers grid `.bet-sizing-answers`: one `<button>` per `betSizingOptions(activeProfile.spread)`, text = `betAnswerLabel`.
  - Result: `.tc-strip-wrap > ResultStrip` containing `.bet-verdict` (`Correct` or `Wrong — 4u`) and `.bet-working` (`betSizingWorking(...)`), plus a cover line `.bet-cover` ("Cover bets on: one rung either side counts.") only when `activeProfile.coverBets`. Then `<DrillPrimaryBar label="Next" secondaryLabel="Back to Drills">`.

- [ ] **Step 1: Write the failing e2e** `e2e/bet-sizing.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { readStats, shot, withProfile } from './helpers';
import { DEFAULT_SPREAD } from '../src/engine/game';
import { signed } from '../src/drills/signed';
import {
  betAnswerLabel, betSizingOptions, betSizingWorking, correctBetAnswer, scenarioTc, type BetSizingScenario,
} from '../src/drills/betSizing';

test.use({ viewport: { width: 375, height: 812 } });
const PROFILE = { spread: DEFAULT_SPREAD }; // the e2e default profile: floor rounding, cover off

async function openBetSizing(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Bet sizing', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Bet sizing');
}

async function readScenario(page: Page): Promise<BetSizingScenario> {
  const snap = page.locator('.bet-sizing-snapshot');
  return {
    rc: Number(await snap.getAttribute('data-rc')),
    cardsDealt: Number(await snap.getAttribute('data-cards-dealt')),
    totalDecks: Number(await snap.getAttribute('data-decks')),
  };
}

const history = async (page: Page) =>
  ((await readStats(page))?.betSizing as { history: Record<string, unknown>[] } | undefined)?.history ?? [];

test('bet sizing: the right rung is graded correct, shows the working, and is recorded', async ({ page }) => {
  await openBetSizing(page);
  const s = await readScenario(page);
  await expect(page.locator('.bet-rc')).toHaveText(`RC ${signed(s.rc)}`);
  await expect(page.locator('.bet-sizing-snapshot .discard-tray--ticked')).toBeVisible(); // Play's tray component
  const right = correctBetAnswer(scenarioTc(s), DEFAULT_SPREAD);
  await page.locator('.bet-sizing-answers').getByRole('button', { name: betAnswerLabel(right), exact: true }).click();
  const strip = page.getByTestId('result-strip');
  await expect(strip).toHaveAttribute('data-tone', 'ok');
  await expect(strip.locator('.bet-verdict')).toHaveText('Correct');
  await expect(strip.locator('.bet-working')).toHaveText(betSizingWorking(s, PROFILE));
  const rows = await history(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ rc: s.rc, tc: scenarioTc(s), taken: right, correct: right, ok: true });
  await shot(page, 'bet-sizing-right');
});

test('bet sizing: a wrong rung is graded wrong and names the right one', async ({ page }) => {
  await openBetSizing(page);
  const s = await readScenario(page);
  const right = correctBetAnswer(scenarioTc(s), DEFAULT_SPREAD);
  const wrong = betSizingOptions(DEFAULT_SPREAD).find((o) => o !== right)!;
  await page.locator('.bet-sizing-answers').getByRole('button', { name: betAnswerLabel(wrong), exact: true }).click();
  const strip = page.getByTestId('result-strip');
  await expect(strip).toHaveAttribute('data-tone', 'miss');
  await expect(strip.locator('.bet-verdict')).toHaveText(`Wrong — ${betAnswerLabel(right)}`);
  expect((await history(page))[0]).toMatchObject({ taken: wrong, correct: right, ok: false });
  await shot(page, 'bet-sizing-wrong');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('result-strip')).toHaveCount(0);
  await expect(page.locator('.bet-sizing-answers button').first()).toBeVisible();
});

test('bet sizing: double tap records one answer and keeps the result on screen', async ({ page }) => {
  await openBetSizing(page);
  await page.evaluate(() => { (window as unknown as { __e2eAnswerBounceMs: number }).__e2eAnswerBounceMs = 600; });
  await page.locator('.bet-sizing-answers button').first().dblclick();
  await expect(page.getByTestId('result-strip')).toBeVisible();
  expect(await history(page)).toHaveLength(1);
});

test('bet sizing: works by touch with eyes-free on', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True count drill', exact: true }).click();
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.locator('.drill-back-btn').click();
  await page.getByRole('button', { name: 'Bet sizing', exact: true }).click();
  await page.locator('.bet-sizing-answers button').first().click();
  await expect(page.getByTestId('result-strip')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
});

test('bet sizing: 2-deck profile tray, 44px answers, no sideways scroll at 375', async ({ page }) => {
  await withProfile(page, { rules: { decks: 2 } });
  await openBetSizing(page);
  await expect(page.locator('.deck-tray-context')).toHaveText('2-deck shoe');
  expect(await page.locator('.bet-sizing-snapshot').getAttribute('data-decks')).toBe('2');
  const boxes = await page.locator('.bet-sizing-answers button').evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })));
  expect(boxes).toHaveLength(7);
  for (const b of boxes) { expect(b.w).toBeGreaterThanOrEqual(44); expect(b.h).toBeGreaterThanOrEqual(44); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await shot(page, 'bet-sizing-2d');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `E2E_PORT=4730 npx playwright test e2e/bet-sizing.spec.ts --project=chromium --reporter=line`
Expected: FAIL, no button named `Bet sizing`.

- [ ] **Step 3: Implement `BetSizingView.tsx` and `betSizing.css`, then rewire `Drills.tsx`.** Use `DeckEstimationView.tsx` for structure (topbar `.drill-topbar` with `.drill-back-btn` "Back" and `.drill-heading` "Bet sizing"; a `.settings-row.settings-note-row` "Read the tray, divide, and bet your ramp. Sit out where your ramp bets its minimum."). Pinned behaviour:
  - Scenario: `makeBetSizingScenario(randomSeed(), activeProfile.rules.decks, activeProfile.spread)`.
  - Answering:
    - Grade with `gradeBetSizing(taken, scenarioTc(s, activeProfile.tcRounding), activeProfile)`.
    - Record with `saveStats(appendBetSizingRow(loadStats(), betSizingRow(s, activeProfile, taken, new Date().toISOString())))`.
    - `ding`, then show the result.
    - During the result the answer grid stays in place, so the screen does not reflow under the finger. Mark it `aria-disabled="true"` plus a dimming class, not the `disabled` attribute. The answer handler returns early while a result is shown; that guard is what the double-tap test pins.
    - Guard Next/Back to Drills with `answerTooSoon(resultShownAt)`.
  - Keyboard: digit `k` (1-based) answers `options[k-1]`. Enter/Space on the result = Next. Skip when `focusSwallowsKey`.
  - Eyes-free is not read. This view has no audio path beyond the ding, so it renders the same either way.
  - `betSizing.css`: `.bet-sizing-answers` is a 4-column grid with a 16px side gutter; buttons have `min-height: 48px`. `.bet-rc` is large type (≥ 32px). No rules in `app.css`.
  - Delete the three retired files with `git rm`. Then edit the five existing specs as listed under Files.

- [ ] **Step 4: Run the new and migrated specs and confirm they pass**

Run: `E2E_PORT=4730 npx playwright test e2e/bet-sizing.spec.ts e2e/drills.spec.ts e2e/smoke.spec.ts e2e/offline.spec.ts e2e/gutters.spec.ts e2e/drill-shoe-size.spec.ts --project=chromium --reporter=line`
Expected: PASS. Also run `npx tsc -b`; it must show no errors (nothing may still import `betSitLeave`).

- [ ] **Step 5: Look at the screenshots.** Read `e2e/screenshots/bet-sizing-right.png`, `bet-sizing-wrong.png`, `bet-sizing-2d.png`. Check: the RC, tray and answers are visible without scrolling; there is no clipped text; nothing sits under the top-right mute control.

- [ ] **Step 6: Mutation-check** (back up `BetSizingView.tsx`; restore with `cp`):
  1. Grade with `taken === spreadUnitsFor(tc, spread)` → the right-rung test fails at Sit scenarios, or the wrong-rung test fails. Re-run 3 times if the first scenario hides it.
  2. Remove the `saveStats` call → both history assertions fail.
  3. Remove the `feedback`-shown guard in the answer handler → the double-tap test fails.
  4. Return `null` when `isEyesFreeOn()` → the eyes-free test fails.

- [ ] **Step 7: Commit**

```bash
git rm src/ui/screens/drills/BetSitLeaveView.tsx src/drills/betSitLeave.ts src/drills/betSitLeave.test.ts
git add src/ui/screens/drills/BetSizingView.tsx src/ui/screens/drills/betSizing.css src/ui/screens/Drills.tsx e2e/bet-sizing.spec.ts e2e/drills.spec.ts e2e/smoke.spec.ts e2e/offline.spec.ts e2e/gutters.spec.ts e2e/drill-shoe-size.spec.ts
git commit -m "feat(drills): Bet sizing drill replaces Bet or sit (B4)"
```

---

### Task 3: Engine diff of two rulesets

**Files:**
- Create: `src/engine/rulesDiff.ts`, `src/engine/rulesDiff.test.ts`

**Interfaces:**
- Consumes: `getChart`, `ChartAction` (`engine/charts`); `indexSetFor`, `Deviation`, `DeviationId` (`engine/deviations.ts`); `StrategyRules`, `RuleSet` (`engine/ruleset.ts`); `Rank` (`engine/cards.ts`).
- Produces:
  ```ts
  export type Comparison = 'h17s17' | 'decks68' | 'custom';
  export interface CellDiff { cellId: string; a: ChartAction; b: ChartAction }        // cellId like 'hard-11-v-A', 'soft-18-v-2', 'pair-8-v-A'
  export interface IndexDiff { id: DeviationId; a: Deviation | null; b: Deviation | null } // null = absent from that set
  export interface RulesDiff { a: StrategyRules; b: StrategyRules; sameChart: boolean; cells: CellDiff[]; indices: IndexDiff[] }
  export function diffRules(a: StrategyRules, b: StrategyRules): RulesDiff;
  export function cellIdForDeviation(d: Deviation): string | null; // 'insurance' for kind 'insurance'
  export function comparisonRules(base: StrategyRules, c: Comparison, custom?: { decks: RuleSet['decks']; s17: boolean }): [StrategyRules, StrategyRules];
  export function rulesNames(a: StrategyRules, b: StrategyRules): [string, string];
  ```
  - `diffRules`: walk HARD, SOFT and PAIRS rows of `getChart(a)`/`getChart(b)` over the up-card columns `['2','3','4','5','6','7','8','9','10','A']`. Cell id = `${'hard'|'soft'|'pair'}-${rowKey}-v-${up}`. Index entries are keyed by `id`. An entry differs when it is present on one side only, or when `threshold`, `dir`, `active`, `action` or `kind` differ. Order: `a`'s order, then `b`-only entries.
  - `cellIdForDeviation`:
    - `hard` and `surrender` → `hard-${total}-v-${up}`; `pair10` → `pair-10-v-${up}`; `insurance` → `'insurance'`.
    - Any other kind whose name contains `soft` and that has `total` and `up` → `soft-${total}-v-${up}`. This is the expected shape of lane D's soft deviations; see Cross-lane requests.
    - Anything else → `null`.
  - `comparisonRules`: `h17s17` → `[{...base, s17: false}, {...base, s17: true}]` (H17 always first). `decks68` → `[{...base, decks: 6}, {...base, decks: 8}]`. `custom` → `[base, {...base, decks: custom.decks, s17: custom.s17}]`. `base` is `strategyRulesFor(profile)`, so Fab 4 (and D's extras after merge) ride along on both sides.
  - `rulesNames`: join with ` · ` the fields that differ, in order: decks (`1 deck` / `${n} decks`), s17 (`H17` / `S17`), das (`DAS` / `no DAS`), ls (`surrender` / `no surrender`). If nothing differs → `['Your game', 'Your game']`.

- [ ] **Step 1: Write the failing tests** in `src/engine/rulesDiff.test.ts` (values are the engine facts listed above):

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES, type StrategyRules } from './ruleset';
import { ILLUSTRIOUS_18, type Deviation } from './deviations';
import { cellIdForDeviation, comparisonRules, diffRules, rulesNames } from './rulesDiff';

const r = (p: Partial<StrategyRules>): StrategyRules => ({ ...DEFAULT_RULES, ...p });
const fmt = (d: Deviation | null) => (d === null ? 'none' : `${d.active ? '' : 'off '}${d.dir} ${d.threshold}`);
const cells = (a: StrategyRules, b: StrategyRules) => diffRules(a, b).cells.map((c) => `${c.cellId}:${c.a}/${c.b}`).sort();
const idx = (a: StrategyRules, b: StrategyRules) => diffRules(a, b).indices.map((d) => `${d.id}:${fmt(d.a)}/${fmt(d.b)}`).sort();

const SIX_D_CELLS = ['hard-11-v-A:Dh/H', 'hard-15-v-A:Rh/H', 'hard-17-v-A:Rs/S', 'pair-8-v-A:Rp/P', 'soft-18-v-2:Ds/S', 'soft-19-v-6:Ds/S'];
const H17_S17_INDICES = ['10vA:gte 3/gte 4', '11vA:off gte 0/gte 1', '12v6:lte -4/lte -2', '16v9:gte 4/gte 5'];

describe('diffRules, H17 vs S17', () => {
  it('6 decks: exactly the six cells the spec names (11vA, A7v2, A8v6, 15vA/17vA/88vA surrender)', () => {
    expect(cells(r({ s17: false }), r({ s17: true }))).toEqual(SIX_D_CELLS);
    expect(diffRules(r({ s17: false }), r({ s17: true })).sameChart).toBe(false);
  });
  it('6 decks: four index changes', () => {
    expect(idx(r({ s17: false }), r({ s17: true }))).toEqual(H17_S17_INDICES);
  });
  it('8 decks: same as 6', () => {
    expect(cells(r({ decks: 8, s17: false }), r({ decks: 8, s17: true }))).toEqual(SIX_D_CELLS);
    expect(idx(r({ decks: 8, s17: false }), r({ decks: 8, s17: true }))).toEqual(H17_S17_INDICES);
  });
  it('6 decks, late surrender off: the surrender lines drop out', () => {
    expect(cells(r({ s17: false, ls: false }), r({ s17: true, ls: false }))).toEqual(['hard-11-v-A:Dh/H', 'soft-18-v-2:Ds/S', 'soft-19-v-6:Ds/S']);
  });
  it('2 decks', () => {
    expect(cells(r({ decks: 2, s17: false }), r({ decks: 2, s17: true }))).toEqual(
      ['hard-15-v-A:Rh/H', 'hard-17-v-A:Rs/S', 'soft-14-v-4:Dh/H', 'soft-18-v-2:Ds/S', 'soft-19-v-6:Ds/S']);
    expect(idx(r({ decks: 2, s17: false }), r({ decks: 2, s17: true }))).toEqual(H17_S17_INDICES);
  });
  it('1 deck', () => {
    expect(cells(r({ decks: 1, s17: false }), r({ decks: 1, s17: true }))).toEqual(
      ['hard-15-v-A:Rh/H', 'hard-17-v-A:Rs/S', 'pair-7-v-A:Rh/H', 'pair-9-v-A:P/S', 'soft-18-v-A:H/S']);
    expect(idx(r({ decks: 1, s17: false }), r({ decks: 1, s17: true }))).toEqual(H17_S17_INDICES);
  });
  it('Fab 4 on: 15 v A moves two counts and two surrender indices are H17-only', () => {
    expect(idx(r({ s17: false, surrenderIndices: true }), r({ s17: true, surrenderIndices: true }))).toEqual(
      [...H17_S17_INDICES, 'sur15vA:gte -1/gte 1', 'sur16v8:gte 4/none', 'sur16v9:gte 0/none']);
  });
});

describe('diffRules, deck counts', () => {
  it.each([false, true])('6 vs 8 decks share the d68 chart and every index (s17 %s)', (s17) => {
    for (const surrenderIndices of [false, true]) {
      const d = diffRules(r({ decks: 6, s17, surrenderIndices }), r({ decks: 8, s17, surrenderIndices }));
      expect(d.sameChart).toBe(true);
      expect(d.cells).toEqual([]);
      expect(d.indices).toEqual([]);
    }
  });
  it('6 vs 1 deck: 17 chart cells and only the insurance index', () => {
    const d = diffRules(r({}), r({ decks: 1 }));
    expect(d.cells).toHaveLength(17);
    expect(idx(r({}), r({ decks: 1 }))).toEqual(['ins:gte 3/gte 2']);
  });
});

describe('cellIdForDeviation', () => {
  const byId = (id: string) => ILLUSTRIOUS_18.find((d) => d.id === id)!;
  it('maps every kind this lane knows', () => {
    expect(cellIdForDeviation(byId('12v6'))).toBe('hard-12-v-6');
    expect(cellIdForDeviation(byId('10vA'))).toBe('hard-10-v-A');
    expect(cellIdForDeviation(byId('TTv5'))).toBe('pair-10-v-5');
    expect(cellIdForDeviation(byId('ins'))).toBe('insurance');
  });
  it('maps a soft kind with total and up, and returns null for an unknown kind', () => {
    expect(cellIdForDeviation({ ...byId('9v2'), kind: 'soft', total: 19, up: '6' } as unknown as Deviation)).toBe('soft-19-v-6');
    expect(cellIdForDeviation({ ...byId('9v2'), kind: 'mystery' } as unknown as Deviation)).toBeNull();
  });
});

describe('comparisonRules and rulesNames', () => {
  it("comparisonRules keeps the profile's options on both sides", () => {
    const base = r({ decks: 2, s17: true, surrenderIndices: true });
    expect(comparisonRules(base, 'h17s17')).toEqual([{ ...base, s17: false }, { ...base, s17: true }]);
    expect(comparisonRules(base, 'decks68')).toEqual([{ ...base, decks: 6 }, { ...base, decks: 8 }]);
    expect(comparisonRules(base, 'custom', { decks: 8, s17: false })).toEqual([base, { ...base, decks: 8, s17: false }]);
  });
  it('names only what differs', () => {
    expect(rulesNames(r({ s17: false }), r({ s17: true }))).toEqual(['H17', 'S17']);
    expect(rulesNames(r({ decks: 6 }), r({ decks: 8 }))).toEqual(['6 decks', '8 decks']);
    expect(rulesNames(r({ decks: 6, s17: false }), r({ decks: 1, s17: true }))).toEqual(['6 decks · H17', '1 deck · S17']);
    expect(rulesNames(r({ ls: true }), r({ ls: false }))).toEqual(['surrender', 'no surrender']);
    expect(rulesNames(r({}), r({}))).toEqual(['Your game', 'Your game']);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/engine/rulesDiff.test.ts`
Expected: FAIL, cannot resolve `./rulesDiff`.

- [ ] **Step 3: Implement `src/engine/rulesDiff.ts`** per the Interfaces. It is engine-only: no imports from `drills/` or `ui/`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/engine/rulesDiff.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation-check** (back up; restore with `cp`):
  1. Skip the PAIRS table → `6 decks: exactly the six cells` fails.
  2. Compare `threshold` only → `11vA` disappears and `four index changes` fails.
  3. Drop entries present on one side only → `Fab 4 on` fails.
  4. Have `comparisonRules` build from `DEFAULT_RULES` instead of `base` → `keeps the profile's options` fails.

- [ ] **Step 6: Commit**

```bash
git add src/engine/rulesDiff.ts src/engine/rulesDiff.test.ts
git commit -m "feat(engine): diff two rulesets' basic charts and index sets (B10)"
```

---

### Task 4: Rules differences question model

**Files:**
- Create: `src/drills/rulesDiffDrill.ts`, `src/drills/rulesDiffDrill.test.ts`

**Interfaces:**
- Consumes: Task 3 (`diffRules`, `rulesNames`, `cellIdForDeviation`, `RulesDiff`, `IndexDiff`); `basicPlay`, `correctPlay`, `insuranceCorrect`, `PlayContext` (`engine/strategy.ts`); `generateAllCells` (`drills/flashcards.ts`, the hands for cell ids); `drillLegalActions` (`drills/legalActions.ts`); `makeDeckEstimationQuestion`, `gradeDeckEstimate` (`drills/deckEstimation.ts`); `depthOptions` (`drills/depthResolution.ts`); `trueCount`, `tcBand`, `tcWithinEye`, `EYE_DECK_ERROR`, `TcRounding` (`engine/count.ts`); `mulberry32`; `signed`.
- Produces:
  ```ts
  export type Side = 'a' | 'b';
  export const DIFF_TC_WINDOW: readonly [number, number] = [-6, 6];
  export type PoolItem =
    | { kind: 'play'; cellId: string; cards: Card[]; up: Rank; tcs: number[] | null } // null = basic strategy, no count shown
    | { kind: 'insurance'; tcs: number[] };
  export interface RulesDrillPlan {
    a: StrategyRules; b: StrategyRules; names: [string, string]; diff: RulesDiff;
    pool: PoolItem[]; inert: IndexDiff[]; trayDecks: number | null;
  }
  export type RulesQuestion =
    | { kind: 'play'; side: Side; cellId: string; cards: Card[]; up: Rank; tc: number | null }
    | { kind: 'insurance'; side: Side; tc: number }
    | { kind: 'tray-decks'; side: Side; totalDecks: number; cardsDealt: number }
    | { kind: 'tray-tc'; side: Side; totalDecks: number; cardsDealt: number; rc: number };
  export type RulesAnswer = Action | 'take-insurance' | 'decline-insurance' | number;
  export function planRulesDrill(a: StrategyRules, b: StrategyRules): RulesDrillPlan;
  export function drawRulesQuestion(plan: RulesDrillPlan, seed: number, n: number): RulesQuestion | null;
  export function sideRules(plan: RulesDrillPlan, side: Side): StrategyRules;
  export function questionCtx(rules: StrategyRules): PlayContext; // { canDouble: true, canSplit: true, canSurrender: rules.ls }
  export function expectedRulesAnswer(q: RulesQuestion, plan: RulesDrillPlan, rounding?: TcRounding): RulesAnswer;
  export function gradeRulesAnswer(q: RulesQuestion, plan: RulesDrillPlan, taken: RulesAnswer, rounding?: TcRounding): boolean;
  export function rulesAnswerOptions(q: RulesQuestion, plan: RulesDrillPlan): RulesAnswer[]; // tray-tc → [] (NumPad); see below for play
  export function rulesAnswerLabel(q: RulesQuestion, a: RulesAnswer): string; // 'Hit'…'Surrender', 'Take insurance', 'No insurance', depth '5'/'5.5', TC signed
  export function rulesQuestionPrompt(q: RulesQuestion, plan: RulesDrillPlan): string;
  export function explainRulesQuestion(q: RulesQuestion, plan: RulesDrillPlan, rounding?: TcRounding): string;
  export function diffSummary(plan: RulesDrillPlan): string[];   // one line per pool item
  export function inertNotes(plan: RulesDrillPlan): string[];
  export function sameChartNotice(plan: RulesDrillPlan): string | null;
  ```
- Pool algorithm (pinned):
  1. `playDiffTcs(cellId)` = the TCs in `DIFF_TC_WINDOW` where `correctPlay(cards, up, tc, questionCtx(a), a).action !== correctPlay(cards, up, tc, questionCtx(b), b).action` (hands from `generateAllCells()`; cells it cannot deal are skipped).
  2. For each `diff.cells` entry whose `playDiffTcs` covers the whole window and whose `basicPlay` actions differ, add a basic item (`tcs: null`). Otherwise, if the TC list is non-empty, add an index item with those TCs.
  3. For each `diff.indices` entry, map it with `cellIdForDeviation`; skip it if that cell is already in the pool.
     - `'insurance'`: add an insurance item with the TCs where `insuranceCorrect(tc, a) !== insuranceCorrect(tc, b)`, if any.
     - A dealable cell with non-empty `playDiffTcs`: add an index item.
     - Otherwise push the entry to `inert`.
  4. `trayDecks = diff.sameChart && a.decks !== b.decks ? Math.max(a.decks, b.decks) : null`.
- Draw algorithm (pinned, `rng = mulberry32(seed)`):
  - If the pool is empty and `trayDecks === null` → `null`.
  - If `trayDecks` is set and (pool empty or `n % 3 === 2`), ask a tray question. Kind: `n % 2 === 0` → `tray-decks`, else `tray-tc`. Side: the side whose `decks === trayDecks`.
    - `tray-decks`: `cardsDealt` from `makeDeckEstimationQuestion(seed, { totalDecks: trayDecks })`.
    - `tray-tc`: decks remaining is a half step in `[1, trayDecks - 1]`; `cardsDealt = (trayDecks - remaining) * 52`; `rc` uniform in `±(round(2 * dealtDecks) + 1)`.
  - Otherwise: item = uniform pool pick; `side = n % 2 === 0 ? 'a' : 'b'`; `tc` = a uniform pick from `item.tcs`, or `null` for a basic item.
- Copy (pinned; `name` = `plan.names[side]`, hand label from the cell id: `11`, `A,7`, `8,8`, `10,10`):
  - Prompt, basic: `Under S17: A,7 v 2?`. With TC: `Under H17 at TC −3: 12 v 6?`. Insurance: `Under 1 deck at TC +2: insurance?`. Tray: `Under 8 decks: how many decks are left?` / `Under 8 decks: RC +9. True count?`.
  - Explain, basic: `Basic strategy, A,7 v 2: H17 doubles, S17 stands.`
  - Explain, with TC: `At TC −3, 12 v 6: H17 stands, S17 hits.` When the cell has index entries, append ` Index: H17 hit ≤ −4, S17 hit ≤ −2.` Per side: `none` if absent or inactive; else `${verb} ≥ ${signed(t)}` / `${verb} ≤ ${signed(t)}`. Verbs: hit, stand, double, split, surrender, insure.
  - Explain, insurance: `At TC +2: 6 decks declines insurance, 1 deck takes insurance.`
  - Explain, tray: `130 of 416 cards dealt: 5.5 decks left.` / `RC +9 ÷ 4.5 decks → TC +2 (+1 to +2 accepted).` Omit the bracket when the band is a single TC.
  - Plays in third person: hits, stands, doubles, splits, surrenders.
  - Summary line, basic: `A,7 v 2: H17 doubles, S17 stands`. With TCs: `12 v 6 at TC −3 to −2: …`, `10 v A at TC +3: …`, `11 v A at TC 0 and below: …` (`… and above` when the max is the window's top).
  - `sameChartNotice`: when `diff.sameChart`: `${A} and ${B} use the same basic chart` + (`indices` empty ? ` and the same index plays.` : `.`) + (trayDecks ? ` What changes is the shoe: you divide by more decks. Practise reading the ${trayDecks}-deck tray.` : ``). Otherwise `null`.
  - `inertNotes`: `16 v 9: the index differs (H17 stand ≥ +4, S17 stand ≥ +5) but never changes a play at this table.`

- [ ] **Step 1: Write the failing tests** in `src/drills/rulesDiffDrill.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES, type StrategyRules } from '../engine/ruleset';
import { generateAllCells } from './flashcards';
import {
  diffSummary, drawRulesQuestion, expectedRulesAnswer, explainRulesQuestion, gradeRulesAnswer, inertNotes,
  planRulesDrill, rulesAnswerOptions, rulesQuestionPrompt, sameChartNotice,
  type RulesDrillPlan, type RulesQuestion, type Side,
} from './rulesDiffDrill';

const r = (p: Partial<StrategyRules>): StrategyRules => ({ ...DEFAULT_RULES, ...p });
const poolOf = (plan: RulesDrillPlan) =>
  plan.pool.map((i) => (i.kind === 'play' ? `${i.cellId}:${i.tcs === null ? 'basic' : i.tcs.join(',')}` : `insurance:${i.tcs.join(',')}`)).sort();
const cell = (id: string) => generateAllCells().find((c) => c.id === id)!;
const play = (id: string, side: Side, tc: number | null): RulesQuestion => ({ kind: 'play', side, cellId: id, cards: cell(id).cards, up: cell(id).up, tc });

const H17S17 = planRulesDrill(r({ s17: false }), r({ s17: true }));

describe('planRulesDrill pools only what changes', () => {
  it('6D H17 vs S17: five basic cells, three counted ones, 16 v 9 inert under late surrender', () => {
    expect(poolOf(H17S17)).toEqual([
      'hard-10-v-A:3', 'hard-11-v-A:-6,-5,-4,-3,-2,-1,0', 'hard-12-v-6:-3,-2',
      'hard-15-v-A:basic', 'hard-17-v-A:basic', 'pair-8-v-A:basic', 'soft-18-v-2:basic', 'soft-19-v-6:basic',
    ]);
    expect(H17S17.inert.map((d) => d.id)).toEqual(['16v9']);
    expect(H17S17.trayDecks).toBeNull();
    expect(sameChartNotice(H17S17)).toBeNull();
  });
  it('6D with Fab 4', () => {
    const plan = planRulesDrill(r({ s17: false, surrenderIndices: true }), r({ s17: true, surrenderIndices: true }));
    expect(poolOf(plan)).toEqual([
      'hard-10-v-A:3', 'hard-11-v-A:-6,-5,-4,-3,-2,-1,0', 'hard-12-v-6:-3,-2', 'hard-15-v-A:-1,0',
      'hard-16-v-8:4,5,6', 'hard-16-v-9:-6,-5,-4,-3,-2,-1', 'hard-17-v-A:basic', 'pair-8-v-A:basic',
      'soft-18-v-2:basic', 'soft-19-v-6:basic',
    ]);
    expect(plan.inert).toEqual([]);
  });
  it('6D with late surrender off: 16 v 9 now matters at +4', () => {
    const plan = planRulesDrill(r({ s17: false, ls: false }), r({ s17: true, ls: false }));
    expect(poolOf(plan)).toEqual([
      'hard-10-v-A:3', 'hard-11-v-A:-6,-5,-4,-3,-2,-1,0', 'hard-12-v-6:-3,-2', 'hard-16-v-9:4',
      'soft-18-v-2:basic', 'soft-19-v-6:basic',
    ]);
  });
  it('no-LS plan never offers surrender', () => {
    const plan = planRulesDrill(r({ s17: false, ls: false }), r({ s17: true, ls: false }));
    for (let seed = 0; seed < 100; seed++) {
      const q = drawRulesQuestion(plan, seed, seed % 2)!;
      expect(rulesAnswerOptions(q, plan)).not.toContain('surrender');
    }
  });
  it('the buttons never give the answer away: same options under both rules', () => {
    for (const item of H17S17.pool) {
      if (item.kind !== 'play') continue;
      const tc = item.tcs === null ? null : item.tcs[0];
      expect(rulesAnswerOptions(play(item.cellId, 'a', tc), H17S17)).toEqual(rulesAnswerOptions(play(item.cellId, 'b', tc), H17S17));
    }
    expect(rulesAnswerOptions(play('pair-8-v-A', 'b', null), H17S17)).toContain('surrender');
  });
  it('2D: 11 v A is inert there', () => {
    const plan = planRulesDrill(r({ decks: 2, s17: false }), r({ decks: 2, s17: true }));
    expect(poolOf(plan)).toEqual([
      'hard-10-v-A:3', 'hard-12-v-6:-3,-2', 'hard-15-v-A:basic', 'hard-16-v-9:4', 'hard-17-v-A:basic',
      'soft-14-v-4:basic', 'soft-18-v-2:basic', 'soft-19-v-6:basic',
    ]);
    expect(plan.inert.map((d) => d.id)).toEqual(['11vA']);
  });
  it('6 vs 8 decks: nothing to ask on the chart, the 8-deck tray instead', () => {
    const plan = planRulesDrill(r({ decks: 6 }), r({ decks: 8 }));
    expect(plan.pool).toEqual([]);
    expect(plan.trayDecks).toBe(8);
    expect(sameChartNotice(plan)).toBe(
      '6 decks and 8 decks use the same basic chart and the same index plays. What changes is the shoe: you divide by more decks. Practise reading the 8-deck tray.');
    const q0 = drawRulesQuestion(plan, 7, 0)!;
    const q1 = drawRulesQuestion(plan, 7, 1)!;
    expect([q0.kind, q0.side, q1.kind, q1.side]).toEqual(['tray-decks', 'b', 'tray-tc', 'b']);
    if (q1.kind !== 'tray-tc') throw new Error('unreachable');
    expect(q1.cardsDealt % 26).toBe(0);
    expect(q1.cardsDealt).toBeGreaterThanOrEqual(52);
    expect(q1.cardsDealt).toBeLessThanOrEqual(364);
  });
  it('identical rules: nothing to ask', () => {
    const plan = planRulesDrill(r({}), r({}));
    expect(plan.pool).toEqual([]);
    expect(plan.trayDecks).toBeNull();
    expect(drawRulesQuestion(plan, 1, 0)).toBeNull();
  });
  it('6 vs 1 deck asks insurance at +2', () => {
    expect(poolOf(planRulesDrill(r({}), r({ decks: 1 })))).toContain('insurance:2');
  });
});

const PLANS: [string, StrategyRules, StrategyRules][] = [
  ['6D H17/S17', r({ s17: false }), r({ s17: true })],
  ['6D Fab 4', r({ s17: false, surrenderIndices: true }), r({ s17: true, surrenderIndices: true })],
  ['6D no LS', r({ s17: false, ls: false }), r({ s17: true, ls: false })],
  ['2D', r({ decks: 2, s17: false }), r({ decks: 2, s17: true })],
  ['1D', r({ decks: 1, s17: false }), r({ decks: 1, s17: true })],
  ['6D vs 1D', r({}), r({ decks: 1 })],
];
describe('drawRulesQuestion', () => {
  it.each(PLANS)('%s: every question is one the two games answer differently, and every change gets asked', (_, a, b) => {
    const plan = planRulesDrill(a, b);
    const seen = new Set<string>();
    for (let seed = 0; seed < 150; seed++) {
      for (let n = 0; n < 4; n++) {
        const q = drawRulesQuestion(plan, seed, n)!;
        expect(q.side).toBe(n % 2 === 0 ? 'a' : 'b');
        if (q.kind !== 'play' && q.kind !== 'insurance') throw new Error(`unexpected ${q.kind}`);
        expect(expectedRulesAnswer({ ...q, side: 'a' }, plan)).not.toEqual(expectedRulesAnswer({ ...q, side: 'b' }, plan));
        if (q.kind === 'play') {
          const item = plan.pool.find((i) => i.kind === 'play' && i.cellId === q.cellId)!;
          expect(item.kind === 'play' && (item.tcs === null ? q.tc === null : item.tcs.includes(q.tc!))).toBe(true);
        }
        seen.add(q.kind === 'play' ? q.cellId : 'insurance');
      }
    }
    expect(seen.size).toBe(plan.pool.length);
  });
  it('is seeded', () => {
    expect(drawRulesQuestion(H17S17, 42, 3)).toEqual(drawRulesQuestion(H17S17, 42, 3));
  });
});

describe('grading under the rules in force', () => {
  it('chart and index cells', () => {
    expect(gradeRulesAnswer(play('hard-11-v-A', 'a', 0), H17S17, 'double')).toBe(true);
    expect(gradeRulesAnswer(play('hard-11-v-A', 'b', 0), H17S17, 'hit')).toBe(true);
    expect(gradeRulesAnswer(play('hard-11-v-A', 'b', 0), H17S17, 'double')).toBe(false);
    expect(gradeRulesAnswer(play('hard-12-v-6', 'a', -3), H17S17, 'stand')).toBe(true);
    expect(gradeRulesAnswer(play('hard-12-v-6', 'b', -3), H17S17, 'hit')).toBe(true);
    expect(gradeRulesAnswer(play('soft-18-v-2', 'a', null), H17S17, 'double')).toBe(true);
    expect(gradeRulesAnswer(play('soft-18-v-2', 'b', null), H17S17, 'stand')).toBe(true);
    expect(gradeRulesAnswer(play('pair-8-v-A', 'b', null), H17S17, 'split')).toBe(true);
  });
  it('insurance: 1 deck takes at +2, 6 decks declines', () => {
    const plan = planRulesDrill(r({}), r({ decks: 1 }));
    expect(gradeRulesAnswer({ kind: 'insurance', side: 'b', tc: 2 }, plan, 'take-insurance')).toBe(true);
    expect(gradeRulesAnswer({ kind: 'insurance', side: 'a', tc: 2 }, plan, 'decline-insurance')).toBe(true);
    expect(rulesAnswerOptions({ kind: 'insurance', side: 'a', tc: 2 }, plan)).toEqual(['take-insurance', 'decline-insurance']);
  });
  it('tray questions grade with half-deck slack', () => {
    const plan = planRulesDrill(r({ decks: 6 }), r({ decks: 8 }));
    const decksQ: RulesQuestion = { kind: 'tray-decks', side: 'b', totalDecks: 8, cardsDealt: 130 };
    expect(gradeRulesAnswer(decksQ, plan, 5.5)).toBe(true);
    expect(gradeRulesAnswer(decksQ, plan, 4.5)).toBe(false);
    const tcQ: RulesQuestion = { kind: 'tray-tc', side: 'b', totalDecks: 8, cardsDealt: 182, rc: 9 }; // 4.5 decks left
    expect(gradeRulesAnswer(tcQ, plan, 2)).toBe(true);
    expect(gradeRulesAnswer(tcQ, plan, 1)).toBe(true); // 9 ÷ 5 = 1.8, a half-deck misread
    expect(gradeRulesAnswer(tcQ, plan, 3)).toBe(false);
  });
});

describe('copy', () => {
  it('prompts say which rules are in force', () => {
    expect(rulesQuestionPrompt(play('soft-18-v-2', 'b', null), H17S17)).toBe('Under S17: A,7 v 2?');
    expect(rulesQuestionPrompt(play('hard-12-v-6', 'a', -3), H17S17)).toBe('Under H17 at TC −3: 12 v 6?');
  });
  it('explanations name both rules', () => {
    expect(explainRulesQuestion(play('soft-18-v-2', 'b', null), H17S17)).toBe('Basic strategy, A,7 v 2: H17 doubles, S17 stands.');
    expect(explainRulesQuestion(play('hard-12-v-6', 'a', -3), H17S17)).toBe(
      'At TC −3, 12 v 6: H17 stands, S17 hits. Index: H17 hit ≤ −4, S17 hit ≤ −2.');
    expect(explainRulesQuestion(play('hard-11-v-A', 'b', 0), H17S17)).toBe(
      'At TC 0, 11 v A: H17 doubles, S17 hits. Index: H17 none, S17 double ≥ +1.');
    const p61 = planRulesDrill(r({}), r({ decks: 1 }));
    expect(explainRulesQuestion({ kind: 'insurance', side: 'b', tc: 2 }, p61)).toBe(
      'At TC +2: 6 decks declines insurance, 1 deck takes insurance.');
    const p68 = planRulesDrill(r({ decks: 6 }), r({ decks: 8 }));
    expect(explainRulesQuestion({ kind: 'tray-decks', side: 'b', totalDecks: 8, cardsDealt: 130 }, p68)).toBe('130 of 416 cards dealt: 5.5 decks left.');
    expect(explainRulesQuestion({ kind: 'tray-tc', side: 'b', totalDecks: 8, cardsDealt: 182, rc: 9 }, p68)).toBe(
      'RC +9 ÷ 4.5 decks → TC +2 (+1 to +2 accepted).');
  });
  it('summary and inert notes', () => {
    const lines = diffSummary(H17S17);
    expect(lines).toHaveLength(8);
    expect(lines).toContain('A,7 v 2: H17 doubles, S17 stands');
    expect(lines).toContain('12 v 6 at TC −3 to −2: H17 stands, S17 hits');
    expect(lines).toContain('10 v A at TC +3: H17 doubles, S17 hits');
    expect(lines).toContain('11 v A at TC 0 and below: H17 doubles, S17 hits');
    expect(inertNotes(H17S17)).toEqual([
      '16 v 9: the index differs (H17 stand ≥ +4, S17 stand ≥ +5) but never changes a play at this table.']);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/drills/rulesDiffDrill.test.ts`
Expected: FAIL, cannot resolve `./rulesDiffDrill`.

- [ ] **Step 3: Implement `src/drills/rulesDiffDrill.ts`** per the Interfaces and the pinned algorithms. `expectedRulesAnswer` by kind:
  - play: `tc === null ? basicPlay(...)` else `correctPlay(...)`, under `sideRules(plan, q.side)` and `questionCtx`.
  - insurance: `insuranceCorrect(tc, rules) ? 'take-insurance' : 'decline-insurance'`.
  - tray-decks: the exact `(totalDecks*52 - cardsDealt)/52`.
  - tray-tc: `trueCount(rc, remaining, rounding)`.

  `gradeRulesAnswer` by kind: tray-decks → `gradeDeckEstimate(taken, exact, 0.5).correct`; tray-tc → `tcWithinEye(taken, rc, remaining, EYE_DECK_ERROR, rounding)`; otherwise equality. `rulesAnswerOptions` by kind:
  - play: the **union** of `drillLegalActions(cards, rulesX, up, questionCtx(rulesX))` over both sides, in the order hit, stand, double, split, surrender, with surrender kept only if the side in force has `ls`. The union matters because `drillLegalActions` hides Surrender on pairs whose own chart does not surrender (8,8 v A under S17). Per-side buttons would give the answer away and make the H17-habit mistake impossible to make.
  - tray-decks: `depthOptions(totalDecks, 'half')`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/drills/rulesDiffDrill.test.ts src/engine/rulesDiff.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation-check** (back up; restore with `cp`):
  1. Make every item basic (`tcs: null`) → the 6D pool test and `every question is one the two games answer differently` fail (11 v A at +1 agrees).
  2. Ignore the index-set entries (cells only) → `hard-12-v-6`/`hard-10-v-A` vanish and the pool test fails.
  3. Always `side = 'a'` → the side assertion fails.
  4. Drop the "surrender only if the side has `ls`" filter and return all five actions → `no-LS plan never offers surrender` fails. Use the side's own `drillLegalActions` instead of the union → `the buttons never give the answer away` fails (8,8 v A).
  5. Grade tray-tc with exact equality → `tray questions … slack` fails on 1.

- [ ] **Step 6: Commit**

```bash
git add src/drills/rulesDiffDrill.ts src/drills/rulesDiffDrill.test.ts
git commit -m "feat(drills): Rules differences question model, only the plays that change (B10)"
```

---

### Task 5: Rules differences screen (chart, index and insurance questions)

**Files:**
- Create: `src/ui/screens/drills/RulesDiffView.tsx`, `src/ui/screens/drills/rulesDiff.css`
- Modify: `src/ui/screens/Drills.tsx`. Import `RulesDiffView`; add `| 'rulesdiff'` to `DrillMode`; add the branch `if (mode === 'rulesdiff') return <RulesDiffView settings={settings} activeProfile={activeProfile} onBack={() => setMode('picker')} />;`. Add the picker entry after Speed in "Knowing the plays": `{entry('rulesdiff', 'Rules differences', 'Only the plays that change between H17 and S17, 6 and 8 decks, or another game.')}`. It is not `advanced`, so the fluency-nudge count stays 2.
- Create: `e2e/rules-diff.spec.ts`

**Interfaces:**
- Consumes: Tasks 3–4; `strategyRulesFor` (`store/profiles.ts`); `Segmented` (exported from `screens/Settings.tsx`); `PlayingCard`; `ResultStrip`; `DrillPrimaryBar`; `answerTooSoon`; `focusSwallowsKey`; `useAudio(...).ding`.
- Produces: `export function RulesDiffView({ settings, activeProfile, onBack }: { settings: Settings; activeProfile: Profile; onBack: () => void })`.
- Screen:
  - **Setup** (`phase === 'setup'`):
    - `Segmented` comparison: `H17 ↔ S17` (default) / `6 ↔ 8 decks` / `Other game`.
    - With `Other game`: a decks `Segmented` (`1`, `2`, `6`, `8`; default = profile's) and a dealer `Segmented` (`H17` / `S17`; default = the opposite of the profile's).
    - The plan is `planRulesDrill(...comparisonRules(strategyRulesFor(activeProfile), comparison, custom))` (memoised).
    - Below the controls:
      - `.rules-diff-notice`: `sameChartNotice`, when non-null.
      - `<ul className="rules-diff-summary">`: one `<li>` per `diffSummary` line.
      - `.rules-diff-inert`: `inertNotes`.
      - If `drawRulesQuestion(plan, 0, 0) === null`, show `.rules-diff-notice` "These two games play the same. Pick another comparison." and no Start. Otherwise show `<DrillPrimaryBar label="Start" variant="start">`.
    - In this task a plan whose pool is empty (6 ↔ 8) shows its notice and **no Start**; Task 6 adds the tray questions.
  - **Question:**
    - `.rules-diff-inforce` (large): `Under S17` (+ ` · TC −3` when the question has a TC).
    - `<div className="rules-diff-question" data-kind data-side data-cell data-tc>` holding the prompt text (`rulesQuestionPrompt`). Play questions also show the dealer up-card and two `PlayingCard`s, using the existing `.dealer-area` / `.hands-row` / `.player-hand` / `.hand-cards` markup.
    - `.rules-diff-answers`: one `<button>` per `rulesAnswerOptions`, text = `rulesAnswerLabel`.
    - Keyboard: digit k answers option k, for play and insurance questions only (tray-decks has no digit shortcut; tray-tc's NumPad owns the keys). Enter/Space on the result = Next.
  - **Result:**
    - `.tc-strip-wrap > ResultStrip` with `.rules-verdict` (`Correct` or `Wrong — Hit`) and `.rules-explain` (`explainRulesQuestion`).
    - `<DrillPrimaryBar label="Next" secondaryLabel="Change comparison">`; the secondary returns to setup. Both are guarded by `answerTooSoon`.
    - Question number `n` increments per question; `seed = randomSeed()` per question; grade with `activeProfile.tcRounding`.
  - No stats are recorded (the spec asks for none). Eyes-free is not read.
  - `rulesDiff.css`: answer buttons `min-height: 48px`, 16px gutters, summary list readable at 375. Nothing in `app.css`.

- [ ] **Step 1: Write the failing e2e** `e2e/rules-diff.spec.ts` (the H17/S17 table is the engine facts above, for the e2e default profile 6D DAS LS no Fab 4):

```ts
import { test, expect, type Page } from '@playwright/test';
import { shot } from './helpers';
import { DEFAULT_RULES } from '../src/engine/ruleset';
import { comparisonRules } from '../src/engine/rulesDiff';
import { diffSummary, planRulesDrill } from '../src/drills/rulesDiffDrill';

test.use({ viewport: { width: 375, height: 812 } });

// Read from getChart / indexSetFor / correctPlay for 6D DAS LS (plan 2026-10-17). Same answer at every TC the drill asks.
const H17_S17_6D: Record<string, { h17: string; s17: string }> = {
  'hard-11-v-A': { h17: 'Double', s17: 'Hit' },
  'hard-15-v-A': { h17: 'Surrender', s17: 'Hit' },
  'hard-17-v-A': { h17: 'Surrender', s17: 'Stand' },
  'soft-18-v-2': { h17: 'Double', s17: 'Stand' },
  'soft-19-v-6': { h17: 'Double', s17: 'Stand' },
  'pair-8-v-A': { h17: 'Surrender', s17: 'Split' },
  'hard-12-v-6': { h17: 'Stand', s17: 'Hit' },
  'hard-10-v-A': { h17: 'Double', s17: 'Hit' },
};

async function openRulesDiff(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Rules differences', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Rules differences');
}

test('rules differences: H17 ↔ S17 asks only changed cells, one question each way', async ({ page }) => {
  await openRulesDiff(page);
  await expect(page.locator('.rules-diff-summary li')).toHaveCount(8);
  await shot(page, 'rules-diff-setup');
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  let q = page.locator('.rules-diff-question');
  await expect(q).toHaveAttribute('data-side', 'a');
  await expect(page.locator('.rules-diff-inforce')).toContainText('Under H17');
  let cellId = (await q.getAttribute('data-cell'))!;
  expect(Object.keys(H17_S17_6D)).toContain(cellId);
  await page.locator('.rules-diff-answers').getByRole('button', { name: H17_S17_6D[cellId].h17, exact: true }).click();
  await expect(page.getByTestId('result-strip')).toHaveAttribute('data-tone', 'ok');
  await shot(page, 'rules-diff-right');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  q = page.locator('.rules-diff-question');
  await expect(q).toHaveAttribute('data-side', 'b');
  await expect(page.locator('.rules-diff-inforce')).toContainText('Under S17');
  cellId = (await q.getAttribute('data-cell'))!;
  expect(Object.keys(H17_S17_6D)).toContain(cellId);
  await page.locator('.rules-diff-answers').getByRole('button', { name: H17_S17_6D[cellId].h17, exact: true }).click();
  const strip = page.getByTestId('result-strip');
  await expect(strip).toHaveAttribute('data-tone', 'miss');
  await expect(strip.locator('.rules-verdict')).toHaveText(`Wrong — ${H17_S17_6D[cellId].s17}`);
  await expect(strip.locator('.rules-explain')).toContainText('H17');
  await shot(page, 'rules-diff-wrong');
});

test('rules differences: Other game lists that comparison, and an identical game offers no Start', async ({ page }) => {
  await openRulesDiff(page);
  await page.getByRole('button', { name: 'Other game', exact: true }).click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: 'H17', exact: true }).click();
  const expected = diffSummary(planRulesDrill(...comparisonRules(DEFAULT_RULES, 'custom', { decks: 2, s17: false })));
  await expect(page.locator('.rules-diff-summary li')).toHaveText(expected);
  await page.getByRole('button', { name: '6', exact: true }).click(); // now identical to the 6D H17 profile
  await expect(page.locator('.rules-diff-notice')).toHaveText('These two games play the same. Pick another comparison.');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
});

test('rules differences: works by touch with eyes-free on; 44px answers, no sideways scroll', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True count drill', exact: true }).click();
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.locator('.drill-back-btn').click();
  await page.getByRole('button', { name: 'Rules differences', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const boxes = await page.locator('.rules-diff-answers button').evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })));
  expect(boxes.length).toBeGreaterThan(1);
  for (const b of boxes) { expect(b.w).toBeGreaterThanOrEqual(44); expect(b.h).toBeGreaterThanOrEqual(44); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.locator('.rules-diff-answers button').first().click();
  await expect(page.getByTestId('result-strip')).toBeVisible();
});
```

(`comparisonRules(DEFAULT_RULES, …)` matches the e2e default profile because `strategyRulesFor` of a 6D DAS LS profile with no Fab 4 equals `DEFAULT_RULES` plus `surrenderIndices: false`. That flag produces the same index set as an absent one.)

- [ ] **Step 2: Run it and confirm it fails**

Run: `E2E_PORT=4730 npx playwright test e2e/rules-diff.spec.ts --project=chromium --reporter=line`
Expected: FAIL, no button named `Rules differences`.

- [ ] **Step 3: Implement `RulesDiffView.tsx` + `rulesDiff.css`, then add the Drills.tsx lines** as specified above.

- [ ] **Step 4: Run it and confirm it passes**

Run: `E2E_PORT=4730 npx playwright test e2e/rules-diff.spec.ts e2e/drills.spec.ts --project=chromium --reporter=line`
Expected: PASS (in `drills.spec.ts` the soft-gate test still counts 2 nudges).

- [ ] **Step 5: Look at the screenshots** `rules-diff-setup.png`, `rules-diff-right.png`, `rules-diff-wrong.png`. Check: "Under H17/S17" is the most prominent line; the cards and answers fit at 375 without scrolling the answers off screen; the strip text wraps cleanly; the Segmented row does not overflow.

- [ ] **Step 6: Mutation-check** (back up `RulesDiffView.tsx`; restore with `cp`):
  1. Grade every question under `plan.a` → the second (S17) question passes as ok, and the miss assertion fails.
  2. Render `.rules-diff-inforce` from `plan.names[0]` always → the `Under S17` assertion fails.
  3. Always show Start → the identical-game assertion fails.

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/drills/RulesDiffView.tsx src/ui/screens/drills/rulesDiff.css src/ui/screens/Drills.tsx e2e/rules-diff.spec.ts
git commit -m "feat(drills): Rules differences screen, H17/S17 and other-game comparisons (B10)"
```

---

### Task 6: Same chart, different shoe (6 ↔ 8 decks tray questions)

**Files:**
- Modify: `src/ui/screens/drills/RulesDiffView.tsx`, `src/ui/screens/drills/rulesDiff.css`, `e2e/rules-diff.spec.ts`

**Interfaces:**
- Consumes: Task 4's tray questions (`tray-decks`, `tray-tc`), `rulesAnswerOptions`/`rulesAnswerLabel` (depth grid), `gradeRulesAnswer(..., activeProfile.tcRounding)`; `DiscardTray`; `NumPad` (`{ label, onSubmit }`).
- Produces (DOM):
  - Tray questions render `<DiscardTray cardsDealt decks={q.totalDecks} />` plus `.deck-tray-context` (`8-deck shoe`) inside `.rules-diff-question`. The question carries `data-kind`, `data-side`, `data-cards-dealt`, and `data-rc` (tray-tc only).
  - `tray-decks` answers: `.rules-diff-depth`, one `<button>` per `depthOptions(totalDecks, 'half')`, labelled `5` / `5.5`.
  - `tray-tc` answers: `.bet-rc`-style `RC +9` line and `<NumPad label="True count" onSubmit>`.
  - Setup shows Start for a plan with `trayDecks !== null` even when the pool is empty.

- [ ] **Step 1: Add the failing e2e** to `e2e/rules-diff.spec.ts` (also add `import { trueCount } from '../src/engine/count';`):

```ts
test('rules differences: 6 ↔ 8 decks says the chart is the same and trains the 8-deck tray', async ({ page }) => {
  await openRulesDiff(page);
  await page.getByRole('button', { name: '6 ↔ 8 decks', exact: true }).click();
  await expect(page.locator('.rules-diff-notice')).toHaveText(
    '6 decks and 8 decks use the same basic chart and the same index plays. What changes is the shoe: you divide by more decks. Practise reading the 8-deck tray.');
  await expect(page.locator('.rules-diff-summary li')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  const q = page.locator('.rules-diff-question');
  await expect(q).toHaveAttribute('data-kind', 'tray-decks');
  await expect(page.locator('.rules-diff-question .deck-tray-context')).toHaveText('8-deck shoe');
  await expect(page.locator('.rules-diff-question .discard-tray--ticked')).toBeVisible();
  const dealt = Number(await q.getAttribute('data-cards-dealt'));
  const left = Math.max(0.5, Math.round(((416 - dealt) / 52) * 2) / 2);
  await page.locator('.rules-diff-depth').getByRole('button', { name: String(left), exact: true }).click();
  await expect(page.getByTestId('result-strip')).toHaveAttribute('data-tone', 'ok');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await expect(q).toHaveAttribute('data-kind', 'tray-tc');
  const rc = Number(await q.getAttribute('data-rc'));
  const tc = trueCount(rc, (416 - Number(await q.getAttribute('data-cards-dealt'))) / 52);
  await page.keyboard.type(String(tc));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('result-strip')).toHaveAttribute('data-tone', 'ok');
  await shot(page, 'rules-diff-tray');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `E2E_PORT=4730 npx playwright test e2e/rules-diff.spec.ts -g "6 ↔ 8" --project=chromium --reporter=line`
Expected: FAIL, no `Start` button (Task 5 hides it for an empty pool).

- [ ] **Step 3: Implement** tray rendering and answers in `RulesDiffView.tsx`. Show Start when `trayDecks !== null`. Add the CSS for `.rules-diff-depth`: a 4-column grid, `min-height: 48px`.

- [ ] **Step 4: Run the whole spec and confirm it passes**

Run: `E2E_PORT=4730 npx playwright test e2e/rules-diff.spec.ts --project=chromium --reporter=line`
Expected: PASS (4 tests).

- [ ] **Step 5: Look at** `e2e/screenshots/rules-diff-tray.png`. The 8-deck tray ticks must be legible, and the NumPad must sit fully on screen at 812 tall.

- [ ] **Step 6: Mutation-check:**
  1. Render the tray with `decks={activeProfile.rules.decks}` → `8-deck shoe`/tick assertion fails.
  2. Grade tray-tc ignoring `rounding` with a hard `Math.round` → re-run the spec 3 times; it fails whenever the quotient has a fraction ≥ .5. If 3 runs all pass, that mutation is not caught by e2e (the unit test in Task 4 covers the grading); note it in the task report.

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/drills/RulesDiffView.tsx src/ui/screens/drills/rulesDiff.css e2e/rules-diff.spec.ts
git commit -m "feat(drills): Rules differences trains the 8-deck tray when 6 and 8 decks share a chart (B10)"
```

---

### Task 7: Gate run

**Files:** none changed (fix-ups only if a gate fails, in the owning task's files).

- [ ] **Step 1: Types.** Run `npx tsc -b`. Expected: no output, exit 0.
- [ ] **Step 2: Unit tests.** Run `npx vitest run`. Expected: all files pass. `betSitLeave.test.ts` no longer exists; the new files are `betSizing`, `rulesDiff` and `rulesDiffDrill`.
- [ ] **Step 3: Lint.** Run `npm run lint`. Expected: `Found 13 warnings and 0 errors` (exactly 13; any new warning means a non-component export crept into a `.tsx`, so move it to the `.ts` module).
- [ ] **Step 4: Build and check what ships.** Run `npm run build`, then:
  ```bash
  grep -l "Rules differences" dist/assets/*.js
  grep -l "Bet sizing" dist/assets/*.js
  grep -l "Practise reading the" dist/assets/*.js
  grep -c "Read the running count and the tray" dist/assets/*.js
  ```
  Expected: each `grep -l` prints one asset file. The `grep -c` is ≥ 1 in exactly one file.
- [ ] **Step 5: Targeted e2e** (nothing editing the tree while it runs):
  ```bash
  E2E_PORT=4730 npx playwright test e2e/bet-sizing.spec.ts e2e/rules-diff.spec.ts e2e/drills.spec.ts e2e/smoke.spec.ts e2e/offline.spec.ts e2e/gutters.spec.ts e2e/drill-shoe-size.spec.ts e2e/settings-stats.spec.ts e2e/stats-wave-a.spec.ts e2e/eyes-free-gate.spec.ts e2e/drill-layout.spec.ts --project=chromium --reporter=line
  ```
  Expected: all pass. `settings-stats` and `stats-wave-a` prove the old Bet or sit history is still readable in Stats. If a test flakes only under load, read its `error-context.md` and decide whether it was late or absent; do not raise timeouts.
- [ ] **Step 6: Report.** List the commits, the gate outputs (tsc clean, vitest counts, lint = 13, dist grep hits, e2e pass count), the screenshots read, and any mutation that e2e could not catch (Task 6 step 6.2).

---

## Spec ambiguities resolved

1. **"Graded by the same function Play uses" vs cover bets.** Play accepts a neighbouring rung when the profile has `coverBets` on (`betWithinStep`), and grades the wong decision alongside the bet. The drill reproduces both: a numeric answer is right only if Play would mark the bet correct *and* the wong correct. So the minimum rung is always wrong (D1: Sit), and with cover on a neighbouring rung counts. The parity test runs a real `Game` to pin this.
2. **Depth in Bet sizing.** Play grades against the shoe's snapped depth (`snapDecksRemaining`) with no eye slack. The drill draws trays on exact half decks, so the picture and the graded depth agree, and it grades exactly. There is no TC band, because Play has none.
3. **`betSpreadOn` off.** Play grades no bets then. The drill still grades by the profile's spread: practising the ramp is the drill's purpose.
4. **Opt-in for Rules differences.** The spec lists it among the default-off opt-ins, but lane N may not touch `ProfileEditor.tsx`. The drill is a separate picker entry that changes nothing else (no ladder, grading or Home effect), and that is the opt-in. No new toggle.
5. **"Profile ↔ another ruleset."** "Another ruleset" is the profile's own rules with decks (1/2/6/8) and the soft-17 rule chosen on the setup screen (defaults: same decks, opposite S17). Every other field is carried from `strategyRulesFor(profile)`. Saved profiles are not offered (YAGNI; most users have one).
6. **Which index changes to ask.** Index differences are asked only at TCs where `correctPlay` actually differs. An index that differs on paper but never changes a play at that table (16 v 9 at 6D/8D with late surrender: surrender comes first) is listed as inert, not asked. Chart cells that differ at every TC are asked as basic strategy (no TC shown). Cells whose difference an index cancels at some counts (11 v A: both double from +1) are asked with a TC where they differ.
7. **6 ↔ 8 tray.** It always uses the larger shoe (8). The questions alternate decks-left and true-count, graded with the existing deck-estimation tolerance (half a deck) and the Produce-TC eye band.
8. **The spec's H17/S17 list** is correct for 6D. It does not hold at 2D (no 11vA or 8,8vA cells; adds A,3 v 4) or 1D (adds A,7 v A, 7,7 v A, 9,9 v A). The drill uses the engine's per-deck diff, so it follows the profile's deck count.
9. **Rules differences records no stats.** The spec asks for none, and no consumer exists.
10. **Answer buttons in Rules differences** are the union of both rulesets' drill-legal actions, so the button set never tells you which rules are in force. The existing drills hide Surrender on 8,8 v A under S17, and per-side buttons would hand over that answer. Surrender is still withheld when the ruleset in force has no late surrender.

## Cross-lane requests

1. **H (Stats.tsx):** the empty-state copy at ~line 1440 says "or try the Bet or sit drill", and that drill no longer exists after this lane. Change it to "or try the Bet sizing drill". Optional, not required by the spec: a Bet sizing row reading `stats.betSizing?.history`. The "Bet or sit" section itself stays (old history).
2. **D (deviations.ts, B9):** give soft deviations a `kind` containing `soft` plus `total` and `up`, so `cellIdForDeviation` maps them and Rules differences asks the H17-only BJA extras. With any other shape they are listed as inert, not asked, and nothing breaks.
3. **Controller (merge):** `'betsizing'` in the `DrillMode` union is added by both N and H (identical line). N edits only the Bet or sit lines of `e2e/drills.spec.ts`, `smoke.spec.ts`, `offline.spec.ts`, `gutters.spec.ts` and `drill-shoe-size.spec.ts`; resolve hunk by hunk if another lane touched those files.
