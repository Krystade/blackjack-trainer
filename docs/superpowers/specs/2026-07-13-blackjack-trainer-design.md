# Blackjack Card-Counting Trainer — Design Spec

**Date:** 2026-07-13
**Status:** Approved (design sections approved interactively; owner authorized autonomous completion)

## 1. Purpose

A phone-first web app for practicing card counting in the car (as a passenger): perfect
basic strategy and the Illustrious 18 deviations built in, with a full game simulation
plus focused drills. Hosted as a plain static website; no backend.

## 2. Requirements (settled with owner)

- **Modes:** full blackjack game simulation + three standalone drills (count speed,
  basic-strategy flashcards, deviation quiz).
- **Rules:** 6 decks, dealer **hits soft 17 (H17)**, **double after split (DAS)**,
  **late surrender (LS)**, 3:2 blackjack, resplit to 4 hands, split aces get one card,
  double on any first two cards, no peek nuances modeled beyond standard US peek game
  (dealer checks for blackjack with ace or ten up; player loses only original bet to
  dealer BJ — since we model a peek game, the round ends before player decisions when
  dealer has blackjack).
- **Count:** Hi-Lo (2–6 = +1, 7–9 = 0, 10/J/Q/K/A = −1), true count = running count ÷
  decks remaining, **floored** (toward −∞), decks remaining estimated to the half deck.
- **Deviations:** the Illustrious 18, H17-adjusted (see §5).
- **Hosting:** plain hosted web app (static files; Netlify/GitHub Pages class hosting).
- **Bet spread practice:** optional toggle; when on, bet is graded against a configurable
  TC→units spread and a session bankroll is tracked.
- **Feedback:** two modes — **Training** (instant correction overlay with the rule/index
  that applies) and **Test** (silent; end-of-session report).
- **UI:** portrait phone-first, dark theme, large bottom action buttons, no mid-hand
  scrolling.

Out of scope (explicitly): Fab 4 surrender deviations, multiple rule presets, rule
configurability beyond what's listed, accounts/sync/server, sound, multiplayer,
real-money anything.

## 3. Architecture

Vite + React + TypeScript; Vitest for unit tests; Playwright for e2e. Static `dist/`
output. All correctness-critical logic is pure TypeScript with no React imports.

```
src/engine/          # pure TS, zero UI deps — exhaustively unit-tested
  cards.ts           # Card/Rank, 6-deck shoe, shuffle (seedable RNG), cut-card penetration
  hand.ts            # totals (hard/soft), pair detection, blackjack detection
  count.ts           # Hi-Lo tags, running count, true count (floored), decks remaining
  basicStrategy.ts   # full 6D H17 DAS LS chart as data tables (§4)
  deviations.ts      # H17-adjusted Illustrious 18 as data (§5)
  strategy.ts        # correctPlay(hand, dealerUp, tc) → merges chart + deviations
                     #   + insurance decision (take iff TC ≥ +3)
  game.ts            # round state machine: bet → deal → (dealer BJ check) → insurance
                     #   → player turns (multi-hand after splits) → dealer → settle
  grade.ts           # classify user action vs correctPlay (§7)
src/drills/          # pure TS drill logic (count drill, flashcards, deviation quiz)
src/store/           # settings + stats, versioned localStorage persistence
src/ui/              # React screens: Home, Table, Drill, Stats, Settings
e2e/                 # Playwright specs + screenshot review artifacts
docs/sources/        # vendored source charts (WoO bj_4d_h17.gif, BJA_H17.pdf)
```

The RNG is seedable so e2e tests can drive deterministic deals.

## 4. Basic strategy — 6 decks, H17, DAS, LS (verified)

Primary source: Wizard of Odds 4–8 deck H17 chart (`docs/sources/bj_4d_h17.gif`),
transcribed by direct image review 2026-07-13. Cross-checked against Blackjack
Apprenticeship's H17 chart (`docs/sources/BJA_H17.pdf`). The two sources agree on every
cell except one, noted below.

Actions: `H` hit · `S` stand · `Dh` double else hit · `Ds` double else stand ·
`P` split · `Ph` split only if DAS (= split for us, DAS is on) · `Rh` surrender else hit ·
`Rs` surrender else stand · `Rp` surrender else split.

**Hard totals** (dealer 2 3 4 5 6 7 8 9 10 A):

