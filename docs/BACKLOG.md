# Living Backlog

The single place improvement ideas land, get grounded, and get ranked. Point-in-time
syntheses (like `research/2026-07-21-priority-list.md`) feed this; this file is the
current truth. Process: operator ideas + the adversarial/research loop add candidates
here; nothing ships until it's ranked against what's already listed.

**Voice decision (settled 2026-07-23):** default voice = **Bella** (`af_bella`, already
the shipped `index.json` default); **George** kept as a switchable option. Emma remains
shipped as a third choice unless the operator asks to drop it.

---

## Candidates — operator-sourced

### D1 · Distraction training (operator idea 2026-07-23) — HIGH interest — **✅ SHIPPED (parts 1+2)**
Mid-drill interruptions that simulate the real-table cost of talking while counting:
pause the card stream, inject a challenge that MUST be answered, then resume; the final
count is graded as usual — the skill being trained is *holding the count through
interference*.

Shipped: part 1 — `src/drills/distraction.ts` (`makeDistraction(runningCount, mode, seed)`,
near-count + generic modes, anti-drift tested) and additive telemetry
(`Stats.distraction.history[]` + `distractionSummary()` in `src/store/drillStats.ts`). Part
2 wired it into the standard count drill (`src/ui/screens/drills/CountDrillView.tsx`):
`Settings.drill.distractionFreq` ('off' default / 'occasional' / 'relentless') and
`distractionMode` gate a new `'distraction'` phase, entered from all three flashing advance
mechanisms (fixed-interval, eyes-free speech loop, manual tap) via a shared
`isDistractionPoint`/`triggerDistraction` check — excluded from Countdown mode and Timed
Challenge (both out of scope for v1). Cadence is a fixed, seed-free interval
(`drills/distraction.ts`'s `isDistractionPoint`): occasional every 7th card shown,
relentless every 3rd. The running count fed to `makeDistraction` (`runningCountThrough` in
`countDrill.ts`) is computed and consumed privately — never displayed or spoken. Each
answered distraction lands a provisional row (`answerCorrect`, `elapsedMs`); `countKept` is
back-filled against the run's own final-count grade once it's known (`finishRun`). Stats
screen gained a "Distraction" section (attempts / answer accuracy / count-kept %). R2's
competence gate is deliberately NOT wired to distraction yet (feature-first per the
operator's ask; 'off' default is the gentle onboarding) — future work, not blocking.
Timed-Challenge-plus-distraction is a noted future combo, intentionally untangled from this
ship.

- **Interference types**, escalating:
  - **Near-count math** (operator's key insight): arithmetic whose operands/answers sit
    near the current running count — if the count is +7, ask "8 + 6?" — maximally
    confusable, which is the point. The wrong count you end up with IS the failure mode
    real table-talk produces.
  - **Generic quiz questions**: table-talk simulacra ("what's 12 × 4?", simple trivia)
    that occupy the verbal loop without number-adjacency.
- Works visual AND eyes-free (spoken interruption, keyboard/zone/spoken answer).
- **Research grounding already in hand**: the practitioner pain-point report ranks
  "conversing while counting / dealer speed changes / distraction" as the top
  real-table breakdown practice doesn't prepare people for, and CVBJ ships dealer
  distractions as a named feature. This is the highest-confidence candidate in the file.
- Design notes: frequency/difficulty settings (off / occasional / relentless); the
  interruption's own answer is graded too (both wrong-count and wrong-answer are
  failures); telemetry should record counts-kept-through-distraction separately.

### D2 · Ideas raised earlier and still open
- Countdown/tag-guess submode has no eyes-free support (excluded twice, deliberately —
  needs an explicit keep/kill decision).
- Corrections are not clipped (symbol-heavy index labels fall back to live TTS) — a
  wording cleanup of `reason` strings would make them clippable AND better-spoken.
- Token-level clip concatenation for multi-card groups at `full` card detail (currently
  falls back to live TTS; rank/face detail already fully clipped).

## Candidates — from the adversarial/research loop

Synthesized 2026-07-23 from three legs: `research/2026-07-23-adversarial-redteam.md`
(RT#), `-training-science.md` (TS#), `-community-methods.md` (CM#). **Ranked by
CONVERGENCE first** — where independent legs (code attack / learning science /
practitioner community) point at the same gap, confidence is high regardless of any one
leg's opinion.

### R1 · Decision-latency telemetry + optional shot clock — S — **✅ SHIPPED 5b617ba (telemetry half; shot clock still open)**
Convergence: RT#1 (no latency field on `GradedEvent`; the app can't detect absence of
automaticity — the variable that most predicts table survival) **meets** TS (speed-accuracy
literature: you can't gate on speed you don't measure) **meets** CM#3 (dealer-training
frames the target as instant *recognition*, not fast calculation). This is the
measurement layer that makes almost everything below provable — including D1 (distraction
must be scored as "count kept AND how much slower"). Add `elapsedMs` to graded events +
surface per-drill; the shot clock is a cheap follow-on. Highest leverage in the file.

### R2 · Accuracy-gate the hard modes (fix the timed ramp; gate distraction/speed/interleave) — S — **HIGH** — **✅ SHIPPED (timed-drill half; distraction/interleave gating still open for D1/R4)**
Convergence: TS#2+TS#3 (three independent literatures — stress-inoculation,
desirable-difficulties, speed-accuracy — converge on "unlock harder only after a measured
competence floor"; a controlled npj Science of Learning study read in full shows
schedule-driven speed pressure inflates in-drill scores without improving *retained*
skill) **meets** RT (plateau-trap findings). CONCRETE + slightly self-correcting: our
just-shipped timed drill ramps on elapsed cards, not accuracy — change it to advance a
speed tier only when accuracy holds at threshold. Also the onboarding rule for D1. Depends
on R1's measurement.

