# Blackjack Trainer: ranked backlog (Swarm A synthesis, 2026-10-16)

Lens codes: CMP competitors · LRN learning · PRO pro-counter · MUX mobile-ux · CAR car-eyes-free · ONB onboarding-motivation · STA stats-feedback · COR correctness · A11Y a11y-visual · PRF perf-reliability. **xN** means N lenses found it on their own.

Verification: I re-read the cited code for every high and medium bug. **CONFIRMED** means I saw the defect in the source myself, or a lens's probe reproduced it and the code path matches. **PLAUSIBLE** means the code path matches but the bug only shows on a device, in the car, or on a rule I didn't trace end to end. No claimed bug turned out to be wrong. One claimed bug isn't a code defect (wheel 'talk' default), so it's listed under decisions.

**Do this first.** F1 and F2 should ship *before* the planned run of deploys. Each deploy over the next two days can otherwise reload a drill in the car or wipe a Play session.

---

## Fix now (bugs), ranked

| # | Bug | Status | Lenses | Where | Fix | Effort |
|---|-----|--------|--------|-------|-----|--------|
| F1 | **A Play session saves nothing unless you double-tap End.** Leaving through the gear, a reload, or iOS killing the PWA loses every graded decision. The bankroll is still saved, so it no longer matches the stats. | CONFIRMED (`applyEvents`/`saveStats` only in `useGame.ts:607-620`; no pagehide handler) | STA, PRF x2 | `src/ui/useGame.ts`, `Table.tsx` | Commit each round's events when it settles. Write a small `playSession` snapshot on pagehide. endSession then writes only the session row. | M |
| F2 | **A deploy reloads the app mid-drill or mid-shoe when you come back from a call, Siri or Maps.** You land on a silent Home with eyes-free and the mic off. | CONFIRMED (`main.tsx:43` defers only for `fieldTestRunIsLive`) | CAR, PRF x2 | `src/main.tsx`, `updateCheck.ts` | Use one shared "activity live" flag, set by Table and every drill view, and defer the reload while it is set. | S |
| F3 | **Spoken prompt time counts as answer time.** The answer clock starts when the card is drawn, before the TTS prompt plays (about 1.5-3.5s), plus a 700ms mic tail. Voice answers land past `FLUENT_MS=4000`, are held as hesitant, and almost never promote. A 3s shot clock expires before the prompt finishes. | CONFIRMED (`Drills.tsx:592`, `:1446`, `:2264/2276` set `promptShownAtRef` in `next()`; the prompt is spoken in a later effect) | LRN, CAR x2 | `Drills.tsx` (Flashcards, Quiz, Mixed), `spacedRepetition.ts` | Start the clock at the measured prompt end (`speechActivity` `notifyActivityEnd`). Suspend the shot clock while eyes-free or voice is on. | S |
| F4 | **Index misses count against the basic chart cell.** Missing 16v10 at TC +1 lowers hard-16-v-10 in `cellStats`. Home then goes back to "Fix weak cells" (step 2, which comes before deviations), and Auto paints the cell Focus. Learning an index sends Jack back to basic strategy. **F4b:** a With-count flashcard miss on an index resets the *basic* cell's SR box, and the index's own quiz deck is never updated. | CONFIRMED (quiz event spreads `built.event` with `hand` → `cellIdForEvent` in `stats.ts:118`; `gradeAnswer.ts:419` reviews `card.cellId` only) | LRN | `gradeAnswer.ts`, `store/stats.ts`, `cellStats.ts` | Skip `cellStats` when the expected play came from a deviation (tally it in `perIndex` only). In With-count, review the quiz deck under `deviationId` and leave the flash cell alone. | S |
| F5 | **Play grades playing at TC 0 as a wong error**, including the first hand of every shoe. The Bet or sit drill and the repo's consensus doc both say TC ≥ 0 is a bet. | CONFIRMED (`game.ts:468-473` `sitOutIsCorrect` = spread at its minimum; `betSitLeave.ts:23` `T_BET=0`) | PRO, COR x2 | `src/engine/game.ts` | Grade the wong against a shared `T_BET` (see decision D1). | S |
| F6 | **H17 12 v 6 is one count off.** Every other negative index is stored as published index minus 1. H17 12v6 went in raw as `lte -3`, so the app stands only from -2. Published H17 is "stand ≥ -3", so the threshold should be -4. As stored it is no more negative than 12v5, though the H17 index should be more negative. This is Jack's default game. | CONFIRMED (`deviations.ts:67`; the five-row check in `docs/sources/verified-surrender-indices.md §6` only covered the S17 row; `strategy.test.ts:174` pins the wrong value) | COR | `deviations.ts`, `strategy.test.ts`, Charts index list | Set the threshold to -4 and fix the test. Better: store published indices verbatim and derive the hit threshold in one function. | S |
| F7 | **Play's count check ignores the profile's TC rounding.** On a truncate or round profile, typing the exact figure the app shows as expected is marked wrong. | CONFIRMED (`game.ts:806` `tcWithinEye(...)` has no 5th argument; `trueCountNow` uses `cfg.tcRounding`) | PRO, COR x2 | `game.ts:806` | Pass `this.cfg.tcRounding`. | XS |
| F8 | **The service worker serves the old clip manifest and voice index forever.** The SW is cache-first under a fixed cache name, and `warmCache` skips URLs already cached. The next clip regeneration will silently fall back to the iOS voice on Jack's phone. Also, old builds' JS and CSS are never pruned. | CONFIRMED (`public/sw.js:24,103`; `warmCache.ts:81`) | PRF | `public/sw.js`, `warmCache.ts`, `OfflineSection.tsx` | Make `clips/*.json` and the webmanifest network-first. Always refetch JSON in warmCache. Prune `/assets/*` entries the current document doesn't reference. Bump to `v2`. Add a 2.5s timeout on the navigation fetch (see W14). | S |
| F9 | **Hold-to-peek works while the count check is open, and the peeked answer is graded correct.** The peek button sits 48px above the keypad, easy to hit by accident in the car. | CONFIRMED (`Table.tsx:399` `revealPeek` has no guard; `PeekButton` at `:975` always renders) | MUX | `Table.tsx` | Disable the peek while `game.countCheckOpen` (or grade the check as peeked). | XS |
| F10 | **No-DAS profiles can still double after a split, and it's graded correct.** | CONFIRMED (`game.ts:390` `canDouble` never reads `rules.das`; no `das` reference anywhere in game.ts) | COR | `game.ts:390` | `canDouble &&= !hand.fromSplit \|\| rules.das` | XS |
| F11 | **Home "indices seen" and Next step always use the H17 17-index set.** On S17, 11vA is quizzed but never counted. With Fab 4 on, Stats shows 24 indexes while Home still says /17. | CONFIRMED (`nextStep.ts:140`, `readiness.ts:31` filter `ILLUSTRIOUS_18`) | ONB, STA x2 | `nextStep.ts`, `readiness.ts` | Use `indexSetFor(strategyRulesFor(activeProfile))`. | S |
| F12 | **Bone & Ink: the wheel self-check banner's answer is unreadable (1.01:1).** CSS uses `--panel`, `--muted`, `--danger` and `--warn`, which no theme defines, so they ignore the theme everywhere. | CONFIRMED (`app.css:3806-3851, 4065, 4499, 4546`; 0 hits in `themes.css`/`primitives.css`) | A11Y | `app.css` | Map them to `--raised`, `--ink-dim` and `--bad`. Add a lint grep that every `var(--x)` is defined. | XS |
| F13 | **The Profile editor drops unsaved edits when a tab is tapped**, with no prompt. Save is about 2,450px down the page. | CONFIRMED (headless repro `mobile-ux/walk8.cjs`) | MUX | `ProfileEditor.tsx`, `App.tsx` | Pin a Save bar that appears only when something changed, and confirm (or hide the tabs) on leaving. | S |
| F14 | **"Read summary aloud" on Stats says "This session" but reads lifetime totals.** It's the one stats readout Jack can hear in the car. | CONFIRMED (`narrate.ts:642-644`) | STA | `narrate.ts`, `Stats.tsx:335` | Follow the range picker and say the range. | XS |
| F15 | **Home says counting is "on target" while the Drills picker still says "get fluent first".** The two use different rules (5 runs vs 10 runs at 70%), and neither checks pace or run length. | CONFIRMED (`nextStep.ts:40-41` vs `fluencyGate.ts:14`) | ONB | `nextStep.ts`, `fluencyGate.ts` | Use one shared rule, and require paced runs of at least one deck (`countSpeed.classifySpeed`). Folds into W12. | S |
| F16 | **A Mastery miss isn't moved early in the next sweep.** Spec #29 says it is. The miss never reaches the SR deck the reshuffle reads, so the missed cell lands at median 173/330. | CONFIRMED (no `reviewCard` in the mastery path; `MasteryChallengeView.tsx:200` reshuffles from `srWeightsNow()`) | LRN | `gradeAnswer.ts`, `MasteryChallengeView.tsx` | Weight the just-missed cell to the front of the reshuffle. | XS |

