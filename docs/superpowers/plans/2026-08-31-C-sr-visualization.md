# Spaced-Repetition Status Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the operator a way to *see* — not read as a table — the state of the two Leitner
spaced-repetition decks (`bjtrainer.flashsr.v1`, `bjtrainer.quizsr.v1`) that `src/drills/
spacedRepetition.ts` has been silently scheduling since RV4 shipped. Today there is no view of
this at all beyond one pooled "retained accuracy" percentage that only ever reflects gap reviews
(box ≥ 2) and stays blank for weeks on a fresh install even though the schedulers are already
working.

**Architecture:** One new pure module (`src/drills/srSummary.ts`) turns an `SrDeck` into bucketed
counts — a Leitner box histogram, due-now/due-soon counts, and a lapses ranking — fully
unit-testable under vitest's `environment: 'node'`. One new presentational component
(`src/ui/components/SrStatusPanel.tsx`) renders that summary as a small bar histogram plus two
supporting stats, reused for both decks. `src/ui/screens/Stats.tsx` gains two new sections (one per
deck) in the existing **Progress** tab, built the same way the "Flashcards" section already reads
`stats.bySource` — no new screen, no new navigation.

**Tech stack:** React 19 + TypeScript (strict, `erasableSyntaxOnly`), Vite, vitest
(`environment: 'node'`, `.test.ts` only, no DOM), Playwright e2e.

**Spec:** Operator request (verbatim, restated below) — no separate spec document exists; this plan
**is** the spec, argued from the operator's own words plus the codebase facts gathered below.

**Scope note:** this document is a plan only. No source file is touched by writing it. The three
concrete source edits it calls for in Task 0 (a stale comment) and Tasks 1–5 (new files + Stats.tsx
wiring + CSS) are for whoever executes this plan next — see "Coordination with the concurrent
Mastery Challenge plan" under Risks, which is the one place this plan deliberately avoids touching a
file (`src/drills/flashcards.ts`) that plan `2026-08-31-B-mastery-challenge.md` is already exporting
new symbols from.

## Global Constraints

- No enums, no constructor parameter properties (`erasableSyntaxOnly`).
- vitest only picks up `src/**/*.test.ts`, `environment: 'node'` — no DOM. Any derivation
  (bucketing, due/overdue, lapse ranking) must live in a plain `.ts` module; the actual `<div>`
  bars are only reachable from Playwright e2e.
- No bare `Math.random()`/`Date.now()` inside pure logic — `now` is passed in by the caller
  (`Stats.tsx` already computes one `now = Date.now()` per render at line 131 and threads it
  through every section; the new sections reuse that exact value, not a fresh read).
- Never hardcode a hex colour; use the CSS custom properties in `src/ui/themes.css`.
- Read-only. Nothing this plan builds ever writes to `bjtrainer.flashsr.v1`/`bjtrainer.quizsr.v1`
  — hand-editing a scheduler from its own status view would defeat the point of having one.
- Validation commands: `npx vitest run`, `npx tsc --noEmit -p tsconfig.app.json`,
  `E2E_PORT=<port> npx playwright test`, `npx oxlint`.

---

## 1. Request restated + what exists today

> "I'd also like the ability to view the status of my spaced relation somehow visualized"

Two words matter: **visualized** (a shape to look at, not a table of numbers) and **somehow** (the
shape is unspecified — choosing and justifying it is this plan's job).

### 1.1 What "spaced repetition" means in this codebase

`src/drills/spacedRepetition.ts` is a pure, wall-clock Leitner scheduler (RV4; spec at
`docs/superpowers/specs/2026-07-30-rv4-spaced-repetition-design.md`, whose own status line reads
"✅ SHIPPED 2026-07-30 (all 6 stages)"). Each item — a flashcard `cellId` or a deviation-quiz
`DeviationId` — lives in one of six boxes (`box: 0..MAX_BOX`, `MAX_BOX = 5`), with
`BOX_INTERVALS_MS = [0, 1, 3, 7, 14, 30]` days. A correct answer promotes one box and pushes
`dueAt` out to that box's interval; a miss collapses to box 0 (and increments `lapses` only if the
item had already reached `LEARNED_BOX = 2`, i.e. survived a real gap once already).

**The header comment on this file is now false and should be corrected as part of this plan
(Task 0).** Lines 16–19 currently read:

```ts
 * STAGE 1 of the staged delivery: this pure module + its tests only. The grade-
 * path/draw-path/persistence/Stats wiring (which includes the schema-migration
 * open question) is deliberately NOT wired here — it awaits operator review of
 * the spec.
```

That was true when the comment was written (stage 1 of 6). It is not true now: `src/drills/
gradeAnswer.ts` calls `reviewCard`/`isGapReview` on every flashcard and quiz grade
(`gradeAnswer.ts:221–241`, `:257–279`), `src/drills/flashcards.ts` and `src/drills/deviationQuiz.ts`
both weight their draws with `srWeight` (`flashcards.ts:120–124`, `deviationQuiz.ts:341–347`), two
localStorage decks exist (`FLASH_SR_KEY = 'bjtrainer.flashsr.v1'`, `QUIZ_SR_KEY =
'bjtrainer.quizsr.v1'`), and `Stats.tsx` already renders a Retention section fed by
`stats.retention.history`. Every stage the comment says "awaits operator review" shipped over a
month ago per the spec's own status line. Leaving the comment as-is actively misleads the next
person who opens the file into thinking the scheduler is inert.

### 1.2 What the operator can see today

`src/ui/screens/Stats.tsx:616–641`, the "Retention" section (Progress tab):

```tsx
<section className="stats-section" data-tab={SECTION_TAB['Retention']}>
  <h2 className="stats-section-title">Retention</h2>
  {retentionReviews === 0 ? (
    <p className="stats-detail">
      No spaced reviews yet — retention accrues as items come due again after a real gap
      (come back tomorrow).
    </p>
  ) : (
    <>
      <p className="stats-detail">
        Accuracy on items recalled after a spaced gap — the honest read on what will still be
        there at the table, distinct from in-drill accuracy.
      </p>
      <ul className="mistake-list">
        <li className="mistake-row"><span>Spaced reviews</span><span>{retentionReviews}</span></li>
        <li className="mistake-row"><span>Retained accuracy</span><span>{pct(retentionCorrect, retentionReviews)}</span></li>
      </ul>
    </>
  )}
</section>
```

Fed by `stats.retention.history`, which `Stats.tsx:242–244` filters to the active time range and
reduces to two numbers. What this **does** tell the operator: out of the reviews that happened
after a real multi-day gap on an already-learned item, what fraction were still answered correctly.
What it **does not** tell them, and cannot be made to by filtering or re-labelling:

