# Functional Test-Coverage Matrix + Gap List (T0 audit)

**Date:** 2026-07-26
**Scope:** Every user-facing screen / drill mode / sub-mode / setting / toggle in the blackjack
trainer, mapped to the automated test(s) that exercise it. This is the **audit/matrix phase** of
backlog item **T0 · Complete functional test coverage**. No test code is written here — this doc is
the reviewable gap analysis another agent implements from.

**Method:** Read every screen (`src/ui/screens/*`, incl. `drills/*`), `App.tsx` nav,
`store/types.ts` (`Settings`, `Settings.drill`, `AudioSettings`, `Stats`), `Settings.tsx` +
`ProfileEditor.tsx` controls, the 5 drill views, and the audio layer (`src/audio/*`). Then read all
8 e2e specs (`e2e/*.spec.ts`) and noted the unit suites (`src/**/*.test.ts`). Cross-referenced into
the matrix below.

**Legend:**
- **✅ e2e** — exercised end-to-end through the real UI by a Playwright spec.
- **🟡 partial** — touched only indirectly (pre-seeded via `withSettings`/`withProfile` rather than
  driven through its control), or only one of several branches is covered.
- **🔬 unit-only** — pure logic covered by a unit test, but the UI/integration path is not.
- **❌ GAP** — no automated coverage of the user-facing behavior.

**Harness facts (verified in code):**
- Playwright `webServer` = `npm run dev -- --port 4173` (`playwright.config.ts`), which **does**
  serve `public/clips/` (3 real voices: `af_bella` [default], `bf_emma`, `bm_george`; 264 mp3s each;
  `public/clips/index.json` present).
- `?e2e=1` (`isE2eAudioMode`, `src/audio/speech.ts:39`) is checked **first** in
  `speak()`/`speakAsync()`/`chime()`, pushing text to `window.__speechLog` and **fully bypassing
  `clips.ts`** — Web Audio and HTMLAudio are never touched under `?e2e=1`. **Every existing e2e uses
  `?e2e=1`, so real clip playback has zero e2e coverage.**
- Table exposes `data-advice` on `.action-bar` only when `?e2e=1` (`Table.tsx:262`); the
  `playRoundByAdvice` helper drives rounds off it.

---

## 1. Navigation & Home (`App.tsx`, `Home.tsx`)

| Feature | Covered by | Status | Notes |
|---|---|---|---|
| Home renders, 4 nav buttons visible | `game.spec` "home renders and navigates" | ✅ e2e | |
| Home → Table (Play) | `game.spec`, many | ✅ e2e | |
| Home → Drills | `drills.spec`, `cycle1`, `audio.spec` | ✅ e2e | |
| Home → Stats | `settings-stats`, `drills.spec` | ✅ e2e | |
| Home → Settings | `settings-stats`, `audio.spec` | ✅ e2e | |
| Home → Profiles (profile chip) | `profiles.spec`, `cycle1`, `table-seats` | ✅ e2e | |
| Profile chip shows active profile name | `profiles.spec` "create+switch", "migration" | ✅ e2e | |
| Table remount on active-profile CONTENT edit (`key=id:JSON`) | `table-seats` seats round-trip (edits then plays) | 🟡 partial | The stale-Game money bug (`App.tsx:36-47`) isn't directly asserted; round-trip proves seats reach table but not the mid-play remount guard. |

---

## 2. Table / Play (`Table.tsx`, `useGame.ts`)

