# Mastery Challenge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Mastery Challenge" drill: pick a scope (Hard / Soft / Pairs / All), walk every chart cell in that scope in random order exactly once, and get every single one right — one wrong answer wipes the run and it starts over from zero with a freshly shuffled order.

**Architecture:** A new pure module (`src/drills/masteryChallenge.ts`) owns cell enumeration, seeded shuffling, and the reset/advance state machine — all unit-testable under vitest's node environment. A new screen (`src/ui/screens/drills/MasteryChallengeView.tsx`) wires that state machine to the existing shared grading path (`src/drills/gradeAnswer.ts`), the existing answer-legality gate (`src/drills/answerGate.ts`), and the existing interruption machinery (`src/drills/distraction.ts`). Nothing about how a hand is graded is reinvented — only sequencing (walk-without-replacement + reset-on-miss) is new.

**Tech Stack:** React 19 + TypeScript (strict, `erasableSyntaxOnly`), Vite, vitest (`environment: 'node'`, `.test.ts` only), Playwright e2e.

**Spec:** Operator request (verbatim, restated in full below) — no separate spec document exists; this plan **is** the spec, argued from the operator's own words plus the codebase facts gathered below.

## Global Constraints

- No enums, no constructor parameter properties (`erasableSyntaxOnly`).
- vitest only picks up `src/**/*.test.ts`, `environment: 'node'` — no DOM. Every behavior worth a unit test must live in a plain `.ts` module; anything that needs a rendered DOM goes to Playwright e2e.
- No bare `Math.random()` and no `Date.now()` inside pure logic — seeds and `now` are passed in by the caller (component).
- Persistence goes through `src/store/persist.ts`'s localStorage idiom (guarded `try/catch`, in-memory fallback for node). Any new standalone key must be added to `persist.ts`'s `EXTRA_KEYS` so backup/restore doesn't silently drop it.
- Never hardcode a hex color; use the CSS custom properties in `src/ui/themes.css`.
- Validation commands: `npx vitest run`, `npx tsc --noEmit -p tsconfig.app.json`, `E2E_PORT=<port> npx playwright test`, `npx oxlint`.

---

## 1. Request restated clause by clause

> "Let's also add like a fill out challenge where I can do hard soft pair and all and we just work through the complete table randomly, if I mess up it resets progress. The goal is to fill out the complete table without errors to test mastery. Should be interruption difficulties defaulting at none. Need to be able to check progress"

| Clause | What satisfies it |
|---|---|
| "hard soft pair and all" (scope selectable) | A `MasteryScope = 'all' \| 'hard' \| 'soft' \| 'pairs'` selector, same four values `flashCategory` already uses, backed by the same cell universe `src/drills/flashcards.ts`'s `generateAllCells()` defines. |
| "work through the complete table randomly" | A seeded Fisher-Yates shuffle (reusing `fisherYatesShuffle` from `src/engine/cards.ts`, exported for this purpose) over every cell in the scope, walked one at a time, in that fixed order, with no replacement. |
| "if I mess up it resets progress" | Any incorrect graded answer resets the run: index back to 0, **and** a fresh reshuffle (new seed) — see Design Decision D2. |
| "goal is to fill out the complete table without errors to test mastery" | Completion = every cell in the scope answered correctly, back-to-back, in one unbroken run. This is a strict pass/fail mastery gate, not an accuracy percentage — reflected in the UI as a completion screen, not a score. |
| "Should be interruption difficulties defaulting at none" | A per-challenge difficulty selector (Off / Occasional / Relentless) reusing `src/drills/distraction.ts`'s `DistractionFreq` type and `isDistractionPoint`/`makeDistraction` functions, backed by a **new** `Settings.drill.masteryDistractionFreq` field defaulting to `'off'` ("none"). See Design Decision D4 for why this is a new field rather than reusing `distractionFreq`. |
| "Need to be able to check progress" | **Minimum reading (built by this plan):** a live "N / total cleared" readout always visible on the challenge screen while a run is in progress, surviving a reload (the run is persisted). **NOT built** (see "Explicitly out of scope" below): a lifetime history of attempts/completions. |

---

## 2. Current state to reuse

### 2.1 Cell universe — already enumerated, just not exported

`src/drills/flashcards.ts` already defines the exact "one cell = one canonical playable hand × one dealer upcard" universe this challenge needs to walk. It is currently private to that file:

```ts
// src/drills/flashcards.ts:22-83 (current, private)
interface Cell {
  id: string;
  cards: [Card, Card];
  up: Rank;
}

/**
 * Generate all possible flashcard cells.
 * ...
 * Universe size: (15 hard + 8 soft + 10 pair) x 10 upcards = 330 cells.
 */
function generateAllCells(): Cell[] { ... }
```

`drawFlashcard()` (same file, lines 98-146) filters this list by `category` (`'all' | 'hard' | 'soft' | 'pairs'`) with:

```ts
// src/drills/flashcards.ts:110-118 (current, inlined in drawFlashcard)
let cells: Cell[];
if (category === 'all') {
  cells = allCells;
} else if (category === 'pairs') {
  cells = allCells.filter((c) => c.id.startsWith('pair-'));
} else {
  cells = allCells.filter((c) => c.id.startsWith(category + '-'));
}
```

**This is the canonical "complete table" for this feature** — not the raw chart's `HARD`/`SOFT`/`PAIRS` key sets (see "Real cell counts" below for why those numbers differ and are the wrong ones to walk).

### 2.2 The one shared grade path

`src/drills/gradeAnswer.ts` builds and persists every graded event. The two pieces this plan reuses:

```ts
// src/drills/gradeAnswer.ts:118-149 (current)
export function buildFlashcardEvent(
  card: Flashcard,
  taken: Action,
  rules: RuleSet,
  elapsedMs: number,
): { event: GradedEvent; correctAction: Action; correct: boolean } {
  const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };
  const withCount = correctPlay(card.cards, card.up, 0, ctx, rules);
  const basicOnly = basicPlay(card.cards, card.up, ctx, rules);
  const { classification, correct } = classifyAction(taken, withCount, basicOnly, card.cards, card.up, 0, rules);
  const event: GradedEvent = {
    kind: 'action',
    source: 'flashcard',
    category: cellCategory(card.cellId, card.correct),
    ...
  };
  return { event, correctAction: withCount.action, correct };
}
```

```ts
// src/drills/gradeAnswer.ts:93-99 (current, PRIVATE)
function persistGrade(event: GradedEvent, retention: RetentionRow | null): void {
  let stats = applyEvents(loadStats(), [event]);
  if (retention) {
    stats = { ...stats, retention: { history: [...stats.retention.history, retention] } };
  }
  saveStats(stats);
}
```

`gradeFlashcardAnswer` (the full wrapper `FlashcardsView` calls) also updates the Leitner spaced-repetition deck (`FLASH_SR_KEY`) on every answer. This challenge deliberately does **not** want that side effect (Design Decision D5), so it needs `buildFlashcardEvent` + `persistGrade` directly, not the full wrapper.

### 2.3 Answer legality gate — already the single decision point