Shipped: `src/drills/competenceGate.ts` (`computeUnlockedTier` -- reusable gate, generic over
any `{tier, correct}` history so D1 can reuse it unchanged) + `tierStartIntervalMs` in
`countSpeed.ts` (one source of truth mapping a SpeedTier to its ms/card pace, derived from
`classifySpeed`'s own tested cutoffs). Wired into the timed drill's "Adaptive difficulty"
toggle (`Settings.drill.timedAdaptive`, default true): the run's starting pace is set to the
unlocked tier's pace and the within-run ramp is capped there (start==floor -- no
schedule-driven overspeed beyond earned competence), gated on per-run correctness recorded
across runs (`timedCount.history[].attemptedTier`). Fixed-pace mode is kept, unchanged, as an
explicit opt-out. Gate rules: 80% accuracy over the most recent 10 attempts at a tier (min 5
attempts before it counts), 3-consecutive-wrong eases back one tier. Result screen shows
"Unlocked: &lt;tier&gt; — hold accuracy to reach &lt;next&gt;" plus advanced/held/eased.

### R3 · Spaced-repetition / miss-weighted scheduling over indices + weak chart cells — S — **HIGH** — **✅ SHIPPED**
Convergence: TS#1 (spacing + retrieval practice = the most robustly evidenced technique in
the whole science report) **meets** RT#4 (flashcard miss-weights only grow, never decay;
the deviation quiz samples uniformly while per-index error tallies already exist, unused).
The telemetry to seed it is already in `Stats`. Decay-on-correct is XS; a Leitner/SM-2-ish
weighted draw is S. Directly attacks the "max the drill while the skill stays weak" trap.

Shipped: `src/drills/weightedDraw.ts` -- shared Leitner-lite primitives (`missWeight` =
1 + 2\*missCount, `weightedIndex` seeded weighted pick, `bumpMiss`/`decayMiss` floored-at-0
weight-map updaters) used by BOTH drills so they weight identically. Flashcards
(`gradeFlashcardAnswer` in `Drills.tsx`): a correct answer now decays the cell's weight
toward 0 via `decayMiss` (previously only miss ever touched it); `drawFlashcard` itself was
refactored onto the shared helper, behavior-preserving (46 pre-existing tests unchanged).
Deviation quiz: new persisted per-index weight map (`QUIZ_WEIGHTS_KEY`,
`load/saveQuizWeights`, mirroring `FLASH_WEIGHTS_KEY`), updated symmetrically in
`gradeQuizAnswer` (+1 on a real-item miss, -1 toward 0 on correct) -- gated on
`item.deviationId` being defined so distractor items (which never carry one) can't perturb
index weights, matching how they're already excluded from `Stats.perIndex`.
`drawQuizItem` gained an additive 5th `missWeights` param used ONLY by the no-filter
real-item entry pick; a pinned `filter` bypasses it entirely (weighting is moot when
pinned) and distractor base-entry selection stays uniform over active entries, unaffected.
An omitted/empty weight map is byte-identical to pre-R3 behavior (proven via
`weightedIndex`'s "matches `Math.floor(rng()*n)`" test and paired default-vs-explicit-`{}`
equality tests in both drills). 27 new unit tests (18 in `weightedDraw.test.ts` + 9 in
`drills.test.ts`, including a disproportionate-draw statistical test and a decay-returns-
to-baseline test for each drill); full suite 2878 unit + 47 e2e green, no e2e spec changes.