- **Nothing about the two SR decks' actual contents.** `retention.history` is a log of *events*
  (one row per gap review), not a snapshot of the deck. It has no `box` distribution, no `dueAt`,
  no per-item lapse count — `reviewCard`'s own state (`SrCard.box`, `.lapses`, `.dueAt`,
  `.reviews`) is written to `bjtrainer.flashsr.v1`/`bjtrainer.quizsr.v1` and never read back by
  Stats at all.
- **Nothing until a gap review has happened at least once.** `retentionRow()`
  (`gradeAnswer.ts:87–89`) is only ever pushed when `isGapReview(prev, now)` is true — box ≥ 2 *and*
  the interval has elapsed. A brand-new install, or even a week of daily drilling, can have
  dozens of items already sitting in boxes 1–3 with real `dueAt` timestamps and this section will
  still read "No spaced reviews yet." The scheduler is working; the only view of it is silent.
- **Nothing split by deck.** Flashcards (`cellId`, up to 330 possible keys) and the deviation quiz
  (`DeviationId`, 18 keys) are pooled into one `retentionReviews`/`retentionCorrect` pair — a
  learner cannot tell whether a bad number came from flashcards or the quiz.
- **No "what's due" and no "what keeps coming back."** The operator has no way to answer "is there
  a pile of overdue material," or "which specific item am I forgetting over and over" (the
  `lapses` field exists per-card and is never surfaced anywhere).

So: the scheduler decides what the operator sees on every drill draw, and today there is exactly
one lagging, pooled, event-count aggregate of it — nothing that answers "what does my scheduler
currently think my mastery looks like."

---

## 2. The visualization recommended

**Primary: a per-deck Leitner box histogram** — one small bar chart per deck (Flashcards,
Deviation quiz), each bar one box (0 through 5) plus a seventh "Unseen" bar for material never
reviewed at all, bar height/colour = count, count also printed as a number on every bar. Directly
under each histogram: two small stat lines, "Due now" / "Due soon" (next 24h), and a short "Most
often forgotten" list (top items by `lapses`, hidden entirely when nobody has any).

```
 Spaced repetition — Flashcards
 ─────────────────────────────────────────────
 187 of 330 cells studied

  Unseen   Box 0   Box 1   Box 2   Box 3   Box 4   Box 5
  ┌────┐   ┌──┐    ┌───┐   ┌────┐  ┌─────┐ ┌───┐  ┌──┐
  │143 │   │22│    │31 │   │48  │  │61   │ │19 │  │6 │
  └────┘   └──┘    └───┘   └────┘  └─────┘ └───┘  └──┘

  Due now: 12    Due soon (24h): 27

  Most often forgotten
   hard-16-v-9      4 lapses  (box 0)
   soft-18-v-A      3 lapses  (box 1)
   pair-8-v-10      2 lapses  (box 3)

 Spaced repetition — Deviation quiz
 ─────────────────────────────────────────────
 11 of 18 indices studied
  Unseen  Box 0  Box 1  Box 2  Box 3  Box 4  Box 5
  ┌──┐    ┌─┐    ┌──┐   ┌──┐   ┌───┐  ┌─┐    ┌─┐
  │7 │    │2│    │3 │   │2 │   │3  │  │0│    │1│
  └──┘    └─┘    └──┘   └──┘   └───┘  └─┘    └─┘
  Due now: 1    Due soon (24h): 2
  (no repeated lapses yet)
```

Bars are ordinary `<div>`s scaled by CSS custom-property height/width against the row's own max —
the same technique the existing `.category-bar-track`/`.category-bar-fill` pair already uses in
this file for the per-category accuracy bars two sections up (`Stats.tsx:405–407`), not a new
charting dependency (the project has none — `package.json` lists only `react`/`react-dom` as
runtime dependencies).

### Why this, and not the alternatives

**Rejected: a per-cell overlay painted onto the actual strategy chart (`Charts.tsx`).** This was
the brief's own suggested option, and it is a genuinely good *complementary* view for one specific
question ("which exact cell is weak") — but it is the wrong **primary** view, for three concrete
reasons specific to this codebase:

1. It only half-covers the problem. `highlightForHand`/`chartRows.ts` map a *hand* to *one* chart
   cell; the reverse direction this needs (a `cellId` string like `"hard-16-v-9"` back to a
   `{section, row, dealerUp}`) does not exist and would have to be written. Worse, the **deviation
   quiz deck has no chart mapping at all for its `insurance`-kind entries** (`ins`,
   `src/engine/deviations.ts:41`) — there is no cell "vs dealer" for insurance, no row, no column.
   A chart overlay can show the flashcard deck's status and silently cannot show roughly a third
   of the quiz deck (7 of 18 entries — every deviation whose `kind` isn't `'hard'`/`'pair10'`, plus
   any where the pair/hard cell doesn't cleanly separate mastery-of-the-index from
   mastery-of-basic-strategy on the same cell). Building one primary view that structurally can't
   represent one of the two decks it's supposed to summarize is a bad foundation.
