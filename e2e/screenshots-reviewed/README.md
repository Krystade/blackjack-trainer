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
