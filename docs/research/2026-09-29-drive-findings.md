# The drive of 2026-09-29 — what the first real field data said

The first field data the protocol ever produced, and the first evening it was
used to drive fixes. Three sessions in the car, one complete leg, two builds.

**A note on evidence.** This repository is public and the exported logs are
not: they carry in-cabin speech, Bluetooth device ids and labels, the phone's
OS version, profile names with stakes and bankroll, and timestamps showing
when and for how long the car was being driven. Nothing below quotes those.
Times are session-relative or expressed as deltas, and the raw exports are
archived off-repo.

---

## 1. What was run

| run | build | condition | steps | outcome |
| --- | --- | --- | --- | --- |
| `r4ohm5` | `1945cb40d565` | car, parked | 31 stamped | the 09-27 baseline |
| `ulq6vs` | `2f23e227e82d` | car, parked | **32 of 32** | the complete leg |
| — | `2f23e227e82d` | car → freeway | 0 | set up, never run |
| `yvjxzk` | `5fb248307ba7` | car, parked | 3 stamped | targeted re-test of one fix |
| — | `5fb248307ba7` | button tester | — | the test that broke the wheel case open |
| `vfktl7` | `5fb248307ba7` | phone, parked | 0 stamped, 25 skipped | **the run that falsified 3.1** |

---

## 2. Answered, and not worth asking again

### Clips reach the car speakers

`route-1/2/3`, `route-short`, `route-long` all `route-car` on a Bluetooth
path, both on 09-27 and in `ulq6vs`. Settled.

### The wheel reaches the app, and the mapping is known

In `ulq6vs`, **nine arrivals** before the microphone opened, `probed=true
focusPlaying=true`, and `wheel-car-quiet` every time.

Established: **at least one press reaches the app**, including in the silence
between prompts (`wheel-gap`), and the car did not visibly act on one.

NOT established, and an earlier draft of this document claimed it —
`pressIndex` is incremented inside the arrival probe
(`FieldTest.tsx:2106`), so "nine presses, nine arrivals" was nine arrivals
counted twice. There is no denominator anywhere: a press that never arrives
writes no row, and `WHEEL_RESPONSES` has no option meaning "I never
pressed". So a wheel that drops a third of presses and one that drops none
produce identical output on every single-press step. A 30% dropper is not a
product, and this protocol cannot see one.

The mapping (skip-forward → `nexttrack`, skip-back → `previoustrack`) is an
inference from the operator pressing the button an instruction named, not a
measurement. `wheel-other` says "skip-BACK, OR an info or display button",
so a `previoustrack` there is ambiguous, and no `seekforward`/`seekbackward`
was ever observed. The button tester speaks the name of each arriving action
and is the instrument that would settle it without relying on compliance;
one pass over every wheel control would do it.

### The app answers the wheel with the screen off and the app in the background

New in `vfktl7`. Presses arrived and were acted on at 1:07.9 and 1:09.5 while
`life visibility state=hidden`, after `wake lost stillWanted=true` — so the
OS had taken the wake lock back and the page was not foreground. TTS spoke on
both. This is a core eyes-free requirement and it holds on the phone path.

Also settled there: **skip-back repeats the last line** when no drill screen
claims the press (`handled=true by=repeat-last`), four times in a row. "Say
that again" works from the wheel.

And the counterpart, which confirms §6.1 from the field rather than from
source: all three `seekforward` presses wrote
`handled=false why=no-screen-listening`. **During a field test a forward
press reaches nobody at all.** The field test screen registers no wheel
command handler, so half the wheel is inert for the whole protocol.

### Locking the phone does not freeze the page

`classification=normal`, hidden 77.5s, 27 ticks, `maxGapMs=3001` against a
2000ms cadence.

`normal` is a threshold artifact and should not be read as reassurance.
`classifyLockProbe` returns it whenever `maxGapMs <= tickMs * 2.5`, before
any throttle test runs. 27 ticks in 77.5s is a mean interval of ~2.9s, so
**every gap was over cadence and none was over the bound** — sustained 50%
throttling that the classifier has no verdict for, while `normal`'s own
docstring promises "the page kept its cadence". One lock, 77.5s, parked,
with charging state and Low Power Mode unrecorded. iOS suspends a web
process progressively, so 77.5s is the easy case and a drive is not.

### The microphone hears the operator, parked

`mic-heard` recognised a one-word answer first try, `heard-right`. One
word, once, engine idling — and **which microphone heard it was not
recorded**, because `probeInput` sits on `wheel-with-mic`, the step AFTER.
§4.4 shows the phone hands the app a different input run to run, so the one
success may have been through the phone's own microphone, which is not the
drive condition. Calling this settled contradicts §4.4; it is one data
point.

