# 2026-08-16 — Operator batch: UX overhaul (working todo)

Status legend: ☐ not started · ◐ in progress · ☑ done

| # | Item | Path | Status |
|---|------|------|--------|
| 1 | Speak soft hands card-by-card ("Ace 3", not "soft 14") | bounded | ☑ |
| 2 | "Repeat last statement" button | bounded | ☑ |
| 3 | Grey out + disable unavailable actions | bounded | ☑ |
| 4 | Major rework of incorrect-answer feedback | architectural | ☑ |
| 5 | Speaking-volume control in Settings | bounded | ☑ |
| 6 | Viewable strategy charts (both row orderings) | architectural | ☑ (descending — operator's pick) |
| 7 | "Check the correct table" from a mistake, anchored on the cell | architectural | ☑ |
| 8 | Full UX/UI redesign pass | architectural | ☑ C1-C9 shipped 2026-08-17/18 |
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


## Shipped 2026-08-17 (second pass) — items 2, 4, 6, 7

**#4** `ui/components/MistakeCard.tsx`, shared by the table overlay and all
three drill views. Names the KIND of error from `GradedEvent.classification`
(the engine already computed it; the UI was discarding it) and draws the
correct play as a ringed chart CELL in chart notation. `narrateReason()`
(audio/narrate.ts) rewrites index labels into speech, closing the wording
half of BACKLOG D2. `eyesFree` collapses the panel to a glanceable verdict:
no forced pause, no forced re-answer — both wrong at speed.

**#7** `ui/components/StudyChartOverlay.tsx`. An OVERLAY, not a navigation:
`App`'s router carries no payload and remounts screens, so routing to Charts
would discard the card under correction and return the learner to an
unrelated hand — the exact opposite of anchoring. Back closes it onto the
same card. `OverlayInfo` now snapshots `cards`/`dealerUp` at grade time,
because by the time the table's modal is on screen the engine has already
applied the action and the hand may have drawn, busted, or passed `active`
to the next split hand.

**#2** A `Repeat` control in every drill topbar and on the table, shown only
when audio is on, calling `AudioApi.replay()`.

**#6** Default row order still DESCENDING pending the operator's pick;
screenshots in docs/sources/chart-view-{descending,ascending}.png.

New spec `e2e/correction-chart.spec.ts` (4 tests). Two of its own bugs were
worth keeping notes on:
- it first asserted the replayed line equalled the last LOG entry, which is
  often `chime:good`. The failure was the feature behaving correctly —
  chimes are deliberately not utterances — so the assertion now reaches for
  the last spoken line;
- it captured the hand before answering, but the helper advances past cards
  answered correctly, so the hand under correction is not the one first
  dealt.

Verified: 3099 unit tests / 46 files, 122 e2e specs, tsc -b clean, oxlint
clean (3 pre-existing fast-refresh warnings).

## Remaining

- **#8** full UX/UI redesign — deferred by the operator until 1-7 land. They
  are now all landed.
- Car/eyes-free follow-ups raised 2026-08-17: Media Session API (steering-
  wheel controls + head-unit metadata, only reachable via the CLIPS path,
  since speechSynthesis is not media to a phone OS) and a PWA manifest
  (none exists; installed PWAs get better background audio on Android).
- Eyes-free ZonePad still silently ignores an illegal zone tap — an audible
  "split isn't available" cue is the open half.

---

# Phase plan agreed 2026-08-17 (operator)

Themes chosen: **Midnight Felt (default)**, Bone & Ink, AMOLED Night,
Slate & Copper. The other eight from the gallery are dropped.

Order is fixed by the operator: fix bugs -> validate -> publish -> deep bug
hunt -> validate -> publish -> redesign. No redesign work starts before the
hunt is clean.

## Phase A — known open bugs

Enumerated 2026-08-17: `grep TODO|FIXME|XXX|HACK|BUG:` over src/ and e2e/
returns NOTHING, and BACKLOG's only tracked defect (T0-BUG1, dim-screen
toggle unreachable) was fixed 2026-07-27. So the real list is what this
session surfaced:

- **A1 · Three input paths, three different behaviours.** CORRECTED after
  investigation 2026-08-17 -- the original description ("silently swallows")
  was wrong, and the truth is worse. `handleZoneAnswer` never received the
  gate that item #3 added to the keyboard handler, so on an illegal Split:
    * eyes-on button click -> `disabled`, impossible (correct);
    * keyboard 1-5 -> gated, silently ignored (no feedback);
    * eyes-free ZonePad tap -> UNGATED, grades the impossible play as a real
      mistake and writes it to Stats AND the spaced-repetition deck.
  So the one path with no disabled affordance is the only one that still
  penalises the learner for a play that could not exist -- and it is the
  driving path. Fix: gate the zone tap for consistency, and make the
  unavailable case AUDIBLE rather than silent, since eyes-free has no other
  channel.
