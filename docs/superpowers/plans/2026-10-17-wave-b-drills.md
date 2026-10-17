# Wave B Lane D (Drills) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship B9 (opt-in BJA H17 extra indices), B3 (Index test mode in the Deviation quiz), the hand-drill half of B6 (cost and history on miss strips) and B7 (first-run "How to read the chart", region rules on wrong strips, a Flashcards progress line, plain-language review copy) on branch `wave-b-drills`.

**Architecture:** B9 is engine data plus a `soft` deviation kind in `engine/deviations.ts`, read only through `indexSetFor(strategyRulesFor(profile))`, so the quiz, Index test, With count, Charts and Play follow automatically. B3 is a pure module (`drills/indexTest.ts`) and a new view (`IndexTestView.tsx`) that the quiz branch of `Drills.tsx` mounts when `settings.drill.quizAsk === 'index'`. B6/B7 strip changes are made at the snapshot sites in `Drills.tsx`/`MasteryChallengeView.tsx` (the region rule replaces `reason`; the miss line renders as a sibling directly under `HandResultStrip`), so `HandResultStrip.tsx` (lane P) is not edited. The first-run screen wraps the Flashcards branch, leaving `FlashcardsView` and its eyes-free/voice/wheel paths untouched.

**Tech Stack:** React 19, TypeScript ~6.0, Vite 8, Vitest 4, Playwright 1.61, oxlint.

**Spec:** `docs/superpowers/specs/2026-10-16-wave-b-design.md` (items B3, B6 miss-strip part, B7, B9). Lane contracts: `docs/superpowers/plans/2026-10-17-wave-b-contracts.md` (binding). Evidence: `docs/superpowers/specs/2026-10-16-swarm-backlog.md` (W1, W7, D6), `docs/superpowers/specs/2026-10-16-swarm-stories.json` (story 0 = s01 findings 4 and 7; story 8 = s09 "no learn/study step", "jargon").

## Global Constraints

