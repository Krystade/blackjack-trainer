# Bet / Sit-Out / Leave — Expert & Practitioner Consensus (ET3 ground truth)

**Date:** 2026-08-01
**Purpose:** Establish the general expert/practitioner consensus for the shoe-game table-action
decision a card counter faces each round — **BET** (play at your ramp), **SIT OUT** (stay
seated, don't stake this round — "wong out"), or **LEAVE** (leave the table entirely) — so that
the new **ET3 · Risk-decision: bet / sit / leave** drill can grade snapshots against a
defensible rule rather than an invented one.

**Scope note:** This is research only. No app source/tests/config were touched. The proposed
rule at the end is a recommendation for the operator to accept/tune, not a shipped change.

**Evidence tags:** `[VERIFIED]` = page fetched and read directly · `[SEARCH-SNIPPET]` = from
search-result summary only, not full page · `[INFERENCE]` = my synthesis/reasoning.

---

## 1. Executive summary of the consensus

There is broad agreement on the shape of the rule, and a **range** (not a single number) on the
exact thresholds because they are penetration-, spread-, and rules-dependent:

1. **You keep BETTING while the count is at/above your play threshold.** For a seated wonger this
   is roughly **TC ≥ 0** (neutral or better; bet the min and ramp up as TC climbs). A pure
   back-counter instead *enters/sits down* only at **TC ≈ +1 to +3** (see §4).
2. **You WONG OUT (stop betting) when the count goes negative** — the commonly-taught line is
   somewhere in **TC 0 to −1** for tight play, and no later than **≈ −2** even with a big spread.
3. **SIT OUT vs LEAVE is decided by three factors, in this order of citation frequency:**
   **(a) penetration / decks remaining** (deep into a negative shoe → little chance to recover →
   leave; early → sit and wait for a possible turn); **(b) whether a fresh, already-shuffled shoe
   or table is available** (leave only pays if you can immediately start a new +EV shoe);
   **(c) cover/heat** (a brief sit-out reads as a phone call / bathroom break; leaving deep-negative
   shoes is natural cover too).
4. **Bankroll / risk-of-ruin does NOT drive the leave decision.** It shifts the entry/exit
   thresholds by ~1 TC per risk profile (aggressive vs conservative), but the sit-vs-leave call is
   dominated by **count + penetration + table availability**, not bankroll. `[INFERENCE from §4/§5]`

---

## 2. Wong-out threshold (when to stop betting / sit out)

**Consensus: stop staking as the count crosses from slightly positive into negative — the taught
band is TC 0 down to about −1, extending to ~−2 for aggressive spreads.** It is explicitly
penetration- and rules-dependent, so sources give a range, not one number.

- **Stanford Wong (namesake of "wonging"):** does not sit down for his hour of play until the shoe
  is near **TC +1**; in shoe games he "plays whenever he has any kind of advantage at all, and
  sometimes when he has a disadvantage but the count is zero or positive." I.e. he stops betting
  once the count is clearly negative. `[SEARCH-SNIPPET — bj21.com / blackjackinfo Wong interview]`
- **Break-even / edge reference points:** at **TC +2** the player is roughly break-even against
  typical shoe rules; at **TC +3** the player has ~a 1% edge. This is why wong-*in* thresholds
  cluster at +1…+3 and the wong-*out* line sits at/just below neutral. `[SEARCH-SNIPPET — Wizard of
  Vegas "A to Z Counting Cards"; corroborated across sources]`
- **Semi-wonging (stay seated, sit out bad counts):** "should exit a game when the count meets a
  pre-determined point"; experts put "an appropriate moment to exit … at a count lesser than 0,"
  and sitting out at −1/−2 lets you skip roughly a third of negative-expectation hands.
  `[VERIFIED — casinonewsdaily.com/blackjack-guide/wonging-semi-wonging]`

**Takeaway for ET3:** the bet↔sit boundary is essentially **TC ≥ 0 → bet, TC ≤ −1 → don't bet**,
which lines up cleanly with the app's **floored** true count (a TC of −0.5 floors to −1, so any
count below neutral is already in wong-out territory). The exact line is a convention the profile's
spread already encodes (R5 grades "sit out" as correct only when the profile's own spread calls for
min bet at that count). `[INFERENCE, consistent with docs/BACKLOG.md R5]`

---

## 3. SIT OUT vs LEAVE — the decisive factors

This is the new axis ET3 adds over R5's binary wong-out. The consensus factors:

