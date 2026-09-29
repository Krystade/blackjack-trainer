# The drive card — 2026-09-30

What to do, in order. Everything here is a tap or a spoken line; nothing needs a laptop.

The app runs the protocol. You are there to answer "where did that come from", press the
wheel when it says to, and keep the log.

---

## Before you leave — at home, on wifi, 5 minutes

1. **Open the app** (home-screen icon, or https://krystade.github.io/blackjack-trainer/).
2. **Check the build line at the bottom of Home.** It should show today's build and time. If
   it shows yesterday's, close the app, reopen it, and wait a few seconds — it fetches
   `version.json` on every foreground and reloads itself when the deployed build differs.
3. **Settings → Diagnostic log → Clear.** The log holds the last 3000 rows and drops the
   oldest; four legs will not overflow it, but starting empty means you can copy the whole
   thing without hunting for where the drive began.
4. **Settings → Field test → Open the field test.** Read the setup line for **Car, parked**.
   Do not press Start yet.
5. **Force-quit the app** (swipe it away from the app switcher). Every leg must start in a
   page that has not yet run one — the "before the microphone" steps are the protocol's
   headline comparison, and in a page that has already opened the microphone once they are
   not before anything. The app tells you when you have got this wrong (a warning appears on
   the gate saying the page has already run a leg) and it records whether you did it.
6. **Run one copy of the app, not two.** If you have it open as a Safari tab as well as the
   home-screen app, close the tab. Both write to the same storage, and a second copy sitting
   on the gate can score the driving copy's lock step as a death that did not happen.
7. **Take something to paste into** — Notes, or a draft email to yourself. You will paste
   four times.

Volume: the app takes over the volume when a run starts and gives your own settings back
when you Finish. Leave the car volume where you normally listen to it.

---

## The legs, in this order

Each leg is the same 32 steps (25 without Bluetooth — the wheel steps drop out). About
15 minutes each.

| # | Leg | Where | Bluetooth |
|---|-----|-------|-----------|
| 1 | **Car, parked** | Engine running, handbrake on, phone in the cradle at arm's length | on |
| 2 | **Freeway** | Same cradle, normal road speed, windows up | on |
| 3 | **Speakerphone** | Same cradle, phone's own speaker, road speed | **off** |
| 4 | **Phone, at your ear** | Engine off, phone against your ear like a call | **off** |

Leg 1 is the baseline — anything that fails there fails for reasons that have nothing to do
with the road. Leg 2 is the one the whole thing exists for. Leg 3 takes the car off the
list. Leg 4 is the only leg that can tell the earpiece from silence, which is why it is held
to your ear and why Bluetooth is off.

### The same five moves for every leg

1. **Force-quit and reopen the app.** (After leg 1, this is the step you will be tempted to
   skip. It is the one that makes the next leg's before-block mean anything.)
2. **Settings → Field test → Open the field test.**
3. **Pick the leg** under "Where are you". Read the Set up line; get the car into that state.
4. Leave **Answer out loud** off (see below).
5. **Press Start while stopped.** For legs 2 and 3 this matters: the gate is read with your
   eyes, and the first thing a run does is seize the volume and start talking. Get it
   started, confirm the first line plays, then pull out.

Then just answer what it asks. When the last step is done, **Finish** (two taps — one tap
used to throw runs away), then **Settings → Diagnostic log → Copy**, and paste it into
Notes with the leg name. Then force-quit for the next leg.

---

## What the 32 steps will ask you

They come in blocks. You do not need to memorise this — the app says each instruction out
loud and prints it — but knowing the shape stops you fighting it.

1. **Route, before the microphone** (8 steps: `route-1` … `route-3t`). It plays a line;
   you say where it came from: **Car speakers / Phone, loud / Phone earpiece / It moved while
   playing / Heard nothing**. Three in a row, then a one-word line, then a long line, then
   the same three again with the recording off so your phone's own voice reads them.
   - On legs 1, 2 and 3 the earpiece is inaudible from the cradle, so *earpiece* and *heard
     nothing* are the same answer — pick either, they are read together. Only leg 4
     separates them.
   - **"It moved while playing"** is a modifier: tap it *and then* tap where it ended up.
     The step stays open on purpose.
2. **Fallback** (1 step). Two lines back to back; the question is only whether you could make
   out the **second** one over the road.
3. **Wheel** (5 steps: `wheel-talking` … `wheel-repeat`). Press skip-forward while a line is
   playing; wait for silence, count three, press it again; press skip-back; press skip-back
   or an info/display button (nothing that answers a call, changes volume or changes source);
   then two presses a couple of seconds apart. Whatever the car actually sent appears on
   screen and goes in the log.
4. **Microphone open** (7 steps: `mic-route` … `mic-heard`). The microphone comes up — this
   is the moment the car may flip to hands-free, which is the variable the whole protocol is
   about. Six more "where did it come from", then **`mic-heard`**: wait for the line to
   finish, say **"double"** out loud, and tell it whether it got it right, heard the app
   instead of you, heard the wrong thing, or never heard you.
5. **Wheel with the microphone up** (1 step). Press skip-forward again.
6. **Route, after the microphone** (6 steps + 1 wheel step). The microphone is shut again;
   same lines, same question. Comparing this block against block 1 is the finding.
7. **Ambient** (1 step). Stay quiet. Five seconds of the cabin are measured the moment the
   line ends; a chime says when it is done.
8. **Lock** (1 step). **Lock the phone with the side button, count thirty, unlock, come
   back.** The app scores this itself — you do not report anything. Do this one at a red
   light or parked, not mid-merge.
9. **Anything else** (1 step, `free`). Stamp anything that worked or went wrong that no step
   above names. Stamp it the moment it happens; the log can find it afterwards, you cannot.

---

## The rules that matter while it is running

- **"Missed it — couldn't tell" is a real answer. Use it.** Every question has it. If you
  were merging and never got a hand to the phone, that is what happened — do not pick one of
  the plausible-looking answers, because the honest-looking guess reads in the log as exactly
  the bug under investigation.
- **Skip is different from "Missed it".** Skip means *this step could not be performed at
  all*. It is recorded as a skip, but the step has no answer, and a route block with a hole
  in it reads as a short block in the analysis. Prefer "Missed it".
- **"Say it again" / "Read it to me"** is always there, top of the controls. A truck went
  past — press it. It is recorded as a re-read you asked for, which is why it does not spoil
  the sample.
- **The note box is per-step and it is safe now.** Type into it and it survives a reload or
  a kill; the box comes back filled. If the run has moved on by the time you come back, the
  note is filed against the step you typed it on by itself.
- **Back** goes to the previous step. It re-opens the microphone if that step had it up, so
  do not use it to browse.
- **Finish is two taps.** So is Start-over when there is a run to lose.
- **A phone call, Siri, or the phone locking does not end the run.** Come back to the app and
  it is where you left it; if it went all the way away, the gate shows **Resume — step N of
  M** above Start. Take Resume. Start resets to step one.
- **The app will not reload itself mid-leg.** The update check defers while a run is live. It
  can reload while you are on the gate or paused — that is fine, and your run is still there.

### Answer out loud

Leave it off. It only listens on the seven steps that already have the microphone open
(the other 25 are tap-only on purpose — opening a microphone is the thing being measured), so
it does not save you much, and on those steps the recogniser can hear the app instead of you.
If you do turn it on, do it on the gate before you start or resume, not mid-drive, and know
that the log records that the leg was answered by voice — those legs are compared against
each other, not against a tapped leg.

---

## After each leg

1. **Finish** (two taps). Your own audio settings come back.
2. **← Settings → Diagnostic log → Copy**, paste into Notes, label it with the leg.
3. **Force-quit the app.**

If **Copy** says nothing happened, the log opens on screen instead so you can select it by
hand (that is an old-iOS / insecure-context fallback, not a lost log).

## After the drive

Send me the four pasted logs. What I will read first:

- `run-start` / `run-resume` for each leg — the condition, whether the page had already run a
  leg, and whether the leg was answered by voice.
- The route cells before the microphone against the ones after it. That is the headline.
- `lock-probe-result` per leg: `normal`, `throttled`, `frozen`, `too-short`, or — if the app
  died on that step — `frozen-unloaded` / `unloaded-no-hidden`.
- Every wheel step's actual Media Session name, which is the mapping we still do not have.
- `mic-still-live`, `mic-never-live`, and `msSinceAppLetGo` on the after-block answers, which
  say whether an after sample is trustworthy.

## If something goes badly wrong

Do not debug it in the car. Stamp it on the `free` step (or type it in the note box), finish
or pause the leg, copy the log, and carry on to the next leg. A leg that ended early with a
copied log is worth more than a leg you tried to rescue.
