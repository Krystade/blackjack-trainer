# 2026-08-16 — Operator batch: UX overhaul (working todo)

Status legend: ☐ not started · ◐ in progress · ☑ done

| # | Item | Path | Status |
|---|------|------|--------|
| 1 | Speak soft hands card-by-card ("Ace 3", not "soft 14") | bounded | ☑ |
| 2 | "Repeat last statement" button | bounded | ◐ plumbing done, button pending |
| 3 | Grey out + disable unavailable actions | bounded | ☑ |
| 4 | Major rework of incorrect-answer feedback | architectural | ☐ |
| 5 | Speaking-volume control in Settings | bounded | ☑ |
| 6 | Viewable strategy charts (both row orderings) | architectural | ☐ |
| 7 | "Check the correct table" from a mistake, anchored on the cell | architectural | ☐ |
| 8 | Full UX/UI redesign pass | architectural | ☐ DEFERRED by operator until 1-7 land |
| 9 | Is spaced repetition in the flashcards? | question | ☑ ANSWERED |

## Shipped 2026-08-17

**#1** `narrateHandPhrase()` in `audio/narrate.ts` + `AudioSettings.handStyle`
('cards' default / 'total'). SOFT non-pair hands only; hard hands keep their
total and pairs keep "a pair of eights" (see the function's own comment for
why). Settings > Audio > "Hand announcement".

**#3** `drills/legalActions.ts` — `drillLegalActions(cards, rules)`. The drills
passed `legal: ALL_ACTIONS`, so Split was live on a 10,6 in every flashcard.
Now wired into all three drill ActionBars (flashcards, deviation quiz, mixed).
The invariant under test: never withhold an action `correctPlay()` could
return, or the right answer becomes unreachable.

Caught by e2e: the keyboard path (`KEY_TO_ACTION`, keys 1-5) bypassed the
buttons entirely, so pressing 4 still submitted a Split that the disabled
button could not — recording an impossible play as a learner mistake. All
three keyboard handlers now share the same gate, and
`e2e/drills.spec.ts`'s parity spec asserts both directions (a key does what
its button does, INCLUDING nothing when disabled).

**#5** `AudioSettings.volume` (0..1, default 1) threaded through every path
`rate` already travelled: live `speechSynthesis`, clip playback
(`clips.ts`), and the chime's gain peak. Presence-checked everywhere —
`volume: 0` is a real setting and a truthiness check would silently discard
it. Settings > Audio > "Volume" (a Stepper, matching Speech rate: a discrete
+/- target is hittable in a car mount, a slider thumb is not). Also fixed a
latent bug: `volume` had to join `useAudio`'s `useMemo` deps or every bound
closure would freeze at the volume in force when the memo last ran.

**#2 (partial)** `speech.ts` now tracks the last utterance —
`getLastSpoken()` / `repeatLast()` — surfaced as `AudioApi.replay()` and
`hasSpoken()`. Deliberately the RAW SPOKEN STRING, not a re-derived prompt:
the existing eyes-free long-press rebuilds the prompt from current state, so
it can only ever repeat the prompt, never a correction or result. Chimes
pointedly do not count as utterances, and a repeat never overwrites what
"last" means. The visible button is not built yet.

Verification at time of writing: 3038 unit tests / 45 files, 106 e2e specs,
`tsc -b` clean, `oxlint` clean (2 pre-existing warnings in PlayingCard.tsx,
untouched).

## Notes for #4 (mistake feedback) — grounding already gathered

Operator constraint: it MUST work in driving mode, so the correction has to
carry over audio without reading. That makes `docs/BACKLOG.md` D2 a blocker
rather than a nicety — deviation `reason` strings are index labels like
`16 v 10: stand at TC ≥ 0`, full of `≥`, `−` (U+2212) and colons. Those speak
as mush AND can never match a pre-rendered clip, so corrections drop to
robot-voice live TTS exactly when the learner most needs to understand them.
#4 therefore needs a `narrateReason()` turning them into prose
("sixteen versus ten: stand at true count zero or higher").

Also open, surfaced while gating the keyboard: in eyes-free mode the ZonePad
has no disabled affordance, so an illegal zone tap is now silently ignored.
Consider an audible "split isn't available" cue as part of #4.

## 9 — Answer (no work needed)

Yes, and it is fully wired end to end:

- `src/drills/spacedRepetition.ts` — pure Leitner scheduler. Boxes 0..5,
  intervals `[0, 1, 3, 7, 14, 30]` days. `LEARNED_BOX = 2` is the threshold above
  which a miss counts as a real *lapse* rather than still-learning noise.
- Draw weighting: `srWeight()` feeds `weightedIndex()` in both
  `src/drills/flashcards.ts:122` and `src/drills/deviationQuiz.ts:349`.
  Unseen = 8, due-and-overdue scales with overdue days + inverse box,
  not-yet-due = 0.25 floor (so nothing starves).
- Grading: `reviewCard()` in `src/drills/gradeAnswer.ts:227,264`.
- Persistence: localStorage `bjtrainer.flashsr.v1` / `bjtrainer.quizsr.v1`.
- `isGapReview()` distinguishes genuine retention tests from massed repetition.

Everything is pure with an injected `now`, so it is deterministic and tested.

## 6 — Charts already exist in-repo (no hunting needed)

`src/engine/charts/` holds six ruleset-verified base tables
(`d1/d2/d68` x `h17/s17`), transcribed from the Wizard of Odds images still
present at `docs/sources/bj_*.gif`, with DAS + late-surrender resolved by
`transforms.ts`. `getChart(rules)` returns the *same* table that
`engine/strategy.ts` grades against, so a viewer built on it cannot drift from
the trainer.

The operator's "two versions" = row ordering only:
- **Descending** (hard 17 at top down to 5) — the Wizard/BJA house style.
- **Ascending** (hard 5 at top up to 17) — the reversed style.
Both render from one dataset; a toggle switches them.
