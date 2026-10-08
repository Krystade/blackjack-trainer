# The next test run

Written 2026-10-06, after four car runs that each answered less than they could
have. Everything below exists because a question went unanswered for want of one
line in the log.

One rule for the whole run: **two kits, and the first one parked.** Three of the
four runs on 2026-10-06 judged "earpiece or car speakers?" while driving, which
cannot be done — telling the earpiece from the car needs the phone at your ear.
The word step is the one that can be done at speed, and it is the one that got
dropped both times.

---

## Run 1 — parked, engine running, Bluetooth connected

Kit: **In the car — Bluetooth ON**. About 5 minutes. Do every step; do not skip
the word step.

| # | Assumption to settle | Step | The line that settles it | What each answer means |
|---|---|---|---|---|
| A1 | The route state is intermittent, not broken. Four runs gave two states. | Blind, mic on, 6 plays | `kit-route-state state=… hits=… trials=… answers=[…]` | `always` = the good state, read the rest of the run as a good-state run. `never-reached-target` = the bad state. `mixed` = it flips **inside one run**, which no run has shown yet and which would change the whole diagnosis. |
| A2 | Does closing the mic give the car back? | `bt-closed-element`, `bt-closed-webaudio` | `kit-answer step=bt-closed-… answer=…` | `Car speakers` on both = closing the mic recovers the route, and holding it closed between prompts is worth building. Anything else = it does not, and G2 is a choice between the phone's own speaker and a car/iOS setting. **Only meaningful if A1 came out `never-reached-target`** — you cannot recover a route that never left. |
| A3 | Recognition parked: Jack's hunch is "100% without driving noise". Unverified; skipped twice. | Word step (20 words) | `kit-calibrate-summary oneWord=n/10 twoWord=n/10` | Near 10/10 on both = road noise is the whole problem and the fix is noise, not code. Anything like the driving numbers (two-word 14/16, one-word 6/15) = there is a capture bug that has nothing to do with noise. |
| A4 | The 7 dead windows of 2026-10-06: were they lost capture, session gaps, or dropped audio? Jack was speaking in all of them. | Word step, every attempt | `kit-calibrate-attempt offered=… speech=… sessionsAtOpen=… sessionsAtClose=…` | See the table below. |
| A5 | The spectral verdicts taken in the car were meaningless — `classifyMicBand` was handed 48000 instead of the track's 8000. | Listening step (count 1→10 **out loud**) | `mic spectrum verdict=… trackSampleRate=… peakDbfs=…` (on screen: `verdict · high … · peak −xx dBFS`) | `narrowband-by-rate` is now decided by `trackSampleRate` alone and measures nothing — an 8000 Hz track has a true Nyquist of 4000 Hz, exactly `HFP_WALL_HZ`, so no energy above it can be real. The number that matters is `peakDbfs`: at or near −120 (`SILENCE_DBFS`) nobody spoke and the row says nothing at all. |

### Reading A4

`offered=0` was one line with three causes. It is now three:

| `sessionsAtOpen` vs `Close` | `speech` | Reading | What it would mean |
|---|---|---|---|
| differ | any | The engine restarted inside the window | The word fell in a restart gap. Instrumentation problem, not a recognition one — the retry needs to wait out the gap. |
| same | `> 0` | Live audio, no final | The recogniser had the audio and dropped it. A vocabulary or confidence problem. |
| same | `0` | **Deaf while open** | Audio never reached the engine although the API said the mic was open. This is the lost-capture failure, and it is the one that would explain the car. |

Also watch for, anywhere in the run:

- `kit-mic-restart n=… why=engine-ended` — how much session churn there really is. Zero of these appeared in any export before today, because the restart was silent.
- `kit-mic-dead after=…` — the worst case: the restart threw and the mic never opened again, so every remaining window reads as "heard nothing". A run that has gone deaf now says so instead of being believed.
- `kit-mic-abort-on-close expected=true` — the normal close. If `kit-mic-error error=aborted` appears instead, this build is older than 3c3889b.

---

### Run 1 results — 2026-10-07 14:09, parked, engine on, Bluetooth on (build 4f0611d)

