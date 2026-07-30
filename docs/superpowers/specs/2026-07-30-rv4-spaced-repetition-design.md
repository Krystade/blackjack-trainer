# RV4 · Spaced repetition + retention measurement — design

Status: **STAGE 1 BUILT (pure core, reversible); STAGES 2–6 AWAIT OPERATOR REVIEW.**
The operator said "start with RV4 now" + picked both design forks, so Stage 1 — the pure,
zero-dependency `spacedRepetition.ts` scheduler + 15 unit tests (`src/drills/spacedRepetition.ts`,
`.test.ts`) — is built (nothing imports it yet, fully reversible). The wiring/schema/**migration**
stages (2–6) are HELD pending operator review of the open migration question + the tunable
constants, since those touch the shared grade path across 3 views and persistence.
Date: 2026-07-30. Source: backlog RV4 (red-team v2). Operator decisions (2026-07-29):
**wall-clock Leitner (true SR)** for the time model, and **include the delayed-retention
measurement now** (one increment).

## Problem

Today's R3 scheduler (`src/drills/weightedDraw.ts`) weights each item by outstanding
**miss count** only (`missWeight = 1 + 2·missCount`; `bumpMiss`/`decayMiss`). It has **no time
term**: an item missed once stays weighted-up until answered correctly, regardless of when; a
mastered item is never deliberately resurfaced after a gap. So in-drill accuracy overstates
table-day competence — you can look "done" in a massed session and have forgotten it by the
weekend. There is also no measurement that separates *retained* accuracy (correct after a real
gap) from *massed* accuracy (correct three seconds after last seeing it).

Applies to the shared weighting used by **flashcards** (keyed by `cellId`), the **deviation
quiz** (keyed by `DeviationId`), and the **Mixed** mode — all three must keep grading/scheduling
through one path (the R4 DRY guarantee), no drift.

## Approach (chosen)

Replace miss-count weighting with a **wall-clock Leitner scheduler**: each item lives in a box
whose interval grows as you get it right and collapses when you miss, with a real `dueAt`
timestamp. The card drill preferentially draws **due** items. A **retention** telemetry stream
records how you do on items reviewed after a genuine gap, surfaced on Stats separately from raw
accuracy.

Time is injected (a `now: number` epoch-ms parameter threaded from the calling component, exactly
as `elapsedMs` already is for R1), so all scheduling math stays pure and deterministic — tests
pass explicit clocks; nothing reads `Date.now()` inside a pure module.

### Data model (`src/drills/spacedRepetition.ts`, new)

```ts
export interface SrCard {
  box: number;        // Leitner box 0..MAX_BOX; higher = longer interval / more mastered
  dueAt: number;      // epoch ms the item is next due
  lastSeenAt: number; // epoch ms of last review (gap detection)
  lapses: number;     // times missed AFTER being promoted past box 0 (retention failures)
  reviews: number;    // total reviews (telemetry)
}
export type SrDeck = Record<string, SrCard>; // keyed by cellId (flash) or DeviationId (quiz)
```

`BOX_INTERVALS_MS = [0, 1d, 3d, 7d, 14d, 30d]`, `MAX_BOX = 5`, `LEARNED_BOX = 2`
(box ≥ 2 ⇒ the item survived at least one real inter-day gap → eligible to count toward
retention). Intervals are the standard expanding Leitner ladder; documented as defaults, tunable.

### Scheduling (pure, in `spacedRepetition.ts`)

- `reviewCard(card: SrCard | undefined, correct: boolean, now: number): SrCard`
  - new (`undefined`): start box 0.
  - correct: `box = min(box+1, MAX_BOX)`; `dueAt = now + BOX_INTERVALS_MS[box]`.
  - miss: if `box >= LEARNED_BOX` → `lapses++` (a genuine retention failure); `box = 0`;
    `dueAt = now + BOX_INTERVALS_MS[0]` (due again this session).
  - always: `lastSeenAt = now`, `reviews++`.
- `srWeight(card: SrCard | undefined, now: number): number` — draw weight:
  - new/undefined → high constant (unseen items should surface): `SR_NEW_WEIGHT` (e.g. 8).
  - due (`now >= dueAt`) → `1 + min(overdueDays, OVERDUE_CAP) + (MAX_BOX - box)` (more overdue and
    lower-box ⇒ heavier).
  - not due → `SR_NOT_DUE_FLOOR` (e.g. 0.25) so scheduled-ahead items appear only rarely, never
    starving the drill when little is due.
- `isDue(card, now)` / `isGapReview(card, now)` (`box >= LEARNED_BOX && now >= dueAt`) helpers.

The existing `weightedIndex(rng, weights[])` selection is **kept unchanged** — only the per-item
weight source swaps from `missWeight(missCount)` to `srWeight(card, now)`. This is the minimal
integration: `drawFlashcard` / `drawQuizItem` already build a parallel weights array over their
candidate cells/indices; they now build it from the `SrDeck` + `now`.

### Grade path (`src/drills/gradeAnswer.ts`)

The shared `gradeFlashcardAnswer` / `gradeQuizAnswer` wrappers (the R4 single-source grade path)
gain a `now` param and, in place of `bumpMiss`/`decayMiss`, call `reviewCard` to produce the
next `SrCard`, persist the updated `SrDeck`, and — when the just-graded item was a **gap review**
(`isGapReview` was true at draw time) — append a retention event. Byte-identical event/stats
output for the non-SR fields is preserved; an anti-drift unit test pins it (same pattern as R4).

### Draw path (`flashcards.ts` / `deviationQuiz.ts`)

`drawFlashcard(category, srDeck, now, seed, rules)` and `drawQuizItem(seed, filter, rules,
distractorPct, srDeck, now)` compute `srWeight` per candidate and select via `weightedIndex`.
(Signatures change from the old `weights: Record<string,number>`; all three views + the mixed
view update their call sites — the same set touched in R4.)

### Retention telemetry + Stats

New migration-safe `Stats.retention` section:
```ts
retention: { history: { date: string; key: string; box: number; gapMs: number; correct: boolean }[] }
```
Written only for gap reviews (box ≥ LEARNED_BOX, reviewed after its interval elapsed). Stats gets
a **"Retention"** section: retained accuracy (correct/total over gap reviews) + count, stated
explicitly as distinct from in-drill accuracy. `EMPTY_STATS` + `mergeStats` backfill it (same idiom
as `pairCancel`).

### Persistence + migration

New localStorage keys `bjtrainer.flashsr.v1` / `bjtrainer.quizsr.v1` (`SrDeck` JSON). The old
`bjtrainer.flashweights.v1` / `quizweights.v1` (miss-count) are **abandoned, not migrated** — a
fresh SR start. Rationale: the old value is only a recency-of-error hint with no time data, so
carrying it forward buys little and complicates the schema; a clean start is one session of
re-warming at worst. (Documented so it's a deliberate choice, not a silent data loss.)

## Isolation / testing

- `spacedRepetition.ts` is pure (all clock via `now` param) → exhaustive unit tests:
  promote/demote ladder, dueAt math per box, lapses only past LEARNED_BOX, `srWeight` ordering
  (new > overdue-low-box > due > not-due), `isGapReview` boundaries, retention accuracy over a
  seeded review sequence with an injected advancing clock.
- Anti-drift test: mixed-view vs standalone grade produce identical GradedEvent/stats/SrCard for
  the same inputs (extends the R4 guard).
- e2e: a flashcard/quiz session still drills to a graded result; Stats shows a Retention section
  after gap reviews (seed the clock via the existing `?e2e=1` hook / an injected now).

## Staged delivery (each stage committed green: `tsc -b` + unit + targeted e2e)

1. ✅ DONE — `spacedRepetition.ts` + 15 unit tests (pure module; no wiring). **Safe checkpoint.**
2. `Stats.retention` type + EMPTY_STATS + mergeStats + store round-trip test.
3. Grade path: `gradeAnswer.ts` → `reviewCard` + retention write + `now`; anti-drift test.
4. Draw path: `drawFlashcard`/`drawQuizItem` → `srWeight`; update the 3 views' call sites.
5. Stats "Retention" section (display) + e2e.
6. Backlog + memory update.

## Out of scope (explicit)

- No per-item "next due in N days" UI surfacing (internal scheduling only) — could be a later nicety.
- No tuning UI for box intervals (documented defaults; change in code if needed).
- Wall-clock means true retention only accrues across real days of use — expected and correct.

## Open question for the operator

Fresh-start migration (abandon old miss-weights) vs. best-effort carry-forward (old miss-count →
`lapses`, box 0, due now)? Spec assumes **fresh start** for schema cleanliness; easy to switch.