**Lower-priority bugs** (fix in the same pass where cheap):

- **F17** Last-deck TC uses half-deck snapping, so 1D/2D Play grading can be off by up to 2 TC (`cards.ts:112-120`). CONFIRMED. Only matters for 1D/2D profiles. PRO.
- **F18** Pair cells that resolve to plain H/S/Rh/Rs return before the index check, so 6,6 v 2 skips the 12v2 index on no-DAS and 7,7 v 10 skips sur14v10 (`strategy.ts:255-262`). CONFIRMED. COR.
- **F19** Resplit aces at the 4-hand cap: an open A,A hand has only Stand available but is graded "expected hit". PLAUSIBLE (probe). COR.
- **F20** Speed drill yes/no answers count as full cell and index results and can satisfy Home's index gate (`speedDrill.ts:216-233`). CONFIRMED. LRN.
- **F21** Next step names one category ("Hard totals") but Start opens scope All, because `drillLaunch.ts` carries only the mode. CONFIRMED. ONB.
- **F22** Ending at Round 0 shows an empty Session report. CONFIRMED. MUX.
- **F23** Home (`Home.tsx:18`) and the session report use `Math.round`, so 99.6% shows as 100%. `statsFormat.pct` exists to prevent this. CONFIRMED. STA.
- **F24** A full localStorage drops saves silently: all 13 `saveStats` callers ignore the return value, and the retention-budget comment's arithmetic is wrong. PLAUSIBLE (probe). PRF.
- **F25** MistakeCard hard-codes Midnight's gold and red literals and fails AA in the other themes. CONFIRMED (contrast probe). A11Y.
- **F26** VoiceOver: steppers are just "−"/"+", the Modal has no `aria-labelledby`, and card `aria-label` sits on a role-less div. CONFIRMED. A11Y.
- **F27** Stats range note names the wrong sections as all-time, and three drill empty-states print twice. CONFIRMED. STA. Also: readiness reads `categories` while nextStep reads `cellStats` (no backfill), so they can disagree. ONB.
- **F28** The table ruleset label is 9.5px at 65% opacity. A11Y.

