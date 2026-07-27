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

### R4 · Interleaved / mixed-session mode — M — MEDIUM-HIGH
Convergence: TS#4 (interleaving meta-analysis, Hedges' g ≈ 0.42 across 59 studies,
strongest exactly for discriminating *similar* categories) **meets** CM#2 (coaches sequence
students through mixed table-like practice, not isolated drills) **meets** the existing
fake-deviations feature (near-miss discrimination is the same skill). A session mode that
blends basic-strategy + deviation items on neighboring hands. Pairs naturally with R3.

### R5 · Wonging / sit-out practice — M — MEDIUM-HIGH (biggest *realism* hole)
RT#2, standalone but high-conviction: `startRound` always stakes; there's no sit-out, so
the most profitable shoe decision (wong out of negative counts, back-count in) is
structurally unpracticeable, and the default spread quietly teaches playing all counts. A
graded "sit out this round" action + back-counting entry drill. Larger because it touches
the game loop.

### R6 · Discard-tray depth cue on the live table — S — MEDIUM (cheap realism repair)
RT#3: table TC checks grade against the shoe's *exact* depth with no visual tray, actively
mistraining estimation and stranding the deck-estimation drill as an island. The tray-fill
visual already exists in `DeckEstimationView` — reuse it on `Table.tsx` so table count-checks
require real estimation. Cheap, and it connects a drill to its point of use.

### R7 · Count-peek accountability — XS — MEDIUM (quick integrity fix)
RT#5: the RC/TC peek button works even in test mode and is never logged, making "actual
play accuracy" uninterpretable. Log peeks; disable (or flag) in test mode.

### R8 · New drill mechanics from the community hunt — S–M each — MEDIUM/EXPLORATORY
Genuinely novel, verified in primary sources (CVBJ manual / practitioner forums):
- **Bias dealing** (CM#1): deliberately cluster same-sign cards to force counting-through-
  zero and sign-reversal reps — a weak spot random dealing under-samples. A shoe-gen param.
- **Card-removal deduction** (CM#2, repeated-theme): remove 1–2 cards before dealing; after
  the countdown the user deduces the removed card's value from count self-consistency.
  Tests correctness, not just speed. Novel — no existing trainer found with it.
- **Pair-cancellation drill** (CM/TS#5 convergence): drill recognizing canceling pairs
  (e.g. a +1 and a −1 arriving together = 0) as a unit — the chunking stage after
  single-card speed. Backed by chess-chunking research AND the community progression.
- **Guided 15-min session template** (CM): warm-up → speed → true-count → hidden-value with
  a month-over-month error target. Provenance is template-like (flagged), so treat as a
  packaging idea for R1–R5, not its own evidence.

### R9 · Spot-reading / obscured-card recovery — M — LOW/EXPLORATORY
CM#4+CM#5: recognizing cards by pip layout (pips-not-numerals), and reasoning backward from
a visible outcome to a hidden card's count value. Interesting, niche; park unless a session
surfaces demand.

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
narration paces · `dealSpeedMs` stale in-flight timer · `cvcxParse` single-space
decorated negative TC · payout audit's 2 trivial insurance quadrants · `game.ts` ~949
lines · `Stats.tsx` reads `loadSettings().audio` directly.

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

**T0-BUG1 · Dim-screen toggle unreachable by tap — REAL, still open (HIGH, small-but-careful).**
The eyes-free "Dim screen" checkbox is `disabled` until eyes-free is on, but turning eyes-free
on mounts `.zone-pad` (`position:fixed; inset:0; z-index:60`, opaque) which physically covers
that checkbox — a real tap/click is intercepted (Playwright confirmed, not a headless artifact;
a real finger hits the same overlay). The dim-screen e2e currently reaches it via Tab+Space
(keyboard bypasses the pointer hit-test) and documents the bug.
  ⚠️ TRAP (learned 2026-07-26): the naive fix — raise `.drill-inline-controls` to
  `z-index:70` above the pad — WORKS for reachability but then the top control strip
  intercepts taps meant for the pad's TOP quadrants (Hit/Stand), breaking the
  quiz-action-ZonePad test. Reverted. The real fix must keep the pad's tap zones clear:
  options = (a) move the Dim-screen (and maybe Eyes-free) toggle into a pre-Start setup area /
  Settings so it's set BEFORE the pad mounts; or (b) inset the pad BELOW the control strip
  (`top: <controls height>` not `inset:0`) — the pad hit-test uses its own bounding rect so
  geometry stays correct. Needs a screenshot review (visual, can't fully verify headless).

**T0 remaining deliverable · Full-journey smoke spec** (matrix gap #2, spec in
`docs/research/2026-07-26-test-coverage-matrix.md` § "SPEC — Single full-journey smoke test").
One `e2e/smoke.spec.ts` walking Home→Profiles→Settings→Table→each of the 5 Drills→Stats in one
session, asserting each screen mounts + a session/drill history wrote through. Held (5h sleep
threshold); dispatch next full window. THEN R7.