2. It would fight the chart's existing colour encoding. `Charts.tsx`/`charts.css` already colour
   every cell by **action** (`--act-hit`, `--act-stand`, `--act-double`, …) — that's load-bearing,
   ungradeable-without-it information. Painting a *second*, unrelated meaning (mastery box) onto
   the same cells means either two colour channels fighting on one surface, or replacing the
   action colouring while viewing mastery (in which case you can no longer see what the correct
   play even is on the cell you're checking mastery of) — a real design conflict, not a cosmetic
   one.
3. It answers a narrower question than the one asked. The operator asked for "the status of my
   spaced repetition" — a health check on the whole scheduler — not "show me where on the table my
   weak spots are." A histogram answers "how healthy is this deck" in one glance, at any deck size,
   for both decks identically. A 330-cell chart requires scanning the whole table to form the same
   impression, and for the 18-entry quiz deck a full chart-sized overlay is enormous overkill for
   18 numbers.

   Kept as a real, worthwhile v2 idea (recorded here so it isn't lost, matching the "explicitly out
   of scope" convention the sibling Mastery Challenge plan uses): once a `cellId → ChartHighlight`
   reverse mapping exists, a "study mode" toggle on `Charts.tsx` that dims the action-legend and
   tints each flashcard-mapped cell by its box (using the same six-stop ramp introduced below,
   Design Decision D6) would be a strong *drill-down* from "Box 0 has 22 cells in it, which ones?"
   — but it is a second, later feature, not a replacement for a primary summary that has to work
   for both decks.

**Rejected: a raw due-list table (every card, its box, its `dueAt`).** This is exactly the "table
of numbers" the operator's own wording ("somehow **visualized**") asked not to build, and at 330
possible flashcard keys it would be unreadable — nobody scans a 330-row table to get a mastery
impression. A ranked *top-5* list (the "Most often forgotten" panel) keeps the useful, actionable
part of a table (which specific items need attention) without the unreadable bulk.

**Rejected: a time-series/sparkline of retention accuracy.** This is the existing Retention
section's natural graphical upgrade, and still worth having eventually, but it doesn't answer "what
does my scheduler currently think" — it's a lagging log of *event outcomes*, sparse and bursty by
construction (zero gap reviews for days, then a cluster the day several items come due at once), so
a line chart of it reads as noise more than signal at the timescales most sessions will actually
show. It also inherits the existing section's core gap: nothing to show until a gap review has ever
happened. The box histogram is a snapshot of *current state*, available from the very first answer.

**Rejected: a single pooled histogram across both decks.** See Design Decision D1 below — the two
decks have incomparable universe sizes (330 vs 18) and summing their box counts produces a number
that means nothing (e.g. "14 items in box 3" mixing two different reference frames).

---

## 3. Design decisions

**D1 — Two panels, one per deck, never merged.** Flashcards (`FLASH_SR_KEY`, up to 330 possible
keys — 15 hard totals + 8 soft totals + 10 pair ranks, × 10 upcards, per `flashcards.ts`'s own
header comment) and the deviation quiz (`QUIZ_SR_KEY`, exactly `ILLUSTRIOUS_18.length` = 18 keys,
stable across H17/S17 — `src/engine/deviations.ts:5–23`) are structurally different domains at
wildly different scales. Summing their per-box counts into one histogram would produce numbers with
no coherent denominator ("31 items in box 2" — out of 330? out of 18? out of 348?). Two clearly
labelled panels keep every number interpretable at a glance, and matches the existing precedent of
`Stats.tsx`'s own "Flashcards" section being deck-specific rather than pooled with table play
(`bySource.flashcard` vs `stats.categories`, `Stats.tsx:415–424`'s own comment explains exactly this
reasoning for a parallel case).

**D2 — "Due" before anything has ever been reviewed.** `isDue(card, now)` (`spacedRepetition.ts:
95–98`) already returns `true` for `card === undefined` — by the *scheduler's* own contract, unseen
material is always "due" (that's what makes `srWeight` draw it preferentially, `SR_NEW_WEIGHT = 8`,
the highest weight in the system). This plan deliberately does **not** carry that definition
through to the display layer unchanged. If it did, a fresh install's "Due now" figure would read
**330** on day one — technically consistent with `isDue`, but meaningless as a status readout (it
would never *not* say "everything is due" until the whole deck had been touched once). So the
summary distinguishes:
  - **Unseen** — no entry in the `SrDeck` at all (never graded once). Its own bucket, never counted
    in "Due now."
  - **Due now** — an entry *exists* (it has been reviewed at least once) and `isDue(card, now)` is
    true: a genuine "come back to this" scheduled review, not first-contact material.
  - **Due soon** — an entry exists, is not yet due, but `dueAt` falls within the next 24h
    (`DUE_SOON_MS`, a documented tunable constant exactly like `OVERDUE_CAP_DAYS` already is in
    `spacedRepetition.ts`).

  This changes nothing about the scheduler or the draw path — `isDue`/`srWeight` are untouched, and
  new/unseen material is still drawn preferentially exactly as it is today. It is a display-only
  reclassification, made explicit here because it is exactly the kind of confusable definition
  match that would otherwise produce a technically-correct-but-useless number.

**D3 — Empty-deck rendering.** This is the very first thing a fresh-install operator sees when they
open this panel, so getting it wrong reads as "the feature is broken," not "you haven't studied
yet." An empty deck (`Object.keys(deck).length === 0`) renders:
  - Headline: `"No flashcards studied yet — status will appear as you drill."` /
    `"No deviation-quiz items studied yet — status will appear as you drill."` — matching the
    existing "No X yet" idiom used verbatim ten-plus times elsewhere in this same file (e.g.
    `Stats.tsx:436`, `:516`, `:565`, `:593`, `:619`, `:646`, `:668`).
  - **No seven empty bars.** A row of seven zero-height bars reads as "something is broken/missing,"
    not "nothing yet." Instead the histogram is not rendered at all in the empty state — same
    pattern the "Flashcards" accuracy section already uses (`Stats.tsx:434–438`: `answered === 0`
    short-circuits to the one-line message before any bar markup is built).
  - "Due now"/"Due soon"/"Most often forgotten" lines are also suppressed in the empty state rather
    than printed as "0" / "—" three times over, for the same reason.

**D4 — Behaviour as the deck grows large.** At the flashcard deck's ceiling (330 keys, every cell
ever graded at least once), a single box could in principle hold most of the 330 (e.g. everything
freshly promoted to box 1 after a first pass). Two things are pinned so this stays legible instead
of becoming either an unreadable numeric wall or a set of bars that all look identical because one
dwarfs the rest:
  - Each row's seven bars are scaled against **that row's own maximum**, not a fixed 0–330 axis —
    so a deck that's mostly box 3 still shows visible relative differences among the other boxes,
    rather than every non-dominant bar collapsing to a sliver.
  - Every bar's **count is printed as text inside/beside it**, never colour- or height-only —
    matching the exact principle `ACTION_LEGEND`'s own doc comment states for the strategy chart
    ("the letters stay in every cell precisely because colour alone cannot carry these,"
    `chartRows.ts:88–90`). This also means the panel is not resting any of its meaning on the
    six-box colour ramp reading correctly for a colour-blind viewer.
  - "Most often forgotten" is capped at **top 5** by `lapses` (ties broken by key, for determinism),
    with an explicit `"+N more"` suffix when more than 5 items have `lapses > 0` — never an
    unbounded list.

**D5 — Universe-size sourcing avoids touching `flashcards.ts`.** The histogram needs to know the
*addressable* universe (330 for flashcards, 18 for quiz) to compute the "Unseen" bucket
(`unseen = universeSize - Object.keys(deck).length`). `src/drills/flashcards.ts`'s private
`generateAllCells()` is the only function that actually enumerates the 330 — but as of this
writing, the concurrent plan `docs/superpowers/plans/2026-08-31-B-mastery-challenge.md` (Task 2) is
independently exporting `generateAllCells`/`Cell`/`filterCellsByCategory` from that exact file, and
this plan was told explicitly not to touch `src/` while another agent works there. Rather than
create a merge collision on the same file for the sake of one integer, this plan hardcodes
`FLASHCARD_UNIVERSE_SIZE = 330` directly in the new `srSummary.ts` module, with a comment
cross-referencing `flashcards.ts`'s own header doc ("Universe size: (15 hard + 8 soft + 10 pair) x
10 upcards = 330 cells") as the source of truth for that number, and `ILLUSTRIOUS_18.length` (no
conflict — already exported from `src/engine/deviations.ts`, untouched by the sibling plan) for the
quiz deck. **Flagged as a deliberate, documented risk under "Risks" below**: if the flashcard cell
universe's shape ever changes, this constant must be updated by hand; once `generateAllCells` is
exported (by the sibling plan or otherwise), a follow-up should replace the hardcoded constant with
`generateAllCells().length` for a single source of truth.

