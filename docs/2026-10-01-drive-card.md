# The drive card — drill protocol

Three legs, about five minutes each. Twenty minutes of driving, not an hour.

**This replaces the 32-step routing programme in `2026-09-30-drive-card.md`.** That protocol
answered its questions: audio comes out of the car speakers, the wheel works, and the
routing failure it was chasing was never real. What is still unknown is whether the thing is
*usable* at speed — whether you can make out the words, whether a press answers a question,
and whether talking to it works. Those are what these three legs measure.

The app runs the protocol. It draws the words, speaks them, listens for the press, says back
what it heard, and scores your answer against what it actually said. You press the wheel,
tap a word, and say a word out loud.

---

## Before you leave — three minutes, on wifi

1. **Open the app.** Check the build line at the bottom of Home shows today. If it shows
   yesterday's, close it, reopen, wait a few seconds — it fetches `version.json` on every
   foreground and reloads itself when the deployed build differs.
2. **Settings → Diagnostic log → Clear.** Three legs will not overflow the 3000-row buffer,
   but starting empty means you can copy the whole thing without hunting.
3. **Settings → Field test.** Confirm you can see **Drill — parked**, **Drill — freeway**
   and **Drill — phone speaker** in the list. Do not press Start.
4. **Force-quit the app** (swipe it away from the app switcher).
5. **Close any Safari tab** running the app. Two copies share storage, and the idle one can
   score the driving one's steps.
6. **Something to paste into** — Notes, or a draft email to yourself. Three pastes.

---

## The legs, in this order

| # | Leg | Where | Bluetooth | Steps |
|---|-----|-------|-----------|-------|
| 1 | **Drill — parked** | Engine running, handbrake on, phone in the cradle | on | 10 |
| 2 | **Drill — freeway** | Same cradle, normal road speed, windows up | on | 10 |
| 3 | **Drill — phone speaker** | Same cradle, phone's own speaker, road speed | **off** | 7 |

Leg 1 is the baseline: anything that fails parked fails for reasons that have nothing to do
with the road, and there is no point carrying it onto the freeway. Leg 2 is the one the
project exists for. Leg 3 takes the car out of the loop — if the words are intelligible on
the phone's own speaker at the same road speed but not through the car, the head unit is the
problem, not the speech.

Leg 3 has no wheel, so its three wheel steps drop out by themselves. You will not be asked
for a press you cannot make.

### The same four moves for every leg

1. **Force-quit and reopen the app.** This is the one you will want to skip after leg 1, and
   it is the one that makes the leg's last comparison mean anything (see *the positive
   control* below).
2. **Settings → Field test → pick the leg → Start, while stopped.** The first thing a run
   does is take the volume and start talking. Get it going, hear the first line, then pull
   out.
3. Answer the ten steps.
4. **Finish** (two taps) → **Settings → Diagnostic log → Copy** → paste into Notes, labelled
   with the leg → force-quit.

---

## What it asks, in order

**Step 1 — Skip-forward, and what comes back.** It plays a line. Press skip-forward on the
wheel once. The app says back the word it took your press to mean. You report whether that
matched what you meant.

> **This is the positive control, and it is first for a reason.** Nothing in the page has
> opened a microphone yet, so the wheel is in the cleanest state it will ever be in. If no
> word comes back here, **the leg is not measuring anything — finish it, force-quit, and
> start it again.** Do not carry on. The last drive produced a run that could not be read at
> all because "the fix failed" and "the wheel never worked in this page load" were
> indistinguishable.

**Step 2 — Skip-back.** Same thing, other direction. These are two different wires inside
the app and last time only one of them worked, so a leg that tested one direction would have
read as a pass.

**Steps 3, 4, 5 — Which word was that.** One line each, then four buttons: **hit / stand /
double / split**. The four lines differ *only* in that word, so tap what you actually heard
and guess when you are unsure — a guess is data, and the app knows which word it said. There
is a **"heard it, couldn't make out the word"** button for when the road wins; that is an
honest answer and it is scored as neither right nor wrong.

Three samples, because one cannot tell "unintelligible at speed" from "that one went wrong".

**Steps 6, 7 — Say the answer out loud.** The microphone comes up. Say **"hit"** or
**"stand"**, whichever you like. The app says back the word it heard. Report whether that
matched.

**Step 8 — The wheel, straight after the microphone.** Microphone off. Press skip-forward
once and listen for the word.

> **This is the step the last drive got wrong.** A press went missing here for nine minutes
> and the conclusion drawn from it — that iOS drops the skip handlers — turned out to be
> false. Two possibilities are left: the head unit withholds the skip buttons while
> hands-free is up, or the press was never actually made. So if you do not press it, say so:
> **"I never pressed — no chance"** is on the list and it is the answer that separates the
> two. A blank here is worth nothing.

**Step 9 — Measuring the noise. Nothing to do.** It finds every microphone the phone will
offer, measures the cabin through each for three seconds, and chimes when it is done. Hold
your speed, leave the phone alone, and tap when the screen says it has finished. This is the
car-mic-versus-phone-mic comparison and it is entirely automatic.

**Step 10 — Anything else.** Stamp anything that worked or went wrong that no step names.
Stamp it the moment it happens; the log can find it afterwards, you cannot.

---

## The five rules that matter at speed

- **"Missed it — couldn't tell" is a real answer on every step. Use it.** A plausible-looking
  guess about *whether the app worked* reads in the log as exactly the bug under
  investigation. A guess about *which word you heard* is fine and wanted — those are
  different questions.
- **"I never pressed" is also a real answer**, on every wheel step. See step 8.
- **"Say it again" is always at the top of the controls.** A truck went past — press it. It
  is logged as a re-read you asked for, which is why it does not spoil the sample.
- **Do not debug in the car.** Stamp it, finish the leg, copy the log, drive on. A leg that
  ended early with a copied log is worth more than a leg you tried to rescue.
- **A call, Siri or the phone locking does not end the run.** Come back and it is where you
  left it. If it went away entirely the gate offers **Resume — step N of M**; take Resume,
  because Start resets to step one. The app will not reload itself mid-leg.

---

## What is automatic, and what needs your hands

Per leg, everything you do is: **3 wheel presses, 3 taps on a word, 2 words spoken, 1 tap to
confirm the sweep** — plus one answer button per step. Leg 3 drops the three presses.

The app does the rest without being asked: it draws the word at random and records which one
(`said=`), scores your tap against it (`correct=`), times how long the echo took
(`echoTook=`), holds 1.5 seconds of settling before every measured line, waits for the
recogniser to be genuinely down before step 8 rather than merely asked to stop, and
enumerates and measures every microphone in step 9. None of that needs a decision from you
and none of it can be got wrong by tapping in the wrong order.

---

## After the drive

Send me the three pasted logs. What I read first:

- `said=` against the answer on each of the nine word steps — an intelligibility **rate** per
  leg, which is the headline.
- Whether every echo step produced a word, and `echoTook=` for each.
- Step 8 against step 1 in the same leg: same press, same page, microphone in between.
- `sweep-reading` per input in step 9 — the car mic against the phone mic under the same
  road noise.
- `wheel-not-pressed` wherever it appears, which is the answer step 8 could not get before.

One thing I cannot get from the log: **whether any of this was pleasant to use.** If a leg
was annoying, say so in the free step or just tell me.