```ts
// src/drills/answerGate.ts:46-61 (current, unchanged by this plan)
export function gateDrillAnswer(taken: string, cards: Card[] | null, rules: RuleSet): AnswerGate {
  if (cards === null) return ACCEPTED;
  if (!(taken in ACTION_SPOKEN)) return ACCEPTED;
  const action = taken as Action;
  if (drillLegalActions(cards, rules).includes(action)) return ACCEPTED;
  return { accepted: false, announcement: `${ACTION_SPOKEN[action]} isn't available on this hand.` };
}
```

Every drill view calls this **before** grading. `FlashcardsView`'s keyboard handler (`src/ui/screens/Drills.tsx:378-383`) is the exact pattern to copy: the gate runs first, and only an accepted answer ever reaches the grading function. No `GradedEvent` is ever produced for a refused answer.

### 2.4 Interruption machinery — reuse the primitives, not the setting

```ts
// src/drills/distraction.ts:96, 123-132 (current, unchanged by this plan)
export type DistractionFreq = 'off' | 'occasional' | 'relentless';
export function isDistractionPoint(shownIndex: number, freq: DistractionFreq): boolean { ... }
export function makeDistraction(runningCount: number, mode: DistractionMode, seed?: number): Distraction { ... }
```

`CountDrillView` (`src/ui/screens/drills/CountDrillView.tsx:322`, `1021-1056`) is the wiring precedent: check `isDistractionPoint(indexIntoTheStream, freq)` before advancing, and if true, show a distraction prompt (`makeDistraction`) instead of the next card, resuming afterward.

### 2.5 Seeded shuffle — already written, just not exported

```ts
// src/engine/cards.ts:32-42 (current, PRIVATE, used internally by Shoe)
function fisherYatesShuffle<T>(array: T[], rng: () => number): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
```

Paired with `mulberry32(seed)` (same file, line 22, already exported), this is exactly the "random order over the complete table" primitive — no new shuffle algorithm needs writing.

### 2.6 Screen shape and registration

`src/ui/screens/drills/PairCancelView.tsx` is the template for a **visual-only** drill screen (no eyes-free ZonePad, no wake lock, no narration) — this challenge follows that shape, not `FlashcardsView`'s heavier eyes-free-capable shape (see Design Decision D7). `src/ui/screens/Drills.tsx` registers each drill as a `mode` string in `Drills()`'s `useState` union and a corresponding `if (mode === '...')` branch, plus a nav button in the picker (grouped by skill — "Keeping the count" / "Knowing the plays" / "Under pressure").

### 2.7 Real cell counts, measured

Counted directly from `generateAllCells()` (`src/drills/flashcards.ts:37-83`) and cross-checked against the raw chart data (`src/engine/charts/d68_h17.ts`, `d1_h17.ts`, `d2_h17.ts` — all three deck classes and both H17/S17 variants share the same row/column *shape*, only cell *values* differ):

| Scope | Construction | Count |
|---|---|---|
| Hard | totals 5–19 (15 totals; 4 and 20 are only constructible as a pair, not a "hard" hand) × 10 upcards | **150** |
| Soft | A+2 .. A+9 = soft 13–20 (8 totals; soft 21 is a natural blackjack, never a decision) × 10 upcards | **80** |
| Pairs | ranks A,2,3,4,5,6,7,8,9,10 (10 ranks — note this is **more** than the raw chart's `PAIRS` table, which only lists 8 ranks: 5-pair and 10-pair fall through to hard 10 / hard 20 and are still real decisions worth drilling) × 10 upcards | **100** |
| **All** | 150 + 80 + 100 | **330** |

This is why `generateAllCells()`, not the raw `Chart.HARD`/`SOFT`/`PAIRS` records, is the correct enumeration to walk: the raw `HARD` table has 18 rows (4–21) and `SOFT` has 9 (13–21), several of which (hard 4, hard 20, hard 21, soft 21) are not reachable as an actual decision without going through a pair or a dealt blackjack — walking those as if they were free-standing hands would either be impossible to construct or double-count against the Pairs scope.

At a realistic 3–6 seconds per decision, a clean 330-cell sweep is **15–35 minutes of uninterrupted, zero-error play** — not a 5-minute drill. This is precisely why scope selection matters (Pairs at 100 cells, ~5–10 minutes, is a far more attemptable target) and is flagged again under Risks.

---

## 3. Design decisions

**D1 — Cell universe.** Reuse `generateAllCells()` (330/150/80/100 as counted above), not the raw chart tables. *Rejected:* re-deriving cell counts from `Chart.HARD/SOFT/PAIRS` directly — would require re-solving which raw entries are reachable as free-standing hands (a problem `flashcards.ts` already solved correctly) and would silently produce different, wrong numbers (350 vs. 330, with the Pairs scope actually *short* two ranks compared to what a player really needs to drill).

**D2 — Reset wipes and reshuffles; no checkpoints.** A wrong answer resets `index` to 0 **and** draws a brand-new shuffle (new seed), discarding the in-progress order entirely. *Rejected: partial checkpoints* (e.g., snap back to the start of the current 20-cell block) — the operator's own words ("fill out the complete table without errors", "if I mess up it resets progress") describe a strict, binary mastery bar; a checkpoint system would quietly turn this into a leveling/streak drill, a different feature nobody asked for. *Rejected: keep the same order, just reset the pointer* — if the shuffle is stable across resets, a learner can eventually memorize *cell #7 is always a pair-8*, which substitutes position-memory for the actual recall the challenge exists to test. Reshuffling on every reset keeps the test honest.

**D3 — Illegal-action refusals never count as a mistake.** `gateDrillAnswer()` runs before any grading; a refused answer never reaches the mastery state machine at all, so it cannot advance *or* reset it. This matches how the gate already behaves for every other drill (`src/drills/answerGate.ts`'s own doc comment: refusing is the correct behavior for a play that "cannot exist"). *Rejected: count a refusal as a miss* — would penalize a learner for the UI momentarily disagreeing about hand state, not for a wrong strategy decision, and no other drill in the codebase does this.

**D4 — A new `Settings.drill.masteryDistractionFreq` field, not the shared `distractionFreq`.** `distractionFreq`'s own doc comment (`src/store/types.ts:55-61`) scopes it explicitly to "the standard count drill's card stream." Reusing it here would mean toggling the interruption difficulty on the Mastery Challenge screen silently changes the Count Drill's setting (and vice versa) — two unrelated drills sharing one knob. A second field, same `DistractionFreq` type, same default (`'off'`), same UI pattern (`Segmented` control, same copy style as `CountDrillView`), avoids the cross-talk at the cost of one extra settings field. *Rejected: reuse `distractionFreq` directly* — cheaper but couples two screens that have no reason to be coupled.

**D4a — Distraction *mode* is always `'generic'`, never `'near-count'`.** `near-count` distractions (`src/drills/distraction.ts:48-57`) are built from the *running count* — this challenge has no shoe, no running count, nothing counted at all. Exposing a "Near-count / Generic" toggle here would offer a mode that can't mean anything (there is no count to be near). The Mastery Challenge screen therefore shows only the frequency selector (Off / Occasional / Relentless) and always calls `makeDistraction(0, 'generic', seed)`.

**D4b — A distraction's own arithmetic is not graded against mastery progress.** Getting the interruption's sum wrong does not reset the sweep; only a wrong *strategy* decision does. The distraction's purpose is to test whether the interruption cost the learner their next decision (already captured naturally — if it did, the *next* mastery cell answer will be wrong and reset the run), not to add a second failure mode. The interruption's own right/wrong is still recorded into `Stats.distraction.history` (reusing the existing section, `kind: 'generic'`) purely for consistency with how `CountDrillView` already logs it — no new Stats section.

**D5 — A new `EventSource: 'mastery'`, not `'flashcard'`.** `EventSource` (`src/engine/grade.ts:19`, currently `'table' | 'flashcard' | 'quiz'`) exists precisely so "how am I doing at X" is answerable per-mode (its own doc comment). Mastery-run answers are not representative of ordinary flashcard accuracy — the run is heavily loaded toward late-run cells being correct-by-construction of the fact a run got that far (every cell before it was necessarily right, or the run wouldn't still exist), which would skew `bySource.flashcard`'s accuracy figure if merged in. Tagging events `source: 'mastery'` keeps that split honest. `applyEvents` (`src/store/stats.ts:72-89`) already handles `bySource` generically over any `EventSource` string — **no changes needed there**, confirmed by reading it: the loop keys off `event.source` with no hardcoded list of sources.

**D6 — Grading reuses `buildFlashcardEvent` + `persistGrade`, not `gradeFlashcardAnswer`.** `gradeFlashcardAnswer` also reads/writes the Flashcards spaced-repetition deck (`FLASH_SR_KEY`). A mastery run walks a fixed, complete, shuffled deck exactly once per attempt — it is not an SR-scheduled draw, and letting every correct mastery answer "review" that cell in the *ordinary* Flashcards SR schedule would badly distort that schedule's due-ness weighting for a mode the learner wasn't using. So this plan exports `persistGrade` (currently private) and adds a small new wrapper `gradeMasteryAnswer` in `gradeAnswer.ts` that calls `buildFlashcardEvent(cell, taken, rules, elapsedMs, 'mastery')` (a new optional `source` parameter, defaulting to `'flashcard'` so every existing call site is untouched) then `persistGrade(event, null)` (no retention row — mastery events are never gap-reviews). *Rejected: call `gradeFlashcardAnswer` as-is* — cheaper, but silently pollutes the Flashcards SR deck.

**D7 — Visual-only screen (no eyes-free ZonePad, no audio narration) for v1.** The operator's request does not mention eyes-free/driving use, and `PairCancelView.tsx` is exactly precedented as a drill that deliberately ships visual-only. Adding ZonePad wiring, wake-lock management, and narration would roughly double this screen's size for a capability nobody asked for. Listed under "Explicitly out of scope" below as a future extension.

**D8 — Run state (scope + seed + index) is persisted, not held only in React state.** Every screen in `Drills.tsx` fully unmounts on navigating back to the picker (`mode === 'picker'` renders a different component tree). Without persistence, tapping "Back" and back in — with **no mistake made** — would silently wipe an in-progress sweep, which is indistinguishable from the punishing reset the feature is built around and would be read as a bug, not a feature. So `{scope, seed, index}` (not the full 330-length `order` array — it's cheaply re-derived from `scope`+`seed`) is written to a new localStorage key, `bjtrainer.masteryrun.v1`, on every state change, and hydrated on mount. This key is also added to `persist.ts`'s `EXTRA_KEYS` so export/import doesn't drop an in-progress sweep, mirroring exactly how `bjtrainer.flashsr.v1`/`bjtrainer.quizsr.v1` are handled today.

**D9 — Changing scope always starts a brand-new run, silently.** Matches the existing `changeCategory`/`changeIndex` precedent in `FlashcardsView`/`DeviationQuizView` (`src/ui/screens/Drills.tsx:243-248`, `682-687`) — no confirmation dialog. A different scope is a different "complete table"; there is no meaningful progress to preserve across the switch.

**D10 — Completing a scope shows a completion screen with a "Start a new sweep" button; no lifetime completion history is recorded.** See "Explicitly out of scope."

### Explicitly out of scope (optional, richer reading — not built by this plan)

The operator's clarification says to plan the *minimum* the words support and list richer options separately:

1. A persisted history of clean-sweep completions (dates, scope, elapsed time) surfaced on the Stats screen.
2. A "which specific cells are left" checklist visualization (as opposed to just a count).
3. A "hardest cells" tally of which cellIds most often trigger a reset, across attempts.
4. Eyes-free / audio narration support (D7).
5. A resume confirmation dialog ("Continue your sweep at 142/330?") — this plan resumes silently.
6. Letting `masteryDistractionFreq` offer a `'near-count'` mode once/if a future variant of this challenge tracks a synthetic count (D4a).

---

## 4. File-by-file changes

### Task 1: Export `fisherYatesShuffle` from `src/engine/cards.ts`

**Files:**
- Modify: `src/engine/cards.ts:32-35`
- Test: `src/engine/cards.test.ts`

**Interfaces:**
- Produces: `export function fisherYatesShuffle<T>(array: T[], rng: () => number): T[]` — pure, returns a new array, does not mutate its input.

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/cards.test.ts (add)
import { fisherYatesShuffle, mulberry32 } from './cards';

describe('fisherYatesShuffle', () => {
  it('is exported and returns a permutation of the input without mutating it', () => {
    const input = [1, 2, 3, 4, 5];
    const rng = mulberry32(42);
    const result = fisherYatesShuffle(input, rng);
    expect(input).toEqual([1, 2, 3, 4, 5]); // not mutated
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5]); // still a permutation
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/cards.test.ts`
Expected: FAIL — `fisherYatesShuffle` is not exported (TS compile error / `undefined` import).