- Branch `wave-b-drills` in its own git worktree; E2E port **4720** (`E2E_PORT=4720`).
- iPhone 13 mini: 375×812, notch insets, every tap target ≥ 44px, no sideways scroll, nothing under the status bar or the mute control (H's `--mute-seat`; do not rename `.drill-topbar`, `.charts-topbar`).
- Low friction: no new required inputs; everything new is default-off (`bjaExtras`) or derived.
- Strategy truth comes only from `src/engine/*` (`getChart`, `indexSetFor(strategyRulesFor(profile))`, `correctPlay`). No hard-coded strategy in UI code. Region rules are derived from `getChart`.
- Signed counts and indices use a real minus (U+2212) via `src/drills/signed.ts`.
- Eyes-free, voice and wheel paths of every existing drill keep working. Index test's prompt is spoken; its answer goes through `parseCountSpeech` (`src/audio/voiceNumber.ts`) and `useWheelNumber`.
- New CSS in new files only, never `app.css`. `store/types.ts`, `store/persist.ts`, `e2e/helpers.ts`: additive optional fields only (append, comment, never rename).
- File ownership (contracts): edit only D files plus the listed exceptions. In `ProfileEditor.tsx` the ONLY edit is one toggle row next to the Fab 4 toggle. Do not edit `components/HandResultStrip.tsx`, `components/MistakeCard.tsx`, `screens/Table.tsx`, `useGame.ts`, `engine/game.ts`, `Home.tsx`, `nextStep.ts`, `readiness.ts`, `Stats.tsx`, `Settings.tsx` (importing from them is fine).
- No caller outside the engine reads `bjaExtras` directly (contract 2). The single exception is the profile editor row that sets it.
- TDD. Every new test must fail without its change: back up the file with `cp` to the scratchpad, break it, watch the test fail, restore with `cp` (never `git checkout --`).
- Commit explicit paths only (never `git add -A`/`.`/`src`); never commit `docs/sources/chart-view-*.png`.
- No audible audio and no headed browsers: Playwright headless; visual checks by a 375×812 screenshot the implementer reads.
- Gates: `npx tsc -b`, `npx vitest run`, `npm run lint` (exactly **13** warnings; exporting a non-component from a `.tsx` adds one, so new helpers go in `.ts` files), `npm run build` plus a `dist/` grep, targeted `E2E_PORT=4720 npx playwright test <specs> --project=chromium --reporter=line`.
- Run Playwright from a clean checkout of the committed task, never while editing (vite HMR feeds half-written files to a running suite).

## Decisions this plan makes (spec silent or ambiguous)

1. **BJA values: the PDF and the spec agree on all 8** (read from `docs/sources/BJA_H17.pdf` on 2026-10-17; see the table in Task 1). Nothing in the spec is overridden. If the Task 1 re-read ever disagrees with this table, the PDF wins and the plan's numbers are corrected before any code is written.
2. **"0−" (A,8 v 6)** is stored the way the engine already stores 12 v 4 ("any negative" true count): `stand`, `dir: 'lte'`, `threshold: -1` (integer TC). Its published index is 0.
3. **Two extras are surrender-masked (16 v A, 15 v A).** The PDF's surrender table surrenders both cells, so their stand indices only matter when surrender is unavailable (no `ls`, or a 3+ card hand). This needs no gating: `resolveAsTotal` already settles surrender before step 3. The quiz asks them with surrender off (`QUIZ_CTX`), `tableMaskNote` explains it, and Charts' existing "surrender comes first" note covers them.
4. **No deck-count gate.** The extras apply to every deck count under H17, matching how the I18 is already applied (comment on `indexSetFor`). Where a 1D/2D chart already plays the extra (1D 8 v 6, 1D A,6 v 2), `redundantForChart` and `withCountAdvice` drop it, exactly as they drop 9 v 2 on 2D today.
5. **"The index number" (B3) is the published I18 convention**: for a `gte` entry the stored threshold; for an `lte` entry the stored threshold + 1 (the count at which the basic play resumes). So 13 v 2 is −1, 12 v 4 is 0, H17 12 v 6 is −3, A,8 v 6 is 0. `publishedIndex(dev)` is the only place this is computed.
6. **Index test asks "Index to <play>?"**, where `<play>` is the engine's play AT the index (`correctPlay(..., index, ...)`). This disambiguates cells with two indices (16 v 9 stand +4 / surrender 0; 15 v 10 stand +4 / surrender 0) without giving the number away.
7. **Index test ignores the quiz's pinned Index filter** (one pinned index would repeat one question forever) and hides the select. It has no shot clock. Inactive indices (H17 11 v A) are never asked. Its answers update the quiz SR deck (same keys) and Stats exactly like quiz events (`source: 'quiz'`, `classification: 'missed-deviation'` on a wrong number), but carry no `elapsedMs` (latency medians stay play-decision latency).
8. **First-run screen is suppressed under `?e2e=1` unless the URL also has `intro=1`.** 178 existing e2e loads open Flashcards on a fresh profile and would otherwise hit it. It is also never shown while eyes-free or voice is on (a driver must not meet a tap-only screen). "From the Next step rung 1" needs no lane-H change: rung 1's Start mounts the same Flashcards branch.
9. **Progress line = the rung-1 goal** (the Basic strategy categories Flashcards trains), for the hand types the drill is dealing, read from the shared `ui/screens/handProgress.ts`.
10. **Plain-language copy is scoped to D surfaces:** the spaced-repetition line in hand drills ("Next review: now" → "You'll see this again soon", and its siblings). Home/Stats jargon ("0/17 indices seen", "6D H17", CVCX) belongs to lane H. The rules chip ("Surrender OK" / "No surrender") keeps its words: they are already plain, the per-card change matches the greyed Surrender button (#11), and the region rule now says "surrender (hit if you can't)" on the strip.
11. **Region rules replace the reason only on basic-strategy misses from Flashcards, Mixed's flashcard items and Mastery** (`event.source` `'flashcard' | 'mastery'`, no `deviationId`). Quiz misses keep the index label. The spoken correction (`narrateCorrection`) is unchanged.
12. **The miss line (B6) renders on every `HandResultStrip` consumer** (Flashcards, Quiz, Mixed, Mastery) when the miss was tallied against a chart cell. Index misses (not tallied, F4) and insurance get no line.

## Review Focus

1. **375×812 fold:** the new Ask row, progress line and miss line must not push the action bar or NumPad below 812px. Tests: bounding-box assertions in Tasks 4, 6 and 8.
2. **A number heard during Index test feedback** must not be graded against the next item. Test: Task 4 voice spec says a number while feedback shows and asserts no second grade.
3. **First-run screen in a car session:** eyes-free or voice already on must skip it. Test: Task 7 e2e.
4. **Profile change under a pinned extra:** a saved `quizIndex: 'A8v4'` on a profile with extras off or S17 must fall back to "All indices". Test: Task 2 unit test on `isIndexActive`, plus an e2e line.
5. **Wrong tap after a miss:** the miss line must disappear with the withdrawn answer. Test: Task 6 e2e.

---

### Task 1: Engine: BJA H17 extras and the soft deviation kind (B9 engine)

**Files:**
- Modify: `src/engine/deviations.ts:5-43` (`DeviationId`, `Deviation`), `:97-109` (`isIndexActive`), `:133-149` (`indexSetFor`); append `BJA_H17_EXTRAS` after `FAB_4_S17`.
- Modify: `src/engine/strategy.ts:69-82` (`findHardDeviation` → `findTotalDeviation`), `:162-173` (step 3), `:235` (call in `pairTotalIndex`), `:266-272` (ten-pair path in `play`).
- Modify: `src/engine/ruleset.ts:24-26` (`StrategyRules`).
- Modify: `src/store/types.ts` (Profile, directly after `surrenderIndices?: boolean;` at line 407; not at the end of the interface, where lane P appends `hotShoe`).
- Modify: `src/store/profiles.ts:346-363` (`strategyRulesFor`).
- Modify: `src/engine/grade.ts:208-240` (`isPhantomDeviation`: soft branch).
- Create: `src/engine/bjaExtras.test.ts`
- Test (append): `src/store/profiles.test.ts`, `src/engine/grade.test.ts`

**Interfaces:**
- Produces:
  - `DeviationId` gains `'16vA' | '15vA' | '8v6' | 'A8v4' | 'A8v5' | 'A8v6' | 'A6v2' | 'TTv4'`.
  - `Deviation.kind: 'insurance' | 'hard' | 'soft' | 'pair10' | 'surrender'`; `total` is the hard OR soft total; new optional `extra?: true` (set on every BJA extra).
  - `export const BJA_H17_EXTRAS: Deviation[]`.
  - `indexSetFor(rules: { decks: number; s17: boolean; surrenderIndices?: boolean; bjaExtras?: boolean }): Deviation[]`: appends `BJA_H17_EXTRAS` after the Fab 4 when `rules.bjaExtras && !rules.s17`.
  - `isIndexActive(id, rules: { s17: boolean; surrenderIndices?: boolean; bjaExtras?: boolean })`.
  - `StrategyRules.bjaExtras?: boolean`; `Profile.bjaExtras?: boolean` (absent = off).
  - `strategyRulesFor(profile)` returns `bjaExtras: profile.bjaExtras === true && !profile.rules.s17`.

**PDF reading (recorded 2026-10-17; the Step 1 re-read must match it):**

| Id | PDF cell (section, row, dealer) | PDF shows | PDF basic in that cell | Engine encoding | Published index |
|---|---|---|---|---|---|
| `16vA` | Hard 16 v A | `3+` | `H` (surrender table: `SUR`) | hard 16, `stand`, `gte` 3 | +3 |
| `15vA` | Hard 15 v A | `5+` | `H` (surrender table: `-1+`) | hard 15, `stand`, `gte` 5 | +5 |
| `8v6` | Hard 8 v 6 | `2+` | `H` | hard 8, `double`, `gte` 2 | +2 |
| `A8v4` | Soft A,8 v 4 | `3+` | `S` | soft 19, `double`, `gte` 3 | +3 |
| `A8v5` | Soft A,8 v 5 | `1+` | `S` | soft 19, `double`, `gte` 1 | +1 |
| `A8v6` | Soft A,8 v 6 | `0-` (legend: "any negative running count") | `Ds` | soft 19, `stand`, `lte` −1 | 0 |
| `A6v2` | Soft A,6 v 2 | `1+` | `H` | soft 17, `double`, `gte` 1 | +1 |
| `TTv4` | Pairs T,T v 4 | `6+` | `N` (no split, stands as hard 20) | `pair10`, `split`, `gte` 6 | +6 |

What the engine cannot represent today, and how this task fixes it: the four soft extras (`A8v4`, `A8v5`, `A8v6`, `A6v2`) need the new `soft` kind (step 3 of `resolveAsTotal` only consults hard hands). `TTv4` needs the ten-pair path generalised (it looks up the ids `TTv5`/`TTv6` by name). `16vA`/`15vA`/`8v6` are plain hard entries.

Labels (exact): `'16 v A: stand at TC ≥ +3 (no surrender)'`, `'15 v A: stand at TC ≥ +5 (no surrender)'`, `'8 v 6: double at TC ≥ +2'`, `'A,8 v 4: double at TC ≥ +3'`, `'A,8 v 5: double at TC ≥ +1'`, `'A,8 v 6: stand at any negative TC'`, `'A,6 v 2: double at TC ≥ +1'`, `'10,10 v 4: split at TC ≥ +6'`.

- [ ] **Step 1: Re-verify every value against the PDF.** Read `docs/sources/BJA_H17.pdf` with the Read tool. For each row of the table above, confirm the cell's printed value and suffix, and the cell's printed basic play. Also confirm the legend lines for `+`, `-`, `0-`. Write the eight confirmations as a comment block above `BJA_H17_EXTRAS` in the form `// A,8 v 6 — BJA H17 chart, soft A,8 row, dealer 6: "0-" on a Ds cell`. Any mismatch: stop, report it, and correct this plan (the PDF wins).

- [ ] **Step 2: Write the failing engine tests** in `src/engine/bjaExtras.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { correctPlay, basicPlay } from './strategy';
import type { PlayContext } from './strategy';
import { indexSetFor, isIndexActive, BJA_H17_EXTRAS } from './deviations';
import { DEFAULT_RULES } from './ruleset';
import type { StrategyRules } from './ruleset';

const H17_ON: StrategyRules = { ...DEFAULT_RULES, bjaExtras: true };
const H17_OFF: StrategyRules = { ...DEFAULT_RULES };
const S17_ON: StrategyRules = { ...DEFAULT_RULES, s17: true, bjaExtras: true };
const ALL: PlayContext = { canDouble: true, canSplit: true, canSurrender: false };
const SUR: PlayContext = { ...ALL, canSurrender: true };
const c = (rank: Rank, suit: Card['suit'] = 's'): Card => ({ rank, suit });
const HANDS: Record<string, Card[]> = {
  '16vA': [c('10'), c('6')], '15vA': [c('9'), c('6')], '8v6': [c('5'), c('3')],
  A8v4: [c('A'), c('8')], A8v5: [c('A'), c('8')], A8v6: [c('A'), c('8')],
  A6v2: [c('A'), c('6')], TTv4: [c('10'), c('K')],
};
// [up, deviation-side tc, deviation play, other-side tc, basic play there]
const CASES: Record<string, [Rank, number, string, number, string]> = {
  '16vA': ['A', 3, 'stand', 2, 'hit'],
  '15vA': ['A', 5, 'stand', 4, 'hit'],
  '8v6': ['6', 2, 'double', 1, 'hit'],
  A8v4: ['4', 3, 'double', 2, 'stand'],
  A8v5: ['5', 1, 'double', 0, 'stand'],
  A8v6: ['6', -1, 'stand', 0, 'double'],
  A6v2: ['2', 1, 'double', 0, 'hit'],
  TTv4: ['4', 6, 'split', 5, 'stand'],
};

describe('BJA H17 extras: threshold and direction, one by one', () => {
  for (const [id, [up, devTc, devPlay, otherTc, basic]] of Object.entries(CASES)) {
    it(`${id}: ${devPlay} at TC ${devTc}, ${basic} at TC ${otherTc}, only with the option on`, () => {
      const hand = HANDS[id]!;
      const at = correctPlay(hand, up, devTc, ALL, H17_ON);
      expect(at.action).toBe(devPlay);
      expect(at.deviationId).toBe(id);
      expect(correctPlay(hand, up, otherTc, ALL, H17_ON).action).toBe(basic);
      // Off: the deviation side plays basic.
      expect(correctPlay(hand, up, devTc, ALL, H17_OFF).action).toBe(basic);
      // S17: the extras do not exist.
      expect(correctPlay(hand, up, devTc, ALL, S17_ON).deviationId).toBeUndefined();
      // Two counts further past the index still deviates (direction, not a point).
      const further = devTc + (devTc > otherTc ? 2 : -2);
      expect(correctPlay(hand, up, further, ALL, H17_ON).action).toBe(devPlay);
    });
  }
});

describe('BJA H17 extras: the cells are what the PDF prints', () => {
  it('basic play on each cell matches the chart the index changes', () => {
    const printed: Record<string, string> = {
      '16vA': 'hit', '15vA': 'hit', '8v6': 'hit', A8v4: 'stand', A8v5: 'stand',
      A8v6: 'double', A6v2: 'hit', TTv4: 'stand',
    };
    for (const [id, play] of Object.entries(printed)) {
      expect(basicPlay(HANDS[id]!, CASES[id]![0], ALL, H17_ON).action, id).toBe(play);
    }
  });
});

describe('BJA H17 extras: gating', () => {
  it('appear only under H17 with the option on, after the Fab 4', () => {
    expect(indexSetFor(H17_OFF).some((d) => d.extra)).toBe(false);
    expect(indexSetFor(S17_ON).some((d) => d.extra)).toBe(false);
    const on = indexSetFor({ ...H17_ON, surrenderIndices: true });
    expect(on.filter((d) => d.extra).map((d) => d.id)).toEqual(BJA_H17_EXTRAS.map((d) => d.id));
    expect(on.findIndex((d) => d.extra)).toBeGreaterThan(on.findLastIndex((d) => d.kind === 'surrender'));
    expect(isIndexActive('A8v4', { s17: false, bjaExtras: true })).toBe(true);
    expect(isIndexActive('A8v4', { s17: true, bjaExtras: true })).toBe(false);
    expect(isIndexActive('A8v4', { s17: false })).toBe(false);
  });
  it('the default set is untouched', () => {
    expect(indexSetFor(DEFAULT_RULES)).toEqual(indexSetFor({ ...DEFAULT_RULES, bjaExtras: false }));
  });
});

describe('BJA H17 extras: surrender, double and split availability', () => {
  it('16 v A and 15 v A surrender first while surrender is offered', () => {
    expect(correctPlay(HANDS['16vA']!, 'A', 6, SUR, H17_ON).action).toBe('surrender');
    expect(correctPlay(HANDS['15vA']!, 'A', 6, SUR, H17_ON).action).toBe('surrender');
  });
  it('a double index falls back to the chart when doubling is not allowed', () => {
    const noDouble = { ...ALL, canDouble: false };
    expect(correctPlay(HANDS['8v6']!, '6', 5, noDouble, H17_ON).action).toBe('hit');
    expect(correctPlay([c('A'), c('2'), c('6')], '5', 3, noDouble, H17_ON).action).toBe('stand');
    expect(correctPlay(HANDS.A6v2!, '2', 3, noDouble, H17_ON).action).toBe('hit');
  });
  it('A,8 v 6 stands below zero even when doubling is allowed, and soft 19 of three cards counts', () => {
    expect(correctPlay([c('A'), c('4'), c('4')], '6', -2, ALL, H17_ON).action).toBe('stand');
  });
  it('10,10 v 4 stands when splitting is unavailable', () => {
    expect(correctPlay(HANDS.TTv4!, '4', 8, { ...ALL, canSplit: false }, H17_ON).action).toBe('stand');
  });
  it('TTv5 and TTv6 are unchanged by the generalised ten-pair lookup', () => {
    expect(correctPlay(HANDS.TTv4!, '5', 5, ALL, H17_OFF).deviationId).toBe('TTv5');
    expect(correctPlay(HANDS.TTv4!, '6', 4, ALL, H17_OFF).deviationId).toBe('TTv6');
    expect(correctPlay(HANDS.TTv4!, '4', 6, ALL, H17_OFF).action).toBe('stand');
  });
});
```

Append to `src/store/profiles.test.ts` (inside the top `describe`):

```ts
describe('strategyRulesFor: BJA H17 extras', () => {
  it('carries the flag under H17 only, and absent means off', () => {
    const p = makeDefaultProfile();
    expect(strategyRulesFor(p).bjaExtras).toBe(false);
    expect(strategyRulesFor({ ...p, bjaExtras: true }).bjaExtras).toBe(true);
    expect(strategyRulesFor({ ...p, bjaExtras: true, rules: { ...p.rules, s17: true } }).bjaExtras).toBe(false);
  });
  it('Play grading follows it through correctPlay', () => {
    const p = { ...makeDefaultProfile(), bjaExtras: true };
    const soft19: Card[] = [{ rank: 'A', suit: 's' }, { rank: '8', suit: 'h' }];
    const ctx = { canDouble: true, canSplit: true, canSurrender: true };
    expect(correctPlay(soft19, '4', 3, ctx, strategyRulesFor(p)).action).toBe('double');
    expect(correctPlay(soft19, '4', 3, ctx, strategyRulesFor({ ...p, bjaExtras: false })).action).toBe('stand');
  });
});
```

Append to `src/engine/grade.test.ts`:

```ts
describe('phantom deviation on a soft extra', () => {
  it('doubling A,8 v 4 below +3 with the extras on is a phantom deviation', () => {
    const rules = { ...DEFAULT_RULES, bjaExtras: true };
    const cards: Card[] = [{ rank: 'A', suit: 's' }, { rank: '8', suit: 'h' }];
    const ctx = { canDouble: true, canSplit: true, canSurrender: false };
    const verdict = classifyAction('double', correctPlay(cards, '4', 1, ctx, rules), basicPlay(cards, '4', ctx, rules), cards, '4', 1, rules);
    expect(verdict.classification).toBe('phantom-deviation');
    // Off, the same play is a plain basic error.
    expect(
      classifyAction('double', correctPlay(cards, '4', 1, ctx, DEFAULT_RULES), basicPlay(cards, '4', ctx, DEFAULT_RULES), cards, '4', 1, DEFAULT_RULES).classification,
    ).toBe('basic-error');
  });
});
```

(Add whatever imports these files lack: `correctPlay`, `basicPlay`, `Card`, `makeDefaultProfile`, `strategyRulesFor`.)

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run src/engine/bjaExtras.test.ts src/store/profiles.test.ts src/engine/grade.test.ts`
Expected: FAIL (`BJA_H17_EXTRAS` not exported; type errors on `bjaExtras`).

- [ ] **Step 4: Implement.**
  - `deviations.ts`: the type changes, `BJA_H17_EXTRAS` (values and labels from the table, `active: true`, `extra: true`), the `indexSetFor` append and the `isIndexActive` param type. Extend the doc comment on `indexSetFor` with one paragraph: extras are opt-in, H17 only, shoe values at every deck count like the I18.
  - `strategy.ts`: rename `findHardDeviation(deviations, total, up, tc)` to `findTotalDeviation(deviations, kind: 'hard' | 'soft', total, up, tc)`, with the kind check `d.kind !== kind`. Step 3 becomes `findTotalDeviation(deviations, soft ? 'soft' : 'hard', total, dealerUp, tc)` with the existing double/canDouble fall-through, applied to soft hands too. `pairTotalIndex` passes `'hard'`. In `play`'s ten-pair path, replace the two id lookups with one `deviations.find((d) => d.active && d.kind === 'pair10' && d.up !== undefined && upIndex(d.up) === idx && (d.dir === 'gte' ? tc >= d.threshold : tc <= d.threshold))`.
  - `ruleset.ts`: `bjaExtras?: boolean` on `StrategyRules`, with a two-line comment (training preference, like `surrenderIndices`).
  - `types.ts`: `bjaExtras?: boolean` with a comment: opt-in BJA H17 extras, absent = off, read only through `strategyRulesFor`.
  - `profiles.ts`: the `bjaExtras` line in `strategyRulesFor`, with a comment (H17-only, the stored flag is never rewritten).
  - `grade.ts`: in `isPhantomDeviation`, a `dev.kind === 'soft'` branch mirroring the hard one but requiring `hv.soft`.

- [ ] **Step 5: Run them and see them pass, then the whole engine and store suites**

Run: `npx vitest run src/engine src/store src/drills`
Expected: PASS (existing suites untouched; default rules produce identical sets).

- [ ] **Step 6: Mutation-check.** For each, back up with `cp`, break, run `npx vitest run src/engine/bjaExtras.test.ts`, see a failure, restore with `cp`:
  (a) set `A8v6` to `dir: 'gte'`; (b) drop `&& !rules.s17` from `indexSetFor`; (c) restore the hard-only step-3 check (`if (!soft)`); (d) revert the ten-pair lookup to the `TTv5`/`TTv6` id lookups; (e) change `15vA` threshold to 4. Then (f) remove the soft branch in `isPhantomDeviation` and see the grade test fail; (g) drop `&& !profile.rules.s17` in `strategyRulesFor` and see the profiles test fail.

- [ ] **Step 7: Commit**

```bash
git add src/engine/deviations.ts src/engine/strategy.ts src/engine/ruleset.ts src/engine/grade.ts src/store/types.ts src/store/profiles.ts src/engine/bjaExtras.test.ts src/store/profiles.test.ts src/engine/grade.test.ts
git commit -m "feat(engine): opt-in BJA H17 extra indices with a soft deviation kind (B9)"
```

---

### Task 2: B9 surfaces: quiz, decks, Charts, Speed, profile toggle

**Files:**
- Modify: `src/drills/deviationQuiz.ts` (`ctxFor` at :69 exported as `entryCtx`; `redundantForChart` :83-96; new `makeSoftHand`; new `buildCloseSoftCandidate` beside `buildClosePair10Candidate` :322; `fallbackCandidate` :378-405; `buildDistractorItem` :465-470; `drawQuizItem` real-item branch :596-628).
- Modify: `src/drills/deckSource.ts:31-41` (`IndexRules` gains `bjaExtras?: boolean`; `cellIdForDeviation` handles `soft`).
- Modify: `src/ui/screens/indexChart.ts` (`IndexEntry.group` adds `'extra'`; new `softTotal: number | null`; `toEntry` :70-99; `indexesAtCell` :147-157 handles `SOFT`).
- Modify: `src/ui/screens/Charts.tsx:92-95` (`INDEX_GROUPS` adds `{ id: 'extra', title: 'BJA H17 extras' }`).
- Modify: `src/ui/screens/drills/SpeedDrillView.tsx:108` (`sessionKey` adds `rules.bjaExtras`).
- Modify: `src/ui/screens/ProfileEditor.tsx` (ONE toggle row directly after the Fab 4 toggle and its `<p className="stats-detail">`, ~line 520).
- Test (append): `src/drills/quizIndexSet.test.ts`, `src/drills/deckSource.test.ts`, `src/ui/screens/indexChart.test.ts`, `src/drills/withCount.test.ts`
- Create: `e2e/bja-extras.spec.ts`

**Interfaces:**
- Consumes: Task 1's `BJA_H17_EXTRAS`, `Deviation.kind 'soft'`, `Deviation.extra`, `StrategyRules.bjaExtras`, `Profile.bjaExtras`.
- Produces:
  - `export function entryCtx(entry: Deviation): PlayContext` (the renamed `ctxFor`; all internal callers updated).
  - `export function makeSoftHand(total: number): [Card, Card]`: `[A, total − 11]` with suits `'s'`/`'h'`; throws outside 13..20.
  - `IndexEntry.group: 'illustrious' | 'fab4' | 'extra'`; `IndexEntry.softTotal: number | null`; soft `hand` text is `A,${total − 11}`.

- [ ] **Step 1: Write the failing unit tests.**

`src/drills/quizIndexSet.test.ts` (append):

```ts
const H17_EXTRAS: StrategyRules = { ...DEFAULT_RULES, bjaExtras: true };

describe('BJA extras in the quiz', () => {
  it('a soft extra is asked on the soft hand, never a hard total', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const item = drawQuizItem(seed, 'A8v4', H17_EXTRAS);
      expect(item.cards!.some((c) => c.rank === 'A')).toBe(true);
      const v = handValue(item.cards!);
      expect(v).toEqual({ total: 19, soft: true });
      expect(item.up).toBe('4');
    }
  });
  it('10,10 v 4 is asked on a ten pair', () => {
    const item = drawQuizItem(3, 'TTv4', H17_EXTRAS);
    expect(item.cards!.map((c) => rankValue(c.rank))).toEqual([10, 10]);
  });
  it('the extras are in the quiz set only when on, and 1D drops the ones its chart already plays', () => {
    expect(quizIndexSet(DEFAULT_RULES).some((d) => d.extra)).toBe(false);
    const ids6 = quizIndexSet(H17_EXTRAS).map((d) => d.id);
    for (const id of ['16vA', '15vA', '8v6', 'A8v4', 'A8v5', 'A8v6', 'A6v2', 'TTv4']) expect(ids6).toContain(id);
    const ids1 = quizIndexSet({ ...H17_EXTRAS, decks: 1 }).map((d) => d.id);
    expect(ids1).not.toContain('8v6');
    expect(ids1).not.toContain('A6v2');
  });
  it('a saved pin on an extra falls back when the profile no longer has it', () => {
    expect(isIndexActive('A8v6', { s17: false, bjaExtras: false })).toBe(false);
    expect(isIndexActive('A8v6', { s17: true, bjaExtras: true })).toBe(false);
  });
});
```

Also extend the existing test `'no drawn item contradicts its label, on any deck count or soft-17 rule'` so its rules loop includes `bjaExtras: true` and `surrenderIndices: true` (the extra combinations must also pass every existing invariant, distractors included).

`src/drills/deckSource.test.ts` (append): `cellIdForDeviation` of `A8v4` is `'soft-19-v-4'`, of `TTv4` `'pair-10-v-4'`, of `8v6` `'hard-8-v-6'`; `indexCellIds({ decks: 6, s17: false, bjaExtras: true })` contains `'soft-19-v-6'` and `indexCellIds({ decks: 6, s17: false })` does not.

`src/ui/screens/indexChart.test.ts` (append):

```ts
describe('BJA extras on the Charts screen', () => {
  const ON: StrategyRules = { ...DEFAULT_RULES, bjaExtras: true };
  it('lists them as their own group with soft hands written A,x', () => {
    const byId = new Map(indexList(ON).entries.map((e) => [e.id, e]));
    expect(byId.get('A8v6')?.group).toBe('extra');
    expect(byId.get('A8v6')?.text).toBe('A,8 v 6 · TC ≤ −1 · Stand');
    expect(byId.get('TTv4')?.text).toBe('10,10 v 4 · TC ≥ +6 · Split');
    expect(byId.get('16v10')?.group).toBe('illustrious');
    expect(indexList(DEFAULT_RULES).entries.some((e) => e.group === 'extra')).toBe(false);
  });
  it('marks the soft cells they sit on, and only those', () => {
    const rows = buildSectionRows(getChart(ON), 'SOFT', 'descending');
    const a8 = rows.find((r) => r.keys.includes(19))!;
    const entries = indexList(ON).entries;
    expect(indexesAtCell(entries, 'SOFT', a8, '4').map((e) => e.id)).toEqual(['A8v4']);
    expect(indexesAtCell(entries, 'SOFT', a8, '7')).toEqual([]);
    expect(indexesAtCell(indexList(DEFAULT_RULES).entries, 'SOFT', a8, '4')).toEqual([]);
  });
});
```

Also extend the existing `'is the active index set, in its own order, for every rules combination'` loop with `{ ...H17, bjaExtras: true }`.

`src/drills/withCount.test.ts` (append): `reachableIndexes([A,8], '4', { canDouble: true, canSplit: true, canSurrender: false }, { ...DEFAULT_RULES, bjaExtras: true })` maps to ids `['A8v4']`, and with `DEFAULT_RULES` is `[]`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/drills/quizIndexSet.test.ts src/drills/deckSource.test.ts src/ui/screens/indexChart.test.ts src/drills/withCount.test.ts`
Expected: FAIL (a soft extra drawn as hard 19; `group` never `'extra'`; no SOFT markers; no soft cell id).