| Feature | Covered by | Status | Notes |
|---|---|---|---|
| Deal (single hand) | `game.spec` full round | ✅ e2e | |
| Deal (multi-hand bets) | `table-seats` multi-hand | ✅ e2e | |
| Player action: hit | `game.spec` (advice) | 🟡 partial | Driven only when advice==hit; never pinned. |
| Player action: stand | `game.spec`, `profiles.spec` S17 | ✅ e2e | Explicit Stand clicks. |
| Player action: double | `playRoundByAdvice` only | 🟡 partial | Only if advice==double on some seed; never deterministically forced. |
| Player action: split | `game.spec` split-flow (ten-value pair seed-hunt) | ✅ e2e | |
| Player action: surrender | — | ❌ GAP | Never exercised at the table (LS rule + advice==surrender never forced). |
| Insurance modal — Decline | `game.spec` "dealer ace triggers insurance"; `resolveInsurance(false)` everywhere | ✅ e2e | |
| Insurance modal — **Take** | — | ❌ GAP | `resolveInsurance` only ever declines; `insure(true)` path + `insuranceNet` message never e2e'd. |
| Count-check modal — RC entry | `game.spec` "count-check modal…" | ✅ e2e | |
| Count-check modal — **RC+TC two-stage** (`askTcToo`) | — | ❌ GAP | `countStage 'rc'→'tc'` path (`Table.tsx:226`) never triggered. |
| TC peek button (`countPeek`) — press/hold reveals RC/TC | — | ❌ GAP | Button never pressed; RC/TC peek text unasserted. Toggle persist covered separately (Settings). |
| Training wrong-play overlay | `game.spec` "training mode: wrong action" | ✅ e2e | |
| Test-mode session report (categories + mistakes + bankroll) | `game.spec` "test mode: 3-round session" | ✅ e2e | |
| Bet-spread chips (single hand) | `game.spec` bet-spread, `cycle1` | ✅ e2e | |
| Bet-spread grading in report | `game.spec`, `cycle1` | ✅ e2e | |
| Bot seats render (2-pass deal, P1..Pn labels) | `table-seats` full-table (3 bots) | ✅ e2e | |
| Bot narration lines + ordering | `table-seats`, `audio.spec` verbosity-full | ✅ e2e | |
| Bot bust synthetic line | — | 🟡 partial | `buildBotNarration` bust branch not asserted specifically. |
| Fast-forward bot narration | `table-seats` fast-forward | ✅ e2e | |
| Solo parity (bots:0 → no bot rows/labels/FF) | `table-seats` solo parity | ✅ e2e | |
| Multi-hand per-hand results sum to bankroll delta | `table-seats` multi-hand | ✅ e2e | |
| Shuffle message (`shuffledLastRound`) | — | ❌ GAP (minor) | `.message-shuffle` never asserted. |
| Dealer hole-card reveal (`holeRevealed`) | — | 🟡 partial | Rendered in many specs; face-down→reveal transition not asserted. |
| End session → Home (training) | `settings-stats` "short session" | ✅ e2e | |
| Deal speed (`dealSpeedMs`) effect | `table-seats` (0 and 5000 used) | 🟡 partial | Used as a pacing lever; the Settings stepper itself is not driven. |

---

## 3. Drills — picker (`Drills.tsx`)

| Feature | Covered by | Status | Notes |
|---|---|---|---|
| Picker shows 5 mode buttons | `drills.spec` "12-drills-picker" screenshot | ✅ e2e | Each mode reached in its own spec. |
| Back to Home | implicit | 🟡 partial | Not asserted directly. |

### 3a. Count Drill (`CountDrillView.tsx`) — the richest surface