| # | Line | Result | Reading |
|---|---|---|---|
| A1 | `kit-route-state` | `never-reached-target`, 6/6 **Earpiece** (both paths) | **The bad state, while parked.** So the bad state is not caused by driving. A `route devicechange` (inputs `iPhone Microphone \| TOYOTA Corolla`) fired 1.4s after the mic opened, as the first play started. |
| A2 | `bt-closed-element`, `bt-closed-webaudio` | Earpiece, Earpiece | **Closing the mic does not give the car back.** That's n=2 now, with run A of 2026-10-06. The mic-close architecture is ruled out. In the bad state even Web Audio is on the earpiece, so G2 cannot be fixed from the playback path. |
| A3 | `kit-calibrate-summary` | **oneWord 10/10, twoWord 10/10** | Parked recognition is perfect, through the car's 8kHz mic. The driving losses are noise and capture, not the recogniser or the vocabulary. |
| A4 | `kit-calibrate-attempt` | 1 dead window of 21: the first one ("hit", attempt 1), `offered=0`, same session | It opened into the input swap: a `route devicechange` came 1.1s after `kit-mic-open`. Every later window heard. **`speech=0` on all 21 attempts, including the 20 that heard the word**, so iOS never fires `speechstart` and the field cannot classify A4. Treat it as unsupported. |
| A5 | `mic spectrum` | `peakDbfs=-120` on all three probes (car ×2, iPhone ×1), track 8000 | **Unusable, and the probe's own fault.** `-120` is `SILENCE_DBFS`, the sentinel the no-signal path writes — not a measurement. The probe borrowed the shared `AudioContext`, and iOS creates one `suspended` unless it was built inside a user gesture; a suspended context renders nothing, so the `AnalyserNode` returned its initial fill while the loop counted frames off the wall clock. So this row cannot distinguish "nobody spoke" from "capture delivered zeros" from "the probe never ran", and the third is the likeliest. Fixed in `bcdbe16`: the probe starts its own context, resumes it, and on failure writes `error=context-suspended contextState=…` instead of a number. |

Found in the same run, and fixed after it:

- **Web Audio clock stopped after the app was backgrounded** (hidden 14:11:03, visible 14:11:49).
  - Every Web Audio line in the word step ended on its watchdog (`clip-end reason=watchdog`) with
    `audioContext=running`: "Say each word after the tick.", the order line, "Again.". The ticks
    were most likely silent too.
  - Fix: `getLiveAudioContext()` checks the clock is actually advancing, nudges it, and replaces
    the context if it stays stopped. Logged as `audio-clock-stopped`, `audio-clock-restarted` and
    `audio-context-replaced`, and a Web Audio watchdog now logs `clip-webaudio-stall`.
- **The first word window opened into the route swap.** The word step now waits for
  `devicechange` to go quiet (1.5s, max 4s) before the first tick, logged as
  `kit-route-settle waitedMs=… changes=…`.

## Run 2 — driving, same road as 2026-10-06

Kit: **Words at speed** → *Bluetooth on*. One tap, then it runs by ear, about 3
minutes.

| Assumption | The line | What it means |
|---|---|---|
| The driving numbers (two-word 88%, one-word 40%) are real and reproducible | `kit-calibrate-summary` | Reproduced = the two-word spoken forms are the right default and the gap is noise. Much better = the first run's numbers were a bad route state, not noise. |
| Whichever cause A4 named is still the cause at speed | `kit-calibrate-attempt` | Same shape as parked = one failure, not two. |

Run 2 is only worth doing after Run 1, because its numbers mean nothing without
Run 1's `kit-route-state` to read them against.

---

### Run 2 results — 2026-10-07 18:47–19:03, driving (build 3f51ef3)

Not the kit: this was a real flashcards drill, exported whole. Jack turned
Bluetooth off part way, which makes the log a natural experiment.

**Bluetooth off helped, and the margin is large.** The split is at 18:52:45.781,
where `route inputs count=1 labels="iPhone Microphone"` records the car dropping
off. Hand tally of `mic verdict` lines either side:

| | resolved to a command | rejected | suppressed | rate |
|---|---|---|---|---|
| Bluetooth on | 12 | 8 | 1 | **60%** |
| Bluetooth off | 41 | 8 | 1 | **84%** |

Jack's impression is confirmed. It is **not** a controlled comparison, though:
the Bluetooth-on stretch also held 3 `clip-webaudio-stall`s inside a
`visibility=hidden` window, one `session-error error=not-allowed`, and the
device-change failures — so some of those 20 prompts he may never have heard.

**The volume breakage cannot be read out of this log.** He left the app to change
the volume at about 19:03 and came back to the quiet earpiece. `route
hardware-rate` — the only instrument that names the output route — had taken its
24th and last reading at 19:02:48.605, seconds earlier: `MAX_RATE_PROBES` was 24
and a drill spends two per prompt. Fixed in `a7c07c4`: a pair costs a reading at
most once per 30s, the budget is 120, and running out now writes
`state=budget-spent` instead of just going quiet. Re-run the drive to get the
reading.

**The backgrounded-clock stall is narrower than "the clock stops".**
`clip-webaudio-stall` fired 3× (ctxTime 5.72 → 10.528 → 10.976), all inside one
`visibility=hidden` window (18:48:06 → 18:48:37), and recovered on return to
visible. `audio-clock-stopped`, `audio-clock-restarted` and
`audio-context-replaced` never fired, so the 120ms liveness probe found the clock
moving every time it asked. The stall is confined to the hidden window.

## Run 3 — what the fixes of 2026-10-07 evening left to measure

Three instruments were repaired after the two runs above, and **not one of them
has produced a reading on the phone yet.** In priority order, cheapest first.

### 3A — the volume breakage. Parked, 2 minutes, no driving.

The only completely unmeasured failure left, and it needs no road.

