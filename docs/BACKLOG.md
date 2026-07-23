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

### D1 · Distraction training (operator idea 2026-07-23) — HIGH interest
Mid-drill interruptions that simulate the real-table cost of talking while counting:
pause the card stream, inject a challenge that MUST be answered, then resume; the final
count is graded as usual — the skill being trained is *holding the count through
interference*.

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

### R1 · Decision-latency telemetry + optional shot clock — S — **BUILD FIRST**
Convergence: RT#1 (no latency field on `GradedEvent`; the app can't detect absence of
automaticity — the variable that most predicts table survival) **meets** TS (speed-accuracy
literature: you can't gate on speed you don't measure) **meets** CM#3 (dealer-training
frames the target as instant *recognition*, not fast calculation). This is the
measurement layer that makes almost everything below provable — including D1 (distraction
must be scored as "count kept AND how much slower"). Add `elapsedMs` to graded events +
surface per-drill; the shot clock is a cheap follow-on. Highest leverage in the file.

### R2 · Accuracy-gate the hard modes (fix the timed ramp; gate distraction/speed/interleave) — S — **HIGH**
Convergence: TS#2+TS#3 (three independent literatures — stress-inoculation,
desirable-difficulties, speed-accuracy — converge on "unlock harder only after a measured
competence floor"; a controlled npj Science of Learning study read in full shows
schedule-driven speed pressure inflates in-drill scores without improving *retained*
skill) **meets** RT (plateau-trap findings). CONCRETE + slightly self-correcting: our
just-shipped timed drill ramps on elapsed cards, not accuracy — change it to advance a
speed tier only when accuracy holds at threshold. Also the onboarding rule for D1. Depends
on R1's measurement.

### R3 · Spaced-repetition / miss-weighted scheduling over indices + weak chart cells — S — **HIGH**
Convergence: TS#1 (spacing + retrieval practice = the most robustly evidenced technique in
the whole science report) **meets** RT#4 (flashcard miss-weights only grow, never decay;
the deviation quiz samples uniformly while per-index error tallies already exist, unused).
The telemetry to seed it is already in `Stats`. Decay-on-correct is XS; a Leitner/SM-2-ish
weighted draw is S. Directly attacks the "max the drill while the skill stays weak" trap.

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

**Recommended build order:** R1 → R2 → R3 (the measurement-and-mastery spine, all S, all
convergent) → then D1 (distraction — operator-requested, and it *needs* R1+R2 to be scored
and onboarded correctly) → R5/R6 (realism) → R4 (interleave) → R8 mechanics as appetite
allows. R1 first is non-negotiable: it's the instrument the rest are measured with.

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