### The output route recovers fast after the microphone closes

`route-after-mic` samples at `msSinceAppLetGo` 1634 / 5217 / 8830 and
20658 / 24430 / 27622, all `route-car`. **The route is back by 1.6s.**

An earlier draft went on to say "there is no curve to measure". That
overreaches: nothing sampled 0–1600ms, and it cannot — `HFP_SETTLE_MS` is
1500 and the clock's zero is a React re-render (`appLetGoAfterMs=101` is how
long React took, not how long the phone took to let go). So 1634ms is the
protocol's FLOOR, not a measurement, and the honest verdict is
**unsampleable by these steps**, not closed. The blind spot matters: it is
exactly the window where the `mic-closed` re-take and re-arm fire, and where
the wheel question lives.

### Opening the microphone scatters the app's audio

With the microphone up, **nothing reached the car**, and live TTS went to
the phone loudspeaker: `tts / mic open` scored
`uniform classes="loud, loud, loud"`, all three `route-loudspeaker`. That
half is solid.

The clip half is softer than an earlier draft claimed. `clip / mic open`
scored `uniform classes="inaudible, inaudible, inaudible"` on three
`route-earpiece` taps — but `routeClass` maps `route-earpiece` and
`route-silent` to the same `inaudible` class under every condition except
`phone`, and the `car` condition's own text TELLS the operator they are one
answer: "the earpiece is inaudible from the cradle, so 'phone earpiece' and
'heard nothing' are one answer in this leg". So "it went to the earpiece" is
a destination read off a button the protocol defines as equivalent to
hearing nothing.

The live alternative is the failure `clips.ts` documents verbatim — a route
that flips to a disconnected A2DP sink makes the element accept `play()` and
stall — i.e. the clips never rendered a sample at all. Different fault,
different fix. **Checkable in the archived export without driving:** read
`speak clip-end reason` and `ms` for `mic-route`, `-2`, `-3`. A `watchdog`
reason, or an `ms` far above the clip length, means nothing ever played.

---

## 3. The two faults found — one fixed, one withdrawn

### 3.1 The wheel dies when the microphone opens — WITHDRAWN 2026-09-29 21:00

**This diagnosis is false and the fix built on it has been backed out.** The
rest of this section is kept because the evidence in it is real and the next
explanation has to account for it; the CONCLUSION is not.

**What falsified it.** Run `vfktl7`, on the already-deployed `5fb2483` —
a build with **no handler re-arm of any kind in it**:

- the microphone opened at 0:35.8, reached `listening`, and closed at 0:37.1;
- twenty-four seconds later, at 1:01.0, a press arrived — `wheel invoke
  action=seekforward probed=false`, reaching the real handler, not a probe;
- six presses arrived in all, and the four `seekbackward` ones each re-spoke
  the line through `handled=true by=repeat-last`;
- **two of them arrived while `life visibility state=hidden` with
  `wake lost`** — screen off, app backgrounded — and TTS still spoke.

The operator then checked it directly: the transport controls worked from the
Control Center swipe-down with the app open, from the home screen, and from
the lock screen. Media-session handler registration is a page-level OS
binding, not a per-route one, so this settles it: **iOS did not drop the
handlers.** `nexttrack`/`previoustrack` were never de-registered, and no
amount of re-arming could have changed the `ulq6vs` outcome.

**What the `ulq6vs` silence was instead.** Two candidates remain, and this
protocol cannot currently separate them:

1. the head unit stops sending AVRCP skip while the hands-free profile is up,
   which is car-side and no app change can fix; or
2. the presses were never made — §6.3, there is no answer meaning "I never
   pressed", so an unpressed step and a vanished press are byte-identical.

**What was backed out:** the forced `initMediaSession` re-arm, its three
tests, the re-arm call on microphone close in `useVoiceControl`, and the
second one at wheel-step open in `FieldTest`. They were a remedy for a
mechanism that does not exist. `5fb2483` itself stays: its `audioFocus`
per-reason policy was wrong independently of this — `paused === false` made
the `play-request` recovery path unreachable — and that reasoning survives.

**The original symptom, for the record.**

**Symptom.** In `ulq6vs`, the last press arrived at run-relative 7:31. The
microphone opened moments later, the head unit sent an unsolicited
`pause probed=false`, and across the remaining nine minutes not one
`nexttrack` or `previoustrack` ever arrived — including on `wheel-with-mic`
and `wheel-after-mic`, two steps the operator pressed on and answered
"the car did nothing else" to. So the presses were not stolen by the radio.
They arrived nowhere.