### R4 · Interleaved / mixed-session mode — M — MEDIUM-HIGH — ✅ SHIPPED 2026-07-28
Convergence: TS#4 (interleaving meta-analysis, Hedges' g ≈ 0.42 across 59 studies,
strongest exactly for discriminating *similar* categories) **meets** CM#2 (coaches sequence
students through mixed table-like practice, not isolated drills) **meets** the existing
fake-deviations feature (near-miss discrimination is the same skill). A session mode that
blends basic-strategy + deviation items on neighboring hands. Pairs naturally with R3.
SHIPPED: new **Mixed** picker mode + `MixedSessionView`. Each position's type is a seeded
coin flip (`src/drills/mixedSession.ts` `pickMixedType` — random interleave, NOT rigid A-B-A,
consecutive same-type runs allowed, ~50/50). A quiz item shows its TC; a flashcard shows none
— the visible cue that IS the discrimination trained. Anti-drift guaranteed by construction:
the two grade paths were **extracted** into `src/drills/gradeAnswer.ts` (`gradeFlashcardAnswer`/
`gradeQuizAnswer` — engine graders + R3 weights + R1 latency + the Stats write, single-sourced),
and the standalone views AND the mixed view all call those exact functions. Unit test pins
byte-identical GradedEvent/nextWeights/Stats write for identical inputs; e2e proves one mixed
session populates both histories (6 latency, 6 category grades, exactly 3 perIndex) with no fork.
Reuses ActionBar/ZonePad/1-5 keyboard/dim-screen surfaces. 2927 unit + 91 e2e green.

### R5 · Wonging / sit-out practice — M — MEDIUM-HIGH (biggest *realism* hole) — ✅ SHIPPED 2026-07-28
RT#2, standalone but high-conviction: `startRound` always stakes; there's no sit-out, so
the most profitable shoe decision (wong out of negative counts, back-count in) is
structurally unpracticeable, and the default spread quietly teaches playing all counts. A
graded "sit out this round" action + back-counting entry drill. Larger because it touches
the game loop.
SHIPPED: `Game.sitOut()` (engine) + a **Sit Out** button beside Deal in the bet phase,
shown only when a bet spread is on. Sitting out plays the whole round (bots + dealer) so
the running count advances and penetration burns exactly as a staked round would — the
count carried into the next bet is real — but the player is dealt no hand and the bankroll
is untouched; a dealer Ace never prompts insurance (no stake to insure). Graded as a new
`wong` GradedEvent kind/category: **correct when the profile's OWN spread calls only for the
table minimum at the pre-deal TC** (no hard-coded count threshold asserted as strategy
truth — the wong-out line moves with the configured spread). Back-counting-in falls out
naturally: sit through negative counts, Deal when the count rises. Engineering: extracted
`beginRound()` (shared bookkeeping/reshuffle), `buildSeats` keys player-hand count off
`bets.length` ([] ⇒ empty player seat, byte-identical for staked rounds); `wong` category is
migration-safe. 2935 unit (+8 sit-out) + 92 e2e (+1 wong-out) green.
FOLLOW-ON (deliberately deferred to keep stage 1 additive/zero-risk to the money-math
suite): grade the *play* path symmetrically — dealing in at a should-wong count should
register a wong error too, not just be silently rewarded by a "correct" min-bet grade.
Requires touching the heavily-tested deal path's event stream (push a `wong` event after the
existing `bet` events); event-order-sensitive tests (game.test.ts:286/303/325/796/1298) must
be audited first. Also possible: a standalone back-counting *drill* mode (watch a shoe, tap
enter/sit) as the fuller unstaked version RT#2 references.

### R6 · Discard-tray depth cue on the live table — S — MEDIUM (cheap realism repair) — 🟡 VISUAL CUE SHIPPED 2026-07-28
RT#3: table TC checks grade against the shoe's *exact* depth with no visual tray, actively
mistraining estimation and stranding the deck-estimation drill as an island. The tray-fill
visual already exists in `DeckEstimationView` — reuse it on `Table.tsx` so table count-checks
require real estimation. Cheap, and it connects a drill to its point of use.
✅ SHIPPED (the visual cue): a compact horizontal **discard tray** below the table topbar that
fills as the shoe burns (`game.shoe.cardsDealt / decks*52`), giving a live by-eye referent to
estimate decks-remaining from during count checks — deliberately shows ONLY the fill (no exact
number) so estimation is still required, connecting the deck-estimation drill to its point of
use. e2e asserts the fill widens across a dealt round. REMAINING (deferred, operator-
deprioritized): make the count-check TC grading tolerant of a reasonable by-eye estimate band
rather than exact depth — the fuller RT#3 fix, but it touches the tested count-check grading.