| Player | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 4–8 | H | H | H | H | H | H | H | H | H | H |
| 9 | H | Dh | Dh | Dh | Dh | H | H | H | H | H |
| 10 | Dh | Dh | Dh | Dh | Dh | Dh | Dh | Dh | H | H |
| 11 | Dh | Dh | Dh | Dh | Dh | Dh | Dh | Dh | Dh | **Dh** |
| 12 | H | H | S | S | S | H | H | H | H | H |
| 13 | S | S | S | S | S | H | H | H | H | H |
| 14 | S | S | S | S | S | H | H | H | H | H |
| 15 | S | S | S | S | S | H | H | H | **Rh** | **Rh** |
| 16 | S | S | S | S | S | H | H | Rh | Rh | Rh |
| 17 | S | S | S | S | S | S | S | S | S | **Rs** |
| 18+ | S | S | S | S | S | S | S | S | S | S |

**Soft totals:**

| Player | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| A,2 (13) | H | H | H | Dh | Dh | H | H | H | H | H |
| A,3 (14) | H | H | H | Dh | Dh | H | H | H | H | H |
| A,4 (15) | H | H | Dh | Dh | Dh | H | H | H | H | H |
| A,5 (16) | H | H | Dh | Dh | Dh | H | H | H | H | H |
| A,6 (17) | H | Dh | Dh | Dh | Dh | H | H | H | H | H |
| A,7 (18) | **Ds** | Ds | Ds | Ds | Ds | S | S | H | H | H |
| A,8 (19) | S | S | S | S | **Ds** | S | S | S | S | S |
| A,9 (20) | S | S | S | S | S | S | S | S | S | S |

**Pairs** (DAS on, so `Ph` ⇒ split):

| Pair | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 2,2 | Ph | Ph | P | P | P | P | H | H | H | H |
| 3,3 | Ph | Ph | P | P | P | P | H | H | H | H |
| 4,4 | H | H | H | Ph | Ph | H | H | H | H | H |
| 5,5 | treat as hard 10 |||||||||
| 6,6 | Ph | P | P | P | P | H | H | H | H | H |
| 7,7 | P | P | P | P | P | P | H | H | H | H |
| 8,8 | P | P | P | P | P | P | P | P | P | **Rp** |
| 9,9 | P | P | P | P | P | S | P | P | S | S |
| 10,10 | S | S | S | S | S | S | S | S | S | S |
| A,A | P | P | P | P | P | P | P | P | P | P |

Bold cells are the H17-specific plays (11 vs A double; 15 surrenders vs 10 and A;
17 surrenders vs A; 8,8 surrenders vs A; soft 18 doubles vs 2; soft 19 doubles vs 6) —
all six were listed in Wizard of Odds' text notes and confirmed in the chart image.

**Known source discrepancy:** 8,8 vs A — WoO says surrender if allowed else split (`Rp`);
BJA says always split. We follow WoO (primary source). The grader treats `Rp` surrender
as the single correct answer at TC 0 in this app.

## 5. Deviations — Illustrious 18, H17-adjusted (verified)

Sources: canonical S17 I18 (Schlesinger) cross-referenced with BJA's H17 deviation chart
(`docs/sources/BJA_H17.pdf`, direct review). Convention: **floored true count**;
`≥ n` = deviate at that TC and above; `≤ n` = deviate at that TC and below (BJA's `+`/`-`
notation made explicit). Each entry stores: hand, upcard, deviation action, threshold,
direction.

| # | Hand | Basic play | Deviation | Index (H17) | S17 canonical |
|---|------|-----------|-----------|-------------|----------------|
| 1 | Insurance | decline | take | TC ≥ +3 | +3 |
| 2 | 16 v 10 | hit (after LS unavailable → this governs hit/stand; surrender remains basic first action) | stand | TC ≥ 0 | 0 |
| 3 | 15 v 10 | hit | stand | TC ≥ +4 | +4 |
| 4 | 10,10 v 5 | stand | split | TC ≥ +5 | +5 |
| 5 | 10,10 v 6 | stand | split | TC ≥ +4 | +4 |
| 6 | 10 v 10 | hit | double | TC ≥ +4 | +4 |
| 7 | 12 v 3 | hit | stand | TC ≥ +2 | +2 |
| 8 | 12 v 2 | hit | stand | TC ≥ +3 | +3 |
| 9 | 11 v A | **double (basic under H17)** | — absorbed into basic | n/a | +1 |
| 10 | 9 v 2 | hit | double | TC ≥ +1 | +1 |
| 11 | 10 v A | hit | double | TC ≥ **+3** | +4 |
| 12 | 9 v 7 | hit | double | TC ≥ +3 | +3 |
| 13 | 16 v 9 | hit | stand | TC ≥ **+4** | +5 |
| 14 | 13 v 2 | stand | hit | TC ≤ −1 | −1 |
| 15 | 12 v 4 | stand | hit | TC ≤ −1 (i.e. any negative TC; index 0, deviate below 0) | 0 |
| 16 | 12 v 5 | stand | hit | TC ≤ −2 | −2 |
| 17 | 12 v 6 | stand | hit | TC ≤ **−3** | −1 |
| 18 | 13 v 3 | stand | hit | TC ≤ −2 | −2 |

