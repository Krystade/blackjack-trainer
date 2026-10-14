# 53-item change list — design

Date: 2026-10-13. Source: Jack's list of 2026-10-12, quoted per item below. Every "Now" line was checked against the code or a headless WebKit 375×812 render, not assumed.

## Global constraints

- Phone target: iPhone 13 mini, 375×812, installed as a home-screen app (standalone, `viewport-fit=cover`). Tap targets ≥ 44px, inputs ≥ 16px font, no sideways page scroll.
- TypeScript strict with `erasableSyntaxOnly`: no enums, no constructor parameter properties.
- Pure logic (`src/engine`, `src/drills`, `src/store`) never calls `Math.random` or `Date.now`; seeds and clocks are passed in.
- New localStorage keys go through `src/store/persist.ts` and are added to its `EXTRA_KEYS`.
- Colours come from `themes.css` tokens only; every theme (Midnight Felt, Bone & Ink, AMOLED Night, Slate & Copper) must read.
- Unit tests are vitest, node environment, `*.test.ts`. Browser behaviour is Playwright `--project=chromium`, headless, `?e2e=1`.
- Gate per batch: `npx tsc -b`, `npx vitest run`, `npm run lint` (12 warnings baseline), `npm run build`. Then push to `main` (Pages deploy), then the full Playwright suite.
- Visual changes are verified by rendering headless at 375×812 and looking at the PNG.
- Stage explicit paths only.

## Shared building blocks

These are used by several items, so they are defined once.

- **B1 `HandResultStrip`** (new component). Shows the result of the previous answer while the next hand is already on screen. Correct: "Correct! A,2 v 7 — Hit". Wrong: the exact cards ("9,7 v 10"), what you played, the right play, the reason, "Show on chart", and in mastery the progress lost ("Run reset at 120/150"). The strip holds its own snapshot of the answered hand, so nothing in it can point at the new hand. Items: 8, 10, 14, 17, 21, 22.
- **B2 `CellSelection`** (new pure module + chart-grid component). A set of chart cells with a tier each (Off / Rare / Regular / Focus), painted by drag, plus an "Auto" fill from per-cell accuracy. It follows the published odds designer (claude.ai/artifact/AAvMnPW2eqCwzyHLuS9sXg v2). Items: 9, 13, 23, 29.
- **B3 Per-cell stats.** Stats has no per-cell accuracy today. Add `cellStats: Record<cellId, {right, wrong, lastAt}>` written by every hand drill and Play. Items: 9 (weak spots), 28, 29.
- **B4 Fit-to-width chart grid.** Ten dealer columns plus labels fit 343px with no sideways scroll, as in the odds designer. Items: 9, 23, 24.

## Items

Each item gives Jack's request, what the app does now, and what will change.

### Batch A — wrong or misleading behaviour

**1. Split order.** *Request:* "split should play right to left hands I think? Make sure that's how it's done in the casinos."
- Now: `performSplit` inserts the new hand at index+1 and play runs in index order. Hands render left to right, so the app plays left to right.
- Change: play the hand on the dealer's left (the player's right) first, as casinos do. Render order is unchanged. The active-hand index starts at the rightmost hand and moves left. Resplits insert next to the hand being split.
- Applies to bots as well, and to narration ("hand 2" means the second hand played).

**4, 5. Bottom bar moves / doesn't reach the bottom.** *Request:* "Scrolling down the session report brings the bottom bar up. If the screen is taller then the bottom bar doesn't go all the way down."
- Now: `.tab-bar` is `position: fixed; bottom: 0`, and the document body scrolls.
  - In an installed iOS app, rubber-band overscroll drags fixed elements.
  - The layout viewport can also differ from the visual one, which leaves a gap under the bar.
  - Neither reproduces in Chromium or WebKit headless.