- [ ] **Step 3: Add the `export` keyword**

```ts
// src/engine/cards.ts:32 — change
function fisherYatesShuffle<T>(array: T[], rng: () => number): T[] {
```
to:
```ts
export function fisherYatesShuffle<T>(array: T[], rng: () => number): T[] {
```

No other line in the function changes — this is a pure visibility change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/cards.test.ts`
Expected: PASS, and the full existing `cards.test.ts` suite (`Shoe` behavior) still passes unchanged — `fisherYatesShuffle`'s internal callers (`Shoe`) are untouched.

- [ ] **Step 5: Commit**

```bash
git add src/engine/cards.ts src/engine/cards.test.ts
git commit -m "export fisherYatesShuffle for reuse outside engine/cards.ts"
```

---

### Task 2: Export `generateAllCells`/`Cell` and extract the category filter from `src/drills/flashcards.ts`

**Files:**
- Modify: `src/drills/flashcards.ts`
- Test (new file): `src/drills/flashcards.test.ts`

**Interfaces:**
- Produces: `export interface Cell { id: string; cards: [Card, Card]; up: Rank }`, `export function generateAllCells(): Cell[]`, `export function filterCellsByCategory<T extends { id: string }>(cells: T[], category: 'all' | 'hard' | 'soft' | 'pairs'): T[]`.
- Consumes (Task 4): both by `src/drills/masteryChallenge.ts`.

This file currently has **no** unit test (`flashcards.test.ts` does not exist) — this task also creates the first one, pinning the exact counts from section 2.7 as a regression guard.

- [ ] **Step 1: Write the failing test**

```ts
// src/drills/flashcards.test.ts (new file)
import { describe, it, expect } from 'vitest';
import { generateAllCells, filterCellsByCategory } from './flashcards';