Bolded values differ from the S17 canon (confirmed against BJA H17 chart / forum
consensus). #9 (11 v A) is listed and taught in the deviation quiz as "always double
under H17 — this index play only exists in S17 games", but generates no runtime
deviation. Entries #16 and #18 keep their canonical values: no major published H17
source shifts them, and BJA omits them entirely (documented as canonical-I18 values).

**Precedence in `correctPlay`:** surrender (if legal first action) → conditional-double
deviations → split deviations (10,10) → stand/hit deviations → basic chart. 16 v 10 with
surrender available: surrender is correct regardless of count (Fab 4 refinements are out
of scope); the 16 v 10 stand deviation governs post-split or ≥3-card 16s where surrender
is illegal. Same logic for 15 v 10 and 16 v 9.

**Multi-card hands:** deviations keyed on hand total apply to any hand with that total
(standard index-play practice); doubles only apply when doubling is legal (2 cards).

## 6. Game simulation

Round state machine (`game.ts`), all transitions pure and unit-testable:

1. **BET** (only if bet-spread toggle on): player picks units; graded vs the configured
   spread table. Default spread: TC ≤ 0 → 1u, +1 → 2u, +2 → 4u, +3 → 8u, +4 → 10u,
   ≥ +5 → 12u. Session bankroll tracked (starts 100u, configurable).
2. **DEAL** from the shoe (cut card at 75% penetration default, configurable 50–90%;
   reshuffle between rounds once cut card is reached). Every card exposed to the player
   updates the running count — dealer hole card counts only when revealed.
3. **DEALER BJ CHECK** (peek game): with A up, insurance decision first (graded: take iff
   TC ≥ +3); dealer BJ ends the round.
4. **PLAYER TURNS:** Hit / Stand / Double / Split / Surrender buttons with illegal
   actions disabled. Every action graded against `correctPlay` at the decision-time TC.
   Splits create up to 4 hands; split aces get one card each (no resplit aces, no hitting
   split aces); no surrender after split; double any first two cards incl. after split.
5. **DEALER PLAYS** (hits soft 17), reveal hole card (count updates), settle 3:2 BJ,
   pushes, bankroll update, next round.

**Count checks:** every N rounds (default 5, range 1–20 or off) the game pauses between
rounds and asks for the running count (numeric keypad), then occasionally (every other
check) also the true count. Scored exact/miss; misses show the actual value.

**Feedback modes:**
- **Training:** wrong action → overlay with your play, correct play, and the reason
  ("Basic strategy" or "Illustrious 18 #13: 16 v 9 — stand at TC ≥ +4; TC was +5").
  Dismiss to continue; the hand continues as if you'd made your actual play (you live
  with mistakes, like a real table).
- **Test:** no interruptions; session report at the end (see §8).

## 7. Grading model

Every graded event is one of: bet, insurance, playing action, count check. Playing-action
mistakes classify as:

- `basic-error` — correct play was pure basic strategy; player deviated from it (count
  did not justify anything).
- `missed-deviation` — the count called for an index play; player made the basic play.
- `phantom-deviation` — player made an index-style play the count did not justify.
- `wrong-anyway` — action matched neither basic nor any recognized deviation.

Each event records: hand snapshot, upcard, TC at decision, action taken, correct action,
classification, applicable I18 index if any. This event log feeds both the end-of-session
report and lifetime stats.

## 8. Drills

