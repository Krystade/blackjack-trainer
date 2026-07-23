# Community Training Methods Hunt — Research Report

Date: 2026-07-23
Method: web search + direct page fetch (forums, qfit.com/CVBJ drill manuals, CasinoCityTimes, dealer-training sites, cross-domain mental-math sources). No code written; research artifact only. This pass hunts NEW drill/method leads not already in `docs/BACKLOG.md` or `docs/research/2026-07-21-practitioner-pain-points.md` — it does not re-litigate distraction training (D1, already staged) or the eyes-free/clipping items in D2.

## Access notes (delta from last pass)

- **qfit.com** — fetched fine again, and this time I pulled the **CVBJ mobile drills PDF manual** (`BJVD.pdf`) directly, not just the marketing/landscape page. This is the richest single source in this pass — full drill-by-drill procedures with every configurable parameter. [VERIFIED, direct read]
- **blackjackinfo.com forums** — fetched fine, new threads pulled beyond the ones in the last report ("Practicing," "Casino Verite Drills").
- **casinocitytimes.com** — John Marchel has a whole *series* of drill articles beyond the one cited last time; pulled four more directly, all fetched clean.
- **vegas-aces.com** (casino dealer training) — fetched fine, new domain this pass.
- **blackjackapprenticeship.com** — still 403 on direct fetch for `/top-cvbj-blackjack-drills/` and `/how-to-practice-blackjack/`; only search-engine synthesis available, tagged **[SEARCH-SNIPPET ONLY]** throughout.
- **blackjacktheforum.com** — no usable search results surfaced this pass either; effectively still silent, not proven empty.
- **Reddit** — still hard-blocked, no attempt yielded anything.
- YouTube video descriptions/transcripts did not come through WebFetch (only channel-page chrome loaded, no transcript text) — that angle is a dead end with current tools, tagged as attempted-but-empty rather than skipped.

---

## 1. CVBJ drill mechanics not covered by the landscape report (repeated across sources / primary documentation)

The last pass covered CVBJ as a *feature list*. This pass read the actual drills PDF — the **methodology**, not just the names.

### 1a. Deliberate difficulty-weighted shoe composition ("Bias")
CVBJ's counting drills have a "Bias" parameter with two settings: "**Negative (1st half of deck rich)** – the first half of the deck has cards with a negative count... forces a counter to count negatively and then to count negative numbers upward in the second half," and "**Positive (Last half of deck rich)** – forces a counter to count positively and then to count positive numbers downward in the second half." The manual frames this explicitly as targeting a known weak spot: "Some card counters find it more difficult to count in certain situations. This parameter can be used to make those situations appear more often." [VERIFIED, direct PDF read] — [Blackjack Vérité - Drills, qfit.com](https://www.qfit.com/apphelp/BJVD.pdf)

This is a genuinely different idea from "harder decks" (more extreme counts) — it's specifically about **forcing count-sign reversal and counting-down-through-zero**, which is a distinct cognitive skill (subtracting into/out of negative territory) that flat-random shoes under-sample.

→ candidate: an adversarial shoe-generation mode that deliberately clusters same-sign cards to force sign-reversal and counting-through-zero reps, distinct from just raising deck penetration or count magnitude — **M**

### 1b. Messy card presentation (orientation + position randomization)
Counting Drills let you set "**Orientation** – Cards are displayed Vertically, Horizontally (sideways), or randomly" and "**Positions** – Pairs of cards are displayed one above the other, one at the side of the other, or one to the upper right of the other, or randomly," explicitly justified because "the dealer does not face all the cards on the table in nice lines pointing towards you." [VERIFIED, direct PDF read] — same source.

This directly answers a known pain point from the last report ("gus" on Blackjack Info: home practice differs because "the glimpse is totally different" than a dealt table) with a concrete mechanism, not just a general observation.

→ candidate: randomize card rotation/offset/stacking in the visual card-detail modes instead of always presenting cards flat, evenly spaced, and face-on — **S**

### 1c. Remove-then-deduce cross-check drill
"When performing a counting drill, card counters often remove a card or two from the deck before starting the drill. When completed with the deck, they then use the count to determine the value(s) of the removed cards. This option simulates this action by pausing automatically for a couple seconds near the end of the deck." [VERIFIED, direct PDF read] — same source.