**D6 — The six-box colour ramp is authored, not computed on the fly, and never colour-only.** Per
this operator's own standing colour guidance (colour-blending-pitfalls memory), naively
interpolating the existing `--bad` → `--good` tokens in sRGB passes through a desaturated grey at
the midpoint, and interpolating in HSL fixes the grey but muddies the mid-tones (a red-to-green
arc sags through olive/brown, which is exactly wrong for a "getting better" ramp meant to read as
increasingly reassuring, not increasingly murky). So this plan authors **six explicit stops per
theme** (`--sr-box-0` … `--sr-box-5`, 24 new custom properties across the four themes in
`src/ui/themes.css`) computed by OKLab-interpolating each theme's own `--bad` and `--good`
endpoints, applied as **opaque** fills (not a translucent tint over `--surface`, which would average
toward mud on an opposing hue exactly as the same memory note describes) — see Task 4 for the
concrete generation method. Every value must be visually verified by rendering all four themes side
by side before being called done (per this operator's verify-visual-work-visually standing
guidance) — this is precisely the class of defect (`Charts.tsx` shadowing `--surface`/`--ink` with
literal hex, going dark green under the light theme) that has already shipped once on this exact
screen family.

**D7 — Read-only, always.** `SrStatusPanel` takes a pre-computed `SrDeckSummary` as a prop and
renders it; it has no event handlers that touch `localStorage`, no "reset this card," no
"mark reviewed." The scheduler is the single source of truth for its own state; this view only
ever reads `loadFlashSr()`/`loadQuizSr()` (already exported from `gradeAnswer.ts`), the same way
every other Stats section reads `loadStats()`.

---

## 4. File-by-file changes

### Task 0: Correct the stale header comment in `spacedRepetition.ts`

**Files:** Modify `src/drills/spacedRepetition.ts:1–20` only (comment text, zero logic change).

- [ ] Replace the "STAGE 1 of the staged delivery... awaits operator review of the spec" paragraph
  (lines 16–19) with an accurate status, e.g.:

  ```ts
   * SHIPPED (RV4, all 6 stages, 2026-07-30 — see the spec doc's own status
   * line). The grade path (src/drills/gradeAnswer.ts), the draw path
   * (src/drills/flashcards.ts, src/drills/deviationQuiz.ts), persistence
   * (bjtrainer.flashsr.v1 / bjtrainer.quizsr.v1) and the Stats "Retention"
   * section are all wired against this module today. This comment used to say
   * otherwise while stage 1 of 6 was the only piece built; it no longer is.
  ```

- [ ] No test — this is a doc-only change; `tsc --noEmit` and the full existing `spacedRepetition.
  test.ts` suite passing unchanged is the whole verification.
- [ ] Commit separately from Tasks 1–5 (a one-line-intent commit, easy to review in isolation):
  `git commit -m "correct spacedRepetition.ts's stale 'not yet wired' header comment"`.

---

### Task 1: Pure module `src/drills/srSummary.ts`

**Files:** Create `src/drills/srSummary.ts`; create `src/drills/srSummary.test.ts`.

**Interfaces produced:**

```ts
import type { SrCard, SrDeck } from './spacedRepetition';
import { isDue, MAX_BOX } from './spacedRepetition';

/** See Design Decision D5: hardcoded rather than imported from flashcards.ts
 * to avoid a merge collision with the concurrent Mastery Challenge plan,
 * which is exporting generateAllCells() from that same file. Cross-check:
 * flashcards.ts's own header comment states "(15 hard + 8 soft + 10 pair) x
 * 10 upcards = 330 cells." Replace with a live generateAllCells().length
 * once that export exists, so this number can never silently drift. */
export const FLASHCARD_UNIVERSE_SIZE = 330;

/** How far ahead "due soon" looks — a display-only window, independent of
 * any scheduling constant in spacedRepetition.ts. */
export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

/** How many "most often forgotten" rows to surface (Design Decision D4). */
export const MOST_LAPSED_LIMIT = 5;

export interface LapsedEntry {
  key: string;
  box: number;
  lapses: number;
  reviews: number;
}

export interface SrDeckSummary {
  universeSize: number;
  /** Never reviewed at all: universeSize - reviewed count. Never negative
   * (see the defensive test in Task 1 Step 1 for a deck larger than its
   * declared universe -- a stale/corrupt blob, floored at 0). */
  unseen: number;
  /** Reviewed items per Leitner box, index 0..MAX_BOX (length MAX_BOX+1). */
  byBox: number[];
  /** Reviewed items that are due right now (Design Decision D2 -- excludes unseen). */
  dueNow: number;
  /** Reviewed items due within DUE_SOON_MS but not yet due. */
  dueSoon: number;
  /** Days overdue on the single most-overdue reviewed item, or null if
   * nothing in the deck is currently overdue. */
  maxOverdueDays: number | null;
  /** Top MOST_LAPSED_LIMIT reviewed items by lapses desc (ties broken by
   * key asc, for determinism), lapses > 0 only. */
  mostLapsed: LapsedEntry[];
  /** How many additional items have lapses > 0 beyond the ones listed --
   * feeds the "+N more" suffix (Design Decision D4). 0 when mostLapsed
   * already contains every lapsed item. */
  moreLapsedCount: number;
}

export function summarizeSrDeck(deck: SrDeck, universeSize: number, now: number): SrDeckSummary {
  /* ... implementation below ... */
}
```

**Implementation sketch** (single pass over `Object.entries(deck)`, no `Date.now()`/`Math.random()`
anywhere in the module):