The answer row records the car's half and the log records the app's half,
crossed afterwards — exactly as `fieldTest.ts` says. Car quiet plus zero
arrivals is the "press vanished entirely" outcome that file names as the most
diagnostic of all.

**First diagnosis, and it was wrong.** The run contained one `focus hold`,
one `focus holding` and **no `focus lapsed` at all**, while fifty later holds
each short-circuited on `!element.paused`. That looked conclusive: the silent
element that holds the car's media slot was reporting `paused === false` for
twelve minutes while the app had plainly lost the wheel, so `paused` was
lying and both recovery paths were gated on it.

That reading produced build `5fb2483` — reasons that may act on a live
element stated per reason, plus one owed retry on the next hold, since the
close is ~1.5s too early (`appLetGoAfterMs=101` against a route that returns
at 1634ms) and `devicechange` is unavailable: it fired twice in `ulq6vs`,
both times while the microphone was OPEN, never on the close.

**It did not work.** In `yvjxzk` both attempts ran and both `play()` calls
resolved — `focus restart why=mic-closed`, then
`focus hold ... restart=true` — and `wheel-after-mic` still recorded zero
arrivals.

**What the premise missed.** `pause` and `play` kept arriving in the dead
page, a minute after that run ended. A Media Session handler cannot fire
unless the app still owns the session, so the slot was never lost.

**The real cause.** Only `nexttrack` and `previoustrack` stop arriving; the
core transport actions keep coming through. iOS drops individual action
handlers when a microphone reconfigures the audio session, and
`initMediaSession` registers once per page load behind a latch, so nothing
ever ran `setActionHandler` again.

**The clue, and it does not settle it.** The operator's own button test
found the wheel working, and its session id shows a **different page load**.
An earlier draft concluded "a reload cured it, and no state inside the car
could explain that". Both halves are unsafe:

- **`pause`/`play` arriving proves nothing about the buttons.** Both are
  car-initiated by this repo's own settled finding. So the evidence is "the
  car sent traffic and the app received it", which shows the app owns the
  session and says nothing about whether the head unit still maps the
  wheel's skip buttons to AVRCP. "The car stopped sending skip while
  hands-free was up" and "iOS dropped the skip handlers" predict an
  identical log.
- **The selectivity argument is circular.** The four surviving actions
  (`play`, `pause`, `stop`, `seekto`) are exactly the ones the car sends by
  itself; the four "dropped" ones (`nexttrack`, `seekforward`,
  `previoustrack`, `seekbackward`) are exactly the ones only a press can
  produce. **No handler was ever shown to survive a press.** The tidy "iOS
  drops individual handlers" story is an artifact of which actions had
  traffic.
- **A reload does change car-side state** — it tears down the media element
  and re-publishes the now-playing session, which the head unit observes.
- **Other things differed** between those two moments: minutes of elapsed
  time (a hands-free link may simply have timed out), a brand-new `Audio`
  element played from a fresh tap gesture rather than one that had been
  looping for twelve minutes, and **no microphone had ever been opened in
  the tester page** — registration recency and absence-of-a-mic are
  perfectly confounded by a reload.
- **The reload may have been an automatic update reload**, which fires only
  on evidence of a different deployed build. If the two exports carry
  different build stamps, the cure is confounded with a build change.

**A confound never mentioned:** `probeInput` — the only extra
`getUserMedia` in the whole protocol — sits on `wheel-with-mic` and fires at
step open, seconds before the first press that failed to arrive, and the
source concedes it "may restart the recogniser (unverified)". No wheel press
exists between the microphone opening and that capture, so "the recogniser
killed the wheel" and "a second concurrent capture killed the wheel" are
**perfectly confounded in `ulq6vs`**.

**`yvjxzk` had no positive control.** It stamped three steps, and no wheel
press was ever shown to arrive in that page load BEFORE the microphone
opened. So "the fix did not work" and "the wheel never worked in that page
load" are indistinguishable. Every re-test must open with a control press.

**The 30-second observation that would settle the fork, with no car:** after
a microphone session, press next-track on the iPhone's own lock screen. If
it arrives, the handlers were never dropped and this whole diagnosis is
wrong.

**Fix** (`41c98d1`): a closing microphone re-arms the handlers as well as
re-taking the loop. The latch stays for every other caller —
`ensureMediaSessionHandlers` runs from the clips path, so forcing
unconditionally would re-arm eight actions per utterance. A re-arm is marked
in the log, because eight `register` rows appearing mid-run must say whether
they are a first registration or a recovery.