- **A2 · `hasSpoken()` is not reactive.** `AudioApi.hasSpoken()` reads module
  state during render, so a Repeat button conditioned on it would not
  re-render when it changes. Currently unused (the button renders on
  `audio.enabled` alone), so it is a latent trap rather than a live bug —
  either make it reactive or delete it.
- **A3 · Flashcard/quiz `reason` is not a reason.** `gradeAnswer.ts:136,161`
  sets `reason` to `card.cellId` / `item.label`, so the correction panel and
  the spoken correction both say "soft-20-v-A" where prose belongs. The
  MistakeCard's classification note currently carries the whole explanatory
  load. Not a crash, but it is the weakest part of the #4 work.

## Phase B — deep bug hunt

Parallel read-only sweeps over disjoint areas (engine/grading, audio/clips,
store/persistence+migration, UI state/lifecycles), each reporting findings
with a concrete failure scenario. Fix what is real, ignore what is stylistic.

## Phase C — redesign, sequenced

C1  Design tokens: one variable set replacing 311 literals / 55 colours.
    No visual change intended; pure refactor, screenshots before/after.
C2  Theme system: the 4 chosen token sets + persisted selection + a Settings
    picker. Midnight Felt default.
C3  Primitives: button / card / panel / row / section / topbar.
C4  Navigation: persistent bottom tab bar; Home becomes a dashboard;
    Charts + Stats relocate. THIS is the step that rewrites what the e2e
    specs pin -- specs get updated alongside, never deleted to go green.
