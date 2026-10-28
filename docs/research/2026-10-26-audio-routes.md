# Audio routes with the mic open — design (wave U)

Owner ask: Bluetooth and speakerphone in the car, plus a Bluetooth headset, all with the mic open for
voice answers. Wheel buttons are last priority and nothing below is designed around them.

Routes: **A** phone loud speaker + phone mic (no Bluetooth) · **B** car speakers + car mic (HFP) ·
**C** Bluetooth headset speakers + headset mic (AirPods etc.).

Legend: **[src]** read in WebKit source or a spec; **[measured]** a log from Jack's phone;
**[unknown]** neither — needs a drive / a headset session.

---

## 1. What is known

### Measured on Jack's phone (iOS 18.7, installed PWA) — from docs/TODO.md and docs/NEXT-TEST.md

| # | Finding | Where |
|---|---|---|
| M1 | Route A: with a mic open, **Web Audio (decoded buffers) plays on the loud speaker 7/7, blind**; `<audio>` 2/7 (earpiece otherwise). Shipped as the G1 fix: clips and chimes go through Web Audio once a mic has opened in the page. | TODO.md "desk run 2026-10-05", Flashcards 2026-10-05 |
| M2 | Route A: with no mic ever opened, Web Audio obeys the ring switch (silent); with a mic open it does not. | TODO.md 08:09/08:11 runs |
| M3 | Route A: `navigator.audioSession.type='playback'` mid-capture reads back `playback` and the sound stays on the earpiece. | 2026-10-04 drive (audioSession.ts) |
| M4 | Route A: capture stopped, then `'playback'` declared, then a clip → earpiece (the WebKit bug 218012 order). | e60a90f log, ec67e35 |
| M5 | Route B is **intermittent**, not broken: mic open, both paths, car speakers 6/6 (2026-10-06 18:01 driving, 18:36 parked) and 0/6 (09:05 driving, 17:59 driving, 2026-10-07 14:09 **parked**). | TODO.md, NEXT-TEST.md Run 1 |
| M6 | Route B bad state: closing the mic does **not** bring the car back (`bt-closed-*` → earpiece, n=2). | NEXT-TEST.md A2 |
| M7 | Route B: every capture reads `trackSampleRate=8000` once the Corolla is connected, **the iPhone mic included**; labels `TOYOTA Corolla`, `iPhone Microphone`. | TODO.md |
| M8 | Route B: parked recognition through the car's 8 kHz mic is 10/10 one-word and two-word. | NEXT-TEST.md A3 |
| M9 | A `devicechange` fires at (nearly) every mic open; the first word window opened into it. | TODO.md, NEXT-TEST.md A4 |
| M10 | The hardware-rate probe (fresh AudioContext) read 48000 on both sides of the earpiece flip — the rate does not name the receiver. | ios-earpiece memory, micSessionCost.ts |
| M11 | Route C: **never measured**. | — |

### Read in WebKit source (main, fetched 2026-10-26) and specs