**Not yet confirmed in the car — and the timing is suspect.** The re-arm
rides the recogniser reaching `'off'`, which this codebase measures at
`stoppedAfterMs=110`: before the phone releases the hands-free link, and the
same moment `audioFocus.ts` already classifies as too early for the audio
hold (hence `mayBeTooEarly` and an owed retry). The handler re-arm had no
such retry, so it can be wiped by a teardown that completes ~1.5s later —
and the log would look **identical to success**: eight `register rearm=true`
rows, zero arrivals. A second forced re-arm was therefore added at the open
of every wheel step, which lands seconds after the session settles and
immediately before the press.

Still uncovered, each an audio-session change with no re-arm: the
`probeInput` raw `getUserMedia`; every recogniser session end, which on iOS
goes `listening` to `restarting` and never `off`, so nothing re-arms DURING
a microphone session; and the `denied`, `error` and `unsupported` states.

### 3.2 The drill was read out in a novelty voice

**Symptom.** `voice=Bahh` — an Apple novelty voice that bleats rather than
speaks. Reported from the driver's seat as the voice being "fucked".

**Cause, and it was deterministic.** `pickBestVoice` scores a name and a
language. Every en-US voice on iOS scores identically, so the tie-break
decided every pick — and the tie-break is alphabetical. Three of Apple's
roughly twenty novelty voices were penalised; with `Albert` and `Bad News`
marked down, the next name in the alphabet is `Bahh`. It would have won on
that phone every time no voice was explicitly configured. The same
asynchronous voice list explains a `voice=null` line on 09-27: iOS populates
`getVoices()` late, and an early call scores an empty set.

**First fix** (`41c98d1`): `SpeechSynthesisVoice.default` — the one
quality-adjacent fact the Web Speech API exposes, named in `speech.ts`'s own
header and then never read — breaks the tie, ranked below a premium name and
above a plain one.

**And it was broken, by the fault it was fixing.** Weighting `default` only
helps if some voice reports it, and nothing had ever logged whether that
iPhone does. With no nomination every en-US voice ties again, the alphabet
decides again, and the winner is **`Fred`** — the classic robotic Apple
voice, unlisted because the denylist was built for the NOVELTY voices. The
same fault as `Bahh`, a few letters later, and the second name to walk
through a denylist. Verified on the bench: nominated gives `Samantha`,
nominated-none gives `Fred`.

**Second fix:** a short allowlist of voices platforms ship for actual
speech, ranked under the nomination and under a premium name, so no single
signal carries it. Plus `env voices` at boot, recording `count`, the
nominated name and the en-* list — because both of these bugs lived in a
space nobody could observe.

**Not confirmed in the car.**

---

## 4. Open, with the evidence that exists so far

### 4.1 Live TTS ends `reason=watchdog` instead of `ended`

In `ulq6vs` the first six TTS utterances of the page failed silently — three
`route-1t` attempts, `route-2t`, `route-3t` and the `fallback-audible` second
line, all `reason=watchdog` at ~4.6s for lines that take ~1.1s when they
work. The operator heard nothing from any of them but did hear the
confirmation chime each time. Every TTS utterance from `wheel-back` onward
completed normally.

**Reproduced in `vfktl7`, and it now points at ordinal position.** That run
spoke live TTS five times, all the same sentence, all `voice=Samantha`:

| utterance | outcome |
| --- | --- |
| 1st of the page | `reason=watchdog ms=4615` |
| 2nd | `reason=ended ms=1733` |
| 3rd | `reason=ended ms=1096` |
| 4th | `reason=ended ms=1037` |
| 5th | `reason=ended ms=1083` |

Same text, same voice, same page, same route. **The only variable that moved
is which utterance it was.** This is the cleanest discriminator the protocol
has produced: it rules out the voice, the text and the route by holding all
three constant, and leaves "the first live utterance of a page load fails"
standing — which is what an unsettled `getVoices()` list predicts.

Ruled out:

- **The suspended AudioContext.** It went `running` via the amplify path
  before the `fallback-audible` line, and that line still failed.
- **The voice, now properly.** Not by the `Bahh` correlation, which was
  misread, but by `vfktl7` holding the voice fixed at Samantha across one
  failure and four successes.
- **The voice.** The watchdog lines were Samantha and the `Bahh` lines
  completed normally, so §3.2 is not the cause of this.