| Sub-mode / control | Covered by | Status | Notes |
|---|---|---|---|
| Standard timed/auto flash → NumPad → result | `drills.spec` "flash 4 cards" | ✅ e2e | |
| Manual mode (tap-to-advance) | `cycle1` "manual countdown"* | ✅ e2e | (*named "countdown" but it's manual standard drill.) |
| Manual keyboard advance (Space/Enter/ArrowRight) | — | ❌ GAP | `CountDrillView.tsx:581` keydown listener never e2e'd. |
| NumPad typed digit + Enter | `drills.spec` "typed digit + Enter" | ✅ e2e | |
| **Countdown mode** (52-card, guess hidden tag ±1/0/−1) | 🔬 `countDrill.test` (`makeCountdown`) | ❌ GAP | The `setCountdownMode` toggle, tag-guess UI (`handleTagGuess`), and its result path are never e2e'd. |
| Timed Challenge (speed ramp) | `drills.spec` "timed challenge auto-advances" | ✅ e2e | Asserts time/spd/tier + `timedCount.history`, no double-count into `countDrill.history`. |
| Timed Challenge — Adaptive difficulty (competence gate) | `drills.spec` "adaptive difficulty picks faster start" | ✅ e2e | Seeds 8 accurate runs, asserts `attemptedTier:'pro'` + gate label. |
| Timed Challenge — Starting-pace stepper | `drills.spec` (via `withSettings`) | 🟡 partial | Value pre-seeded; the stepper isn't clicked. |
| Eyes-free AUTO (speech-driven pacing) | `audio.spec` Case 4b | ✅ e2e | Regression cover for eb6edb6. |
| Eyes-free MANUAL + honor self-check (spoken answer) | `audio.spec` Case 4 | ✅ e2e | Reaches `selfcheck` phase, spoken count answer. |
| Eyes-free **Strict mode** (keypad, graded) | — | ❌ GAP | `strictMode` toggle → graded `answering` path in eyes-free never e2e'd. |
| Distractions — Relentless / near-count | `drills.spec` "relentless distractions" | ✅ e2e | Mid-stream pause, `distraction.history` row, countKept back-fill. |
| Distractions — **Occasional** cadence | — | ❌ GAP | Only relentless (3rd card) exercised. |
| Distractions — **Generic** mode | — | ❌ GAP | Only default `near-count` exercised. |
| Distractions — off default (no interruption) | `drills.spec` "distractionFreq off" | ✅ e2e | |
| cardDetail 'face' changes narration | `audio.spec` Case 4c | ✅ e2e | 16 "ten" entries. |
| cardDetail 'full' | `audio.spec` (pinned in `dealToDecision`) | 🟡 partial | |
| cardDetail 'rank' (default) | — | 🟡 partial | Default path, never asserted directly. |
| **Group size 2 / 3** (`countGroup`) | 🔬 `countDrill.test` | ❌ GAP | Every e2e uses group 1; multi-card groups never rendered/narrated in UI. |
| Length / Speed steppers (setup) | `drills.spec` (via `withSettings`) | 🟡 partial | Pre-seeded, not clicked. |
| Result: gate-outcome display | `drills.spec` adaptive | ✅ e2e | |
| Replay button | — | 🟡 partial | Not asserted. |

### 3b. True Count Drill (`TrueCountDrillView.tsx`)

| Feature | Covered by | Status | Notes |
|---|---|---|---|
| Answer via NumPad, persists `trueCount.history` | `drills.spec` "true count drill" | ✅ e2e | |
| Max-decks stepper | — | 🟡 partial | Default 6, stepper not driven. |
| Eyes-free audio (self-check) | — | ❌ GAP | No e2e for TC drill eyes-free / strict / self-check paths. |
| Result screen | `drills.spec` | ✅ e2e | |

### 3c. Deck Estimation (`DeckEstimationView.tsx`)

| Feature | Covered by | Status | Notes |
|---|---|---|---|
| Half-deck button-grid guess, persists `deckEstimation.history` | `drills.spec` "deck estimation drill" | ✅ e2e | Clicks first option (0.5). |
| Shoe-size stepper | — | 🟡 partial | Default 6, not driven. |
| **Keyboard typed entry** (digits/`.`/Backspace/Enter) | — | ❌ GAP | `typedToValue` + keydown (`DeckEstimationView.tsx:135`) never e2e'd. |
| Visual-only (no audio) | implicit | 🟡 partial | |

### 3d. Flashcards (`FlashcardsView` in `Drills.tsx`)

| Feature | Covered by | Status | Notes |
|---|---|---|---|
| Answer → feedback → Next draws new card | `drills.spec` "flashcards: feedback" | ✅ e2e | |
| Keyboard "2" == Stand click (grading parity) | `drills.spec` "pressing 2 answers Stand" | ✅ e2e | |
| Keyboard 1/3/4/5 + Enter/Space-next | — | 🟡 partial | Only "2" and (implicitly) Next covered; other keys not. |
| Category segmented (all/hard/soft/pairs) inline | — | ❌ GAP | Inline `changeCategory` never clicked (Settings copy of same control also uncovered). |
| Eyes-free ZonePad tap → echo + verdict + chime | `audio.spec` Case 5 | ✅ e2e | |
| **Dim screen** (`dimZones`) toggle | — | ❌ GAP | Never toggled anywhere. |
| Latency `elapsedMs` captured + surfaced on Stats | `drills.spec` two latency specs | ✅ e2e | |
| Repeat (eyes-free) | — | ❌ GAP | `handleRepeat` never e2e'd. |

### 3e. Deviation Quiz (`DeviationQuizView` in `Drills.tsx`)

| Feature | Covered by | Status | Notes |
|---|---|---|---|
| Answer → feedback with index/label | `drills.spec` "deviation quiz: feedback" | ✅ e2e | |
| Index filter (per-index, e.g. 16v10) stability | `cycle1` "16v10 keeps drawing" | ✅ e2e | |
| Index select uses s17 vs h17 list | — | 🟡 partial | List source (`ILLUSTRIOUS_18_S17`) not asserted per-profile. |
| "Mix in fakes" (`quizDistractorPct`) persists | `drills.spec` "Mix in fakes persists" | ✅ e2e | |
| Distractor item feedback ("No index applies") | `drills.spec` "quizDistractorPct 100" | ✅ e2e | |
| Insurance variant (Take/Decline buttons) | `drills.spec` "deviation quiz feedback" (conditional) | 🟡 partial | Declines when it appears; Take-insurance quiz path not asserted. |
| Eyes-free insurance ZonePad (two-zone) | `audio.spec` Case 6 | ✅ e2e | |
| Eyes-free **action** ZonePad (non-insurance) | — | ❌ GAP | Case 5 covers flashcards zonepad; quiz-action zonepad path not separately covered. |
| Keyboard (1-5 action, 1/2 insurance, Enter/Space) | — | ❌ GAP | Quiz keydown listener (`Drills.tsx:807`) never e2e'd. |
| Dim screen toggle | — | ❌ GAP | |

---

## 4. Stats (`Stats.tsx`)

| Feature | Covered by | Status | Notes |
|---|---|---|---|
| Session appears after play | `settings-stats` "short session" | ✅ e2e | |
| Accuracy-by-category + median latency row | `drills.spec` "surfaces median decision" | ✅ e2e | |
| Export downloads json | `settings-stats` "export downloads" | ✅ e2e | |
| Import — garbage error path | `settings-stats` "importing garbage" | ✅ e2e | |
| Import — **success path** (`importAll` ok) | — | ❌ GAP | Only the failure path is e2e'd. |
| **Reset stats** (confirm → `EMPTY_STATS`) | — | ❌ GAP | Button never clicked. |
| **Speak summary** (`narrateStatsSummary`) | — | ❌ GAP | Button never clicked (would need `?e2e=1` speechLog). |
| Profile header — CVCX score/EV/ROR/note + actual acc/units-hr | — | ❌ GAP | Whole per-profile header block unasserted on screen. |
| Illustrious-18 table render (s17/h17) | — | 🟡 partial | Rendered but not asserted. |
| Timed-count / true-count / deck-est / distraction history sections render | — | 🟡 partial | Data-write proven by drill specs; on-screen rows in these sections not asserted (except count-drill latency). |

---

## 5. Settings (`Settings.tsx`)

| Control | Covered by | Status | Notes |
|---|---|---|---|
| Feedback mode (training/test) | `game.spec` (via `withSettings`) | 🟡 partial | Value pre-seeded; segmented not clicked. |
| Count peek toggle — persists across reload | `settings-stats` "changed setting persists" | ✅ e2e | Only toggle actually clicked in Settings. |
| Deal speed stepper | — | 🟡 partial | Pre-seeded only. |
| Flashcard category segmented | — | ❌ GAP | |
| Count group size segmented | — | ❌ GAP | |
| Count interval / count length steppers | — | 🟡 partial | Pre-seeded only. |
| Audio section renders w/ enabled controls | `audio.spec` "Audio section renders" | ✅ e2e | Asserts Test-audio button enabled. |
| Audio enabled toggle (click) | — | 🟡 partial | Enabled via `withSettings`, never clicked. |
| **Use recorded voice (`useClips`) toggle** | — | ❌ GAP | Drives `setClipsEnabled`; never clicked. |
| **Clip voice picker (`clipVoice`)** | — | ❌ GAP | Renders only when `useClips` on + >1 voice; never exercised. |
| Verbosity segmented | — | 🟡 partial | Pre-seeded via `withSettings`. |
| Card detail segmented | — | 🟡 partial | Pre-seeded (`'face'`/`'full'`). |
| **Speech rate stepper → 3.0** | — | ❌ GAP | Max 3.0 never driven; rate flows to clip playbackRate. |
| **Voice picker + preview-on-change** | — | ❌ GAP | `<select>` change fires a `speak(...)` preview; never e2e'd. |
| Chimes toggle | — | 🟡 partial | Default true, not clicked. |
| **Answer pause stepper → 0** | — | ❌ GAP | Min 0 never driven (0 = no self-check pause). |
| **Test audio button (click behavior)** | — | 🟡 partial | Enabled-state asserted; click → `speak`+`chime` not asserted (needs speechLog). |

---

## 6. Profiles / ProfileEditor (`ProfileEditor.tsx`)

| Feature | Covered by | Status | Notes |
|---|---|---|---|
| List → select active (badge, chip) | `profiles.spec` "create+switch" | ✅ e2e | |
| New profile → save → appears | `profiles.spec` | ✅ e2e | |
| **Duplicate profile** | — | ❌ GAP | `duplicateProfile` never clicked. |
| **Delete profile** (confirm, canDelete guard) | — | ❌ GAP | Never clicked. |
| Migration → "Default (6D H17)" | `profiles.spec` "migration" | ✅ e2e | |
| Rules — decks segmented (1/2/6/8) | — | ❌ GAP | |
| Rules — S17/H17 segmented | `profiles.spec` (S17 set + dealer soft-17 behavior) | ✅ e2e | Only rule toggle e2e-driven. |
| Rules — **DAS** toggle | — | ❌ GAP | |
| Rules — **LS** toggle | — | ❌ GAP | |
| Rules — **RSA** toggle | — | ❌ GAP | |
| Rules — **6:5 bj65** toggle | — | ❌ GAP | |
| Rules — Penetration stepper | — | ❌ GAP | |
| Seats — Your hands segmented | `table-seats` seats round-trip | ✅ e2e | |
| Seats — Bot players stepper | `table-seats` seats round-trip | ✅ e2e | |
| Seats — **Bot mistakes %** stepper | — | ❌ GAP | |
| Seats — **Your seat position** stepper (clamped to bots) | — | ❌ GAP | |
| Bankroll — Bet spread on toggle | `game.spec`/`cycle1` (via `withProfile`) | 🟡 partial | Pre-seeded; toggle not clicked (but its presence gates the ramp editor section). |
| Bankroll — Starting bankroll / $-per-unit / count-check-every | — | ❌ GAP | None driven via the editor UI. |
| **Bet-ramp editor — Add row / Remove row / minTc & units steppers** | — | ❌ GAP | Manual ramp editing untested; only CVCX paste covers ramp rows. |
| Bet-ramp — CVCX paste (input→parse→preview→confirm→save) + error | `cycle1` "CVCX paste import" | ✅ e2e | Happy path + line-1 error. |
| CVCX fields — score/EV/ROR/simNote | — | ❌ GAP | Editor inputs + Stats-header surfacing both untested. |
| Save / Cancel | `profiles.spec`, `cycle1` (Save) | 🟡 partial | Save covered; Cancel not asserted. |

---

## 7. Audio layer (`src/audio/*`)

| Feature | Covered by | Status | Notes |
|---|---|---|---|
| `speak`/`speakAsync`/`chime` e2e-log mode | `audio.spec` (all cases) | ✅ e2e | Via `window.__speechLog`. |
| Verbosity gating (off/results/full) | `audio.spec` Cases 1/2/7 | ✅ e2e | |
| Chime good/bad ordering | `audio.spec` Cases 3/5 | ✅ e2e | |
| Voice-pick heuristic (`pickBestVoice`) | 🔬 `speech.test` | 🔬 unit-only | No UI voice-picker e2e. |
| ZonePad hit-test geometry | 🔬 `zones.test` + `audio.spec` mouse clicks | ✅ e2e | |
| Wake lock lifecycle | 🔬 `wakeLock.test` | 🔬 unit-only | Eyes-free acquire/release not e2e-observable. |
| narrate.* string builders | 🔬 `narrate.test` | 🔬 unit-only | Surfaced indirectly through speechLog assertions. |
| **Clip segmentation cascade** (`segmentForClips`, `manifestLookup`) | 🔬 `clips.test` (22 cases) | 🔬 unit-only | Pure logic fully covered. |
| **Clip index/manifest fetch** (`loadClipIndex`, `loadVoiceManifest`) | 🔬 `clips.test` (fake fetch) | 🔬 unit-only | Real network fetch of `public/clips/*` never exercised. |
| **Clip PLAYBACK** (`playClipsAsync` → HTMLAudio chain, rate, interrupt) | 🔬 `clips.test` (fake `Audio`) | ❌ **GAP (headline)** | **Real mp3 fetch + playback has NO e2e** — `?e2e=1` bypasses `clips.ts` entirely. Verified today only by a manual deployed-site probe. |
| `useClips`/`clipVoice` wiring (`setClipsEnabled`/`setClipVoice`) | 🔬 `clips.test` flags | ❌ GAP | Settings→clips.ts wiring never driven through UI. |

---

## 8. Cross-cutting

| Feature | Covered by | Status | Notes |
|---|---|---|---|
| Settings persistence across reload | `settings-stats` (count peek) | ✅ e2e | One field only. |
| Stats persistence (drill history writes) | `drills.spec` `readStats` assertions | ✅ e2e | Multiple drills. |
| Profile persistence / active-profile | `profiles.spec`, `table-seats` | ✅ e2e | |
| **Single full-journey smoke run** (every screen+mode in one session) | — | ❌ **GAP** | **Confirmed: none exists.** Coverage is atomic per-feature; nothing walks Home→Table→each Drill→Stats→Settings→Profiles in one flow. |

---

## GAP LIST (ranked; each → the spec/harness that closes it, sized XS/S/M)

Ranking is by operator priority (T0 flagged items first) then by feature risk. **28 discrete GAPs**
(❌) plus a long tail of 🟡 partials.

### Tier 1 — operator-flagged in T0

1. **Clip audio real playback harness** — *M*. The headline gap. Needs a NON-`?e2e=1` spec (see §
   spec below). Closes: real mp3 fetch/playback, `useClips`, `clipVoice`, rate→playbackRate.
2. **Full-journey smoke spec** — *M*. One test walking every screen + every drill mode in sequence
   (see § spec below).
3. **Settings: `useClips` toggle** — *S*. Click the toggle, assert clip-voice picker appears (needs
   >1 voice, which `public/clips/index.json` provides), assert persistence.
4. **Settings: `clipVoice` picker** — *S*. With `useClips` on, select "Emma"/"George", assert
   persisted `audio.clipVoice`. (Naturally folds into gap 3.)
5. **Settings: speech rate stepper → 3.0** — *XS*. Step to max, assert value + persistence.
6. **Settings: answer-pause stepper → 0** — *XS*. Step to 0, assert value; ideally assert eyes-free
   drill then has no self-check pause.
7. **Settings: voice picker + preview** — *S*. Under `?e2e=1`, change `<select>`; assert the preview
   `speak('Queen. True count plus three.')` lands in `__speechLog`.
8. **Settings: Test-audio button click** — *XS*. Under `?e2e=1`, click; assert speechLog +
   `chime:good`.
9. **Settings: cardDetail full/rank/face via the control** — *S*. Drive the segmented control (not
   just `withSettings`); 'face' behavior already covered in count drill, so assert the setter path.
10. **ProfileEditor rule toggles: DAS / LS / RSA / bj65** — *S*. Toggle each, save, reload, assert
    persisted `rules.*`. (One spec, four toggles.)
11. **ProfileEditor: decks segmented (1/2/6/8)** — *XS*. Set decks=2, save, assert.
12. **ProfileEditor: penetration stepper** — *XS*. Step, save, assert.
13. **ProfileEditor: bet-ramp manual editor (Add row / Remove row / minTc & units steppers)** — *S*.
    Add a row, edit TC/units, remove, save, reload, assert ramp (independent of CVCX paste).
14. **Keyboard input — remaining drills** — *S*. One spec covering: count-drill manual
    Space/Enter/ArrowRight advance; deck-estimation typed digit + `.` + Enter; deviation-quiz 1-5 /
    insurance 1-2; flashcards 3/4/5 + Enter-next. (Parity-with-click assertions, mirroring the
    existing "pressing 2" spec.)

### Tier 2 — untested drill sub-modes

15. **Count drill: Countdown mode** (52-card, ±1/0/−1 tag guess) — *S*. Toggle Countdown, tap
    through, click a tag button, assert result + `countDrill.history` (cardsInRun=52).
16. **Count drill: eyes-free Strict mode** (keypad, graded) — *S*. Eyes-free + strict, enter RC,
    assert graded result + speechLog verdict.
17. **Count drill: distractions Occasional cadence + Generic mode** — *S*. Two variants of the
    already-covered relentless spec.
18. **Count drill: group size 2 / 3** — *XS*. Render group-of-3 flash, assert 3 cards shown per
    step (and/or 3-card narration under eyes-free).
19. **True Count drill: eyes-free / strict / honor self-check** — *S*. Mirror count-drill audio
    Case 4 for the TC drill.
20. **Deck Estimation: keyboard typed entry** — *XS*. Folds into gap 14 but listed separately since
    it's a distinct grammar (`typedToValue`).
21. **Deviation Quiz: eyes-free action ZonePad (non-insurance)** — *S*. Case-5 analogue for a
    non-insurance quiz item (pin an action index via `quizIndex`).
22. **Flashcards / Quiz: Dim screen (`dimZones`)** — *XS*. Toggle, assert ZonePad `visible=false`
    (`.zone-pad` still attached/tappable but dimmed).
23. **Flashcards: inline category segmented** — *XS*. Click Hard/Soft/Pairs inline, assert redraw +
    persisted `flashCategory`.

### Tier 3 — table & stats gaps

24. **Table: insurance TAKE path** — *S*. Seed-hunt a dealer-ace seed, take insurance, assert
    `insuranceNet` message. (Pairs naturally with existing insurance-decline spec.)
25. **Table: count-check RC+TC two-stage (`askTcToo`)** — *S*. Configure a profile/rules that sets
    `askTcToo`, submit RC then TC.
26. **Table: TC peek button** — *XS*. `countPeek` on, press-hold the peek button, assert it reveals
    `RC .. / TC ..`.
27. **Table: player surrender action** — *S*. LS profile + seed-hunt a surrender-advised hand, or
    force via a known seed; assert surrender result.
28. **Stats: Reset / Import-success / Speak-summary / CVCX profile header** — *S*. One spec: seed
    stats+CVCX profile, assert header numbers render; reset (accept confirm) → empty; import a valid
    export → restored; speak-summary under `?e2e=1` → speechLog.

**Long-tail 🟡 partials** (lower priority, mostly "control pre-seeded not clicked"): Settings
feedback-mode / deal-speed / count-interval / count-length / chimes / verbosity segmenteds;
ProfileEditor bankroll / $-per-unit / count-check-every / bot-mistake% / seat-position; Save-Cancel;
shuffle message; hole-card reveal; bot-bust line; Stats history-section on-screen rows. These are
best swept up by the full-journey smoke spec (gap 2) plus the per-control specs above.

---

## SPEC — Clip-playback harness (gap 1, the headline)

**Problem restated:** `?e2e=1` makes `isE2eAudioMode()` true, and `speak()`/`speakAsync()` short-
circuit to `__speechLog` **before** the `isClipsEnabled() && hasClips()` gate — so no existing test
ever fetches or plays an mp3. Real playback is verified today only by a manual deployed-site probe.
Headless Chromium can't "hear," so the harness must assert on **network activity + no console
errors + drill completion**, not audio output.

**Prerequisites / facts:**
- The Playwright `webServer` (`npm run dev` at :4173) already serves `public/clips/` — the mp3s and
  `index.json` are reachable at `/clips/...`. No separate build/serve step is needed for dev; if a
  production-parity run is wanted, `npm run build && npm run preview` serves the same assets.
- Chromium must be allowed to autoplay without a user gesture. The deployed-site probe used the
  launch arg **`--autoplay-policy=no-user-gesture-required`**. Add it for this project only:

  ```ts
  // playwright.config.ts (new project, so existing specs' behavior is untouched)
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    {
      name: 'chromium-audio',
      testMatch: /clip-playback\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
  ```

**The spec (`e2e/clip-playback.spec.ts`), step by step:**

1. **Navigate WITHOUT `?e2e=1`** — this is the whole point; real audio path must run. Pre-seed
   settings via `withSettings` with `audio: { enabled: true, useClips: true, verbosity: 'full',
   cardDetail: 'full' }` and a drill config that speaks known clip-covered phrases (a short count
   drill, e.g. `countManual:false, countLengthCards:5, countGroup:1, countIntervalMs:0`, eyes-free).
   Pin the clip voice (`clipVoice:'af_bella'`, the default) so expected filenames are deterministic.
2. **Attach a response listener BEFORE navigation** collecting every response whose URL matches
   `/clips/af_bella/.*\.mp3$` (and separately `/clips/index.json`, `/clips/af_bella/manifest.json`).
   Also attach a `console` listener collecting `type()==='error'` messages, and a `pageerror`
   listener.
3. **Attach a network sanity assert:** every collected clip response `.status()` is 200 (never 404)
   — proves the assets are actually served and the manifest keys line up with real files.
4. **Run the drill** (eyes-free auto count drill needs no taps; it advances on `speakAsync`). Because
   real playback (not the speechLog stub) drives the eyes-free loop, this also proves the
   `playClipsAsync`-in-`speakAsync` path resolves and advances the UI — a genuine integration test
   of the clip chain, not just a fetch.
5. **Assert drill completion:** `.drill-result` becomes visible within a generous timeout (e.g.
   20s). This is the "no hang" guarantee — if a clip promise never resolves, the eyes-free loop
   stalls and this times out.
6. **Assert mp3 fetches happened:** at least N distinct clip URLs were requested (≥5 for a 5-card
   deck: the per-card clips + the count-prompt clip), and `index.json` + `manifest.json` were each
   fetched exactly once (memoized).
7. **Assert clean console:** zero `console.error` and zero `pageerror` across the run — catches
   `preservesPitch`/`playbackRate` exceptions, decode errors, or CSP/MIME issues on the mp3s.
8. **Rate check (optional, S):** set `audio.rate: 2.0`, re-run, assert the drill still completes and
   still fetches clips — proving fast `playbackRate` playback doesn't break the chain (can't assert
   pitch headlessly, but completion + no-error is the reachable signal).

