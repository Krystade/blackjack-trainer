# v2 Cycle 1 — Payouts, Drill Controls, Variable Rules, Game Profiles, CVCX Import

**Date:** 2026-07-16
**Status:** Approved (design sections approved interactively)
**Builds on:** `2026-07-13-blackjack-trainer-design.md` (v1 — all of it remains true unless amended here)

v2 ships in three cycles. This spec covers cycle 1 only. Cycle 2 = multi-hand play +
simulated table players (with configurable mistake rate). Cycle 3 = app-wide audio,
phased: narration/chimes first, then eyes-free audio drill modes (tap-zone answers via
`speechSynthesis`; voice input explicitly deferred). Cycles 2–3 get their own specs.

## 1. Correct payouts (bug fix, ships first)

Insurance is currently graded but never settles money. Fix in `src/engine/game.ts`:

- Taking insurance stakes `bet / 2` additional units.
- Dealer blackjack: insurance pays 2:1 (net round outcome for a non-BJ player hand:
  −bet (main) + bet (insurance net) = 0 → the classic even-money wash; player-BJ +
  insurance = +bet net).
- No dealer blackjack: the half-bet is lost immediately (bankroll −bet/2) and the round
  continues.
- `PlayerHand.net` / round events remain per-hand; insurance settles at round level —
  add `insuranceNet?: number` to the Game round state so the UI message strip can show
  "Insurance +1" / "Insurance −0.5".

**Payout audit test (new, table-driven):** one test iterates every settle path — BJ 3:2,
6:5 (once rules land), win/lose/push, doubled win/lose, split hands, surrender,
insurance × {taken, declined} × {dealer BJ, no BJ} — against hand-computed bankroll
deltas. Payout correctness becomes a pinned class of behavior.

## 2. Per-drill controls + manual countdown mode

Each drill's setup screen exposes its own knobs inline (Settings still holds defaults;
in-drill changes write back via `saveSettings` as new defaults):

- **Count drill:** length (13–312 step 13), group size (1/2/3), speed (300–3000 ms), and
  **mode: timed | manual**. Manual mode renders no timer; the entire card area is one
  full-width tap target ≥60% of viewport height — every tap advances one group. Works
  by feel without looking; also the self-paced mode. Countdown variant gains the same
  manual mode (tap through 51 cards, then answer).
- **Flashcards:** category filter inline (all/hard/soft/pairs).
- **Deviation quiz:** index filter — all, or a single `DeviationId` to grind one leak.
  Settings gains `drill.quizIndex: DeviationId | 'all'` and `drill.countManual: boolean`.

## 3. Variable rules — verified preset charts

```ts
export interface RuleSet {
  decks: 1 | 2 | 6 | 8;
  s17: boolean;      // true = dealer stands soft 17
  das: boolean;
  ls: boolean;       // late surrender offered
  rsa: boolean;      // resplit aces (gameplay only; chart unaffected at this granularity)
  bj65: boolean;     // 6:5 blackjack payout (payout only)
  // peek is always true (US-style), penetration stays a profile-level number
}
```

**Chart assembly (`src/engine/charts/`):** six verified base tables — (1D, 2D, 4–8D) ×
(H17, S17) — transcribed from Wizard of Odds' published charts exactly as v1 did
(direct image review, vendored into `docs/sources/`, independent second transcription in
tests). Rule flags apply as data transforms:

- `das:false` → published no-DAS pair deltas per deck count (e.g. 4–8D: 2,2/3,3 vs 2–3
  and 6,6 vs 2 and 4,4 vs 5–6 become Hit; 1D/2D per their charts).
- `ls:false` → Rh/Rs/Rp cells resolve to their fallback action at lookup (already how
  v1 handles illegal surrender; the flag just makes it table-wide).
- `s17`/`decks` → select the base table.
- `rsa`, `bj65` → gameplay/payout in `game.ts` only (`rsa` lifts the no-resplit-aces
  restriction; `bj65` pays 1.2×).

`chartLookup(cards, up)` becomes `chartLookup(cards, up, rules)`. Engine surrender/double
legality already flows through `PlayContext`; `game.ts` legality gains `rsa`.

**Verification bar (same as v1):** every cell of every base table pinned against an
independent transcription; every transform pinned (test iterates all rule combos ×
affected cells); sources vendored. This is the correctness-critical core of cycle 1.