**The strongest remaining hypothesis, and an earlier draft threw it away.**
"Ruled out: the voice" was the wrong reading of that correlation. `Bahh`
wins whenever the list is COMPLETE, because every en-US voice ties and the
tie-break is alphabetical. So `voice=Samantha` on the six failures is
evidence the list was **still populating** at those moments, and
`voice=Bahh` from `wheel-back` onward is evidence it had finished.
`resolveVoice` runs per utterance off a live `getVoices()` snapshot and
there is **no `voiceschanged` listener anywhere in the file** — and speaking
against an unsettled voice list is a known Safari silent-failure mode. It is
the same mechanism already invoked for the `voice=null` line on 09-27,
applied one section later.

The "two clip plays and a wheel press in the gap" an earlier draft offered
is coincidence of position, not a mechanism.

**Note the interaction:** weighting the platform default makes the drill
MORE likely to use the one voice ever observed failing silently, while the
list-readiness bug is still unfixed.

**Cheapest observation, bench only:** log `getVoices().length` on each
`tts-start`, then speak six lines immediately after a cold load.
`env voices count` at boot is the first half of that reading and now
ships.

### 4.2 The first second of speech is eaten when the route flips

On `wheel-with-mic` the instruction lost its opening — the operator heard the
tail of the first word onward. `tts-end` reported 1718ms against a 2208ms
deafen window, so it was truncated at the front, not the back.

### 4.3 The car presses pause at us when the microphone opens

An unsolicited `pause probed=false` arrived 143ms after the microphone opened
in `ulq6vs`, and again in `yvjxzk`. It did not stop the clip. Deliberately
not acted on: `pause` also arrives in cases these drives did not
characterise, and a re-take that provokes another `pause` is a loop in the
car rather than on the bench.

### 4.4 Which microphone, and whether the phone's own speaker is a better product

Raised by the operator: playing from the phone speaker would be acceptable —
preferable even — if it allows the phone's microphone instead of the car's,
because the input quality may differ. Never measured.

What the logs show is that the app is already being handed different inputs
run to run without asking: `ulq6vs` selected the iPhone microphone on
`wheel-with-mic` while `yvjxzk` selected the Corolla, and the ambient sample
in `ulq6vs` was taken through the Corolla with `agc=unknown ns=unknown` — the
car's own processing, which the app cannot see.

**One half of the comparison now exists.** `vfktl7` ran the phone condition
with Bluetooth off and sampled through `label="iPhone Microphone"`:
`dbfs=-58.9 peakDbfs=-45.5 band=quiet frames=48`, `agc=unknown ns=unknown`.
That is the phone-microphone parked-quiet floor. The Corolla's parked-quiet
floor from `ulq6vs` is the other half, and neither number means anything on
its own.

This needs road noise to mean anything. Parked in a driveway both microphones
read quiet and the comparison says nothing.

A second unknown it opens is now **closed**: with audio coming out of the
phone and Bluetooth off, transport commands still reached the app and were
acted on (`vfktl7`, six arrivals). The phone-speaker configuration does not
cost the input channel. What is still unknown is whether the CAR's wheel
reaches an app whose audio is on the phone speaker, which is a different
question and needs the car.

### 4.5 Everything about driving

No leg has ever been run in motion. A freeway leg was set up on 09-29 morning
(`condition-changed from=car to=freeway atStep=39 stamped=31`) and never
started. Unmeasured: whether car-speaker audio is intelligible at road noise
and at the volume the app can reach, and whether the microphone hears the
operator at speed through either input.

---

## 5. What this says about the protocol itself

Thirty-two steps in four conditions was the right shape when nothing was
known. After one complete leg much of the matrix re-asks answered questions —
but an earlier draft of this section overstated which, and got the arithmetic
wrong. The corrected count:

**Settled for a Bluetooth path (21 steps):** the eight pre-microphone route
steps are `route-1/2/3`, `route-1t/2t/3t`, `route-short`, `route-long` — not
"ten" — and **only the five CLIP ones are settled**. The five pre-microphone
wheel steps, `lock-probe`, and the six after-microphone route steps complete
the list.

**NOT settled, contrary to that draft:** `route-1t`, `route-2t`, `route-3t`
and `fallback-audible`. Section 4.1 refutes them in this same document — the
first six live-TTS utterances of the page never played, so the operator
answered `route-silent` to all three `t` steps, `routeClass` mapped that to
`inaudible`, and the cell scored `uniform`. **That verdict reads as "live TTS
is inaudible in the car before the microphone" — a routing conclusion — when
the cause was a bench bug.** The cell is not settled; it is actively
misleading in the log, and it is the `before` half of the 2x2 the design rests
on. `fallback-audible`'s comparison line was one of the same six failures, so
whatever was tapped there measured the watchdog, not the gain asymmetry.

