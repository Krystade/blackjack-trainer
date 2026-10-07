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

## Not in the kit, and still open

- **The ~20s deafness on the first mic open after a device change.** `voiceControl.ts` logs `sinceDeviceChangeMs` and then acts on nothing, so `restartDelayFor` escalates 250 → 500 → 1000 → 2000 → 4000 → 8000 ≈ 16 s after a device-change burst. To see it, start a drill *immediately* after the car connects and read the two lines together: `voice session-error error=audio-capture sinceDeviceChangeMs=…` (the field is omitted entirely when nothing changed) followed by `voice session-end failedStreak=… restartInMs=…` with `restartInMs` climbing to 8000. Fixing it means not counting a failure that lands right after a device change against `failedStreak`.

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