**Indices limitation (explicit):** deviations remain the H17/S17-appropriate Illustrious
18 regardless of deck count. 1D/2D true-count indices differ slightly from shoe indices;
refining them (or importing custom index sets) is out of scope for cycle 1 — the
`Deviation[]` data model already supports swapping sets, so the door stays open. The
S17 I18 values (11vA +1 active, 16v9 +5, 10vA +4, 12v6 −1) activate when a profile's
rules say `s17:true`; H17-adjusted values (v1's set) otherwise. Both sets test-pinned.

## 4. Game Profiles

```ts
export interface Profile {
  id: string;             // uuid
  name: string;           // "Mohegan 6D H17 $10k"
  rules: RuleSet;
  penetration: number;
  spread: SpreadRow[];    // the graded bet ramp
  bankrollStart: number;  // units
  unitDollars?: number;   // display only
  countCheckEvery: number;
  betSpreadOn: boolean;
  cvcx?: { score?: number; evPerHour?: number; riskOfRuin?: number; simNote?: string };
}
```

- Storage v2: `bjtrainer.profiles.v1` (array) + `bjtrainer.activeProfile.v1` (id).
  Migration: on first load, v1 settings' game fields become profile "Default (6D H17)";
  non-game settings (feedbackMode, countPeek, dealSpeedMs, drill.*) stay in Settings.
  Migration is versioned + tested (v1 blob in → expected profile out; idempotent).
- Home shows the active profile name; tapping it opens the profile picker
  (select / add / duplicate / edit / delete-with-confirm; last profile undeletable).
- Profile editor = the rules toggles, penetration, ramp editor (existing spread editor),
  bankroll/unit, count-check cadence, CVCX fields.
- Table, drills, and all grading read the ACTIVE profile (chart via `rules`, indices via
  `s17`, ramp, payouts). Stats: sessions record `profileId`; the Stats screen gets a
  per-profile header showing CVCX numbers beside actual results (play-accuracy %, actual
  units/hr proxy: units won ÷ rounds × rounds/hr assumption of 80, labeled as such).

## 5. CVCX import

Profile editor's ramp section gains **Paste from CVCX**: a textarea accepting a copied
two-column optimal-betting table (`TC` and `bet` — tab/space/comma separated; `$`
amounts or unit counts; optional header row; negative TCs and "≤"/"+" decorations
tolerated). Parser normalizes to `SpreadRow[]` (dollar inputs ÷ `unitDollars`, which the
dialog asks for when it sees `$`), shows a parsed-preview table for confirmation, and
rejects anything ambiguous with a line-numbered error (never silently guesses). CVCX
dashboard fields (`score`, `evPerHour`, `riskOfRuin`, `simNote`) are manual entries on
the profile. No CVCX file parsing, no scraping — CVCX (Windows) stays the source of
truth; the trainer drills execution of its plan.

## 6. Testing

- Payout audit table (§1) — every settle path × hand-computed deltas.
- Chart matrix: 6 base tables cell-pinned vs independent transcription; transform combos
  pinned; `chartLookup(rules)` behavioral spot-checks per ruleset (e.g. 2D S17: 9v2 Dh?
  per published 2D chart — exact cells fixed at implementation from vendored sources).
- Both I18 variants (H17 + S17 sets) threshold-pinned; profile.s17 selects correctly.
- Migration: v1 storage blob → default profile (idempotent, lossless for non-game
  settings); corrupt/missing → defaults (as v1).
- CVCX parser: unit table, $ table, tab/space/comma, header/no-header, junk → loud error,
  preview matches save.
- E2e additions: profile create/switch changes Table behavior (S17 profile: dealer
  stands A,6 — seeded); manual countdown tap-through; paste-import happy path + error;
  quiz index filter. Screenshots for new screens reviewed as v1.

## Atomic decomposition (lowest-level pieces)

C1.1 Engine: insurance staking/settlement (2:1, even-money math) + insuranceNet + UI strip message + four-quadrant payout tests
C1.2 Engine: table-driven payout audit test (every settle path × hand-computed deltas)
C1.3 Drill UI: count-drill inline knobs + manual tap-advance mode (drill + countdown variants) + settings fields
C1.4 Drill UI: flashcard inline category filter + quiz index filter (settings.drill.quizIndex)
C1.5 Engine: RuleSet type + chart module skeleton (chartLookup(cards, up, rules)) with 4-8D H17 base wired (v1 parity, zero behavior change) + tests
C1.6 Data: 4-8D S17 base table (verified transcription + independent test transcription, image-reviewed sources vendored)
C1.7 Data: 2D H17 + 2D S17 base tables (same verification bar)
C1.8 Data: 1D H17 + 1D S17 base tables (same verification bar)
C1.9 Engine: das:false pair-delta transforms per deck class + ls:false resolution + transform matrix tests
C1.10 Engine: rsa gameplay legality + bj65 payout (game.ts) + tests (incl. payout audit rows)
C1.11 Engine: S17 Illustrious-18 variant set + s17-driven selection + threshold tests for both sets
C1.12 Store: Profile type + profiles/activeProfile storage keys + v1→v2 migration (idempotent, tested)
C1.13 UI: profile picker (Home) + profile editor screen (rules toggles, penetration, ramp, bankroll/unit, count-check, CVCX fields)
C1.14 UI+engine wiring: Table/drills/grading read active profile (chart, indices, ramp, payouts); Stats per-profile header with CVCX-vs-actual
C1.15 CVCX ramp paste-parser (pure function + loud errors) + parser unit suite + import dialog with preview
C1.16 E2e: profile create/switch (S17 dealer stands A,6 seeded), manual countdown tap-through, paste-import happy+error, quiz index filter + screenshots + coordinator review

## Out of scope (cycle 1)

Multi-hand/bots (cycle 2); all audio (cycle 3); custom/imported index sets; 1D/2D index
refinement; voice input; CVCX file parsing; ENHC/no-peek games; penetration-based index
play.