**And `phone`'s justification is contested, not removed.** An earlier draft
said the `car` leg separated earpiece from silence, so the two Bluetooth-off
conditions could go. Section 2 now records why that is soft: `routeClass`
collapses the two under `car`, and the condition text tells the operator they
are one answer. Either the operator CAN tell them apart parked in a cradle —
in which case the `car` condition's own `proves` string is wrong — or those
three taps are unattributable. That has to be settled in writing before
`phone` is cut, because cutting it removes the only leg where `routeClass`
returns a real `earpiece`.

---

## 6. Structural defects in the instrument, found 2026-09-29 evening

Five faults that no number of legs would have surfaced, because they are
properties of the protocol rather than of the car. Each verified in source.

### 6.1 A press made during a field test never reaches a drill

`mediaSession.ts` runs `if (probe) probe(action)` and then
`if (!probe) handler()`, and `FieldTest.tsx` arms that probe at the open of
every wheel step. The exclusion is deliberate and right for a mapping probe —
a test press must not also answer a drill question — but it means **the entire
wheel block measures arrival at a probe and never press to action to grade.**
A leg can come back all-green on the wheel while the drill is unanswerable.

This is load-bearing: with voice input falsified for now, the wheel is the
whole input channel, and the protocol has never tested it doing its job.

### 6.2 There is no answer meaning "I could not make out the words"

`ROUTE_ANSWERS` offers destinations plus "Heard nothing" plus "Missed it".
The honest tap for a prompt that came from the car and was unintelligible is
`route-car` — which every analysis reads as a pass. **At road speed a correct
route and an unusable prompt produce the identical row.** Intelligibility is
the central freeway question and it is currently unrecordable. The only
intelligibility question in the protocol, `fallback-audible`, asks about the
unclipped line at raised volume — the one path the product must never use.

### 6.3 There is no answer meaning "I never pressed"

`WHEEL_RESPONSES` is `wheel-car-quiet | wheel-radio | wheel-na | missed`, and
`missed` means "couldn't tell". So an operator who never got a hand to the
wheel taps "the car did nothing else" — true — and produces a record
byte-identical to a press that vanished. This lands directly on the
confirmation of section 3.1: `wheel-after-mic` is its only in-car test, and
zero arrivals reads as "the fix failed" either way.

`mic-heard` already solved this with `heard-not-said`, whose comment reasons
that without it "it never heard me" carried both "the microphone is dead" and
"I never said it", which are opposite diagnoses. That reasoning transfers to
the wheel verbatim.

### 6.4 The adaptive probes are attached to the two cells that came out clean

`routeProbes` is called exactly twice — for `clip / mic before` and
`clip / mic after`. Both scored `uniform`. The four cells with no probe site
include both microphone-open cells, which are the ones that actually
scattered, so a `wandering` verdict there logs `armed:false` and changes
nothing. If any probes survive a cut they belong on the mic-open cells.

### 6.5 The freeway leg punishes a driver for being busy

`missed` yields no class, `classes.length < 2` yields `short`, and `short`
arms four more samples of the same cell. So an operator too busy merging to
answer two of three samples is rewarded with **four more samples of the cell
they just could not answer** — in the one leg where that is most likely. This
will fire on the freeway leg as written.

### 6.6 Implementation hazard for whoever performs the cut

A cell is scored on the way out of its LAST step. Deleting the last step of a
cell silently disables that cell's verdict and its probes — no error, no test
failure that names it, just a `route-block` row that stops appearing. The
existing tests pin the probe count at 8, so a partial cut fails there rather
than where the damage is.

What remains open is short and sharp, and splits cleanly by whether it needs
the road:

- **Parked:** does the wheel survive a microphone session now (§3.1), and can
  it survive one being open at all.
- **Driving:** audio intelligibility at speed, microphone accuracy at speed,
  and the car-versus-phone input comparison (§4.4), which is meaningless
  without road noise.
- **Bench, not field:** the TTS watchdog (§4.1) and the clipped opening
  (§4.2).

The instrumentation itself came through well. The round 11–14 work is
confirmed live in the field: `answerByVoice`, `probesOnPath`, `why=step-open`
on `mic-settled`, `stateAtArrival` and `sinceAppLetGoAtArrivalMs` on
`mic-stopped`, `focusPlaying` on wheel presses, and four operator notes that
all recorded cleanly. No recovery path from that work fired — and an earlier
draft called that "correct for legs with no interruptions", which is the
absence-of-evidence error again: in `ulq6vs` those paths did not fire
because they were UNREACHABLE, as section 3.1 explains. Non-firing is
evidence about the code, not about the leg.