**Needs a device or car check (not code-verifiable):**

- **Bone & Ink + `black-translucent` status bar:** the clock and battery are probably invisible on the installed PWA, and `theme-color` never follows the theme. A11Y. Needs a one-look check on the phone.
- **Wheel `talk` default vs. the route not coming back after the mic closes:** see D2. CAR.

---

## Wave 1: high value, S/M (implement after the fixes)

| # | Item | Lenses | Where | Why it matters to Jack | Effort |
|---|------|--------|-------|------------------------|--------|
| W1 | **Index Test mode in the Deviation quiz.** Given a hand and up-card with no TC, Jack says the index number ("16 v 10" → "zero"). Graded against `indexSetFor(rules)`, answered by voice, wheel number or stepper, and feeds the per-index SR. | CMP | `deviationQuiz.ts`, `Drills.tsx` quiz options | Today's quiz draws TC within ±2 of the line (`tcNearThreshold`), so it tests which side of the line a count falls on, never where the line is. Recall is a single spoken number, which makes it the best eyes-free I18 drill. No mobile competitor offers it by voice. | S |
| W2 | **Next step uses the SR schedule.** Insert "Review N due" (cells and indexes) whenever enough is due, including after the "Play a shoe" step; Start opens a due-weighted drill. After the path is done, rotate to the stalest skill. | LRN, ONB x2 | `nextStep.ts`, `Home.tsx`, `srStatus.ts` | Spec #28 promised this. Today Jack sits on "Play a shoe" for good and the card is dead weight. "One tap, the app picks what's due" is the lowest-friction car session there is. | S/M |
| W3 | **Judge "weak" on recent results, not lifetime totals.** Add a last-10 bit string per `CellTally` and drive `WEAK_CELL_BELOW` and Auto Focus from it. | LRN (+STA recent windows) | `cellStats.ts`, `nextStep.ts`, `cellSelection.ts` | A cell he fumbled while learning takes 14 straight correct answers to clear. Home keeps sending him to fix things he has already fixed, and that erodes trust in the card. | S |
| W4 | **Bigger cards on Play, the Count drill and Pair cancellation**, plus **bigger action-bar labels** (10.9px today). Use clamp() for size and centre the felt. | MUX, A11Y x2 | `app.css:251-278, 487-505`, Table, CountDrillView | He glances at it from a cradle: today a 48px card sits in a 700px void. Audit items P2-2/P2-3 never shipped. | S/M |
| W5 | **Play result banner with both totals** ("LOSE −1 · You 17 · Dealer 19") over the hands. | MUX | `Table.tsx` `resultMessage` | It's the only round feedback, it's the smallest text on the felt, and no totals are shown anywhere today. | S |
| W6 | **Wrong-play card:** Continue becomes the gold primary button, placed in the thumb zone. "Show on chart" becomes a text link. Collapse "Wrong play / WRONG / BASIC STRATEGY ERROR" into one line. | MUX, A11Y x2 | `Table.tsx` Modal, `MistakeCard.tsx` | Continue is pressed after every mistake, and today the thumb travels about 200px to the weaker-looking button. | S |
| W7 | **Cost and history on every miss:** "−0.61 u each · 3rd miss on 8,8 v 4 (2/5 lately)". Eyes-free says "expensive one" for misses of 0.25u or more. | STA | `HandResultStrip.tsx`, `handResult.ts` | Pass/fail makes a 0.61u miss look the same as a 0.004u one. The price is already computed (`priceMistake`) but hidden in Stats. | S |
| W8 | **Bet or sit becomes a bet-sizing drill:** RC plus tray in, rung of the profile's spread (or Sit) out, graded with Play's `spreadUnitsFor`. One tap, wheel-capable. | PRO (+CAR wheel) | `betSitLeave.ts`, `BetSitLeaveView.tsx` | The drill prints the TC, so the answer is just its sign, a test that can't fail. The bet is where a counter makes his money, and no drill trains the RC→tray→divide→rung chain. | S |
| W9 | **Wheel-graded Speed drill (and Bet or sit) in eyes-free:** forward = yes, back = no, real grading, no mic, clock off. | CAR | `SpeedDrillView.tsx`, `speedDrill.ts` | Wheel-only is the one car path the field data says is reliable (voice resolved 60% with BT on). Today the wheel can only self-report. This would be his first truly graded mic-free car drill. Needs four new Kokoro clips. | M |
| W10 | **One-tap "Drive: <last drill>" on Home:** reopens the last eyes-free or voice drill with eyes-free on. The tap is also the iOS audio gesture. | CAR | `Home.tsx`, `eyesFreeSession.ts`, `drillLaunch.ts` | After an iOS eviction, getting back takes 3+ taps, which is a multi-glance task while driving. This makes it one tap. Nothing new to fill in. | S |
| W11 | **Pause a count run from the wheel:** back = pause ("Paused"), forward = resume, and paused time is excluded from timing. | CAR | `CountDrillView.tsx:1450, 1521` | A count run is system-paced, so a merge or hazard costs him the run. Today a back press while cards are flashing is ignored. Driver-paced tasks are the NHTSA/Google norm. | M |
| W12 | **Session report that drives practice:** plays and counts shown separately, mistakes sorted by cost, "RC off by N", and a "Drill these hands" button that opens Custom with those cells as Focus. Replace "units per hour" (pure luck) with **u lost to mistakes per 100 hands**. | STA, PRO x2 (both: units/hr is luck) | `Table.tsx` ReportScreen, `useGame.buildReport`, `Stats.tsx:596` | It's the one screen he always sees after a shoe. One tap turns it into targeted practice, and the headline becomes a skill number that luck doesn't move. | M |
| W13 | **Next step Start is the single gold primary button.** Hide "Play a shoe" when the step is play, and fix the fresh-install copy. | MUX, ONB x2 | `Home.tsx:113-127` | Two buttons compete today, and the generic one wins visually. | XS |
| W14 | **Navigation timeout in the SW:** serve the cached shell after about 2.5s and refresh in the background. Ships with F8. | PRF | `public/sw.js` | In dead zones a stalled document blocked launch for 20s in testing, while a fully offline launch takes 34ms. Weak signal is what Jack actually gets in the car. | S |
| W15 | **Hide empty CVCX rows on Stats** and stop the Profile block opening first on every sub-tab. | MUX, STA x2 | `Stats.tsx:655-686` | Six "—" rows are the first thing on every Stats tab. This was audit P3-9 and is still open. | XS |
| W16 | **Escalate after repeated misheard answers:** 1st miss a tone, 2nd re-asks the hand, 3rd plays a hint line. Give "not understood" and "PTT opened" different tones. | CAR | `useVoiceControl` callers, `speech.ts:1431` | 8 of 21 utterances were rejected with BT on, and each one got the same ding. In talk mode he can't tell "speak now" from "say it again" by ear. | S |
| W17 | **Engine rules-combination regression suite** (das/ls/rsa/s17/decks/tcRounding): no expected action is ever illegal, and the count check accepts `trueCountNow` under every rounding. | COR | `game.test.ts` | F7, F10 and F19 only appear on non-default switches, which the suite doesn't test. This is the guard for the fixes above. | S |

