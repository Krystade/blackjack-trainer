# Training-Science Research: What Skill-Acquisition Literature Says About Drill Design

Date: 2026-07-23
Method: web search + direct fetch of meta-analyses, primary studies, and review articles on skill
acquisition, memory, and motor/procedural learning. No code written; this is a research artifact
only, feeding `docs/BACKLOG.md`. Several canonical PDFs (Bjork & Bjork "Introducing Desirable
Difficulties," the Brunmair & Richter interleaving meta-analysis PDF, Cepeda et al. 2006 PDF) could
not be text-extracted by the fetch tool (binary/compressed streams); where that happened, findings
are triangulated from HTML-rendered sources (PMC, Wikipedia, publisher abstract pages, secondary
summaries citing the same statistics) instead, and this is flagged inline.

Ranked by (evidence strength) × (applicability to this specific app). Section 1 is both the
best-evidenced and most directly actionable; sections are not strictly ordered after that since
strength and applicability trade off differently per topic.

---

## 1. Dual-task / distraction training — evidence is real but comes from an adjacent literature, and it says WHICH kind of interference matters

**What's actually been studied.** There is no meta-analysis of "training card counters under
conversational distraction" — the literature that transfers here is (a) motor-cognitive dual-task
training in rehabilitation/aging populations, and (b) classic working-memory interference studies
(Baddeley's phonological loop). Both are relevant but neither is a direct hit, so confidence here is
**moderate**, not high, despite the volume of material.

- **Task-specificity of the secondary task strongly predicts interference size.** A 2026
  meta-analysis of dual-task walking studies found verbal-fluency secondary tasks produce
  *reliably larger* interference than serial-subtraction (arithmetic) secondary tasks, attributed to
  verbal fluency competing for the same prefrontal/language resources the primary task also uses.
  [VERIFIED] — [Verbal Fluency Dual-Tasks Show Greater Age-Related Cognitive-Motor Interference: A
  Meta-Analysis of Walking Performance, PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12496288/)
  This is domain-general evidence for "similarity of interference to the primary task's cognitive
  substrate matters," not blackjack-specific, so treat the direction (not the magnitude) as
  transferable. [INFERENCE: applies to counting]
- **The classic mechanism explaining *why* numeric interference should be maximally disruptive for a
  running count**: Baddeley's phonological-loop model holds that verbal/numeric rehearsal (subvocal
  "+1, +1, -1...") occupies the same articulatory-rehearsal resource that a spoken secondary task
  also needs. Concurrent articulatory suppression and concurrent counting tasks have been shown
  experimentally to substantially disrupt each other precisely because they compete for the same
  loop, not just for general attention. [VERIFIED, well-established model with direct experimental
  support] — [Baddeley's Model of Working Memory, Wikipedia](https://en.wikipedia.org/wiki/Baddeley%27s_model_of_working_memory);
  corroborating summary of counting-task interference: [search-aggregated, multiple primary studies
  cited — treat statistic as directionally solid, not individually re-verified]
- **The irrelevant-speech effect**: task-irrelevant *spoken* material (even meaningless) reliably
  degrades serial recall of verbal sequences more than expected from generic distraction, because it
  intrudes directly into phonological rehearsal. This is one of the most replicated effects in
  working-memory research. [VERIFIED] — [Irrelevant speech impairs serial recall of verbal but not
  spatial items in children and adults, PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9950248/)
- **Putting these two threads together**: the operator's instinct that *near-count math* (numbers
  adjacent to the running count) is the "maximally confusable" interference type is well-grounded —
  it's asking the phonological loop to hold two competing numeric streams simultaneously, which is a
  harder within-resource collision than generic trivia (which, per the verbal-fluency-vs-arithmetic
  finding above, may actually interfere *less* with a numeric primary task than another arithmetic
  task would, not more). This is a testable but **not yet directly tested** claim in this specific
  domain — no study of "counting + concurrent arithmetic" specifically was found. [INFERENCE, built
  from adjacent literature, not a direct study]
- **Stress-inoculation / training-under-load literature** (military/aviation) broadly supports
  practicing under the conditions you'll perform under: operators trained with stressors embedded
  build "a repertoire of coping skills flexibly applied in demanding situations" and expertise itself
  is protective against overload. This is the applied-training-design analog of dual-task-specificity
  and supports scheduling distraction training progressively (introduce after base skill is solid, not
  from day one) rather than proving a specific interference type is best. [VERIFIED, applied
  literature, not blackjack-specific] — [Enhancing Performance Under Stress: Stress Inoculation
  Training for Battlefield Airmen, RAND](https://www.rand.org/pubs/research_reports/RR750.html)
- **Specificity-of-practice principle**: transfer is best when practice conditions match
  performance conditions (the classic illustration is Godden & Baddeley's land/underwater word-recall
  study, though a 2021 replication attempt did not reproduce the effect — flag this as **contested**,
  not settled). The safer, still-standard reading is "train under load if you'll perform under load,"
  not the stronger "context must match exactly." [VERIFIED but contested at the level of the classic
  study] — [The Godden and Baddeley (1975) experiment... a replication, PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8568063/)

**Bottom line**: the operator-requested near-count-math interruption feature (D1 in the backlog) is
well-grounded in mechanism (phonological-loop competition) even though no study tests blackjack
counting specifically. The literature adds two refinements the backlog item doesn't yet have: (1)
numeric/arithmetic secondary tasks plausibly interfere *differently* — likely more directly, via
shared resource — than generic verbal trivia, so "near-count math" is probably a better primary lever
than "generic quiz questions," which may end up training a different (milder) skill; (2) distraction
training should be introduced only after the base count is fluent (stress-inoculation framing), i.e.
gated behind a speed/accuracy threshold, not offered from drill zero.

→ **concrete app change**: keep D1 as designed, but bias its default/first-unlocked interference type
toward near-count math over generic trivia, since the mechanism evidence favors the numeric-collision
theory over the generic-distraction theory. **[SUPPORTS-QUEUED: D1] — S** (tune existing planned
feature's default ordering, not a new build)
→ **concrete app change**: gate distraction-mode unlock behind a base-competency threshold (e.g., a
clean sub-30s deck count) rather than exposing it from the first session, per stress-inoculation
sequencing. **[SUPPORTS-QUEUED: D1] — XS** (an unlock condition on an already-planned feature)

---

## 2. Interleaving vs. blocking — strong, well-quantified evidence; directly actionable

This is the best-evidenced section in this report: a 2019 multilevel meta-analysis (59 studies, 238
effect sizes) found a **moderate overall interleaving effect, Hedges' g = 0.42**, with the crucial
caveat that the benefit is *moderated by material type and similarity structure*, not universal.
[VERIFIED] — [Similarity Matters: A Meta-Analysis of Interleaved Learning and Its Moderators
(Brunmair & Richter, 2019, Psychological Bulletin), summarized via search + abstract pages since the
primary PDF could not be text-extracted](https://www.researchgate.net/publication/335004545_Similarity_matters_A_meta-analysis_of_interleaved_learning_and_its_moderators)

- **Interleaving helps most when categories are perceptually/conceptually similar to each other but
  internally varied** — exactly the structure of telling apart "hit vs. stand vs. double" decisions
  across neighboring hand totals, or telling apart which of several close indices applies. Math-task
  interleaving specifically showed g = 0.34 (smaller than the visual-category domains but still
  reliably positive and non-trivial). [VERIFIED] — same meta-analysis.
- **A separate, directly domain-relevant line**: Rohrer & Taylor's math-practice-problem studies found
  shuffling (interleaving) problem *types* within a practice set improves later test performance versus
  blocking by type, even though blocked practice *feels* easier and produces better immediate-set
  performance. [VERIFIED] — [The shuffling of mathematics problems improves learning, Instructional
  Science 2007](https://link.springer.com/article/10.1007/s11251-007-9015-8); mechanism work explains
  this as **discriminative contrast**: interleaving forces the learner to notice *which* solution
  procedure a given problem calls for, which is precisely the skill "should I hit, double, or use a
  deviation index here" requires. [VERIFIED] — [Why does interleaving improve math learning? The
  contributions of discriminative contrast and distributed practice, Memory & Cognition](https://link.springer.com/article/10.3758/s13421-019-00918-4)
- **Contextual-interference research in motor learning** (a parallel, independently-converging
  literature) reports the same performance/retention split: blocked ("low interference") practice
  produces *better acquisition-phase performance* but *worse retention and transfer*; high-interference
  (random/interleaved) practice is the reverse. [VERIFIED, per meta-analysis abstract] — [High
  contextual interference improves retention in motor learning: systematic review and meta-analysis,
  Scientific Reports 2024](https://www.nature.com/articles/s41598-024-65753-3) (full text sat behind an
  auth wall on fetch; the finding is corroborated independently by the medical-education motor-learning
  review below, so treated as [VERIFIED] via convergent secondary sourcing.)
- **Caveat that matters for this app**: the interleaving advantage is largest for *discriminating
  between similar things*, which argues specifically for mixing basic-strategy hands with deviation
  situations that are easy to confuse (e.g., stand-vs-hit boundary totals, insurance-adjacent counts) —
  not for randomly shuffling unrelated content (e.g., mixing counting-speed drills with flashcards has
  weaker theoretical grounding than mixing *decision*-type drills with each other, since the mechanism
  is about discriminating similar categories, not generic variety).

→ **concrete app change**: add a "mixed session" mode that interleaves basic-strategy flashcards and
deviation-quiz items drawn from the *same or neighboring* hand totals/dealer upcards in one continuous
sequence, rather than only offering them as separate single-skill drills. **M** (needs a session
composer across two existing drill engines, plus telemetry to track it as a distinct mode)
→ **concrete app change**: within the deviation quiz specifically, interleave true "index applies"
cases with visually/numerically similar non-index situations (near-miss distractors, which the app
already has) at a *higher* rate than uniform random, since discriminative-contrast is the mechanism
that benefits the most from similarity, not novelty. **S** (reweights an existing distractor system)

---

## 3. Spaced repetition / retrieval practice for memorized components — very strong general evidence; the specific "which scheduler" question is less settled

- **The testing effect and spacing effect are among the most robust findings in learning science.** A
  large-scale synthesis (242 studies, 1,619 effects, 169,179 participants) rates "distributed practice"
  and "practice testing" as the most effective of ten common learning techniques studied. [VERIFIED] —
  cited via [A Meta-analytic Review of the Effectiveness of Spacing and Retrieval Practice for
  Mathematics Learning, Educational Psychology Review 2025](https://link.springer.com/article/10.1007/s10648-025-10035-1),
  which itself reports the effect **does replicate in math-adjacent domains but is smaller there**: g
  = 0.28 for spacing vs. massing (27 studies), while the pure testing-vs-restudy effect in math specifically
  was g = 0.18 with a confidence interval crossing zero — i.e., **not statistically reliable in
  procedural/math-like content specifically**, unlike its very strong effect in verbal/declarative
  recall. [VERIFIED, same source] This is an important nuance: indices and chart cells are closer to
  declarative recall (a fact: "16 vs 10, count ≥0 → stand") than to open-ended math problem-solving, so
  the stronger verbal-recall effect sizes likely apply better than the weaker math-specific ones.
- **The foundational spacing meta-analysis** (Cepeda, Pashler, Vul, Wixted & Rohrer 2006; 317
  experiments, 184 articles) established that the *optimal gap between study sessions scales with how
  long you need to remember it* — the spacing interval that maximizes final retention grows as the
  desired retention interval grows. [VERIFIED via multiple independent secondary summaries; primary
  PDF could not be text-extracted by the fetch tool] — [Distributed Practice in Verbal Recall Tasks: A
  Review and Quantitative Synthesis, Psychological Bulletin 2006](https://www.yorku.ca/ncepeda/publications/CPVWR2006.html).
  Practical reading: a scheduler for "the 18 indices" should lengthen the review gap for indices the
  learner already knows well and shorten it for weak ones — a fixed uniform-random draw structurally
  cannot do this.
- **Successive relearning** — combining spaced *and* retrieval-based practice, requiring correct
  retrieval across multiple separated sessions rather than a single correct answer — produced more
  than a full letter-grade improvement over restudy in an authentic course setting (Rawson & Dunlosky),
  with 56% retention after two relearning sessions climbing to 83% after five, measured 30 days
  later. [VERIFIED] — [The Power of Successive Relearning: Improving Performance on Course Exams and
  Long-Term Retention, Educational Psychology Review](https://link.springer.com/article/10.1007/s10648-013-9240-4);
  practitioner summary at [retrievalpractice.org](https://www.retrievalpractice.org/strategies/2018/successive-relearning).
  This is a strong, well-quantified case for "don't just show a weak item once and move on — require
  it to be answered correctly across multiple separated sessions before treating it as learned."
- **Which specific algorithm (Leitner boxes vs. SM-2-style per-item ease factors vs. modern FSRS)
  matters less than "space it and test it" in general** — Leitner's fixed-box scheme has no per-item
  difficulty model and can't distinguish easy from hard items well, while SM-2-family algorithms add a
  per-item ease factor that adapts the interval to how hard that specific item is for that specific
  learner. [VERIFIED, mechanism-level, widely described] — [Spaced Repetition From The Ground Up,
  Control-Alt-Backspace](https://controlaltbackspace.org/spacing-algorithm/). This is engineering
  detail, not a contested empirical claim — implement *some* per-item adaptive scheduler, the exact
  formula is a lesser decision.

→ **concrete app change**: replace the deviation quiz's uniform-random index draw with a per-index
weight that increases review frequency for indices missed recently/often and decreases it for
consistently-correct ones (SM-2-style ease factor, or even a simple Leitner-box tier system as a first
cut) — this is the single most directly-actionable, best-evidenced change in this whole report given
the app already tracks per-drill accuracy telemetry to seed it. **M**
→ **concrete app change**: extend the same weighted scheduler to weak basic-strategy chart cells
identified from flashcard-drill telemetry, not just the 18 indices. **M** (shares the scheduler built
for the item above; incremental cost is mostly UI/data-mapping, not new algorithm)
→ **concrete app change**: require an item to be answered correctly across at least two separated
attempts (not just once) before demoting its review priority — i.e., adopt a lightweight
"successive-relearning" mastery gate rather than "got it right once, done." **S**

---

## 4. Speed–accuracy tradeoff training — genuinely mixed/contested; the strongest single finding argues for accuracy-first, speed-later, not simultaneous ramping

- **Direct experimental evidence on instruction framing**: in a cued sequence-learning task, a
  speed-instructed group learned one *type* of regularity (probability-based) faster during training
  than an accuracy-instructed group (F(1,46)=7.64, p=0.008) — but this speed advantage **evaporated**
  once both groups were later tested under matched, balanced instructions; i.e., speed pressure boosted
  *momentary performance during training*, not the underlying learned competence. Serial-order learning
  showed no benefit either way. [VERIFIED, read in full via PMC] — [Speed and accuracy instructions
  affect two aspects of skill learning differently, npj Science of Learning 2022, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9588023/)
  The authors' own framing is explicit: distinguish "momentary performance" (what you see during a
  timed drill) from "acquired knowledge" (what persists) — a speed-pressured learner can look better on
  the drill's own scoreboard while learning the same amount underneath.
- **A closely related independent study reached essentially the same conclusion from a different
  angle**: speed vs. accuracy instructions during skill learning did **not** measurably change how much
  was actually learned, only how it was expressed during acquisition. [VERIFIED, same conclusion,
  independent paper] — [Speed or Accuracy Instructions During Skill Learning do not Affect the Acquired
  Knowledge, Cerebral Cortex Communications](https://academic.oup.com/cercorcomms/article/1/1/tgaa041/5889933)
- **General motor-skill guidance is more mixed and somewhat domain-dependent**: some sport/motor
  literature argues speed-first ("near-maximal speed and force") builds better movement representations
  for ballistic/explosive skills, while accuracy-first is favored for precision tasks. [VERIFIED,
  general framing, moderate confidence — this literature is sport-biomechanics-specific and may not
  transfer cleanly to a cognitive/arithmetic skill like counting] — [Speed-Accuracy Tradeoff: The Key
  to Motor Skill Mastery](https://www.numberanalytics.com/blog/speed-accuracy-tradeoff-motor-skill-mastery)
- **Practitioner consensus in the counting community itself strongly favors accuracy-first**, and this
  independently converges with the two direct studies above: Blackjack Info forum posters repeatedly
  state "accuracy should always be the prime directive, not speed" and that a 25-30s countdown with
  zero errors is the real bar, not raw speed — already documented in this repo's practitioner
  pain-points report. [VERIFIED — internal cross-reference] — `docs/research/2026-07-21-practitioner-pain-points.md`
  §"Common beginner mistakes," item 2.
- **Overall assessment**: evidence converges (from a controlled lab study, a replication-style
  independent study, and independent practitioner consensus) that **ramping time pressure too early
  risks inflating a scoreboard number without building durable skill**, and that error-rate should gate
  speed increases rather than speed and accuracy being pushed simultaneously. This is stronger and more
  directly convergent than most sections in this report, though it is still only two directly-relevant
  lab studies (not a meta-analysis) plus practitioner testimony, so rate confidence **moderate-high**,
  not "settled science."

→ **concrete app change**: change the timed counting drill's speed ramp to be *accuracy-gated*: don't
advance to the next speed tier until accuracy at the current tier holds above a threshold (e.g.,
≥95-98%) across a minimum number of reps, rather than ramping on a fixed schedule regardless of error
rate. **M** (changes the existing speed-tier progression logic in `countSpeed.ts`/`countDrill.ts`)
→ **concrete app change**: surface a distinct "accuracy at this speed" stat separate from raw speed in
telemetry, so a user (and the app's own gating logic) can see when speed is being bought with errors —
directly reflects the "momentary performance vs. acquired knowledge" distinction from the npj paper.
**S**

---

## 5. Desirable difficulties & progression — strong theoretical umbrella, contested mechanism, clear practical upshot for THIS app: prerequisite-gating matters more than the specific manipulation

- **The unifying concept** (Bjork, 1994; elaborated with Elizabeth Bjork): manipulations that make
  learning *feel* harder and slower in the moment — spacing, interleaving, retrieval practice/testing,
  varying practice conditions, and delaying feedback — reliably produce *better* long-term retention
  and transfer than their easier-feeling counterparts (massing, blocking, restudying, constant
  conditions, immediate feedback). [VERIFIED, though the specific Bjork & Bjork PDF could not be
  text-extracted; corroborated via Wikipedia and multiple secondary academic summaries that agree on
  the core claims] — [Desirable difficulty, Wikipedia](https://en.wikipedia.org/wiki/Desirable_difficulty)
- **Cepeda et al.'s spacing analysis is cited elsewhere as showing a 10-30% retention boost from
  spacing** — this specific figure comes from secondary synthesis rather than being independently
  re-derived here, so treat as **[SEARCH-SNIPPET-ADJACENT]**, directionally consistent with but not
  independently re-verified against the primary meta-analysis (whose PDF could not be parsed).
- **The single most important caveat, repeated across every source on this topic**: difficulty is only
  "desirable" if the learner already has the foundational knowledge/skill to eventually succeed —
  for true novices, added difficulty is just noise, not desirable friction. [VERIFIED, appears
  consistently, including explicitly in the Wikipedia summary: "too difficult a task may dissuade the
  learner and prevent full processing"] This directly supports gating harder modes (interleaving,
  distraction, delayed feedback) behind a demonstrated baseline of competence, which is the same
  practical conclusion reached independently in Section 1 (stress-inoculation sequencing) and Section 4
  (accuracy-gated speed ramps) — three separate literatures converging on the same design rule:
  **add difficulty only after a floor is established, never from zero.**
- **Delayed feedback specifically** is called out as counterintuitively better than immediate feedback
  for retention, though this is one of the less-tested manipulations in the set and the mechanism is
  less settled than spacing/testing. [VERIFIED as a claim, moderate confidence on strength] — same
  Wikipedia synthesis; this is worth flagging as a candidate the app does *not* currently do (all
  drills give immediate feedback) but the evidence for it is thinner than for spacing/interleaving/
  testing, so treat as exploratory, not a priority.
- **Adaptive difficulty ("dynamic difficulty adjustment") research from serious-games/education**
  supports keeping challenge within the learner's zone of proximal development rather than a fixed
  ramp: DDA systems that track individual performance and adjust converge on an appropriately
  challenging level within roughly the first hour of play, and outperform non-adaptive equivalents on
  learning outcomes in at least one controlled study. [VERIFIED, though drawn from serious-games
  literature rather than blackjack/counting specifically] — [The effect of adaptive difficulty
  adjustment on the effectiveness of a game to develop executive function skills for learners of
  different ages, ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0885201418301047)

→ **concrete app change**: adopt an explicit, app-wide "prerequisite gate" pattern for every
harder-mode feature (interleaved sessions, distraction mode, faster speed tiers): each unlocks only
after a measured floor of accuracy+speed on the easier mode, rather than being available immediately —
this is a design principle more than a single feature, and it should inform D1's rollout plan
specifically. **[SUPPORTS-QUEUED: D1] — S** (a shared unlock-gate component/pattern, reusable across
future hard-mode features)
→ **concrete app change**: replace the timed drill's fixed speed-tier ramp with an adaptive difficulty
step that responds to the individual learner's recent accuracy (raise the tier when accuracy is high,
hold or ease back when it drops) instead of a fixed schedule everyone follows the same way. **M**
(overlaps with the accuracy-gating change in Section 4; can be implemented as one adaptive controller)
→ **concrete app change (exploratory, weaker evidence)**: experiment with a "reveal correct answer
after a short delay" option for flashcards/deviation quiz instead of always-instant feedback, to test
whether delayed feedback measurably improves retention in this specific app population — flag as
lower-confidence/exploratory given thinner evidence than the other manipulations. **XS** (a toggle +
telemetry split-test, not a full feature)

---

## 6. Expertise/chunking in perception — solid theoretical grounding from chess-expertise research; directly names the "cancellation principle" this app doesn't yet drill

- **The foundational finding** (Chase & Simon; later work by Gobet & Simon): chess masters recall
  briefly-shown *game* positions far better than novices, but this advantage collapses almost entirely
  when pieces are placed *randomly* on the board — proving the advantage is pattern/chunk recognition
  built from meaningful structure, not raw visual memory capacity. Estimates put a chess International
  Master's chunk vocabulary around 100,000 recognized chunks, built through extended domain exposure.
  [VERIFIED, canonical and widely replicated] — [Expert Chess Memory: Revisiting the Chunking
  Hypothesis](https://www.researchgate.net/publication/13576754_Expert_Chess_Memory_Revisiting_the_Chunking_Hypothesis);
  [Chunking mechanisms in human learning, Gobet](http://www.bcp.psych.ualberta.ca/~mike/Pearl_Street/PSYCO354/pdfstuff/Readings/Gobet1.pdf)
- **The direct analog this app's own practitioner-research already surfaced**: the "cancellation
  principle" (a low card and a high card seen together net to zero and can be skipped as a *pair*
  rather than processed as two separate additions/subtractions) is explicitly named in the counting
  community as a *distinct, harder-to-learn* skill stage that comes *after* single-card counting speed
  is solid — because real tables deal multiple visible cards per round, not one at a time. This was
  independently corroborated across three sources in this repo's prior research. [VERIFIED — internal
  cross-reference] — `docs/research/2026-07-21-practitioner-pain-points.md`, citing
  [qfit.com Practice Drills](https://www.qfit.com/book/ModernBlackjackPage92.htm) and two Blackjack
  Info/Wizard of Vegas threads.
- **Whether chunking recognition can be explicitly trained (vs. only emerging from raw hours of
  exposure) is the least certain claim in this report.** General deliberate-practice literature asserts
  chunking capacity is trainable and domain-specific ("domain-specific improvements of 50-70% observed
  following targeted training" per one secondary summary), but this figure is **search-aggregated and
  not traced to a single primary study** — treat it as suggestive, not a hard number to cite further
  upstream. [INFERENCE / SEARCH-SNIPPET, weaker sourcing than other claims in this report] The
  chess-specific literature is more solid on the *existence* of chunking-as-mechanism than on *how
  fast explicit drilling builds it* versus incidental exposure.
- **Practical reading for this app**: the theory (chunk-based recognition beats symbol-by-symbol
  processing) and the community's own stated practice progression (single-card speed → paired/
  cancellation drilling → discard-tray estimation) both point the same direction — pair-recognition is
  a distinct, nameable skill that currently has no dedicated drill in this app (the counting drill
  presumably deals/reveals cards one at a time or in a stream; nothing specifically drills "16 cards →
  recognize which pairs cancel" as its own exercise).

→ **concrete app change**: add a dedicated "pair-cancellation" drill mode that shows two cards
simultaneously and asks for the net tag value (or explicitly "cancels/doesn't cancel"), timed
separately from the single-card counting drill, as its own progression stage — this is a genuinely new
drill type, not a tweak to an existing one, and both the chunking theory and the community's stated
practice order support it as the *next* stage after single-card speed is solid. **L** (new drill
engine + UI + telemetry, though it can reuse the existing card-rendering/timing infrastructure from
`countDrill.ts`)
→ **concrete app change**: within that new drill, deliberately weight toward the highest-frequency
real cancelling pairs (e.g., low+high combinations that appear most often) early, then broaden to rarer
pairs — a lightweight application of the same chunk-frequency logic chess study/template theory
describes for how experts build their pattern libraries. **S** (a content-weighting rule layered on the
drill above; not separable as standalone value without the L-sized drill first)

---

## Cross-cutting pattern across all six sections

Three independent literatures (dual-task/stress-inoculation, desirable-difficulties, and
speed-accuracy-instruction research) converge on the same single design rule without any of them
citing the others: **difficulty-adding features should be gated behind a demonstrated competence
floor on the easier version, not available from the first session.** This is the closest thing to a
unifying, high-confidence takeaway in this report and should inform not just D1 (distraction training)
but every "harder mode" this app ships going forward — interleaved sessions, faster speed tiers, and
the proposed pair-cancellation drill all fit the same gate pattern.

---

## Sources

Directly fetched/read in full:
- [Verbal Fluency Dual-Tasks Show Greater Age-Related Cognitive-Motor Interference: A Meta-Analysis of Walking Performance, PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12496288/)
- [Speed and accuracy instructions affect two aspects of skill learning differently, npj Science of Learning 2022, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9588023/)
- [Desirable difficulty, Wikipedia](https://en.wikipedia.org/wiki/Desirable_difficulty)
- [Irrelevant speech impairs serial recall of verbal but not spatial items in children and adults, PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9950248/)
- [The Godden and Baddeley (1975) experiment on context-dependent memory... a replication, PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8568063/)

Verified via search-engine synthesis of abstracts/publisher pages (statistics cross-checked across
≥2 independent secondary sources where noted):
- [Similarity Matters: A Meta-Analysis of Interleaved Learning and Its Moderators, Psychological Bulletin 2019](https://www.researchgate.net/publication/335004545_Similarity_matters_A_meta-analysis_of_interleaved_learning_and_its_moderators) (primary PDF unreadable by fetch tool)
- [High contextual interference improves retention in motor learning: systematic review and meta-analysis, Scientific Reports 2024](https://www.nature.com/articles/s41598-024-65753-3) (auth-walled on fetch)
- [Distributed Practice in Verbal Recall Tasks: A Review and Quantitative Synthesis, Psychological Bulletin 2006](https://www.yorku.ca/ncepeda/publications/CPVWR2006.html) (primary PDF unreadable by fetch tool)
- [A Meta-analytic Review of the Effectiveness of Spacing and Retrieval Practice for Mathematics Learning, Educational Psychology Review 2025](https://link.springer.com/article/10.1007/s10648-025-10035-1)
- [The Power of Successive Relearning: Improving Performance on Course Exams and Long-Term Retention, Educational Psychology Review](https://link.springer.com/article/10.1007/s10648-013-9240-4)
- [Successive relearning, retrievalpractice.org](https://www.retrievalpractice.org/strategies/2018/successive-relearning)
- [The shuffling of mathematics problems improves learning, Instructional Science 2007](https://link.springer.com/article/10.1007/s11251-007-9015-8)
- [Why does interleaving improve math learning? The contributions of discriminative contrast and distributed practice, Memory & Cognition](https://link.springer.com/article/10.3758/s13421-019-00918-4)
- [Speed or Accuracy Instructions During Skill Learning do not Affect the Acquired Knowledge, Cerebral Cortex Communications](https://academic.oup.com/cercorcomms/article/1/1/tgaa041/5889933)
- [Speed-Accuracy Tradeoff: The Key to Motor Skill Mastery](https://www.numberanalytics.com/blog/speed-accuracy-tradeoff-motor-skill-mastery)
- [Enhancing Performance Under Stress: Stress Inoculation Training for Battlefield Airmen, RAND](https://www.rand.org/pubs/research_reports/RR750.html)
- [Baddeley's Model of Working Memory, Wikipedia](https://en.wikipedia.org/wiki/Baddeley%27s_model_of_working_memory)
- [Expert Chess Memory: Revisiting the Chunking Hypothesis](https://www.researchgate.net/publication/13576754_Expert_Chess_Memory_Revisiting_the_Chunking_Hypothesis)
- [Chunking mechanisms in human learning, Gobet](http://www.bcp.psych.ualberta.ca/~mike/Pearl_Street/PSYCO354/pdfstuff/Readings/Gobet1.pdf)
- [Spaced Repetition From The Ground Up, Control-Alt-Backspace](https://controlaltbackspace.org/spacing-algorithm/)
- [The effect of adaptive difficulty adjustment on the effectiveness of a game to develop executive function skills for learners of different ages, ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0885201418301047)

Internal cross-references:
- `docs/BACKLOG.md` (D1 distraction-training candidate, D2 open ideas)
- `docs/research/2026-07-21-practitioner-pain-points.md` (accuracy-over-speed practitioner consensus; cancellation-principle sourcing)

Blocked/unreadable (PDF binary streams the fetch tool could not extract; findings triangulated from
secondary sources instead, flagged inline above):
- Brunmair & Richter 2019 primary PDF (uni-wuerzburg.de mirror)
- Bjork & Bjork "Introducing Desirable Difficulties Into Practice and Instruction" (unh.edu PDF mirror)
- Cepeda, Pashler, Vul, Wixted & Rohrer 2006 primary PDF (multiple mirrors attempted)