1. **Count speed drill:** cards flash singly or in pairs/threes at a configurable
   interval (0.3–3 s) for a chosen length (¼ deck–6 decks); enter the final RC. Variant:
   **deck countdown** — see 51 cards, name the last one's Hi-Lo implication (final RC of
   a full deck is 0). Tracks accuracy and fastest clean speed.
2. **Basic-strategy flashcards:** random (hand, upcard) → answer with action buttons;
   instant right/wrong + chart cell. Weighted sampling: recently-missed cells appear
   more often (simple miss-count bucket weighting, not full SRS). Category filter
   (hard/soft/pairs/surrender).
3. **Deviation quiz:** only I18 situations, sampled with TCs on both sides of each index
   (± within 2 of threshold) so thresholds get learned, insurance included; answer =
   action at that count. 11 v A appears with "always double under H17" as the answer.

All drills write to the same stats store as the game.

## 9. Stats, settings, persistence

`src/store/` — versioned localStorage (`bjtrainer.v1` key; schema version field;
unknown/corrupt payloads → defaults, never crash). Export/import stats+settings as a
JSON file from the Stats screen.

**Settings:** feedback mode, bet-spread toggle + spread table, starting bankroll,
count-check frequency, penetration, deal speed, drill parameters, count-peek enabled,
theme (dark default).

**Stats:** per-category accuracy (hard/soft/pairs/surrender/insurance/bets/count checks),
per-index accuracy for each I18 play, mistake-class tallies (§7), count-drill speed/
accuracy history, session summaries (date, rounds, accuracy, bankroll delta).

## 10. UI

Four screens (React, portrait phone-first, dark):

- **Home:** Play, Drills, Stats, Settings.
- **Table:** dealer area / player hands (splits fan out) / big bottom action row
  (Hit·Stand·Double·Split·Surrender), bet picker when spread practice on, insurance
  prompt, count-check modal, training-mode correction overlay, tap-and-hold count-peek
  (hidden in Test mode when disabled in settings). Cards are CSS/SVG, no image assets.
- **Drill:** drill picker + the three drill UIs.
- **Stats:** lifetime + per-session, per-index table, export/import.

Buttons ≥ 48 px touch targets; all interactions single-tap; no scrolling during a hand.

## 11. Testing

- **Unit (Vitest):**
  - every cell of §4's three tables asserted (hard 4–21 × 10, soft 13–20 × 10,
    pairs 10 × 10) — chart transcription is test-pinned;
  - every §5 index: at threshold, one above, one below (both directions);
  - precedence: surrender-vs-deviation interactions (16v10, 15v10, 16v9 with 2-card vs
    3-card hands);
  - hand math (soft/hard transitions, pair detection, BJ), Hi-Lo tags (all 13 ranks),
    TC flooring incl. negatives, full-shoe RC sums to 0, penetration/reshuffle;
  - game machine: split limits, split-ace rules, double legality, surrender timing,
    dealer H17 (incl. A,6 hit), payouts, dealer-BJ short-circuit, hole-card count timing;
  - grading: each mistake class reproduced; store: round-trip + corrupt-blob fallback.
- **E2E (Playwright, seeded RNG):** full round happy path; wrong play in Training →
  overlay contents; Test-mode session → report contents; count-check flow; bet grading;
  split flow; insurance flow; drills each; settings persistence across reload; stats
  export. Screenshots at every state are captured and **manually reviewed** (Read tool)
  against expectations; reviewed set kept in `e2e/screenshots-reviewed/`.
- **CI-ish gate:** `npm test && npm run e2e` green before any deploy.

## 12. Hosting / deployment

`vite build` → static `dist/`. Deployed to GitHub Pages (public repo under the owner's
account) via `gh` + Actions workflow, so the car phone just opens the URL. localStorage
is per-device/browser — noted in README.

## 13. Milestones (implementation plan will chunk these further)

1. Scaffold (Vite/React/TS/Vitest/Playwright, repo hygiene).
2. Engine: cards/hand/count (+tests).
3. Engine: basic strategy tables (+every-cell tests).
4. Engine: deviations + correctPlay precedence (+threshold tests).
5. Engine: game state machine + grading (+tests).
6. Store: settings/stats/persistence (+tests).
7. UI: Table screen + Training/Test flows.
8. UI: drills.
9. UI: Home/Stats/Settings + export.
10. Playwright e2e + screenshot review pass.
11. Deploy + README.