- Phone screenshots (2026-10-13), installed app:
  - Play's action bar and Deal sit about 90px above the bottom of the screen, with an empty band below. Full-screen roots use `min-height: 100svh`, and in standalone mode that is evidently shorter than the screen.
  - When Stats, Charts or the quiz scroll, content passes under the status bar: the clock prints over "Back to Home". The mute disc covers chart cells.
  - Mastery after a miss (#7) and the session report (#4) show the same fault. The sticky Next bar and the fixed tab bar float about 250px up the screen, with page content visible beneath them.
- So #4, #5 and #7 are one bug: in the installed app, iOS positions `fixed` and `sticky` bottoms against a viewport shorter than the screen.
- Change: stop relying on viewport units for the bottom edge.
  - The app shell becomes a fixed-height flex column covering the screen (`position: fixed; inset: 0`).
  - One inner element scrolls.
  - The tab bar and action bars are flex children at the end of the column, not `fixed` or `sticky`.
  - `html, body { overscroll-behavior: none }`.
  - Full-screen roots fill the real screen height in standalone (`@media (display-mode: standalone)` → `min-height: 100lvh`).
  - An opaque status-bar strip of height `--safe-top`, fixed above all scrolling content.
- Verify on the phone. Headless reports every safe-area inset as 0, so it cannot reproduce this.

**8, 14, 17. Feedback after the hand changes.** *Requests:*
- #8: "The next question should only show up after that is passed."
- #14: "I take it back. I want to keep that order however I want it to say correct! A2 v 7 hit."
- #17: "show what progress was lost on incorrect and the actual card pair."
- Now:
  - Mastery advances the run before rendering feedback, so the feedback and the chart point at the new cell.
  - Flashcards, the deviation quiz and Mixed wait on a Next tap.
- Change (decided 2026-10-13, all hand drills): an answer immediately shows the next hand, and B1 shows the last result.
  - A correct strip fades after 2.5s.
  - A wrong strip stays until the next answer.
  - "Show on chart" opens the chart for the answered hand, not the one on screen.
  - The Next button goes away in visual mode. Eyes-free keeps its timed auto-advance.

**10. Pairs error opened the hard chart.** *Request:* "A pairs error splitting 4s against 4 took me to the hard table instead of the pairs once."
- Now: mastery's chart overlay uses the current cell after the run has already advanced and reshuffled. Reproduced. Flashcards were checked headless and are correct.
- Change: fixed by B1's snapshot. A regression test checks that 4,4 v 4 opens on PAIRS.

**11, 12. Surrender on pairs and soft hands.** *Request:* "For pairs and soft hands I don't think there's ever a surrender so we can have it greyed out. Double check the deviations though." Then: "8s v A is a surrender?"
- Now: `drillLegalActions` offers surrender on every two-card hand. A,2 v 2 renders Surrender enabled.
- The only pair-surrender cells in the charts:
  - 7,7 v 10 (1D H17 and S17)
  - 7,7 v A (1D H17)
  - 8,8 v A (2D H17 and 6/8D H17)
- No soft hand surrenders in any chart, and no deviation index surrenders a pair or soft hand. The Fab 4 are all hard 14, 15 and 16.
- Change: in drills, surrender is disabled on soft hands, and on pairs except those chart cells for the active rules.
  - Play keeps the casino's real option. Surrender is legal at the table, and choosing it on A,2 is a graded mistake, not a disabled button.

**18. Every composition of a total.** *Request:* "a hand total can come from any possible combos ... 8 7, 9 6, 9 7, 9 8."
- Now:
  - Mastery uses one fixed composition per hard total (10+5, 10+6, 10+7).
  - Flashcards draw uniformly with J, Q and K counted separately, so 16 is 9+7 only one time in five.
- Change: one shared `pickComposition(total, rng)` that treats all ten-value cards as one rank. It picks uniformly among the distinct rank pairs for that total, and the suit and face are cosmetic. For hard 16 that is 10+6 or 9+7, each half the time. Used by mastery, flashcards, the quiz, Mixed and the new modes.
  - Pairs and soft hands are unchanged.
  - Hard totals of 5–8 already have few compositions.

**26. 16 v 9 at +4 marked stand, with no surrender signal.** *Request:* "there's no setting to signal if surrender isn't possible."
- Now: `QUIZ_CTX` asks with surrender off, except for Fab 4 items. The table-mask note explains this only after the answer.
- Change: every quiz and drill prompt shows a rules chip ("No surrender" or "Surrender OK", plus "No double" when the hand can't double, as in #27). It sits next to the TC, before the answer.

**30. Ignore long-idle times.** *Request:* "If I exceed a certain time ... I don't think it should be tracked."
- Decided: timing only. Any answer slower than 30s is still graded and still updates spaced repetition. `elapsedMs` is omitted from the event, so median and latency stats skip it.
- The count drill's tap intervals use the same 30s cap (#20).
- Shot clock timeouts are unchanged, because they are not idle.

**36, 37, 38. Count check, insurance and depth in Play.** *Requests:*
- #36: "Do it before a hand rather than after so when I hit deal it shows the check and then after the check the deal happens."
- #37: "Insurance also, I'll need to see current hand."
- #38: "How am I supposed to calculate true count without knowing how much deck is left."
- Now:
  - The count check opens a centred modal the moment the round settles, covering the cards.
  - Insurance uses the same kind of modal.
  - The discard tray shows fill only.
- Change:
  - The check is posed when Deal is pressed. The settled hand stays on screen, and the next deal happens after the answer.
  - The check and insurance both become a bottom sheet in the action-bar area, leaving the table visible. This follows the shared-device-overlay lesson: never cover the board.
  - The discard tray gets tick marks every whole deck, labelled with decks dealt, so depth can be read by eye like a real tray.

**51/48–50. Downswing and bet/sit/leave.** Decided 2026-10-13:
- Remove the Downswing drill.
- Add a "Losing shoe" option to Play. It uses the existing `downswingShoe` rig: a short run that alternates negative-count pat losses and positive-count draw-outs. It is graded by the normal Play bet ramp, so per-bet feedback and decks remaining come from #36–41.
- Bet/sit/leave drops the "leave" question.

**54. True count drill overhaul.** (Added 2026-10-14 from Jack's screenshot.) *Request:* "True count needs an overhaul too with the correctness and precision required as well as the ux for having this screen pop up every time breaks the flow."
- Now:
  - Grading uses `tcConversionAccepted`, which accepts floor, round **or** truncate.
  - The result line prints only the profile's convention (floor).
  - So the drill shows "Correct!" directly above "You entered −1; the true count was −2". With RC −6 and 5.5 decks the quotient is −1.09: truncate gives −1, floor gives −2. That contradicts itself and never trains any one rule.
  - Running counts are uniform from −6 to +20, so negative counts are under-trained.
  - Every answer opens a full result screen with a Next tap.
- Change:
  - Grade against the profile's `tcRounding` only.
  - Feedback shows the exact quotient and the rule: "−6 ÷ 5.5 = −1.09 → floor −2".
  - A wrong answer that matches another rounding convention says so ("−1 is truncate; your profile floors"), so the convention mistake is visible.
  - Running counts become symmetric, from −15 to +15.
  - Answers fast-advance with the B1 strip, and there is no result screen.
  - The Produce-TC drill gets the same treatment.
  - Play's by-eye band (`tcWithinEye`) is unchanged, because the table's depth is an estimate.

### Batch B — feedback and speed

**20. Count drill stats in manual mode.** *Request:* "Showing 700ms when it was on manual tapping mode ... along with my average time between cards."
- Now: manual runs record `intervalMs` from the auto-speed setting, and tap gaps are never measured.
- Change: manual runs record `mode: 'manual'` and `meanTapMs`, the mean gap between taps with gaps over 30s excluded (#30). Stats shows "52 cards · manual · 840ms avg".

**21. Pair cancellation, no second tap.** The answer shows the next pair immediately, with a small strip ("−1 ✓" or "✗ was 0 — these cancel"). Keyboard Enter is no longer needed.

**22. Misclick.** A "Wrong tap" link in the B1 strip, shown only on a wrong answer, before the next answer is given. Tapping it:
- removes the graded event from Stats, the SR deck and cellStats,
- restores mastery progress to its value before the answer,
- marks the event as a misclick, so a counter in Stats keeps the habit visible.
- It is not offered in Play test mode.

**25. Cost of mistakes.** The header shows "N mistakes · X units". Every row shows a count and a total ("16 v 10: Stand for Hit — ×7, 0.31 u"), with all rows behind "Show all". Play basic errors are priced too, using the same `priceMistake` on the dealt hand.

**44. Whole-deck count runs always end at 0.** Runs draw from a shoe one deck larger than the run, so the end count is that of a random slice. The run-length labels say "cards", not "decks".

**45. Checkpoint screen squashed.** Confirmed: the checkpoint and distraction NumPads shrink-wrap to about 36px keys. They get the same full-width layout as the count-answer NumPad. Audit every `NumPad` container for the same problem.

**46. Adjusted checkpoints.** Each checkpoint is graded on the stretch since your previous answer: expected = your last answer + the true change since then. The result says "graded from your +3 at card 12 (adjusted)". The final verdict stays absolute, and both are shown.

### Batch C — navigation and settings

**2. Back from the chart.** The study overlay's Back button is a floating pill pinned bottom-centre above the safe area, always visible while scrolling. It says where it goes ("Back to hand").

**3. Count prompts.** A profile setting "Count checks ask" with options Running / True / Both alternating (today's behaviour) / Both every time. Count-check frequency 0 still means off.

**24. Chart scrolling.** Charts use B4, so there is no sideways scroll. The mute disc no longer overlaps the chart: it gets reserved space in the topbar on the Charts screen.

**32. Stats tab.** The tab bar becomes Home, Play, Drills, Charts, Stats. Settings moves to a gear in each screen's topbar and stays reachable from Home.

**33. Tab-specific settings.** A gear icon in the topbar of Play, Drills and Charts opens a sheet with that tab's settings. These are the same settings objects, with no duplicates and no new storage.
- Play: feedback mode, deal speed, deviations (#34), count checks (#3), penetration (#39), losing shoe.
- Drills: shot clock.
- Charts: rules shown.

**35. Settings order.** The Settings screen keeps only global settings.
- "General" comes first and opens by default: theme, audio enabled, volume, speech rate.
- Then, all closed: In the car, Audio detail, Offline, Teach it your words, Tests, Diagnostic log.

**40. Peek.** Peek moves from the topbar to a thumb-reach button bottom-left above the action bar. It has a fixed width, so revealing doesn't reflow anything. Hold to show, release to hide. Every peek is still counted.

**41. Decks remaining to two decimals.** The peek reveal shows "RC +5 · TC +1.4 · 3.62 decks left". It is counted as a peek.

### Batch D — selection, charts and drill modes

**6. Distractions in mastery.** Removed from mastery, and the setting is deleted.

**7. Mastery layout.** Jack's screenshot shows the Next bar floating mid-screen with the mistake card running beneath it. This is the same bug as #4/#5 and gets the same app-shell fix. B1 also shortens the feedback, so it fits above the bar.

**9. Custom drill.** "Custom" drill = B2 painted on a B4 chart grid, as in the odds designer.
- Tiers: Off / Rare / Regular / Focus.
- Session-mix sliders default to 60/30/10.
- "Favour missed cells" is optional.
- Auto fills from B3: Focus below 78%, Regular below 92%.
- Any hand drill can use the selection as its deck.

**13. Multi-select scopes.** The Hard / Soft / Pairs control becomes a multi-select ("All" = all three) in flashcards, mastery, Mixed and the new modes.

**23. Index charts.** The Charts screen gets an "Indexes" section: a list of the active rule set's indexes (I18 plus Fab 4 when enabled), each shown as hand, dealer, index and play. There is also an index heat-grid on the chart: cells with a deviation get a corner marker, and tapping one shows its index. Flashcards and mastery can select indexes as a scope (via B2).

**27. Double fallbacks.** Drills sometimes deal a 3-card version of a double cell (e.g. A,2,2 v 5, soft 15). Double isn't legal there, so the answer must be the fallback (Dh → hit, Ds → stand). The same applies to surrender with Rh / Rs / Rp. There is a "Fallbacks" scope toggle; about 15% when on.

**31. Markers.** Long-press a card in mastery or flashcards to set a coloured dot (4 colours, or none). Markers persist per cell, show in a corner, and can be used as a selection in B2.

### Batch E — new modes and options

**15, 19. Yes/no speed modes.** A "Speed" drill with one question per mode and two big buttons, timed, with no Next:
- "Surrender?"
- "Deviation here?" (TC shown; yes if an index applies at this TC)
- "Double?"
- "Split?"
- It uses B1 for the result strip and B2 for scope.

**28. Next steps.** The Home card "Next step" picks one recommendation from B3 and the SR state, in this order:
1. Learn basic strategy: flashcards until every category is ≥ 90%.
2. Fix weak cells: Custom with Auto.
3. Mastery sweep.
4. Deviations: quiz.
5. Counting: count drill.
6. Play.
Each step shows why it was picked.

**29. Mastery spaced repetition.** The mastery order is no longer a uniform shuffle. Each cell is placed by a seeded weighted shuffle, weighted by the flashcard SR weight, so overdue and missed cells come early. Every cell is still asked exactly once per sweep.

**34. Play deviations toggle.** A profile option "Grade with deviations": On (correctPlay) or Off (basicPlay). Insurance follows it too.

**39. Penetration.** The penetration setting becomes "cards left behind the cut", in decks (0.5–3, step 0.25), with a "Vary ±0.5 decks" option. Existing percentages are migrated.

**47. Full tables in the count drill.** A "Table" mode deals 1–6 player hands of 2–3 cards each, plus a dealer hand of 2–6 cards, laid out like Play. The run length is in rounds.

**52. Flashcards cleanup.**
- "Show common hands more often" is removed.
- "Follow with a look-alike" becomes a forced follow: with probability 0.5, the next card is drawn only from the previous cell's confusable set.

**53. Play + deviation flashcards.** A "With count" option on flashcards shows a TC and asks the play at that count, using correctPlay. The B1 strip says whether an index applied.

### Answers only (no code)

- **16.** SR is used in flashcards, the quiz and Mixed. #29 adds it to mastery.
- **42.** Bankroll does not carry over today. It will: the Play bankroll persists per profile. "Reset bankroll" is in the Play settings sheet.
- **43.** Counting tips (answered in chat).

## Out of scope / deferred

- The losing shoe is a Play option only; there is no separate drill.
- Leave thresholds are deleted, not hidden.
