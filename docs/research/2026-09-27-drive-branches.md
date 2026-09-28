# What the next drive can come back with, and what each answer means

**Planning only.** Nothing in this document is built. It ranks the ten most likely
outcomes of the next in-car field-test leg and plans each one to the file, so that when
the export is read in the car park the work is already decided rather than discovered.

The ranking is by my estimate of prior probability, grounded in the three drives on record
(2026-09-11, -19, -23). The per-branch plans were produced by ten independent planners
against the codebase at `3987662` and reconciled here; where two disagreed, the code was
checked and the disagreement is recorded in §12.

**Reading this after 2026-09-28.** Line numbers cite the code at `3987662` and have
drifted; use the symbol names. The "As built" notes and the gate rewrites below were
added after the 2026-09-28 review (`2026-09-28-review.md`), which supersedes any gate
here that it contradicts.

The three questions the drive answers are independent in what they gate:

| question | outcomes | gates |
|---|---|---|
| Does opening the microphone move the output route? | no-move · transient · permanent · wandering | the spoken-answer channel; the drills' voice/wheel exclusivity; the whole car-controls model |
| Does the steering wheel reach the app, and only the app? | clean · talking-only · shared · dead | car controls (open since the first drive); the two-button mapping |
| Does the page keep executing with the screen locked? | normal · throttled · frozen | the live link (steps 3–4 of `2026-09-27-live-field-test-link.md`) |

That is 4 × 4 × 3 = 48 cells, but only the three decisions above and two interaction
cells (§11) are distinct plans.

---

## 0. Before the drive: four things that are true on every branch

These fell out of the branch planning and are not branch-dependent. Each one, left
unbuilt, makes the drive unable to answer a question it is supposed to answer. **Build
these first.**

### 0.1 The spoken-answer switch, as shipped, voids the baseline

`FieldTest.tsx:1728` — `enabled: voiceWanted || answerByVoice`. With the switch on, the
recogniser is mounted on **every** step from `route-1` onward, not only when an answer is
spoken. Consequences, all confirmed in code:

- The "before the microphone" cells (`route-1/2/3`, `route-1t/2t/3t`) are sampled with the
  mic open. There is no before block.
- The recogniser's own restarts on voice-off steps are written as closes
  (`FieldTest.tsx:1858`), giving the before cells a false `msSinceAppLetGo` and making
  every `awaitSilent` gate on the after block log `mic-still-live`.
- Every wheel step after the first spoken answer runs on the hands-free profile.
- A tapped answer carries no `mic=` field (`FieldTest.tsx:2083`), so from the stamps alone
  a voided leg looks like a clean one. Only the `answer-by-voice on=true` row
  (`fieldTestRun.ts:548`) reveals it.

Three of the four route planners independently reached the same fix: **restrict the
channel to steps that already declare `setup.voice === true`.** Add a pure
`fieldTestMicWanted(index, answerByVoice)` to `fieldTest.ts` returning
`resolveFieldTestSetup(index).voice === true`, use it at line 1728. The switch then means
"accept spoken answers where the mic is open anyway", `mic: 'answer-channel'` can no longer
occur, and no operator action can void a leg.

**The cost, stated plainly:** only 8 of 31 steps declare `voice: true` (`mic-route` ×6,
`mic-heard`, `wheel-with-mic`). The channel goes from 31 steps to 8. On the other 23 the
glance is the price of the measurement — every one of them is `voice: false` for a reason
that a spoken answer would destroy — and no design removes it. If a fully-spoken run is
wanted for learning the protocol, that is a separate non-measuring leg type whose export is
marked untrusted, not a mode of the measured run.

Tests that fail first: for every index before the first `voice: true` step,
`fieldTestMicWanted(i, true) === false` — kills the current `|| answerByVoice`. The existing
e2e at `field-test-voice.spec.ts:184` (spoken `route-car` on `route-1`, `mic=answer-channel`)
fails by design and must be retargeted to `mic-route`. Rewrite the gate copy at
`FieldTest.tsx:559–564`, which currently promises the switch "opens one".

### 0.2 The lock question cannot be answered from the log that exists

I told the operator earlier that "if nothing is timestamped inside the locked window, iOS
froze the page". That is not discriminating. The only periodic row in the app is
`mic heartbeat` (`useVoiceControl.ts:287–294`, `HEARTBEAT_MS = 30_000`), and it is gated on
`enabled` (`:176`) — it exists only on the 8 mic-open steps. On a voice-off step that has
finished speaking and is waiting for an answer, **the app runs no timer at all**: a frozen
page and an idle page produce identical logs. Safari also has no `freeze`/`resume` events
(`environment.ts:194–196`), so the pattern in the rows is the only signal.

Build: a self-scoring lock probe as a `FIELD_TEST_STEPS` entry (not a `carCheckCatalog`
check — those are bounded and have no persisted-across-reload story; `fieldTestRun.ts`
already solves that). On arrival it speaks "Lock the phone now, wait at least thirty
seconds, then unlock", persists a marker `{probeId, startedAtIso, startedAtMs, sessionId}`,
runs a `diag('test','lock-probe-tick',{n})` interval at ~2 s, and on
`visibilitychange → visible` diffs the tick gaps and stamps
`lock-probe-result {classification, hiddenMs, ticksSeen, expected, maxGapMs}`.
Classification from `ms` (monotonic, `diagnosticLog.ts:195`): gaps ≤ 1.5× interval →
`normal`; several gaps of 3–10× inside the window → `throttled`; zero ticks inside the
window → `frozen`; a new `session` id with the marker still persisted → `frozen-unloaded`,
stamped retroactively on the next boot.

**It must not end on a timer** — its timers are the thing under test. It ends on the
`visible` transition, or on the next boot finding the stale marker, or on a Skip. A bare
timeout would score "operator never locked it" as normal.

Cost: ~180 rows on a 15-minute drive against `MAX_ENTRIES = 3000`. Run once per page
session, not per leg — the behaviour is a property of the event loop, not of a step.

**As built (2026-09-28, after review):** the marker is `{hiddenAt, session}` and is set when
the page goes hidden, not on arrival; the verdict is on the largest gap (`maxGapMs`), not the
tick count — one overdue callback on resume is `frozen`; tick rows only while hidden. The step
runs on every leg (it is a step), before `free`. See `docs/research/2026-09-28-review.md`.

### 0.3 The one machine-readable signature of the profile flip is logged at the wrong moment

