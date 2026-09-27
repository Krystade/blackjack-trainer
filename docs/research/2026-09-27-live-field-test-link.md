# A live channel between the phone in the car and Claude Code

**Design only.** Nothing here is built. It was asked for on 2026-09-24 to be designed after the
review rounds, and those finished on 2026-09-27 (rounds 6A–6G). Two things in it cannot be
settled by reasoning — §5 says which, and both need one drive to answer.

---

## 1. What is actually wrong with the field test today

`FIELD_TEST_STEPS` in `src/diag/fieldTest.ts` is a fixed list, walked start to finish. Each step
speaks a line, waits, and offers a row of on-screen answer buttons; the answers land in
`bjtrainer.fieldTestRun.v1` and the diagnostic log, and the whole run is read afterwards.

Three costs, in the order they bite:

1. **It cannot branch.** The 2026-09-23 drive is the standing example: the run was built to
   determine whether the audio route moves when the microphone opens or when it closes, and it
   came back undetermined, because the one utterance that would have separated the two was never
   spoken. A human reading the answers as they arrive asks the next question; a list cannot. The
   fix for that drive was `awaitListening` / `awaitNotListening` — correct, and it only closes the
   case that had already been diagnosed.
2. **Every answer costs a glance.** The buttons exist because the app cannot hear which speaker
   the sound came out of. That is the honest reason and it does not go away.
3. **A dead end ends the drive.** A step that cannot be answered as asked — the case
   `wheel-other`, `heard-not-said` and `ambient-dirty` were each added for — burns the run.

## 2. What a live link does and does not fix

It fixes (1) and (3): I read each answer as it lands and choose the next step, including steps that
are not in any list.

It does **not** fix (2), and this is the part worth being clear about, because it is the reframing
the whole idea turns on. A socket does not let me hear the car. I still cannot tell a phone
loudspeaker from a dashboard speaker. What removes the glances is not the channel — it is that
**voice input already exists in the app**. Say "car" or "loudspeaker" and the transcript reaches
me; the answer buttons stop being the only input, and the phone can stay face down.

So the feature is really two, and they are separable:

- **(A) Speak the answers.** Route `SpeechRecognition` transcripts during a field-test run into the
  run record, alongside the button answers, with the button still there. Worth doing on its own,
  works offline, and needs no server. This is the part that removes the glances.
- **(B) Drive the run live.** Stream the run record to me and take the next step from me. Needs a
  server. This is the part that removes the fixed list.

**(A) first.** It carries most of the value at a fraction of the risk, and it is the half that
still works when the tunnel is down, which — see §4 — is a state the design has to treat as normal
rather than exceptional.

## 3. Transport, for (B)

The site deploys to GitHub Pages: static files, no backend, nothing that can hold a socket. So the
channel lives somewhere else. Two candidates.

### 3a. `cloudflared` quick tunnel to a local server — preferred

A small Node server on this Windows box, exposed by `cloudflared tunnel --url http://localhost:PORT`.
Two endpoints: `GET /events` (SSE, the phone's command stream) and `POST /log` (the phone's
answers and diagnostic entries). I write to it from Bash; the phone opens the page with
`?live=https://<random>.trycloudflare.com`.

- No account, no bill, no secret in a public bundle, and it dies when the process does.
- Costs: my machine must be up for the whole drive, and the hostname is fresh every run, so it has
  to be typed or QR'd onto the phone at the start.
- **The tunnel URL is public while it lives.** Anyone holding it can read the stream and post to
  it. It carries drive telemetry, not credentials, and it lives for one drive — but the server must
  require a per-run token in the query string anyway, and must never serve anything it was not
  explicitly given.

### 3b. A hosted broker (Firebase RTDB, Supabase realtime, MQTT)

Removes the dependency on my machine. Adds an account, a bill I have to watch, and — the
disqualifier — a key embedded in a public static bundle, which is a durable secret in a repo that
is currently secret-free. Rejected unless (3a) proves unworkable on the road.

**One rule for either.** The live URL is never baked into the build. It arrives as a query
parameter, and a page loaded without it is byte-for-byte the field test that exists today.

## 4. iOS backgrounding is the load-bearing unknown

Lock the phone or switch apps and Safari throttles timers and drops connections. That is the normal
state of a phone in a car, not an edge case.

What is already known: the field test holds a silent looping audio element (`src/audio/audioFocus.ts`) and the app does keep running with the screen off, or the existing
drives would not have produced logs. What is **not** known is whether an SSE connection survives
that, and for how long.

The design consequence is the same whichever way it goes: **the channel is an accessory, never a
dependency.** Concretely —

- The run advances from the phone by default. A command from me *overrides* the next step; it is
  never awaited.
- `POST /log` is fire-and-forget, batched, and the run record in `localStorage` stays the source of
  truth. Nothing is only in the stream.
- A dropped stream is logged (`diag('net', 'live-stream-lost')`) and retried with backoff. It does
  not pause the run, show a modal, or say anything out loud.
- With no `?live=` parameter, none of this code runs at all.

If SSE turns out not to survive a locked screen, the fallback is polling `GET /next` on the
existing step cadence — worse latency, same contract, and the contract above is what makes that
substitution cheap.

## 5. What one drive has to answer before any of this is built

1. **Does a stream survive a locked screen?** Open a page holding an SSE connection, lock the
   phone, drive ten minutes, unlock. Did it stay up, and if not, how long did it last and did the
   retry recover? This is the only question that decides between SSE and polling.
2. **Is voice usable as the answer channel in a moving car?** The recogniser already flips the
   phone to hands-free (`src/audio/voiceControl.ts`, `src/audio/wheelCommands.ts`) — which is itself one of the things the field test
   is measuring. Answering by voice therefore *perturbs the experiment*: an open microphone may
   move the audio route the next step is about to sample. That may make (A) unusable for the route
   steps specifically while remaining right for everything else, and it is not decidable from here.

Both are observations, not code. Neither should be guessed.

## 6. Order of work

| # | Step | Depends on |
|---|---|---|
| 1 | Voice answers in the field test, button retained | nothing |
| 2 | Drive (§5), answering both questions | 1 |
| 3 | Local server + `?live=` client, behind the parameter, SSE or polling per (5.1) | 2 |
| 4 | Live step injection — a step I compose mid-drive rather than one from the list | 3 |

Step 4 is the point of the exercise. Steps 1–3 are what make it safe to reach.

## 7. The thing to re-read before starting

That (2) above is not solved by any of this. If a drive comes back and the answer is "voice moves
the route, so the route steps still need the buttons", then the live link buys branching and
nothing else — still worth having, and a smaller feature than it looks from here.