- [ ] **Step 3: Implement.**
  - `deviationQuiz.ts`: export `entryCtx`. Hand builder per kind: `pair10` → `makePair10Cards()`, `soft` → `makeSoftHand(total)`, otherwise `makeHardHand(total, rng)`. Use it in `redundantForChart`, `fallbackCandidate` and the real-item branch of `drawQuizItem`. `buildCloseSoftCandidate(entry, rng, rules)`: the same three perturbations as the hard builder (tc on the wrong side, adjacent up-card, adjacent soft total in 13..20 via `makeSoftHand`), every candidate verified with `isBasicOnly`. `buildDistractorItem` dispatches `soft` to it.
  - `deckSource.ts`: `if (dev.kind === 'soft' && dev.total !== undefined) return \`soft-${dev.total}-v-${dev.up}\``.
  - `indexChart.ts`: `group: dev.extra ? 'extra' : dev.kind === 'surrender' ? 'fab4' : 'illustrious'`. Soft entries get `hand: \`A,${total - 11}\``, `softTotal: total`, `hardTotal: null`. Every other entry gets `softTotal: null`. `indexesAtCell`: SOFT matches on `softTotal`, HARD on `hardTotal` as now, PAIRS never. Update the doc comments that say "Only HARD cells carry any".
  - `Charts.tsx`: the third `INDEX_GROUPS` entry. The empty-group skip already exists.
  - `SpeedDrillView.tsx`: append `|${rules.bjaExtras}` to `sessionKey`.
  - `ProfileEditor.tsx`, directly after the Fab 4 block:

```tsx
<Toggle
  label="BJA H17 extra indices"
  checked={draft.bjaExtras === true && !draft.rules.s17}
  disabled={draft.rules.s17}
  onChange={(v) => update({ bjaExtras: v })}
/>
<p className="stats-detail">
  {draft.rules.s17 ? (
    <>Only for games where the dealer hits soft 17, which is off in this profile&rsquo;s rules.</>
  ) : (
    <>
      Eight more count plays from the Blackjack Apprenticeship H17 chart: doubling A,8 v 4 and 5,
      A,6 v 2 and 8 v 6, splitting 10,10 v 4 at +6, standing A,8 v 6 below zero, and standing 15 and
      16 v A when surrender isn&rsquo;t on offer. Off by default.
    </>
  )}
</p>
```

- [ ] **Step 4: Run the unit tests and see them pass**

Run: `npx vitest run src/drills src/ui/screens`
Expected: PASS.

- [ ] **Step 5: Write the e2e** `e2e/bja-extras.spec.ts` (reuse `openProfileEditor`/`openDeviationQuiz` shapes from `e2e/surrender-indices.spec.ts`):
  - `'the toggle is off by default and disabled under S17'`: `withProfile(page)` → editor row `.settings-toggle-row` with text "BJA H17 extra indices" has an unchecked input; `withProfile(page, { rules: { s17: true }, bjaExtras: true })` → input disabled and not checked.
  - `'Charts lists the extras only when the option is on'`: `withProfile(page, { bjaExtras: true })`, Charts tab → `[data-testid="chart-indexes"] [data-group="extra"]` visible with `li[data-index-id="A8v6"]`; and `tr[data-row="SOFT:19"] td[data-up="4"][data-index="true"]` exists. Same with `bjaExtras: false` → `[data-group="extra"]` count 0 and that cell has no `data-index`.
  - `'the quiz offers the extras only when on'`: `.quiz-index-select option` texts include `A,8 v 4 (double)` with extras on and exclude it with extras off.
  - `'a saved pin on an extra falls back to All indices'`: `withProfile(page, { bjaExtras: false })` + `withSettings(page, { drill: { quizIndex: 'A8v4' } })` → `.quiz-index-select` has value `all`.

- [ ] **Step 6: Run the e2e**

Run: `E2E_PORT=4720 npx playwright test e2e/bja-extras.spec.ts e2e/surrender-indices.spec.ts --project=chromium --reporter=line`
Expected: PASS.

- [ ] **Step 7: Mutation-check:** (a) revert `drawQuizItem` to `makeHardHand` for soft entries → quiz test fails; (b) map `group` without `extra` → indexChart test and e2e fail; (c) drop the SOFT branch of `indexesAtCell` → marker test fails; (d) remove the `soft` line in `cellIdForDeviation` → deckSource test fails; (e) change the toggle's `checked` to `draft.bjaExtras === true` → the S17 e2e fails.

- [ ] **Step 8: Commit**

```bash
git add src/drills/deviationQuiz.ts src/drills/deckSource.ts src/ui/screens/indexChart.ts src/ui/screens/Charts.tsx src/ui/screens/drills/SpeedDrillView.tsx src/ui/screens/ProfileEditor.tsx src/drills/quizIndexSet.test.ts src/drills/deckSource.test.ts src/ui/screens/indexChart.test.ts src/drills/withCount.test.ts e2e/bja-extras.spec.ts
git commit -m "feat(drills): BJA H17 extras in the quiz, decks, Charts and the profile editor (B9)"
```

---

### Task 3: Index test core: items, published index, grading, persistence (B3 logic)

**Files:**
- Create: `src/drills/indexTest.ts`, `src/drills/indexTest.test.ts`
- Modify: `src/drills/gradeAnswer.ts` (add `gradeIndexTestAnswer` after `gradeQuizAnswer`, :512+)
- Modify: `src/drills/deviationQuiz.ts:42` (export `makePair10Cards`, today private)
- Test (append): `src/drills/gradeAnswer.test.ts`