C5  Stats split into tabs (operator's pick).
C6  Table screen: reclaim the dead felt, promote the discard tray.
C7  Settings: grouped sections, help text de-emphasised, stale migration
    note removed.
C8  Drills picker: grouped by skill rather than 10 identical buttons.
C9  Full-app visual QA pass across all 4 themes at 320/390/tablet.

## C1 groundwork — colour census of app.css (measured 2026-08-17)

311 hex literals, **55 distinct**, **0 custom properties**. The top seven
values account for 226 of the 311 uses (73%), so a small token set does most
of the work:

| uses | value | token |
|---|---|---|
| 50 | `#2c5c41` | `--line` |
| 47 | `#eaf3ec` | `--ink` |
| 39 | `#d8b969` | `--accent` |
| 26 | `#143b26` | `--surface` |
| 23 | `#b7d3c2` | `--ink-dim` |
| 19 | `#1b4c31` | `--raised` |
| 14 | `#0a1c14` | `--bg-sunken` |
|  5 | `#0d2318` | `--bg` |
|  5 | `#6fcf97` | `--good` |
|  5 | `#eb5757` | `--bad` |

**The finding that justifies the whole phase:** among those 55 colours there
are **89 pairs closer than 22 in RGB distance** — i.e. perceptually the same
colour. The worst are `#163d29` vs `#17402a` (d=3.3), `#0f2a1c` vs `#102d1e`
(d=3.7) and `#142e20` vs `#16311f` (d=3.7). Nobody chose those as different
colours; they are drift from adding one screen at a time, each re-eyeballing
a green. 27 values are used exactly once.

So C1 is not a cosmetic pass: the palette currently has no single source of
truth, which is precisely why the app cannot be re-themed at all, and why the
four chosen themes need this step first.

## Phase B — deep bug hunt, RESULTS (2026-08-17)

Four read-only sweeps over a suite that was 100% green. Fixed and published in
`a1a59eb`; the deploy needed a re-run after a transient GitHub Pages 503.

**Two crashes, both reachable in ordinary play:**
- `correctPlay` threw on A,A when splitting was unavailable (SOFT tables start
  at 13; A,A is soft 12). `Game.act` calls it *before* applying the action, so
  it blanked the app and lost the session.
- Switching flashcard category without answering left the keydown listener on
  the previous card: the next keypress graded the abandoned hand, accepted an
  impossible Split, and wrote the miss to Stats + the SR deck under the wrong
  cellId.

**Data-loss paths (store):** uncapped histories -> 5.6MB/year -> quota ->
unguarded `setItem` throwing into click handlers; a `null` history blanking
the app with Reset Stats stranded on the crashing screen; export/import
silently omitting profiles and both SR decks.

**Audio:** bare rank letters spoken ("cue", and "dealer A." read as the
article); orphaned wake-lock sentinels; `stopClips` with zero callers; five
call sites still missing volume.

**UI:** chart overlay advancing underneath itself; wrong chart cell for a
missed split; every touch peek counted twice.

### Deliberately NOT changed — needs the operator's source

**Negative Illustrious-18 indices may be off by one.** `13v2`, `13v3`,
`12v5`, `12v6` use the raw index as the `hit at TC <=` threshold, while
`12v4` is converted (index 0 -> `<= -1`). Canonical I18 states these as
"stand at TC >= index", which converts to `index - 1`. If canonical is right,
the trainer demands `hit` on 13 v 2 at exactly TC -1 where the book says
stand, and grades a correct stand as a missed deviation.

The code matches this repo's own spec verbatim
(`plans/2026-07-13-blackjack-trainer.md:302-303`), so if it is wrong it is
wrong at the spec level. The only in-repo primary source is
`docs/sources/BJA_H17.pdf`, which is scanned images. **Left alone on purpose:**
silently "fixing" index thresholds against the operator's own written spec,
on a guess, is exactly how a trainer starts teaching the wrong thing. Needs
the operator to check their source.

### Also open (lower value, not yet fixed)
- `handStyle: 'cards'` (the default) has NO clip coverage: 312 of 2197
  flashcard prompts fall back to live TTS, exactly the soft non-pair set, and
  the fallback is whole-utterance so the covered "Dealer shows nine." half is
  lost too. A real tradeoff — better pedagogy, robot voice — and the operator
  should decide, since new clips cannot be generated here.
- A mid-chain clip failure replays the whole utterance in live TTS.
- `applyEvents` deep-clones the entire stats blob per graded answer (~27ms on
  a year-old blob).
- No error boundary anywhere; a render throw still blanks the app.
- Keyboard drilling goes dead after focusing a checkbox or the index select.
- No cross-tab coordination; last writer wins.


---

# Status as of 2026-08-18 — supersedes the two "open" lists above

Everything in items 1-9 and Phases A/B/C has shipped and deployed. The
sections above are kept as the record of how it got here; where they conflict
with this section, this section wins.

## Resolved since those lists were written

- **Negative I18 indices** (was "deliberately NOT changed — needs the
  operator's source"). The operator asked for multi-source verification. The
  convention is "stand at TC >= index, hit below", so a stored `lte` threshold
  must be `index - 1`. Four were wrong and are corrected: 13v2 -1 -> -2,
  13v3 -2 -> -3, 12v5 -2 -> -3, 12v6 S17 -1 -> -2. `550b632`.
- **`handStyle: 'cards'` clip coverage** (was "new clips cannot be generated
  here" — that was wrong; `scripts/generate-audio-clips.py` existed and all
  three voices are in the public Kokoro model). 32 phrases x 3 voices
  generated; `public/clips/` now holds 887 files. `550b632`.
- **Eyes-free ZonePad silently ignoring an illegal tap.** `drills/answerGate.ts`
  returns a spoken refusal ("Split isn't available on this hand.") because the
  eyes-free pad has no visual disabled state.
- **Deck-aware indices.** `indexSetFor(rules)` is the single selection point
  for strategy, grading, the deviation quiz and both index tables. Insurance
  is the one genuinely per-deck index (1D 1.4 / 2D 2.4 / 6D 3.0 -> only single
  deck moves on an integer count, to TC >= 2). The other 17 are pinned
  identical across deck counts by test, pending a sourced per-deck table
  (Wong, *Professional Blackjack*, Table A4). `1dd94bc`.
- **iPhone 13 mini sizing.** All nine full-height screens use `100svh` (with
  `dvh`/`vh` fallbacks); `dvh` was cutting off because it tracks the
  toolbar-collapsed viewport. Pair-cancel Next is the full bottom bar; Stats
  has an all-time / last-N-days / since-date filter. `1dd94bc`.
- **Drill prompt gutters.** `.settings-note-row` had no CSS rule at all in 20
  usages; bare inside `.drill-screen` the text ran edge to edge. `e2e/gutters.spec.ts`
  now walks 9 drills + 5 tabs at 375px asserting no text ink comes within 8px
  of either edge. `67b93b2`.

## Genuinely still open

None of these has been requested; all are carried deliberately.

| Item | Why it is open | Cost |
|---|---|---|
| No error boundary | A render throw still blanks the whole app. The two known crashes are fixed, but nothing catches the next one. | small |
| `applyEvents` deep-clones all stats per answer | `JSON.parse(JSON.stringify(stats))` in `store/stats.ts:10`, ~27ms on a year-old blob. Invisible now; grows with history. | small |
| Media Session API | Steering-wheel / head-unit controls for car use. Only reachable via the CLIPS path — `speechSynthesis` is not media to a phone OS. Offered, never approved. | medium |
| PWA manifest | None exists. Installed PWAs get better background audio on Android and a home-screen launch. Offered, never approved. | small |
| Mid-chain clip failure | Replays the whole utterance in live TTS rather than resuming. | small |
| Keyboard drilling goes dead | After focusing a checkbox or the index select, keys stop reaching the drill handler. | small |
| No cross-tab coordination | Two open tabs: last writer wins on localStorage. | medium |
| Charts grid overflows horizontally | Intentional (sticky label column + sideways scroll), excluded from the gutter spec. Listed so it is a decision, not a surprise. | n/a |

## Validation at this commit

3177 unit tests / 54 files, 141 e2e (chromium + chromium-audio), `tsc -b`
clean, `oxlint` clean, build 382.82 kB / 110.20 kB gzip.