### R7 · Count-peek accountability — XS — MEDIUM (quick integrity fix) — ✅ SHIPPED 2026-07-27
RT#5: the RC/TC peek button works even in test mode and is never logged, making "actual
play accuracy" uninterpretable. Log peeks; disable (or flag) in test mode.
SHIPPED: peeks counted per session (rising-edge guard dedups the mouse+touch double-fire),
recorded on `SessionReport.peeks` + optional `Stats.sessions[].peeks` (no migration — persist
passes `sessions` through). Kept the button available in BOTH modes (a legit training aid);
instead surface it — test-mode session report, Stats sessions list, and the aggregate "Actual
play accuracy" header all show an "assisted — used N peeks" flag when peeks>0 (pure helper
`src/ui/peekFlag.ts`, unit-tested; e2e asserts the count + flag). 0-peek sessions unchanged.

### R8 · New drill mechanics from the community hunt — S–M each — MEDIUM/EXPLORATORY — ✅ SUBSTANTIALLY DONE (bias ✅ + pair-cancellation ✅ 2026-07-28; card-removal ≈ existing Countdown; guided-session deferred as packaging)
Genuinely novel, verified in primary sources (CVBJ manual / practitioner forums):
- **Bias dealing** (CM#1): deliberately cluster same-sign cards to force counting-through-
  zero and sign-reversal reps — a weak spot random dealing under-samples. A shoe-gen param.
  ✅ SHIPPED: `makeCountDrill(cards, group, seed, bias)` — a stable sort by Hi-Lo tag clusters
  same-sign cards toward the front ('negative' front-loads high/−1 cards ⇒ count dives then
  climbs; 'positive' front-loads low/+1 ⇒ spikes then falls). Same finalRc (order-independent
  sum): same destination, harder journey. Within-tag order stays seeded-shuffled so counting
  stays non-trivial. Setting `drill.countBias` (migration-safe, default 'none'); a "Count bias"
  Segmented on the count-drill setup, scoped to the ordinary drill — Timed Challenge forces
  'none' so a harder shoe can't contaminate the R2 speed-tier grading. Directly answers the
  red-team's "negative-count arithmetic systematically undertrained" (#6). 2939 unit + 93 e2e.
- **Card-removal deduction** (CM#2, repeated-theme): remove 1–2 cards before dealing; after
  the countdown the user deduces the removed card's value from count self-consistency.
  Tests correctness, not just speed. Novel — no existing trainer found with it.
  ⏸️ LARGELY ALREADY SHIPPED — deprioritized as a near-duplicate. The existing **Countdown**
  mode (`makeCountdown` + CountDrillView's tag-guess) is exactly single-card remove-then-deduce:
  count 51 cards, deduce the hidden card's tag from the residual count. The ONLY genuinely-new
  delta is a 2-card-removal variant (deduce the net tag of two removed cards) — a small
  generalization of `makeCountdown` (drop N cards, ask the net removed tag), not a new drill.
  Not worth a whole new mode; folded into Countdown as an optional future enhancement (low
  marginal value now that pair-cancellation + bias — the high-value R8 items — have shipped).
- **Pair-cancellation drill** (CM/TS#5 convergence): drill recognizing canceling pairs
  (e.g. a +1 and a −1 arriving together = 0) as a unit — the chunking stage after
  single-card speed. Backed by chess-chunking research AND the community progression.
  ✅ SHIPPED 2026-07-28: new **Pair Cancellation** drill mode. Two cards shown at once, pick
  the net Hi-Lo tag (−2…+2); `makePairCancel` (pure/seeded) + `isCancellingPair` (a genuine
  +1/−1 cancel, stricter than net===0). Deliberately VISUAL-ONLY — no eyes-free — since the
  skill is gestalt pair recognition that serial audio would defeat (red-team item 10).
  Continuous flow like Flashcards; keyboard 1–5 → the five nets; R1-style latency captured.
  Migration-safe `Stats.pairCancel` telemetry (net/guess/correct/cancelling/elapsedMs).
  ✅ FOLLOW-ON DONE (TS#6 content-weighting): `makePairCancel(seed, cancellingBias)` oversamples
  GENUINE cancelling pairs (a random draw under-represents them — most net-0 pairs are 7,8
  non-cancels), and `pairCancelBias(roundIndex)` decays the bias from 0.6 toward the natural
  draw as the session progresses (chunk-frequency logic). Default bias 0 keeps every existing
  caller/test unchanged. 2956 unit.
- **Guided 15-min session template** (CM): warm-up → speed → true-count → hidden-value with
  a month-over-month error target. Provenance is template-like (flagged), so treat as a
  packaging idea for R1–R5, not its own evidence.

### R9 · Spot-reading / obscured-card recovery — M — LOW/EXPLORATORY — 🟡 VISUAL SLICE SHIPPED 2026-07-28
CM#4+CM#5: recognizing cards by pip layout (pips-not-numerals), and reasoning backward from
a visible outcome to a hidden card's count value. Interesting, niche; park unless a session
surfaces demand.
✅ SHIPPED (the high-value visual-recognition slice, = red-team #7): **Messy cards** — a small
seeded rotation/offset per card (`drills/cardJitter.ts`, pure + unit-tested; deterministic per
seed so it's stable while shown and reproducible in tests) trains the visual-recognition half
of counting that a robotically-aligned stream doesn't. A toggle on the count-drill setup;
applies to every count-drill flash mode AND the pair-cancellation drill. `drill.messyCards`
(migration-safe, default false). 2951 unit + e2e assert the transform is applied. REMAINING
(genuinely park-worthy, no demand surfaced): CM#5 backward-deduction from a visible bust
outcome — overlaps the existing Countdown / card-removal deduction; leave parked.

### From the 2026-07-28 red-team v2 (post R4–R9) — full doc: `docs/research/2026-07-28-adversarial-redteam-v2.md`
Fresh adversarial re-attack after the R4–R9 batch shipped; 9 cited findings, biggest NEW gaps
first. ⚠️ Several touch STRATEGY GROUND TRUTH — do NOT decide from memory; ground against spec
§4/§5 + `docs/sources/` before building (flagged inline).

- **RV1 · Bankroll / variance / risk-of-ruin pillar — ⏸️ PARKED (operator has CVCX, 2026-07-29).**
  Two halves: (a) the NUMBERS (RoR/Kelly/N0/EV) — redundant with the operator's CVCX, which the app
  already imports into profiles; building a calculator would duplicate (less accurately) what they
  own. (b) the EXPERIENTIAL downswing/tilt inoculation (live a 40-buy-in drawdown, keep betting the
  spread) — the one thing CVCX doesn't do, but low-value for someone who already understands variance
  via CVCX. Net: parked as a CALCULATOR. UPDATE 2026-07-29 (operator): the experiential/training
  side IS wanted (just low priority) — and the operator wants a dedicated RESEARCH pass on OTHER
  training-function features "in the same vein" (things that build real-table behavior/discipline,
  not just drill accuracy) before building. PLAN ORDER: ship RV4 first → then RV1-adjacent training-
  features research + planning → then development. ✅ Research DONE — see the "Experiential /
  behavioral training features" section (ET1–ET7) below; RV1's experiential half is ET1 (flagship).
- **RV2 · TC rounding convention — ❌ NOT A GAP (verified 2026-07-29), keep as-is.** Ground-truth
  check: the spec is explicit and source-grounded — "true count = running count ÷ decks remaining,
  **floored** (toward −∞)" (`specs/2026-07-13-...:22-23`, `:129`, from `docs/sources/BJA_H17.pdf`
  direct review). Floored TC is the VERIFIED standard, not an arbitrary assertion; accepting
  round-to-nearest would contradict the source. The red-team's "±0.5 inconsistency" conflates two
  DIFFERENT drills — deck-*estimation* (a by-eye estimate, rightly ±0.5) vs true-count *conversion*
  (given exact inputs, one floored answer, rightly exact). No change; documented so it isn't
  re-raised.
- **RV3 · Surrender (Fab 4) deviations — ⛔ BLOCKED on operator (spec explicitly out-of-scope).**
  The deviation set (`deviations.ts:40-75`) is hit/stand/double/split only — factually true — BUT
  the spec DELIBERATELY excludes Fab 4: "Out of scope (explicitly): Fab 4 surrender deviations"
  (`specs/2026-07-13-...:33`, also `:163-164`). This is an operator scope decision, not an
  oversight. To act: (1) operator brings Fab 4 in-scope, (2) source-verified index values land in
  `docs/sources/` (the red-team's "14v10/15v9/15v10/15vA" is its own claim, NOT verified — do not
  add from memory). Real EV lever and a genuine training gap, but not autonomously actionable.
- **RV4 · Spacing vs error-weighting in R3 — M — [SCI] — ✅ SHIPPED 2026-07-30.** Spec:
  `docs/superpowers/specs/2026-07-30-rv4-spaced-repetition-design.md`. Replaced R3's miss-count
  weighting with a wall-clock **Leitner spaced-repetition scheduler** (`src/drills/spacedRepetition.ts`,
  pure/injected-clock): each cell/index lives in a box with an expanding day-interval `dueAt`;
  correct promotes + pushes the interval out, a miss collapses to box 0. `srWeight` feeds the
  existing weighted draw so DUE/overdue items resurface (unseen items stay high-weight so new
  material still surfaces). Grade path schedules via `reviewCard`, persists per-drill SR decks
  (fresh-start under new keys `bjtrainer.flashsr/quizsr.v1` — old miss-count keys abandoned, operator
  chose option A). **Delayed-retention measurement:** a gap review (learned item recalled after its
  interval) writes a `Stats.retention` row; a new Stats **Retention** section shows retained accuracy
  DISTINCT from in-drill accuracy — the honest table-readiness read. Shared R4 grade path + DRY
  preserved (anti-drift test extended). 2974 unit + e2e; dead R3 weight fns removed.
- **RV5 · Distraction cadence is fixed/predictable — XS — [SCI], cheapest win.** ✅ SHIPPED 2026-07-29.
  `isDistractionPoint` fired every 7th/3rd card; learners could pre-buffer the count. Now JITTERED:
  exactly one distraction per window of `interval` cards, on a window-index-seeded pseudo-random
  position within it — same average rate, unpredictable timing, still deterministic/unit-testable
  and never the first card. Setup note reworded ("unpredictable moments"). 2958 unit + 4 distraction
  e2e (made robust to a variable per-run distraction count).
- **RV6 · No integrated simultaneous-competence score — M — [PRO+SCI].** Bet/play/insurance/count
  are siloed, peek stays available, no composite "table-ready" score across all skills at once — you
  can ace each drill in isolation and still fall apart doing them together. Three design options
  (operator to pick):
  - **A · passive rollup** — weight-average existing per-skill accuracies into one Stats %. Cheap,
    but a sum of siloed numbers; does NOT test simultaneity → doesn't actually close the gap.
  - **B · live integrated scoring** — grade every axis at once during a normal table session
    (bet+play+insurance+count-kept, peek disabled) into one session score. Actually addresses the
    complaint; judgment call = axis weighting. **(Recommended.)**
  - **C · "graduation exam" mode** — fixed-length proctored session (no peek/advice, checks on,
    test feedback) → pass/fail + per-axis breakdown vs thresholds. Strongest signal; opinionated
    thresholds.
  ❌ DECLINED 2026-07-29 (operator): no composite score — individual per-skill grades are plenty,
  since the goal is to get every skill to 100% anyway. Keep skills scored separately.
- **RV7–9 · known-deferred items re-confirmed as live mistrainings:** R5 rewards min-betting a
  should-wong count (the symmetric-grading follow-on already logged under R5); bet grading demands
  exact ramp conformity with zero cover concept (RT#11); count drill grades final RC only, so
  offsetting mid-count errors pass silently (RT#12).

**Red-team's top-3 to build next:** RV1 bankroll/RoR pillar · RV2 rounding honesty + tolerance ·
RV4 time-based spacing + retention measurement. (RV5 is the cheapest standalone win.)

### Experiential / behavioral training features (operator-requested research 2026-07-29) — full doc: `docs/research/2026-07-30-experiential-training-features.md`
The "behavioral half" of counting the drills don't touch — discipline, composure, judgment under
real-table conditions. Grounded in pressure-training science (practicing under simulated pressure
≈ Hedges' g 0.67 [SEARCH-SNIPPET], effective only when calibrated/progressive and GATED behind
base fluency — so all of these are late-stage modes behind `competenceGate.ts`). **OPERATOR
DECISION 2026-07-31: drop ET2/ET4/ET6; build ET7 → ET3 → ET5 → ET1 (quick-wins-first order),
frontloaded design answers below.**
- **ET1 · Downswing / tilt inoculation session — L — flagship (= RV1's experiential half). BUILD 4th.**
  DESIGN (operator): delivery = **RIGGED REAL HANDS** (engine plays a real, rigged 30–40 buy-in
  losing run; you bet + play each); grading = **spread-conformity ONLY** (did you keep betting your
  ramp through the downswing?) — operator explicitly does NOT want temptation prompts or an
  urge-to-deviate self-report. The one thing CVCX can't rehearse.
- **ET2 · Loss-of-count recovery — ❌ DROPPED (operator 2026-07-31).**
- **ET3 · Risk-decision: bet / sit / leave — M. BUILD 2nd.** Adds the *leave* axis to R5 wong-out.
  Grading rule = the RESEARCHED consensus (`docs/research/2026-08-01-bet-sit-leave-consensus.md`):
  TC≥0→BET; TC≤−1 → LEAVE if `(TC≤−2 OR decks-remaining ≤ ~2) AND freshShoe`, else SIT. Needs a
  `freshShoe` scenario flag (the only way LEAVE is ever correct). Optional per-profile risk knob ±1 TC.
- **ET4 · Cover / heat decision — ❌ DROPPED (operator 2026-07-31).**
- **ET5 · Endurance / fatigue drift — M. BUILD 3rd.** DESIGN (operator): **ANALYTICS OVER EXISTING
  RUNS** (no new drill) — a Stats view comparing early-session vs late-session accuracy/speed (the
  vigilance decrement) from the dated drill histories; **configurable** (session-gap / min-runs
  threshold). Note: within-run latency isn't stored, so drift is measured across a session's runs.
- **ET6 · Pre-commitment / stop-loss — ❌ DROPPED (operator 2026-07-31).**
- **ET7 · Adversarial dealer-pace pressure — S — ✅ SHIPPED 2026-08-01. BUILT 1st.** A "Pace pressure"
  toggle on the count drill: seeded sudden speed-up **bursts that recover** (operator's choice; not
  escalating) — `drills/pacePressure.ts` (pure, one burst per 8-card window at a seeded offset,
  2.5× during the burst), applied to the ordinary auto-flash interval; setting `drill.pacePressure`
  (migration-safe, default off). Distinct from Timed Challenge (smooth ramp) + distractions. 6 unit
  + e2e (toggle persists + pressured run grades).
Out-of-scope (in-casino/two-person): physical act-natural tells, table-talk, team wonging, deck heft.

---

**Build order — OPERATOR-SET 2026-07-26:** R1→R2→R3→D1 ✅ done. NEXT: **T0 complete
functional test coverage** → **R7** peek accountability → **R4** interleave → **R5**
wonging → **R8** community mechanics → **R9** spot-reading → then the rest (R6, D2,
follow-ons). (Supersedes the original convergence order below; R6 deprioritized by the
operator, still open.)

### T0 · Complete functional test coverage (operator request 2026-07-26) — M — **NEXT**
Not "more tests" — a *coverage guarantee*: every screen, drill mode, setting/toggle, and
shipped feature is exercised by an automated test, plus one full-journey smoke run. Known
gaps to close: (1) **clip audio PLAYBACK is e2e-bypassed** (`?e2e=1` short-circuits it) — a
whole feature verified only by a manual deployed-site probe; needs a committed repeatable
test against a real built+served site with the actual mp3s. (2) ProfileEditor rule toggles
(decks/S17/DAS/LS/RSA/bj65/penetration) + Seats + bet-spread editor not each exercised. (3)
audio Settings (useClips, clipVoice picker, rate→3x, pause→0, cardDetail full/rank/face).
(4) keyboard input across all drills (only flashcard "2" + count digit are e2e'd). Deliver:
a coverage MATRIX doc (feature→spec|GAP), e2e specs filling every gap, a single
full-journey smoke spec touching every screen+mode, and the clip-playback harness.

**Original convergence order (superseded, kept for rationale):** R1 → R2 → R3 → D1 →
R5/R6 → R4 → R8. R1 first was non-negotiable: it's the instrument the rest are measured with.

## Parked (unchanged)
M6 bot-mistake RNG correlated with shoe seed · M8 bot cards render instantly while
narration paces · `dealSpeedMs` stale in-flight timer · ~~`cvcxParse` single-space
decorated negative TC~~ ✅ FIXED 2026-07-29 (parseColumns now joins a ≤/<= decoration
like it already did for "TC"; `≤ -1 1` single-space pastes parse) · payout audit's 2
trivial insurance quadrants · `game.ts` ~949 lines · `Stats.tsx` reads
`loadSettings().audio` directly.

---

## The standing adversarial + research workflow

Run when the operator asks for "what's next", or after any major ship. Three legs, then
a synthesis pass into this file's Candidates section:

1. **ADVERSARIAL red-team**: a fresh agent attacks the CURRENT app as a training
   system from two personas — a professional counter ("what will still fail at a real
   table despite acing every drill here?") and a learning scientist ("what does this
   training regime mistrain or leave unmeasured?"). Output: ranked attack list with a
   concrete feature/fix per attack.
2. **TRAINING-SCIENCE research**: evidence hunt on skill-acquisition literature —
   dual-task/distraction training, interleaving vs blocking, spaced repetition,
   speed-accuracy tradeoffs, difficulty progression — mapped to concrete app changes,
   cited, `[VERIFIED]`/`[INFERENCE]` tagged.
3. **COMMUNITY deep-hunt**: training methods practitioners actually describe, drills
   coaches assign, complaints about existing trainers — using sources that worked last
   time (Blackjack Info archives, qfit manuals, CasinoCityTimes) plus new angles for
   the blocked ones (Reddit remains hard-blocked; treat absence as unknown, not
   negative).

Rules carried from the first research pass: cite a URL per claim, quarantine
search-snippet-only sources, say plainly when evidence is thin, and never let a lead
into Candidates without a one-line "why it makes the counting practice better".

---

## T0 status (2026-07-26) — coverage sweep DONE, 1 real bug + smoke test remain

**Shipped:** 88 e2e (from 49). Closed 26 of 28 gaps across profiles (81cfd7a), table+stats
(23b01cd, 3703d4e), clip-playback harness + audio settings (cb07fba, 998606b), drills
sub-modes + keyboard (02410f7, 370e08b). The headline gap — REAL clip audio playback — now
has an automated `chromium-audio` Playwright project (no `?e2e=1`, autoplay arg) asserting
real mp3 fetches + no-hang + zero console errors. Whole sweep found ZERO app bugs except:

**T0-BUG1 · Dim-screen toggle unreachable by tap — ✅ FIXED 2026-07-27 (option (b)).**
The eyes-free "Dim screen" checkbox is `disabled` until eyes-free is on, but turning eyes-free
on mounted `.zone-pad` (`position:fixed; inset:0; z-index:60`, opaque) which physically covered
that checkbox — a real tap/click was intercepted (Playwright confirmed, not a headless artifact;
a real finger hit the same overlay).
  Fix (option (b), the pad's-own-rect geometry route): `.drill-screen` now measures its
  `.drill-inline-controls` control strip via a shared `useControlStripBottom` hook
  (ResizeObserver, no magic px) and publishes the strip's bottom edge as a `--zone-pad-top`
  CSS var; `.zone-pad` starts at `top: var(--zone-pad-top, 0px)` instead of `top:0`, so the
  strip (and its Dim-screen/Eyes-free toggles) stays uncovered and tappable while the pad
  still covers the whole card/dealer area below. hitTestZone is unaffected — ZonePad computes
  every zone from its OWN getBoundingClientRect, so the five zones just re-fit the smaller
  area. Touched: `src/ui/screens/Drills.tsx`, `src/ui/app.css`. Regression guard: the
  dim-screen e2e now asserts a REAL `.check()` (no `force:true`); the coordinate-based
  ZonePad quadrant taps in `e2e/drills.spec.ts` + `e2e/audio.spec.ts` were switched to
  pad-relative bounding-box taps (a hardcoded top-of-viewport coord now lands on the strip
  above the offset pad). All e2e green — the dim-real-click and the quiz-quadrant tests pass
  TOGETHER (the exact pair the naive z-index bump couldn't satisfy). Screenshot-reviewed.
  ⚠️ TRAP (learned 2026-07-26, avoided): the naive fix — raise `.drill-inline-controls` to
  `z-index:70` above the pad — WORKS for reachability but then the top control strip
  intercepts taps meant for the pad's TOP quadrants (Hit/Stand), breaking the
  quiz-action-ZonePad test. NOT used.

**T0 remaining deliverable · Full-journey smoke spec** (matrix gap #2, spec in
`docs/research/2026-07-26-test-coverage-matrix.md` § "SPEC — Single full-journey smoke test").
One `e2e/smoke.spec.ts` walking Home→Profiles→Settings→Table→each of the 5 Drills→Stats in one
session, asserting each screen mounts + a session/drill history wrote through. Held (5h sleep
threshold); dispatch next full window. THEN R7.