## Wave 2

- **Casino-order Next step ladder plus a visible path on Home.** Order: BS → weak cells/mastery → running count at table pace → deck estimation + TC → deviations (profile set) → bet ramp → Play. Show 7 rows with progress on the current one, and have fluencyGate read the same result. ONB. M. *(D5)*
- **Learning step for misses:** re-ask the missed card 3-6 cards later, and require a second spaced correct answer before box 1. Today a missed card returns within 10 draws only 2.5% of the time early on. LRN. M.
- **Hot shoe option in Play** (opt-in, labelled on the report). A mildly biased shoe so TC +2 to +5 decisions actually come up. CMP. M. *(D6)*
- **Opt-in BJA H17 extra indices** from `docs/sources/BJA_H17.pdf`: 16vA stand +3 (no surrender), 15vA +5, 8v6 +2, A8v4 +3, A8v5 +1, A8v6 0−, A6v2 +1, TTv4 +6. Needs a soft-deviation kind. PRO, COR x2. M. *(D6)*
- **Play: accept decisions inside the by-eye TC band** and tag them "borderline". The count check already accepts the band, but index, insurance and bet grading don't. PRO. S.
- **Move the mute button into each top bar** (open question G4) and drop the 44px strip. Unify the header grid and delete the "Back to Home" buttons on tab screens. MUX, A11Y x2. M. *(D3)*
- **Collapse drill setup controls after the first card** (Flashcards, Quiz, Mixed) into one summary line. MUX. M.
- **Count drill result shows the dealt run** with +1/0/−1 per card and running totals; remove the duplicate back exits. MUX. M.
- **Car status line on the eyes-free pad:** hand · what the wheel does now · mic state · score. Replaces the TODO G4 "car mode screen". CAR. M.
- **Rules change → retrain changed cells:** store the rules on each SrCard and treat cells whose answer changed as due. LRN. M.
- **Mixed shows a TC on every item**, so the cue doesn't give away the answer type. Do after F4b. LRN. S.
- **True count drill weighted to Jack's misses and reachable depths** (no 0.5/1 deck on a 6D 75% shoe). LRN. S.
- **Mastery step passes on per-section sweeps** (Hard, Soft, Pairs). A clean 330-cell run at 99% succeeds only 3.6% of the time. LRN. S. *(D4)*
- **Stats skill-gate block** (per-skill recent figure vs target, tap through to the drill). Respects the RV6 "no composite score" decision. STA. M.
- **Stats noise cut:** hide 0/0 rows, show a one-line trend instead of timestamp logs, and surface the Produce-TC and quiz histories (recorded, never shown). STA. S.
- **Per-index table with early/late direction**, worst first. STA. M.
- **Time decisions in Play** (`elapsedMs` on act events) so median speed reflects the table. STA. M. Pairs with an **optional dealer-pace clock in Play**, off in eyes-free. PRO. S.
- **Bare tray option or auto-fade** for the deck marks once Deck estimation is consistently good. PRO. S.
- **One action-colour palette** shared by the Custom painter, the MistakeCard cell and Charts (the painter's Surrender is brown, Charts' is slate). A11Y. S.
- **Bigger Charts text** (cells are 11.5px, corner label 9px). A11Y. S.
- **Chart recall "Test me" on Charts:** blank chart, paint from memory, misses feed SR. CMP. M.
- **Real reasons on BS misses:** a rule family plus a dealer bust %, instead of "Basic hit vs dealer 7". ONB. M.
- **Storage-budget guard:** a toast on failed saves, trim the diag log first, `navigator.storage.persist()`. PRF. S.
- **Bundle split:** vendor chunk plus lazy FieldTest/TestKit, with a build manifest feeding the offline shell list and failed chunk loads triggering the update reload. 207KB → about 77KB gz on the main path. PRF. M.
- **Extract Flashcards/Quiz/Mixed out of `Drills.tsx` (3023 lines)** into a shared answer hook. Do it before or alongside F3 so the timing fix isn't written three times. Its own PR with no behaviour change. PRF. M.