One instrument weakness worth naming: a press that never arrives leaves no
row, so the count of presses the operator MADE exists only in a note. On
`wheel-repeat` the operator pressed four times against an instruction of two,
and only the note says so.

---

## 7. The replacement protocol, built 2026-09-30

Sections 1-6 describe an instrument that answered its routing questions and
then kept asking them. Three legs of a new protocol replace it. They share the
step array and the runner; a `protocol` field on both the condition and the
step keeps the two sets apart, and `onPath` drops a step whose protocol does
not match the leg, both defaulting to `routing` so nothing above changed.

Operator card: `docs/2026-10-01-drive-card.md`. The old card is marked
superseded and kept for the routing legs, which are still in the app.

### 7.1 Why the drill was never actually tested

`mediaSession.ts` runs `if (probe) probe(action)` and then `if (!probe)
handler()`. The exclusion is deliberate -- a diagnostic press must not also
answer a real drill question -- and every routing wheel step arms a probe. So
**press-to-action-to-audible-response, which is the entire product, had never
run in the car or in the suite.** A leg could come back green on the wheel
while the drill was unanswerable, and in `vfktl7` one did: every `seekforward`
press wrote `handled=false why=no-screen-listening` while every `seekbackward`
was handled, because `back` falls through to `repeatLast` when no screen claims
it. **A protocol that tested one direction would have read as a pass.**

### 7.2 Echo-back, not real drills

The drill steps do not host graded questions. `gradeQuizAnswer` and
`gradeFlashcardAnswer` persist to Stats and advance the spaced-repetition
deck, so a field test that used them would pollute the real training history
with a diagnostic session -- and the damage would be invisible, because a
polluted deck looks exactly like a studied one.

Instead each wheel step registers through `setWheelCommandHandler` -- the
production path, no probe -- and the app **says back the word it took the
press to mean**. The operator reports whether that matched intent. The press
therefore travels the whole production route and produces an audible result,
which is what was never observed, and nothing is written to Stats.

### 7.3 Forced choice, because a self-report cannot fail

The old intelligibility question was "could you make out the words", asked of
somebody who has already heard the line and knows what it said. **It collects
a pass whatever happens in the cabin.**

The four `DISCRIMINATE_LINES` differ only in the decision word -- hit, stand,
double, split, all against dealer nine. A step draws one at random, logs
`word-spoken` with what it drew, and offers the four words as buttons. A wrong
tap is hard evidence that the word did not survive the road, and three samples
per leg make the result a rate rather than an anecdote.

Two properties of the scoring matter:

- **A decline carries no score.** "Heard it, could not make out the word" is
  the honest answer when the road wins. Scoring it wrong would inflate the
  error rate with the operator's honesty; scoring it right would hide the
  failure. `wasAGuess` is derived from whether the response is one of the four
  words, so a decline is stamped with no `correct=` at all.
- **The oracle is bounded at both ends.** Two versions of the e2e assertion
  were wrong and both passed sometimes, which is the only reason they survived:
  `echo-forward` speaks one of the four lines two steps earlier, so an oracle
  reading the first match agreed with the draw one time in four, and one
  polling for mere existence resolved 1.5s before the step under test spoke.

### 7.4 What each leg is for

| Leg | Bluetooth | Steps | The question it settles |
|-----|-----------|-------|-------------------------|
| `drill-parked` | on | 10 | Does any of it work with the road removed |
| `drill-freeway` | on | 10 | The whole point: usable at speed |
| `drill-phone` | **off** | 7 | Is the head unit the problem, or the speech |

`drill-phone` drops `echo-forward`, `echo-back` and `echo-after-voice` by
construction, not by choice: iOS gives a web app no way to hold AVRCP while
routing audio to the local speaker, so there is no wheel to press. Asking for
one is the mistake the routing protocol made with six steps.

### 7.5 The step that separates the two surviving candidates

`echo-after-voice` re-asks the question section 3.1 got wrong. In `ulq6vs` no
wheel press arrived for nine minutes after the microphone first opened; the
conclusion -- that iOS drops the skip handlers -- was falsified by `vfktl7`
and by the transport controls working from the lock screen. Two candidates
remain: **the head unit withholds AVRCP skip while HFP is up**, or **the
presses were never made**.