**Interfaces:**
- Consumes: `quizIndexSet`, `entryCtx`, `makeSoftHand` (Task 2); `makeHardHand` (`drills/buildHand.ts`); `correctPlay`, `insuranceCorrect` (`engine/strategy.ts`); `srWeight`, `reviewCard` (`drills/spacedRepetition.ts`); `weightedIndex` (`drills/weightedDraw.ts`); `actionCategory` (`engine/grade.ts`); `signed` (`drills/signed.ts`); `narrateFlashcardPrompt`, `narrateDealerUp`, `narrateInsuranceOffer`, `narrateReason` (`audio/narrate.ts`); `speakableCount` (`audio/voiceNumber.ts`).
- Produces (all in `src/drills/indexTest.ts` unless noted):
  - `export interface IndexTestItem { deviationId: DeviationId; cards: [Card, Card] | null; up: Rank; index: number; playAt: Action | 'take-insurance'; playBelow: Action | 'decline-insurance'; label: string }`
  - `export function publishedIndex(dev: Deviation): number`: `gte` → `threshold`; `lte` → `threshold + 1`.
  - `export function indexTestSet(rules: StrategyRules): Deviation[]`: `quizIndexSet(rules).filter((d) => d.active)`.
  - `export function indexTestItemFor(dev: Deviation, rules: StrategyRules, rng: () => number): IndexTestItem`. `playAt` = the play at TC `index`; `playBelow` = the play at TC `index − 1`, both from `correctPlay(cards, up, tc, entryCtx(dev), rules).action`. Insurance uses `insuranceCorrect`.
  - `export function drawIndexTestItem(seed: number, rules: StrategyRules, srDeck: SrDeck = {}, now = 0): IndexTestItem`: an SR-weighted pick over `indexTestSet(rules)`, the same weighting as `drawQuizItem`'s no-filter branch.
  - `export function gradeIndexTest(item: IndexTestItem, answer: number): boolean`: `answer === item.index`.
  - `export function indexTestPrompt(item): string`: `'Insurance index?'` or `` `Index to ${PLAY[item.playAt]}?` `` (`PLAY`: hit, stand, double, split, surrender).
  - `export function indexTestPlayLine(item): string`: `` `${Cap(PLAY[playAt])} at TC ≥ ${signed(index)}; ${PLAY[playBelow]} below` ``, with `PLAY` also mapping `take-insurance` → `take insurance` and `decline-insurance` → `decline`. E.g. `'Stand at TC ≥ 0; hit below'`, `'Take insurance at TC ≥ +3; decline below'`. For an `lte` entry the play at the index is the basic play and the deviation is below it (13 v 2: `'Stand at TC ≥ −1; hit below'`), which is why the line is always phrased from the index upward.
  - `export function narrateIndexTestPrompt(item): string`: hand items `` `${narrateFlashcardPrompt(cards, up)} ${indexTestPrompt(item)}` ``; insurance `` `${narrateDealerUp('A')} ${narrateInsuranceOffer()} What is the insurance index?` ``.
  - `export function narrateIndexTestCorrection(item, correct: boolean): string`: `` `${correct ? 'Correct.' : 'Wrong.'} The index is ${speakableCount(item.index)}. ${narrateReason(indexTestPlayLine(item))}` ``.
  - `export function buildIndexTestEvent(item, answer: number): GradedEvent`: `kind` `'insurance'`/`'action'`; `source: 'quiz'`; `category` (`'insurance'` for insurance, `'surrender'` for a surrender entry, else `actionCategory(cards, playAt)`); `correct`; `classification` `'correct'` | `'missed-deviation'`; `taken: String(answer)`; `expected: String(item.index)`; `reason: item.label`; `deviationId`; `tc: item.index`; `hand` (`'dealer A'` or table notation `"9,7 v 10"`); no `elapsedMs`, no `evCost`.
  - In `gradeAnswer.ts`: `export function gradeIndexTestAnswer(item: IndexTestItem, answer: number, deck: SrDeck, now: number, channel: AnswerChannel = SCREEN_CHANNEL): { event: GradedEvent; nextDeck: SrDeck; correct: boolean }`. It stamps `at`, reviews `deck[item.deviationId]` with `reviewCard(prev, correct, now, { channel })`, writes the gap-review retention row the way `gradeQuizAnswer` does, then calls `saveQuizSr` and `persistGrade`. No `elapsedMs` reaches `reviewCard`: keying a signed number takes longer than tapping a play, so it would brake promotion (`FLUENT_MS`) and drag the shared card's `paceMs`, which the play quiz reads.

- [ ] **Step 1: Write the failing tests** in `src/drills/indexTest.test.ts`. The published values below come from the sources the engine cites (I18 H17/S17, Fab 4, BJA H17 PDF), not from the engine's own thresholds:

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../engine/cards';
import { correctPlay, insuranceCorrect } from '../engine/strategy';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { StrategyRules } from '../engine/ruleset';
import { entryCtx } from './deviationQuiz';
import {
  indexTestSet, indexTestItemFor, gradeIndexTest, publishedIndex, indexTestPlayLine,
  indexTestPrompt, drawIndexTestItem, buildIndexTestEvent,
} from './indexTest';

const H17_ALL: StrategyRules = { ...DEFAULT_RULES, surrenderIndices: true, bjaExtras: true };
const S17_ALL: StrategyRules = { ...DEFAULT_RULES, s17: true, surrenderIndices: true, bjaExtras: true };

const H17_PUBLISHED: Record<string, number> = {
  ins: 3, '16v10': 0, '15v10': 4, TTv5: 5, TTv6: 4, '10v10': 4, '12v3': 2, '12v2': 3,
  '9v2': 1, '10vA': 3, '9v7': 3, '16v9': 4, '13v2': -1, '12v4': 0, '12v5': -2, '12v6': -3, '13v3': -2,
  sur15v9: 2, sur15v10: 0, sur15vA: -1, sur16v8: 4, sur16v9: 0, sur14v10: 3,
  '16vA': 3, '15vA': 5, '8v6': 2, A8v4: 3, A8v5: 1, A8v6: 0, A6v2: 1, TTv4: 6,
};
const S17_PUBLISHED: Record<string, number> = {
  ins: 3, '16v10': 0, '15v10': 4, TTv5: 5, TTv6: 4, '10v10': 4, '12v3': 2, '12v2': 3,
  '11vA': 1, '9v2': 1, '10vA': 4, '9v7': 3, '16v9': 5, '13v2': -1, '12v4': 0, '12v5': -2, '12v6': -1, '13v3': -2,
  sur15v9: 2, sur15v10: 0, sur15vA: 1, sur14v10: 3,
};

for (const [name, rules, published] of [
  ['H17', H17_ALL, H17_PUBLISHED],
  ['S17', S17_ALL, S17_PUBLISHED],
] as const) {
  describe(`Index test grades every ${name} index`, () => {
    it('asks exactly the published set (inactive 11 v A under H17 is never asked)', () => {
      expect(indexTestSet(rules).map((d) => d.id).sort()).toEqual(Object.keys(published).sort());
    });
    for (const dev of indexTestSet(rules)) {
      it(`${dev.id}: index ${published[dev.id]} is right, one either side is wrong`, () => {
        const want = published[dev.id]!;
        const item = indexTestItemFor(dev, rules, mulberry32(7));
        expect(publishedIndex(dev)).toBe(want);
        expect(item.index).toBe(want);
        expect(gradeIndexTest(item, want)).toBe(true);
        expect(gradeIndexTest(item, want + 1)).toBe(false);
        expect(gradeIndexTest(item, want - 1)).toBe(false);
      });
      it(`${dev.id}: the index is the count where the engine's play changes`, () => {
        const item = indexTestItemFor(dev, rules, mulberry32(7));
        if (item.cards === null) {
          expect(insuranceCorrect(item.index, rules)).toBe(true);
          expect(insuranceCorrect(item.index - 1, rules)).toBe(false);
          return;
        }
        const ctx = entryCtx(dev);
        expect(correctPlay(item.cards, item.up, item.index, ctx, rules).action).toBe(item.playAt);
        expect(correctPlay(item.cards, item.up, item.index - 1, ctx, rules).action).toBe(item.playBelow);
        expect(item.playAt).not.toBe(item.playBelow);
      });
    }
  });
}