**Fallback-path variant (optional):** enable `useClips` but request a phrase with **no** manifest
entry (or `clipVoice` set to a bogus id). Assert the drill still completes (live-TTS fallback) and no
mp3 is fetched for that phrase — proving the cascade-miss → live fallback still works end-to-end.

**What it deliberately does NOT assert:** actual audible sound (impossible headless). Network +
completion + clean console is the maximal reachable signal, and it's exactly what the manual probe
approximated by ear.

---

## SPEC — Single full-journey smoke test (gap 2)

**Goal:** one spec that walks the entire app in a single session, so a regression that breaks any
screen's mount or a nav edge is caught even before the per-feature specs run. Runs under `?e2e=1`
(audio stubbed) with a pre-seeded profile so rules/ramp are deterministic. Keep assertions light —
"screen mounted + primary control present" — since the per-feature specs own deep assertions.

**Order of screens/modes to touch (each = navigate, assert its root selector, exercise one primary
action, move on):**

1. **Home** — assert `.home-title`; read profile chip.
2. **Profiles** — open via chip; assert `.settings-heading = Profiles`; open Edit on the active
   profile; assert `Edit Profile`; Cancel back to list; Back to Home.
3. **Settings** — assert `.settings-heading = Settings`; toggle Count peek and toggle it back (leaves
   state clean); scroll the Audio section into view (assert Test-audio button present); Back to Home.