```ts
export function summarizeSrDeck(deck: SrDeck, universeSize: number, now: number): SrDeckSummary {
  const entries = Object.entries(deck);
  const byBox = new Array(MAX_BOX + 1).fill(0) as number[];
  let dueNow = 0;
  let dueSoon = 0;
  let maxOverdueDays: number | null = null;
  const lapsed: LapsedEntry[] = [];

  for (const [key, card] of entries) {
    byBox[card.box] = (byBox[card.box] ?? 0) + 1;
    if (isDue(card, now)) {
      dueNow += 1;
      const overdueDays = (now - card.dueAt) / (24 * 60 * 60 * 1000);
      if (maxOverdueDays === null || overdueDays > maxOverdueDays) maxOverdueDays = overdueDays;
    } else if (card.dueAt - now <= DUE_SOON_MS) {
      dueSoon += 1;
    }
    if (card.lapses > 0) lapsed.push({ key, box: card.box, lapses: card.lapses, reviews: card.reviews });
  }

  lapsed.sort((a, b) => (b.lapses !== a.lapses ? b.lapses - a.lapses : a.key.localeCompare(b.key)));

  return {
    universeSize,
    unseen: Math.max(0, universeSize - entries.length),
    byBox,
    dueNow,
    dueSoon,
    maxOverdueDays,
    mostLapsed: lapsed.slice(0, MOST_LAPSED_LIMIT),
    moreLapsedCount: Math.max(0, lapsed.length - MOST_LAPSED_LIMIT),
  };
}
```

- [ ] **Step 1: Write the failing tests** (`src/drills/srSummary.test.ts`) — see full list and the
  "how this could pass on broken code" reasoning for each under **Test strategy**, section 5 below;
  the file should include at minimum:
  - empty-deck invariants (`unseen === universeSize`, all-zero `byBox`, `dueNow`/`dueSoon` 0,
    `mostLapsed` empty).
  - exact `byBox` bucketing for a hand-built deck spanning boxes 0–5, distinguishing "box 0" from
    "unseen" (both are 0-cost-so-far states but must not be conflated — this is the single easiest
    mistake to make in this module).
  - `dueNow`/`dueSoon` boundary correctness at `now === dueAt` (must match `isDue`'s own
    documented flip point, `spacedRepetition.ts:95–98`) and at `dueAt - now === DUE_SOON_MS`
    exactly, using the same fixed-`T0`-plus-`DAY`-constant idiom `spacedRepetition.test.ts` already
    uses (`T0 = 1_000_000_000_000`), never a real clock read.
  - `maxOverdueDays` computed from a card overdue by a non-round amount (e.g. 2.5 days) to catch a
    silent integer-truncation bug.
  - `mostLapsed` ranking: descending by lapses, deterministic tie-break by key, `lapses === 0`
    items excluded, `MOST_LAPSED_LIMIT` truncation with a correct `moreLapsedCount`.
  - a defensive test: `universeSize` smaller than `Object.keys(deck).length` (a stale blob from a
    shrunk universe) never produces a negative `unseen`.
  - a positive control proving the function actually uses its `now` parameter: call it twice with
    the same deck and two different `now` values far enough apart to cross a `dueAt`, and assert
    `dueNow` changes — guards against an implementation that reads `Date.now()` internally instead
    of its `now` argument and would otherwise pass every other test by coincidence in a
    single-process test run.

