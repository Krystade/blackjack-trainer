# TODO — working list

The list Claude maintains between sessions. It holds what is in flight and what is next, and
records **how** each item gets done, how we know it worked, and what it depends on.
`BACKLOG.md` is still where training-feature ideas get ranked; this file is the four
operating goals and the work under them.

**Status keys:** `[ ]` not started · `[~]` in progress · `[x]` done (with the commit) ·
`[?]` blocked on a decision from Jack · `[-]` dropped (with the reason)

**Rules for this file**
- Every item has a **Method** (what will actually be done) and a **Done when** (an observable
  result: a log line, a passing spec, a drive step, or Jack's ear), not "should work".
- A claim about the phone is settled by the phone. Desk results are labelled as desk results.
- Items are updated in the same commit as the work, never afterwards from memory.

Last updated: 2026-10-06. Session handoff: `docs/HANDOFF.md`. Plan for the next drive and two weeks: `docs/research/2026-10-05-roadmap.md`.

---

## The four goals

| # | Goal | Where it stands |
|---|------|-----------------|
| G1 | Phone alone, **no Bluetooth**: sound from the **loud speaker**, voice answers accepted | **Fixed** (`8195254`, `7826a3e`, `79405cd`). Once the mic has opened, clips and tones play through Web Audio and the open mic is deaf until a line really ends. All drill lines are recorded (`d4e6145`). Left over: settlement lines with amounts, and push-to-talk |
| G2 | **Bluetooth on**: sound through the **car speakers**, voice answers accepted | Car output proven with `<audio>`. **Web Audio over Bluetooth with the mic open is untested.** It's the first step of the "In the car — Bluetooth ON" kit. Which mic is used: the "Bluetooth: phone mic?" kit (`a23e887`), not yet run |
| G3 | Voice recognition that holds up at **freeway noise** | Quiet room 10/10; never measured in motion. The **Words at speed** kit (`f209d54`) measures it. False accepts tightened (`cf9bf33`). If the road number is poor, the next build is Vosk (`docs/research/2026-10-05-constrained-recognizers.md`) |
| G4 | Ongoing UX/UI improvement | UX audit fixes shipped (`2343d33`, `b93282d`, `20339f0`). Open question for Jack: the 44px mute strip at the top of every screen |

---

## G0 · Housekeeping carried over from the local session

- [x] **Settings cull — preferences half** (merged `3eb495b`). (In the car, Theme, Play, Drills, Audio, Car check).
  - Method: agent in an isolated worktree. Each setting is presumed dead unless proven live
    and wanted. Deletions remove the control, the stored field (plus a migration), the
    consuming branch and any tests that exist only for it.
  - Done when: merged, `tsc -b` + lint + vitest green, e2e shows no new failures, and the
    keep/kill table is posted for Jack to veto.
- [x] **Settings cull — voice/diagnostics half** (merged `17e5441`). (Car controls, mic panels, Diagnostic log,
  Voice control). Same method. Includes removing the dead **Switch** option: `persist.ts`
  rewrites `'switch'` to `'auto'` on every load, so picking it silently reverts. The three
  `speaker-handoff` specs that call `listenInCountDrill(page,'switch')` go with it.
- [x] **Wording pass — core screens** (merged `df535fd`). (Home, Table, Charts, Stats, ProfileEditor, App,
  components). One term per concept; glossary in the report. Voice vocabulary is untouched.
- [x] **Wording pass — drills + Field test**, plus the Flashcards layout, the 375×812 fit and the ZonePad fix (merged after `8195254`)., now also covering the **Flashcards layout**
  from Jack's 2026-10-05 screenshots:
  - At 390×844 the action bar (Hit/Stand/Double/Split/Surrender) is below the fold.
    "Surrender" truncates to "Surren…".
  - Five toggles sit above the cards. Cull them to the Settings standard; survivors go
    behind a collapsed "Options".
  - The Listening panel takes three lines plus a permanent earpiece hint. Make it one line.
  - Done when: an e2e assertion at 390×844 shows the dealer card, the hand and the full
    action bar all inside the viewport without scrolling.
- [x] **Merge the four agent branches**, resolve conflicts (`Settings.tsx` and `persist.ts`
  are touched by two of them) and run the full suite once. Push only after that.
- [x] **Clip-chain race fixed** (`9a8a51a`). Interrupts now carry an epoch.
- [~] **Recover the local session's unpushed work.** Jack sent the local copy on
  2026-10-05. Only `e2e/drill-layout.spec.ts` was new, and it went to the drills agent.
  None of the fixes had been written yet. The local transcript shows
  `e2e/drill-layout.spec.ts` (+100) and `__probe2.spec.ts` (+36), which never reached the
  remote. Two findings came with them:
  - **ZonePad surrender circle covers the quadrant labels.** The circle is `44vmin`,
    absolutely positioned at the centre, and ZonePad receives no legality information.
    - Method: pass legal actions into ZonePad. Size the circle so it cannot intersect the
      quadrant label boxes. Hide or disable surrender when it is illegal.
    - Done when: a layout spec asserts there is no bounding-box overlap at 375×812 and
      390×844.
  - **`playClipsResumable` race.** `stopActiveChain()` runs before the `await`s, so two
    calls 5ms apart both find nothing to stop and both start chains.
    - Method: take a chain token synchronously at entry, and have a stale chain bail
      after each `await`.
    - Also find the caller that asks to speak twice.
    - Done when: a unit test fires two calls back to back and only the second chain plays.
  - Ask Jack whether the local checkout still has these files. If not, rebuild them from
    the descriptions above.
- [ ] **Flaky `voice-aliases.spec.ts:119`.** The fake recogniser never fires
  `onaudiostart`, so every session waits out `AUDIOSTART_GRACE_MS` (1500ms). Under full-suite
  load that pushes it over the timeout.
  - Method: make the e2e fake fire `onaudiostart` right after `onstart`, as Safari does.
  - Done when: it passes 10/10 with `--repeat-each=10` under full-suite parallelism.
- [ ] **The other pre-existing red voice specs** (6 known; one is `field-test`). Root-cause
  each one. A spec that now tests a retired mode gets deleted along with the mode. A spec
  that catches a real bug gets the bug fixed. None is skipped.

---

## Test kit (Home → Test kit) — the one-button runner

- [x] **Shipped 2026-10-05.** Three kits: at my desk, car with Bluetooth, car without
  Bluetooth. Covers G1-a, G1-b, G1-e, G2-a, G3-a and the G3-e recordings in one guided run
  each. Step data and scoring: `src/diag/testKit.ts`. I/O: `src/diag/testKitIO.ts`.
  Screen: `src/ui/screens/TestKit.tsx`.
  - Results go to the diagnostic log under `test kit-*`. "Copy results" copies only the
    lines written since the kit started.
  - Recordings stay in memory until "Save recordings" (share sheet or download). They are
    never committed.
- [ ] Jack runs the **desk kit**. Then read the log and update G1/G2/G3 below with what it
  settled.
- [ ] Jack runs the **car kits**: Bluetooth on first (that's how he drives), then off.

## Results — CAR, Bluetooth ON, **PARKED**, 2026-10-06 18:36 (build 7791d25)

The first properly parked run, which is the condition the kit asks for on the listening step.

### G2 WORKS PARKED — and that reframes the whole goal

| Step | Answer |
|------|--------|
| Blind, mic open, `<audio>` | **Car speakers ×3** |
| Blind, mic open, Web Audio | **Car speakers ×3** |
| `bt-closed-element` | Car speakers |
| `bt-closed-webaudio` | Car speakers |

Six of six on the car speakers with the microphone OPEN, on both paths. **So the mic does not
categorically steal the car.** G2 is intermittent, not broken, and the leading hypothesis is now
that the bad state correlates with **driving** rather than with opening the mic:

| Run | Condition | Reached the car? |
|-----|-----------|------------------|
| 2026-10-06 09:05 | driving | No — 0 of 6 |
| 2026-10-06 17:59 (A) | driving | No |
| 2026-10-06 18:01 (C) | driving | **Yes — 6 of 6** |
| 2026-10-06 18:36 | **parked** | **Yes — 6 of 6** |

Driving is not deterministic either (run C worked), so this is a correlation across 4 runs, not a
law. **Revision to an earlier claim here:** "closing the mic does not recover the route" rests on
run A alone — the only run that was in the bad state when those steps ran — and run A was driving,
where Jack cannot hold the phone to his ear to tell the earpiece from the phone's loud speaker. It
was still *not the car* either way, which is the distinction G2 turns on, so the conclusion stands
but on **n=1**. Do not spend a build on the mic-close architecture on that basis.

### The spectral verdicts were all invalid — fixed in `4c1b5b6`

`peakDbfs` did its job on the first outing: −21 to −25 dBFS across the three probes, so Jack
definitely counted out loud this time. And that is what exposed the real bug.

| Probe | label | track rate | highRatio | peak |
|-------|-------|-----------|-----------|------|
| 1 | TOYOTA Corolla | 8000 | 1.4e-7 | −21.2 |
| 2 | TOYOTA Corolla | 8000 | 4.3e-8 | −24.5 |
| 3 | iPhone Microphone | 8000 | 1.6e-8 | −25.0 |

An 8000 Hz track has a true Nyquist of **4000 Hz — exactly the HFP wall** — so nothing above it can
be real and every bin up there is an upsampling artifact. `classifyMicBand` guards for precisely
this but was handed the *context* rate (48000). So the ratio was always noise, which is why one
microphone scored `wideband 0.287` while driving (road noise upsampled into an empty band) and
`narrowband 1.6e-8` parked with a clear voice.

**`trackSampleRate=8000` is itself the proof of the wall** — it needs no spectral inference, and
every car probe on both days reported it. The verdict is now taken from the rate
(`narrowband-by-rate`). Treat every `narrowband`/`wideband` verdict in logs before this build as
meaningless.

### Unverified claim to check

Jack, on the words he skipped here: "I'm pretty sure it would be 100% accurate without the driving
noise, I can double check later." **Not measured.** The parked word step is still outstanding and is
the cheapest remaining measurement: it would separate "recognition is fine and road noise is the
whole problem" from "there is a capture bug independent of noise".

---

## Results — CAR, Bluetooth ON, **DRIVING**, 2026-10-06 17:59 and 18:01 (build 49b277f)

> **Both runs were made WHILE DRIVING.** Jack, 2026-10-06: "I've actually been doing all my
> Bluetooth runs while driving." Earlier revisions of this file said "parked" — that was my
> assumption and it was wrong. Two consequences, pulling in opposite directions:
>
> - **The recognition numbers are ROAD numbers.** Two-word at 14/16 (88%) of the windows that
>   produced a reading was measured with road noise, not in a quiet cabin. That is far better news
>   than "parked 6/10" and it is close to the roadmap's D2. The caveat written below about this not
>   being freeway noise is withdrawn.
> - **The listening (blind) step is less trustworthy than the word step.** The kit's own instruction
>   is "Do the listening step parked; the word step can be done driving", and the blind step was done
>   driving. Telling the earpiece from the phone's loud speaker needs the phone at your ear, which he
>   would not do at the wheel — so 'Earpiece' answers may really mean "quiet, and not the car".
>   **The G2 conclusion survives this**, because every one of those answers was "not the car
>   speakers" either way, which is the only distinction G2 turns on.

Two car-bt runs **90 seconds apart in the same page load** (`[q16]`), with opposite results.
That is the headline: the route is not a function of the playback path, it is a function of which
Bluetooth profile state the phone is in when the run starts.

| | Run A (17:59:36) | Run C (18:01:25) |
|--|------------------|------------------|
| `kit-mic-open` | `afterMs=3447` | `afterMs=14` |
| `<audio>` blind | Earpiece ×3 | **Car speakers ×3** |
| Web Audio blind | Phone loud speaker ×2, Earpiece | **Car speakers ×3** |
| `bt-closed-element` | **Earpiece** | Car speakers |
| `bt-closed-webaudio` | **Earpiece** | Car speakers |
| iPhone mic spectrum | narrowband, highRatio **0.0021** | **wideband, highRatio 0.287** |

### G2: "close the mic while the app speaks" is DEAD — answered in the car

Run A is the informative one: it was in the bad state, and with the mic **closed again** both paths
still came out of the **earpiece**. Closing the mic does not recover the route. This matches the
2026-10-03 finding on Jack's ears and what `micSessionCost.ts` already states in as many words
("Closing the recogniser between prompts was the obvious fix and it would not have worked").

Run C cannot speak to recovery: everything was already on the car, so "Car speakers" after closing
is not evidence of coming back.

**Do not build the mic-close architecture.** What is left for G2 is G2-d (accept the phone's loud
speaker + wheel) or G2-e (chase the car/iOS setting). Waiting on Jack.

### RETRACTED: "the phone mic's spectrum names the route state"

Written here on 2026-10-06 and **wrong**. The claim was that `highRatio` separated the good route
from the bad, three times out of three. It was confounded, and Jack supplied the confound:

> "I was talking about the step where it tells me to count from one to 10 out loud and automatically
> ends. I forgot to count out loud during that step on the first run."

So Run A's three probes measured an **empty cabin** — engine noise, no voice — and still returned a
confident `verdict=narrowband`, because engine noise clears the silence floor. Run A was silent AND
on the earpiece; Run C was spoken AND on the car. Two variables moved together, so the comparison
says nothing about the route. `micSpectrum.ts` had already warned in a comment: "A wall seen while
nobody was speaking is not evidence of a wall."

Two real faults found while retracting it, both fixed:

- **No level was ever recorded**, so a probe of nobody speaking was indistinguishable in the export
  from a probe of speech. `peakDbfs` is now on every snapshot and in the log. Nothing gates on it —
  what counts as "loud enough to be speech" in a Corolla at 8kHz is not measured, and inventing that
  threshold is the mistake the field exists to prevent.
- **The loop did not do what its own comment said.** It claimed "the loudest moment decides" and
  selected on `highRatio`, the SHARE of energy above the wall, which is not loudness: a quiet frame
  of hiss beat a loud frame of speech, so the reported ratio could come from a moment nobody spoke
  in. `preferFrame` now selects by level, and is a pure function with its own tests.

**What is still true:** every probe in both days' runs reported `trackSampleRate=8000` once the
Corolla was connected, the iPhone's own mic included. The 8kHz wall is real. What the spectrum
*ratio* means is unsettled, and a probe is only worth reading if `peakDbfs` shows someone spoke
into it.

### Recognition: 7 of 20 windows heard NOTHING, and the cause was unlogged

`oneWord=3/10 twoWord=6/10` — but 7 windows returned `offered=0`, never a wrong word, and **every
one of them followed a retry** (7/7, both directions).

**Jack was speaking in those windows.** Asked directly: "The 'dead windows' were me saying the word
or words and them not being recognized I think. I don't know if it was a mic issue." He later
confirmed this covers the WORD step specifically — he spoke every word, up to twice (the first ask
and the retry); the step he forgot to speak in was the *spectrum* step, which is a different
problem (retracted above). So all 7 are **lost attempts, not absent ones**, and the innocent reading
is ruled out. Two failures remain, and
they want opposite fixes:

| | Signature in the next export | Meaning |
|--|------------------------------|---------|
| (a) Between sessions | `sessionsAtOpen` ≠ `sessionsAtClose` | The engine restarted mid-window; the words went nowhere |
| (b) Live but dropped | counts equal, `speech>0`, `offered=0` | Capture was flowing and the recogniser returned nothing |
| (c) Deaf while "open" | counts equal, `speech=0` | Audio never reached the engine though the API said the mic was open — the lost-capture failure |

`rec.onend` restarted the session **with no log line at all**, which is why none of this could be
separated.

Fixed in `3f7bcbf` and the follow-up (instrumentation only, no behaviour change):
`kit-mic-restart` with a session count, `kit-mic-dead` when a restart throws, and
`kit-calibrate-attempt` per attempt carrying `sessionsAtOpen`/`sessionsAtClose` and `speech` (how
many times the engine reported speech during that window). The next run distinguishes (a), (b) and
(c) by the table above.

### The two failures must be scored apart — recognition is NOT the weak link

`oneWord=3/10 twoWord=6/10` lumps together two unrelated things: a word the recogniser got WRONG,
and a word that never reached it (`offered=0`). Split by whether audio arrived at all, across both
days' car runs:

| Form | Windows that produced a reading | Right |
|------|-------------------------------|-------|
| two-word | 16 | **14 (88%)** |
| one-word | 15 | 6 (40%) |

In the 2026-10-06 18:01 run, **every two-word window that produced a reading was correct — 6 of 6.**

So recognition of what reaches the engine is not the problem: 10/10 in a quiet room, ~88% on
two-word forms in a car at 8kHz. The dominant failure is **audio not arriving**, which is capture,
not vocabulary. Two consequences:

1. The vocabulary decision is **better** supported than the raw ratios suggested — 88% against 40%
   like-for-like, not 6/10 against 3/10. Two-word stays the default.
2. **Spend the effort on the lost windows, not on the word list.** A fix that makes capture reliable
   is worth more than any further vocabulary change, and the instrumentation to classify them is in
   (`sessionsAtOpen`/`sessionsAtClose`, `speech`, `offered`).

Sample sizes are 16 and 15 windows, one voice, one car. **These ARE road numbers** — both runs were
driving (see the note above) — so 88% is the best estimate of two-word accuracy at speed that
exists. It is not yet confirmed at sustained freeway speed, and one more run would settle it.

**This weakens the vocabulary evidence, and more than first thought** — the lost windows were real
attempts. Both days' figures are contaminated by them:
combined, one-word 6/20 and two-word 14/20. Same direction, less solid than 8/10 vs 3/10 looked.
The two-word default stays (it is free, and one-word remains an alias), but do not treat the
margin as measured until a run with no dead windows reproduces it.

### Also: the "missing" log was not missing

Jack: "I did two Bluetooth on tests and got completely different results and neither show in
diagnostics log." Both were there. The kit's "Copy results" filters to the lines since that kit
started and printed the ordinary full-log header, so a scoped copy was indistinguishable from the
whole log. Fixed in `bce87b6`: a scoped export now says so, and says where the rest is.

---

## Results — CAR, Bluetooth ON, **DRIVING**, 2026-10-06 09:05 (build f209d54, iOS 18.7, installed app)

The first measurement ever taken in the car. Jack ran the `car-bt` kit end to end.

**Read the per-trial lines, not the summary.** The on-screen summary said
`element="0 of 3 on the loud speaker"` and `webaudio="0 of 3 on the loud speaker"` on both
paths. That was a scoring fault, fixed in `7071ee0`: `BlindStep` compared against the DESK
answer set's `'Loud speaker'`, and the car kits offer `'Car speakers'` / `'Phone loud speaker'`,
so it could not match whatever he tapped.

### G2 gate: FAILED, and the pre-registered fix is ruled out with it

| Path | Trials | Where the sound came from |
|------|--------|---------------------------|
| `<audio>` (element) | 3 | Earpiece, Phone loud speaker, Phone loud speaker |
| Web Audio | 3 | Phone loud speaker ×3 |

**Car speakers: 0 of 6.** Nothing reached the car with a microphone open.

The handoff's planned remedy was "if Web Audio does not reach the car, restore the `<audio>`
path when Bluetooth is connected". **This log kills that fix**: `<audio>` did not reach the car
either. With a mic open the phone takes the audio on BOTH paths, so the choice is not between
the two playback paths. It is G2-d (speaker-through-phone + wheel) against G2-e (chase the car
setting). **Waiting on Jack.**

### The 4kHz wall is real in the car, on both microphones

| Probe | Label | track rate | highRatio | high bands |
|-------|-------|-----------|-----------|-----------|
| 1 | TOYOTA Corolla | 48000 | 0.0000031 | 28 / 199 |
| 2 | TOYOTA Corolla | 8000 | 0.0000111 | 26 / 197 |
| 3 | iPhone Microphone | **8000** | 0.0015 | 369 / 540 |

All three **narrowband**. The decisive one is the third: once the Corolla is connected, the
**iPhone's own microphone also opens at 8kHz**. Selecting the phone mic does not escape HFP, so
the "Bluetooth: phone mic?" kit's premise is weaker than it looked. Indoors on 2026-10-05 that
same mic measured wideband (highRatio 0.28 then 0.977) — so the HFP hypothesis, eliminated at
the desk, holds in the car.

### Vocabulary (G3-b): two-word wins, 8/10 against 3/10 — SETTLED, shipped in `4e2d3e0`

`kit-calibrate-summary oneWord=3/10 twoWord=8/10 wrongAction=1 rescuable=2`

| Command | one-word | two-word |
|---------|----------|----------|
| hit | **0/2** — `nothing-heard`, `offered=0`, both rounds, each after a retry | 2/2 |
| stand | 1/2 ("Send", rescued) | 2/2 ("Stand back", "Stand pad" — both matched) |
| double | 0/2 ("No" → wrong-action, "Devil") | 1/2 ("Fell down" missed) |
| split | 1/2 ("Flat", rescued) | 1/2 ("Sweater" missed) |
| surrender | 1/2 ("Trainer", "Turner") | 2/2 |

Two-word is at least as good on every command. `split` is the one tie, so it rides the uniform
rule rather than its own evidence. `yes`/`no`/`repeat` were never asked and are unchanged.

**"hit" alone returned nothing at all** — not a wrong word, `offered=0`. That is the single
clearest recognition finding to date.

### Confidence is dead as a gate, again and harder

Wrong readings scored **0.862** ("Devil") and **0.868** ("Fell down"); correct ones scored
**0.105** ("Stand pad") and **0.057** ("Hit me", "Stand back"). The two distributions are
inverted, not merely overlapping. Nothing gates on confidence, which is correct; nothing
should start.

### Still open from this run

- `kit-mic-open audiostart=true afterMs=1430` on the first open against `afterMs=21` later. R1
  (slow/lost first mic open) is visible here but was not the 20s of the desk run.
- `devicechange` fired at every mic open (09:05:26, 09:06:25, 09:06:35, 09:09:41): the route
  flips each time the microphone opens.
- **The backoff is blind to device churn.** `sinceDeviceChangeMs` is logged and acted on by
  nothing, so a `devicechange` burst counts as genuine mic failure and `restartDelayFor` climbs
  to the 8s ceiling (250+500+1000+2000+4000+8000 ≈ 16s, plus the attempts ≈ the ~20s of
  deafness in the desk log). Candidate root fix for R1: a failure that lands within a short
  window of a device change must not count against `failedStreak`. Not yet written.

---

## Results — desk run 2026-10-05 (build 551ed72, iOS 18.7, installed app)

One unblinded answer per step, so treat these as leads, not settled facts.

| Step | Answer |
|------|--------|
| Mic never opened, normal playback | Loud speaker |
| Mic never opened, Web Audio | **Heard nothing.** Ring switch, or the context not unlocked; now logged |
| Mic open, normal playback | Earpiece (as on every drive) |
| **Mic open, Web Audio** | **Loud speaker**: the first lead on G1 |
| Mic closed again, both paths | Loud speaker |
| Fresh page after reload, normal | Earpiece (odd: the mic was never opened in that page) |
| Calibration, second round (quiet room) | **10/10**, one-word and two-word alike |
| Calibration, first round | 3 slots heard nothing: `devicechange` ×2 right after the mic opened, then `audio-capture`. The first mic open of the page lost the mic |

- **Blind Speaker check, 2026-10-05 08:09 (build 668a6a5):** six plays, mic open, order hidden.
  - **Web Audio: 3 of 3 on the loud speaker.** Counting the earlier run, that's 4 of 4.
  - Normal playback: 2 of 3. The earpiece came on the first normal play after the mic opened
    (the earlier run's single mic-open play was also earpiece).
  - Web Audio with the mic never opened: "heard nothing" again, with `audioContext=running`.
    So the context was unlocked, and the ring switch is the likely cause (Web Audio obeys it).
    Asked Jack.
  - **Before building on it, two cautions:**
    - `caa5a73` removed a Web Audio route because a MediaElementSource stretched and chopped
      clips with the mic open: 24kHz files resampled live into a graph whose hardware rate
      the mic moves. The kit uses decoded buffers (resampled once, at decode), which is a
      different path. Still, sound quality has to be asked about.
    - If the ring switch silences Web Audio whenever the mic is closed, Web Audio can only be
      used while capture is live, or the drill goes silent on a muted phone.
- **Speaker check with the ring switch off, 08:11:** Web Audio 3/3 on the loud speaker,
  element **0/3** (earpiece). Web Audio before any mic: loud speaker. So Web Audio while the mic
  is open is **7/7**, the element 2/7, and the earlier "heard nothing" was the ring switch. With
  the switch on silent, Web Audio with the mic open was still audible (08:09 run).
- [x] **G1 fix shipped:** while a voice session is running, recorded clips play through Web
  Audio (decoded buffers, not a MediaElementSource). Everywhere else they stay on `<audio>`.
  `clip-chain path=webaudio` in the log marks each one, and `clip-webaudio-skip` marks a
  fallback.
  - Not covered: live-TTS fallback lines (`speechSynthesis`) and the chime tones still use
    their own paths, so they may still come out of the earpiece. The same goes for
    push-to-talk ("Talk" wheel mode), where the mic is closed between presses.
  - Next: one voice drill on the phone with no Bluetooth, to confirm prompts are on the loud
    speaker. Then a car run with Bluetooth on, to confirm nothing changed there.
- **G1-e ruled out:** Jack already had Call Audio Routing = Speaker during this run, and
  normal playback with the mic open was still on the earpiece.
- **Next:** the blind Speaker check (6 plays, hidden order). If Web Audio holds up, the fix
  for G1 is to play clips through Web Audio whenever the mic is open.
- **New lead for G3:** the first mic session of a page load can lose its input to a route
  change and go deaf for ~20s. Drills would lose their first answers the same way.

## Test kit: Words at speed (2026-10-06)

- [x] **Words at speed kit**: one tap for Bluetooth on or off, then only the 20-word step,
  run by ear. Start it while stopped.
- [x] **The retry is spoken.** "Again." plays as a recording, and the open mic ignores its own
  "again". The intro and the order are recorded too, and the tick uses the Web Audio path, so
  nothing in the step relies on the phone's own voice or on the earpiece.
- [ ] Jack drives it twice (Bluetooth off, then on). The two numbers go into the roadmap's
  decision table (`docs/research/2026-10-05-roadmap.md`).

## Swarm, 2026-10-05 (Sonnet agents; Claude orchestrates, merges and deploys)

- [~] **Bluetooth: phone mic? kit**: built in a worktree. Covers the spectral probe on the iPhone
  input, the finger test, where the sound goes while that input is held, recognition with the mic
  covered and uncovered, and the wheel during capture.
- [x] **Matcher false accepts** (merged): runner-ups no longer fuzzy-match; double needs an exact match; several commands without a "no/sorry/wait" between them are rejected. Was: "But" (confidence 0.35) was graded as SPLIT on 2026-10-05. Tighten
  it without losing real rescues.
- [~] **e2e health**: fix the fake recogniser's missing `onaudiostart` (flaky voice-aliases:119 and
  voice-tc-drill:177), and root-cause field-test-round5:347, field-test:1973 and
  field-test-audio:441/507.
- [x] Research: an in-browser recogniser limited to the command words. See
  `docs/research/2026-10-05-constrained-recognizers.md`.
  - Ranking: **Vosk with a grammar** (needs no SharedArrayBuffer, so GitHub Pages works;
    ~40MB model) > sherpa-onnx keyword spotter > custom model on Jack's voice > Whisper
    (crashes on iOS) > Picovoice (paid).
  - Gate: it has to survive 3 minutes on the phone without a reload.
  - Build only if the drive's numbers are poor (roadmap decision table).
- [x] Audit + fixes merged (`docs/research/2026-10-05-sound-paths.md`). Changes:
  - Tones play through Web Audio once the mic has opened.
  - Every way the app opens the mic now counts as opening it.
  - The audio context is kept awake after interruptions.
  - The true-count question (492 lines) now matches its clips.
  - The notices are corrected.
- [x] **21 sentences per voice recorded** (Kokoro, generated in the cloud session on 2026-10-05; `NEEDS_RECORDING` is now empty). Was: ("Push.", "Produce the true count.", "What's
  the true count?", "X isn't part of this question." ×5, "The card left over was …" ×13). They're
  listed in `NEEDS_RECORDING` in `scripts/clipCoverage.test.ts` and already sit in
  `spoken-phrases.json`, so the next Kokoro run generates them.
- [x] UX audit at 375×812 (`docs/research/2026-10-05-ux-audit.md`). The fixes are merged: mute strip, 44px targets, contrast, keypad gutter, pinned Start/Next, Count drill Options, two-tap End, Home top-aligned, Test kit buttons first, plain-word flashcard feedback.
- [x] Roadmap: `docs/research/2026-10-05-roadmap.md`.

## Results — Flashcards drill, 2026-10-05 01:35 (build 8195254)

- Every prompt while voice was on: `path=webaudio`, on the loud speaker. **G1 confirmed in a real
  drill.**
- Then voice was turned off, and the next two prompts went back to `<audio>` and the **earpiece**.
  Fixed in `7826a3e`: Web Audio now stays on for the rest of the page once the mic has opened.
- "But" was accepted as split ("approximate"), handed to the swarm. "Stand hit hit hit" was
  accepted as hit.

## G1 · Loud speaker + voice, no Bluetooth

**Evidence so far (do not re-run):**
- `navigator.audioSession.type = 'playback'` while capturing: the log reads back `playback`,
  but the sound still comes out of the earpiece. Disproved.
- Capture stopped, `'playback'` declared, then clips played (the WebKit bug 218012 order):
  the 17:00 log on build `e60a90f` shows the mic shut and `type=playback` confirmed, with
  three seconds of clip on the earpiece. Disproved (commit `ec67e35`).
- "Switch" mode (close the mic around every utterance) caused a repeat loop and fixed
  nothing. Retired.
- Conclusion recorded in `ec67e35`: **once a page has opened a microphone, the loud speaker
  is gone for the life of that page.**

**Remaining methods, cheapest first:**

- [ ] **G1-a · One last web probe: Web Audio output instead of `<audio>`.** Every test so far
  played clips through media elements.
  - Method: decode a clip into an `AudioBuffer` and play it through the shared
    `AudioContext` while the mic is live. Add it as a Car check step and log the route
    readback. Only Jack's ear can tell which speaker it came out of.
  - Why it might differ: WebKit routes `AudioContext` and media elements through different
    session paths, and some iOS reports have them behaving differently after
    `getUserMedia`. Low odds, but cheap, and it is the only untested output path.
  - Done when: one parked test where Jack reports "speaker" or "earpiece" for each path.
- [ ] **G1-b · Page reload as a reset.** If the earpiece lock lasts for the page's life, a
  fresh page load starts on the speaker.
  - Method: measure whether a reload after mic use restores the speaker, and how long the
    page takes to come back to a ready drill.
  - Probably unusable mid-drill. Worth knowing because it bounds what "page life" means.
  - Done when: one parked reading.
- [-] **G1-c · Native iOS shell (Capacitor).** Dropped 2026-10-05. Jack: "no shot im making
  this an app, especially in its current state." Everything below stays inside the browser.
  Don't propose it again unless the web paths below are all exhausted *and* Jack raises it.
- [-] **G1-e · iOS "Call Audio Routing" = Speaker** (no code). **Ruled out 2026-10-05**: it was already on, and the earpiece persisted.
  - Settings → Accessibility → Touch → Call Audio Routing → Speaker.
  - Why it might work: the earpiece is iOS's receiver route for a record-capable session,
    which is the same route a call uses. This setting forces call audio to the speaker
    system-wide, and may cover WebKit's capture session too. Untested.
  - Method: flip it, run one parked drill with voice on and no Bluetooth, and listen. Flip it
    back afterwards if it breaks anything else.
  - Done when: Jack reports "speaker" or "earpiece".
- [ ] **G1-d · Fallback that works today: no-mic speaker mode.** Voice off, answers by tap
  or wheel. The loud speaker holds because nothing ever opens a mic.
  - Method: make sure this is a one-toggle state and that the app never opens a mic in it.
    Add a Car check assertion that `session-at-mic-open` never appears.
  - Done when: a parked test on the speaker with zero mic rows in the log.

---

## G2 · Bluetooth: car speakers + voice

**Evidence so far:**
- Clips reach the car speakers over Bluetooth. Settled 09-27 and 09-29.
- The wheel arrives as `nexttrack`/`previoustrack`, and works with the screen off.
- Opening a mic switches the car to its hands-free CALL route. Wheel buttons then belong to
  the "call".
- WebKit sets `AllowBluetooth` (the hands-free profile, HFP) unconditionally for
  PlayAndRecord. The input is `currentRoute.inputs.firstObject`, which the page cannot
  choose. The log lists "iPhone Microphone | TOYOTA Corolla" with nothing to pick between
  them.
- The HFP mic is narrowband: ~8kHz, or 16kHz with wideband speech. That is a hard ceiling
  for recognition.

**Methods:**
- [ ] **G2-a · Settle which mic the recogniser is actually on, with Bluetooth connected.**
  - Method: the spectral probe from `a4d87bb` (`diag/micSpectrum.ts`), run in two places:
    - parked with the engine off;
    - on the freeway (drive card step 9).
  - `highRatio` near 0 with no live bands above 4kHz means the car mic over HFP. A
    wideband reading means the phone mic.
  - Done when: two readings logged, one per condition.
- [~] **G2-d · Can `getUserMedia({deviceId:{exact: iPhone mic}})` keep the session off HFP?**
  - Method: Test kit → "Bluetooth: phone mic?" (built, desk-untested on the phone). Parked, engine
    running, Bluetooth on. Probes the iPhone and car inputs, finger test, plays the route clip
    with that stream held, asks whether the car showed a call, runs the 10 words covered and
    uncovered, then waits for a wheel skip-forward.
  - Done when: the kit's `kit-phone-summary` log line is pasted from a real drive.
- [ ] **G2-b · Recheck "car speakerphone mic" feasibility** (Jack: "doesn't seem feasible,
  will need to recheck").
  - Method:
    - Compare recognition accuracy on the same word list through each input. Use
      intent-labelled samples from G3-a, not impressions.
    - If HFP is wideband in this car (mSBC, 16kHz), the car mic may be *better* than the
      phone in the cradle: it is closer to the mouth and has the car's own noise processing.
  - Done when: per-input accuracy on ≥20 labelled words each, at freeway speed.
- [-] **G2-c · Native A2DP output + phone mic.** Dropped with G1-c (no native app). On the
  web the input is whatever iOS picks. The only levers left are which Bluetooth profile the
  car offers (G2-e) and when the mic is open (G2-d).
- [ ] **G2-e · Car-side and phone-side settings** (no code).
  - Check the car's Bluetooth phone settings for a "hands-free mic" or "phone audio" option.
    Some Toyota units let media and phone profiles be paired separately.
  - Check that iOS Bluetooth → the car → Device Type is "Car Stereo".
  - Method: one parked session per setting change, with the spectral probe (G2-a) recording
    which input was live.
  - Done when: each setting has a probe reading against it.
- [ ] **G2-d · Web-only mitigation: wheel push-to-talk.** Keep the mic closed by default,
  so the car stays on the media route. A wheel press opens the mic for one answer window,
  then it closes.
  - Cost: each open re-enters the call route (~1.2s handshake, measured `confirmedInMs`),
    and the route settle (~1.6s) applies when the mic closes.
  - Method: prototype behind a setting. Log open→heard→close timings on a drive.
  - Done when: a drive log shows the wheel working between answers and an answer accepted
    after each press.

---

## G3 · Recognition in freeway noise

**Evidence so far:**
- Room test 2026-10-05: quiet room, wideband phone mic, `audiostart afterStartMs=0`, and
  "hit" still came back as "Add" (confidence 0.737; the four correct words were 0.86–0.997).
  So it is **not** noise, the car mic, or a clipped onset. It is the model.
- WebKit runs Web Speech with `SFSpeechRecognitionTaskHintDictation`. Only lang,
  continuous, interimResults and maxAlternatives reach it: no `.confirmation` hint, no
  contextual strings.
- Shipped but unmeasured:
  - two-word command forms ("hit me", "stand pat", …), commit `bd060dd`;
  - taught aliases (`18cb059`);
  - asking for 10 alternatives, with `asked`/`offered` logged.
- `offered=1` in 5 of 5 samples: iOS may only ever return one transcription. Unconfirmed.

**Methods:**
- [ ] **G3-a · Build a measurement before changing anything else.** Nothing currently
  records what Jack *meant*, so no change can be scored.
  - Method: a "calibration" run in Car check/Field test.
    - The app shows (and, through the car, speaks) a target word.
    - Jack says it, and the app logs `target`, `heard`, `confidence` and `offered`.
    - 20 words per run, alternating one-word and two-word forms *within* the run, so road
      noise affects both arms equally.
  - Output: accuracy for one-word vs two-word forms, and a confusion list that seeds the
    aliases automatically.
  - Done when: one parked run and one freeway run produce two accuracy numbers each.
- [ ] **G3-b · Decide the vocabulary from G3-a data.**
  - Method: keep whichever form scores higher. Pick replacement words with distinct
    consonant skeletons (the matcher keys on those) and ≥2 syllables, e.g.
    "hit"→"hit me", "stand"→"stay" (test it).
  - Done when: the winner is the documented default and the loser is retired or kept as an
    alias only.
- [ ] **G3-c · Use alternatives properly if iOS returns them.** If G3-a shows `offered>1`,
  rescore all alternatives against the active command set before rejecting.
  - Method: the rescoring exists in `resolveSpoken` with length guards. Confirm it is wired
    on every drill path.
  - Done when: a logged rescue (`rank>0` accepted) on the phone.
- [ ] **G3-d · Constrained-vocabulary recogniser in the browser.** This is the main lever
  for G3 now that native is out: a recogniser that can only answer with one of ~12 words
  cannot hear "Add".
  - Native route: dropped (see G1-c).
  - Web route: `getUserMedia` (with `noiseSuppression`/`echoCancellation`) feeding a
    WASM recogniser restricted to a grammar. Candidates: Vosk with a JSON grammar list, or
    a small custom keyword-spotting model.
    - Caveat: this still opens a page mic, so G1's earpiece problem stays on the web path.
    - Upside: it beats G3's model problem without native.
  - Method: prototype the web version offline first, since it can be desk-tested in
    Chromium. Measure the bundle size (the Vosk small English model is ~40MB, cached once)
    and latency.
  - Done when: in a desk test with recorded road noise mixed in at freeway SNR, the
    grammar recogniser beats Web Speech on the same labelled clips.
- [-] **G3-e · Recorded-noise test bench (desk).** Parked 2026-10-05: Jack passed on sending recordings, and the recording steps are out of the kits. Revisit if freeway accuracy turns out poor. Today every recognition change waits for
  a drive.
  - Method:
    - Record Jack saying the command set once, parked (a calibration run that saves audio,
      opt-in).
    - Record ~60s of freeway cabin noise.
    - Mix them at −5/0/+5/+10 dB SNR.
    - Play the mixes into Chromium's fake mic (`--use-file-for-fake-audio-capture`) for any
      web recogniser, or into the native recogniser on a Mac.
  - Note: recordings contain Jack's voice. Keep them off the public repo, as with the drive
    logs.
  - Done when: `npm run noise-bench` prints accuracy per SNR per recogniser.
- [ ] **G3-f · Prompt and turn-taking hygiene** (affects G1 and G2 too).
  - Mic opens only after the app stops talking: shipped in `e60a90f`. Verify on the drive
    log.
  - Mic-live tone: shipped. Check that its timing aligns with `audiostart`, not `onstart`.
  - Done when: a drive log shows no `mic suppressed` rows caused by our own prompt.

---

## G4 · UX/UI

- [~] Settings cull, wording pass, Flashcards layout (see G0).
- [ ] **Car mode screen.** One screen for driving: big text, the current prompt, a single
  status line (listening / speaking / heard X), no toggles.
  - Method: derive it from the Flashcards and count-drill layouts once the G0 layout work
    lands.
  - Done when: Jack uses it on a drive and the note box has no layout complaints.
- [ ] **Listening status line.** Show "heard X → not a command" briefly, then clear it.
  Point at teaching that word as an alias when it repeats.
- [ ] **Layout regression guard.** One spec visits every screen at 375×812 and 390×844 and
  asserts that primary actions are in the viewport and no text is truncated
  (`scrollWidth > clientWidth` on buttons).

---

## Decisions waiting on Jack

1. ~~Native shell?~~ **No** (2026-10-05). Web-only from here.
2. **Unpushed local work** (`drill-layout.spec.ts`, `__probe2.spec.ts`, any uncommitted
   fixes): is it still on your Mac? Push it, or I rebuild it.
3. **Voice recording for the noise bench (G3-e):** OK to record your command words once,
   stored locally and never committed?