The car's hands-free unit becoming the **input device** is the only thing a web page can
observe about the Bluetooth profile (`environment.ts:152–154`: "iPhone Microphone versus
the car's own hands-free unit is exactly the flip being hunted"). Today:

- `logAudioInputs('listen-on')` fires when the recogniser is *mounted*
  (`useVoiceControl.ts:180`), before `session-start`, and calls `enumerateDevices`, which
  lists inputs that *exist*, not the one *in use*.
- The only row naming the input actually in use is `ambient-input` `track.label`
  (`carCheckCatalog.ts:261`) — taken on `ambient`, which is pinned last.

Build: log `route input-selected {label, deviceId}` at `mic-settled`, read from the live
track. One row. It turns "the mic reached `listening`" into "the mic reached `listening`
*on the car's unit*", which is what the no-move branch (§10) needs to be distinguishable
from "the recogniser ran on the phone's own mic while A2DP stayed up".

**As built (2026-09-27):** on `wheel-with-mic` only (`probeInput: true`), the last
microphone-open step. Not on every gated step: reading the label costs a second
`getUserMedia` call while the recogniser holds the first, and a second stream opened on a
`mic-route*` step would itself be a candidate cause of the route move those steps are
sampling. `wheel-with-mic` sits after all six of them, so the read lands with the profile
already whatever the block found it to be.

Test: the row appears *after* `session-start` in event order — kills logging at `listen-on`
time, which is today's defect.

### 0.4 The 2026-09-19 fix is shipped behind a test that cannot fail

`audioFocus.ts` emits `focus lapsed` when the silent element's `onpause`/`onended` fires
outside a deliberate release (`:159`, `:162`) — that row is the only evidence that the
"buttons worked only when the bot was talking" fault has recurred. `audioFocus.test.ts` has
18 tests; none references `onpause`, `onended` or `lapsed`. The fake element never pauses
on its own, so every test there proves only that `play()` was called.

Build: a fake `Audio` whose `play()` pauses every other live fake (the single-player rule
the branch-6 planner suspects iOS enforces — labelled speculation, but it is the hypothesis
the test has to be able to confirm or refute). Run `speakAsync` in clips mode, end the
clip, assert the silent element has `paused === false` afterwards and that a `focus lapsed`
row was written. Kills "remove the post-clip reassert" and "delete the `onpause` handler".
Chromium e2e cannot reproduce this; only the unit fake can.

---

## 1. LOCK: runs normally — ~55%

**Signature.** `life visibility hidden` → probe ticks at steady ~2 s cadence for the whole
window → `life visibility visible`. No `freeze`/`resume` (Chrome-only). `wake lost`
(`wakeLock.ts:52`) near `hidden` — its absence is an anomaly.

**In-drive.** Fully — §0.2 is the detector. Stamps `lock-probe-result classification=normal`.

**Builds** — step 3 of the live-link doc, SSE transport:

- `server/` at repo root, sibling to `src/`, own `package.json` — never under `src/`, which
  is `tsc -b`'d and Vite-bundled for Pages. Two endpoints, each independently checking a
  per-run token in the query string: `GET /events?token=` (SSE), `POST /log?token=`. Serves
  nothing else.
- `src/live/liveClient.ts`, loaded only via a gated `import()` behind
  `new URLSearchParams(location.search).get('live')` so it is its own chunk and never
  fetched without the parameter. Subscribes to `subscribeDiagnostics()`
  (`diagnosticLog.ts:651–656`) and POSTs **every** row — not a curated subset, or the
  poster becomes a second source of truth — batched ~2 s, `fetch(..., {keepalive: true})` so
  `pagehide` can flush the tail. Backoff 2 s → 30 s cap. `diag('net','live-stream-lost')`
  once per drop, `'live-stream-restored'` on recovery. Never blocks `answer()` or
  `goToFieldTestStep`.
- Injected steps: `injected?: FieldTestStep[]` on `FieldTestRun`, validated in `coerce` like
  `before`, and `effectiveFieldTestSteps(run)` used everywhere position is read.
  `clampToRun` (`fieldTestRun.ts:202–204`) hardcodes `FIELD_TEST_STEPS.length` and must use
  the effective length or an injected step is unreachable. Land the field unused in step 3
  so step 4 is additive.

**Tests that fail first.** No `?live=` → Playwright asserts zero requests to the live chunk
or any localhost/tunnel origin (kills an eager top-level import). Dropped stream →
simulate `EventSource.onerror`, assert a tap still advances (kills an `await` on a command).
Nothing only in the stream → every POSTed payload already exists in `readDiagnosticLog()`.
Token enforced on *both* endpoints, tested separately. Injected step reachable through the
extended `clampToRun`.

**Rules out.** The polling fallback. Leaves §7 of the live-link doc untouched.

**Next drive.** Page liveness is necessary, not sufficient — Safari can throttle a timer
and independently tear down a held-open connection (speculation, labelled). The first
`?live=` drive opens a real `EventSource`, locks, and reads `live-stream-lost/restored`
against the `life visibility` rows. Fallback is §5's polling.

**When the tunnel becomes necessary.** Not for building or unit-testing any of this
(`localhost` suffices). Only the first time a real phone off-network has to reach the
Windows box — and per §3a of the design, only with explicit go-ahead each time, because the
URL is public while it lives.

**Confounds.** The wake lock is held for the screen's whole life (`FieldTest.tsx:1590`), so
a lock is necessarily a deliberate button press. Low Power Mode and the charger are
invisible to the app — operator logs them by hand. A lock landing in the deferred-by-a-tick
release/reacquire gap between steps behaves like the no-hold case — grep `focus
hold/release` against `hidden`. Gap arithmetic finer than ~1–2 s is meaningless given the
1 s flush buffer.

---

## 2. WHEEL: works cleanly — ~50%

**Signature.** Per wheel step: `wheel invoke action=nexttrack probed=true`
(`mediaSession.ts:184`, written unconditionally before any handler) then
`wheel field-test-arrival step= action= whileSpeaking= pressIndex=`
(`FieldTest.tsx:1672–1699`, `whileSpeaking` read from `speakingRef.current` at the instant of
arrival). Stamp `wheel-car-quiet`; on `wheel-repeat`, `wheel-repeat-done` with
`wheel="nexttrack, nexttrack"`. **No `wheel dispatch` rows** anywhere in the block — the probe
intercepts before the handler (`mediaSession.ts:188–191`); a dispatch row means the probe
was not armed. No unprompted `play`/`pause`/`stop` — their absence is itself evidence the
silent element is holding and the head unit never concluded playback stopped.

Not this branch: any `wheel-radio`/`wheel-radio-took-one`; invokes only under
`whileSpeaking=true` (that is §6); `test wheel-unavailable`; an invoke with no matching
arrival at the same `pressIndex`.

**In-drive.** Receipt is already machine-visible per press. Smallest change: once
`wheelSeen.length > 0`, swap the instruction text to "Received — did the car do anything
else?" and re-label the existing `wheel-car-quiet`/`wheel-radio` pair in place. Same two
slots, same ids, same `kind`, so `WHEEL_SLOTS` (`fieldTest.ts:1411`) and the
learned-position test (`fieldTest.test.ts:1868–1902`) hold. The car's behaviour still needs
the operator; that answer stays.

**Builds.** Close `docs/BACKLOG.md:105–110` — with the drive's export attached, per the
repo's habit. The two-button `yes`/`no` mapping is a **per-screen** decision
(`wheelCommands.ts:20–30`); today `previoustrack` → `back` is glossed as repeat/minus-one,
not "no". Confirming clean delivery is a precondition, not an implementation — flag
separately. Flashcards and the quiz stay un-wheeled: two buttons do not make a five-way
answer two-way. Keep all seven wheel steps as regression guards; `wheel-back` and
`wheel-other` are candidates for trimming after one clean drive per condition.

**Test that fails first.** The conditional instruction text needs a new test asserting the
*rendered* text differs before/after a probe fire — nothing pins `instruction` against
runtime state today, and a prop-level assertion passes while the screen shows stale text.

**Rules out.** Confirms `carControls.ts`'s preconditions rather than retiring them; confirms
`audioFocus.ts` (the absence of the talking-only pattern across `wheel-gap` is that fix's
field confirmation).

**Next drive.** `wheel-with-mic` and `wheel-after-mic` — this branch does not touch them.
That the clean result holds on `freeway`, not only parked.

**Confounds.** Early press on `wheel-gap` — judge by `whileSpeaking` on the arrival row, not
the step id. `wheel-na` under a Bluetooth-off leg is not auto-flagged: `impossible=` covers
route answers only (`fieldTest.ts:1253`) — add the mirror check so `wheel-na` with
Bluetooth on is marked. `legsBefore > 0`.

---

## 3. ROUTE: transient — ~40%

Before = after ≠ during. The mic moves the route; closing it puts it back.

**Signature.** Nine `test answer` rows (`route-1/2/3`, `mic-route*`, `route-after-mic*`) —
six on one destination, three on another. Trust requires: `mic-settled` (never
`mic-never-live`, never `abandoned`) on each `mic-route*`; `mic-stopped wasLive=true` on
`route-after-mic`; `pre-sample-settle` on every ungated sample; `say-end matched=true
path=clip` and `say-start volume=1` on all nine; `msSinceAppLetGo` absent on before/during,
present and rising across after; `run-start legsBefore=0`. `answer-by-voice on=true` is
NOT a kill: since §0.1 the switch only listens on steps whose setup already opens the
microphone, so it is a covariate (`via=voice` on an answer row of a mic-open step) and
nothing more. A `via=voice` on a step whose setup has the microphone OFF is the kill.

Under `car`, `freeway` and `speakerphone`, `route-earpiece` and `route-silent` are one
answer (`fieldTest.ts:365, 375, 392`); only `phone` separates them.

**In-drive.** Known after `route-after-mic-3` (index 24). **Say nothing** — seven route
samples remain and an announcement primes them (`fieldTest.ts:823–829`). Write a silent
`diag('test','crossing', {before, during, after, verdict, trust})` row at that stamp.

**Builds.**

- `src/diag/fieldTestCrossing.ts`: `readRouteCrossing(entries, runId)` returning
  `transient | permanent | no-move | wandering | untrusted` with reasons. Applies the
  per-condition merge; reads destination from `answer=`, not `marks=`; returns `untrusted`
  on any gate failure listed above. **This is one function shared by §3, §4, §7, §10** —
  the four route planners each specified it; it is written once.
- `formatDiagnosticLog` (`diagnosticLog.ts:927`) prints
  `# crossing run=… legsBefore= before= during= after= gates= verdict=` per run.
- §0.1 is this branch's protocol change. No step changes; update the comments at
  `fieldTest.ts:1004–1009` and `1057–1061` with the result.

**Tests that fail first** (one per mutant): a transient table plus `mic-never-live` on
`mic-route-2` → `untrusted` (kills ignoring gate rows). `freeway` during cell
earpiece/silent/earpiece → uniform, same answers under `phone` → wandering (kills
merge-always and merge-never). `route-car` with `marks=route-moved` still counts as car
(kills reading the modifier as destination). `route-after-mic` ≠ before with `-2`/`-3` =
before must **not** be transient (kills a last-answer-only verdict). Export header asserts
the verdict string, not that the line exists.

**Rules out.** Confirms the output-route half of the car-controls model; the wheel half
comes from `wheel-with-mic` vs `wheel-after-mic`. Confirms "microphone OFF" as a real
precondition *and* shows it recoverable, so no route-recovery code is needed. Answers
live-link §5.2 and §7 for the route steps: buttons stay; spoken answers are right for the
8 mic-open steps; the live link buys branching only. Rules out sticky.

**Next drive.** The phone-voice cells (`*t`) must show the same pattern before "the path
does not matter" is claimable. Replication with `legsBefore=0`. Whether the first sample
after `mic-settled` already sits on the new route (`waitedMs` against the answer).

**Confounds.** Gate timing (`mic-never-live`, `wasLive=false`); volume mismatch; a
`route-moved` mark on a during answer (read the destination, flag the mark); a
`clip-failed-to-tts` inside the mic block confounds path with mic; chance — three samples
uniform by chance ≈ 1 in 9 (`fieldTest.ts:576–581`); `answer-ignored`/`answer-blocked`/
`impossible=true`.

---

## 4. ROUTE: permanent — ~35%

Before ≠ during = after. The mic moves the route and closing it does not put it back.

**Signature.** All 18 route rows (clip and TTS cells alike): before `route-car`, during and
after `route-loudspeaker`/`route-earpiece`. If only clip cells or only TTS cells show it,
the route is following the speech path, not the mic. Gates as §3, plus: `mic listen-off
context=field-test:route-after-mic` present; **no** `mic heartbeat`, `heard-text` or
`mic-still-live` inside the after block. What the app cannot see (speculation): whether
WebKit still holds the audio session after `stop()`. Read the branch as "the route stayed
after the app let go".

**In-drive.** Known at `route-after-mic-3`. Log `crossing-verdict verdict=permanent`.
~~Say once, through ordinary step speech: "The sound did not come back to the car."~~ Do
not build the spoken line: it is an announcement that primes the four samples still to
come, which §0.2's silence rule exists to prevent; the row is enough. Carry on
unchanged — the TTS cells and `wheel-after-mic` are still needed and predicted dead. Turn
the start-gate force-quit warning (`FieldTest.tsx:525–531`) from advice into a required
acknowledgement for the next leg. **Never** try to fix the route mid-run.

**Builds.**

- §0.1, mandatory on this branch — one spoken answer anywhere before the route blocks
  poisons the leg.
- A reset probe. `carControls.ts` is pure settings logic and cannot reset anything. The
  silent element is held for the whole run (`FieldTest.tsx:1531`), so a permanent reading
  with no `focus lapsed` already shows that a *continuously playing* media element does not
  restore the route. The testable candidate is a fresh start —
  `releaseAudioFocus('speech')` then `holdAudioFocus('speech')` — testing "a new
  media-element start renegotiates the route" (speculation). Three steps after
  `route-after-mic-3t` and before `ambient`: `route-after-reset`, `-2`, `-3`, with a new
  `setup.resetProbe: 'focus-restart'` applied once on entry, logged as `test reset-probe`,
  `awaitSilent`, same lines. Test: the probe's index sits after the last `route-after-mic*`
  and before `ambient`, and the fold does not carry `resetProbe` into `ambient`.
- Drills outside the field test: push-to-talk (`voiceSession.ts:108–155`,
  `CountDrillView.tsx:1466 enabled: voiceOn || pushToTalkOpen`) assumes the mic's cost is a
  five-second window. On this branch the cost is the rest of the session. Don't change
  behaviour yet; add `micOpenedThisPage()` to `voiceSession.ts` set from `listen-on`
  (`useVoiceControl.ts:178`), not from the toggle, and a `CarControlsBlocker`
  `'mic-opened-this-session'` whose copy says a force-quit is needed. Tests: blocker present
  when the flag is set; the toggle alone does not set it.
- Export header as §3, with fixtures differing by a single row: one `mic-still-live` →
  `mic-never-closed`; after cell `loud,car,loud` → `mixed`; `legsBefore=1` or a pre-mic
  `listen-on` → `contaminated`; `mic-never-live` → `mic-never-opened`.

**Rules out.** BACKLOG car section: "solved by giving up the microphone" becomes a hard
rule; the drills' `talk` wheel mode stops working after the first press. Voice section:
"microphone OFF" becomes "never opened this page". Live-link §7 applies in full. Uniform
cells rule out alternation; clip and TTS agreeing rules out path-tracking.

**Next drive.** Leg 1 on a force-quit page reproduces. The reset probe. Force-quit then leg
2: `route-1/2/3` must say car — the first actual measurement of the reset the gate asserts.
`wheel-after-mic`: dead wheel plus phone audio is a consistent "HFP stuck" picture; a
working wheel with phone audio is a different fault.

**Confounds.** Teardown timing (`mic-still-live`, `abandoned`, `msSinceAppLetGo < 1500`);
`mic-never-live`; the answer channel opened earlier (`listen-on` before `mic-route`); a
second leg on the same page (leg 2's before cells should also say phone — itself a check);
Back reopening the mic (`FieldTest.tsx:1863–1873`, `step-open index=` non-monotonic); a
reload mid-run (`run-resume` plus missing `msSinceAppLetGo`).

---

## 5. LOCK: throttled — ~30%

**Signature.** Probe ticks still landing inside the window but sparse — several gaps of
3–10× the interval, none spanning the whole window — then normal cadence at `visible`.
Distinct from frozen (one gap = the whole window) and normal (≤ 1.5×).

What a held-open connection would experience that a discrete `fetch` would not
(speculation, labelled): iOS is widely reported to suspend or close background sockets
outright rather than slow them; a single throttled wake-up is enough for a `fetch` to fire,
complete and close. A stream degrades in *existence*, a poll in *latency*.

**In-drive.** §0.2. Stamps `throttled`.

**Builds** — step 3 for the polling transport:

- `GET /next?since=<cursor>&token=` — plain poll, **not** long-poll (a held-open request is
  the same live-socket risk this branch rules out). Returns `{commands: [], cursor}`
  immediately, HTTP 200 always.
- **Client cadence tied to the step cadence, not a timer.** Poll on step entry
  (`logFieldTestStep`, `FieldTest.tsx:1471`), on `say-end` (the `sayRun` fence, `:1080`), on
  `visibilitychange → visible`, and on each stamp (`markFieldTestStamped`,
  `fieldTestRun.ts:759`). No `setInterval` exists to be throttled; cadence degrades exactly
  as the operator's interaction rate does.
- `POST /log` batched, fire-and-forget, backoff; new `DiagCategory 'net'` with
  `poll-sent/ok/failed`, `command-received`.
- Command → step via `FIELD_TEST_STEPS.find` and the already-exported `goToFieldTestStep`.
  Injected steps as §1.
- **Latency.** Bounded by whichever trigger fires next: single-digit seconds on an ordinary
  step, tens of seconds on a silent one. Acceptable because §4 of the design says a command
  overrides the *next* step and is never awaited.

**Tests.** As §1, plus: `fetch` always rejecting → steps still advance by tap (kills an
accidental `await`). Each asserts an outcome — index advanced, call count, guard absent —
not that a `diag` row exists.

**Rules out.** SSE as the transport. Keep §3a/§4 in the doc, marked "SSE rejected
2026-09-27, throttled not frozen" — this repo keeps discarded reasoning visible.

**Next drive.** A ten-minute lock, not thirty seconds — whether throttling degrades into a
freeze past some OS budget. That cadence resumes immediately on `visible` with no nudge.

**Confounds.** As §1. Misreading several-gaps-short-of-the-window (this) for
one-gap-the-whole-window (§9) reclassifies evidence onto the wrong side of the fork.

---

## 6. WHEEL: works only while talking — ~25%

The 2026-09-19 fault recurs. `wheel-talking` arrives with `whileSpeaking=true`; `wheel-gap`
logs no invoke before the stamp.

**Signature.** Focus rows, all in `audioFocus.ts`: `hold` (:176), `hold-joined rehold=`
(:124), `holding paused=` (:150), `lapsed paused=true|ended=true` (:159/:162), `refused
why=` (:170), `hold-failed` (:183), `release holders= remaining=` (:200/:204). Plus `wheel
register`, and any unprompted `play`/`pause` — on 2026-09-11 these came ~5 s after each
clip, the head unit deciding playback had stopped (`mediaSession.ts:122–136`).

Three causes, separated by the rows: **the element stopped** — `lapsed`, `refused`, or
`release` without `remaining` between `wheel-gap`'s `clip-end` and the stamp; **the
element played but iOS did not count it** — `holding paused=false`, no lapse, no release,
yet no invoke, with unprompted `play` after `clip-end` pointing this way; **the head unit
took the press** — stamp `wheel-radio` with no invoke. `wheel-car-quiet` with no invoke
means the press simply vanished.

**In-drive.** Yes. On `wheel-gap`, start a timer at `say-end`; if no `field-test-arrival`
within `WHEEL_WAIT_MS` (12 s, `carCheckCatalog.ts:19`), write
`diag('test','wheel-gap-no-arrival', {msSinceSayEnd, focusPlaying, holders})`. Sample
`audioFocusElementIsPlaying()` at `say-end`, +1 s, +3 s — that shows directly whether the
silent element survived the clip. **Reuse the constant, not `wheelPressCheck`**
(`carCheckCatalog.ts:147`): that check calls `setMediaSessionProbe`, a single slot, and
would take over the field test's own probe. On firing: banner, **no speech** — speaking
plays a clip, the clip re-takes focus, and the evidence is gone. Optionally
`holdAudioFocus('speech')` once, log `focus reassert`, ask for one more press: an arrival
then shows that re-playing the element is enough. Stay inside the step; the 31-step list
does not change.

**Diagnosis tree and fixes**, ranked by what the log will show:

- **A. The clip kills the silent element (most likely).** `announceToMediaSession` calls
  `holdAudioFocus` *before* the clip plays (`speech.ts:972–973`); the early return at
  `audioFocus.ts:134` sees a playing element and does nothing. Every clip is a new `Audio`
  (`clips.ts:623`). Speculation: iOS pauses the other element when a clip starts, `lapsed
  paused=true` fires, and nothing re-plays it until the next clip — exactly "worked only
  while talking". Discriminator: `wheel-back` speaks its instruction through live TTS with
  no clip (`FieldTest.tsx:1255, :1952`); if `wheel-back` arrives while `wheel-gap` does not,
  suspect A. Fix: re-assert the hold after the chain settles (the `.then` at
  `speech.ts:977`), and let `onpause` with `held.size > 0` retry `play()` once. Test: §0.4.
- **B. A cleanup releases the hold between steps.** The step cleanup calls `cancelSpeech`
  but does not release (`FieldTest.tsx:1535–1549`); the unmount release is deferred
  (`:1623`); `App.tsx:148–163` exempts `fieldtest`. Row: `focus release` without
  `remaining` between two steps. Test: e2e `wheel-talking → wheel-gap` asserting no
  `focus release` and `speech` still among holders.
- **C. The first hold was refused and never revived.** The retry exists (`:134`) but the
  retries from `speech.ts` run after `await prewarmClips()` (`FieldTest.tsx:1275`), with no
  tap behind them. Row: `refused NotAllowedError` with no later `holding`. Fix: take the
  hold synchronously in the answer-tap handler. Test: a once-refusing fake reached through
  the step effect.
- **D. `playbackState`.** `setPlaybackState('playing')` is called once (`speech.ts:699`) and
  its test asserts only that it does not throw (`mediaSession.test.ts:325–336`). Low
  priority; speculation that the head unit reads it.

**Rules out.** The drills never call `holdAudioFocus` themselves — they inherit it from
`announceToMediaSession` on each clip (`speech.ts:620`) and carry the same defect. The
count drill's wheel entry submits on quiet (`CountDrillView.tsx:1393–1401`), making the gap
the whole interaction — it is the worst affected. Reopen the BACKLOG car section's CLOSED.

**Next drive.** `wheel-gap` arrives with `whileSpeaking=false` and `msSinceSayEnd ≥ 3 s`; no
`focus lapsed` all run; no unprompted `play` after clip ends; `wheel-repeat` shows both
presses; one count-drill session submitting in silence.

**Confounds.** The mic open (§0.1; HFP takes the wheel for a different reason — check for
`heard-*` rows during `wheel-gap`). Early press: `speakingRef` goes true during the
prewarm, before any sound (`FieldTest.tsx:969, :1275`) — judge by arrival time against
`say-end`, not by the stamp. Head-unit idle timeout (speculation; looks like B/C). `wheel-na`
in a Bluetooth condition — add the mirror `impossible=` check.

---

## 7. ROUTE: wandering — ~15%

Samples disagree *within* a block, mic shut throughout. No block comparison is valid. This
has already happened once (2026-09-23) and it is the outcome where in-drive adaptivity
matters most, because the app can see the operator's answers disagree even though it
cannot see the route.

**Signature.** `route-1 route-car`, `route-2 route-loudspeaker`, `route-3 route-car`.
Before calling it genuine: (a) timing — wandering in `route-1/2/3` is immune, no mic has
opened; elsewhere the gate rows must be present; (b) mis-taps — a bounce never stamps
(`answer-ignored`), drop `impossible=true` and `unknown=true`, a step answered twice after
Back keeps both rows (`markFieldTestStamped` only increments, `fieldTestRun.ts:759`) and the
last wins; (c) `route-moved` in `marks=` means movement *within* one utterance — a
different finding; (d) level — `say-start volume=` must be 1 on all three.

**The sharpest finding in this document.** Every cell speaks lines **A, B, A**
(`fieldTest.test.ts:1719–1763`). A route that depends on the *line* — line B's clip file,
say — reads car/phone/car. So does strict alternation. The protocol as it stands **cannot
tell them apart**, and the 2026-09-23 "alternating" report is consistent with either.

**In-drive — the heart of this branch.**

- **The run's `stamps` cannot do the job**: it stores counts, not answers
  (`fieldTestRun.ts:53`), and the log is capped at 3000. Add
  `answers: Record<"<condition>:<stepId>", {id, marks?, via, mic?}[]>` to `FieldTestRun`,
  written beside `markFieldTestStamped`, validated in `coerce`.
- A pure `routeBlockVerdict(stepIds, answers, conditionId)` beside `stepResponses`. The
  cell grouping moves out of the test's local `crossed()` into an exported `routeCells()`,
  so the test and the detector share one definition. Rule: last answer per step; drop
  `missed`/`impossible`/`unknown`; map to classes car / loud / inaudible (earpiece and
  silent merged unless `condition === 'phone'`). Verdicts: `wandering` (≥ 2 valid, > 1
  class), `moved` (any `route-moved`), `short` (< 2 valid — also actionable, the cell answers
  nothing), `uniform`.
- **Fires on leaving the block's last step, not at the second answer.** Acting at stamp 2
  would put steps between `route-2` and `route-3`, breaking A, B, A and failing
  `fieldTest.test.ts:1751`. Fires on Skip too.
- Always writes `diag('test','route-block', {cell, steps, verdict, classes, paths})` —
  uniform blocks included, so one grep returns all six cells. On `wandering`/`moved`/`short`,
  arms a probe; `armedProbes: string[]` persisted on the run.
- **Probes live in the fixed list as dormant steps** (`probe: '<cell>'`); advancing moves
  the pointer to the next non-dormant index via `nextActiveIndex(from, dir)`. `stepIndex`
  stays a plain pointer and `resolveFieldTestSetup` stays a pure function of it. Two probe
  sites, four steps each: after `route-3` (clip, mic shut, before any mic) and after
  `route-after-mic-3` (`awaitSilent`).
- **The probes speak A, A, B, B.** Line-dependent → car car phone phone. Strict toggle →
  x y x y. Random → no structure. That separates the three hypotheses the A, B, A design
  cannot.
- Operator hears: the ordinary chime, settle, and line. **No announcement** — a spoken line
  before a sample can move the session, and "your answers disagreed" primes the next one.
  Operator sees: a neutral title, "A few more of the same (1 of 4)", the same
  `ROUTE_RESPONSES` stack. Nothing added to head, controls or evidence slots; the pixel
  budget holds. "Nothing spoken navigates" holds: a spoken answer still goes only through
  `answer()` and advances exactly one active step.

**Builds.** `probe?: string` on `FieldTestStep` plus eight dormant steps, each declaring a
setup equal to the setup resolved at its position; `routeBlockVerdict`; `answers`,
`armedProbes`, `nextActiveIndex` on the run; the evaluate-on-leave hook in `FieldTest.tsx`.
Progress text (`FieldTest.tsx:2182`) and `steps=` (`fieldTest.ts:1352`) count active steps
only.

**Tests, each paired with a control so neither passes alone.** car/loud/car → wandering
**vs** car/car/car → uniform (kills compare-first-vs-last — first and last agree).
speakerphone loud/car(impossible)/loud → uniform (kills ignore-`impossible`). car/missed/car
→ short, not wandering (kills missed-is-a-class). freeway earpiece/silent/earpiece →
uniform, same under phone → wandering. loud then (Back) car → uniform (kills
first-answer-wins). car ×3 with a `route-moved` mark → moved. `fieldTest.test.ts:1738` fails
first (clip/before would hold 7) — `routeCells()` skips `probe` the way it skips `aux`. New:
`resolveFieldTestSetup` for the step after each probe run equals the step before it (kills a
probe leaking `volume`/`useClips` forward). e2e: car/loud/car on `route-1..3` →
`data-step=route-probe-1`; car/car/car → `route-short`; `field-test-layout.spec.ts:386`
extended to walk the probes.

**Rules out — and does not.** A wandering baseline makes every before/after comparison
unreadable. **The mic question stays unanswered, not answered "no".** A later "uniform car
after mic" is still no evidence the mic is innocent. What the probe *can* rule out is line
dependence, and with it the clip-content hypothesis: if A, A, B, B comes back
car car phone phone, the previous drive's alternation was the protocol's own structure.

**Next drive.** Switch off for at least one leg. `route-block` rows for all six cells.
Probe results at both sites. Whether `phone` (ear) also wanders — if so the car is
exonerated; whether `speakerphone` wanders — if so Bluetooth is out.

**Confounds.** Path rather than route: `paths=` on each row and `clip-failed-to-tts` rows —
if the disagreeing sample is the one that fell back, the operator heard a voice change.
The answer channel (§0.1); the recogniser also restarts on its own — after every
utterance on iOS, every 45 s in any case (`CYCLE_AFTER_MS`), and up to 8 s after an
`audio-capture` error (`MAX_RESTART_DELAY_MS`, `voiceControl.ts`) — so a `mic restarting` row inside a mic-open
block is expected, not a fault. `route devicechange` between samples is a correlate, not proof.
Line B's clip file itself (speculation; the probe is what tests it).

---

## 8. WHEEL: shared — ~15%

The app receives the press **and** the car acts on it too.

**Signature.** `wheel invoke` present and `answer=wheel-radio` (or `wheel-radio-took-one`)
on the same step. Sub-cases by which steps show it: **(a)** every wheel step; **(b)** only
`whileSpeaking=false` steps (`wheel-gap`, `wheel-back`) — the car treats silence as
not-playing and handles the button itself; **(c)** only `wheel-repeat` loses one —
`wheel-radio-took-one` co-occurring with exactly two invokes in that bracket.

Not this branch: two invokes with no radio answer and `pressIndex` +2 (operator pressed
twice); `action=play`/`pause` clusters (the head unit's automatic resume/pause bookkeeping,
registered inert at `mediaSession.ts:213–216`) — filter by `action` before counting.

**In-drive.** Only partly, and the code says so (`fieldTest.ts:284–296, 309–311`): the app
has no channel back from the head unit. An unprompted `play`/`pause` within hundreds of ms
of a registered `nexttrack` is a weak, unvalidated heuristic — `play` arrives on ordinary
clip-end with nobody touching anything. No Web API surfaces AVRCP peer state. **Not a
signature.**

**Builds.** Instrument, don't add: `holdAudioFocus('speech')` is already held for the whole
run (`FieldTest.tsx:1526–1531`) and `focus lapsed` already fires on an OS pause — the gap is
that nothing correlates a `lapsed` timestamp with the `wheel-gap`/`wheel-back` bracket in
the export reading. Test: no `focus lapsed` between two holds under an interruption-free
run (kills collapsing the per-key hold into a per-utterance one). `seekforward`/
`seekbackward` are already aliased to the same handlers (`mediaSession.ts:143–147`) and
`stop` is registered inert — verify, don't build. **The honest option**: accept the double
and choose wheel actions harmless when the car also does them — costs nothing to build; its
cost is analytical, because the drills have no "did the radio also act" prompt.

**Correction to the planner.** `playbackState` **is** set — `setPlaybackState('playing')`
at `speech.ts:699`. The planner's "never touched" claim and its one-line "add it"
recommendation are moot.

**Rules out.** Nothing already closed: the BACKLOG car section answered *arrival*, not
*exclusivity of consumption*. In the drills a doubled press produces exactly one
`wheel dispatch handled=true` — indistinguishable from a clean one, and it silently
over-advances a card or double-counts a "yes". Worse than in the field test, where it is
at least visible.

**Next drive.** Whether (b) comes with `focus lapsed`/`refused` near the brackets (mechanism
found) or with a clean `holding` log (the car double-delivers even while the element
genuinely plays — harder, unmitigated). Whether `wheel-with-mic`/`wheel-after-mic` diverge.
Parked vs `freeway` — a parked-only reproduction is suspicious.

**Confounds.** HFP residue from the previous mic-open step (`HFP_SETTLE_MS`, "nothing in
the browser exposes the HFP release"). `wheel-na` on a Bluetooth-off leg is not "no
doubling observed". `wheel-repeat` analysis gates on `wheel-repeat-done`, never
`wheel-repeat-couldnt`.

---

## 9. LOCK: frozen — ~15%

**Signature.** `hidden`, then **zero** rows of any category, then `visible` / `pageshow` /
a new `session`. Three shapes: **(a)** suspended-then-resumed — same `session`, one large
jump in `ms` and `at`, normal cadence after, no `pagehide`; **(b)** killed-and-reloaded —
new `session` id, `env page-load` re-fires, run comes back `active: false` on the gate's
Resume (`fieldTestRun.ts:301–310`); **(c)** the silent element was not playing at that
moment — `focus lapsed` preceding `hidden`, or no `focus hold` at all inside the run window.

**Why §4's "existing drives produced logs with the screen off" can be true and this still
happen.** The *drills* hold `speech` focus continuously across every utterance. A field-test
step holds it only while `step.wheel` is set or a line is speaking; a step with no `say`,
no `wheel` and a long dwell can sit with the element paused. The old evidence is about the
drill cascade, not the field-test runner. It does not transfer.

**In-drive.** After the fact only. On `visible`, read the tail of `readDiagnosticLog()`,
compare `Date.now() - Date.parse(last.at)` against ~15–20 s (above the ten-second gate
wait), and stamp `lock-probe frozen {gapMs, step}`. Lives in `FieldTest.tsx`, not
`environment.ts` — only the runner knows what step it was on. On resume, **re-speak the
step's line** — the operator cannot know how much they heard — with a distinct
re-orientation: "Still on: `<title>`. Say it again, or tap to continue." Case (b) needs
nothing beyond what Resume already does.

**Builds.**

- **Strike §6 steps 3–4.** No server, no `?live=`, no SSE/polling. Backoff cannot recover a
  connection that never existed on a killed page. §7's caveat becomes the standing
  conclusion. Record under §5 that question 1 resolved negative *for the field-test
  runner's session shape*, with the drill-cascade caveat so nobody reopens the tunnel on
  the strength of an old drill log.
- **A lock-aware dead end.** A step interrupted mid-utterance by a lock has no response
  saying "contaminated by a suspend, not by the condition". Add `{afterLock: true}` on the
  next stamp so the analysis excludes it rather than reading it as ordinary noise. Test: a
  stamp following a detected `lock-probe frozen` carries the flag — kills silently dropping
  it (the `diag()` detail-copy path already drops `undefined` at `diagnosticLog.ts:571`).
- **Branching without a server** — the in-app adaptivity that replaces the live link: §7's
  disagreement detector and §6's wheel-receipt check, both decidable from the run's own
  record. The data-model change is §7's dormant steps and `nextActiveIndex`. `coerce` must
  prune anything it cannot render, the way `prunedStamps` already does for stamps.
- **Working around the lock itself.** The silent element *is* the only keep-alive lever a
  Safari PWA has, and this branch is the proof it is insufficient. The honest answer is a
  gate line: locking the phone during a run invalidates the step in progress; the recovery
  is Resume, not force-quit.

**Rules out.** The tunnel is never needed. The spoken-answer channel becomes the *whole*
eyes-free story.

**Next drive.** Whether the freeze is conditional — silent element mid-play vs known idle,
same drive, back to back (if only idle freezes, the fix is "never let the hold lapse
between steps", not "give up"); Low Power Mode held fixed per drive; a duration ladder
(10 s / 60 s / 5 min) narrated against the log.

**Confounds.** The wake lock is display-only and dropped on hide (`wakeLock.ts:8–11,
48–53`) — a lock is deliberate. `hidden` triggers an explicit flush, so the exposure is
only the window between the OS suspending the thread and `setItem` landing — near zero for
`visibilitychange` (designed to run before teardown), unverified for a hard lock. **App
switch vs lock is indistinguishable in the log** — a phone call would also churn
`route inputs`/`devicechange` — only the operator's account narrows it.

---

## 10. ROUTE: no move — ~10%

All three blocks agree. The founding model is wrong.

**Signature.** All 18 route rows carry the same `answer=`, **and** the middle block is
proven open: `mic-settled` with `waitedMs < 10000` on every `mic-route*`; `mic session-start`
before that step's `say-start` and no `mic listen-off` or `session-end` between that
`say-start` and its `say-end` (the heartbeat is every 30 s, so it cannot "cover" a two-second
line — the session boundaries are what say the microphone was open through it);
`heard-text` on `mic-heard` (the mic was capturing, not just reporting a state);
`mic-stopped wasLive=true` on `route-after-mic` — the FIRST after step only. The later
after steps open with the microphone already closed, so `wasLive=false` there is the
expected reading, not a failed gate. **The kill check** is no longer the switch (see §3):
it is a `via=voice` answer on a step whose setup has the microphone OFF. And §0.3's `input-selected` row must name the car's hands-free unit during the
middle block — without it, "no move" and "the recogniser ran on the phone's own mic while
A2DP stayed up" are the same log.

**In-drive.** Not today (Settings says as much, `Settings.tsx:899–902`). With §0.3, the
input label is direct evidence. A second `getUserMedia` while the recogniser is live, to
read `track.label`, is a second capture — whether iOS allows it alongside recognition is
unknown and it might abort recognition with `audio-capture`. Only safe on mic-open steps.
If reliable, drills could use it at runtime to decide whether wheel and mic can coexist.

**Builds — the audit.** Every place encoding the assumption, with a verdict:

| location | verdict |
|---|---|
| Header comments: `carControls.ts:13–20`, `wheelCommands.ts:8–19`, `wheelNumber.ts:5–6`, `voiceSession.ts:113`, `fieldTestVoice.ts:18`, `voiceControl.ts:170`, `ambientNoise.ts:21`, `carCheck.ts:21–28`, `carCheckCatalog.ts:255`, `types.ts:155–168`, `FieldTest.tsx:95–98, 118, 553–564, 1017–1048` | leave the code; re-document as hypothesis, not fact |
| `HFP_SETTLE_MS` (`FieldTest.tsx:152`) | rename `POST_MIC_SETTLE_MS`; the value is also the sample run-up (`:162`) — keep |
| `voice: false` on wheel steps; tests `fieldTest.test.ts:493`, `:819–834` | keep as a precaution until `wheel-with-mic` also passes |
| `ambient` pinned last; test `:556–570` | keep one more drive |
| force-quit gate (`FieldTest.tsx:525–531`) | relax to advisory; keep `legsBefore` |
| `micProvenance`, switch warning (`:560–563`) | keep recording; drop the "perturbs" claim |
| `describeFieldTestSetup` "microphone OFF" (`fieldTest.ts:1243–1246`) | keep; re-document why shouted |
| Settings copy `Settings.tsx:446–448, 887–891, 932, 952` | relax only after the wheel is confirmed with the mic on |
| Settings "can't use the phone mic" (`:899–906`) | re-verify against the `input-selected` label |
| Drill gates `CountDrillView.tsx:1389`, `TrueCountDrillView.tsx:528`, `Table.tsx:502` | relax so mic and wheel run together once the wheel is confirmed; new test "wheel wired while voice on" |
| two-phase car check (`CarCheckPanel.tsx:38, 84`) | keep |

**Second order — what else explains the earlier observations.** 2026-09-19 is already
explained without the profile: lost now-playing status between clips (`audioFocus.ts:11–16`).
2026-09-23 car-then-phone candidates: the voice path changed (`say-end path=` on the two
utterances; a `clip-failed-to-tts` puts `speechSynthesis` where a clip played, which may
route differently — speculation); the media-focus hold lapsed; iOS ducking while
recognising (`types.ts:165` asserts the car ducks — unverified); genuine alternation (§7);
the known timing confound. 2026-09-11's call screen is not refuted — a call screen with no
audio move points to a hands-free session opened for input only (speculation).

**Rules out / reopens.** "The mic drags playback to the earpiece" (`FieldTest.tsx:96`,
`carCheck.ts:24`). If the wheel also survives: the backlog's "the two can never both work"
(`BACKLOG.md:95, :1231, :1324`) is wrong. Reopened: answer-by-voice is free on every step;
drills could have mic and wheel together instead of the either/or `wheelMode`; the
push-to-talk round-trip cost disappears; a broken wheel's explanation shifts to media
focus and `play` handling.

**Next drive.** Repeat with `legsBefore=0`, switch off, `input-selected` rows present. The
TTS block agrees with the clip block. Phone in the cradle vs a pocket. The operator notes
whether the car display shows a call during `mic-route`. `wheel-with-mic` answered as it
works. Ideally a second car or a Bluetooth speaker.

**Confounds.** The recogniser on the iPhone mic while the car stayed on A2DP — the model is
untested, not refuted; shows as an iPhone-mic label and no `devicechange` near
`session-start`. `mic-never-live` / `mic-still-live`. A `via=voice` answer on a
mic-off step (not the switch itself; §3). `legsBefore>0`. A stalled clip (`clip-end reason=watchdog`, `clip-failed-to-tts`).

---

## 11. The two cells that are not just "pick a branch"

**Wheel dead × route permanent.** No wheel, and voice unusable on any measured run. There
is no eyes-free input left. The premise the app is built on needs rethinking, not a branch.
Wheel-dead (~10%) is §6's escalation: every cause in its tree with no arrival on any wheel
step, both conditions, and `test wheel-unavailable` absent.

**Route no-move × wheel broken.** These contradict each other. `carControls.ts` states the
wheel's preconditions on the theory that an open mic flips Bluetooth to hands-free and
takes the buttons with it. If the mic demonstrably does not move the route, that mechanism
is wrong and a broken wheel needs §6's diagnosis tree with the profile explanation removed
from it. This cell sends the work backwards.

**Any question can come back undetermined.** That is a re-drive on that question alone,
and historically it is the normal case. §0.2, §6's arrival check and §7's disagreement
detector exist so that "undetermined" is caught in the car rather than in the car park.

---

## 12. Where the planners disagreed, and what the code says

- **`playbackState`.** Branch 6 said `setPlaybackState('playing')` is called at
  `speech.ts:699`; branch 8 said `playbackState` is never touched. The code: it is set, once,
  from `speech.ts:699`. Branch 8's recommendation to add it is moot.
- **The crossing verdict.** Branches 3, 4, 7 and 10 each specified a pure function reading
  the route cells. They are one function: `readRouteCrossing` in `fieldTestCrossing.ts`,
  returning `transient | permanent | no-move | wandering | untrusted`. Branch 7's
  `routeBlockVerdict` is its per-cell inner step.
- **What the spoken-answer switch should do.** Branch 3: gate on `measured &&
  !stepWantsVoice`. Branch 4: gate on `resolveFieldTestSetup(i).voice === true`. Branch 10:
  keep recording, drop the "perturbs" claim. Branches 3 and 4 are the same rule; branch 10
  only applies if its own branch comes true. §0.1 takes branch 4's form.
- **`answerByVoice` test coverage.** Branch 4 said no test mentions it. Unit tests: true.
  `e2e/field-test-voice.spec.ts` exercises it end-to-end. The gap is the unit seam
  §0.1 adds.
- **Where the lock probe lives.** Branch 1: a protocol step. Branch 5: `environment.ts`,
  continuous. Branch 9: `FieldTest.tsx`, after the fact. Reconciled in §0.2: a protocol
  step for the deliberate probe (the operator has to be told to lock), with the retroactive
  stale-marker check at boot. Branch 5's unconditional heartbeat is the tick source.

---

## 13. Order of work

| # | what | why first |
|---|---|---|
| 1 | §0.1 — restrict the spoken-answer channel to `voice: true` steps | without it the drive cannot measure the mic at all |
| 2 | §0.2 — the lock probe with its own heartbeat | without it the lock question is unreadable |
| 3 | §0.3 — `input-selected` at `mic-settled` | one row; makes §10 distinguishable from a false negative |
| 4 | §0.4 — the `lapsed` test | the 09-19 fix is unverified by any test that can fail |
| 5 | §6's `wheel-gap-no-arrival` check | catches the most likely wheel fault in the car |
| 6 | §7's disagreement detector and A, A, B, B probes | catches the outcome that wasted the last drive, and separates line-dependence from alternation for the first time |
| 7 | `readRouteCrossing` + the export header | the car-park reading, written once for four branches |
| 8 | the drive | |
| 9 | whichever of §1–§10 the export says | |

Items 1–4 and 6 were built on 2026-09-27; items 5 and 7 remain.

Items 1–7 are branch-independent and the whole of the pre-drive kit. Items 5–7 are the
"build the branches the app can evaluate" argument made concrete: the app cannot see the
route, but it can see a missing arrival, a disagreeing block and a stalled clock, and those
three are the outcomes that have historically cost a drive.
