# Training Tools Landscape: What Serious Card Counters Actually Use

Research date: 2026-07-21. Scope: feature-level comparison of established card-counting training tools against this app's current feature set, to produce a build-priority gap list.

Citation key: **[VERIFIED]** = fetched and read the actual source page/document. **[SEARCH-SNIPPET]** = only seen via search-engine summary, not independently fetched/confirmed in full — treat as lower confidence. **[INFERENCE]** = my own reasoning, not sourced.

---

## 1. Casino Vérité (CVBJ / CVData / CVCX) — qfit.com

CVBJ (desktop) and its mobile companion apps "Blackjack Vérité Drills" (BJV Drills) and "Blackjack Vérité Games" (BJV Games) are widely cited as the reference training tool in the field — the BJV help docs themselves claim the software is "mentioned in 25 books" **[VERIFIED, qfit.com/apphelp/BJVD.pdf]**. I fetched the actual BJV Drills and BJV Games help PDFs (qfit's own product documentation), which give an exact feature list, not a marketing summary.

The three qfit products have distinct roles **[VERIFIED, qfit.com]**:
- **CVBJ** — practice/training software (drills + simulated table play).
- **CVData** — long-run simulator/calculator for testing a given ruleset + strategy.
- **CVCX** — advanced simulator/calculator that generates bet-ramps, risk-of-ruin, and hundreds of statistics (this is the tool whose bet-ramp export our app already imports).

### CVBJ Drills module (BJV Drills) **[VERIFIED, qfit.com/apphelp/BJVD.pdf]**

- **Flash Card Drills** — dealer-up-card + player-hand flashcards, tests correct action. Modes: Default Hands, **Illustrious 18 only** (explicitly named, attributed to Don Schlesinger), Hands-with-Indexes-only, **Drill Errors** (replay only your past misses), Custom hand mask. Count can be forced to zero, randomized (bell-curve around zero/pivot), a fixed value, or reversed into an **Index Test** (given the hand, you must state the index number itself, not just the action). Supports swipe gestures (hit/stand/double/split/surrender each a distinct swipe direction) as well as buttons.
- **Counting Drills** — cards thrown at you 1/2/3/4-at-a-time, in random orientation and screen position ("the dealer does not face all the cards on the table in nice lines pointing towards you" — direct quote). A **Bias** setting deliberately front-loads negative- or positive-count cards into the first half of the shoe specifically to drill the harder mental-arithmetic direction (counting large negatives upward, etc.). Sub-drills: Running Count, True Count, Aces Left, Aces Dealt, Ace Bet Count, Ace Play Count, Ace Insure Delta, Ten Side Count (for insurance). A **Two Counts** mode forces you to track and report two different counts simultaneously (e.g. running count + a side count).
- **Depth/Discard-Tray Drills** — shows a partially-filled discard tray at a *random* point (no sequential count available) and tests deck/half-deck/quarter-deck-remaining estimation, Aces-left, and RC→TC conversion given only a discard-tray photo. Tray art can be swapped between five card-back sets and card "thickness" can be simulated up to 110% (used casinos don't reshuffle often — cards get puffier).
- **Full Table Drills** — same counting drills but with multiple simulated hands/players on the table at once, including a **"Two Tables" mode that trains back-counting two tables simultaneously**, alternately feeding you cards from Table A and Table B and requiring you to hold and update both running counts in parallel.
- All drills report **Rounds, Seconds, Accuracy%, and average Speed(sec/test)**, log every error with type breakdown, and support **Progressive Speed** (auto +10% pace each restart) plus configurable **Timer Modes** (Auto with a hard per-test time limit that logs a miss if you don't answer in time; Count Up/Down with no or soft time limits).

### CVBJ Games module (BJV Games / full simulated table) **[VERIFIED, qfit.com/apphelp/BJVG.pdf]**

- Realistic multi-seat table (1/2/4/6 seats), swipe or button controls, animated discard tray + shoe.
- **Dealer Error / "Foul" simulation** — the dealer will periodically make a real payout error (miss an insurance payout, bust an unbusted hand, fail to pay a bonus, etc.). A **FOUL button** lets the player flag it; if you miss a dealer error you're shown what you missed at the start of the next hand. This is explicitly a trained skill, not a display bug — the doc states "if you do not catch dealer errors you may lose a significant portion of your edge."
- **Bias/difficulty forcing** — options to bias the shoe toward positive counts, negative counts, many-card (multi-hit) hands, hands you've personally gotten wrong before (Repeat Errors), or generally close/difficult decisions — explicitly framed as a fix for the fact that "random play does not present you with difficult situations very often. Most of your time is wasted playing easy hands."
- **Distraction simulation** — "Players come and go" (other seats populate/empty mid-shoe), configurable dealing speed for the "other players" at the table, and a **Hole-Carding mode** with a whole separate strategy-table system (three strategies: one for when you can't see the hole card, up to two for when you can, plus a "cover" strategy that deliberately avoids suspicious-looking plays like hitting a 19 vs 20).
- **Real casino ruleset database** — bundled "Current Blackjack News" (CBJN) database of real U.S./Canadian casino rule sets, searchable by casino/city/state, loadable directly into the simulator, with a very long rules-abbreviation key (surrender variants, resplit variants, side-bet paytables, etc.).
- **Betting Strategies screen** — lets you define up to 18 bet levels tied to true-count thresholds and warns on betting errors (bet not matching what the count calls for).
- **True Count Resolution granularity** — practice mode explicitly supports estimating remaining decks to the nearest full deck / half deck / quarter deck / exact card, because different counters use different levels of precision and the software wants you drilled at *your* chosen precision.
- **Side counts for expert play** — Ace side count and Ten side count (for a "perfect insurance count"), on top of the primary running count.
- **Index subsets** — All Indices / Illustrious 18 / Sweet 16 / Catch 20 / custom mask, so a learner can start with a small, high-value index set and expand.

### Third-party review of CVBJ **[VERIFIED, blackjackinfo.com/casino-verite-blackjack-the-ultimate-practice-tool]**

Confirms: 38 drills, 400+ strategy tables, error tracking with **estimated EV cost per error type**, "Risk of Ruin Calculator," natural hand-gesture play instead of buttons, and describes CVBJ as "the closest that an advantage player can get to practice in a live casino environment." The review does not state a recommended training order or speed benchmarks, and does not name competing tools.

---

## 2. Blackjack Apprenticeship (BJA) — the standard curriculum

BJA is the most widely cited "how do I actually learn this" resource (their YouTube/course content is the most-referenced entry point for new counters in forum discussion). I fetched their site directly via a proxy after direct fetch was blocked (403).

### Stated 4-part mental model **[VERIFIED, blackjackapprenticeship.com/how-to-count-cards/]**
1. Assign card values (Hi-Lo: 2–6 = +1, 7–9 = 0, 10–A = −1)
2. Maintain running count
3. Convert running count → true count (divide by decks remaining)
4. Adjust bet size to the true count

They explicitly caveat this 4-step framing is a simplification and real competence also needs bankroll/money management, playing deviations, and "detection avoidance" — but their public pages do not detail a drill sequence for those three.

### Stated practice progression **[VERIFIED, blackjackapprenticeship.com/how-to-practice-blackjack/]**
1. **Basic strategy first** — drilled to instant/automatic recall before any counting is attempted ("if you make Basic Strategy mistakes, you will never have the advantage over the dealer"). Recommended methods: reciting the chart daily, their free Basic Strategy Drill, mobile app.
2. **Running count** — count a single deck down to zero, repeatedly, using their free Running Count Training Drill. Stated goal: **100 hands "perfectly" before attempting casino play.**
3. **True count conversion** — practiced as pure mental-math drilling (dividing running count by decks-remaining, from 6 down to 1), including doing it during unrelated daily activities to build automaticity; a members-only "True Count Drill" is the dedicated tool.
4. **Real-world back-counting** — go to a casino and back-count (watch and count without playing) until you're comfortable tracking a full shoe before ever betting money.

Deviations, bet-spread practice, and detection-avoidance are named as necessary but their public pages do not describe a specific drill methodology for them (deviations/bet-spread live behind their paid Card Counting Trainer Pro app and membership "Mini-Course").

### Deck estimation guidance **[VERIFIED, blackjackapprenticeship.com/bja-guide-to-deck-estimation/]**
Explicit sub-progression for shoe games: full-deck divisor → full-deck/half-deck hybrid → (optional) pure half-deck. For single/double-deck games: start at half-deck divisor, optionally progress to quarter-deck. Their stated criterion for "done" is not a time target but "a divisor you can do perfectly (every time) AND quickly" — i.e., accuracy-gated speed, not a fixed benchmark.

### Software/app **[VERIFIED, blackjackapprenticeship.com/blackjack-software/]**
Web drills: basic strategy, card counting, true count conversion, playing deviations, plus a full game. Mobile app ("Card Counting Trainer Pro" / newer "BJ21 Trainer") adds bet-spread practice. Paid membership tier adds a "Pro Betting Software" bet-ramp tool, a "Casino411" database of real casino conditions/reports from other advantage players, and a results/bankroll tracker.

---

## 3. Other trainers

- **wizardofodds.com "Blackjack Trainer v2"** **[VERIFIED, wizardofodds.com/play/blackjack-v2]** — free browser trainer. Warns on basic-strategy errors; supports 10 counting systems (Ace-Five, Hi-Lo, Hi-Opt I/II, Insurance, KO, Omega II, OPP, Red 7, Zen) plus fully custom user-defined tag values; displays live running/true count; has an "Analyze" button giving exact combinatorial EV for the current decision. No drill modes, no speed/accuracy stats, no distraction simulation, no bet-ramp practice — it's a strategy-correctness + count-display sandbox, not a drill suite.
- **"Expert Card Counting" (iOS app, formerly "Blackjack Expert"/Mentor/Counter product line by DeepNet Technologies)** **[VERIFIED, App Store listing]** — tracks running + true count live; supports Hi-Lo and Halves systems; **records average accuracy, speed, and reaction time per session, with system-specific performance history**; "Speed Training" mode that progressively increases pace. Search snippets **[SEARCH-SNIPPET]** additionally claim the wider DeepNet "Blackjack Expert" desktop product has ~11 training modes and tests actions, index plays, bet sizes, and insurance together — not independently confirmed in full detail.
- **BJA's own mobile apps** ("BJA: Card Counting Trainer Pro", newer "Blackjack Guru: BJ21 Trainer") **[SEARCH-SNIPPET]** — teach basic strategy → counting → true count → deviations → bet-spread practice in-app; not independently fetched beyond store-listing summaries.
- **"Card Counting Coach"** app **[SEARCH-SNIPPET only]** — accuracy tracking; not independently verified further.

### Common drill types across tools (cross-tool pattern, synthesized from the above)
1. Flashcard-style basic-strategy / deviation quizzes (near-universal)
2. Sequential running-count drills, often with speed ramping
3. True-count conversion as an isolated math drill, decoupled from card display
4. Deck/discard-tray depth estimation as its own drill (CVBJ is the only one confirmed to isolate this as hard as it does — random-order tray photos, no sequential count)
5. Full simulated table play combining all skills at slow-to-realistic speed
6. Bet-spread / bet-ramp practice tied to true count
7. Only CVBJ is confirmed **[VERIFIED]** to go further into distraction/camouflage/dealer-error/hole-carding territory; no other tool in this research claims that scope.

---

## 4. Standard training progression (synthesized across sources)

This progression is consistent across every source above that stated one explicitly (BJA, BJA's deck-estimation guide, the qfit BJV Drills doc's "Using the Drills" section, and forum consensus on speed):

1. **Basic strategy to instant/automatic recall** — before touching a count at all. Source: BJA **[VERIFIED]** ("if you make Basic Strategy mistakes, you will never have the advantage"); CVBJ's own doc puts Flash Card Drills first ("This is the best place to start") **[VERIFIED, BJVD.pdf]**.
2. **Running count, single deck, to zero, repeatedly** — accuracy first, then speed. CVBJ's doc states this order explicitly: **"Concentrate on accuracy first, then on speed."** **[VERIFIED, BJVD.pdf]**. BJA's stated milestone: 100 perfect hands before casino play **[VERIFIED]**.
3. **Speed benchmark consensus** — forum consensus (career counters, not vendor marketing) puts **~20–30 seconds per deck as "casino ready," with team standards often at 25s or better and top individual performers at 13–18s**; accuracy is repeatedly emphasized as mattering more than raw speed ("99+% accuracy trumps warp speed") **[VERIFIED, blackjackinfo.com forum thread]**.
4. **True count conversion as an isolated skill** — practiced as pure arithmetic (RC ÷ decks remaining), separately from card recognition, because it's a distinct failure mode. BJA **[VERIFIED]** and CVBJ's Depth Drills (which strip out the sequential count entirely so only division/estimation is tested) **[VERIFIED]** both isolate this deliberately.
5. **Deck/shoe estimation** — a named separate skill from true-count math: correctly judging how many decks/half-decks/quarter-decks remain from a discard tray glance. BJA has a dedicated guide with an explicit divisor-resolution progression (full → half → quarter deck) **[VERIFIED]**; CVBJ has an entire drill category for it.
6. **Playing deviations (Illustrious 18 and beyond)** — layered on only after the above are automatic. Both BJA and CVBJ single out the Illustrious 18 (Don Schlesinger) by name as the priority subset before full index tables **[VERIFIED, both sources]**.
7. **Bet spread / bet ramp tied to true count** — practiced with the same automaticity requirement.
8. **Full-table simulated play with distractions** — combining everything under time pressure with other players, dealer variability, and (for CVBJ specifically) simulated dealer errors and camouflage-strategy tables. This is presented as the last stage before real money, and CVBJ is the only tool in this research confirmed to model casino-realistic distraction (other players joining/leaving, hole-carding, dealer misdeals) rather than just card-recognition speed **[VERIFIED, BJVG.pdf]**.
9. **Live back-counting at a real casino, unstaked** — BJA's explicit final step before betting real money **[VERIFIED]**.
10. **Camouflage / cover play** — treated by the community as an ongoing meta-skill rather than a discrete "drill," because it's behavioral, not computational. Sources describe it as: smoothing bet-spread ramps so they don't look mechanical, controlling table demeanor, occasionally "idiot camouflage" (looking less skilled than you are), and accepting an EV/detection-risk tradeoff **[VERIFIED, countingedge.com/camouflage-betting; blackjackreview.com/idiot-camouflage]**. No tool in this research (including CVBJ) offers a *scored* camouflage drill — CVBJ's contribution here is a distraction-realistic *table*, and a cover-aware hole-carding strategy table, not a graded camouflage exercise.

---

## 5. Feature inventory

| Feature | Which tools have it | Do we have it? | Why it matters |
|---|---|---|---|
| Multi-ruleset basic strategy charts (1/2/6-8 deck, H17/S17, DAS/LS/RSA/6:5) | CVBJ (400+ tables), wizardofodds trainer, BJA | **Yes** | Table stakes; foundation everything else builds on. |
| Basic-strategy flashcard drill w/ error tracking | CVBJ, BJA, wizardofodds (warn-on-error), Expert Card Counting | **Yes** (flashcards drill) | Universal first stage of the standard progression (§4.1). |
| Illustrious 18 (+ H17/S17-adjusted indices) as a filterable subset | CVBJ (Illustrious 18 / Sweet 16 / Catch 20 filters), BJA | **Yes** | Both leading tools single out I18 by name as the priority index subset — confirms our scope is right-sized, not over- or under-built. |
| Full index tables beyond I18 (Fab 4, secondary indices, custom index range) | CVBJ (All Indices, custom index range/mask) | Unclear from context given — likely **partial/no** | CVBJ treats "beyond I18" as an expert-tier option, not essential; low priority unless we already have deviation coverage narrower than I18. |
| Running-count drill, sequential, single-deck | CVBJ, BJA, wizardofodds, Expert Card Counting | **Yes** (running-count drill, though "manual advance" — see gap list) | The universal second stage (§4.2). |
| Running-count drill with realistic card presentation (multi-card groups, rotated orientation, off-center screen position) | CVBJ only **[VERIFIED]** | **No** (context states manual-advance only) | CVBJ explicitly built this because "the dealer does not face all the cards on the table in nice lines pointing towards you" — a stated realism gap in naive drills. |
| Auto-advancing / timed counting drill with progressive speed ramp | CVBJ (Progressive Speed, Auto timer w/ per-card time limit), Expert Card Counting (Speed Training) | **No** (context states "manual advance" for our running-count drill) | Timed, hands-off pacing is how every tool in this research trains genuine casino speed; manual-advance can't train reaction-time-under-pressure. |
| Deck/discard-tray depth-estimation drill (non-sequential, tray-photo based) | CVBJ only **[VERIFIED]** | **No** | Named by BJA as a distinct skill with its own guide and by CVBJ as its own drill category — not the same skill as true-count math, and not covered by a running-count drill. |
| True-count conversion drill, isolated from card recognition | CVBJ (Depth Drills: TC Conversion, TC Conv & Decks), BJA (True Count Drill) | Unclear — likely folded into running-count drill only | Isolating "given RC and decks, state TC" from "count the cards" is how both leading tools train the arithmetic separately, since it's a distinct failure mode. |
| Configurable true-count rounding granularity (full/half/quarter deck, round/truncate/floor) | CVBJ only **[VERIFIED]** | Not stated in context | Different real counters use different precision; CVBJ lets you drill at *your* chosen precision. Niche but cheap to add if TC drill exists. |
| Side counts (Ace side count, Ten side count for insurance) | CVBJ **[VERIFIED]** | Not stated in context | Used by expert-level counters for perfect insurance decisions; explicitly labeled "expert play" by CVBJ itself. |
| Two-counts-at-once drill (holding two running counts in parallel) | CVBJ only **[VERIFIED]** | No | Niche — trains multi-count systems / side-count jugglers, a small subset of serious counters. |
| Bet-ramp / bet-spread practice tied to true count, with betting-error warnings | CVBJ (Betting Strategies screen, 18 configurable bet levels, warn-on-betting-error), BJA (bet-spread practice in mobile app) | **Partial** — we have CVCX bet-ramp *import* but context doesn't mention a graded "did you bet correctly for this count" drill | Import alone doesn't train the reflex of matching bet-to-count under time pressure; CVBJ scores this explicitly. |
| Full multi-hand game simulator w/ bots, insurance, splits, surrender | CVBJ (1-6 seats, computer players as distraction/extra-count load) | **Yes** | Confirmed table-stakes final-stage tool across sources (§4.8). |
| Distraction simulation: other players joining/leaving mid-shoe | CVBJ only **[VERIFIED]** | Not stated in context | Explicitly named by CVBJ's own doc as "one of the more annoying distractions in a real casino, particularly for a card counter." |
| Simulated dealer errors (misdeals, missed payouts) w/ "catch it" mechanic | CVBJ only **[VERIFIED]** | No | CVBJ explicitly frames this as edge-preserving: "if you do not catch dealer errors you may lose a significant portion of your edge." |
| Difficulty/bias forcing (skew shoe toward hard situations, repeat-your-past-errors, positive/negative count bias) | CVBJ only **[VERIFIED]** | No | CVBJ's stated rationale: "random play does not present you with difficult situations very often. Most of your time is wasted playing easy hands." Directly addresses drill-time efficiency. |
| Hole-carding mode with separate "cover" strategy tables | CVBJ only **[VERIFIED]** | No | Niche/advanced-AP skill, low relevance to a general trainer. |
| Real casino ruleset database (CBJN, searchable by casino/city/state) | CVBJ only **[VERIFIED]** | No (we have rule "profiles" but not a real-casino-sourced database) | Nice-to-have; helps a counter rehearse the *exact* conditions of a specific casino before a trip. |
| Speed + accuracy stats per drill (rounds, seconds, accuracy%, avg sec/response), with error-type breakdown | CVBJ (all drills), Expert Card Counting | **Partial** — context mentions "stats tracking" generally but no confirmed per-drill speed/accuracy/error-type telemetry | This is the actual instrumentation that lets a learner know when they're "casino ready" per the community's own speed benchmarks (§4.3). |
| EV-cost-of-error tracking (not just right/wrong, but $ or %EV lost per mistake type) | CVBJ **[VERIFIED, blackjackinfo review]** | Not stated in context | Turns error logs into a prioritized "what's actually costing you money" list rather than a raw miss-count. |
| Camouflage / cover-play guidance or drilling | CVBJ (cover-aware hole-carding strategy tables only — not a scored drill); community guidance is behavioral, not app-based | **No** | Universally named as essential by the community, but note: **no tool in this research, including CVBJ, actually gamifies/scores camouflage** — it's taught as reading/judgment, not drilled. Low feasibility to "drill" in software; more of an explainer/checklist opportunity. |
| Real-world "back-count at a casino, unstaked" milestone | BJA (stated as final pre-money step) | N/A (not software-drillable) | Out of scope for any app; worth noting only as context for what "done training" looks like. |
| Audio/eyes-free training (spoken narration, blind-tap drills) | **None of the researched tools confirm this** | **Yes — this app has it** | This appears to be a genuine differentiator, not a gap. No source found described an audio-first/car-practice mode in CVBJ, BJA, wizardofodds, or the App Store products researched. |

---

## 6. Gap list (build-priority candidates)

Ordered roughly by how many independent sources treat the feature as core, not by ease of implementation.

1. **[ESSENTIAL] Timed, auto-advancing counting drill with a progressive speed ramp**, replacing/supplementing manual-advance. Every serious tool researched (CVBJ, Expert Card Counting) times responses and ramps pace automatically; the community's own speed benchmark (20-30s/deck, team standard ≤25s) is meaningless without an app that measures and enforces pace. Source: **[VERIFIED, qfit.com/apphelp/BJVD.pdf]** ("Speed is very important... Concentrate on accuracy first, then on speed"); **[VERIFIED, blackjackinfo.com forum]** (benchmark numbers).

2. **[ESSENTIAL] Deck/discard-tray depth-estimation drill, decoupled from sequential counting.** Both leading references (CVBJ's Depth Drills, BJA's dedicated deck-estimation guide) treat this as a distinct, separately-trained skill, not a byproduct of the running-count drill. This is the single clearest gap: it's named explicitly by both major sources and (per the context given) doesn't appear to exist in this app in any form. Source: **[VERIFIED, qfit.com/apphelp/BJVD.pdf]**; **[VERIFIED, blackjackapprenticeship.com/bja-guide-to-deck-estimation]**.

3. **[ESSENTIAL] True-count-conversion drill isolated from card display** (given RC + decks remaining/discard depth, answer TC — no cards shown). BJA has a dedicated "True Count Drill" for exactly this and calls out that TC math needs to become "quick" and non-fatiguing on its own, separate from counting. If our running-count drill only exercises RC and TC together in live play, the arithmetic-under-pressure failure mode isn't being isolated and drilled. Source: **[VERIFIED, blackjackapprenticeship.com/how-to-practice-blackjack]**.

4. **[ESSENTIAL] Per-drill speed + accuracy telemetry with error-type breakdown**, not just aggregate stats. Every tool in this research (CVBJ, Expert Card Counting) reports rounds/seconds/accuracy%/avg-response-time per drill and logs errors by type. Without this, a learner can't tell when they've hit "casino ready" against the community's own benchmarks. Source: **[VERIFIED, qfit.com/apphelp/BJVD.pdf]** (Stats section present on every drill).

5. **[VALUABLE] Bet-spread drill graded against the current true count** (not just bet-ramp *import*, but an active "given this count, what do you bet" quiz with pass/fail). CVBJ's Betting Strategies screen and BJA's mobile app both frame bet-sizing as something to be drilled to reflex, not just configured. Source: **[VERIFIED, qfit.com/apphelp/BJVG.pdf]**; **[VERIFIED, blackjackapprenticeship.com/blackjack-software]**.

6. **[VALUABLE] Difficulty/bias forcing in drills** (skew the shoe toward the count-direction or hand-type you personally struggle with; replay your own past errors preferentially). CVBJ's stated rationale — that unweighted random practice wastes most drill time on easy situations — is a real efficiency argument, and "Drill Errors" (replay only past misses) is present in both the flashcard and full-table drills. Source: **[VERIFIED, qfit.com/apphelp/BJVD.pdf and BJVG.pdf]**.

7. **[VALUABLE] Distraction simulation in the full-game simulator: players joining/leaving mid-shoe, dealer-pace variation.** We already have bot players at the table per the given context, but CVBJ specifically calls out *dynamic* table composition (not just a fixed number of bots) as "one of the more annoying distractions... particularly for a card counter." If our simulator's bot count is static per session, this is a concrete, scoped addition. Source: **[VERIFIED, qfit.com/apphelp/BJVG.pdf]**.

8. **[VALUABLE] EV-cost-weighted error reporting** (surface "this mistake cost you ~0.4% EV" rather than a flat error count), so a learner's practice time gets prioritized toward their costliest habits rather than treated uniformly. Source: **[VERIFIED, blackjackinfo.com/casino-verite-blackjack-the-ultimate-practice-tool]** review of CVBJ's error-cost tracking.

9. **[NICHE] Simulated dealer-payout errors with a "catch it" mechanic (FOUL button).** Real skill, real EV impact per CVBJ's own docs, but it's a fairly involved simulation feature for a fairly narrow benefit (most counters play in jurisdictions/casinos where egregious dealer misdeals are rare, and this trains vigilance more than card-counting per se). Source: **[VERIFIED, qfit.com/apphelp/BJVG.pdf]**.

10. **[NICHE] Side-count drills (Ace side count, Ten side count for insurance) and "two counts at once" mode.** CVBJ itself labels these "expert play" — they're for counters running secondary side counts on top of a primary system, a minority of serious counters. Source: **[VERIFIED, qfit.com/apphelp/BJVD.pdf]**.

11. **[NICHE] Configurable true-count rounding precision (full/half/quarter deck, round/truncate/floor).** Only useful once a TC drill (gap #3) exists; cheap to bolt on afterward but not worth building standalone. Source: **[VERIFIED, qfit.com/apphelp/BJVG.pdf]**.

12. **[NICHE] Hole-carding mode with cover-aware strategy tables; real-casino ruleset database (CBJN-style).** Both are CVBJ-only features serving a narrower advantage-play audience (hole-carding is a different skill from counting; a searchable real-casino-conditions database is more of a trip-planning tool than a training drill). Source: **[VERIFIED, qfit.com/apphelp/BJVG.pdf]**.

13. **[NICHE / not app-buildable] Camouflage / cover-play training.** Universally named as important by the community, but notably **not gamified by any tool researched, including CVBJ** — even the best-in-class tool only offers cover-aware *strategy tables* for hole-carding, not a scored camouflage drill. This is behavioral/judgment content (bet-pattern smoothing, table demeanor, "idiot camouflage") better served as an explainer/checklist feature than a drill. If pursued, keep scope small — an article/checklist, not a graded exercise. Source: **[VERIFIED, countingedge.com/camouflage-betting]**; **[VERIFIED, blackjackreview.com/idiot-camouflage]**.

### Not a gap — likely a differentiator
No source in this research (CVBJ, BJA, wizardofodds, Expert Card Counting, or any App Store listing found) describes an **audio-first / eyes-free / blind-tap drill mode** built for practicing while driving. This app's new audio layer appears to be genuinely novel relative to the established tooling researched here, not a catch-up feature.

---

## Sources

- [Blackjack Vérité - Drills (BJVD.pdf)](https://www.qfit.com/apphelp/BJVD.pdf) — qfit.com official product help doc, fetched and read in full.
- [Blackjack Vérité - Games (BJVG.pdf)](https://www.qfit.com/apphelp/BJVG.pdf) — qfit.com official product help doc, fetched and read in full.
- [qfit.com homepage](https://www.qfit.com/) — CVBJ/CVData/CVCX product descriptions.
- [qfit.com/blackjack-games.htm](https://www.qfit.com/blackjack-games.htm) — CVBJ feature summary.
- [Casino Vérité Blackjack Review — blackjackinfo.com](https://www.blackjackinfo.com/casino-verite-blackjack-the-ultimate-practice-tool/) — third-party review, error-cost tracking, drill count.
- [Blackjack Apprenticeship — Blackjack Training Drills](https://www.blackjackapprenticeship.com/blackjack-training-drills/) (fetched via proxy due to 403 on direct access)
- [Blackjack Apprenticeship — How to Practice Blackjack Card Counting](https://www.blackjackapprenticeship.com/how-to-practice-blackjack/) (fetched via proxy)
- [Blackjack Apprenticeship — Blackjack Software](https://www.blackjackapprenticeship.com/blackjack-software/) (fetched via proxy)
- [Blackjack Apprenticeship — How To Count Cards](https://www.blackjackapprenticeship.com/how-to-count-cards/) (fetched via proxy)
- [Blackjack Apprenticeship — Colin's Guide to Deck Estimation](https://www.blackjackapprenticeship.com/bja-guide-to-deck-estimation/) (fetched via proxy)
- [blackjackinfo.com forum — "Count down a deck... How fast"](https://www.blackjackinfo.com/community/threads/count-down-a-deck-how-fast.15741/) — community speed benchmarks.
- [Wizard of Odds — Online Blackjack Trainer v2](https://wizardofodds.com/play/blackjack-v2/) — counting-system list, Analyze/EV feature.
- [Expert Card Counting — App Store listing](https://apps.apple.com/us/app/expert-card-counting/id6444629083) — speed/accuracy/reaction-time telemetry.
- [CountingEdge — Camouflage Betting](https://www.countingedge.com/camouflage-betting/) — cover-play technique summary.
- [Blackjack Review Network — A Blackjack Player's Guide to Idiot Camouflage](https://www.blackjackreview.com/wp/2019/11/13/idiot-camouflage/) — cover-play technique summary and 2019 revision.

### Search-snippet-only (not independently fetched in full; lower confidence, listed for completeness)
- [Blackjack Apprenticeship BJ21 Trainer App — App Store](https://apps.apple.com/us/app/blackjack-apprenticeship-bj-21/id6717589612)
- [BJA: Card Counting Trainer Pro — Google Play](https://play.google.com/store/apps/details?id=com.trainer.bja&hl=en_US)
- [Blackjack card counting strategy and training software — DeepNet Technologies](https://www.deepnettech.com/bjexiphone.shtml)