This is independently corroborated as a real practitioner habit (not just a software feature) in the Blackjack Info "Practicing" thread's **Drill 8**: "break the shuffled decks into six piles... set aside 2-3 cards at the start; after completing all piles, identify the reserved cards based on your running count total." [VERIFIED] — [Practicing, Blackjack Info forum](https://www.blackjackinfo.com/community/threads/practicing.2924/); corroborated by [Blackjack practice drills, CasinoCityTimes](https://www.casinocitytimes.com/john-marchel/article/more-practice-drills-for-blackjack-65869) which describes the identical mechanic as "Drill 8 - Deck Scan, Six Decks."

**Repeated-theme** (independent software-vendor + two independent practitioner descriptions of the same mechanic). This is a genuinely different drill *shape* than anything in the app today: instead of grading "did you get the final count right," it grades "can you back out a specific unseen fact (the removed cards' values) from your own final tally" — a self-consistency/audit skill, not a raw counting-speed skill.

→ candidate: end-of-shoe drill where 1-3 cards are secretly held out and the player must state what they were, using nothing but their own final running count — **S**

### 1d. Dual-simultaneous-count drills ("Two Counts" / "Two Tables")
Every drill mode has a "**Two Counts**" toggle: "you will need to enter the True Count and also enter the correct answer for whatever other drill has been selected" — i.e., every test requires producing *two* independent tracked numbers at once, not one number plus an unrelated distraction. Separately, "**Two Tables** – designed to test your ability to back-count two tables at once... you will see some of the cards dealt for the first table. Enter the running count. Then you will see some of the cards for the second table. Enter the RC for that table... both tables will be cleared and you will see more cards but starting at the two RCs that you had previously." [VERIFIED, direct PDF read] — same source.

This is meaningfully distinct from the operator's already-staged distraction drill (D1): D1 interrupts the count with an *unrelated* question; this drills genuinely **splitting one working-memory register into two live, task-relevant registers** (RC+TC simultaneously, or two independent RCs for two shoes) — the real skill a back-counter/team player needs when wonging between tables, or any counter needs when RC and TC must both stay current through a hand.

→ candidate: "dual-count" mode requiring the player to keep and report two independently-updating counts at once (RC+TC, or two interleaved simulated tables) — **M**

### 1e. Ace/Ten side-counts as a separate drilled skill
CVBJ has dedicated drills for **Aces Left**, **Aces Dealt**, **Ace Bet Count**, **Ace Play Count**, **Ace Insure Delta**, and **Ten Side Count** — side-counting specific ranks (not just the aggregate Hi-Lo tally) for insurance and betting-adjustment decisions, explicitly separated from ordinary running-count drills. [VERIFIED, direct PDF read] — same source.

