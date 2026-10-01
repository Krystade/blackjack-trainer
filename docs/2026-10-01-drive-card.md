# The drive card — drill protocol

One leg, about five minutes of driving.

**This replaces the 32-step routing programme in `2026-09-30-drive-card.md`.** That protocol
answered its questions: audio comes out of the car speakers, the wheel works, and the
routing failure it was chasing was never real. What is still unknown is whether the thing is
*usable* at speed — whether you can make out the words, whether a press answers a question,
and whether talking to it works. That is what this leg measures.

**Why one and not four.** The card used to list a parked leg, a freeway leg and a
phone-speaker leg, and the field test used to offer all seven conditions on its gate,
including the four routing ones that were already answered. That is how a drive got spent
answering the same forty questions a second time. A field test with a menu asks the operator
to choose an experiment from the driver's seat; there is one open experiment, so there is no
menu. The other conditions still exist in the protocol and the suite still drives them by
name — they are simply not offered. See `offered` in `src/diag/fieldTest.ts`.

The parked baseline did not disappear, it moved: **step 1 is the control and you answer it
stopped**, before pulling out. Same page load, same volume, same cradle. A step that passes
there and fails once you are moving is the road, because nothing else changed.

The app runs the protocol. It draws the words, speaks them, listens for the press, says back
what it heard, and scores your answer against what it actually said. You press the wheel,
tap a word, and say a word out loud.

**Every step prints what it is measuring**, in a small italic line under the instruction, so
you never have to remember why you are doing one. The leg's whole purpose is on the gate
under **Proves:** before you start. Neither is ever spoken — the drill measures whether one
specific sentence survives road noise, and a clause about the experiment in front of it
would change the thing being measured.

---

## Before you leave — three minutes, on wifi

1. **Open the app.** Check the build line at the bottom of Home shows today. If it shows
   yesterday's, close it, reopen, wait a few seconds — it fetches `version.json` on every
   foreground and reloads itself when the deployed build differs.
2. **Settings → Diagnostic log → Clear.** One leg will not come near the 3000-row buffer,
   but starting empty means you can copy the whole thing without hunting.
3. **Settings → Field test.** You should see the setup line and **Proves:**, and one
   **Start** button — **no list of places to choose from.** If you are offered a choice of
   conditions, you are on an old build; go back to step 1. Do not press Start yet.
4. **Force-quit the app** (swipe it away from the app switcher).
5. **Close any Safari tab** running the app. Two copies share storage, and the idle one can
   score the driving one's steps.
6. **Something to paste into** — Notes, or a draft email to yourself. One paste.

---

## The leg

| Leg | Where | Bluetooth | Steps |
|-----|-------|-----------|-------|
| **Drill — freeway** | Cradle, normal road speed, windows up, paired as usual | on | 9 |

### The four moves

1. **Force-quit and reopen the app.** This is the one you will want to skip, and it is the
   one that makes step 8 mean anything (see *the positive control* below).
2. **Settings → Field test → Start, while stopped.** The first thing a run does is take the
   volume and start talking. Get it going, **answer step 1 and step 2 before you pull out**,
   then drive.
3. Answer the remaining steps at road speed.
4. **Finish** (two taps) → **Settings → Diagnostic log → Copy** → paste into Notes →
   force-quit.

---

## What it asks, in order

**Step 1 — Skip-forward, and what comes back. Answer this stopped.** It plays a line. Press
skip-forward on the wheel once. The word that comes back is what the app thinks you pressed.
You report whether that matched what you meant.

> **This is the positive control, and it is first for a reason.** Nothing in the page has
> opened a microphone yet, so the wheel is in the cleanest state it will ever be in. If no
> word comes back here, **the leg is not measuring anything — finish it, force-quit, and
> start it again.** Do not carry on, and do not pull out. The last drive produced a run that
> could not be read at all because "the fix failed" and "the wheel never worked in this page
> load" were indistinguishable.

**Step 2 — Skip-back. Also stopped.** Same thing, other direction. These are two different
wires inside the app and last time only one of them worked, so a leg that tested one
direction would have read as a pass.

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

**There is no step 10.** There used to be an "Anything else" step with four buttons at the
end of the leg, and it was cut after the 2026-09-30 drive: its buttons named nothing, because
by then there is nothing in front of you for "That worked" to be about, and it asked at the
END for things to be stamped the moment they happen.

**The note box is on every step**, which is where that actually gets done. Type into it the
moment something happens and it lands in the log against the step you were on. On the
2026-09-30 drive that is exactly how it was used, twice, while the free step went unanswered.

---

## The five rules that matter at speed

- **"Missed it — couldn't tell" is a real answer on every step. Use it.** A plausible-looking
  guess about *whether the app worked* reads in the log as exactly the bug under
  investigation. A guess about *which word you heard* is fine and wanted — those are
  different questions.
- **"I never pressed" is also a real answer**, on every wheel step. See step 8.
- **The note box is on every step.** Anything a button cannot say, type there — it is stamped against the step you are on, which is what makes it readable afterwards.
- **"Say it again" is always at the top of the controls.** A truck went past — press it. It
  is logged as a re-read you asked for, which is why it does not spoil the sample.
- **Do not debug in the car.** Stamp it, finish the leg, copy the log, drive on. A leg that
  ended early with a copied log is worth more than a leg you tried to rescue.
- **A call, Siri or the phone locking does not end the run.** Come back and it is where you
  left it. If it went away entirely the gate offers **Resume — step N of M**; take Resume,
  because Start resets to step one. The app will not reload itself mid-leg.

---

## What is automatic, and what needs your hands

Everything you do is: **3 wheel presses, 3 taps on a word, 2 words spoken, 1 tap to confirm
the sweep** — plus one answer button per step. Nine steps.

The app does the rest without being asked: it draws the word at random and records which one
(`said=`), scores your tap against it (`correct=`), times how long the echo took
(`echoTook=`), holds 1.5 seconds of settling before every measured line, waits for the
recogniser to be genuinely down before step 8 rather than merely asked to stop, and
enumerates and measures every microphone in step 9. None of that needs a decision from you
and none of it can be got wrong by tapping in the wrong order.

---

## After the drive

Send me the pasted log. What I read first:

- `said=` against the answer on each of the word steps — the intelligibility **rate**,
  which is the headline.
- Whether every echo step produced a word, and `echoTook=` for each.
- Step 8 against step 1: same press, same page, microphone in between.
- Steps 1 and 2 (stopped) against steps 3–7 (moving) — the road's contribution, which is
  what the parked leg used to be for.
- `sweep-reading` per input in step 9 — the car mic against the phone mic under the same
  road noise.
- `wheel-not-pressed` wherever it appears, which is the answer step 8 could not get before.

One thing I cannot get from the log: **whether any of this was pleasant to use.** If the leg
was annoying, say so in a note on any step, or just tell me.

---

## If the freeway leg comes back clean

The other two drill legs — parked and phone-speaker — are still in the protocol and are what
to offer next, one at a time, by setting `offered` on them in `src/diag/fieldTest.ts`. The
phone-speaker leg is the one that matters if the words turn out to be unintelligible through
the car: same road speed, car taken out of the loop, so it separates the head unit from the
speech.