The old step could not tell them apart. This one can, for two reasons: the
echo is audible, so a press that arrives proves itself, and `wheel-not-pressed`
("I never pressed -- no chance") is on the response stack, so a press that was
never made says so. `awaitSilent` holds the step until the recogniser is
genuinely down, because `setVoiceOn(false)` only requests the end of a session
and the phone tears the link down some time afterwards.

`echo-forward` is the leg's positive control and is first for the reason
`yvjxzk` demonstrated: with no earlier evidence that a press ever worked in
that page load, "the fix failed" and "the wheel never worked here" are
indistinguishable and the run cannot be read at all. Nothing before it has
opened a microphone. **An echo that fails there means the leg is measuring
nothing and should be restarted, not continued** -- which the card says in
those words.

### 7.6 The one fully automatic measurement

`ambient-sweep` enumerates every `audioinput` the phone offers, measures the
cabin through each for three seconds via `measureWithWebAudio(ms, signal,
deviceId)` with `echoCancellation`, `noiseSuppression` and `autoGainControl`
all false, logs a `sweep-reading` per input, and chimes. It answers the car-mic
versus phone-mic question under identical road noise, which no pair of separate
legs could -- two legs are two noise environments.

It is last on purpose: it opens a microphone, and an open microphone is the one
variable every echo step above it is holding still.

### 7.7 Two defects the new tests caught before the car

- **`startFieldTestRun` hardcoded `stepIndex: 0`**, which is `route-1`. Picking
  a drill leg and tapping Start opened the routing protocol -- the operator is
  handed questions that are already settled and the leg's first measurement is
  never reached. Now `snapToPath(0, { condition })`.
- **The word buttons were modelled as `kind: 'route'`**, which declares a
  routing question and obliges the step to produce `say`. An existing test
  caught it. A neutral `kind: 'choice'` was added instead, deliberately
  plainer than `.fieldtest-route`: colouring a word button good or bad would
  announce the answer before the tap.

Five mutations of the drill data and `onPath` were injected and all five were
caught.

### 7.8 What the step is for, on the step

The leg's `proves` is rendered on the gate, which is read once, parked, before
twenty minutes of driving. Ten steps then follow with no reminder of what any
of them measures, and "why am I doing this one" is the thought that turns an
honest `Missed it` into a plausible-looking guess.

So each drill step declares a `purpose`: one short line under the instruction,
printed and never spoken. Never spoken because the discrimination steps
measure whether one specific sentence survives road noise, and prefixing that
sample with a clause about the experiment changes the thing being measured.

### 7.9 Three instrument defects found while building it, all of the same family

Every one is a window that was not closed at both ends. They are recorded
together because the shape is the point.

**A test that could not fail.** `the instruction can be heard on a step that
already speaks a line` asserted that asking for the instruction does not
re-speak the measured sample -- by reading the speech log in a single snapshot
taken the instant the instruction appeared. A re-spoken sample cannot have
arrived by then: `say` on a `measured` step waits out `PRE_SAMPLE_SETTLE_MS`
first. Injecting a `say('asked')` into the button's own handler left the test
green. **An absence is only as strong as the time it was watched for**, so the
window is now held open past the settle the sample would have to come through.

**A test that failed for a reason that was not true.** The same test cleared
the speech log as soon as the read-step button enabled -- which happens
*before* the step's own line is spoken. On a loaded machine the step's first
sample landed after the clear and was attributed to the click. It failed
exactly that way in the full-suite run of 2026-09-30 and passed 7/7 on an idle
one. The clear now waits for the step's own line first.

**A test that passed while the feature was invisible.** The `purpose` line
shipped in its first draft inside `.fieldtest-head`, a `max-height: 130px;
overflow-y: auto` panel. On a 375x812 screen the head ends at y=258 and the
line rendered at y=264. It was in the DOM, `innerText` returned it, and
Playwright's `toBeVisible()` reported it visible -- because `toBeVisible`
checks for a box and for `display`/`visibility`, and says nothing about an
ancestor having clipped the element out of sight. `toBeInViewport()` would
have passed too: the element was inside the viewport, just outside its own
container. **A screenshot caught it; no assertion did.** The spec now walks
every clipping ancestor and requires the element to be inside all of them,
and the line lives in the slack above the evidence region, where the head's
130px cap cannot reach it.

The head is where it could not go for a documented reason: it is deliberately
the first thing on the screen to give way, and already drops its own "Set for
you" line below 719px of viewport. The purpose line is dropped there too, in
the same media query and for the same reason -- it is context rather than the
ask, and it is never worth an answer button the operator cannot reach.