1. Car on, Bluetooth connected, start an ordinary drill. Let it ask 3–4 questions
   so the log has `route hardware-rate` pairs from the good state.
2. **Do exactly what broke it:** leave the app, change the volume the way you did
   (Settings, or the side buttons), come back.
3. Keep drilling for at least a minute. The probe now spends a reading at most
   once per 30s, so the reading after your return takes up to 30s to land —
   quitting straight away loses it.

| Line | What each answer means |
|---|---|
| `route hardware-rate rate=48000` before, `rate=16000` or `8000` after | The output moved to the earpiece / HFP path, and we have the moment it happened. This is the reading the last run could not produce. |
| `rate=48000` on both sides | The route did **not** move, and the quiet is a volume level, not a route — a completely different fix. |
| `state=budget-spent` | The instrument ran out again. It should not at 120 readings; if it does, say so and the budget is wrong. |

### 3B — the ~20s of deafness on the first drill after a connect. Driving.

Fixed in `d720b9e`, unverified. It only shows up on a **fresh connect**, so:

1. Start with Bluetooth off or the car off. Connect it.
2. Start a drill **immediately** — within a few seconds, while the inputs are
   still settling. That is the window that used to go deaf.
3. Answer normally for a minute.

| Line | What each answer means |
|---|---|
| `voice session-end excused=true sinceDeviceChangeMs=…` with `restartInMs=250` | The fix is working: the route flip no longer counts against the backoff. |
| `restartInMs` climbing 500 → 1000 → … → 8000 with no `excused` | The failures are landing more than 3s after the device change, so `DEVICE_SETTLE_MS` is too short. The numbers in the log say by how much. |
| No `session-error` at all in the first 20s | Better still — and then the deafness was never the backoff. |
| `excused=true` on a long run of failures | The car is flapping. Expect the bound to kick in after 8 and the backoff to resume. |

Subjective half, worth as much as the log: **does it hear you in the first 20
seconds now?**

### 3C — the Bluetooth A/B, controlled this time. Driving.

The 60% → 84% above is real but confounded: the Bluetooth-on stretch also had
three backgrounded clock stalls and a permission error, so some of those prompts
may never have reached you. Use the kit, which says the same words both ways:

1. **Words at speed → Bluetooth on**, same road, phone in the cradle, **screen on
   and the app in front the whole time** (backgrounding is what confounded it).
2. Turn Bluetooth off, repeat on the same stretch.

Read `kit-calibrate-summary oneWord=n/10 twoWord=n/10` from each. Two runs of the
same twenty words, nothing backgrounded, is a number worth building on.

### 3D — the spectrum probe, if 3A leaves a spare minute. Parked.

`mic spectrum` has never returned a real measurement: every reading so far was
`peakDbfs=-120`, which is the silence sentinel, from a probe borrowing a
suspended `AudioContext`. It now starts its own. Count 1→10 out loud in the
listening step and expect **either** a real `peakDbfs` **or**
`error=context-suspended contextState=…`. Both are informative; a third
`-120` would mean the fix missed.

---

## Not in the kit, and still open

- **The `chromium-audio` e2e flake.** Two full suite runs each failed a different test in that project (`drill-layout.spec.ts:197` + `table-seats.spec.ts:117`, then `clip-playback.spec.ts:221`); each passes in isolation. It is the only project using real `speechSynthesis`, with `workers: 1, retries: 0`, so the likeliest cause is state leaking between specs rather than anything in the app. Not chased — it has never pointed at a real defect.
- **The dead "Switch" output-route option.** Nothing reads it; it offers the operator a choice that does nothing.

## Already settled — do not re-measure

- **Confidence cannot gate anything.** Wrong readings scored 0.862 and 0.868; correct ones 0.105 and 0.057. The distributions are inverted. Nothing gates on it, which is correct.
- **`applyBias` is a silent no-op on iOS 18.7.** It needs `globalThis.SpeechRecognitionPhrase`, which Safari does not ship. Changing `biasPhrases` would do nothing.
- **Opening the mic does not categorically steal the car.** Parked, 6 of 6 reached the car speakers with the mic open.

## Do not "fix"

- **Last-recognisable matching for commands.** Jack: *"Leave it on last recognizable for commands so I can change my mind mid sentence."* `"Double split" → split` is the feature working.
- **A mic-close architecture for playback.** `micSessionCost.ts` records the 2026-10-03 car answer: turning voice off did not restore the loud speaker. A2 above is what would license building it, and nothing else.

---

## Exporting

Settings → Diagnostic log → Copy. A kit copy is scoped to the run and says so in
its own header:

```
# SCOPED: only the lines since <mark> — this is NOT the whole log.
# The rest is in Settings → Diagnostic log → Copy.
```

If that header is missing from a kit copy, the paste is the whole log and the
first page is some earlier session.

**The log is not committable.** It carries in-cabin speech, Bluetooth device
labels, profile stakes and bankroll, and timestamps showing when and how long the
car was driven; this repo is public. `field-logs/` is gitignored for exactly this
reason — paste into a file there, never into `docs/`.
