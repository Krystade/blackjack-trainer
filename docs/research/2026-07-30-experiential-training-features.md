# Experiential / Behavioral Training-Function Features — Research Report

Date: 2026-07-30
Method: web search + direct page fetch (practitioner forums/blogs, poker-tilt psychology,
skill-acquisition & pressure-training science) layered on this repo's prior research
(`2026-07-21-practitioner-pain-points.md`, `2026-07-23-training-science.md`,
`-community-methods.md`). No code written; research artifact only, feeds `docs/BACKLOG.md`
(operator will synthesize into RV1-adjacent planning). Claims tagged
`[VERIFIED]` (read on a live page) / `[SEARCH-SNIPPET]` (search-summarizer only, not
individually re-fetched) / `[INFERENCE]` (my cross-domain reasoning, no source asserts it).

## Framing: the "behavioral half" the drills don't touch

The app already drills the **mechanical half** of counting extremely well — count/true-count
speed, deck estimation, chart & index accuracy, pair-cancellation, distraction-holding,
wong-out, messy cards. What no drill in the app trains is the **behavioral half**: the
discipline, composure, and judgment that decide whether a *technically* perfect counter
actually keeps their edge at a real table over a real (variance-drenched, fatiguing,
watched) session. This is exactly the seam the operator named — "keep to your spread
without tilting through a 40-buy-in drawdown" is a *behavior* CVCX's numbers describe but
cannot rehearse.

The science backs this as a trainable, separable target. **Pressure training** — physically
rehearsing the real skill under simulated psychological pressure — moves later
under-pressure performance with **Hedges' g ≈ 0.67** across performance domains (sport, law
enforcement), on par with other performance-enhancement interventions (g ≈ 0.57)
[SEARCH-SNIPPET — Low, Butt, Payne et al., *Sport, Exercise, and Performance Psychology*
2021, meta-analysis], and **stress-inoculation training** builds resilience "as long as the
exposure is calibrated and progressive" [VERIFIED — search synthesis of SIT literature;
RAND SIT report already cited in `training-science.md` §1]. The design rule this repo has
already adopted for hard modes — *add difficulty only after a competence floor* — applies
here too: these are late-stage modes gated behind mechanical fluency, not onboarding.

A key scoping line runs through this whole category: the **decision/composure** part is
solo-software-drillable; the **physical performance** part (act-natural body language,
table-talk banter, hand-signal muscle memory, team signaling) is inherently in-casino or
two-person and is flagged out-of-scope below.

---

## Candidate features — ranked

Ranked by (behavioral value) × (groundedness) × (solo-drillability). Effort XS/S/M/L.