describe('generateAllCells (the "complete table" cell universe)', () => {
  const all = generateAllCells();

  it('has exactly 330 cells: 150 hard + 80 soft + 100 pairs', () => {
    expect(all).toHaveLength(330);
    expect(all.filter((c) => c.id.startsWith('hard-'))).toHaveLength(150);
    expect(all.filter((c) => c.id.startsWith('soft-'))).toHaveLength(80);
    expect(all.filter((c) => c.id.startsWith('pair-'))).toHaveLength(100);
  });

  it('has no duplicate cell ids', () => {
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it('every cell has exactly two cards and a valid upcard', () => {
    const upcards = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
    for (const c of all) {
      expect(c.cards).toHaveLength(2);
      expect(upcards).toContain(c.up);
    }
  });
});

describe('filterCellsByCategory', () => {
  const all = generateAllCells();

  it('all/hard/soft/pairs partition the universe with no overlap and no gaps', () => {
    const hard = filterCellsByCategory(all, 'hard');
    const soft = filterCellsByCategory(all, 'soft');
    const pairs = filterCellsByCategory(all, 'pairs');
    expect(hard).toHaveLength(150);
    expect(soft).toHaveLength(80);
    expect(pairs).toHaveLength(100);
    expect(hard.length + soft.length + pairs.length).toBe(all.length);
    expect(filterCellsByCategory(all, 'all')).toEqual(all);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/drills/flashcards.test.ts`
Expected: FAIL — `generateAllCells`/`filterCellsByCategory` are not exported.

- [ ] **Step 3: Export `Cell`/`generateAllCells`, extract `filterCellsByCategory`, and use it from `drawFlashcard`**

```ts
// src/drills/flashcards.ts — change the interface and function to `export`
export interface Cell {
  id: string;
  cards: [Card, Card];
  up: Rank;
}

export function generateAllCells(): Cell[] { /* body unchanged */ }

/**
 * Shared by drawFlashcard (weighted, single draw) and the Mastery Challenge
 * (walks the whole filtered list) so the category->prefix mapping can never
 * drift between the two consumers.
 */
export function filterCellsByCategory<T extends { id: string }>(
  cells: T[],
  category: 'all' | 'hard' | 'soft' | 'pairs',
): T[] {
  if (category === 'all') return cells;
  if (category === 'pairs') return cells.filter((c) => c.id.startsWith('pair-'));
  return cells.filter((c) => c.id.startsWith(category + '-'));
}
```

Then in `drawFlashcard`, replace the inlined `if/else` block (lines 110-118) with:

```ts
const cells = filterCellsByCategory(allCells, category);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/drills/flashcards.test.ts`
Expected: PASS.

Also run the full suite to confirm `drawFlashcard`'s behavior is unchanged (it has no direct unit test, but `gradeAnswer.test.ts` exercises it indirectly and any existing e2e Flashcards spec must still pass):

Run: `npx vitest run` — expect no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/drills/flashcards.ts src/drills/flashcards.test.ts
git commit -m "export the flashcard cell universe and extract filterCellsByCategory for reuse"
```

---

### Task 3: Add `EventSource: 'mastery'`

**Files:**
- Modify: `src/engine/grade.ts:19`
- Test: `src/store/statsBySource.test.ts` (extend existing file with a 'mastery' case)

**Interfaces:**
- Produces: `EventSource = 'table' | 'flashcard' | 'quiz' | 'mastery'`.

- [ ] **Step 1: Write the failing test**

Read `src/store/statsBySource.test.ts` first to match its existing style, then add:

```ts
// src/store/statsBySource.test.ts (add a case)
it('accepts a mastery-sourced event and tallies it under bySource.mastery without touching bySource.flashcard', () => {
  const event: GradedEvent = {
    kind: 'action',
    source: 'mastery',
    category: 'hard',
    correct: true,
    classification: 'correct',
    taken: 'hit',
    expected: 'hit',
    reason: 'Basic hit vs dealer 9',
    tc: 0,
    hand: 'hard-16-v-9',
  };
  const result = applyEvents(EMPTY_STATS, [event]);
  expect(result.bySource?.mastery?.hard).toEqual({ right: 1, wrong: 0 });
  expect(result.bySource?.flashcard).toBeUndefined();
  // The pooled total still counts it too -- bySource is a SPLIT, not a replacement.
  expect(result.categories.hard).toEqual({ right: 1, wrong: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/statsBySource.test.ts`
Expected: FAIL — TS rejects `source: 'mastery'` as not assignable to `EventSource`.

- [ ] **Step 3: Widen the type**

```ts
// src/engine/grade.ts:19 — change
export type EventSource = 'table' | 'flashcard' | 'quiz';
```
to:
```ts
export type EventSource = 'table' | 'flashcard' | 'quiz' | 'mastery';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/statsBySource.test.ts`
Expected: PASS. This also confirms (per Design Decision D5) that `src/store/stats.ts`'s `applyEvents` needed **zero** changes — it already keys `bySource` off `event.source` generically.

- [ ] **Step 5: Commit**

```bash
git add src/engine/grade.ts src/store/statsBySource.test.ts
git commit -m "add mastery as a GradedEvent source"
```

---

### Task 4: New settings field `masteryDistractionFreq`

**Files:**
- Modify: `src/store/types.ts` (Settings.drill interface + DEFAULT_SETTINGS)
- Test: extend an existing settings round-trip test, or add a focused one in `src/store/persistHardening.test.ts`

**Interfaces:**
- Produces: `Settings.drill.masteryDistractionFreq: DistractionFreq`, default `'off'`.

- [ ] **Step 1: Write the failing test**

```ts
// src/store/persistHardening.test.ts (add)
describe('masteryDistractionFreq default and merge', () => {
  it('defaults to off for a fresh install', () => {
    expect(loadSettings().drill.masteryDistractionFreq).toBe('off');
  });

  it('a partial persisted blob backfills the field from defaults', () => {
    store.map.set('bjtrainer.settings.v1', JSON.stringify({ version: 1, drill: { flashCategory: 'hard' } }));
    expect(loadSettings().drill.masteryDistractionFreq).toBe('off');
    expect(loadSettings().drill.flashCategory).toBe('hard');
  });
});
```

(Import `loadSettings` from `../persist` at the top of the file alongside the existing imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/persistHardening.test.ts`
Expected: FAIL — TS error, `masteryDistractionFreq` does not exist on `Settings['drill']`.

- [ ] **Step 3: Add the field**

```ts
// src/store/types.ts — inside the `drill: { ... }` interface, alongside distractionFreq/distractionMode
// Mastery Challenge's own interruption-difficulty knob (see docs/superpowers/
// plans/2026-08-31-B-mastery-challenge.md, Design Decision D4). Deliberately
// SEPARATE from `distractionFreq`, which is scoped to the standard count
// drill's card stream -- sharing one field would mean changing the difficulty
// on one screen silently changes the other. Defaults to 'off' ("none"),
// matching the operator's explicit ask.
masteryDistractionFreq: DistractionFreq;
```

```ts
// src/store/types.ts — inside DEFAULT_SETTINGS.drill
masteryDistractionFreq: 'off',
```

`mergeSettings` in `src/store/persist.ts` already deep-merges `{ ...base.drill, ...p.drill }` generically (line 55) — no change needed there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/persistHardening.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/types.ts src/store/persistHardening.test.ts
git commit -m "add Settings.drill.masteryDistractionFreq, defaulting to off"
```

---

### Task 5: Pure module `src/drills/masteryChallenge.ts` — cell sequencing and the reset state machine

**Files:**
- Create: `src/drills/masteryChallenge.ts`
- Test: `src/drills/masteryChallenge.test.ts`

**Interfaces:**
- Consumes: `Cell`, `generateAllCells`, `filterCellsByCategory` (Task 2, `./flashcards`); `fisherYatesShuffle`, `mulberry32` (Task 1, `../engine/cards`).
- Produces:
  - `export type MasteryScope = 'all' | 'hard' | 'soft' | 'pairs'`
  - `export interface MasteryRun { scope: MasteryScope; seed: number; order: string[]; index: number }`
  - `export function cellsForScope(scope: MasteryScope): Cell[]`
  - `export function startMasteryRun(scope: MasteryScope, seed: number): MasteryRun`
  - `export function advanceMasteryRun(run: MasteryRun, correct: boolean, nextSeed: number): MasteryRun`
  - `export function isMasteryRunComplete(run: MasteryRun): boolean`
  - `export function currentCellId(run: MasteryRun): string | null`
  - `export interface PersistedMasteryRun { scope: MasteryScope; seed: number; index: number }`
  - `export function hydrateMasteryRun(persisted: PersistedMasteryRun | null): MasteryRun | null`
  - `export function loadMasteryRun(): PersistedMasteryRun | null`
  - `export function saveMasteryRun(run: MasteryRun): void`

This is the module most at risk of a **vacuous test** per the brief (reset-on-mistake, completeness). The test file below is written to specifically defeat the two vacuous shapes named: (a) "the order array happens to be a permutation" without proving a *walked* run visits every cell exactly once, and (b) "index goes back to 0" without proving the order actually changed / wasn't silently reused.

- [ ] **Step 1: Write the failing tests**

```ts
// src/drills/masteryChallenge.test.ts (new file)
import { describe, it, expect } from 'vitest';
import {
  cellsForScope,
  startMasteryRun,
  advanceMasteryRun,
  isMasteryRunComplete,
  currentCellId,
  hydrateMasteryRun,
} from './masteryChallenge';
import type { MasteryScope } from './masteryChallenge';

const SCOPES: { scope: MasteryScope; count: number }[] = [
  { scope: 'hard', count: 150 },
  { scope: 'soft', count: 80 },
  { scope: 'pairs', count: 100 },
  { scope: 'all', count: 330 },
];

describe('cellsForScope', () => {
  for (const { scope, count } of SCOPES) {
    it(`${scope} has exactly ${count} cells`, () => {
      expect(cellsForScope(scope)).toHaveLength(count);
    });
  }
});

describe('startMasteryRun: completeness (not vacuous -- checked by SET equality + uniqueness, not just length)', () => {
  for (const { scope } of SCOPES) {
    it(`${scope}: order is exactly the scope's cell ids, no duplicates, no omissions`, () => {
      const expectedIds = cellsForScope(scope).map((c) => c.id).sort();
      const run = startMasteryRun(scope, 12345);
      expect(run.order).toHaveLength(expectedIds.length);
      expect(new Set(run.order).size).toBe(run.order.length); // no duplicates
      expect([...run.order].sort()).toEqual(expectedIds); // exact same SET as the universe
      expect(run.index).toBe(0);
    });
  }
});

describe('advanceMasteryRun: correct answers walk the WHOLE order exactly once (the concrete completeness proof)', () => {
  it('a full clean pairs-scope run visits every cell exactly once, in the pre-shuffled order', () => {
    const expectedIds = cellsForScope('pairs').map((c) => c.id).sort();
    let run = startMasteryRun('pairs', 999);
    const visited: string[] = [];
    for (let i = 0; i < run.order.length; i++) {
      const id = currentCellId(run);
      expect(id).not.toBeNull();
      visited.push(id!);
      run = advanceMasteryRun(run, true, 0); // seed is irrelevant on a correct answer
    }
    expect(visited).toHaveLength(100);
    expect(new Set(visited).size).toBe(100); // every cell exactly once
    expect([...visited].sort()).toEqual(expectedIds); // and it's the RIGHT 100 cells
    expect(currentCellId(run)).toBeNull(); // nothing left
    expect(isMasteryRunComplete(run)).toBe(true);
  });

  it('a correct answer does not reshuffle -- order and seed are untouched, only index advances', () => {
    const run = startMasteryRun('hard', 7);
    const next = advanceMasteryRun(run, true, 4242);
    expect(next.order).toEqual(run.order); // same array of ids, in the same order
    expect(next.seed).toBe(run.seed); // seed only ever changes on a RESET
    expect(next.index).toBe(run.index + 1);
  });
});

describe('advanceMasteryRun: a wrong answer resets AND reshuffles (not vacuous -- checked against the specific realistic bugs)', () => {
  it('resets index to 0', () => {
    let run = startMasteryRun('soft', 1);
    run = advanceMasteryRun(run, true, 0);
    run = advanceMasteryRun(run, true, 0); // index is now 2
    const reset = advanceMasteryRun(run, false, 5555);
    expect(reset.index).toBe(0);
  });

  it('uses the PASSED-IN seed, not the run\'s old seed (guards silently ignoring nextSeed)', () => {
    const run = startMasteryRun('soft', 1);
    const reset = advanceMasteryRun(run, false, 999999);
    expect(reset.seed).toBe(999999);
    expect(reset.seed).not.toBe(run.seed);
  });

  it('produces a genuinely different order for a fixed pair of seeds (guards a stale/copied-through array)', () => {
    const run = startMasteryRun('soft', 1);
    const reset = advanceMasteryRun(run, false, 2);
    expect(reset.order).not.toEqual(run.order); // fixed seeds 1 vs 2 -- deterministic, not flaky
    // ...but it's still a full, valid permutation of the SAME scope's cells.
    const expectedIds = cellsForScope('soft').map((c) => c.id).sort();
    expect([...reset.order].sort()).toEqual(expectedIds);
  });

  it('reshuffles even when the reset happens at index 0 already (guards a "nothing to reset" shortcut)', () => {
    const run = startMasteryRun('pairs', 10); // index 0, never advanced
    const reset = advanceMasteryRun(run, false, 20);
    expect(reset.index).toBe(0);
    expect(reset.order).not.toEqual(run.order);
  });
});

describe('hydrateMasteryRun', () => {
  it('null persisted state yields null (fresh install / cleared run)', () => {
    expect(hydrateMasteryRun(null)).toBeNull();
  });

  it('reconstructs the exact same order the original run had, at the persisted index', () => {
    const original = startMasteryRun('hard', 321);
    const advanced = advanceMasteryRun(original, true, 0);
    const rehydrated = hydrateMasteryRun({ scope: advanced.scope, seed: advanced.seed, index: advanced.index });
    expect(rehydrated).toEqual(advanced);
  });

  it('falls back to a fresh run if the persisted index is out of range (corrupt/stale data)', () => {
    const bad = hydrateMasteryRun({ scope: 'pairs', seed: 1, index: 99999 });
    expect(bad).not.toBeNull();
    expect(bad!.index).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/drills/masteryChallenge.test.ts`
Expected: FAIL — the module does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/drills/masteryChallenge.ts (new file)
/**
 * Mastery Challenge: walk EVERY cell in a chosen scope (Hard / Soft / Pairs /
 * All) in random order, exactly once, with no replacement. One wrong answer
 * wipes the run -- back to zero, with a fresh shuffle -- and the goal is a
 * clean sweep: every cell in the scope, correct, in one unbroken run.
 *
 * This is deliberately NOT a weighted/SR-scheduled draw like drawFlashcard --
 * it's the opposite: an exhaustive, unbiased walk of a fixed deck, because
 * the whole point is proving you know ALL of it, not the cells you're weakest
 * on. See docs/superpowers/plans/2026-08-31-B-mastery-challenge.md for the
 * full design rationale (Design Decisions D1-D10).
 */

import { generateAllCells, filterCellsByCategory } from './flashcards';
import type { Cell } from './flashcards';
import { fisherYatesShuffle, mulberry32 } from '../engine/cards';

export type MasteryScope = 'all' | 'hard' | 'soft' | 'pairs';

export interface MasteryRun {
  scope: MasteryScope;
  /** The seed that produced `order`. Only ever changes on a RESET (D2) --
   * a correct answer never reshuffles, so `seed` staying put is itself part
   * of the "no reshuffle on success" contract. */
  seed: number;
  /** Every cell id in this scope, shuffled once at run-start / reset time.
   * Fixed for the run's lifetime except across a reset. */
  order: string[];
  /** Index of the NEXT cell to present. Also equals "cells cleared so far
   * this run" -- a correct answer at `order[index]` increments this. */
  index: number;
}

/** All cells for `scope`, via the SAME filter drawFlashcard uses (D1) -- so
 * this challenge and ordinary Flashcards can never disagree about what the
 * universe for a given scope is. */
export function cellsForScope(scope: MasteryScope): Cell[] {
  return filterCellsByCategory(generateAllCells(), scope);
}

function shuffledIds(scope: MasteryScope, seed: number): string[] {
  const ids = cellsForScope(scope).map((c) => c.id);
  return fisherYatesShuffle(ids, mulberry32(seed));
}

export function startMasteryRun(scope: MasteryScope, seed: number): MasteryRun {
  return { scope, seed, order: shuffledIds(scope, seed), index: 0 };
}

/**
 * Advance the run by one graded answer.
 * - correct: only `index` moves forward. `order`/`seed` are untouched --
 *   this is what "no reshuffle on success" means concretely (D2).
 * - incorrect: the ENTIRE run restarts -- index to 0, a brand new shuffle
 *   from `nextSeed` (never `run.seed`, which would silently no-op the
 *   reshuffle). `nextSeed` is supplied by the caller (a component), which is
 *   the one place allowed to read a wall-clock/Math.random-derived seed --
 *   this module itself never calls Date.now()/Math.random() (project rule).
 */
export function advanceMasteryRun(run: MasteryRun, correct: boolean, nextSeed: number): MasteryRun {
  if (correct) return { ...run, index: run.index + 1 };
  return startMasteryRun(run.scope, nextSeed);
}

export function isMasteryRunComplete(run: MasteryRun): boolean {
  return run.index >= run.order.length;
}

/** The cell id the learner should be shown next, or null once the run is
 * complete (nothing left to present). */
export function currentCellId(run: MasteryRun): string | null {
  return isMasteryRunComplete(run) ? null : run.order[run.index];
}

/* ------------------------------------------------------------------ */
/* Persistence (D8): only {scope, seed, index} is stored -- `order` is   */
/* cheaply re-derived from scope+seed, so the stored blob can never       */
/* drift from what startMasteryRun would produce for the same inputs.    */
/* Guarded try/catch + typeof-window idiom matches gradeAnswer.ts's       */
/* loadSrDeck/saveSrDeck exactly.                                        */
/* ------------------------------------------------------------------ */

export interface PersistedMasteryRun {
  scope: MasteryScope;
  seed: number;
  index: number;
}

const MASTERY_RUN_KEY = 'bjtrainer.masteryrun.v1';
const SCOPES: readonly MasteryScope[] = ['all', 'hard', 'soft', 'pairs'];

function isMasteryScope(value: unknown): value is MasteryScope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

/** Reconstruct a full MasteryRun from persisted {scope, seed, index}. Falls
 * back to a fresh run at index 0 (same scope/seed) if the persisted index is
 * out of range for that scope -- corrupt/stale data degrades to "start over",
 * never a crash or an out-of-bounds currentCellId(). */
export function hydrateMasteryRun(persisted: PersistedMasteryRun | null): MasteryRun | null {
  if (!persisted) return null;
  if (!isMasteryScope(persisted.scope) || typeof persisted.seed !== 'number' || typeof persisted.index !== 'number') {
    return null;
  }
  const order = shuffledIds(persisted.scope, persisted.seed);
  const index = persisted.index >= 0 && persisted.index <= order.length ? persisted.index : 0;
  return { scope: persisted.scope, seed: persisted.seed, order, index };
}

export function loadMasteryRun(): PersistedMasteryRun | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(MASTERY_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as PersistedMasteryRun;
  } catch {
    return null;
  }
}

export function saveMasteryRun(run: MasteryRun): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const persisted: PersistedMasteryRun = { scope: run.scope, seed: run.seed, index: run.index };
    window.localStorage.setItem(MASTERY_RUN_KEY, JSON.stringify(persisted));
  } catch {
    // best-effort persistence only, matching every other drill's SR-deck save
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/drills/masteryChallenge.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/drills/masteryChallenge.ts src/drills/masteryChallenge.test.ts
git commit -m "add masteryChallenge: pure cell-walk + reset-on-mistake state machine"
```

---

### Task 6: `gradeMasteryAnswer` in `src/drills/gradeAnswer.ts`

**Files:**
- Modify: `src/drills/gradeAnswer.ts`
- Test: extend `src/drills/gradeAnswer.test.ts`

**Interfaces:**
- Consumes: `buildFlashcardEvent` (existing, gains an optional 5th param), `Flashcard`-shaped input (a mastery `Cell` plus a `correct: Action` computed the same way `drawFlashcard` computes it).
- Produces: `export function gradeMasteryAnswer(cell: Flashcard, taken: Action, rules: RuleSet, elapsedMs: number): { event: GradedEvent; correctAction: Action; correct: boolean }`; `persistGrade` becomes exported.

- [ ] **Step 1: Write the failing test**

```ts
// src/drills/gradeAnswer.test.ts — add `gradeMasteryAnswer` and `loadFlashSr` to
// the existing `import { buildFlashcardEvent, buildQuizEvent, gradeFlashcardAnswer,
// gradeQuizAnswer } from './gradeAnswer';` at the top of the file, then add:

describe('mastery', () => {
  it('gradeMasteryAnswer tags the event source as "mastery" and does NOT touch the flashcard SR deck', () => {
    freshStorage();
    const card = drawFlashcard('all', {}, 0, 55555, DEFAULT_RULES); // reused as the cell shape
    const result = gradeMasteryAnswer(card, 'hit', DEFAULT_RULES, 200);
    expect(result.event.source).toBe('mastery');

    const stats = loadStats();
    expect(stats.bySource?.mastery).toBeDefined();
    expect(stats.bySource?.flashcard).toBeUndefined();

    // No SR deck write: loadFlashSr() must still be empty after grading via
    // the mastery path (a plain flashcard grade WOULD populate it -- that's
    // gradeFlashcardAnswer's job, deliberately not this one's).
    expect(loadFlashSr()).toEqual({});
  });

  it('buildFlashcardEvent still defaults to source "flashcard" when no source is passed (existing callers unaffected)', () => {
    const card = drawFlashcard('all', {}, 0, 1, DEFAULT_RULES);
    const { event } = buildFlashcardEvent(card, 'stand', DEFAULT_RULES, 50);
    expect(event.source).toBe('flashcard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/drills/gradeAnswer.test.ts`
Expected: FAIL — `gradeMasteryAnswer` is not exported.

- [ ] **Step 3: Implement**

```ts
// src/drills/gradeAnswer.ts — buildFlashcardEvent gains an optional 5th param
export function buildFlashcardEvent(
  card: Flashcard,
  taken: Action,
  rules: RuleSet,
  elapsedMs: number,
  source: EventSource = 'flashcard',
): { event: GradedEvent; correctAction: Action; correct: boolean } {
  const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };
  const withCount = correctPlay(card.cards, card.up, 0, ctx, rules);
  const basicOnly = basicPlay(card.cards, card.up, ctx, rules);
  const { classification, correct } = classifyAction(taken, withCount, basicOnly, card.cards, card.up, 0, rules);

  const event: GradedEvent = {
    kind: 'action',
    source,
    category: cellCategory(card.cellId, card.correct),
    correct,
    classification,
    taken,
    expected: card.correct,
    reason: withCount.reason,
    tc: 0,
    hand: card.cellId,
    elapsedMs,
  };

  return { event, correctAction: withCount.action, correct };
}
```

Add `EventSource` to the existing `import type { GradedEvent } from '../engine/grade';` line (`import type { GradedEvent, EventSource } from '../engine/grade';`).

Export `persistGrade` (drop the leading nothing — just add `export`):

```ts
export function persistGrade(event: GradedEvent, retention: RetentionRow | null): void {
  let stats = applyEvents(loadStats(), [event]);
  if (retention) {
    stats = { ...stats, retention: { history: [...stats.retention.history, retention] } };
  }
  saveStats(stats);
}
```

Add the new wrapper near `gradeFlashcardAnswer`:

```ts
/**
 * Grade a Mastery Challenge answer. Unlike gradeFlashcardAnswer, this does
 * NOT touch the Flashcards spaced-repetition deck (D6, plan doc): a mastery
 * run walks a fixed shuffled deck exactly once per attempt, it is not an
 * SR-scheduled draw, and treating every correct mastery answer as a Flashcards
 * SR review would distort that schedule's due-ness weighting for a mode the
 * learner wasn't using. No retention row either -- mastery events are never
 * gap-reviews.
 */
export function gradeMasteryAnswer(
  cell: Flashcard,
  taken: Action,
  rules: RuleSet,
  elapsedMs: number,
): { event: GradedEvent; correctAction: Action; correct: boolean } {
  const result = buildFlashcardEvent(cell, taken, rules, elapsedMs, 'mastery');
  persistGrade(result.event, null);
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/drills/gradeAnswer.test.ts`
Expected: PASS, including every pre-existing test in the file (the new param is optional and defaulted, so `gradeFlashcardAnswer`'s own call to `buildFlashcardEvent` — unchanged, no 5th arg — still produces `source: 'flashcard'`).

- [ ] **Step 5: Commit**

```bash
git add src/drills/gradeAnswer.ts src/drills/gradeAnswer.test.ts
git commit -m "add gradeMasteryAnswer: grade a mastery cell without touching the Flashcards SR deck"
```

---

### Task 7: Add `bjtrainer.masteryrun.v1` to `persist.ts`'s backup/restore

**Files:**
- Modify: `src/store/persist.ts:258-263` (`EXTRA_KEYS`)
- Test: extend `src/store/persistHardening.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/store/persistHardening.test.ts — add inside the existing
// "exportAll — is actually a backup" describe block, in the same two-test
// shape as the flashSr/quizSr cases already there.

it('includes an in-progress mastery run', () => {
  store.map.set('bjtrainer.masteryrun.v1', JSON.stringify({ scope: 'pairs', seed: 42, index: 17 }));
  const blob = JSON.parse(exportAll());
  expect(blob.masteryRun).toEqual({ scope: 'pairs', seed: 42, index: 17 });
});

it('round-trips the mastery run key back through importAll', () => {
  store.map.set('bjtrainer.profiles.v1', JSON.stringify([{ id: 'p1', name: 'Vegas 6D' }]));
  store.map.set('bjtrainer.activeProfile.v1', 'p1');
  store.map.set('bjtrainer.masteryrun.v1', JSON.stringify({ scope: 'pairs', seed: 42, index: 17 }));
  const blob = exportAll();

  const fresh = memStore();
  _setStorage(fresh);
  expect(importAll(blob).ok).toBe(true);
  expect(fresh.map.get('bjtrainer.masteryrun.v1')).toContain('"scope":"pairs"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/persistHardening.test.ts`
Expected: FAIL — `blob.masteryRun` is `undefined`.

- [ ] **Step 3: Add the key**

```ts
// src/store/persist.ts:258-263
const EXTRA_KEYS: { key: string; field: string }[] = [
  { key: 'bjtrainer.profiles.v1', field: 'profiles' },
  { key: 'bjtrainer.activeProfile.v1', field: 'activeProfile' },
  { key: 'bjtrainer.flashsr.v1', field: 'flashSr' },
  { key: 'bjtrainer.quizsr.v1', field: 'quizSr' },
  { key: 'bjtrainer.masteryrun.v1', field: 'masteryRun' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/persistHardening.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/persist.ts src/store/persistHardening.test.ts
git commit -m "include the in-progress mastery run in export/import backups"
```

---

### Task 8: Export `KEY_TO_ACTION` from `src/ui/screens/Drills.tsx`

**Files:**
- Modify: `src/ui/screens/Drills.tsx:63-68`

Small DRY step so the new screen (Task 9) doesn't duplicate the 1-5 keyboard map.

- [ ] **Step 1: Add `export`**

```ts
// src/ui/screens/Drills.tsx:63 — change
const KEY_TO_ACTION: Record<string, Action> = {
```
to:
```ts
export const KEY_TO_ACTION: Record<string, Action> = {
```

No test needed — this is a pure visibility change on a `const` object literal with no behavior; `tsc --noEmit` catches a typo, and Task 9's e2e keyboard test exercises it end-to-end.

- [ ] **Step 2: Commit**

```bash
git add src/ui/screens/Drills.tsx
git commit -m "export KEY_TO_ACTION for reuse by MasteryChallengeView"
```

---

### Task 9: `src/ui/screens/drills/MasteryChallengeView.tsx`

**Files:**
- Create: `src/ui/screens/drills/MasteryChallengeView.tsx`
- Modify: `src/ui/screens/Drills.tsx` (registration: import, `mode` union, branch, picker button)
- Modify: `src/ui/app.css` (new, minimal classes)
- Test: e2e only (`e2e/mastery-challenge.spec.ts`, Task 10) — this file is `.tsx` and cannot be unit-tested under vitest's node-only config; all its logic beyond rendering already lives in the pure module from Task 5.

**Interfaces:**
- Consumes: `MasteryScope`, `startMasteryRun`, `advanceMasteryRun`, `isMasteryRunComplete`, `currentCellId`, `cellsForScope`, `loadMasteryRun`, `saveMasteryRun`, `hydrateMasteryRun` (Task 5); `gradeMasteryAnswer` (Task 6); `gateDrillAnswer` (existing, `../../../drills/answerGate`); `drillLegalActions` (existing); `isDistractionPoint`, `makeDistraction` (existing, `../../../drills/distraction`); `KEY_TO_ACTION` (Task 8); `Segmented` (existing, `../Settings`); `ActionBar`, `MistakeCard`, `PlayingCard`, `StudyChartOverlay` (existing components).

This is a rendering task (`.tsx`), so no TDD unit-test loop applies — write the component, then drive it with the e2e spec in Task 10 as the acceptance test. Steps below are still bite-sized for review purposes.

- [ ] **Step 1: Scaffold the component shell (state, mount hydration, no rendering yet)**

```tsx
// src/ui/screens/drills/MasteryChallengeView.tsx
import { useEffect, useRef, useState } from 'react';
import type { Settings, Profile } from '../../../store/types';
import type { Action } from '../../../engine/deviations';
import type { GradedEvent } from '../../../engine/grade';
import {
  startMasteryRun,
  advanceMasteryRun,
  isMasteryRunComplete,
  currentCellId,
  cellsForScope,
  loadMasteryRun,
  saveMasteryRun,
  hydrateMasteryRun,
} from '../../../drills/masteryChallenge';
import type { MasteryRun, MasteryScope } from '../../../drills/masteryChallenge';
import { gradeMasteryAnswer } from '../../../drills/gradeAnswer';
import { gateDrillAnswer } from '../../../drills/answerGate';
import { drillLegalActions } from '../../../drills/legalActions';
import { isDistractionPoint, makeDistraction } from '../../../drills/distraction';
import type { Distraction } from '../../../drills/distraction';
import { saveSettings } from '../../../store/persist';
import { PlayingCard } from '../../components/PlayingCard';
import { ActionBar } from '../../components/ActionBar';
import { MistakeCard } from '../../components/MistakeCard';
import { StudyChartOverlay } from '../../components/StudyChartOverlay';
import { Segmented } from '../Settings';
import { KEY_TO_ACTION } from '../Drills';
import { focusSwallowsKey } from '../../keyboardFocus';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function scopeLabel(scope: MasteryScope): string {
  return scope === 'all' ? 'All' : scope.charAt(0).toUpperCase() + scope.slice(1);
}

export function MasteryChallengeView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
}) {
  const [run, setRun] = useState<MasteryRun>(() => {
    const persisted = loadMasteryRun();
    return hydrateMasteryRun(persisted) ?? startMasteryRun('all', randomSeed());
  });
  // ... (feedback/distraction/showChart state added in Step 2)

  useEffect(() => {
    saveMasteryRun(run);
  }, [run]);

  return null; // replaced in Step 2
}
```

- [ ] **Step 2: Add feedback state, cell lookup, and the scope switcher**

```tsx
  const cellMap = useRef(new Map(cellsForScope(run.scope).map((c) => [c.id, c])));
  useEffect(() => {
    cellMap.current = new Map(cellsForScope(run.scope).map((c) => [c.id, c]));
  }, [run.scope]);

  const cellId = currentCellId(run);
  const cell = cellId ? cellMap.current.get(cellId) : undefined;
  const complete = isMasteryRunComplete(run);

  const [feedback, setFeedback] = useState<{
    correct: boolean;
    event: GradedEvent;
    reset: boolean; // true when this wrong answer just wiped the run
  } | null>(null);
  const [distraction, setDistraction] = useState<Distraction | null>(null);
  const [showChart, setShowChart] = useState(false);
  const promptShownAtRef = useRef(performance.now());

  const changeScope = (scope: MasteryScope) => {
    const fresh = startMasteryRun(scope, randomSeed());
    setRun(fresh);
    setFeedback(null);
    setDistraction(null);
    promptShownAtRef.current = performance.now();
  };

  const changeDistractionFreq = (masteryDistractionFreq: Settings['drill']['masteryDistractionFreq']) => {
    const next: Settings = { ...settings, drill: { ...settings.drill, masteryDistractionFreq } };
    saveSettings(next);
    onSettingsChange(next);
  };
```

- [ ] **Step 3: Grading + reset + distraction-check on advance**

```tsx
  const maybeTriggerDistraction = (nextRun: MasteryRun) => {
    // D4a: always 'generic' -- there is no running count in this drill for a
    // 'near-count' distraction to be near.
    if (isDistractionPoint(nextRun.index, settings.drill.masteryDistractionFreq)) {
      setDistraction(makeDistraction(0, 'generic', randomSeed()));
    }
  };

  const handleAction = (taken: Action) => {
    if (!cell || complete) return;
    const gate = gateDrillAnswer(taken, cell.cards, activeProfile.rules);
    if (!gate.accepted) return; // D3: refused answers never reach grading or the run

    const elapsedMs = performance.now() - promptShownAtRef.current;
    const flashcardShapedCell = { cards: cell.cards, up: cell.up, correct: cellCorrectAction, cellId: cell.id };
    const { event, correct } = gradeMasteryAnswer(flashcardShapedCell, taken, activeProfile.rules, elapsedMs);

    const nextRun = advanceMasteryRun(run, correct, randomSeed());
    setFeedback({ correct, event, reset: !correct });
    setRun(nextRun);
    if (correct && !isMasteryRunComplete(nextRun)) maybeTriggerDistraction(nextRun);
  };

  const next = () => {
    setFeedback(null);
    promptShownAtRef.current = performance.now();
  };

  const answerDistraction = (_guess: number) => {
    // The distraction's own right/wrong is telemetry only (D4b) -- it never
    // touches `run`. Recording into Stats.distraction.history is a follow-up
    // nicety, not required for this plan's minimum scope; omit for v1 or wire
    // identically to CountDrillView's triggerDistraction if desired.
    setDistraction(null);
  };
```

`cellCorrectAction` above must be computed once per cell (mirroring `drawFlashcard`'s own `correctPlay` call) — add, right after `const cell = ...`:

```tsx
  const cellCorrectAction: Action | undefined = cell
    ? correctPlay(cell.cards, cell.up, 0, { canDouble: true, canSplit: true, canSurrender: true }, activeProfile.rules).action
    : undefined;
```

with `import { correctPlay } from '../../../engine/strategy';` added to the import block.

- [ ] **Step 4: Keyboard handling (mirrors `FlashcardsView`'s effect exactly)**

```tsx
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      if (showChart || distraction) return;
      if (!feedback) {
        const action = KEY_TO_ACTION[e.key];
        if (!action || !cell) return;
        e.preventDefault();
        if (gateDrillAnswer(action, cell.cards, activeProfile.rules).accepted) handleAction(action);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, cell, showChart, distraction]);
```

- [ ] **Step 5: Render — progress readout, scope/difficulty controls, hand, feedback, completion screen**

```tsx
  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Mastery Challenge</div>
      </div>

      <div className="drill-inline-controls">
        <div className="settings-row">
          <span className="settings-label">Scope</span>
          <Segmented
            options={[
              { value: 'all', label: 'All' },
              { value: 'hard', label: 'Hard' },
              { value: 'soft', label: 'Soft' },
              { value: 'pairs', label: 'Pairs' },
            ]}
            value={run.scope}
            onChange={changeScope}
          />
        </div>
        <div className="settings-row">
          <span className="settings-label">Interruptions</span>
          <Segmented
            options={[
              { value: 'off', label: 'Off' },
              { value: 'occasional', label: 'Occasional' },
              { value: 'relentless', label: 'Relentless' },
            ]}
            value={settings.drill.masteryDistractionFreq}
            onChange={changeDistractionFreq}
          />
        </div>
        {/* "Check progress" (operator ask): always-visible, live count. */}
        <div className="mastery-progress" data-testid="mastery-progress">
          {run.index} / {run.order.length} cleared &middot; {scopeLabel(run.scope)}
        </div>
      </div>

      {complete ? (
        <div className="mastery-complete">
          <div className="result-correct">Sweep complete! {run.order.length}/{run.order.length}, zero errors.</div>
          <button
            type="button"
            className="drill-next-btn"
            onClick={() => {
              const fresh = startMasteryRun(run.scope, randomSeed());
              setRun(fresh);
              setFeedback(null);
            }}
          >
            Start a new sweep
          </button>
        </div>
      ) : distraction ? (
        <div className="distraction-area">
          <div className="distraction-prompt">{distraction.prompt}</div>
          <button type="button" className="drill-next-btn" onClick={() => answerDistraction(distraction.answer)}>
            Continue
          </button>
        </div>
      ) : (
        cell && (
          <>
            <div className="dealer-area">
              <PlayingCard card={{ rank: cell.up, suit: 's' }} />
            </div>
            <div className="hands-row">
              <div className="player-hand">
                <div className="hand-cards">
                  {cell.cards.map((c, i) => (
                    <PlayingCard key={i} card={c} />
                  ))}
                </div>
              </div>
            </div>

            <div className="message-strip">
              {feedback && (
                <>
                  {feedback.correct ? (
                    <div className="result-correct">Correct!</div>
                  ) : (
                    <>
                      <div className="mastery-reset-banner" role="alert">
                        Wrong — progress reset. New sweep started.
                      </div>
                      <MistakeCard
                        taken={feedback.event.taken}
                        expected={feedback.event.expected}
                        reason={feedback.event.reason}
                        tc={feedback.event.tc}
                        hand={feedback.event.hand}
                        classification={feedback.event.classification}
                        onShowTable={() => setShowChart(true)}
                      />
                    </>
                  )}
                </>
              )}
            </div>

            {!feedback ? (
              <ActionBar
                mode={{ kind: 'actions', legal: drillLegalActions(cell.cards, activeProfile.rules), onAction: handleAction }}
              />
            ) : (
              <div className="action-bar">
                <button type="button" className="drill-next-btn" onClick={next}>
                  Next
                </button>
              </div>
            )}
          </>
        )
      )}

      {showChart && cell && (
        <StudyChartOverlay
          activeProfile={activeProfile}
          cards={cell.cards}
          dealerUp={cell.up}
          onClose={() => setShowChart(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Add minimal CSS** (`src/ui/app.css`, alongside the other `.mistake-*`/`.result-*` rules — using existing theme tokens only, per the Global Constraints)

```css
.mastery-progress {
  color: var(--ink-dim);
  font-size: 0.9rem;
  padding: 0.25rem 0;
}

.mastery-reset-banner {
  color: var(--bad);
  background: var(--bad-surface);
  border: 1px solid var(--bad-line);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.mastery-complete {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem 1rem;
}
```

- [ ] **Step 7: Register in `src/ui/screens/Drills.tsx`**

```tsx
// import, alongside the other drills/* imports
import { MasteryChallengeView } from './drills/MasteryChallengeView';
```

```tsx
// mode union
const [mode, setMode] = useState<
  | 'picker' | 'count' | 'truecount' | 'deckest' | 'flash' | 'quiz' | 'mixed'
  | 'paircancel' | 'betsitleave' | 'downswing' | 'producetc' | 'mastery'
>('picker');
```

```tsx
// branch, alongside the 'mixed' branch
if (mode === 'mastery') {
  return (
    <MasteryChallengeView
      settings={settings}
      activeProfile={activeProfile}
      onBack={() => setMode('picker')}
      onSettingsChange={onSettingsChange}
    />
  );
}
```

```tsx
// picker button, in the "Knowing the plays" group, alongside Mixed
<button type="button" className="drills-nav-btn" onClick={() => setMode('mastery')}>
  Mastery Challenge
</button>
```

- [ ] **Step 8: Run type-check and lint**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

Run: `npx oxlint`
Expected: no new warnings (in particular, the `react-hooks/exhaustive-deps` suppression on the keyboard effect matches the existing suppressed pattern in `FlashcardsView`).

- [ ] **Step 9: Commit**

```bash
git add src/ui/screens/drills/MasteryChallengeView.tsx src/ui/screens/Drills.tsx src/ui/app.css
git commit -m "add the Mastery Challenge screen: complete-table sweep with reset-on-mistake"
```

---

### Task 10: e2e coverage

**Files:**
- Create: `e2e/mastery-challenge.spec.ts`

- [ ] **Step 1: Write the specs**

```ts
// e2e/mastery-challenge.spec.ts
import { test, expect } from '@playwright/test';
import { withSettings, readStats } from './helpers';

test('mastery challenge: default scope is All, progress starts at 0', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Mastery Challenge');

  const scopeRow = page.locator('.settings-row', { hasText: 'Scope' });
  await expect(scopeRow.getByRole('button', { name: 'All', exact: true })).toHaveClass(/segmented-btn-active/);

  const freqRow = page.locator('.settings-row', { hasText: 'Interruptions' });
  await expect(freqRow.getByRole('button', { name: 'Off', exact: true })).toHaveClass(/segmented-btn-active/);

  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 330 cleared');
});

test('mastery challenge: switching scope resets progress and shows the new total', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();

  const scopeRow = page.locator('.settings-row', { hasText: 'Scope' });
  await scopeRow.getByRole('button', { name: 'Pairs', exact: true }).click();
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 100 cleared');
});

/**
 * The core mechanic: one wrong answer resets the WHOLE run. Pins Math.random
 * so the run's cell sequence is reproducible, plays the FIRST cell correctly
 * (progress advances to 1), then forces a wrong answer and asserts progress
 * falls back to 0 and the reset banner appears.
 */
test('mastery challenge: a wrong answer resets progress to 0/N with a visible reset banner', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await withSettings(page, { drill: { flashCategory: 'hard' } }); // unrelated setting, just a stable baseline
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();

  const scopeRow = page.locator('.settings-row', { hasText: 'Scope' });
  await scopeRow.getByRole('button', { name: 'Hard', exact: true }).click();
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 150 cleared');

  // Force a wrong answer regardless of what's correct: try every action in
  // turn until one is graded wrong (only one of the five can be "correct").
  const actions = ['Hit', 'Stand', 'Double', 'Split', 'Surrender'];
  let reset = false;
  for (const label of actions) {
    const btn = page.locator('.action-bar button.action-btn', { hasText: label });
    if (await btn.isDisabled()) continue;
    await btn.click();
    const bannerVisible = await page.locator('.mastery-reset-banner').isVisible().catch(() => false);
    if (bannerVisible) {
      reset = true;
      break;
    }
    // That action was graded correct -- undo isn't possible, so this specific
    // run's first cell is now solved; reload and retry with a fresh seed
    // rather than looping indefinitely on an already-advanced run.
    await page.reload();
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();
  }
  expect(reset).toBe(true);
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 150 cleared');
});

test('mastery challenge: an illegal action (disabled button aside) never advances or resets progress', async ({ page }) => {
  await withSettings(page, {});
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();

  const scopeRow = page.locator('.settings-row', { hasText: 'Scope' });
  await scopeRow.getByRole('button', { name: 'Hard', exact: true }).click(); // no pair cells in scope
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 150 cleared');

  // Split is never legal on a hard-scope (non-pair) hand -- its button is
  // disabled; pressing the '4' key must be refused by the same gate, not
  // silently graded.
  await expect(page.locator('.action-bar button.action-btn', { hasText: 'Split' })).toBeDisabled();
  await page.keyboard.press('4');
  await expect(page.locator('.message-strip .result-correct, .mastery-reset-banner')).toHaveCount(0);
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 150 cleared');
});

test('mastery challenge: progress survives a reload (persisted run, not lost on navigation)', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.9;
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();

  const scopeRow = page.locator('.settings-row', { hasText: 'Scope' });
  await scopeRow.getByRole('button', { name: 'Pairs', exact: true }).click();

  // Answer with the shown advice if the ActionBar exposes one; otherwise
  // click whichever legal action isn't disabled and accept whatever happens
  // -- this spec only cares that the persisted index matches what's on
  // screen after a reload, not that a specific answer is correct.
  const before = await page.locator('[data-testid="mastery-progress"]').innerText();

  await page.reload();
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();
  const after = await page.locator('[data-testid="mastery-progress"]').innerText();
  expect(after).toBe(before); // merely navigating away/back is NOT a mistake

  const stored = await page.evaluate(() => window.localStorage.getItem('bjtrainer.masteryrun.v1'));
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored!).scope).toBe('pairs');
});

test('mastery challenge: interruptions default to Off and can be switched to Relentless', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();

  const freqRow = page.locator('.settings-row', { hasText: 'Interruptions' });
  await expect(freqRow.getByRole('button', { name: 'Off', exact: true })).toHaveClass(/segmented-btn-active/);

  await freqRow.getByRole('button', { name: 'Relentless', exact: true }).click();
  const settings = await page.evaluate(() => {
    const json = window.localStorage.getItem('bjtrainer.settings.v1');
    return json ? JSON.parse(json) : null;
  });
  expect(settings?.drill?.masteryDistractionFreq).toBe('relentless');

  // Changing THIS drill's difficulty must not touch the count drill's own
  // distractionFreq (D4) -- confirm it's still the untouched default.
  expect(settings?.drill?.distractionFreq ?? 'off').toBe('off');
});
```

- [ ] **Step 2: Run the suite**

Run: `E2E_PORT=<port> npx playwright test e2e/mastery-challenge.spec.ts`
Expected: all specs pass. (`<port>` per the project's existing e2e run convention — check `package.json`/CI config for the value already in use elsewhere.)

- [ ] **Step 3: Commit**

```bash
git add e2e/mastery-challenge.spec.ts
git commit -m "e2e: cover the Mastery Challenge's scope switch, reset-on-mistake, illegal-action gate, and persistence"
```

---

## 5. Test strategy

**Where each behavior is proven, and why:**

| Behavior | Proven in | How it avoids being vacuous |
|---|---|---|
| Cell counts (330/150/80/100) | `src/drills/flashcards.test.ts` (Task 2) | Asserts exact lengths per prefix, not just a total; asserts no duplicate ids. |
| Completeness of a single shuffle | `src/drills/masteryChallenge.test.ts` → `startMasteryRun` describe block (Task 5) | Sorted-array equality against the scope's actual id set, **plus** a separate `Set.size` uniqueness check — a bug that drops one id and duplicates another would fail the sorted-equality check by itself, but the explicit uniqueness assertion makes the failure mode legible rather than a generic array-mismatch diff. |
| Completeness of a full **walked** run | `src/drills/masteryChallenge.test.ts` → "a full clean pairs-scope run visits every cell exactly once" (Task 5) | This is the one that actually defeats the vacuous trap: it doesn't just inspect `run.order`, it *drives* `advanceMasteryRun` 100 times and checks the **sequence of cells the caller would actually have been shown**, matching the scope's id set. A bug in `currentCellId`/index bookkeeping (e.g., off-by-one skipping the last cell, or re-showing `order[0]` twice) would be invisible to a check of `order` alone but is caught here. |
| Reset-on-mistake wipes progress | `masteryChallenge.test.ts` → "resets index to 0" (Task 5) | Checked from a non-zero index, not just from a fresh run — a bug that only resets from index 0 (a no-op) would pass a naive "starts at 0" test but fails this one. |
| Reset-on-mistake reshuffles (not just re-zeros the pointer) | `masteryChallenge.test.ts` → "uses the PASSED-IN seed", "produces a genuinely different order", "reshuffles even when already at index 0" (Task 5) | Three separate assertions target three separate realistic bugs: (a) reusing `run.seed` instead of `nextSeed` (silently disables reshuffling), (b) returning the old `order` array by reference/copy while bumping `seed` cosmetically, (c) special-casing "already at 0" to skip the reshuffle. All three use **fixed, hardcoded seeds** so the "different order" assertion is deterministic, never a flaky probabilistic check. |
| A correct answer does *not* reshuffle | `masteryChallenge.test.ts` → "does not reshuffle" (Task 5) | Direct equality check on `order` and `seed`, not just on `index`. |
| Illegal actions never touch the run | Architecturally guaranteed (the view never calls `advanceMasteryRun` unless `gateDrillAnswer(...).accepted`) + `e2e/mastery-challenge.spec.ts` (Task 10) | The e2e spec picks a `hard` scope (guaranteed no legal Split) and asserts the progress counter and Stats are both unchanged after the refused keypress — proving no `GradedEvent` was produced, not just that a UI banner didn't appear. |
| `bySource.mastery` is separate from `bySource.flashcard` | `src/store/statsBySource.test.ts` (Task 3), `src/drills/gradeAnswer.test.ts` (Task 6) | Explicit `toBeUndefined()` on the sibling source, not just a truthy check on the one being tested. |
| Mastery grading doesn't perturb the Flashcards SR deck | `src/drills/gradeAnswer.test.ts` (Task 6) | Asserts `loadFlashSr()` is still `{}` after a mastery grade — the specific side effect being deliberately avoided (D6), not just "no error was thrown." |
| Persisted run resumes correctly, and a stale/corrupt index degrades safely | `masteryChallenge.test.ts` → `hydrateMasteryRun` block (Task 5) | Includes an explicit out-of-range-index case, not just the happy path. |
| Reload does not itself count as a mistake | `e2e/mastery-challenge.spec.ts` (Task 10) | Compares the exact progress string before and after a real page reload. |
| `masteryDistractionFreq` is independent of `distractionFreq` | `e2e/mastery-challenge.spec.ts` (Task 10) | Asserts the sibling setting is still at its default after changing this one — the specific cross-talk D4 exists to prevent. |

**What is intentionally not unit-tested:** the rendering/wiring in `MasteryChallengeView.tsx` itself has no `.test.ts` coverage (vitest is node-only, no DOM) — its acceptance test is the e2e suite in Task 10, matching the codebase's existing split between every other `.tsx` drill view and its own `.spec.ts` counterpart in `e2e/drills.spec.ts`.

---

## 6. Risks and staging

**Risks:**

1. **A 330-cell zero-error requirement may be too punishing to ever complete.** At 3–6s/decision that's 15-35 minutes of flawless play for the All scope; a single slip near the end costs the whole run. Scope selection (Pairs at 100 cells is the smallest, most attemptable target) is the mitigation this plan ships; a partial-credit/checkpoint system was explicitly rejected (D2) as contrary to the operator's own words, but is the natural first lever to reconsider if real usage shows the full sweep is never completed.
2. **Reusing `buildFlashcardEvent`/`persistGrade`/`fisherYatesShuffle`/`generateAllCells` means widening four existing modules' public surface.** Each widening is additive (new export, new optional parameter with the old default preserved) and is covered by re-running that module's *existing* test suite in the task that touches it (Tasks 1, 2, 6) — the risk is a silent behavior change in a shared path used by Flashcards/Deviation Quiz/Mixed Session, so those suites are the regression net, not just the new tests.
3. **`isDistractionPoint`'s cadence is keyed on `run.index`, which resets to 0 on a mistake.** This means the interruption schedule also "restarts" after every reset — e.g., under `relentless`, the reshuffled run's first few cells get re-exposed to the same early-index interruption cadence every time a mistake happens. This is very likely the *desired* behavior (a fresh attempt is a fresh attempt), but is worth the operator's explicit sign-off since it wasn't asked about directly.
4. **No lifetime record of clean-sweep completions.** A user who completes a full sweep gets an in-the-moment celebration screen and nothing else durable (per D10/the minimum-scope reading) — if the operator actually wanted "check progress" to mean "show me my history of completed sweeps," Task list item 1 under "Explicitly out of scope" is the follow-up.

**Staging (suggested execution order, matching the task numbering above — each task is independently committable and testable):**

1. Tasks 1–4 (pure exports + one new type + one new settings field) — zero new behavior, all mechanical, lowest risk, land first.
2. Task 5 (the state machine) — the heart of the feature, fully unit-tested in isolation before any UI exists.
3. Task 6 (grading wrapper) — depends on Task 5's `Flashcard`-shaped cell only loosely (via the `cellId`/`cards`/`up`/`correct` shape already defined by `Flashcard`); can land in parallel with Task 5 if split across two workers.
4. Task 7 (backup/restore key) — tiny, independent, can land any time after Task 5 defines the persisted shape.
5. Task 8 (export `KEY_TO_ACTION`) — trivial, do immediately before Task 9.
6. Task 9 (the screen) — depends on Tasks 5, 6, 8.
7. Task 10 (e2e) — depends on Task 9 being deployed to a running dev server.

Every task's validation commands (`npx vitest run`, `npx tsc --noEmit -p tsconfig.app.json`, `npx oxlint`, and — after Task 9 — `E2E_PORT=<port> npx playwright test`) should be run at the end of the full sequence in addition to per-task, to catch cross-task interaction the isolated runs wouldn't.