## Later / maybe

- Hi-Lo values on screen plus an easy first count run (ONB). Good for a beginner, little value for Jack.
- Practice-days line ("5 of the last 7 days"), no streak (ONB).
- Step progress pill on drill result screens (ONB).
- Wheel number entry starting from the last checkpoint answer (CAR).
- Type-scale tokens in `primitives.css` (45 font sizes) (A11Y).
- SVG mute and gear icons instead of emoji (A11Y).
- Append-only diag-log flush (PRF): 10ms/s at the cap, and only after the storage guard.
- Dealer-error "Foul" call (CMP): small edge payoff.
- Close the quarantined BJA "12, 4, 3" note in `docs/BACKLOG.md` as "not on the page; the real advice is already covered" (CMP). A 2-minute docs chore.

## Rejected

- **XP, levels, cities, leaderboards, Game Center** (CMP): engagement mechanics. Home's Next step and readiness already give skill-tied progress, and these clash with Jack's terse style.
- **Multiple or editable counting systems** (CMP): the app is Hi-Lo by design, and side counts are already out of scope.
- **Real-money results tracker or casino database** (CMP): manual entry he won't do; CVCX/RV1 already cover it.
- **Practice-reminder push notifications** (CMP): needs a push server on an iOS PWA, for little gain.
- **LLM "AI coach"** (CMP): the derived `narrateReason` corrections are exact and work offline.
- **Strict streak counter** (ONB, self-rejected): loss-aversion pressure; the practice-days line covers the need.
- **"Repeat my misses" steering inside the hot shoe** (CMP): SR plus Custom Focus already target weak cells.
- **Skill-EV "expected u/hr" row** (PRO): superseded by W12's mistakes-per-100-hands, which needs no edge model.