→ candidate: an ace/ten side-count submode (track a single rank's remaining count alongside the main tag count) for advanced-tier progression — **S**

### 1f. Auto-escalating difficulty across attempts, not just a manual slider
"**Progressive Speed** – When set, the speed will increase 10% every time you hit the Start/Restart button." [VERIFIED, direct PDF read] — same source. This is a small but specific mechanic: difficulty ramps *automatically session-over-session* rather than requiring the player to manually notice they've plateaued and bump a slider.

→ candidate: opt-in auto-ramp setting that nudges deal speed up ~10% each clean run, instead of leaving speed entirely to manual choice — **XS**

### 1g. Gesture-to-decision mapping mirrors real dealer hand signals
Flashcard drills map swipe directions to the actual physical signals used at a table: "Hit: swipe down (give me a card); Stand: swipe left (the old signal for pass to the next player); Double: swipe up (put up more chips); Split: swipe right (separate into two hands); Surrender: any diagonal swipe." [VERIFIED, direct PDF read] — same source. **[INFERENCE]**: training the *gesture*, not just the verbal/keyboard decision, could build muscle memory that transfers to the physical table (real counters must also physically signal, not just decide) — this is speculative since no source claims gesture-training transfer explicitly, but the mapping itself is a real, verified design choice by a serious training-tool vendor.

→ candidate: optional touch/gesture input mode (swipe patterns matching real table hand-signals) as an alternative to tap buttons in strategy drills — **S**

---

## 2. Physical-deck hacks described by practitioners (an app could simulate some of these better than a screen currently does)

### 2a. Whited-out "spot reading" deck
"The author recommends creating a modified deck by using correction fluid to white out the numbers and pips on card corners (excluding face cards and 10s)... Use this deck for your counting drills which will also aid in learning to read the spots on the various cards in the deck." The stated purpose: train recognizing a card's value from its **pip layout/shape**, not its printed numeral — useful "when dealer speed or table positioning makes corner pips hard to read." [VERIFIED, single article, but a specific and vivid physical-deck hack] — [Reading playing card spots, John Marchel, CasinoCityTimes](https://www.casinocitytimes.com/john-marchel/article/reading-playing-card-spots-66135)

This is exactly the kind of thing a screen-based app can do *better* than a physical deck (no correction-fluid mess, instantly toggle numeral visibility) and it's a distinct skill from ordinary card counting: recognizing "8 of clubs" by its pip *arrangement* at a glance rather than by reading a corner "8."

→ candidate: a display mode that shows only pips/suit-symbol layout, corner index hidden — forces spot-pattern recognition instead of numeral-reading — **S**

### 2b. Custom card-ratio deck to force a specific hand-shape
"Create a specialized training deck with '25 low cards, Eight 10's or court cards and six ace cards.' Deal hands until achieving either a soft 19... or better, or a hard 17." The goal is to force encounters with **multi-card, boundary-adjacent hands** (soft hands near bust, 3+ card hands) while simultaneously running the count — deliberately over-representing a hand shape known to trip people up. [VERIFIED] — [More practice drills for blackjack, CasinoCityTimes](https://www.casinocitytimes.com/john-marchel/article/more-practice-drills-for-blackjack-65869)

This corroborates and extends a finding from the prior report (soft-hand/bust hands as a specific miscounting trigger, single-poster at the time) — here it recurs as a *deliberately engineered deck ratio* to over-sample that exact weak spot, which is a concrete, buildable mechanic (not just "watch out for soft hands").

→ candidate: a "hard hands" deal-weighting mode that over-represents multi-card soft/boundary hands (soft 17-19, 3+ card hands) rather than uniform random deals — **S**

### 2c. Deck-height/stack recognition (visual estimation, not counting)
"Various stacks of cards set up. one deck, two decks, three decks and four decks. i just look at those cards and say how many decks it is for each stack" — a pure visual-estimation drill, decoupled entirely from counting. [VERIFIED] — [Practicing, Blackjack Info forum](https://www.blackjackinfo.com/community/threads/practicing.2924/). This corroborates the "glued deck bricks" finding from the prior report with an independent, non-glue variant (loose stacks compared side by side), and CVBJ's own manual (drills PDF) independently confirms deck-thickness is treated as a real variable, even including a "Thickness" option (100%-110%) to simulate "cards in casinos that do not change the cards very often tend to stack thicker as they are bent and accumulate dirt and sweat." [VERIFIED, direct PDF read] — [Blackjack Vérité - Drills, qfit.com](https://www.qfit.com/apphelp/BJVD.pdf)

**Repeated-theme** (independent practitioner + independent vendor both treat deck-height estimation as a distinct, trainable skill worth simulating). Lower priority for this app specifically since it's a screen-based trainer, not a physical-deck-estimation tool — flagged mainly because it reinforces that "how many decks are left" is trained as a *separate visual* skill from "what is my count," which the app's discard-tray/decks-remaining display could lean into more (e.g., a visual deck-height estimation mini-drill using rendered card-stack images rather than a number).

→ candidate: a visual "how many decks remain" mini-drill using a rendered stack/discard-tray image (no numeric display), separate from the running-count drill — **S**

---

## 3. Structured session templates and zero-to-table-ready sequencing

### 3a. A concrete phased daily-practice template with a month-over-month target
"Phase 1 (Minutes 1-5): Warm-up pass. One 2-deck shoe at your own pace, no timer, no hidden values. Goal: end the shoe with the correct running count." "Phase 2 (Minutes 5-10): Speed pass... timer on, target under 30 seconds per deck... Accuracy must come first; if the count is wrong at the end, the speed does not matter." "Phase 3 (Minutes 10-13): True count drill. Switch to a 6-deck shoe. After every 20 cards or so, pause and state your true count out loud." "Phase 4 (Minutes 13-15): Hidden-value round. Turn off the displayed RC. Run a full shoe calling out your count every 10 cards." Explicit target: "Over a month of this drill, your error rate on a 6-deck shoe should drop from 5-10 (beginner) to 0-1 (tournament-ready)." Plus a discipline rule: "only one system at a time. Switching between Hi-Lo and KO between sessions will leave you bad at both." [VERIFIED, direct fetch] — [Blackjack Card Counting Trainer, CountingEdge.com](https://www.countingedge.com/blackjack-card-counting-trainer/)

**Caveat**: this reads like SEO-generated coaching content rather than a named coach's personally-attributed regimen (no author byline, no anecdote), so treat the *specific* minute-by-minute numbers as **plausible-but-templated**, not a verified professional's protocol — but the *shape* (untimed accuracy pass → timed speed pass → true-count-specific pass → hidden-value pass, in that order, in one session) is a genuinely useful structure regardless of provenance, and it's the first place in either research pass that a full **single-session** template (not just a multi-week progression) was found.

→ candidate: a "guided session" mode that walks a player through ordered phases (untimed accuracy → timed speed → TC-focus → hidden-value) in one sitting, with a session-level checklist and pass/fail per phase — **M**

### 3b. Coach-style basic-strategy-first sequencing, in three escalating realism steps
Before any counting drill, Marchel lays out three basic-strategy drills in increasing table-fidelity: (1) fix one dealer up-card, cycle every possible player hand against it; (2) fix a player pair, cycle every dealer up-card to drill the split/no-split decision specifically; (3) "Act as the dealer and deal out three hands, face up. Play each hand normally using basic strategy. Play out the dealer's hand" — explicitly called out as the one that "most closely mimics actual casino play and supports card-counting practice." [VERIFIED] — [Blackjack practice drills, CasinoCityTimes](https://www.casinocitytimes.com/john-marchel/article/blackjack-practice-drills-64707)

This is a concrete **advance-when-ready ladder**: single fixed-variable drills (dealer-card-only, or pair-only) before the fully mixed multi-hand simulation — a specific ordering principle (isolate one decision axis at a time before combining) that maps cleanly onto app onboarding/progression design.

→ candidate: basic-strategy onboarding drills that isolate one axis at a time (fixed dealer-card / fixed player-pair) before unlocking mixed full-table play — **S**

---

## 4. Cross-domain transplants (dealer training + competitive mental math)

### 4a. Casino dealer "instant recognition, not calculation" training
From an article on casino dealer trainee programs: "An instructor flashes two cards and expects the total immediately, with no finger counting and no pause to work it out. The goal is pattern recognition. 'A-6' should register as 17 the same way a stop sign registers as 'stop.'" Card handling repetition is described as building automaticity the same way: "It's essentially muscle memory... It comes from enough repetition that the hands start doing the right thing before there's time to stop and think." [VERIFIED, direct fetch] — [Casino Dealer Training: What Happens Before Live Shifts, vegas-aces.com](https://www.vegas-aces.com/articles/what-casino-dealers-practice-before-their-first-live-shift/)

This is a different *pedagogical claim* than "practice more, get faster": it explicitly frames the target state as **stimulus-response pattern-matching** (like reading a stop sign) rather than **calculation performed quickly**, and it's coming from professional dealer-trainer methodology, not a counting-community source — genuinely new angle, and a good reframe for how the app's "pairs/cancellation" drills should be marketed/paced (drilling toward instant gestalt recognition of a 2-card total, not fast mental addition).

→ candidate: reframe the existing pairs/multi-card counting mode's pacing goal explicitly around instant-recognition automaticity (very short, non-adjustable flash exposure once past a skill gate) rather than "as fast as you can compute it" — **S**

### 4b. Flash Anzan (competitive mental-math) as a structural transplant
Flash Anzan, from the mental-abacus/mental-calculation-competition world, "trains the core skill: recognising numbers shown rapidly in sequence and computing their result before they vanish. Numbers flash on the screen briefly." A champion example: "adding fifteen three-digit numbers in just 1.7 seconds" (extreme upper bound, not a target). [VERIFIED — Flash Anzan exists and this is its documented format, via multiple training-app descriptions] — [FLASH ANZAN, rightlobemath.com](https://www.rightlobemath.com/mental/flashGenerator.php); [Mental Math Training: Chainmath (Flash Anzan), drillyourskill.com](https://drillyourskill.com/chain-math/); [Mental abacus, Wikipedia](https://en.wikipedia.org/wiki/Mental_abacus)

**[INFERENCE]**: no source connects Flash Anzan to blackjack training directly — this is a cross-domain transplant I'm proposing, not a practitioner request. The structural match to card counting is close (sequential stimuli, no persistent visual record, one cumulative answer at the end) but the *exposure regime* is the interesting delta: Flash Anzan format shows each item for a fixed, very short, non-negotiable instant (no dwell-time control by the user at all) rather than a pace the user can nudge — that's a stricter and more automatic-recognition-forcing paradigm than any card-counting trainer found in either research pass.

→ candidate: a "flash mode" with fixed, very short, non-adjustable per-card exposure (true tachistoscope-style single flash, no pause/resume) as a distinct hardest tier above the current speed slider — **S**

---

## 5. Recovery / error-inference skill (a specific gap in existing tools)

### 5a. Deductive reconstruction of a missed/obscured card
"You can figure what the cards might be by deduction... You can now presume that the player ended up with one small card and two big cards, causing the bust... It's not the perfect solution to the problem; however, it will keep you within a reasonable range for your running count." [VERIFIED] — [Missing cards, John Marchel, CasinoCityTimes](https://www.casinocitytimes.com/john-marchel/article/missing-cards-66427)

**Single-anecdote source** but a real, distinct, nameable skill: when a card is missed (obscured by a dealer's hand, table clutter, a fast deal), an experienced counter doesn't just shrug — they reason backward from the *visible outcome* (a bust, a stand, a hit) to narrow down what the hidden card(s) must have been, and adjust the running count with an inferred value rather than leaving a gap. No existing trainer found in either research pass drills recovery-from-a-known-gap; every trainer found either shows all cards or doesn't simulate obscured cards at all.

→ candidate: an "obscured card" drill that hides one card in a multi-card hand but reveals the resulting hand outcome (stood/hit/busted total), requiring the player to infer the hidden card's count value and correct their running count — **M**

---

## 6. Maintenance-mode habits (the underserved category, per the mission brief)

Two independent forum threads describe maintenance as **opportunistic micro-practice during otherwise-idle moments**, not scheduled drilling:

- "counting by ones, and twos negative and positive numbers when i'm in some mundane really boring situation such as jogging, waiting in line." [VERIFIED] — [Practicing, Blackjack Info forum](https://www.blackjackinfo.com/community/threads/practicing.2924/)
- "mentaly go over the basic strategy table and my bet strategies" during idle moments — same source, same poster, describing strategy-recall maintenance separately from counting maintenance.
- Independently, the earlier report already found the CasinoCityTimes "flexible practice locations... without pen and paper" habit (waiting rooms, lines, walks) — this pass adds the *specific content* people rehearse in those moments (raw sequential counting AND separately, basic-strategy/bet-spread recall), which the prior report hadn't broken out as two distinct maintained skills.
- The "one system at a time" discipline rule (section 3a) is itself arguably a maintenance-mode finding: the risk named is specifically *decay from switching contexts between sessions*, not decay from insufficient volume.

**Repeated-theme but thin** on procedure — these are described as informal habits, not named drills with steps, which is consistent with the mission's premise that maintenance-mode is underserved even in the *source material*, not just in existing apps.

→ candidate: a "micro-session" mode explicitly framed for maintenance (30-90 second bursts, no setup, resumable anywhere) distinct from the main timed-drill session — **S**

---

## 7. Realism complaint about existing trainers (specific and quotable)

A synthesized app-store review-adjacent finding: a reviewer of an existing trainer's practice mode "criticized that... the app deals each card as if completely random rather than simulating a real shoe from a finite deck, making the training less realistic... in most six-deck shoes, the true count rarely goes above 0, but in the app it frequently reaches higher values." [SEARCH-SNIPPET ONLY — could not trace to an individually-quoted, directly-fetched review; treat as directionally real but not verbatim-verified] — search synthesis, query "blackjack card counting trainer app review unrealistic".

This complaint is a good, concrete companion to the CVBJ "Bias" finding (1a) and the practitioner-described custom deck-ratio hack (2b): three independent angles (a vendor's built-in bias controls, a practitioner's home-built biased deck, and a reviewer's complaint about the *opposite* problem — unrealistically volatile default randomness) all converge on the same underlying point: **naive per-card random dealing does not reproduce the true-count distribution of a real finite shoe**, and that mismatch is something practitioners actively work around while at least one reviewer explicitly flagged it as an unrealism complaint in a competitor.

→ candidate: verify/document that this app's shoe-depletion model already reproduces realistic true-count distributions (most mass near 0, rare extremes) as a documented, statistically-checked property rather than an assumption — **S** (verification-sized, might be nothing to build)

---

## 8. Weaker / single-anecdote leads (noted, not developed into candidates)

- **Standing behind a live table just watching, as unpaid back-counting practice**, and **team wonging practice** (a "wonger" + "big player" pair rehearsing signal-based entry) are both described as real practice modalities for the back-counting/wonging skill specifically. [SEARCH-SNIPPET ONLY] — search synthesis, query on back-counting/wonging practice procedure. These are inherently in-casino or two-person activities; no clean single-player app translation found, and no repeated-theme corroboration beyond the one synthesized summary — flagged as out of scope rather than turned into a candidate.
- **Dual-task drill naming the hand total out loud (a real required table verbalization) while silently keeping count, "adding distractions as you get better"** [SEARCH-SNIPPET ONLY] is close enough to the already-staged D1 distraction drill that it isn't a new lead, but it does suggest a refinement worth flagging to whoever builds D1: real table distraction includes the player's *own* required speech (announcing hits/doubles/totals), not only external chatter — D1's "generic quiz question" interference type could specifically include "state your own hand total" as one interference flavor, since that's a distraction practitioners say is real and self-inflicted, not just environmental.

---

## Sources

Directly fetched and verified this pass:
- [Blackjack Vérité - Drills (full PDF manual) — qfit.com](https://www.qfit.com/apphelp/BJVD.pdf)
- [Practice Drills, Modern Blackjack — qfit.com](https://www.qfit.com/book/ModernBlackjackPage92.htm)
- [Practicing — Blackjack Info forum](https://www.blackjackinfo.com/community/threads/practicing.2924/)
- [Casino Verite Drills — Blackjack Info forum](https://www.blackjackinfo.com/community/threads/casino-verite-drills.10387/)
- [Blackjack practice drills — John Marchel, CasinoCityTimes](https://www.casinocitytimes.com/john-marchel/article/blackjack-practice-drills-64707)
- [More practice drills for blackjack — John Marchel, CasinoCityTimes](https://www.casinocitytimes.com/john-marchel/article/more-practice-drills-for-blackjack-65869)
- [Reading playing card spots — John Marchel, CasinoCityTimes](https://www.casinocitytimes.com/john-marchel/article/reading-playing-card-spots-66135)
- [Missing cards — John Marchel, CasinoCityTimes](https://www.casinocitytimes.com/john-marchel/article/missing-cards-66427)
- [Casino Dealer Training: What Happens Before Live Shifts — vegas-aces.com](https://www.vegas-aces.com/articles/what-casino-dealers-practice-before-their-first-live-shift/)
- [Blackjack Card Counting Trainer — CountingEdge.com](https://www.countingedge.com/blackjack-card-counting-trainer/) (template treated as plausible-but-templated, see §3a caveat)
- [FLASH ANZAN — rightlobemath.com](https://www.rightlobemath.com/mental/flashGenerator.php)
- [Mental Math Training: Chainmath (Flash Anzan) — drillyourskill.com](https://drillyourskill.com/chain-math/)
- [Mental abacus — Wikipedia](https://en.wikipedia.org/wiki/Mental_abacus)

Search-snippet only (site blocked or content not independently re-verified):
- blackjackapprenticeship.com (`/top-cvbj-blackjack-drills/`, `/how-to-practice-blackjack/`) — still 403 on direct fetch.
- App-store/review-aggregator synthesis on shoe-realism complaints (§7).
- Back-counting/wonging practice-modality summary (§8).

Attempted, yielded nothing usable:
- blackjacktheforum.com — no search results surfaced any thread content this pass (still silent, not proven negative).
- reddit.com — still hard-blocked.
- YouTube video pages (`watch?v=...`, `/shorts/...`) — WebFetch returned only page chrome, no transcript/description text; the "8 Card Counting Drills" and BJA training-suite videos could not be mined for content this pass.
- Schlesinger's *Blackjack Attack* and the *Big Book of Blackjack* — search results surfaced bibliographic/review information only; no excerpted practice-regimen chapter text was accessible without a licensed copy or a fetchable full-text mirror.

---

## Relevance to this app

Most of the CVBJ-manual mechanics (section 1) are things a screen-based trainer can implement directly and are more concrete than the feature-level CVBJ coverage in the prior report — they're procedures, not just "CVBJ has drills." The physical-deck hacks (section 2) are notable less for direct replication and more as evidence of *which specific sub-skills* practitioners feel the need to isolate and over-train (spot-reading, boundary hand-shapes, deck-height). Sections 4 and 6 are the most speculative/cross-domain and are flagged as such — Flash Anzan and dealer "stop-sign" pattern training are inferences about applicability, not requests anyone has made.
