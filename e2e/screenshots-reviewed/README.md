# Reviewed screenshots — Task 14 manual review

**Reviewed:** 2026-07-16, by the coordinating agent (Claude Fable 5), using direct image
inspection of every PNG (not delegated).

**Provenance:** captured by the Playwright e2e suite (`npm run e2e`, 15/15 green, run
twice with no flake) at commit `c4cc7d3`, viewport 390×844 (confirmed via PNG IHDR after
fixing a config bug where `devices['Desktop Chrome']` overrode the viewport).

**What was checked (spec §10):** dark felt theme consistency, portrait phone layout,
touch-target sizes, no clipped/overlapping elements, and content correctness per state —
top bar, face-down hole card, insurance modal, training overlay text format
("You/Correct/reason/(TC was N)"), test-mode session report (categories + itemized
misses), count-check NumPad, bet chips + spread grading in report, split hands
side-by-side with per-hand results, all three drills' full state cycles (including
chart-correct feedback: A,2 v 5 → DOUBLE `soft-13-v-5`; index label "12 v 4: hit at any
negative TC"), Settings controls, Stats category bars + full 18-row Illustrious 18 table
with em-dashes for unseen indices.

**Verdict:** PASS. Cosmetic notes (non-blocking): bet chips ~44px (slightly under the
48px target-size bar used elsewhere); "Surrender" label tight against the right edge of
the action bar; screenshot 25's import-error message sits below the fold (the e2e test
asserts the message text functionally).

**Seeds used:** fixed seeds per spec file (see `e2e/*.spec.ts`); the split scenario
hunts seeds 1–50 at runtime and logs the one used (seed 8 at review time).

## Cycle-1 review addendum (2026-07-17)
Shots 26-45 (profiles, S17 dealer-stand proof, manual countdown, quiz filter, CVCX import
happy/error, profile bet grading) captured by the cycle-1 e2e suite (22 specs, dc0b863)
and reviewed by the coordinator: all layout-distinct states inspected (26,28,30,31,34,
41,43,45 in detail; remainder are data-variants of reviewed layouts). PASS. Key visual
proof: shot 31 — dealer stands on 6+A under the S17 profile with the profile name in the
top bar.

## Cycle-2 review addendum (2026-07-20)
Shots 46-54 (bot seats, fast-forward, multi-hand, seats round-trip, solo parity) captured
by the cycle-2 e2e suite (27 specs green twice, `4ba54fc`) and reviewed by the coordinator
via direct image inspection. **PASS** — every card value was re-added by hand:

- **47 (full table settled)** — dealer 6♦2♦3♥Q♦ = 21. All three bots played chart-perfect
  against the up-6: P1 doubled soft-14 (3♣A♦) and drew Q♦; P2 stood on 20; P3 stood on
  hard-14. All three marked `L` vs 21; player 12 loses −1; bankroll 100→99. ✓
- **46 (dealt)** — hole card face-down, Split correctly *disabled* on 4,8, Surrender
  offered on the first two cards under LS. ✓
- **48 (fast-forward)** — identical fully-revealed state to 47 with pacing skipped. ✓
- **49/51 (multi-hand)** — per-hand bet steppers "Hand 1 = 2u / Hand 2 = 4u"; settled shows
  dealer 18, Hand 1 (4♠4♣A♦ = soft 19) Win +2, Hand 2 (3♣6♦J♣ = 19) Win +4,
  bankroll 100+6 = 106. ✓
- **52/53 (seats round-trip)** — editor set to 2 hands / 2 bots / "Perfect" mistakes, and
  the table then renders exactly P1+P2 with two player hands, Hand 1 highlighted. ✓
- **54 (solo parity)** — no bot rows at all; layout matches the v1 solo table. ✓

Layout: `.bot-seats-row` is `flex-wrap: wrap`, so the untested 4–5 bot configurations wrap
to a second line rather than overflowing 390px — the 3-bot capture is representative.

Non-blocking notes carried forward: bot *card rows* render fully-resolved while only the
narration text is paced (spec-defensible — pacing is presentation-only over an
already-resolved engine transcript); changing deal speed mid-narration doesn't retune the
in-flight timer.

## Cycle-3 review addendum (2026-07-21) — PASS WITH ONE BLOCKING UX DEFECT
Shots 55-58 captured by the cycle-3 audio e2e suite (35 specs green twice, no flake, `79f8824`)
and reviewed by the coordinator via direct image inspection.

- **55 (Settings → Audio)** — section renders correctly: "Audio enabled" ticked, Verbosity
  segmented Off/Results/Full with Full selected, consistent with the existing Play/Drills
  section idiom. Rate, voice picker, chimes, answer-pause and Test-audio sit below the fold
  (the e2e asserts them functionally). ✓
- **56 (eyes-free count drill running)** — card 9♦ with "tap to advance · 1/13" in manual
  mode. Correct. ✓
- **57 / 58 (ZonePad overlay)** — ⛔ **DEFECT, not a capture artifact.** Both show the
  "Eyes-free audio" toggle ticked and the scenario rendered, but **no answer affordance
  whatsoever** — no buttons and no zone hints, because `Drills.tsx` hardcodes the pad to
  `visible={false}` (CSS `opacity: 0`, still fully tappable). Shot 58 is an insurance quiz
  item at TC +5 with the "Insurance: take at TC ≥ +3" filter — correct content, but the
  Take/Decline affordance is simply gone.

**This reproduces an operator road-test report** ("there are no answer buttons but clicking
always results in a hit"): every tap in the upper-left quadrant maps to Hit, so the screen is
indistinguishable from a broken one. Invisibility is the right behaviour only for genuine
eyes-free driving, and only as an explicit opt-in — never as the default, since the zones
have to be *learnable* before they can be used blind. Task 8 built the `visible` prop for
exactly this; Task 9 hardcoding it to `false` was the wrong call.

**Verdict:** the audio harness, narration and e2e coverage PASS. The ZonePad default is a
blocking UX defect, logged as F2 for the second pass (show labeled zones by default; make
screen-blanking an explicit "dim screen" opt-in).