| # | Feature | Vein | Why it matters (behavioral skill trained) | Source / evidence + tag | Solo-drillable? | Effort |
|---|---------|------|--------------------------------------------|--------------------------|-----------------|--------|
| 1 | **Downswing / tilt inoculation session** (the seed). A session runner that force-feeds an *accelerated, deterministic* bad-variance sequence (e.g. live a scripted 30–40 buy-in drawdown in minutes), keeps the correct bet-spread on, and grades **spread conformity under stress**: did you shrink your top bet, skip a called-for raise, or over-bet to chase after the losing streak? Emotional checkpoints ("how tempted were you to deviate?") logged against actual deviations to build tilt *self-awareness*. | Variance / tilt / betting-discipline through a drawdown | The one thing CVCX can't do — rehearse the *behavior* of variance, not its math. "Under-betting is where a large portion of your edge disappears"; "Over-betting destroys bankrolls faster than any cold shoe" [VERIFIED — cardcountingcanada]. Poker literature: "over time, tilt has a much bigger effect on the bankroll than variance does"; tilt = "cognitive distortions… misinterpret variance as personal injustice" [SEARCH-SNIPPET — cardplayer/primedope]. Pressure-training g≈0.67 [SEARCH-SNIPPET]. | **Yes** — a scripted losing shoe sequence + the app's existing bet-vs-ramp grader; no in-casino element. | **L** |
| 2 | **Loss-of-count recovery drill.** Mid-shoe the count is genuinely taken from the player (cards briefly obscured / a "you lost it" flash), and they must either (a) estimate a *plausible resume RC* from discard-tray depth + last-known count and keep playing, or (b) correctly decide to flat-bet to the reshuffle. Graded on whether the recovery decision was sound (resume estimate within a tolerance band; or a correct bail-to-min), not on exact recall. | Error-recovery: recovering after a real loss-of-count | Real tables cause genuine count losses (fast/obscured deals); the trained reflex is *reason back to a plausible value or safely disengage*, not freeze or keep betting big on a count you no longer have. "You can figure what the cards might be by deduction… keep you within a reasonable range for your running count" [VERIFIED — Marchel, *Missing cards*, CasinoCityTimes]. Practitioner "the count totally left my mind" the moment attention divided [VERIFIED — WoV NOOB thread]. **No existing trainer drills recovery-from-a-known-gap** (prior repo research). | **Yes** — reuses the discard-tray depth cue (R6) already shipped. | **M** |
| 3 | **Risk-decision calibration: bet / sit / leave.** Rapid-fire scenario snapshots (count + penetration + *current bankroll* + rules) where the player chooses among **bet-this-size / sit this round / leave the table**, graded on the EV-vs-risk tradeoff using the profile's own CVCX-imported numbers. Trains judgment as a *decision*, using numbers the operator already owns. | Risk-decision calibration | Turns CVCX's static numbers into a trained reflex: "you have to be disciplined about your betting ramps and spread… traps that even good, experienced counters fall into" [SEARCH-SNIPPET/VERIFIED — WoV losing-streak]. Extends R5's binary wong-out to a full 3-way judgment incl. the **leave** axis (RoR/heat) R5 lacks. | **Yes** — scenario generator over count×bankroll; grader reads imported profile EV/RoR. | **M** |
| 4 | **Cover / heat decision drill.** Scenario cards ("TC +4, 40 min in, up 15 units, pit boss just walked over — press the bet, hold, flat one round, or leave?") graded against the practitioner cover-play rule: cover only when (1) it reduces heat you'd otherwise get, (2) and its EV cost < the heat it removes. | Cover / camouflage as a *decision* skill (heat awareness) | Cover is a genuine skill with a crisp decision rule counters state explicitly: cover only when "without it you'd get more heat, with it less heat, and the cost is less than the EV you're giving up… if cover is expensive you're better off not covering" [VERIFIED — WoV camouflage thread / LVA]. Structured/mechanical spreads are the #1 tell [VERIFIED — bj21, casino.org]. | **Decision: yes.** The *physical* act-natural / mannerisms half is in-casino → **out of scope** (see below). | **M** |
| 5 | **Endurance / fatigue-degraded session + drift analytics.** A long, deliberately low-stimulation session (N shoes / 45–60 min) whose scoring focus is the **decay curve**: does count/bet accuracy and R1 latency degrade in the back half vs the front half? Surfaces the personal lapse-point and a "when to quit" pacing signal. | Stamina / endurance; session-length pacing | The **vigilance decrement** is one of the most robust findings in attention research — sustained performance on a monotonous task reliably degrades over time (resource-depletion + mind-wandering + motivation) [VERIFIED — Frontiers/PMC vigilance reviews]. Practitioners: "regardless of experience, concentration drops, and even a split-second lapse is enough to make a costly mistake" [SEARCH-SNIPPET — BJA, via `pain-points.md`]. Every current drill is a *short burst* — nothing measures decay. | **Yes** — mostly analytics over a long run of existing engine + shipped R1 latency telemetry. | **M** |
| 6 | **Pre-commitment / stop-loss adherence.** Before the session the learner commits a plan (bankroll, spread, **stop-loss**, win-goal, max length). The sim then *tempts deviation* — a drawdown that stops just short of the stop-loss, a hot streak past the win-goal — and grades adherence to the player's **own** pre-set boundaries. | Bankroll psychology / discipline under pressure | Poker's most-cited anti-tilt tool: "many successful players use a stop-loss of 2–3 buy-ins per session, and once reached they end play regardless of how they feel" [SEARCH-SNIPPET — somuchpoker/cardplayer]. Trains honoring quit-points against in-the-moment emotion. Pairs naturally with #1/#5. | **Yes** — pre-commit form + scripted temptation events + adherence grade. | **M** |
| 7 | **Adversarial dealer-pace pressure.** Sudden, unpredictable mid-shoe *speed-ups* (the "dealer sped up once he pegged me as an amateur" stressor) as a composure test, optionally with the self-inflicted "announce your own hand total" verbal load. Distinct from shipped distraction (D1, unrelated interruptions) and jittered cadence (RV5, same *average* pace). | Speed/pressure; split-attention composure | The single most-repeated real-table shock: "dealt the cards very quickly… I was guesstimating the count" [VERIFIED — Medium]; "it's those god-awful slow… dealers" and *variation* in pace, not one fixed speed, is the complaint [VERIFIED — BJ Info]. Community §8: real distraction includes the player's **own** required speech (announcing totals) [SEARCH-SNIPPET]. | **Yes** — a pace-shift schedule layered on any count drill. | **S** |