---

## 10 end-to-end user stories to test after implementation (375x812, notch insets, headless, muted)

1. **Car interruption.** Eyes-free Flashcards, then a Play shoe with 10 graded rounds. Deploy a newer build (stub `version.json`, watch enabled, not `?e2e=1`), then hide and show the page. Nothing reloads mid-run. Then reload or close the page without End: the 10 decisions are in Stats, and bankroll and stats agree. (F1, F2)
2. **Voice timing.** Eyes-free + Voice Flashcards with the fake recogniser answering 500ms after the measured prompt end (prompt stubbed at 3.5s). The SR box promotes across sessions. With the shot clock at 3s, no card times out while its prompt plays. (F3)
3. **Index learning stays on indexes.** With BS at target, miss 16v10 four times in the Quiz. Home still says "Learn the deviations", and Custom Auto doesn't paint hard-16-v-10. A With-count miss on 16v10 at +2 leaves the basic cell's "Next review" unchanged and makes the 16v10 index due. (F4, F4b)
4. **Wong line agrees.** Default profile, spread on, fresh shoe. Bet 1u at TC 0 over 10 neutral rounds. No wong misses in the report or in Stats > Wong. The reworked Bet or sit grades the same RC and tray the same way as Play. (F5, W8)
5. **Index correctness across profiles.** H17 6D: 12 v 6 at TC −3, answer Stand, graded correct, and Charts reads "hit ≤ −4". A truncate profile's count check accepts the TC shown as expected. A no-DAS profile shows no Double after splitting 8,8. Switching to S17 with Fab 4 on changes Home's index denominator to match Stats. (F6, F7, F10, F11)
6. **Index Test by voice in the car.** Eyes-free + Voice, Index Test mode, 10 items including a wrong "plus two" for insurance. The spoken correction gives the right index, the B1 strip shows the answered hand, and the per-index SR updates. (W1)
7. **A Play round at a glance.** Cards are at least 70px wide, and the result banner shows the result plus both totals at 20px or more. A wrong play puts gold Continue at y > 650, and "yes" by voice dismisses it. With count check every round, the peek can't reveal the count. End at Round 0 returns with no report and no session written. All 4 themes pass AA on the MistakeCard. (W4, W5, W6, F9, F22, F25)
8. **Home picks the right thing.** Reach the "Play a shoe" step, then advance the clock 10 days with 40+ cells overdue. Next step shows "Review N due" as the single gold primary button. Start opens a due-weighted drill, and a cell fumbled long ago but now 10/10 recently is not called weak. (W2, W3, W13)
9. **Session report to practice.** End a shoe with 2 basic errors and 1 wrong count check. The report shows plays and counts separately, mistakes sorted by u, "RC off by N", and "−x u / 100 hands". "Drill these hands" opens Custom with exactly those cells as Focus. The miss strip in the drill shows cost and "n of last 5". (W7, W12)
10. **Offline and weak signal.** With the SW installed, stall the document 20s: Home appears in about 3s from cache. Change `clips/af_bella/manifest.json` in a new build: the new phrase plays as a recorded clip, and "Save for offline" stores it. After 3 deploys, Cache Storage holds one `index-*.js`, and "Saved on this phone" counts only the current build plus the voice. (F8, W14)