4. **Table (Play)** — Deal; `playRoundByAdvice`; assert a `.message-result`; End → Home.
5. **Drills → Count Drill** — start a short run (pre-seed `countLengthCards:4`); reach `.numpad`;
   submit; assert `.drill-result`; Back to Drills.
6. **Drills → True Count Drill** — Start; submit OK; assert `.drill-result`; Back.
7. **Drills → Deck Estimation** — Start; click a `.deck-guess-btn`; assert `.drill-result`; Back.
8. **Drills → Flashcards** — answer (click Stand); assert feedback; Next; Back.
9. **Drills → Deviation Quiz** — answer (Decline-insurance or Stand, conditional like the existing
   spec); assert `.quiz-label`; Back to Home.
10. **Stats** — assert `.stats-heading`; assert the session from step 4 shows (`.session-row`),
    and at least one drill history section is non-empty (e.g. `.count-history-list`).

**One assertion that ties it together:** after the journey, `readStats(page)` shows a session
(from Table), a `countDrill`/`timedCount` entry, a `trueCount` entry, a `deckEstimation` entry, and
`latencyHistory` (from Flashcards/Quiz) — proving every mode not only mounted but wrote through to
persistence in one continuous session. Sizing: **M** (long but shallow).

---

## Summary numbers

- **Total user-facing features/controls inventoried:** ~130 rows across §1–§8.
- **❌ GAPs (no automated user-facing coverage):** **28 discrete**, consolidated into the ranked gap
  list above (plus the headline clip-playback + full-journey items).
- **✅ e2e-covered:** ~55 rows. **🟡 partial:** ~30 rows. **🔬 unit-only:** ~7 rows.
- **Answer to the operator's question ("do we have a complete test run through every
  functionality?"):** **No.** Coverage is strong and honest on the core play/drill/grade/telemetry
  paths, but four whole classes are unexercised end-to-end: (1) real clip audio playback, (2) most
  Settings audio controls, (3) most ProfileEditor rule/ramp controls, and (4) keyboard input outside
  two drills — and there is **no single full-journey smoke run**.
