# Wave B — design (2026-10-16)

Status: approved by Jack 2026-10-16 ("Yes that's perfect"). Builds on Wave A (bug fixes, `scratchpad/waveA.md`), which must be merged first.
Evidence: Swarm A backlog (W-numbers, D-numbers) and Swarm B user-story findings (s01–s10), archived with this spec as `docs/superpowers/specs/2026-10-16-swarm-backlog.md` and `docs/superpowers/specs/2026-10-16-swarm-stories.json`.

## Jack's decisions (binding)

- **D1 wong line follows his spread.** Play grades "sit" whenever the spread says minimum, including round 1 of a fresh shoe at TC 0 (back-counting semantics; confirmed). Every drill that grades betting uses the same function.
- **D3 mute button moves into each screen's top bar**; the 44px strip above every screen is removed.
- **Next step:** casino-order ladder, visible on Home; "Review N due" from the SR schedule. (Mastery-by-sections was NOT chosen; keep the whole-chart sweep.)
- **Opt-ins, all default off:** Hot shoe in Play; BJA H17 extra indices; rules-difference training (H17 vs S17, and 6 vs 8 decks).

## Global constraints

- iPhone 13 mini: 375×812, notch insets, every tap target ≥ 44px, no sideways scroll, nothing under the status bar or the mute control.
- Low friction: no new required inputs; anything new is a default-off option or a derived screen.
- Strategy truth comes only from `src/engine/*` (charts in `src/engine/charts`, indices in `deviations.ts`, `indexSetFor(strategyRulesFor(profile))`). No hard-coded strategy in UI code.
- Signed counts use a real minus sign (U+2212).
- Eyes-free/voice/wheel paths keep working for anything that changes an existing drill; new drills must at least work by touch and not break when eyes-free is on.
- New CSS in new files, never appended to `app.css`. `store/types.ts` / `persist.ts`: additive optional fields only.
- Tests: TDD; every new test mutation-checked (it must fail without the change). Gates: `npx tsc -b`, `npx vitest run`, `npm run lint` (13-warning baseline, add none), `npm run build`, targeted Playwright on the lane's E2E port. Visual changes verified by a headless 375×812 screenshot that the implementer reads.

## Items

### B1 — Mute control in every top bar (D3)
Remove the reserved `--mute-h` strip. Each screen's top bar reserves a right-hand seat for the mute control, the way Charts does since #24 (`charts.css`), including sticky bars (Stats, Settings, profile editor) and drill top bars, the Play topbar grid (`tableTopbar.css`) and the session report. Remove the "Back to Home" buttons on tab-bar screens (Stats, Charts when reached from the tab bar); keep in-flow Back where there is no tab bar (running drills, profile editor). The Charts top bar must stop wrapping its back label and title onto two lines (s01, s09). Field test keeps its own layout rule.
Accept: on every screen at 375×812, scrolled and unscrolled, the mute control overlaps no other control or heading; the reclaimed 44px is visible content; e2e layout-guard extended to all screens.