| # | Finding | Source |
|---|---|---|
| S1 | While any audio capture source is active, WebKit sets the platform category to **PlayAndRecord, mode VideoChat**. It also keeps PlayAndRecord after capture ends **while anything is still playing** (`captureCount \|\| (isPlayingAudio && category == PlayAndRecord)`). | `MediaSessionManagerCocoa::updateSessionState` — https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm |
| S2 | With only Web Audio and no media element or capture, the category is **AmbientSound** — which obeys the ring switch. This is M2, explained. | same file |
| S3 | PlayAndRecord is set with options **AllowBluetooth (HFP) \| AllowBluetoothA2DP \| AllowAirPlay**, plus **DefaultToSpeaker unless the receiver is the preferred speaker**. Before Dec 2024 DefaultToSpeaker was unconditional. So WebKit *asks* for the loud speaker; the earpiece in M1/M4 is not explained by this code. Mechanism: **unknown**. | `AudioSessionIOS::setCategory` — https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/ios/AudioSessionIOS.mm (history: commit 19888c4fb2 "Prepare AVAudioSessionCaptureDeviceManager for speaker selection", 773ecfac9b "Receiver output should trigger using audio chat mode") |
| S4 | When both HFP and A2DP are allowed and one device supports both, **"the system gives hands-free ports a higher priority for routing."** So with the mic open, routes B and C are *meant* to go to the Bluetooth device over HFP (narrowband both ways). | Apple, `allowBluetoothA2DP` — https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/allowbluetootha2dp |
| S5 | `DefaultToSpeaker`: "audio is always routed to the speaker rather than the receiver, even when … wireless Bluetooth headphones … are in use"; "only changing the audio session category resets this option." | Apple, `defaultToSpeaker` — https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/defaulttospeaker |
| S6 | `navigator.audioSession.type = X` sets a **category override**; `AudioSessionIOS::setCategory` refuses any other category while an override is set ("override set, NOT changing"). `play-and-record` maps to PlayAndRecord (same options as S3). So declaring play-and-record BEFORE capture means the category never changes at mic open/close. | `DOMAudioSession::setType` — https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/audiosession/DOMAudioSession.cpp ; spec example 9.1 "A site sets its audio session type proactively to play-and-record" — https://w3c.github.io/audio-session/ ; MDN — https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type |
| S7 | `getUserMedia({deviceId:{exact}})` on iOS makes WebKit call `AVAudioSession setPreferredInput:` with that port. | `AVAudioSessionCaptureDeviceManager::setPreferredAudioSessionDeviceIDs` — https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/mediastream/ios/AVAudioSessionCaptureDeviceManager.mm |
| S8 | Device **labels are `AVAudioSessionPortDescription.portName`** (so "TOYOTA Corolla", "AirPods Pro" etc. after permission), the default device is the **current route's first input**, and WebKit sorts the default first. | `AVAudioSessionCaptureDevice.mm` and the manager above |
| S9 | Speech recognition captures from **the default capture device** (`SpeechRecognitionCaptureSource::findCaptureDevice`: first enabled non-speaker device, preferring `isDefault`). So the recogniser follows whatever input the route has — and therefore follows S7's preferred input if a held stream moved it. Whether a held getUserMedia stream and the recogniser coexist on iOS: **unknown** (the unrun "Bluetooth: phone mic?" kit asks). | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/speech/SpeechRecognitionCaptureSource.cpp ; `WebPageProxy::createRealtimeMediaSourceForSpeechRecognition` |
| S10 | `HTMLMediaElement.setSinkId` — Safari / iOS **18.4+**; `AudioContext.setSinkId` and `selectAudioOutput` — **not supported**. Whether iOS lists any `audiooutput` device to pass to it: **unknown** (WebKit's speaker list comes from Apple-internal code). | MDN browser-compat-data 6.0.0 (`api.HTMLMediaElement.setSinkId`, impl https://webkit.org/b/216641) |
| S11 | MDN/BCD: `navigator.audioSession` Safari / iOS 16.4+. | BCD 6.0.0 |

**Corollary of S1 worth testing (new):** the app keeps sound "playing" after the mic closes — the
silent focus loop (`audioFocus.ts`, volume 1, looping) during drills and the kept-awake shared
AudioContext. If WebKit counts either as playing audio, PlayAndRecord sticks after the mic closes,
which would explain M6 and Jack's 2026-10-03 "stays on the earpiece". It does *not* explain M4 (the
test kit had no focus loop), so it is a hypothesis, not a finding. The car kit's **"quiet close"**
step tests it: mic closed, every sound stopped and the context suspended for 2.5 s (WebKit's
`delayBeforeSettingCategoryNone` is 2 s), then the element plays.

---

## 2. Per route

### A — phone only (loud speaker + phone mic)

- **Strategy (default, best evidence):** `web-audio` — Web Audio once a mic has opened (M1, 7/7).
- **Candidates behind a setting:** `play-and-record` (declare before capture, S6: the category then
  never changes at mic open; could also move `<audio>`/TTS off the earpiece if the receiver is
  chosen at the category switch — **unknown**); `speaker-sink` (`<audio>` + `setSinkId` to a listed
  speaker output, S10 — **unknown** whether iOS lists one).
- **App can detect:** that no Bluetooth input exists (labels, S8); whether `setSinkId` exists and any
  `audiooutput` is listed; the session type it declared and read back.
- **Only Jack's ears:** loud speaker vs earpiece (M10: the rate does not move).
- **Fallback:** voice off = no mic = loud speaker (G1-d), already true.
- **Cost:** none for `web-audio`. Live-TTS lines may still use the earpiece (known, few lines).

### B — car Bluetooth (car speakers + car mic, HFP)

- **Strategy (default):** `web-audio`, no held input. Evidence is mixed (M5) and no candidate has
  beaten it yet, so the default does not change; it is marked **DRIVE DECIDES** in code.
- **Candidates behind the setting:**
  - `play-and-record` declared before the first capture (S6) — the leading candidate: the
    category no longer flips Playback↔PlayAndRecord at every mic open, which is when the
    `devicechange` (M9) and plausibly the A2DP↔HFP renegotiation happen. With S4 the output should
    then sit on the car's HFP route for the whole drill. **Unknown.**
  - **Audio route = Bluetooth:** hold a capture on the car's input by `deviceId` (S7) while voice is
    on, pinning the preferred input (and with it, per S4, the HFP output) to the car. **Unknown.**
  - **Audio route = Phone speaker** with the car connected: hold the iPhone mic (S7). Output may go
    to A2DP car speakers, the phone speaker or the earpiece — **unknown**; M7 says the iPhone mic
    still reads 8 kHz, so this is not expected to improve recognition.
- **App can detect:** a non-iPhone input and its label ("TOYOTA Corolla"); 8 kHz track rate (HFP,
  M7); which input is first/default (S8); `devicechange` churn.