### (a) Penetration / decks remaining → chance of recovery
- **A negative count late in the shoe rarely recovers**; early, it often does ("the count often
  nosedives, then recovers … while it's dropping, tens and aces are coming out, actually favoring
  your play"). So **early negative → sit and wait; deep negative → leave.**
  `[VERIFIED — blackjackinfo "Should I leave the table if the RC goes negative" / "Neg count when to
  leave" threads]`
- **KO worked example (6-deck), showing the penetration coupling:** exit at RC **−22 with 5 decks
  remaining, −17 with 4 remaining, −12 with 3 remaining** — each equating to a **true count of
  ≈ −1**. I.e. practitioners hold the *true-count* exit roughly constant (~−1) while the *running*
  count exit rises with depth. `[VERIFIED — blackjackinfo, poster "aslan"]`
- One respondent cited a penetration-varying TC exit table running **−0.85 to −1.61** depending on
  depth. `[VERIFIED — blackjackinfo "When to Leave to Maximize EV per hour"]`

### (b) Fresh shoe / another table available → is leaving worth it?
- **Leaving only pays if you can immediately start a fresh (near-neutral or countable-up) shoe.**
  "Late in the shoe it's more profitable to move to another game anytime the casino has the edge …
  **IF there are shoes already shuffled and ready to play**." If no fresh shoe is available, **stay
  and grind through the negatives** rather than waste time traveling. `[VERIFIED — blackjackinfo
  "When to Leave to Maximize EV per hour"]`
- On **double-deck**, leaving to hop is usually pointless — "no reason to table-hop a 2D game … you
  can't back-count and jump into another one until the shuffle" — so on DD you sit out (−4-ish) far
  more than you leave. The app is a 6-deck shoe game, so hopping is live. `[VERIFIED —
  blackjackinfo, posters "21forme"/"NightStalker"]`

### (c) Cover / heat
- **A short sit-out is natural cover** ("leave sometimes for a phone call or potty break"); as the
  count goes wildly negative you can sit out "with less concern that we'll need to come back in,"
  which reads naturally. Early-shoe departures look more suspicious, so counters use a **slightly
  more negative** threshold in the first shoe (e.g. −1.5 instead of −1) for cover.
  `[VERIFIED — blackjackinfo, posters "creeping panther"/"kewljason"]`

### Quantitative leave thresholds (6-deck), corroborated
- **Tight spread, few alternatives:** leave by **TC ≈ −1 to −1.5**.
- **Big spread + able to move around (table-hop):** leave **no later than TC ≈ −2 to −2.5**.
  `[VERIFIED — blackjackinfo "When to Leave to Maximize EV per hour"; "Neg count when to leave"]`
- **6-deck practitioner default:** "generally leave a 6D table at −1"; "−1.5 in the first shoe."
  `[VERIFIED — blackjackinfo, "21forme"/"kewljason"]`

---

## 4. Back-counting (Wonging) vs seated play

The bet/sit/leave framing depends on whether you are **seated** or **back-counting from behind**:

- **Pure back-counter (not seated):** simply **does not sit down until the count is +**. Entry
  ("wong-in") is optimally **TC +2 to +3 for a typical 6-deck game**, depending on risk profile;
  academic optimization of entry and exit together puts the **optimal exit at TC −2 to −3.**
  `[VERIFIED (abstract) — blackjack-science.net "Optimal Betting in Casino Blackjack II —
  Back-Counting" (Werthamer); SEARCH-SNIPPET — tandfonline / International Gambling Studies 6(2)]`
- **Casinonewsdaily framing:** wongers "abstain from action until the count is +2 or higher in
  multi-deck games," then leave "when the count becomes unfavorable, or until the shuffle."
  `[VERIFIED — casinonewsdaily]`
- **Seated wonger (the app's model):** the player is *already staked in the round loop*, so the
  decision each round is bet / sit-out / leave — this is the ET3 case. A back-counter's "don't sit
  yet" maps onto the app only as "SIT OUT" until the count rises, since the app always seats you.
  `[INFERENCE — reconciling sources with the app's seated round loop]`

**Why the numbers differ (entry +2/+3 vs exit −1):** the back-counter's higher entry bar (+2/+3)
is about *only playing +EV rounds from behind*; a seated player already paying table time exits
closer to neutral (−1) because their alternative is dead time, not another +EV shoe. Both are
consistent — they're answers to different questions. `[INFERENCE]`

---

## 5. Does bankroll / risk-of-ruin change the LEAVE decision?

**Consensus: no, not materially.** The leave/sit call is **count + penetration + table-availability
driven.** Bankroll enters only as a *risk profile* that nudges the count thresholds:

- Werthamer's entry (+2…+3) and exit (−2…−3) ranges are explicitly "depending on the
  back-counter's risk profile" — i.e. an aggressive (smaller-relative-bankroll-fraction, higher
  RoR tolerance) player enters lower and exits deeper; a conservative one the reverse. That's a
  **~1 TC shift**, not a change in the *structure* of the decision.
  `[VERIFIED (abstract)/SEARCH-SNIPPET — blackjack-science.net / tandfonline]`
- No source ties the *sit-vs-leave* choice to bankroll; all tie it to recovery odds (penetration)
  and whether a fresh shoe is available. `[INFERENCE from §3]`

**Recommendation:** ET3 should treat thresholds as **per-profile config (a risk knob)**, not derive
them from bankroll/RoR in v1. Bankroll can be an optional later refinement.

---

## 6. How this fits the app's existing model

From `docs/superpowers/specs/2026-07-13-blackjack-trainer-design.md` and `docs/BACKLOG.md` (R5):

- **Count model:** Hi-Lo, **true count = RC ÷ decks-remaining, floored toward −∞**, decks-remaining
  estimated to the **half deck**. 6-deck shoe, **cut card default 75%** penetration (configurable
  50–90%), H17/DAS/LS. `[VERIFIED — design spec §2]`
- **R5 already ships wong-out** as a graded binary: `Game.sitOut()` + a Sit Out button; a `wong`
  event is **correct when the profile's own spread calls only for the minimum bet at that count**
  (the wong-out line moves with the configured spread). Back-counting-in "falls out naturally"
  (sit through negatives, Deal when the count rises). `[VERIFIED — docs/BACKLOG.md R5]`
- **ET3's job:** add the **LEAVE axis** on top of that binary, "graded on EV/risk (uses imported
  CVCX numbers)." So ET3 = R5's bet↔sit boundary **plus** a penetration-gated sit↔leave boundary.
  `[VERIFIED — docs/BACKLOG.md ET3 line 334]`