describe('Index test copy and events', () => {
  it('single deck takes insurance at +2', () => {
    const ins = indexTestSet({ ...DEFAULT_RULES, decks: 1 }).find((d) => d.id === 'ins')!;
    expect(indexTestItemFor(ins, { ...DEFAULT_RULES, decks: 1 }, mulberry32(1)).index).toBe(2);
  });
  it('names the play, never the number, and the play line uses a real minus', () => {
    const d13 = indexTestSet(H17_ALL).find((d) => d.id === '13v2')!;
    const item = indexTestItemFor(d13, H17_ALL, mulberry32(2));
    expect(indexTestPrompt(item)).toBe('Index to stand?');
    expect(indexTestPlayLine(item)).toBe('Stand at TC ≥ −1; hit below');
    const s16 = indexTestSet(H17_ALL).find((d) => d.id === 'sur16v9')!;
    expect(indexTestPrompt(indexTestItemFor(s16, H17_ALL, mulberry32(2)))).toBe('Index to surrender?');
  });
  it('an event is an index event: per-index tally, no cell, no latency, no price', () => {
    const d = indexTestSet(H17_ALL).find((x) => x.id === '16v10')!;
    const item = indexTestItemFor(d, H17_ALL, mulberry32(3));
    const wrong = buildIndexTestEvent(item, 2);
    expect(wrong).toMatchObject({ kind: 'action', source: 'quiz', correct: false, classification: 'missed-deviation', deviationId: '16v10', taken: '2', expected: '0' });
    expect(wrong.elapsedMs).toBeUndefined();
    expect(wrong.evCost).toBeUndefined();
    expect(buildIndexTestEvent(item, 0).correct).toBe(true);
  });
  it('draws are weighted by the review deck', () => {
    // Every index but 12 v 4 reviewed and not due (weight SR_NOT_DUE_FLOOR 0.25); 12 v 4 new (SR_NEW_WEIGHT 8).
    const later = { box: 5, dueAt: 1e12, lastSeenAt: 0, lapses: 0, reviews: 4 };
    const deck = Object.fromEntries(indexTestSet(H17_ALL).filter((d) => d.id !== '12v4').map((d) => [d.id, later]));
    const count = (srDeck: object) =>
      Array.from({ length: 200 }, (_, s) => drawIndexTestItem(s + 1, H17_ALL, srDeck as never, 10)).filter((i) => i.deviationId === '12v4').length;
    expect(count(deck)).toBeGreaterThan(count({}) * 3);
  });
});
```

Append to `src/drills/gradeAnswer.test.ts` (it already installs `freshStorage()`):

```ts
describe('gradeIndexTestAnswer', () => {
  it('reviews the index in the quiz deck and tallies perIndex, not a chart cell', () => {
    const rules = { ...DEFAULT_RULES };
    const dev = indexTestSet(rules).find((d) => d.id === '16v10')!;
    const item = indexTestItemFor(dev, rules, mulberry32(4));
    const r = gradeIndexTestAnswer(item, 0, {}, NOW);
    expect(r.correct).toBe(true);
    expect(r.nextDeck['16v10']?.reviews).toBe(1);
    expect(r.nextDeck['16v10']?.paceMs).toBeUndefined();
    expect(loadQuizSr()['16v10']?.reviews).toBe(1);
    const stats = loadStats();
    expect(stats.perIndex['16v10']).toEqual({ right: 1, wrong: 0 });
    expect(Object.keys(stats.cellStats ?? {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/drills/indexTest.test.ts src/drills/gradeAnswer.test.ts`
Expected: FAIL (module `./indexTest` not found).

- [ ] **Step 3: Implement `src/drills/indexTest.ts` and `gradeIndexTestAnswer`** with the signatures above. `indexTestItemFor` builds the hand the way `drawQuizItem` does per kind (`makeSoftHand`, `makePair10Cards` (export it from `deviationQuiz.ts`), `makeHardHand(total, rng)`; insurance `cards: null, up: 'A'`).

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/drills`
Expected: PASS.

- [ ] **Step 5: Mutation-check:** (a) `publishedIndex` returns `threshold` for `lte` → the 13v2/12v4/12v5/12v6/13v3/A8v6 cases fail; (b) `indexTestSet` without `.filter((d) => d.active)` → the H17 set test fails (11vA appears); (c) `playBelow` computed at `index + 1` → boundary tests fail; (d) `gradeIndexTestAnswer` saves the flash deck instead of the quiz deck → the gradeAnswer test fails; (e) drop the SR weights in `drawIndexTestItem` → the weighting test fails; (f) pass `{ elapsedMs: 900, channel }` to `reviewCard` → the `paceMs` assertion fails.

- [ ] **Step 6: Commit**

```bash
git add src/drills/indexTest.ts src/drills/indexTest.test.ts src/drills/gradeAnswer.ts src/drills/gradeAnswer.test.ts src/drills/deviationQuiz.ts
git commit -m "feat(drills): Index test items, published-index grading and SR persistence (B3)"
```

---

### Task 4: Index test screen: touch, voice, wheel; the quiz's Ask switch (B3 UI)

**Files:**
- Create: `src/ui/screens/drills/DrillModeControls.tsx` (move `DrillModeControls` out of `Drills.tsx:262-387` verbatim, exported; `Drills.tsx` imports it; no behaviour change)
- Create: `src/ui/screens/drills/QuizAskSwitch.tsx`
- Create: `src/ui/screens/drills/IndexTestView.tsx`, `src/ui/screens/drills/indexTest.css`
- Modify: `src/ui/screens/Drills.tsx` (quiz branch :3024-3033; `DeviationQuizView` inline controls :1999 gains `<QuizAskSwitch>` as the first row)
- Modify: `src/store/types.ts` (drill settings, directly after `quizDistractorPct: number;` at line 84: `quizAsk?: 'play' | 'index';` with a comment: absent = 'play')
- Create: `e2e/index-test.spec.ts`, `e2e/index-test-voice.spec.ts`

**Interfaces:**
- Consumes: Task 3's `drawIndexTestItem`, `gradeIndexTestAnswer`, `indexTestPrompt`, `indexTestPlayLine`, `narrateIndexTestPrompt`, `narrateIndexTestCorrection`; `NumPad` (`components/NumPad.tsx`); `ResultStrip` (`components/ResultStrip.tsx`); `handText` (`ui/handResult.ts`); `parseCountSpeech`, `speakableCount`, `COUNT_BIAS_PHRASES` (`audio/voiceNumber.ts`); `narrateReadback`, `NO_ANSWER_YET` (`audio/narrate.ts`); `useVoiceControl`, `useWheelNumber`, `useWheelCommand`, `useEyesFreeToggle`, `useVoiceToggle`, `usePushToTalk`, `startPushToTalk`; `formatReviewPlain` (`drills/srStatus.ts`); `Segmented` (`screens/Settings.tsx`).
- Produces:
  - `export function QuizAskSwitch({ settings, onSettingsChange }: { settings: Settings; onSettingsChange: (s: Settings) => void })`: a `settings-row` labelled "Ask" with a `Segmented` of `{ value: 'play', label: 'Best play' }`, `{ value: 'index', label: 'Index test' }`. On change it saves (`saveSettings`) and lifts. "Index test" is the spec's name for the option; "Best play" avoids "Play", which collides with the tab bar's Play button in specs.
  - `export function IndexTestView({ settings, activeProfile, onBack, onSettingsChange })`.
  - Drills quiz branch: `settings.drill.quizAsk === 'index' ? <IndexTestView …/> : <DeviationQuizView …/>`.

**Screen contract (IndexTestView):**
- Top bar: the same `.drill-topbar` / `.drill-back-btn` / `.drill-heading` "Deviation quiz" / Repeat as the quiz.
- Inline controls: `<QuizAskSwitch>`, then `<DrillModeControls>` (no options). The index select is hidden (decision 7).
- Prompt: `<div className="index-test-ask" data-testid="index-test-prompt" data-deviation-id={item.deviationId}>{indexTestPrompt(item)}</div>`, then the dealer card and hand exactly as the quiz renders them (`.dealer-area`, `.hands-row`), or `.quiz-insurance-prompt` "Dealer shows an Ace. Insurance?" for insurance.
- Proposal (voice/wheel): `<div data-testid="index-test-pending">{signed(pending, { plusZero: true })}?</div>` while `pending !== null`.
- Answer: `<NumPad label="Index (true count)" onSubmit={submit} />`, always mounted while answering. ± is the existing minus key, and 0 is allowed.
- Result strip (visual mode, B1 fast advance: grade, freeze, draw the next item in the same handler): `<ResultStrip id={r.id} tone={r.correct ? 'ok' : 'miss'}>` containing `data-testid="index-test-result"` with:
  - correct: `Correct! ${handText(cards, up)} — index ${signed(index)}`
  - wrong: verdict `Wrong`, hand line `${handText(cards, up)} · you said ${signed(answer)}`
  - then, either way, `data-testid="index-test-right-index"`: `Index ${signed(index)}` and `data-testid="index-test-play-line"`: `indexTestPlayLine(item)`, plus the SR line from `formatReviewPlain(deck[deviationId])`.
- Eyes-free or voice on: the prompt is spoken with `narrateIndexTestPrompt` on every new item (an effect keyed on `[item, eyesFree, voiceOn]`, like the quiz's). An answer speaks `narrateIndexTestCorrection`, enters phase `'feedback'` showing the same result block, and auto-advances with `autoAdvanceDelayMs(settings.audio.answerPauseMs, spokenPauseFor(text, rate))`.
- Voice: `useVoiceControl({ enabled: voiceOn || pushToTalkOpen, onAction, onTranscript, biasPhrases: [...Object.keys(VOICE_ACTIONS), ...COUNT_BIAS_PHRASES], context: 'index-test', … })`. `onTranscript` runs only in phase `'answering'`: the first reading `parseCountSpeech` accepts sets `pending` (value or `pending + delta`) and speaks `narrateReadback(next)`. `onAction`: `yes` submits `pending`, or says `NO_ANSWER_YET` when there is none. `no` clears `pending` and repeats the prompt. `repeat` repeats the prompt or the readback. In `'feedback'`: `yes` moves to the next item, `repeat` repeats the correction. Numbers are ignored outside `'answering'`.
- Wheel: `useWheelCommand`. In `talk` mode, forward is `startPushToTalk('index-test')` plus `audio.ding('attention')` and back repeats. Otherwise, in `'answering'`, `setPending(wheelNumber.press(command))`, where `useWheelNumber({ readback: (v) => speak(narrateReadback(v)), commit: submit })`. In `'feedback'`, forward is next and back repeats the correction.
- Keyboard: NumPad's own listener. Enter/Space during `'feedback'` advance.
- Bounce guard: `answerTooSoon(promptShownAtRef.current)` on submit, like the quiz.

- [ ] **Step 1: Move `DrillModeControls`** into its own file (verbatim, plus `export`). Run `npx tsc -b`, `npm run lint` (expect 13), and `E2E_PORT=4720 npx playwright test e2e/voice-answers.spec.ts e2e/flashcard-wheel.spec.ts --project=chromium --reporter=line` → PASS. This is a pure move: commit it on its own (`refactor(drills): DrillModeControls in its own file`).

- [ ] **Step 2: Write the failing e2e** `e2e/index-test.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { withProfile } from './helpers';

test.use({ viewport: { width: 375, height: 812 } });

// Published indices for the default profile (6D H17, Fab 4 off, extras off).
const H17: Record<string, number> = {
  ins: 3, '16v10': 0, '15v10': 4, TTv5: 5, TTv6: 4, '10v10': 4, '12v3': 2, '12v2': 3,
  '9v2': 1, '10vA': 3, '9v7': 3, '16v9': 4, '13v2': -1, '12v4': 0, '12v5': -2, '12v6': -3, '13v3': -2,
};

async function openIndexTest(page: Page) {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills' }).first().click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await page.getByRole('button', { name: 'Index test', exact: true }).click();
  await expect(page.getByTestId('index-test-prompt')).toBeVisible();
}

async function typeIndex(page: Page, n: number) {
  for (const d of String(Math.abs(n))) await page.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
  if (n < 0) await page.getByRole('button', { name: 'Plus or minus' }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
}

async function asked(page: Page): Promise<{ id: string; index: number }> {
  const id = (await page.getByTestId('index-test-prompt').getAttribute('data-deviation-id'))!;
  expect(id in H17, `unexpected index ${id}`).toBe(true);
  return { id, index: H17[id]! };
}

test('a right index is graded right and shows the play it triggers', async ({ page }) => {
  await openIndexTest(page);
  const { index } = await asked(page);
  await typeIndex(page, index);
  const strip = page.getByTestId('result-strip');
  await expect(strip).toHaveAttribute('data-tone', 'ok');
  await expect(page.getByTestId('index-test-result')).toContainText('Correct!');
  await expect(page.getByTestId('index-test-play-line')).toContainText(/ at TC ≥ /);
});

test('a wrong index shows the answered hand, the right index and the play', async ({ page }) => {
  await openIndexTest(page);
  const { index } = await asked(page);
  await typeIndex(page, index + 2);
  await expect(page.getByTestId('result-strip')).toHaveAttribute('data-tone', 'miss');
  const result = page.getByTestId('index-test-result');
  await expect(result).toContainText(' v ');
  await expect(result).toContainText(`you said ${index + 2 > 0 ? '+' : index + 2 < 0 ? '−' : ''}${Math.abs(index + 2)}`);
  await expect(page.getByTestId('index-test-right-index')).toHaveText(`Index ${index > 0 ? '+' : index < 0 ? '−' : ''}${Math.abs(index)}`);
  await expect(page.getByTestId('index-test-play-line')).toContainText(' below');
});

test('an answer reviews that index in the quiz deck', async ({ page }) => {
  await openIndexTest(page);
  const { id, index } = await asked(page);
  await typeIndex(page, index);
  const deck = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.quizsr.v1') ?? '{}'));
  expect(deck[id]?.reviews).toBe(1);
});

test('Ask is remembered and Best play brings the play quiz back', async ({ page }) => {
  await openIndexTest(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await expect(page.getByTestId('index-test-prompt')).toBeVisible();
  await page.getByRole('button', { name: 'Best play', exact: true }).click();
  await expect(page.locator('.quiz-tc')).toBeVisible();
  await expect(page.getByTestId('index-test-prompt')).toHaveCount(0);
});

test('fits a 375×812 phone: OK and the strip are on screen after a miss', async ({ page }) => {
  await openIndexTest(page);
  const { index } = await asked(page);
  await typeIndex(page, index + 1);
  const ok = await page.getByRole('button', { name: 'OK', exact: true }).boundingBox();
  expect(ok!.y + ok!.height).toBeLessThanOrEqual(812);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
```

(The `.dealer-area` card and the quiz's ActionBar must still fit too: the existing quiz specs plus the Step 6 screenshot cover the play quiz with the new Ask row.)

`e2e/index-test-voice.spec.ts`: copy `withFakeEngine` and `spoken` from `e2e/voice-tc-drill.spec.ts`, and use `sayOnceListening`/`waitForMic` from helpers. `withSettings(page, { audio: { enabled: true, verbosity: 'full', answerPauseMs: 0 } })`.
  - `'eyes-free speaks the index question'`: open the Index test, check Eyes-free audio → the speech log contains `Index to` or `insurance index`.
  - `'a spoken number is read back, then "yes" grades it'`: check Voice answers. Read `data-deviation-id`. `sayOnceListening(page, speakable(index))`, where the spec has its own `speakable`: `0 → 'zero'`, `+3 → 'plus three'`, `-1 → 'minus one'`, matching `COUNT_BIAS_PHRASES`. Expect `index-test-pending` to show the number and the log to contain `Correct?`. Then `sayOnceListening(page, 'yes')` → `index-test-result` contains `Correct!`.
  - `'a number said during the correction is not graded into the next item'`: answer once (voice). While `index-test-result` is showing in feedback, `sayOnceListening(page, 'plus five')`. Then assert `bjtrainer.stats.v1` `perIndex` holds exactly one answer in total, and `index-test-pending` is absent.

- [ ] **Step 3: Run them and see them fail**

Run: `E2E_PORT=4720 npx playwright test e2e/index-test.spec.ts e2e/index-test-voice.spec.ts --project=chromium --reporter=line`
Expected: FAIL (no "Index test" button).

- [ ] **Step 4: Implement** `QuizAskSwitch`, `IndexTestView` (screen contract above), `indexTest.css` (prompt, pending readout and the strip's lines, using existing theme tokens; NumPad keeps its own CSS), the `quizAsk` field and the Drills quiz branch. Give `.index-test-ask` a min-height so the layout does not jump between items.

- [ ] **Step 5: Run the new specs and the existing quiz/voice/wheel specs**

Run: `E2E_PORT=4720 npx playwright test e2e/index-test.spec.ts e2e/index-test-voice.spec.ts e2e/drills.spec.ts e2e/voice-answers.spec.ts e2e/wheel.spec.ts e2e/surrender-indices.spec.ts e2e/practice-mode.spec.ts --project=chromium --reporter=line`
Expected: PASS.

- [ ] **Step 6: Look at it.** Headless 375×812 screenshots of (a) the Index test with a miss strip, (b) the play quiz with the new Ask row and a miss strip. Read both PNGs: nothing clipped, the strip and the answer controls are visible without scrolling, nothing sits under the top-right mute seat.

- [ ] **Step 7: Mutation-check:** (a) `gradeIndexTest` compares against `index + 1` → the right-answer spec fails; (b) remove the `phase === 'answering'` guard in `onTranscript` → the voice "not graded into the next item" spec fails; (c) drop `saveQuizSr` from `gradeIndexTestAnswer` → the deck spec fails; (d) render the play line with `item.label` → the `' below'` assertion fails.

- [ ] **Step 8: Commit**

```bash
git add src/ui/screens/drills/QuizAskSwitch.tsx src/ui/screens/drills/IndexTestView.tsx src/ui/screens/drills/indexTest.css src/ui/screens/Drills.tsx src/store/types.ts e2e/index-test.spec.ts e2e/index-test-voice.spec.ts
git commit -m "feat(drills): Index test mode in the Deviation quiz, by touch, voice and wheel (B3)"
```

---

### Task 5: Region rules on wrong strips, and plain review copy (B7)

**Files:**
- Create: `src/ui/screens/regionRule.ts`, `src/ui/screens/regionRule.test.ts`
- Create: `src/ui/screens/drills/drillMiss.ts` (pure `.ts`, no JSX)
- Modify: `src/ui/screens/Drills.tsx` (`useHandResult` :219-260 holds `DrillHandResult`; `FlashcardsView.freezeResult` :738-775; `MixedSessionView.freezeResult` :2497-2525)
- Modify: `src/ui/screens/drills/MasteryChallengeView.tsx:207-217` (`setLastResult(snapshotResult(...))`)
- Modify: `src/drills/srStatus.ts:281-293` (`formatReviewPlain`), `src/drills/srStatus.test.ts:361-373`
- Modify (copy expectations): `e2e/flashcard-sr.spec.ts:32`, `e2e/flashcard-wheel.spec.ts:82`, `e2e/with-count.spec.ts:117`, `e2e/drills.spec.ts:17-18`
- Create: `e2e/region-rule.spec.ts`

**Interfaces:**
- Consumes: `getChart` (`engine/charts`); `DEALER_UPCARDS` (`ui/screens/chartRows.ts`); `tallyCellIdFor` (`store/stats.ts`).
- Produces:
  - `export interface RegionRule { section: 'HARD' | 'SOFT' | 'PAIRS'; rows: (number | Rank)[]; ups: Rank[]; action: ChartAction; text: string }`
  - `export function regionRuleFor(cellId: string, rules: RuleSet): RegionRule | null`, null for anything that is not a cell id.
  - `export type DrillHandResult = HandResult & { missLine?: string }` (`drillMiss.ts`; `missLine` is filled in Task 6).
  - `export function withRegionRule(result: HandResult, event: GradedEvent, rules: RuleSet): HandResult` (`drillMiss.ts`): on a miss with `event.source` `'flashcard'` or `'mastery'` and `tallyCellIdFor(event) !== null`, returns `{ ...result, reason: regionRuleFor(cellId, rules)!.text }`; otherwise returns `result` unchanged.

**Region algorithm (derived from the chart, no strategy typed in):** read the assembled chart (`getChart(rules)`). Row keys per section: HARD 5..21, SOFT 13..21, PAIRS one row only (never merged: 5,5 and 10,10 are absent). For the cell's row and up-card, with `a` = the chart action there:
1. Horizontal: take the maximal run of contiguous up-cards in `DEALER_UPCARDS` order (2..10, A) whose action is `a`.
2. Vertical (HARD/SOFT only): extend to adjacent row keys while every up-card in that run has action `a`.
3. A pair rank absent from `chart.PAIRS` (5, 10) becomes ``${r},${r}: never split, play it as hard ${2·value}. `` followed by the HARD rule for that total.

Text: `${label} v ${ups}: ${phrase}.`
- label: HARD `Hard 16` / `Hard 12–16` / `Hard 13+` (when the run reaches 21); SOFT `Soft A,7` / `Soft A,2–7` / `Soft A,8+`; PAIRS `8,8`.
- ups: a single card (`10`), a range (`2–6`, `9–A`), or `any dealer card` for all ten.
- phrase: H `hit`, S `stand`, Dh `double (hit if you can't)`, Ds `double (stand if you can't)`, P `split`, Rh `surrender (hit if you can't)`, Rs `surrender (stand if you can't)`, Rp `surrender (split if you can't)`. These eight are the only codes an assembled chart holds (`engine/charts/types.ts`: Ph/Pd/Ps are resolved by `getChart`, and `stripLs` turns R* into its fallback when `ls` is off), so the map is a `Record` over them and anything else throws.
- Dashes are en dashes (U+2013).

Plain review copy (`formatReviewPlain`), exact: `'You'll see this again soon'` (due now), `` `You'll see this again in ${h} hour${h === 1 ? '' : 's'}` ``, `"You'll see this again tomorrow"`, `` `You'll see this again in ${days} days` ``.

- [ ] **Step 1: Write the failing tests.** `src/ui/screens/regionRule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getChart } from '../../engine/charts';
import type { RuleSet } from '../../engine/ruleset';
import { DEFAULT_RULES } from '../../engine/ruleset';
import { generateAllCells } from '../../drills/flashcards';
import { DEALER_UPCARDS } from './chartRows';
import { regionRuleFor } from './regionRule';

const RULESETS: RuleSet[] = [];
for (const decks of [1, 2, 6, 8] as const)
  for (const s17 of [false, true])
    for (const das of [false, true])
      for (const ls of [false, true]) RULESETS.push({ ...DEFAULT_RULES, decks, s17, das, ls });

function actionAt(rules: RuleSet, section: 'HARD' | 'SOFT' | 'PAIRS', row: number | string, up: string) {
  const chart = getChart(rules);
  const table = chart[section] as Record<string | number, string[] | undefined>;
  return table[row]?.[DEALER_UPCARDS.indexOf(up as never)];
}

describe('region rules cover every chart cell under every ruleset', () => {
  for (const rules of RULESETS) {
    it(`${rules.decks}D ${rules.s17 ? 'S17' : 'H17'} das=${rules.das} ls=${rules.ls}`, () => {
      for (const cell of generateAllCells()) {
        const rule = regionRuleFor(cell.id, rules);
        expect(rule, cell.id).not.toBeNull();
        const [, kind, rowRaw, up] = /^(hard|soft|pair)-(\w+)-v-(\w+)$/.exec(cell.id)!;
        const own =
          kind === 'pair' && getChart(rules).PAIRS[rowRaw as never] !== undefined
            ? { section: 'PAIRS' as const, row: rowRaw! }
            : kind === 'pair'
              ? { section: 'HARD' as const, row: (rowRaw === 'A' ? 11 : Number(rowRaw)) * 2 }
              : { section: kind === 'hard' ? ('HARD' as const) : ('SOFT' as const), row: Number(rowRaw) };
        expect(rule!.section, cell.id).toBe(own.section);
        // The cell is inside its own region...
        expect(rule!.rows.map(String), cell.id).toContain(String(own.row));
        expect(rule!.ups, cell.id).toContain(up);
        // ...and the rule is true of every cell it names.
        for (const r of rule!.rows) for (const u of rule!.ups) {
          expect(actionAt(rules, rule!.section, r, u), `${cell.id} names ${r} v ${u}`).toBe(rule!.action);
        }
        // Horizontally maximal: the neighbours just outside the run differ.
        const idx = rule!.ups.map((u) => DEALER_UPCARDS.indexOf(u));
        const lo = Math.min(...idx), hi = Math.max(...idx);
        if (lo > 0) expect(actionAt(rules, rule!.section, own.row, DEALER_UPCARDS[lo - 1]!)).not.toBe(rule!.action);
        if (hi < 9) expect(actionAt(rules, rule!.section, own.row, DEALER_UPCARDS[hi + 1]!)).not.toBe(rule!.action);
        expect(rule!.text.length, cell.id).toBeLessThanOrEqual(110);
      }
    });
  }
});

describe('region rule wording (6D H17 DAS LS)', () => {
  const r = (id: string) => regionRuleFor(id, DEFAULT_RULES)!.text;
  it('reads as one line a beginner can learn from', () => {
    expect(r('hard-16-v-10')).toBe("Hard 16 v 9–A: surrender (hit if you can't).");
    expect(r('hard-13-v-4')).toBe('Hard 13+ v 2–6: stand.');
    expect(r('hard-11-v-A')).toBe("Hard 11 v any dealer card: double (hit if you can't).");
    expect(r('pair-8-v-A')).toBe("8,8 v A: surrender (split if you can't).");
    expect(r('soft-18-v-9')).toBe('Soft A,2–7 v 9–A: hit.');
    expect(r('pair-5-v-6')).toBe("5,5: never split, play it as hard 10. Hard 10–11 v 2–9: double (hit if you can't).");
    expect(r('pair-10-v-6')).toBe('10,10: never split, play it as hard 20. Hard 18+ v any dealer card: stand.');
  });
  it('is null for anything that is not a cell', () => {
    expect(regionRuleFor('dealer A', DEFAULT_RULES)).toBeNull();
  });
});
```

`src/drills/srStatus.test.ts:369-372`: change the four expectations to the new copy.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/ui/screens/regionRule.test.ts src/drills/srStatus.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `regionRule.ts`, `formatReviewPlain`, `drillMiss.ts` (`DrillHandResult`, `withRegionRule`). Wire it in: the `useHandResult` state type becomes `DrillHandResult`. Flashcards' and Mixed's `freezeResult` pass `withRegionRule(snapshot, event, activeProfile.rules)` to `showResult`. Mastery wraps its `snapshotResult(...)` the same way. `chartTargetFrom` keeps reading `result.reason`; that is safe because, on these basic-strategy misses, `chartNoteFor` returns null whenever chart and grade agree.

- [ ] **Step 4: Unit tests pass**

Run: `npx vitest run src/ui/screens src/drills`
Expected: PASS.

- [ ] **Step 5: Write the failing e2e** `e2e/region-rule.spec.ts`. Use `withSettings(page, { drill: { scopes: ['hard'] } })`, open Flashcards, and loop up to 20 answers on `Stand` with `answerAndReadStrip` until the tone is `miss`. Then:
  - `.hand-result-reason` does not match `/Basic \w+ vs dealer/`;
  - it matches `/^Basic strategy error\. Hard \d+(–\d+|\+)? v (\d+|A|any dealer card)(–(\d+|A))?: (hit|stand|double|surrender)/`;
  - the hard total in `[data-testid="result-strip"] .hand-result[data-cell-id]` (`hard-<n>-v-…`) is inside the rule's row range (parse both in the spec).
  Second test: `'the deviation quiz keeps its index label'`: a quiz miss's `.hand-result-reason` still contains `:` and `TC`.
  Update the four copy expectations in `flashcard-sr`, `flashcard-wheel`, `with-count` and `drills` specs to `You'll see this again`.

- [ ] **Step 6: Run the e2e**

Run: `E2E_PORT=4720 npx playwright test e2e/region-rule.spec.ts e2e/flashcard-sr.spec.ts e2e/flashcard-wheel.spec.ts e2e/with-count.spec.ts e2e/drills.spec.ts e2e/mastery-challenge.spec.ts e2e/wrong-tap.spec.ts --project=chromium --reporter=line`
Expected: PASS.

- [ ] **Step 7: Mutation-check:** (a) skip the vertical-extension condition check (always extend one row) → the "true of every cell" test fails; (b) stop the horizontal run one card early → the maximality test fails; (c) un-wire `withRegionRule` in `FlashcardsView` → the region e2e fails; (d) apply it to quiz events too → the "keeps its index label" e2e fails; (e) revert one `formatReviewPlain` branch → srStatus test fails.

- [ ] **Step 8: Commit**

```bash
git add src/ui/screens/regionRule.ts src/ui/screens/regionRule.test.ts src/ui/screens/drills/drillMiss.ts src/ui/screens/Drills.tsx src/ui/screens/drills/MasteryChallengeView.tsx src/drills/srStatus.ts src/drills/srStatus.test.ts e2e/region-rule.spec.ts e2e/flashcard-sr.spec.ts e2e/flashcard-wheel.spec.ts e2e/with-count.spec.ts e2e/drills.spec.ts
git commit -m "feat(drills): wrong strips teach the chart region, plain review copy (B7)"
```

---

### Task 6: Miss strips show cost and recent history (B6, hand drills)

**Files:**
- Create: `src/drills/missHistory.ts`, `src/drills/missHistory.test.ts`
- Create: `src/ui/screens/drills/MissHistoryLine.tsx`, `src/ui/screens/drills/missHistory.css`
- Modify: `src/ui/screens/drills/drillMiss.ts` (add `withMissDetail`)
- Modify: `src/ui/screens/Drills.tsx` (every `showResult(...)` site: Flashcards :746, Quiz :1659, Mixed :2515; render `<MissHistoryLine result={lastResult} />` directly after each `<HandResultStrip …/>`: :1298, :2147, :2867)
- Modify: `src/ui/screens/drills/MasteryChallengeView.tsx` (:207 snapshot; render after `<HandResultStrip>` :325)
- Create: `e2e/miss-history.spec.ts`

**Interfaces:**
- Consumes: Task 5's `DrillHandResult`, `withRegionRule`; `cellAfter` (`store/cellStats.ts`); `tallyCellIdFor` (`store/stats.ts`); `MINUS` (`drills/signed.ts`).
- Produces:
  - `export function shortCellLabel(cellId: string): string`: `hard-16-v-10` → `16 v 10`; `soft-18-v-9` → `A,7 v 9`; `pair-8-v-4` → `8,8 v 4`; `pair-A-v-6` → `A,A v 6`.
  - `export function ordinal(n: number): string`: `1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 101st`.
  - `export function missHistoryLine(event: GradedEvent, cellBefore: CellTally | null): string | null`: null when correct, or when `tallyCellIdFor(event)` is null. Otherwise `after = cellAfter(cellBefore ?? undefined, event)` and the line is `` `${cost}${ordinal(after.wrong)} miss on ${shortCellLabel(id)}${win}` ``, where:
    - `cost` = `` `${MINUS}${evCost.toFixed(2)} u · ` `` when `evCost >= 0.005`; `'under 0.01 u · '` when `0 <= evCost < 0.005`; `''` when unpriced;
    - `win` = `` `, ${misses} of last 5` `` when `after.recent` holds at least 5 results (misses = zeros in its last 5), else `''`.
  - `export function withMissDetail(result: HandResult, event: GradedEvent, cellBefore: CellTally | null, rules: RuleSet): DrillHandResult` = `{ ...withRegionRule(result, event, rules), missLine: missHistoryLine(event, cellBefore) ?? undefined }`. It replaces `withRegionRule` at the Flashcards, Mixed and Mastery sites and is added at the Quiz site, where `withRegionRule` is a no-op for quiz events.
  - `export function MissHistoryLine({ result }: { result: DrillHandResult | null })`: renders `<div className="miss-history" data-testid="miss-history">{result.missLine}</div>` only when `result && !result.correct && !result.undone && result.missLine`.

- [ ] **Step 1: Write the failing unit tests** `src/drills/missHistory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GradedEvent } from '../engine/grade';
import { missHistoryLine, ordinal, shortCellLabel } from './missHistory';

const miss = (hand: string, extra: Partial<GradedEvent> = {}): GradedEvent => ({
  kind: 'action', category: 'pairs', correct: false, classification: 'basic-error',
  taken: 'stand', expected: 'split', reason: 'Basic split vs dealer 4', tc: 0, hand, ...extra,
});

describe('missHistoryLine', () => {
  it('says the cost, which miss this is on the cell, and how many of the last five', () => {
    // recent '0111' + this miss = '01110': five results, two misses. Last four would hold only one.
    expect(missHistoryLine(miss('pair-8-v-4', { evCost: 0.6123 }), { right: 3, wrong: 2, lastAt: '', recent: '0111' })).toBe('−0.61 u · 3rd miss on 8,8 v 4, 2 of last 5');
    // Four results after the miss: too few for "of last 5".
    expect(missHistoryLine(miss('pair-8-v-4', { evCost: 0.61 }), { right: 2, wrong: 1, lastAt: '', recent: '101' })).toBe('−0.61 u · 2nd miss on 8,8 v 4');
    // A full stored window (11) reads only its last five.
    expect(missHistoryLine(miss('soft-18-v-9'), { right: 5, wrong: 10, lastAt: '', recent: '0000011111' })).toBe('11th miss on A,7 v 9, 1 of last 5');
  });
  it('drops what it cannot say honestly', () => {
    expect(missHistoryLine(miss('hard-16-v-10'), null)).toBe('1st miss on 16 v 10');
    expect(missHistoryLine(miss('hard-16-v-10', { evCost: 0.0004 }), null)).toBe('under 0.01 u · 1st miss on 16 v 10');
    expect(missHistoryLine({ ...miss('hard-16-v-10'), correct: true, classification: 'correct' }, null)).toBeNull();
    expect(missHistoryLine(miss('9,7 v 10', { deviationId: '16v10' }), null)).toBeNull();
    expect(missHistoryLine({ ...miss('dealer A'), kind: 'insurance' }, null)).toBeNull();
  });
  it('reads table notation from the quiz the same as a cell id', () => {
    expect(missHistoryLine(miss('9,7 v 10', { evCost: 0.02 }), null)).toBe('−0.02 u · 1st miss on 16 v 10');
  });
});

describe('labels', () => {
  it('ordinal', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  });
  it('shortCellLabel', () => {
    expect(['hard-16-v-10', 'soft-18-v-9', 'pair-8-v-4', 'pair-A-v-6'].map(shortCellLabel)).toEqual(['16 v 10', 'A,7 v 9', '8,8 v 4', 'A,A v 6']);
  });
});
```

(`cellAfter` appends the result and keeps at most `CELL_WINDOW + WINDOW_SPARE` = 11; the expectations above are worked out from that.)

- [ ] **Step 2: Run and see it fail**

Run: `npx vitest run src/drills/missHistory.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `missHistory.ts`, `withMissDetail`, `MissHistoryLine` and the four wirings. `missHistory.css`: a continuation band under the miss strip (same `--bad-surface`/`--bad-line` tokens as `.result-strip--miss`, no top border, 4px 12px padding, `font-size: 0.85rem`, `font-variant-numeric: tabular-nums`). It is never shown in eyes-free mode, because the strip itself is not.

- [ ] **Step 4: Run and see it pass**

Run: `npx vitest run src/drills src/ui/screens`
Expected: PASS.

- [ ] **Step 5: Write the e2e** `e2e/miss-history.spec.ts` (viewport 375×812):
  - `'a flashcard miss shows its cost and that it is the first miss on the cell'`: scopes `['hard']`. Answer `Stand` with `answerAndReadStrip` until a miss. `miss-history` text matches `/^(−\d+\.\d\d u|under 0\.01 u) · 1st miss on \d+ v (\d+|A)$/` or `/^1st miss on/`. The cell named equals the strip's `data-cell-id` mapped through the spec's own `16 v 10` formatting.
  - `'history counts earlier misses on the cell'`: scopes `['hard']`, and `withStats` seeds the same tally `{ right: 1, wrong: 3, lastAt: '', recent: '0101' }` on EVERY hard cell id (totals 5..19 × up-cards 2..10, A), so whichever hard cell is missed the line reads `… 4th miss on <cell>, 3 of last 5`.
  - `'Wrong tap takes the line away with the miss'`: after a miss, click `Wrong tap` → `miss-history` count 0.
  - `'the line keeps the answer buttons on screen'`: after a miss, the `.action-bar` bounding box bottom ≤ 812.

- [ ] **Step 6: Run the e2e and the existing strip specs**

Run: `E2E_PORT=4720 npx playwright test e2e/miss-history.spec.ts e2e/wrong-tap.spec.ts e2e/mastery-challenge.spec.ts e2e/hand-scopes.spec.ts --project=chromium --reporter=line`
Expected: PASS. Then take a 375×812 screenshot of a Flashcards miss and read it.

- [ ] **Step 7: Mutation-check:** (a) `ordinal` returns `${n}th` always → unit test fails; (b) count misses over the last 4 → "2 of last 5" fails; (c) show the window part from 4 results → the "2nd miss" case fails; (d) drop the `!result.undone` condition → the Wrong tap e2e fails; (e) unwire `withMissDetail` at the Flashcards site → the first e2e fails.

- [ ] **Step 8: Commit**

```bash
git add src/drills/missHistory.ts src/drills/missHistory.test.ts src/ui/screens/drills/MissHistoryLine.tsx src/ui/screens/drills/missHistory.css src/ui/screens/drills/drillMiss.ts src/ui/screens/Drills.tsx src/ui/screens/drills/MasteryChallengeView.tsx e2e/miss-history.spec.ts
git commit -m "feat(drills): miss strips show the mistake's cost and recent history (B6)"
```

---

### Task 7: First-run "How to read the chart" (B7)

**Files:**
- Create: `src/drills/chartIntro.ts`, `src/drills/chartIntro.test.ts`
- Create: `src/ui/screens/drills/ChartIntro.tsx`, `src/ui/screens/drills/chartIntro.css`
- Modify: `src/ui/screens/Charts.tsx` (`ChartsProps` gains `backText?: string`, used in place of `` `Back to ${backLabel ?? 'Home'}` `` when given, :157-170 and :281)
- Modify: `src/ui/screens/Drills.tsx` (flash branch :3013-3023)
- Modify: `e2e/offline.spec.ts:350-351`, `e2e/clip-playback.spec.ts:553-554` (one dismiss line each: these load without `?e2e=1` on a fresh profile)
- Create: `e2e/chart-intro.spec.ts`

**Interfaces:**
- Consumes: `loadStats` (`store/persist`); `isEyesFreeOn` (`ui/eyesFreeSession.ts`); `isVoiceOn` (`ui/voiceSession.ts`); `isE2eAudioMode` (`audio/speech.ts`); `Charts` (`screens/Charts.tsx`).
- Produces:
  - `export const CHART_INTRO_KEY = 'bjtrainer.chartIntro.v1'` (its own localStorage key, like `CHART_ORDER_KEY`; not a Settings or Profile field).
  - `export function hasHandHistory(stats: Stats): boolean`: true when `cellStats` has any entry, or `handRecent` has any non-empty window.
  - `export function chartIntroDue(input: { stats: Stats; seen: boolean; eyesFree: boolean; voiceOn: boolean; search: string; e2e: boolean }): boolean` = `!seen && !hasHandHistory(stats) && !eyesFree && !voiceOn && (!e2e || new URLSearchParams(search).has('intro'))`.
  - `export function loadChartIntroSeen(): boolean` / `export function saveChartIntroSeen(): void`, wrapped in try/catch (blocked storage reads as "seen" so the screen never loops).
  - `export function ChartIntro({ activeProfile, onStart, onBack }: { activeProfile: Profile; onStart: () => void; onBack: () => void })`.

**Screen contract:** a full-screen layer `data-testid="chart-intro"` that owns its own scroll. At the top:
- the drill top bar (`.drill-topbar`: Back → `onBack`, `.drill-heading` "Flashcards"; existing specs read this heading);
- a card with `<h2>How to read the chart</h2>` and three numbered lines: "1. Find your hand. Pairs first, then soft hands (an ace counted as 11), then hard totals." "2. Go across to the dealer's card." "3. The letter in that box is your play. A second letter is the play when the first isn't allowed.";
- a primary `Start quiz` button, which must be visible at 375×812 without scrolling.

Below the card, `<Charts activeProfile={activeProfile} onNavigate={() => {}} highlight={{ section: 'HARD', row: 16, dealerUp: '10' }} note="Example: hard 16 against a 10 is ringed." onBack={onStart} backText="Start quiz" backPlacement="floating" />`. Both buttons call `onStart`, which runs `saveChartIntroSeen()` and then shows Flashcards.

In `Drills.tsx`, the flash branch renders a small inner component `FlashEntry` that owns `const [intro, setIntro] = useState(() => chartIntroDue({ stats: loadStats(), seen: loadChartIntroSeen(), eyesFree: isEyesFreeOn(), voiceOn: isVoiceOn(), search: window.location.search, e2e: isE2eAudioMode() }))`. It renders `ChartIntro` while `intro` is true, else the existing `gate('Flashcards', <FlashcardsView …/>)`. `FlashcardsView` itself is not touched.

- [ ] **Step 1: Write the failing unit tests** `src/drills/chartIntro.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EMPTY_STATS } from '../store/types';
import { chartIntroDue, hasHandHistory } from './chartIntro';

const base = { stats: EMPTY_STATS, seen: false, eyesFree: false, voiceOn: false, search: '', e2e: false };

describe('chartIntroDue', () => {
  it('shows once, to someone with no hands answered', () => {
    expect(chartIntroDue(base)).toBe(true);
    expect(chartIntroDue({ ...base, seen: true })).toBe(false);
  });
  it('not after any hand history', () => {
    const stats = { ...EMPTY_STATS, cellStats: { 'hard-16-v-10': { right: 1, wrong: 0, lastAt: '' } } };
    expect(hasHandHistory(stats)).toBe(true);
    expect(chartIntroDue({ ...base, stats })).toBe(false);
    expect(chartIntroDue({ ...base, stats: { ...EMPTY_STATS, handRecent: { soft: '1' } } })).toBe(false);
  });
  it('never in a car session', () => {
    expect(chartIntroDue({ ...base, eyesFree: true })).toBe(false);
    expect(chartIntroDue({ ...base, voiceOn: true })).toBe(false);
  });
  it('under the e2e harness only when the URL asks for it', () => {
    expect(chartIntroDue({ ...base, e2e: true, search: '?e2e=1' })).toBe(false);
    expect(chartIntroDue({ ...base, e2e: true, search: '?e2e=1&intro=1' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npx vitest run src/drills/chartIntro.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the failing e2e** `e2e/chart-intro.spec.ts` (viewport 375×812). Every case except the last loads `/?e2e=1&intro=1`, so a "no intro" assertion can only pass because of the condition under test:
  - `'first Flashcards launch shows how to read the chart, once'`: `page.goto('/?e2e=1&intro=1')` → Drills → Flashcards. `chart-intro` is visible, with heading "How to read the chart" and `.chart-table` count ≥ 1. The first `Start quiz` button's bounding box bottom is ≤ 812. Click it → `chart-intro` count 0 and `.action-bar` visible. Back, then Flashcards again → no intro. `page.reload()` → Drills → Flashcards → no intro.
  - `'Next step rung 1 Start lands on it'`: fresh `?e2e=1&intro=1` → `page.getByRole('region', { name: 'Next step' }).getByRole('button', { name: /Start/ })` click → `chart-intro` visible.
  - `'not shown with hand history'`: `withStats(page, { cellStats: { 'hard-16-v-10': { right: 1, wrong: 0, lastAt: '' } } })` → Flashcards shows `.action-bar`, no intro.
  - `'not shown in an eyes-free session'`: `withSettings(page, { audio: { enabled: true } })`; open the Deviation quiz and check Eyes-free audio; Back; open Flashcards → no intro.
  - `'the harness default stays quiet'`: `?e2e=1` without `intro` → no intro.
  - Look: take a screenshot of the intro at 375×812 and read it.
  Edit `e2e/offline.spec.ts` after its Flashcards click (:350) and `e2e/clip-playback.spec.ts` after :553 to add `await page.getByRole('button', { name: 'Start quiz' }).first().click();`. Both run without `?e2e=1` on a fresh profile, so the intro is deterministic there.

- [ ] **Step 4: Run and see it fail**

Run: `E2E_PORT=4720 npx playwright test e2e/chart-intro.spec.ts --project=chromium --reporter=line`
Expected: FAIL.

- [ ] **Step 5: Implement** `chartIntro.ts`, `ChartIntro.tsx`, `chartIntro.css` (fixed layer like `.study-chart-overlay`, safe-area padding, nothing under the mute seat), the `backText` prop and `FlashEntry`.

- [ ] **Step 6: Run unit + e2e, and the specs that open Flashcards fresh**

Run: `npx vitest run src/drills/chartIntro.test.ts` then `E2E_PORT=4720 npx playwright test e2e/chart-intro.spec.ts e2e/flashcard-sr.spec.ts e2e/flashcard-stats.spec.ts e2e/next-step.spec.ts e2e/update-deferral.spec.ts e2e/smoke.spec.ts --project=chromium --reporter=line`
Expected: PASS. (`offline.spec.ts` runs in its own preview project. Run it once: `E2E_PORT=4720 npx playwright test e2e/offline.spec.ts --reporter=line`. Do NOT run `clip-playback.spec.ts`, which needs real audio: the edit there is one line, reviewed by reading.)

- [ ] **Step 7: Mutation-check:** (a) drop `!hasHandHistory(stats)` → the unit test and the "with hand history" e2e fail; (b) never call `saveChartIntroSeen` → the "once" e2e fails after the reload; (c) drop the eyes-free condition → the eyes-free e2e fails; (d) drop the `intro` param check → the harness-default e2e fails.

- [ ] **Step 8: Commit**

```bash
git add src/drills/chartIntro.ts src/drills/chartIntro.test.ts src/ui/screens/drills/ChartIntro.tsx src/ui/screens/drills/chartIntro.css src/ui/screens/Charts.tsx src/ui/screens/Drills.tsx e2e/chart-intro.spec.ts e2e/offline.spec.ts e2e/clip-playback.spec.ts
git commit -m "feat(drills): first Flashcards launch shows how to read the chart (B7)"
```

---

### Task 8: Flashcards progress line and goal-met confirmation (B7)

**Files:**
- Create: `src/ui/screens/drills/flashProgress.ts`, `src/ui/screens/drills/flashProgress.test.ts`, `src/ui/screens/drills/flashProgress.css`
- Modify: `src/ui/screens/Drills.tsx` (`FlashcardsView`: state for the line and the confirmation, set at mount and in `freezeResult` :738; render inside `.drill-inline-controls` directly under `<HandDeckControls>` :1147)
- Create: `e2e/flash-progress.spec.ts`

**Interfaces:**
- Consumes: `handCategoryProgress`, `CATEGORY_TARGET`, `MIN_CATEGORY_ANSWERS`, `pctDown`, `goalPct` (`ui/screens/handProgress.ts`, read-only); `scopesFrom` (`drills/handScope.ts`); `loadStats`.
- Produces:
  - `export function flashProgressLine(stats: Stats, scopes: readonly HandScope[]): string`: `` `Goal ${pctDown(CATEGORY_TARGET)}%: ` `` followed by one part per dealt hand type, in Hard/Soft/Pairs order, joined with ` · `. A thin part reads `` `Hard ${n}/${MIN_CATEGORY_ANSWERS}` ``; a judged part reads `` `Hard ${goalPct(pct)}` ``, with ` ✓` appended when on target. Example: `'Goal 90%: Hard 93% ✓ · Soft 85% · Pairs 12/20'`.
  - `export function goalsCrossed(before: Stats, after: Stats, scopes: readonly HandScope[]): string[]`: the labels (`'Hard totals'`, …) whose `onTarget` went from false to true.
  - `export function goalMetLine(labels: string[], after: Stats): string`: `` `${labels.join(' and ')} on target: ${parts}.` ``. A recent-window part reads `` `${goalPct(pct)} over your last ${judgedN}` ``; a lifetime part reads `` `${goalPct(pct)} over ${judgedN} answers` ``.
- Render: `<div className="flash-progress" data-testid="flash-progress">{line}</div>`. When a goal is crossed, also render `<div className="flash-goal-met" role="status" data-testid="flash-goal-met">{goalMetLine}</div>`, which clears on the next answer. The stats snapshot `before` is taken at the previous answer (or at mount).

- [ ] **Step 1: Write the failing unit tests** `flashProgress.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EMPTY_STATS } from '../../../store/types';
import type { Stats } from '../../../store/types';
import { flashProgressLine, goalsCrossed, goalMetLine } from './flashProgress';

const withHard = (right: number, wrong: number, recent?: string): Stats => ({
  ...EMPTY_STATS,
  cellStats: { 'hard-16-v-10': { right, wrong, lastAt: '', ...(recent ? { recent } : {}) } },
  ...(recent ? { handRecent: { hard: recent } } : {}),
});

describe('flashProgressLine', () => {
  it('shows answers until a hand type can be judged, then its figure, ticked at the goal', () => {
    expect(flashProgressLine(withHard(5, 2), ['hard'])).toBe('Goal 90%: Hard 7/20');
    expect(flashProgressLine(withHard(27, 3, '1'.repeat(27) + '000'), ['hard'])).toBe('Goal 90%: Hard 90% ✓');
    expect(flashProgressLine(withHard(26, 4, '1'.repeat(26) + '0000'), ['hard', 'soft'])).toBe('Goal 90%: Hard 86% · Soft 0/20');
  });
});

describe('goalsCrossed', () => {
  it('names a hand type the moment it reaches the goal, and only then', () => {
    const before = withHard(19, 0, '1'.repeat(19));
    const after = withHard(20, 0, '1'.repeat(20));
    expect(goalsCrossed(before, after, ['hard'])).toEqual(['Hard totals']);
    expect(goalsCrossed(after, withHard(21, 0, '1'.repeat(21)), ['hard'])).toEqual([]);
    expect(goalMetLine(['Hard totals'], after)).toBe('Hard totals on target: 100% over your last 20.');
  });
});
```

(Confirm against `handCategoryProgress`'s real rules: judged on the window once it holds ≥ 20 results, `thin` while lifetime n < 20. Adjust only the copy's numbers if the arithmetic differs, never the rule.)

- [ ] **Step 2: Run and see it fail**

Run: `npx vitest run src/ui/screens/drills/flashProgress.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the failing e2e** `e2e/flash-progress.spec.ts` (viewport 375×812):
  - `'the line shows the goal for the hand types being dealt'`: `withSettings(page, { drill: { scopes: ['hard'] } })` + `withStats(page, { cellStats: { 'hard-16-v-10': { right: 27, wrong: 3, lastAt: '', recent: '1'.repeat(27) + '000' } }, handRecent: { hard: '1'.repeat(27) + '000' } })` → `flash-progress` has text `Goal 90%: Hard 90% ✓`.
  - `'reaching the goal says so'`: seed lifetime 19/19 (`recent` and `handRecent.hard` = 19 ones). Any answer (Stand) moves n to 20 at ≥ 95%, so `flash-goal-met` contains `Hard totals on target`. The next answer clears it.
  - `'the line keeps the answer buttons on screen'`: `.action-bar` bottom ≤ 812 after a miss with the line showing.

- [ ] **Step 4: Run and see it fail**

Run: `E2E_PORT=4720 npx playwright test e2e/flash-progress.spec.ts --project=chromium --reporter=line`
Expected: FAIL.

- [ ] **Step 5: Implement** `flashProgress.ts`, the CSS (one line, `font-size: 0.8rem`, ellipsis on overflow, no wrap) and the `FlashcardsView` wiring. Update the line in `freezeResult` from `loadStats()`; the grade has already persisted.

- [ ] **Step 6: Run unit + e2e + layout neighbours**

Run: `npx vitest run src/ui/screens/drills` then `E2E_PORT=4720 npx playwright test e2e/flash-progress.spec.ts e2e/gutters.spec.ts e2e/safe-area.spec.ts e2e/flashcard-stats.spec.ts e2e/hand-scopes.spec.ts --project=chromium --reporter=line`
Expected: PASS. Take a 375×812 screenshot of Flashcards with the line and a miss strip, and read it.

- [ ] **Step 7: Mutation-check:** (a) tick at `pct > CATEGORY_TARGET` → the "90% ✓" cases fail; (b) `goalsCrossed` returns every on-target label → the "only then" assertion fails; (c) never clear the confirmation → the "next answer clears it" e2e fails.

- [ ] **Step 8: Commit**

```bash
git add src/ui/screens/drills/flashProgress.ts src/ui/screens/drills/flashProgress.test.ts src/ui/screens/drills/flashProgress.css src/ui/screens/Drills.tsx e2e/flash-progress.spec.ts
git commit -m "feat(drills): Flashcards shows progress to the basic-strategy goal (B7)"
```

---

### Task 9: Gate run

**Files:** none changed unless a gate fails (then fix in the owning task's files and re-run from step 1).

- [ ] **Step 1: Types.** Run `npx tsc -b`. Expected: no output, exit 0.
- [ ] **Step 2: Unit suite.** Run `npx vitest run`. Expected: all files pass, and the count of test files is the baseline plus the new ones (`bjaExtras`, `indexTest`, `regionRule`, `missHistory`, `chartIntro`, `flashProgress`).
- [ ] **Step 3: Lint.** Run `npm run lint`. Expected: exactly **13** warnings, 0 errors. A 14th means a non-component export landed in a `.tsx` (move it to a `.ts`).
- [ ] **Step 4: Build and check what ships.** Run `npm run build`, then
  `grep -l "BJA H17 extras" dist/assets/*.js`, `grep -l "How to read the chart" dist/assets/*.js`, `grep -l "Index test" dist/assets/*.js`, `grep -l "You'll see this again" dist/assets/*.js`, `grep -l "miss on " dist/assets/*.js`, `grep -l "stand at any negative TC" dist/assets/*.js`.
  Expected: each prints at least one file.
- [ ] **Step 5: Targeted e2e (lane port, from a clean worktree, no edits running).**

```bash
E2E_PORT=4720 npx playwright test \
  e2e/bja-extras.spec.ts e2e/index-test.spec.ts e2e/index-test-voice.spec.ts \
  e2e/region-rule.spec.ts e2e/miss-history.spec.ts e2e/chart-intro.spec.ts e2e/flash-progress.spec.ts \
  e2e/surrender-indices.spec.ts e2e/drills.spec.ts e2e/with-count.spec.ts e2e/wrong-tap.spec.ts \
  e2e/flashcard-sr.spec.ts e2e/flashcard-stats.spec.ts e2e/flashcard-wheel.spec.ts \
  e2e/voice-answers.spec.ts e2e/voice-history.spec.ts e2e/wheel.spec.ts e2e/mastery-challenge.spec.ts \
  e2e/hand-scopes.spec.ts e2e/practice-mode.spec.ts e2e/speed-drill.spec.ts e2e/next-step.spec.ts \
  e2e/gutters.spec.ts e2e/safe-area.spec.ts e2e/update-deferral.spec.ts e2e/smoke.spec.ts \
  --project=chromium --reporter=line
E2E_PORT=4720 npx playwright test e2e/offline.spec.ts --reporter=line
```

Expected: all pass. On a flake, read `test-results/**/error-context.md` before anything else, and never raise a timeout.
- [ ] **Step 6: Visual sign-off.** Read the 375×812 PNGs from Tasks 4, 6, 7 and 8 again in the default theme, plus one dark theme (Index test and the intro). Nothing overlaps the mute seat, no sideways scroll, and every tap target is ≥ 44px.
- [ ] **Step 7: Report** the gate output (counts, the 13-warning line, the grep hits, the e2e summary) to the controller. Do not merge: the controller merges the lanes.

---

## Cross-lane requests

- **None blocking.** This lane does not edit `HandResultStrip.tsx` (P): the region rule rides in the snapshot's `reason`, and the miss line is a sibling element under the strip.
- **FYI to all lanes:** D edits two engine files no lane lists, `engine/strategy.ts` (generalised total and ten-pair index lookup, behaviour-identical with extras off) and `engine/grade.ts` (`isPhantomDeviation` soft branch). D also edits `drills/gradeAnswer.ts` (new export), `drills/srStatus.ts` (copy), and the copy lines in `e2e/flashcard-sr`, `flashcard-wheel`, `with-count`, `drills`, `offline` and `clip-playback` specs. **N (B10 rules diff)**: index sets can now carry `kind: 'soft'` entries (soft total in `total`); `extra: true` marks the BJA extras, which only exist when the profile opts in.
- **H:** after merge, Home's index denominators (`readiness.activeIndices`) grow by 8 for profiles with `bjaExtras` on. This is automatic and needs no H change. The Task 7 e2e uses `getByRole('region', { name: 'Next step' })` → button `/Start/`. If H renames that region, the controller updates the one selector at merge.
- **store/types.ts:** D adds `Profile.bjaExtras?` directly after `surrenderIndices?` (not at the end, where P appends `hotShoe?`) and `drill.quizAsk?` directly after `quizDistractorPct`.