### B2 — Next step: casino-order ladder + Review N due
Ladder (each rung has a measurable pass rule drawn from existing stats, judged on recent windows from Wave A): 1 Basic strategy → 2 Fix weak cells / Mastery sweep → 3 Running count at table pace (count drill: paced runs ≥ 1 deck at the fluency rule) → 4 Deck estimation + true count → 5 Deviations (profile's index set) → 6 Bet ramp (bet-sizing drill, B4) → 7 Play a shoe.
Home shows the ladder as 7 compact rows (done / current with progress / locked-but-tappable), the current rung's Start as the single primary button, and launches the right drill and scope. "Review N due": when the SR schedule has ≥ a threshold of due cells/indexes, the card offers a review session first (Start opens a due-weighted drill); after the ladder is complete the card rotates to the stalest skill instead of sitting on "Play a shoe". Drills picker gating (`fluencyGate`) reads the same rung results.
Accept: unit tests for every rung transition and the due insertion; e2e: fresh → rung 1, seeded states land on each rung with the right Start target.

### B3 — Index Test mode (W1)
Deviation quiz option "Index test": show hand + up-card (no TC); the answer is the index number (keypad with ±, 0 allowed; insurance item included), graded against the profile's index set. Feeds the per-index SR. Eyes-free: the prompt is spoken, the answer can be spoken via the existing number parser. Result strip shows the answered hand, the right index and the play it triggers.
Accept: unit tests for grading every index in both H17/S17 sets; e2e for touch answer right/wrong.

### B4 — Bet sizing drill replaces Bet or sit (W8, D1)
Input: running count + a discard-tray picture (same tray component as Play) for the profile's decks; answer: the rung of the profile's bet spread (including Sit when the spread says sit). Graded by the same function Play uses for bet grading and sit-out (D1). Result strip shows RC ÷ decks → TC → rung. The old two-answer Bet or sit view is replaced; its stats history remains readable.
Accept: unit tests that drill and Play grade identical (RC, depth, spread) inputs identically; e2e for a right and a wrong answer.

### B5 — Play at a glance (W4, W5, W6)
Bigger cards on the felt (clamp-based sizing; ≥ 70px wide at 375 for 1–2 hands, shrinking for more hands without overflow), bigger action-bar labels, felt content centred. A result banner per hand with result and both totals ("Lose −1 · You 17 · Dealer 19"), split hands labelled in play order. Wrong-play card: one header line (result + classification), Continue as the gold primary in the thumb zone, "Show on chart" as a secondary link. The emoji fast-forward button becomes a styled control. Also apply the bigger-card sizing to the Count drill and Pair cancellation flashed cards.
Accept: e2e measurements (card width, banner font size, Continue y-position > 650); screenshots in all 4 themes.

### B6 — Report and strips drive practice (W7, W12)
Session report: plays and count checks in separate sections; mistakes sorted by cost (units); "RC off by N" for count checks; headline "−x u lost to mistakes per 100 hands" replaces any luck-driven units/hour on the report and Stats; a "Drill these hands" button opens Custom with exactly the report's missed cells as Focus. Miss strips in hand drills show the mistake's cost and recent history ("−0.61 u · 3rd miss on 8,8 v 4, 2 of last 5").
Accept: unit tests for per-100 and sorting; e2e for Drill these hands → Custom focus set.

### B7 — First-run learning step (s01)
On first Flashcards launch with no hand history (and from the Next step rung 1), show a one-screen "How to read the chart" with the chart and a Start quiz button (skippable, shown once). Wrong strips show a one-line rule for the cell's region instead of the duplicated "Basic X vs dealer N". Flashcards shows a slim progress line for the current rung goal (per-category answers/accuracy on the recent window) and a confirmation when the goal is met. Beginner jargon gets plain words (e.g. "Next review: now" → "You'll see this again soon").
Accept: e2e first-run path; unit tests for region rules covering every chart cell.

### B8 — Hot shoe (opt-in, Play)
Profile/Play option "Hot shoe": the shoe is mildly biased so positive true counts (+2 to +5) occur often enough to practise index and bet decisions. The report and Stats label such sessions "Hot shoe" and exclude them from bankroll/luck figures. Off by default.
Accept: simulation test that hot-shoe TC distribution differs as intended and normal shoe is unchanged; report label e2e.

### B9 — BJA H17 extra indices (opt-in)
Option to add the BJA H17 extras from `docs/sources/BJA_H17.pdf` (verify each value from the PDF before encoding): 16vA stand +3 (no surrender), 15vA +5, 8v6 +2, A8v4 +3, A8v5 +1, A8v6 0−, A6v2 +1, TTv4 +6 — requiring a soft-deviation kind in the engine. Appear in Charts > Indexes (marked as extras), the quiz, Index test, With count, and Play grading only when the option is on.
Accept: engine unit tests per index (threshold and direction), H17-only gating.

### B10 — Rules-difference training (opt-in drill)
A drill "Rules differences": choose a comparison (H17 ↔ S17, 6 ↔ 8 decks, or profile ↔ another ruleset). The engine diffs the two basic charts and the two index sets; the drill asks only the cells/indices that change, telling the user which rules are in force each time ("Under S17: 11 v A?"), and the strip explains the difference ("H17 doubles, S17 hits"). If two rulesets share a chart (6 vs 8 decks use the same `d68` chart), say so plainly and train what does change: true-count conversion and deck estimation with the larger shoe (8-deck tray), and any index differences the engine reports.
Accept: unit tests for the diff (known H17/S17 differences for 6D: 11vA, A7v2, A8v6, 15vA/17vA/88vA surrender lines, plus index changes); e2e for one question each way.

## Out of scope for Wave B (queued as Wave C, car)
W9 wheel-graded Speed/Bet sizing, W10 one-tap Drive, W11 pause count run from the wheel, W16 misheard-answer escalation, D2 wheel-default field check.
