# Wave B — lanes, file ownership and cross-lane contracts (2026-10-17)

Spec: `docs/superpowers/specs/2026-10-16-wave-b-design.md` (binding). Evidence: `docs/superpowers/specs/2026-10-16-swarm-backlog.md`, `docs/superpowers/specs/2026-10-16-swarm-stories.json`.
Wave A is merged into `main` (7314ba2). Four lanes run in parallel git worktrees, one branch each, merged by the controller at the end. These contracts let each lane build against the others' interfaces without waiting.

## Lanes

| Lane | Branch | E2E port | Items |
|---|---|---|---|
| P — Play | `wave-b-play` | 4710 | B5, B6 (report + "Drill these hands"), B8 hot shoe, Wave A leftover: real minus in Table count-voice value |
| D — Drills | `wave-b-drills` | 4720 | B3 Index test, B7 first-run/region rules/progress line/copy, B9 BJA H17 extras, B6 miss-strip cost + history in hand drills |
| N — New drills | `wave-b-newdrills` | 4730 | B4 Bet sizing drill (replaces Bet or sit), B10 Rules differences |
| H — Home/shell | `wave-b-home` | 4740 | B1 mute in top bars, B2 ladder + Review N due, Wave A leftovers: ProfileEditor ramp "TC ≥ −99" sentinel, "Edit profile and bet ramp" opens the ramp, real minus in `peekFlag.ts` and Stats rows |

## File ownership (edit only your own; the listed exceptions are the only cross-lane edits)

- **P:** `screens/Table.tsx`, `useGame.ts`, `engine/game.ts`, new shoe-bias module, session report UI, `screens/table*.css` EXCEPT the mute seat (H), `components/PlayingCard.tsx` sizing, `HandResultStrip`, `MistakeCard` (Play's wrong-play card). B5 card sizing for `drills/CountDrillView.tsx` and `drills/PairCancelView.tsx`: a NEW css file plus at most a one-line import / className change in each view.
- **D:** `screens/Drills.tsx` (except the N and H exceptions below), quiz/flashcard/mastery/speed/with-count views, `engine/deviations.ts`, `drills/deviationQuiz.ts`, `screens/Charts.tsx` + `chartIndexes.css` (except H's Back-button removal), `components/ResultStrip.tsx`.
- **N:** NEW files for the two drills (`screens/drills/BetSizingView.tsx`, `screens/drills/RulesDiffView.tsx`, `drills/betSizing.ts`, `engine/rulesDiff.ts`, css), and deletion/retirement of `screens/drills/BetSitLeaveView.tsx` + `drills/betSitLeave.ts` usage. In `Drills.tsx`: ONLY the `DrillMode` union, the two `if (mode === …)` branches, and the picker `entry(…)` lines (replace the Bet or sit entry; add Rules differences).
- **H:** `App.tsx`, `components/MuteButton.tsx`, `stickyTopbars.css`, `screens/Home.tsx`, `screens/nextStep.ts`(+css), `drills/fluencyGate.ts`, `screens/readiness.ts`, `screens/Stats.tsx`, `screens/Settings.tsx`, `screens/ProfileEditor.tsx`, `ui/peekFlag.ts`, `e2e/layout-guard.spec.ts`. B1 seats in other lanes' screens: NEW css files only (e.g. `ui/muteSeat.css`) targeting existing class names, plus removing the "Back to Home" button JSX in Stats/Charts. H may add `'betsizing'` (and any review mode) to the `DrillMode` union in Drills.tsx.
- **Shared, additive only (append, comment, never rename):** `store/types.ts`, `store/persist.ts`, `ui/drillLaunch.ts`, `ui/profileOptions.ts`, `e2e/helpers.ts`. Opt-in toggles: one row each, next to the existing Fab 4 toggle in `ProfileEditor.tsx` (P: hot shoe, D: BJA extras) — the only edits P/D make in that file.

## Contracts

1. **Bet sizing drill (N produces; H, P consume).**
   - Drill mode key `'betsizing'` (in `DrillMode` and, for H, `NextStepKind`/`DrillLaunch`). Both N and H add the same union member; the controller resolves the identical-line conflict.
   - Stats, appended to `Stats` in `store/types.ts`: `betSizing?: { history: { date: string; rc: number; decksRemaining: number; tc: number; taken: number | 'sit'; correct: number | 'sit'; ok: boolean }[] }` (units, or `'sit'`). Optional; absent = no history. Old `betSitLeave.history` stays readable in Stats.
   - Grading: the existing `src/engine/wong.ts` (`spreadUnitsFor`, `sitOutIsCorrect`) — the same function Play uses. No second implementation.
   - H's rung 6 pass rule reads `stats.betSizing?.history` (recent window). On H's branch before merge the field is simply absent.
2. **BJA H17 extras (D produces; N, P consume through the engine).**
   - Profile field appended: `bjaExtras?: boolean` (absent = off). Read through `indexSetFor(strategyRulesFor(profile))` the way the Fab 4 option is read, so Play grading, quiz, Charts follow automatically. No caller outside the engine checks the flag directly.
   - Extras only apply under H17. New soft-hand deviation support lives in `engine/deviations.ts`.
3. **Hot shoe (P).** Profile field appended: `hotShoe?: boolean` (absent = off). Session row field appended: `hotShoe?: true`. Stats and the report exclude such rows from bankroll/luck figures. H's Stats must not break on the field (it ignores it unless P's code reads it; P owns the exclusion in shared figure helpers it touches).
4. **"Drill these hands" (P produces).** P appends to `ui/drillLaunch.ts` a function that writes a Custom deck containing exactly a list of cell ids and launches `'custom'` without Auto overwriting it. H must not change `launchSettings`'s existing branches' behaviour.
5. **Mute seat (H).** After B1 the mute control sits in the top-right of each screen's top bar; a CSS custom property `--mute-seat` (width reserved on the right of any top bar) is defined by H. P and D must not rename existing top-bar class names (`.table-topbar`, `.charts-topbar`, drill top bars, `.stats-topbar`, `.settings-topbar`) or move the mute control.
6. **Real minus (U+2212)** for every signed count/TC any lane displays; use `src/drills/signed.ts`.

## Rules for every lane

Worktree only; commit explicit paths (never `git add -A`/`.`; never commit `docs/sources/chart-view-*.png`). Never stop a process you did not start. No audible audio, no headed browsers (headless 375×812 screenshots, read the PNG). New CSS in new files, never `app.css`. TDD; mutation-check each new test (back up with `cp` to your scratch dir, break, see it fail, restore with `cp` — never `git checkout`). Gates: `npx tsc -b`, `npx vitest run`, `npm run lint` (13 warnings exactly — exporting non-components from a `.tsx` adds one), `npm run build` and grep `dist/` for a changed string, targeted `E2E_PORT=<lane port> npx playwright test <specs> --project=chromium --reporter=line`.