- [ ] **Step 2:** `npx vitest run src/drills/srSummary.test.ts` — expect FAIL (module doesn't exist).
- [ ] **Step 3:** Write the implementation above.
- [ ] **Step 4:** `npx vitest run src/drills/srSummary.test.ts` — expect PASS, all cases.
- [ ] **Step 5:** Commit: `git commit -m "add srSummary: pure Leitner-box/due/lapses summary of an SrDeck"`.

---

### Task 2: Presentational component `src/ui/components/SrStatusPanel.tsx`

**Files:** Create `src/ui/components/SrStatusPanel.tsx`. No unit test (TSX/DOM — vitest's
`environment: 'node'` cannot render it; covered by e2e in Task 5).

**Interface:**

```tsx
import type { SrDeckSummary } from '../../drills/srSummary';

export interface SrStatusPanelProps {
  /** e.g. "Flashcards" / "Deviation quiz" -- used in both the heading and the empty-state copy. */
  deckLabel: string;
  summary: SrDeckSummary;
  /** Renders a lapsed item's raw key as something readable -- "hard-16-v-9" as-is
   * for flashcards (already legible), or a deviation's own label ("16 v 10:
   * stand at TC >= 0") looked up via indexSetFor(rules) for the quiz deck. */
  labelForKey: (key: string) => string;
}

export function SrStatusPanel({ deckLabel, summary, labelForKey }: SrStatusPanelProps) { /* ... */ }
```

Rendering rules (Design Decisions D3/D4/D6):
- `Object.values(deck).length === 0` (equivalently `summary.unseen === summary.universeSize` **and**
  every `byBox` entry is 0) → single-line empty state, no bars, no due/lapses lines (D3).
- Otherwise: a headline (`"{reviewed} of {universeSize} studied"`), a 7-column bar row (Unseen +
  Box 0..5) each bar's height set via an inline `style={{ '--sr-bar-pct': ... }}` scaled against
  *that row's own max* (D4), each bar carrying its count as visible text (never colour-only, D4),
  and coloured via `data-box={0..5}` / `data-unseen` attributes that CSS keys off the new
  `--sr-box-*` tokens (D6) — same `data-action`-driven pattern `Charts.tsx`/`charts.css` already use
  for cell colouring (`charts.css:381` on), not inline hex.
- "Due now: N · Due soon (24h): M" — omitted (not printed as "0") when both are 0 in a non-empty
  deck, same "don't print a zero that means nothing" instinct as D3.
- "Most often forgotten" list — omitted entirely (not "(no repeated lapses yet)" as a permanent
  fixture, but as the literal empty-state copy, matching the sketch in section 2) when
  `mostLapsed.length === 0`; otherwise up to 5 rows plus a `"+N more"` trailing line when
  `moreLapsedCount > 0`.

- [ ] Write the component per the rules above.
- [ ] Commit: `git commit -m "add SrStatusPanel: renders an SrDeckSummary as a box histogram"`.

---

### Task 3: Wire into `src/ui/screens/Stats.tsx`

**Files:** Modify `Stats.tsx` only.

- [ ] Add imports:
  ```ts
  import { summarizeSrDeck, FLASHCARD_UNIVERSE_SIZE } from '../../drills/srSummary';
  import { loadFlashSr, loadQuizSr } from '../../drills/gradeAnswer';
  import { indexSetFor } from '../../engine/deviations'; // already imported for the Illustrious 18 table
  import { SrStatusPanel } from '../components/SrStatusPanel';
  ```
- [ ] Compute both summaries alongside the existing retention block (`Stats.tsx:236–244`), reusing
  the **same `now`** already captured once per render at line 131 (never a second `Date.now()`
  read — the whole point of that existing convention is that every section agrees on one instant):
  ```ts
  const flashSrSummary = summarizeSrDeck(loadFlashSr(), FLASHCARD_UNIVERSE_SIZE, now);
  const quizSrSummary = summarizeSrDeck(loadQuizSr(), ILLUSTRIOUS_18.length, now);
  const quizLabelFor = (key: string) =>
    indexSetFor(activeProfile.rules).find((d) => d.id === key)?.label ?? key;
  ```
  (`ILLUSTRIOUS_18` needs importing from `../../engine/deviations` alongside `indexSetFor`, or use
  `indexSetFor(activeProfile.rules).length` directly, which is always 18 regardless of ruleset —
  the latter avoids a second import and documents the "always 18" invariant at the call site.)
- [ ] Add two `SECTION_TAB` entries (`Stats.tsx:103–118`), both `'progress'` — same tab as the
  existing Retention section, since this is the same "longitudinal scheduler health" family, not
  raw accuracy:
  ```ts
  'Spaced repetition — Flashcards': 'progress',
  'Spaced repetition — Deviation quiz': 'progress',
  ```
- [ ] Render both panels as new `<section className="stats-section" data-tab={...}>` blocks,
  placed immediately before the existing Retention section (`Stats.tsx:616`) — status-of-the-
  scheduler reads naturally right before the retention-accuracy number it feeds:
  ```tsx
  <section className="stats-section" data-tab={SECTION_TAB['Spaced repetition — Flashcards']}>
    <h2 className="stats-section-title">Spaced repetition — Flashcards</h2>
    <SrStatusPanel deckLabel="flashcards" summary={flashSrSummary} labelForKey={(k) => k} />
  </section>
  <section className="stats-section" data-tab={SECTION_TAB['Spaced repetition — Deviation quiz']}>
    <h2 className="stats-section-title">Spaced repetition — Deviation quiz</h2>
    <SrStatusPanel deckLabel="deviation-quiz items" summary={quizSrSummary} labelForKey={quizLabelFor} />
  </section>
  ```
- [ ] Commit: `git commit -m "add spaced-repetition status panels to Stats' Progress tab"`.

---

### Task 4: Styling — `src/ui/app.css` + `src/ui/themes.css`

**Files:** Modify `src/ui/app.css` (new layout classes); modify `src/ui/themes.css` (24 new tokens,
6 per theme × 4 themes).

- [ ] In `app.css`, add classes for the histogram row/bars/labels, following the existing
  `.category-bar-track`/`.category-bar-fill` idiom (`app.css:1332–1343`) rather than inventing a new
  visual language: `.sr-panel`, `.sr-headline`, `.sr-bar-row` (flex row, 7 columns), `.sr-bar-col`,
  `.sr-bar-track` (fixed-height column, `background: var(--bg-sunken)`, matching
  `.category-bar-track`'s own ground), `.sr-bar-fill[data-box]`/`.sr-bar-fill[data-unseen]` (colour
  driven by the new tokens below, height driven by an inline custom property), `.sr-bar-count`,
  `.sr-bar-label`, `.sr-meta-row`, `.sr-lapses-list`, `.sr-lapses-row`. No literal colour value
  anywhere in this task's `app.css` additions — every colour reference is `var(--...)`.
- [ ] In `themes.css`, add to **all four** theme blocks (Midnight Felt, Bone & Ink, AMOLED Night,
  and the fourth theme — grep the file for its four `:root[data-theme='...']` blocks to get the
  exact names and their current `--bad`/`--good` values):
  ```css
  --sr-box-0: /* OKLab stop 0/5 between this theme's --bad and --good */;
  --sr-box-1: /* stop 1/5 */;
  --sr-box-2: /* stop 2/5 */;
  --sr-box-3: /* stop 3/5 */;
  --sr-box-4: /* stop 4/5 */;
  --sr-box-5: /* OKLab stop 5/5 -- should render very close to --good itself */;
  ```
  **Generation method (Design Decision D6):** write a throwaway, dependency-free Node script (OKLab
  ↔ sRGB conversion is ~40 lines of standard matrix math — no npm package needed, and the project
  intentionally has none beyond react/react-dom) that reads each theme's `--bad`/`--good` hex,
  converts both to OKLab, linearly interpolates 6 evenly-spaced stops, converts each back to sRGB
  hex, and prints them per theme. Paste the six values into each theme block, then delete the
  script — it is an authoring tool, not a build dependency. **Do not eyeball the interpolation by
  hand** (this is exactly the sRGB/HSL trap the colour-blending-pitfalls guidance describes) and
  **do not skip the visual check**: render all four themes with a deck that has at least one item
  in every box, screenshot each, and confirm the six stops read as a legible "getting better"
  progression with no grey/muddy midpoint band and adequate contrast against `--bg-sunken`
  (especially in Bone & Ink, the one light theme) before calling this task done.
- [ ] Confirm with `npx oxlint` that no new hardcoded hex literal was introduced in `app.css`
  outside `themes.css` (the project's whole reason for having `themes.css` as a single source of
  truth — see that file's own header comment, `themes.css:1–19`, for the 311-hardcoded-hex history
  this rule exists to prevent).
- [ ] Commit: `git commit -m "add sr-box-0..5 theme tokens and the histogram bar styles"`.

---

### Task 5: e2e coverage

**Files:** New `e2e/sr-status.spec.ts` (or extend `e2e/flashcard-stats.spec.ts` — either is fine;
a new file keeps this feature's regression surface separately greppable, matching how
`e2e/charts-return.spec.ts` sits alongside `e2e/charts.spec.ts` for a related-but-distinct concern).

No clock-injection hook exists (or is needed) for this: every call site threads `Date.now()`
directly (`Drills.tsx:150`, `:290`, `:587`, `:676`, `:738`, etc.) and this project's existing e2e
suite already manipulates the two SR-deck localStorage keys directly rather than trying to control
wall-clock time in the browser (`e2e/drills.spec.ts:437`, `:798`, `:813`, `:857` all
`localStorage.removeItem('bjtrainer.flashsr.v1'/'bjtrainer.quizsr.v1')`). This plan follows that
exact precedent: seed `bjtrainer.flashsr.v1`/`bjtrainer.quizsr.v1` with a hand-built `SrDeck` JSON
blob via `page.evaluate(() => localStorage.setItem(...))` before navigating to Stats, rather than
inventing new clock-injection machinery. Exact boundary correctness (e.g. `dueAt === now` to the
millisecond) is the unit tests' job (Task 1); e2e only has to prove the wiring reads and renders
real deck contents correctly — a card with `dueAt` a day in the past is unambiguously "due" for
this purpose regardless of the exact moment the test runs.

- [ ] `withProfile` + fresh install → open Stats → Progress tab → both new sections show their
  empty-state copy and print no bars (assert the empty-state text is present AND that the
  bar-row markup is *absent*, `expect(page.locator('.sr-bar-row')).toHaveCount(0)` scoped to that
  section — proving the histogram-suppression rule in D3 actually fired, not just that the
  headline text happens to match).
- [ ] Seed `bjtrainer.flashsr.v1` with one entry at box 3 (`dueAt` in the past) before navigating;
  assert the Flashcards panel's box-3 bar reads count 1, every other populated box reads 0, and
  "Due now" reads at least 1 (not asserting an exact deck size beyond the one seeded key, since
  a real profile's default seat/theme setup writes nothing else into that key).
- [ ] Seed an entry with `lapses: 3`; assert its key (or, for the quiz deck, its resolved label
  text) appears in the "Most often forgotten" list.
- [ ] Seed six or more distinct lapsed entries; assert the list caps at 5 rows and a "+N more" line
  is present with the correct count — this directly tests the D4 large-deck truncation rule, which
  is otherwise easy to leave untested since the unit test for it (Task 1) only proves the *pure*
  truncation logic, not that the component actually applies `MOST_LAPSED_LIMIT` rather than
  rendering every row.
- [ ] Answer one real flashcard end-to-end (reusing `answerOneFlashcard` from
  `e2e/flashcard-stats.spec.ts`) with a freshly cleared `bjtrainer.flashsr.v1`, then confirm the
  Flashcards panel shows exactly one reviewed item (in box 0 or box 1 depending on correctness) —
  this is the one test in the file that proves the *whole* pipeline (grade path → deck write →
  Stats read) rather than a pre-seeded fixture, guarding against the panel silently reading a
  different key than `gradeFlashcardAnswer` actually writes.
- [ ] Theme-follows check, mirroring the existing regression pattern at `e2e/themes.spec.ts:62–87`
  (written after the Charts screen shipped a real "shadows `--surface`/`--ink` under the light
  theme" bug): under `bone-ink` (the one light theme), assert the new panel's background/ink
  computed styles read as light-ground/dark-ink, not the inherited dark defaults — this is the
  concrete test that would have caught this exact repo's prior real bug, applied to the new markup.

---

## 5. Test strategy

| Derived number | Unit test | How it could fail | Time-dependence handling |
|---|---|---|---|
| `unseen` | Deck with `k` entries against `universeSize = n` → `unseen === n - k`; also `n < k` → `unseen === 0` (floor) | Off-by-one confusing "box 0" (a seen-but-reset item) with "unseen" (never in the deck at all) — the single easiest mistake in this module; the box-bucketing test below is what actually discriminates this, since a bug that double-counts box-0 items as unseen would still pass a naive `unseen === n - k` test if it also miscounts `k` the same way. Both tests must be run together, not either alone. | None — no clock involved. |
| `byBox` | Hand-built deck with one entry in each of boxes 0–5 → exact 6-element array | A bug that sums to the right *total* but misplaces one box (e.g. off-by-one indexing) would pass a test that only checks `byBox.reduce(sum) === deck size`; the test must assert **each index individually**, not just the sum — flagged explicitly because "assert the sum" is the natural first draft and is a non-discriminating test for this exact bug class. | None. |
| `dueNow` / `dueSoon` | Cards at `now === dueAt` (must be `dueNow`, matching `isDue`'s own flip point), `dueAt - now === DUE_SOON_MS - 1` (must be `dueSoon`) and `=== DUE_SOON_MS` (boundary — pick one side deliberately and pin it, matching how `spacedRepetition.test.ts` pins `isDue`'s own boundary at `T0 + DAY` in `spacedRepetition.test.ts:88–91`) | An implementation using `<` where the spec means `<=` (or vice versa) at the `DUE_SOON_MS` edge only shows up if the test uses the *exact* boundary value, not a value comfortably inside or outside the window — a test using `now + 1000` and `now + DUE_SOON_MS * 2` would pass either way and prove nothing about the boundary itself. | Fixed `T0` constant, `now` passed explicitly — never `Date.now()` inside the module or the test. |
| `maxOverdueDays` | A card overdue by a non-round amount (e.g. 2.5 days: `dueAt = T0`, `now = T0 + 2.5 * DAY`) | A truncating implementation (`Math.floor` where the display wants a fractional day, or vice versa) is invisible if every test uses whole-day offsets — the fractional case is required specifically to catch this. | Same fixed-clock idiom. |
| `mostLapsed` ordering | Multiple entries with distinct AND tied lapse counts; assert exact order including the tie-break | A test with all-distinct lapse counts cannot detect a missing/wrong tie-break rule — ties must be constructed deliberately, not left to chance. | None. |
| `mostLapsed` truncation / `moreLapsedCount` | 7 lapsed entries, `MOST_LAPSED_LIMIT = 5` → exactly 5 returned, `moreLapsedCount === 2` | A test with exactly `MOST_LAPSED_LIMIT` or fewer entries can never distinguish "truncates correctly" from "doesn't truncate at all" (both produce the same output) — the input must exceed the limit. | None. |
| Whole-module "actually uses `now`" | Call `summarizeSrDeck` twice with the same deck, `now` values on either side of a `dueAt` | **This is the test that guards against the single most dangerous non-discriminating-test shape here**: if the implementation quietly reads `Date.now()` instead of its `now` parameter, every other test above (which all pin `now` to a fixed `T0`) would *still pass*, because within one fast test run `Date.now()` barely moves and every fixed-`T0`-relative assertion still happens to hold by coincidence. Only a test that runs the SAME deck through two deliberately far-apart `now` values and asserts the OUTPUT actually differs can catch this. | This is the boundary-crossing check itself. |
| `SrStatusPanel` empty-state suppression (D3) | e2e: assert bar-row markup count is 0 in the empty state, not just that empty-state text is present | A component that renders both the empty-state paragraph *and* a row of seven zero-height bars would pass a test that only checks for the paragraph's presence — the negative assertion (bars absent) is what actually proves D3's suppression rule fired. | N/A — DOM-level, e2e only (vitest has no DOM per this project's config). |
| `SrStatusPanel` box colouring follows theme (D6) | e2e, mirroring `e2e/themes.spec.ts:62–87`'s exact pattern: computed style under `bone-ink` reads light-ground/dark-ink | A panel that hardcodes `--sr-box-*` fallback colours instead of reading them from the active theme block would look identical under Midnight Felt (the default theme, and the one every screenshot taken "by eye" during development would show) and only reveal itself under a *different* theme — this is verbatim the failure mode that shipped once already on `Charts.tsx`. | N/A. |

General rule applied throughout: **every pure-module test in this plan pins `now` via an explicit
parameter using the same `T0`/`DAY` constant idiom `spacedRepetition.test.ts` already
establishes** (`spacedRepetition.test.ts:16–17`) — no test in `srSummary.test.ts` reads the real
clock, and the one "actually uses `now`" test above is the deliberate check that the module isn't
secretly doing so either.

---

## 6. Risks and staging

### Risks

- **Coordination with the concurrent Mastery Challenge plan (`2026-08-31-B-mastery-challenge.md`).**
  That plan is independently exporting `generateAllCells`/`Cell`/`filterCellsByCategory` from
  `src/drills/flashcards.ts` (its own Task 2). This plan deliberately avoids touching that file at
  all (Design Decision D5) specifically to prevent a merge collision while both plans may be
  executed close together. **Whoever executes this plan should check, at execution time, whether
  `generateAllCells` has already been exported** — if it has, prefer `generateAllCells().length`
  over the hardcoded `FLASHCARD_UNIVERSE_SIZE = 330` for a single source of truth, and note in the
  commit message that the hardcoded fallback was superseded. If it hasn't landed yet, ship with the
  hardcoded constant as specified — it is correct today and cheap to swap later.
- **The six-box colour ramp is the one piece of this plan requiring actual visual judgment**, not
  just correct code. A mechanically-generated OKLab interpolation can still fail to read as legible
  progression if the theme's `--bad`/`--good` endpoints are close in lightness (the AMOLED Night
  and Midnight Felt `--good`/`--bad` pairs should be checked specifically for this) — budget time
  for the render-and-look step in Task 4, not just the script that generates the hex values.
  Skipping it is exactly how the prior real bug on this screen family (`Charts.tsx` shadowing theme
  tokens) went unnoticed by a green test suite.
- **`localStorage` growth is not addressed by this plan and is out of scope.** At 330 possible
  flashcard keys the deck JSON blob is bounded (each `SrCard` is five small numbers; 330 of them is
  a few KB at most) — this plan does not need, and does not add, any pruning/eviction logic. Noted
  so it isn't mistaken for an oversight.
- **This is a read-only reporting feature layered on an already-shipped, already-tested scheduler.**
  The actual scheduling risk surface (promotion/demotion correctness, weight ordering) is
  unaffected by anything in this plan and remains covered by the existing `spacedRepetition.test.ts`
  suite (15 tests, unchanged by this work).

### Explicitly out of scope (richer options, not built by this plan)

1. The chart-cell overlay drill-down discussed and rejected as a *primary* view in section 2 — a
   real v2 candidate once a `cellId → ChartHighlight` reverse mapping exists.
2. A time-series view of box-distribution *change* over time (e.g. "you cleared 40 items from box 0
   this week") — the current histogram is a snapshot only; a trend would need a new persisted
   history stream, not just a read of the live deck.
3. Any interaction with the panel (filtering, sorting toggles, expanding "+N more") beyond the
   fixed top-5 lapses list — kept static and simple for v1.
4. Exporting/importing the SR-status view's own settings (there are none — this panel has no
   configurable state).

### Staging (each stage committed green: `tsc -b` + `vitest run` + targeted e2e)

1. Task 0 — header-comment correction. Trivial, isolated, safe to land alone at any time.
2. Task 1 — `srSummary.ts` + its unit tests. Fully isolated pure module; no UI changes yet. **Safe
   checkpoint** (matches the RV4 spec's own staging convention of a pure-module-first checkpoint).
3. Task 2 — `SrStatusPanel.tsx`. No unit test possible (DOM); verify only via `tsc --noEmit` at
   this stage (not yet wired into any screen, so no visual verification is possible or needed yet).
4. Task 3 — wire into `Stats.tsx`. First point at which this is visible in the running app; a good
   moment to `npx playwright test` the *existing* Stats/flashcard-stats specs to confirm nothing in
   the existing Progress tab regressed before adding new e2e coverage.
5. Task 4 — CSS + theme tokens. Do the visual verification pass (render all 4 themes, screenshot,
   look) before considering this stage done, per the Risks note above.
6. Task 5 — e2e coverage. Full `E2E_PORT=<port> npx playwright test` run.
7. Final validation across the whole plan: `npx vitest run`, `npx tsc --noEmit -p tsconfig.app.json`,
   `E2E_PORT=<port> npx playwright test`, `npx oxlint` — all green before considering this plan
   complete.

---

## REVIEWER OVERRIDE (2026-08-31) — D5: import the cell count, do not hardcode it

**This plan's D5 decision to hardcode `330` is overruled. Import
`generateAllCells()` from `src/drills/flashcards.ts` and derive the number.**

The rationale for hardcoding was avoiding a merge collision with the
concurrent Mastery Challenge plan (B), which exports that function. That is
not a real conflict, it is an ORDERING dependency, and the order is already
known: B is implementing now and lands FIRST. By the time this stream is
built, the export exists.

The reason this matters more than the convenience: `330` is not decoration,
it is the DENOMINATOR of this panel's headline figure ("187 of 330 cells
studied") and of the Unseen bucket. If the cell universe ever changes -- a
new hand type, a rules variant that makes different hands reachable, a fix to
`makeHardHand` -- the constant silently goes stale and every percentage on
the screen is quietly wrong, with no test failing, because the test would be
asserting against the same frozen number.

This codebase has already paid for that mistake once: the C1 token refactor
existed precisely because 55 duplicated colour literals had drifted apart
with nothing to catch it.

**Concrete change:** delete the hardcoded constant and its comment; call
`generateAllCells()` (filtered to the relevant scope) for the universe size.
Add a test asserting the SR panel's denominator equals the live cell count
rather than a literal, so the two can never diverge again.

**Sequencing:** this stream must be implemented AFTER B has landed. If for
any reason B has not landed, block rather than hardcode.