---

## Decisions only Jack can make

| # | Question | Recommendation |
|---|----------|----------------|
| D1 | **Where is the wong-out line in Play?** (a) The researched consensus: TC < 0 sit, TC ≥ 0 bet, shared with the drill. (b) Derived from his spread: sit whenever the spread says minimum, which makes TC 0 a sit today. | **(a)**, one shared `T_BET`. Two screens disagreeing is the bug, and (a) is the repo's own sourced rule. |
| D2 | **Keep wheel mode `talk` as the default?** Run 1 found that closing the mic doesn't give the route back to the car, and push-to-talk has never been checked on the Web Audio path. | **Run one discriminating step on the next drive:** talk mode, BT on, press forward, answer, let the window close, press back in the silence. If the log lacks `wheel dispatch handled=true`, switch the default to `answer`. |
| D3 | **Move the mute button into each screen's top bar and drop the 44px strip?** (Open item TODO G4.) | **Yes.** Charts #24 already proves the pattern works, and it gives back 5% of the 13 mini's height on every screen. |
| D4 | **Should the Mastery step on Home pass on three clean section sweeps (Hard, Soft, Pairs) instead of one 330-cell sudden-death run?** | **Yes.** Keep the whole-chart run as an optional challenge. At 99% per answer, a full clean run succeeds 3.6% of the time and blocks every later step. |
| D5 | **Reorder Next step to casino order** (count at table pace and TC conversion *before* deviations, then the bet ramp) and show the whole ladder on Home? | **Yes.** Indexes are keyed to the true count, and today the path teaches them before any counting. It also removes the Home vs picker contradiction. |
| D6 | **Opt-in training modes: (a) a "Hot shoe" Play option** (biased toward positive counts, labelled on the report) and **(b) BJA H17 extra indices** (16vA +3 and others). | **Yes to both, default off.** (b) comes from a source already in the repo. (a) is how CVBJ fixes "most hands are at TC 0", and the label keeps the bankroll honest. |