- **Only Jack's ears:** car speakers vs phone speaker vs earpiece.
- **Fallback:** Audio route = Phone speaker (or Bluetooth off), which is route A.
- **Cost:** none for the declaration; a held input costs a second capture (risk: may disturb the
  recogniser — the kit's voice answers measure that directly, every step).
- **Rejected:** half-duplex "close → playback → speak → reopen": M4 and M6 (n=2) say the route does
  not come back, and it costs ~1.2 s deafness per line (`confirmedInMs=1233`) plus ~1.6 s route
  settle. Re-open only if the **quiet close** step answers "car".

### C — Bluetooth headset (AirPods: headset speakers + headset mic)

- **Strategy (default):** `web-audio` (same as B: same S3/S4 mechanics, nothing measured).
- **Candidates:** as B. A held iPhone mic (Audio route = Phone speaker is the wrong label here; it is
  the same mechanism) might keep the headset on A2DP (wideband music quality) while the phone
  listens — **unknown**.
- **App can detect:** the label (e.g. "AirPods Pro") and a best guess car-vs-headset from it
  (`guessBluetoothKind`, a regex on known headset words — a guess, logged as one); track rate.
- **Only Jack's ears:** headset vs phone vs earpiece; muffled "call" sound vs full sound.
- **Fallback:** Audio route = Phone speaker, or take the headset off.
- **Cost:** as B.

---

## 3. What is built (headless-testable)

1. `src/audio/audioRoute.ts` — pure: `classifyInputs`, `guessBluetoothKind`, `planRoute(pref,
   strategy, detected)` → `{strategy, hold, evidence: 'measured'|'drive-decides', why}`. Runtime:
   `detectRoute()` (enumerateDevices inputs + outputs, `setSinkId` support), `beginCaptureRoute()` /
   `endCaptureRoute()` (declare `play-and-record` and/or hold an input by deviceId, read back and
   log), `routeSinkId()` for `speaker-sink`, `logRouteSnapshot()`.
2. Settings → In the car → **Audio route**: Auto / Phone speaker / Bluetooth, what was detected, a
   collapsed **Sound path while listening** (Auto / Web Audio / Declare play-and-record / Speaker
   output), and **Test this route**: mic open with the plan applied, the route clip played by the
   plan's path, "Where did that come from?", answered by voice (car / phone / headset / earpiece /
   nothing) or tap; logged as `route-test`.
3. Voice drills apply the plan at start and undo it at stop (`useVoiceControl`).
4. Test kit → three **Route** kits (phone only, car Bluetooth, headset), each step answering one
   unknown above, answered by voice, logged `kit-route-step`, summarised `kit-route-summary`.

## 4. What a drive (or a headset session) must decide

| Unknown | Kit step | Decides |
|---|---|---|
| Does declaring play-and-record before capture keep B on the car? | car `pr-webaudio` vs `auto-webaudio` | default strategy for B |
| Does holding the car input pin the car? | car `hold-bt` | whether Auto should hold the BT input |
| Phone mic held with the car connected: where does sound go? | car `hold-phone` | meaning of "Phone speaker" while connected |
| Sticky PlayAndRecord (S1 corollary) | car `quiet-close` | whether a half-duplex mode is worth building |
| Does declaring play-and-record move `<audio>` off the earpiece? | phone `pr-element` | whether TTS/element lines can be fixed |
| Does iOS list an `audiooutput`, and does `setSinkId` reach the loud speaker? | phone `snapshot` + `sink-element` | whether `speaker-sink` is real |
| Route C baseline and both candidates | headset kit | default for C |
| Does a second capture break the recogniser? | voice answers on `hold-*` steps (`via=voice` vs `via=tap`, `heard=`) | whether holding is safe at all |

---

## 5. Run sheet for Jack (Home → Test kit)

Each kit: tap it, tap **Start** (it lists what is connected and says how to answer), tap **Next**,
then every step plays a line with the mic on and asks "Where did that come from?" — say **car**,
**phone**, **headset**, **earpiece** or **nothing** (tapping works too; **Play again** if a step
misfired). At the end: Settings → Diagnostic log → Copy, and paste it.

1. **Route: phone only** — Bluetooth OFF, ring switch on, phone in hand (≈2 min).
   `auto-webaudio`, `pr-element`, `sink-element` (skips itself if no speaker output is listed),
   `quiet-close`. Hold the phone to your ear to tell the earpiece from the loud speaker.
2. **Route: car Bluetooth** — parked, engine on, connected (≈3 min).
   `auto-webaudio`, `pr-webaudio`, `hold-bt`, `hold-phone`, `quiet-close`. Run it twice if the
   first `auto-webaudio` says "car" — the bad state is intermittent, and a run in the bad state is
   the one that discriminates.
3. **Route: headset** — AirPods in your ears (≈3 min). `auto-webaudio`, `pr-webaudio`,
   `hold-phone`, `quiet-close`. Also say if a step sounded muffled like a phone call.

Lines to read in the paste: `route route-snapshot` (labels, outputs, `sinkId`), `test kit-answer
… via=voice|tap heard=…`, `route route-hold … got= trackSampleRate=`, `test kit-route-summary
kit=… hits=… byStep=…`.

Then, for day-to-day: Settings → In the car → **Audio route** → **Test this route** checks the
current setting in one tap (`route route-test … ok=`).
