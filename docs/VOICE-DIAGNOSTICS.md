# Reading the diagnostic log

Settings → **Diagnostic log**. Press **Mark**, try a session, press **Mark** again, press
**Copy**, paste.

## What it is for

The report this was built for, 2026-09-15:

> "it rarely understands me ... it also frequently doesn't hear me ... I get the request to
> allow the mic and always accept it but it seems like the mic doesn't stay active."

Those are three different failures that look identical from the driver's seat:

| What happened | What it looks like | Where it shows in the log |
| --- | --- | --- |
| The engine heard a word and picked the wrong one | silence | `heard utterance verdict=rejected` |
| The engine heard nothing because the session had died | silence | `mic session-end`, then a gap |
| The engine heard nothing because the audio route changed | silence | `route devicechange` |
| The app was talking over you | silence | `speak deafen`, then `mic suppressed` |
| The screen slept | silence | `wake lost`, `life visibility state=hidden` |

Guessing between them is what has not worked. The log is how the guessing stops.

## The line format

```
 1:23.400 [n4l] mic   session-end        n=3 sessionMs=45021 heard=true failedStreak=0 restartInMs=250
 └ minutes into └ page  └ category        └ detail
   this page load  load
```

`[n4l]` is the page load. **If it changes mid-log, the app reloaded** — iOS does this freely to
a backgrounded PWA, and everything before the change belongs to a different run.

## What each category means

| | |
| --- | --- |
| `env` | Written once per page load: what browser, installed PWA or tab, which recognition engine |
| `mic` | Recognition sessions: `attempt`, `session-start`, `session-end`, `session-error`, `start-timeout`, `resume`, `heartbeat` |
| `heard` | Every transcript, with the verdict the app reached |
| `speak` | The app talking, which deafens the microphone for its own duration plus 700ms |
| `life` | The page being hidden, shown, frozen, resumed, taken offline |
| `route` | Audio input devices appearing and disappearing — a car's Bluetooth connecting |
| `perm` | Microphone permission, and any change to it |
| `wake` | The screen wake lock taken, lost, re-taken |
| `set` | Settings and profile changes, as a diff — `audio.verbosity: results -> full` |
| `nav` | Which screen was open |

## Reading a bad stretch

**A `heartbeat` every 30s says the app was alive.** A gap in heartbeats is the app not running —
backgrounded, or reloaded. That is a different problem from the microphone failing, and the
heartbeat is the only thing that tells them apart.

Then, in order:

1. `mic session-error error=...` — the engine said why.
   - `not-allowed` — permission. Look at `everWorked`: if false, the prompt was declined; if
     true, it is very likely iOS objecting to a restart with no user gesture behind it.
   - `audio-capture` — the microphone became unavailable. Usually a Bluetooth route flip;
     look for `route devicechange` nearby.
   - `network` — webkit recognition is server-backed, so a tunnel is deafness.
   - `no-speech` — normal. The engine ends a quiet session.
2. `mic start-timeout` — the engine accepted `start()` and then fired nothing for five seconds.
3. `mic session-end sessionMs=...` — short sessions in a row (`failedStreak` climbing) mean
   something is killing them; `restartInMs` shows the backoff growing in response.
4. `mic suppressed heard="..."` — you were heard, and the transcript was thrown away because
   the app was still talking. A run of these is a verbosity problem, not a microphone problem.
5. `heard utterance verdict=rejected` — heard and understood as nothing. These are the raw
   material for the alias table: a substitution that repeats is worth teaching.

## What is NOT in it

No audio, ever — text only. It never leaves the device unless you copy it out yourself. It is
capped at 3000 entries and 400KB, oldest dropped first, and **Clear** deletes it outright.

It is a record of what an open microphone heard, so it can contain conversation that happened
near the phone. That is worth knowing before pasting one into a chat window.