Because the app already exposes **floored TC** and **decks-remaining to the half deck**, both
inputs the consensus rule needs are present. A snapshot for ET3 = `{ trueCount, decksRemaining
(or penetration %), profile spread, freshShoeAvailable?, riskProfile? }`.

---

## 7. PROPOSED GRADING RULE for ET3

A snapshot maps to exactly one correct action in `{ bet, sit, leave }`. Inputs: floored true count
**TC**, decks remaining **d** (or penetration), the profile's spread, a scenario flag
**freshShoe** (is an already-shuffled shoe/table available to move to), and an optional risk knob.
Defaults below are flagged **[convention]** (operator may tune) vs **[math-backed]** (grounded in
the cited EV logic).

### Thresholds (defaults)
- `T_BET` = **0** — at TC ≥ 0 you play your ramp. **[convention; = "bet whenever not negative",
  consistent with floored TC and Wong's "any advantage, or zero"]**
- `T_SIT` = **−1** — TC ≤ −1 is wong-out territory (don't stake). **[math-backed — the ~−1 exit is
  the most-cited 6-deck TC exit; floored TC makes anything below neutral read as ≤ −1]**
- `T_LEAVE_COUNT` = **−2** — a count this negative won't recover to +EV before the cut card in a
  typical remaining shoe; leave regardless of depth (if freshShoe). **[math-backed — matches the
  −2…−2.5 big-spread / −2…−3 optimal-exit band]**
- `D_LEAVE` = **2.0 decks remaining** — "deep": past ~2/3 of a 6-deck shoe (with 75% cut, ~4.5
  decks are dealt, so ≤ ~2 remaining ≈ late shoe). At/after this depth a negative count is unlikely
  to turn. **[convention — pick a depth proxy for "little chance to recover"; tune to the app's
  default 75% cut]**

### Decision (evaluate top-down)
```
1. if TC >= T_BET (0):                      -> BET        # play the ramp
2. else (TC <= T_SIT, i.e. negative):       # wong-out region
     leaveWarranted = (TC <= T_LEAVE_COUNT)          # deep-negative, or
                      OR (decksRemaining <= D_LEAVE) # late in a negative shoe
     if leaveWarranted AND freshShoe:       -> LEAVE      # recovery unlikely & a fresh shoe awaits
     else:                                  -> SIT OUT    # early negative (may recover), or
                                                          #   no fresh shoe (grind/wait), or cover
```

### Rationale mapped to the consensus
- **BET** while TC ≥ 0 — §2 (keep staking at/above neutral; ramp up as TC climbs).
- **SIT OUT** for a *mild, early* negative, or when *no fresh shoe* is available, or for cover —
  §3(a) recovery possible early, §3(b) don't travel to nothing, §3(c) natural short break.
- **LEAVE** when the count is *deep-negative* **or** *late in a negative shoe* **and** a fresh shoe
  is available — §3(a) no recovery + §3(b) a better shoe is ready.

### Risk-profile knob (optional, §5)
Expose one knob that shifts `T_SIT`/`T_LEAVE_COUNT` by ±1 TC: **conservative** → exit shallower
(`T_SIT=0`, leave at −1), **aggressive** → exit deeper (`T_SIT=−1`, leave at −2/−3). Do **not**
derive from bankroll in v1.

---

## 8. Open conventions the operator must still choose

1. **Does ET3 model `freshShoe` availability?** The sit↔leave split is *undefined* without it
   (§3b): with no other table, the correct action is almost always SIT OUT, never LEAVE.
   - **Option A (recommended):** make `freshShoe` a **scenario parameter** so ET3 can drill *both*
     "leave (fresh shoe ready)" and "sit/grind (nothing else open)" situations. This is the only
     way LEAVE is ever the graded-correct answer.
   - **Option B:** assume `freshShoe = true` always (leave is always available); simpler, but then
     ET3 never teaches the "grind because nothing's open" case.
2. **Exact `T_BET` line:** 0 (bet at neutral) vs tie it to "profile spread stakes > min units."
   R5 already grades wong via the profile spread, so aligning `T_BET` with the spread's min-bet
   floor keeps ET3 and R5 consistent — recommended.
3. **`D_LEAVE` depth proxy:** 2.0 decks-remaining is a convention; tune it to the configured cut
   card (50–90%). Consider expressing it as "≤ half the *playable* shoe remaining."
4. **Cover/heat as a gradeable axis?** The consensus treats cover as a reason to *sit rather than
   leave* early. ET3 could keep cover out of grading (it's ET4's job) and grade only the
   count+penetration+availability logic — recommended for v1 to avoid overlap with ET4.
5. **CVCX/CVCX-style EV numbers:** the backlog says ET3 "uses imported CVCX numbers." The rule
   above is threshold-form; if the operator wants EV-optimal (not convention) thresholds, import
   per-penetration exit TCs from CVCX/CVData and replace `T_SIT`/`D_LEAVE` with the table values
   (the KO/−0.85…−1.61 examples in §3 show real tools produce a penetration-varying exit TC).

---

## Sources

**Directly read `[VERIFIED]`:**
- Werthamer, "Optimal Betting in Casino Blackjack II — Back-Counting" (abstract) —
  https://www.blackjack-science.net/optimal-betting-2-back-counting (entry +2..+3, exit −2..−3)
- blackjackinfo forum, "Neg Count? when to leave table?" —
  https://www.blackjackinfo.com/community/threads/neg-count-when-to-leave-table.18894/
  (6D exit ~−1; KO −22/−17/−12 by decks; 2D −4; first-shoe cover −1.5)
- blackjackinfo forum, "When to Leave to Maximize EV per hour?" —
  https://www.blackjackinfo.com/community/threads/when-to-leave-to-maximize-ev-per-hour.23370/
  (leave −1.5 tight / −2.5 big-spread; fresh-shoe availability decisive; −0.85..−1.61 by pen)
- casinonewsdaily, "Wonging and Semi-Wonging Blackjack Card Counting Styles" —
  https://www.casinonewsdaily.com/blackjack-guide/wonging-semi-wonging/ (enter +2; exit < 0)

**Search-snippet only `[SEARCH-SNIPPET]`:**
- Wizard of Vegas, "A to Z Counting Cards in Blackjack" —
  https://wizardofvegas.com/articles/A-to-Z-Counting-Cards-in-Blackjack/ (wong out at −1/−2; TC +2
  break-even, +3 ~1% edge; penetration 75%+ needed)
- Werthamer, International Gambling Studies 6(2):111-122 —
  https://www.tandfonline.com/doi/full/10.1080/14459790600927670 (optimal entry/exit derivation)
- bj21.com / blackjackinfo Stanford Wong interview & "Professional Blackjack" —
  https://bj21.com/books/professional-blackjack-by-stanford-wong ,
  https://www.blackjackinfo.com/interviews/stanford-wong/ (sits at ~+1; plays any advantage/zero)
- casino.org, "What is Deck Penetration in Blackjack?" —
  https://www.casino.org/blog/what-is-deck-penetration-in-blackjack-and-why-its-important/
- Wikipedia, "Card counting" — https://en.wikipedia.org/wiki/Card_counting

**Not separately fetched but referenced by the project's prior research as standing ground truth:**
Wong *Professional Blackjack*, Schlesinger *Blackjack Attack*, Snyder *Blackbook* — consistent with
the +1..+3 wong-in / ~−1 (to −2 aggressive) wong-out bands above.
