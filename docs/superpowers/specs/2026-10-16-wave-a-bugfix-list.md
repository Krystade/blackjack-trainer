# Wave A — bug fixes (2026-10-16)

Sources (read the evidence there before changing anything):
- Swarm A backlog: scratchpad/swarmA/backlog.md (F-numbers, W-numbers)
- Swarm B user-story findings: scratchpad/swarmB/findings.json (story findings with repro steps, screenshots under scratchpad/swarmB/<story>/)

Jack's decisions:
- D1 wong line: **follow his spread** (Play keeps "sit whenever the spread says minimum"). So F5 is NOT a Play change; instead make the Bet or sit drill grade against the same profile spread rule so the two screens agree.
- Mute button into top bars, casino-order Next step ladder, Review N due, hot shoe, BJA H17 extras, S17-vs-H17 and 6-vs-8-deck difference training: all WAVE B, not here.

Rules for every lane:
- Work only in your worktree. Commit with explicit paths (never `git add -A` / `git add .`; never commit docs/sources/chart-view-*.png). Never stop a process you did not start.
- File ownership (to keep merges clean): Table.tsx + engine/game.ts → A1 only. Drills.tsx + drills/* views → A2 only. main.tsx, public/sw.js, warmCache, app.css var fixes, ProfileEditor → A3 only. Stats.tsx, Home.tsx, nextStep.ts, cellStats/readiness → A4 only. store/types.ts and store/persist.ts: additive optional fields only, appended at the end of the relevant interface, with a comment; no renames.
- New CSS goes in new files (not app.css), except A3's undefined-variable fix.
- TDD where practical: a failing vitest or e2e first, then the fix. Mutation-check each new test (back up with cp to your scratch dir, break the fix, see it fail, restore with cp — never git checkout).
- Gates before you finish: `npx tsc -b`, `npx vitest run`, `npm run lint` (baseline 13 warnings — do not add any), `npm run build`, and the e2e specs that touch your files: `E2E_PORT=<your port> npx playwright test <specs> --project=chromium --reporter=line`. Update any existing test whose expectation your fix deliberately changes, and say so.
- Verify UI changes visually: headless screenshot at 375x812 and READ it.

## Lane A1 — Play and engine (E2E_PORT 4610)
1. F1 Play session persistence: commit each settled round's events to stats (so reload/eviction/leaving loses nothing); End writes only the session row; bankroll and stats never disagree.
2. Shuffle round: the bet on the round after the cut card is graded against the reshuffled TC 0 with no warning — grade it against the count the bet was placed at (or announce the shuffle before the bet). (swarmB s06)
3. Bet spread can't be turned on from the Play gear and 'All settings' is a dead end (s06 high) — the bet spread toggle must be reachable from the Play gear sheet (TabSettingsSheet/profileOptions are fair game for this item).
4. F7 count check passes cfg.tcRounding. F9 no peek while the count check is open. F10 no double after split without DAS. F17 last-deck TC snapping for 1–2 deck. F18 pair cells skip index check. F19 resplit-aces cap expected action. F6 H17 12v6 index (store published value, test pinned to the correct -4 hit threshold / stand ≥ -3).
5. F22 End at round 0: no empty report, no session written.
6. Table cosmetics from s06: doubled hand shows its real bet, split hands labelled on the felt in play order, 'Bet cover' warning consistent with grading, bet ramp editor never shows the 'TC ≥ -99' sentinel.
7. Bet or sit drill grades against the profile spread rule (D1), sharing one function with Play's sitOutIsCorrect.
8. Engine rules-combination regression suite (W17): das/ls/rsa/s17/decks/tcRounding — expected action always legal, count check accepts trueCountNow under every rounding.

## Lane A2 — Drills grading and timing (E2E_PORT 4620)
1. F3 answer clock starts at measured prompt end (eyes-free/voice); shot clock suspended while eyes-free or voice is on; shot clock stops after N consecutive timeouts with nobody there (s09) and never starts the next card while the wrong-answer correction is still being read.
2. F4/F4b: index-driven expected plays don't touch the basic cell's cellStats/SR; With-count index misses review the quiz deck under the deviation id.
3. F16 a Mastery miss is weighted to the front of the next reshuffle. Speed changing Hands scope must not destroy an in-progress Mastery run (s10 high).
4. F20 Speed yes/no answers don't count as full cell/index results.
5. Count-family double taps: double-tap OK / OK with nothing typed must not grade a phantom 0 on the next question (s05/s04 high); Deck estimation double-tap must not exit or skip the result; Produce TC must not start flashing the next round under the result being read (s05 high).
6. Round convention exact half: strip and Stats must agree with the grade (s05 high).
7. Flashcards/quiz: with Options open a miss must not push the answer bar off-screen (s03 high); With count saying 'No index here' on index cells below the index (fix copy: say the index and that the count hasn't reached it); quiz with one index picked must not print its answer above every question; index miss card prints the index line once.
8. Deviation quiz 2-deck contradictions on 11vA and 9v2 (s08 high) — quiz must use indexSetFor(strategyRulesFor(profile)) and the profile's basic chart.
9. Plain flashcards must not label beginner basic mistakes 'Phantom deviation' when the drill has no count (s01).
10. Count drill: two identical consecutive cards must be visibly re-dealt in auto mode; distraction positions must vary per run; checkpoint read-back colour/wording must agree ("you said 1, it was 1" is not red).
11. Real minus signs (U+2212) everywhere a signed count/TC is shown in drills (pair cancel buttons, bet or sit TC, quiz TC, NumPad display, distraction prompts) and fix the em-dash-before-minus double dash in strips.

## Lane A3 — Platform, data safety, theming (E2E_PORT 4630)
1. F2 one shared "activity live" flag (Table + every running drill) defers the update reload.
2. F8 + W14 service worker: clips/*.json and webmanifest network-first, warmCache refetches JSON, prune stale /assets entries, cache name v2, 2.5s navigation timeout falling back to the cached shell.
3. F24 storage guard: saveStats failures surface (toast) instead of silently dropping; trim diag log first; request navigator.storage.persist().
4. F12 undefined CSS vars (--panel, --muted, --danger, --warn) mapped to theme tokens; add a check (vitest or script) that every var(--x) used in CSS is defined.
5. F13 Profile editor: sticky Save bar shown when dirty, confirm before discarding on tab tap; a new profile becomes active on Save (or offers to) (s08).
6. Theme: no Midnight frame before the stored theme applies (s09); theme-color meta follows the theme; Bone & Ink active tab distinguishable (s09); segmented controls mark the selected option by more than text colour (s09); mute disc visible in Bone.
7. Settings/Profile copy: '2 deck' → '2 decks'; profile name input uses the app font; WebKit native checkboxes/selects styled (s03, s04, s08).
8. Play topbar profile name size/contrast (F28) — coordinate: the CSS lives in src/ui/screens/tableTopbar.css (A3 may edit that file; A1 must not).

## Lane A4 — Home, Next step, Stats (E2E_PORT 4640)
1. W3 + s01 high: category/cell "weak" and the Learn-basic-strategy gate judged on a recent window (last-N per category/cell), keeping a minimum sample; Home and Stats show the same figure (s02 high: they disagree today).
2. F21 Start opens the scope Next step names (drillLaunch carries scope; A4 may make ONE small, clearly commented edit in Drills.tsx to apply the launched scope -- keep it minimal, A2 owns the rest of that file); Home confirms when a goal is met and shows progress on it (s02).
3. Next step routes a concentrated weakness to 'Fix weak cells' (s07 high); leftover Custom deck must not leak into other next steps (s07).
4. F11 index set follows the profile everywhere on Home/readiness. F15 one shared counting-fluency rule for Home and the Drills picker. F27 readiness vs nextStep data source agreement.
5. Stats: W15 hide empty CVCX rows and don't open the Profile block first; time filter actually filters hand accuracy (s10); Bet or sit Stats shows Play's decisions (s06); betting/wong mistakes not labelled as basic/index (s06); count history shows a trend and more than 5 rows with mode (s04); Produce TC and quiz histories surfaced (s05); 90% target marker on bars (s02); F14 'Read summary aloud' follows the range; F23 use statsFormat.pct everywhere.
6. Custom editor edits (Auto, paint, mix, Favour missed) persist immediately, not only on Start (s07 high). (CustomDrillEditor.tsx is A4's.)
7. Home hierarchy W13: Next step Start is the single gold primary; 'weakest' line lists only categories below target.