### Explicitly out of scope (inherently in-casino or two-person — flagged, not proposed)
- **Physical "act natural" / mannerisms cover** — body language, hiding lip-moving/head-darting tells, chip handling. The *decision* to cover is #4; the *performance* of cover is not solo-software-drillable. [VERIFIED tells: Medium "Misadventures" — head darting, whispering the count got a pair made.]
- **Table-talk banter as a two-person social skill**, **team wonging / big-player signaling**, **physical deck-brick heft estimation** — all inherently in-casino or two-person [SEARCH-SNIPPET — community-methods §8; bj21]. (Note: the *cognitive* count-through-distraction slice is already shipped as D1.)

---

## Top 3 to consider

**1 — Downswing / tilt inoculation session (#1, the seed).** This is the flagship of the
whole category and the operator's own example. It is the *only* feature that rehearses the
behavior CVCX describes but can't build, it has the strongest convergent grounding
(blackjack practitioners on over/under-betting through swings + poker tilt psychology +
pressure-training meta-analysis), and it is cleanly solo-drillable (a scripted variance
sequence run through the existing engine + the bet-vs-ramp grader the app already has for
RV7/RT#11). Effort is L because it needs a session runner that force-feeds outcomes, a
spread-conformity grade under stress, and the emotional-checkpoint telemetry that turns it
from a game into *tilt self-awareness* training — but every piece composes over existing
systems. Build #6 (stop-loss adherence) as the natural second layer on the same runner.

**2 — Loss-of-count recovery drill (#2).** Highest novelty-to-effort: **no trainer found in
any prior research pass drills recovery from a known count-gap**, yet losing the count is a
top-cited real-table failure and the expert response (deduce a plausible resume value, or
safely disengage) is a concrete, gradeable decision. M effort, and it reuses the shipped
discard-tray depth cue. It converts a moment learners currently *panic* through into a
rehearsed reflex.

**3 — Risk-decision: bet / sit / leave (#3).** Best leverage on the operator's existing
CVCX investment: it turns numbers they already own into a trained *judgment* rather than a
lookup, and it fills the genuine gap R5's binary wong-out leaves — the three-way
bet/sit/**leave** decision with bankroll and heat in the frame. M effort, high transfer to
the actual moment-to-moment decisions a session is made of.

Runners-up: **#5 endurance/drift** is the best-evidenced by pure science (vigilance
decrement) and cheap-ish (mostly analytics over R1 telemetry) — strong if the operator
wants a low-risk M; **#4 cover-decision** is valuable and crisply gradeable but its content
authoring is the real cost and part of the skill is out-of-scope. **#7 dealer-pace** is the
cheapest (S) and a good realism add, but it's more a drill-stressor than a full behavioral
mode.

**Cross-cutting note:** #1, #5, and #6 share a *pressure-session runner* substrate (scripted
outcomes + adherence/deviation grading + emotional-state telemetry). If more than one lands,
build that substrate once. All of these are late-stage modes — gate behind mechanical
fluency per the repo's established competence-gate rule (`competenceGate.ts`); stress
inoculation only works "after the base skill is fluent," never from drill zero.

---

## Sources

Directly fetched / verified this pass:
- [Blackjack Losing Streak — How Advantage Players Handle the Swings, cardcountingcanada.ca](https://cardcountingcanada.ca/blackjack-losing-streak-how-advantage-players-handle-the-swings/)

Verified via search-engine synthesis (not individually re-fetched; tagged [SEARCH-SNIPPET] inline):
- [Pressure training for performance domains: A meta-analysis, Low/Butt/Payne et al. 2021](https://researchportal.hw.ac.uk/en/publications/pressure-training-for-performance-domains-a-meta-analysis/) (g≈0.67; ResearchGate/SHURA PDFs 403/unparseable)
- [Poker Psychology: Tilt Control, cardplayer.com](https://www.cardplayer.com/online-poker/poker-psychology); [The Psychology of Poker Tilt, primedope.com](https://www.primedope.com/the-psychology-of-tilt-how-to-recognize-and-manage-emotional-triggers-in-poker/); [Poker Psychology Part 7 — Bankroll, somuchpoker.com](https://somuchpoker.com/news/poker-psychology-part-7-bankroll) (stop-loss 2–3 buy-ins; tilt > variance on bankroll)
- [Blackjack card counting losing streak?, Wizard of Vegas](https://wizardofvegas.com/forum/gambling/blackjack/22748-blackjack-card-counting-losing-streak/); [How do you deal with variance?, Blackjack Info](https://www.blackjackinfo.com/community/threads/how-do-you-deal-with-variance.20825/)
- [Blackjack Counting Camouflage (Cover) Techniques, Wizard of Vegas](https://wizardofvegas.com/forum/gambling/blackjack/9661-blackjack-counting-camouflage-cover-techniques/); [Blackjack Betting Camouflage, Las Vegas Advisor](https://www.lasvegasadvisor.com/gambling-with-an-edge/blackjack-betting-camouflage/); [Fitting in at a casino, bj21.com](https://bj21.com/articles/card-counting/fitting-in-at-a-casino)
- Vigilance decrement: [Examining the Role of Task Requirements in the Magnitude of the Vigilance Decrement, Frontiers/PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6109784/)
- Stress-inoculation / simulation transfer: [Efficacy of Transfer in Simulation-Based Training (Stress Exposure Training)](https://www.researchgate.net/publication/242493355_Efficacy_of_Transfer_in_Simulation-Based_Training_Implications_for_Stress_Exposure_Training); [Decision Making Under Stress](https://www.kravmagaexperts.com/decision-making-under-stress/)

Internal cross-references (higher confidence, already-verified in this repo):
- `docs/research/2026-07-21-practitioner-pain-points.md` — real-table shock, dealer speed, long-session concentration drop, over-betting error, behavioral tells.
- `docs/research/2026-07-23-community-methods.md` §5 (Marchel *Missing cards* deductive recovery), §8 (out-of-scope two-person/in-casino modalities).
- `docs/research/2026-07-23-training-science.md` §1 (stress-inoculation sequencing; RAND SIT), §5 (competence-gate rule).
- `docs/BACKLOG.md` — RV1 (parked bankroll/variance pillar; experiential half wanted), R5 (wong-out), R6 (discard tray), RV7/RT#11 (bet-vs-ramp grading exists).
