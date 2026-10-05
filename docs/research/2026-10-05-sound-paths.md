# Sound-path audit (read-only), HEAD 7826a3e

Method: grep of every `new Audio(`, `.play(`, `speechSynthesis`, `AudioContext`, `createBufferSource`, `createOscillator`, `speak(`/`speakAsync(`/`chime(` call site; the real `segmentForClips` run against `public/clips/af_bella/manifest.json` (586 clips; the other two voices ship the same set) on scratch copies of the app's own sentence builders. Scratch tests lived outside the repo; the repo was not edited. `scripts/clipCoverage.test.ts` and `spokenPhrases.test.ts` pass (36/36), which is exactly the problem: they only cover what `narrate.ts` and `FIELD_TEST_STEPS` own.

There is no `createOscillator` anywhere in `src` any more (tone.ts is WAV-by-arithmetic).

## 1. Every way the app makes sound

"Earpiece after mic?" = can it still come out of the quiet receiver once `getUserMedia`/recogniser has opened in this page.

| # | Path | Where | Engine | Earpiece after mic? |
|---|------|-------|--------|---------------------|
| 1 | Recorded clip chains, mic live or `micSessionCostPaid()` | clips.ts:1017-1030 `playChainThroughWebAudio` (decode 773, `createBufferSource` 891) | Web Audio | No (7/7 loud). Falls back to row 2 silently if ctx not `running` after one un-gestured `resume()` (clips.ts:826-834), if no ctx, or first clip fails to decode |
| 2 | Recorded clip chains, mic never opened (or WA fallback) | clips.ts:1032-1160 (`new AudioCtor` 450/483, `audio.play()` 1148) via `takeIdleAudio` pool | `<audio>` | Yes, whenever it is the WA fallback; fine before any mic |
| 3 | Mid-chain WA break (decode of clip N fails) | clips.ts:~925 `settle(false)`; speech.ts:959/1364 `speakAsyncLive(remainder)` | speechSynthesis | Yes (row 6) |
| 4 | **Chimes: `chime()`** kinds ready/turn/heard/good/bad/attention/blocked/mark | speech.ts:1456-1531 -> `playPooledTone` clips.ts:552-600 (`audio.play()` 580), data-URI WAV from tone.ts | `<audio>` pool | **YES, always.** Never consults `micSessionCostPaid()`. Used by useVoiceControl.ts:373 (`heard`), :406 (`turn`), the `ready` cue (speech.ts:648), every drill `audio.ding`, FieldTest (15 sites), Settings "Test audio" (Settings.tsx:482). This is now the loudest remaining inconsistency: prompt on loud speaker, "your turn"/"got it" beep on the earpiece |
| 5 | `chimeWhenQuiet` / held cues | speech.ts:~640-650 -> `chime()` | same as 4 | Yes |
| 6 | Live TTS fallback `speak()` / `speakAsync()` -> `speakAsyncLive` | speech.ts:1182-1244 `new SpeechSynthesisUtterance`, `synth.speak` | speechSynthesis | **Yes, presumed and UNMEASURED.** Cannot be routed through Web Audio. Every sentence in section 2 lands here. (TODO.md says "may"; nothing in the logs or test kit measures TTS with the mic open: testKitIO `say()` is only used "before any mic".) |
| 7 | Settings voice-picker preview `'Queen. True count plus three.'` | Settings.tsx:435 | speechSynthesis by design (previews a `voiceURI`) | Yes, acceptable: Settings, deliberate |
| 8 | Settings "Test audio": clip + chime | Settings.tsx:476-482 | clip: row 1/2 by mic flag; chime: row 4 | chime yes |
| 9 | Silent keep-alive loop (audioFocus) | audioFocus.ts:172, 347 `element.play()` on `silentWavDataUri()`, `loop=true` | `<audio>` | Inaudible. Not a sound, but it IS an `<audio>` element playing for the whole voice session next to Web Audio. Unmeasured whether it affects routing; low suspicion. It is what actually holds the head-unit/wheel slot now that clips no longer create a media element |
| 10 | Unlock / priming | unlock.ts:60-90: `getSharedAudioContext()` + `resume()`, `primeClipAudio()` (clips.ts:478) primes 3 pool elements | both, inaudible | n/a. Gap: unlock runs once (`unlocked` flag, listeners removed), so a context that later goes `interrupted`/`suspended` (mic open/close, call, background) is never re-resumed inside a gesture. See P1-3 |
| 11 | Test kit `playThrough('element'|'webaudio')` | testKitIO.ts:71 (`new Audio`), 80-90 (`createBufferSource`) | deliberate A/B | by design |
| 12 | Test kit `tick()` word-slot beep | testKitIO.ts:104 `new Audio(toneDataUri(880,0.6)).play()` | `<audio>` | Yes (and not even pooled, so can be refused outside a gesture). Diagnostic only; it plays with the mic open during calibration |
| 13 | Test kit `say()` | testKitIO.ts:113-118 | speechSynthesis | Yes, but documented "before any mic" |
| 14 | Test kit `unlockWebAudio` silent 1-sample buffer | testKitIO.ts:48-62 | WA, inaudible | n/a |
| 15 | Field test speech: `speakAsync` (instructions, echo lines, ambient lines, pause line) | FieldTest.tsx:655, 1678, 2079, 2355, 2402, 2840 | same as rows 1/2/6 | follows clip coverage; see section 2. NOTE the route-sample cells now run on Web Audio after any mic open, so legacy "post-mic = earpiece" cell definitions in fieldTest.ts (e.g. :1016, route-earpiece answers) no longer test what they say |
| 16 | Field test chimes | FieldTest.tsx:654, 813, 1377, 2484, 2586-2790, 3034-3159 | row 4 | Yes |
| 17 | Field test mic taps: `measureWithWebAudio` (getUserMedia, carCheckCatalog.ts:664), micSpectrum.ts:205-218, environment.ts:302 `logSelectedInput`, testKitIO `openMic`/MediaRecorder:275 | | input only | **Mic opens but `markMicSessionOpened()` is NOT called** (only useVoiceControl.ts:320 on recogniser `listening`). After a field-test ambient reading, spectrum, or kit mic step, `micSessionCostPaid()` is still false, so clips take the `<audio>` path = earpiece, until a voice session starts. See P0-2 |
| 18 | Car-check catalog sound checks (`audioOutCheck`, `elementVolumeCheck`, `chimeAudibleCheck`, `clipSpeedCheck`, `outputRouteCheck`, handoff) | carCheckCatalog.ts:104, 347, 393, 452 (`el.play()`), 548-575 | `<audio>` | Dead code: the app imports only `measureWithWebAudio` and `listAudioInputs` from this module (FieldTest.tsx:77). Not reachable by a user |
| 19 | e2e audio mode (`?e2e=1`) | speech.ts:~12, 848-890 | log only | n/a |

Not present: oscillator, MediaElementSource, `setSinkId`, any other `new Audio(` in `src` (checked all .ts/.tsx excluding tests).

## 2. Lines with NO recorded clip (fall to speechSynthesis, can never use Web Audio)

Cascade rule (clips.ts:169-185): split on `(?<=[.?!]) `, every sentence must be an exact manifest key; one miss sends the WHOLE utterance to TTS. Results below are from the real cascade.

### 2a. Whole families that are 100% on TTS today

1. **True-count drill question, every one.** `narrateTcQuestion` (TrueCountDrillView.tsx:47-49) returns `Running count minus three. Two decks remaining` with NO final period. All 492 combinations (RC -20..20 x 0.5..6 decks in 0.5 steps) miss; with a trailing "." all 492 resolve using existing clips. Plays at :216, :232, :261, :464, :500 and via `audio.sayFull` :218. Zero new clips needed. (This is the single most impactful gap: it is the first thing the drill says every round.)
2. **Produce-TC drill depth prompt**: `"Half a deck remaining. Produce the true count."` ... `"Six decks remaining. Produce the true count."` (12 variants, ProduceTcDrillView.tsx:210, :375, :379). The depth sentences exist; only **"Produce the true count."** is missing (1 clip).
3. **Flashcards wheel self-check reveal**: `"hit. Had it?"`, `"stand. Had it?"`, `"double. Had it?"`, `"split. Had it?"`, `"surrender. Had it?"` (Drills.tsx:727-730; note lowercase `narrateAction`). The quiz/mixed twins already do it right (`narrateAnswerEcho(label) + DID_YOU_HAVE_IT` = "Hit." "Did you have it?", all covered). Zero clips: copy that pattern.
4. **Quiz zone-pad refusal when the action is legal but not part of the question**: `"Hit isn't part of this question."`, `"Stand ..."`, `"Double ..."`, `"Split ..."`, `"Surrender ..."` (answerGate.ts:101-103 `actionNotAsked`, spoken via Drills.tsx:1408, :2057). The sibling `"X isn't available on this hand."` IS covered. 5 clips.
5. **Count drill, honor-system result**: `"Correct. The count was -5. Say yes to go again."` / `"Wrong. The count was 12. ..."` (CountDrillView.tsx:1171, digits, every value). The non-honor branch (`narrateCountAnswer`) is covered for -20..20. Zero clips: use `narrateCountAnswer(actualValue)` in both branches, or add "The count was ..." variants.
6. **Countdown-mode verdict**: `"Correct. The card left over was ace, minus one."` (13 ranks x 2 verdicts x 3 tags = 78 strings, all miss; CountDrillView.tsx:1141-1144, spoken :1156, repeated :1168). Fix by splitting into sentences the cascade already has: `Correct.` + `The card left over was ace.` (13 new clips) + `minus 1.` / `plus 1.` / `zero.` (exist). Note `speakableCount` yields digits ("minus 1."), which is what the existing clips say.
7. **Table count prompt while voice is on**: `"Running count?"` and `"True count?"` (Table.tsx:571, spoken :487, :492, :579; the modal opens after every hand when count checks are on). Existing: "What's the running count?"; "What's the true count?" does not exist. 2 clips (or reuse `narrateCountPrompt()` + 1 new clip).
8. **Push result**: `"Push."` has no clip (narrate.ts:274). Every push at the table is TTS. 1 clip. Nothing in clipCoverage covers `narrateResult`.
9. **Settlements**: `"Win, plus one."`, `"Win, plus one point five."`, `"Lose, minus two."`, `"Blackjack! Plus one point five."`, `"Surrender, minus zero point five."`, and multi-hand `"Hand two: Win, plus ..."` (narrate.ts:264-300). 0 of 40 sampled resolve. Documented as unbounded. It is bounded in practice (bets are in half-unit steps), and the fix is the same trick narrate.ts already uses for bot turns: two sentences (`Win.` / `Lose.` / `Blackjack!` / `Surrender.` + `Plus one point five.`), clips for a bounded amount list; `Hand two.` as its own sentence. Table only; voice is on at the Table.

### 2b. Dynamic / unbounded, only worth it if the hit-rate matters

10. Timed Challenge speed line, eyes-free only: `"1:23, 1.4 seconds per deck. Fast."` (CountDrillView.tsx:1133). Dynamic, leave on TTS, or drop it while the mic has been used.
11. Distraction arithmetic, eyes-free: `"-5 + (-6)"`, `"4 + 2"`, `"8 × 2"` (CountDrillView.tsx:435, :1365; distraction.ts). 0/60 resolve. TTS reading "(−6)" and "×" is also dubious. Could be built from number clips with a different template ("Five plus six.") but that is a feature, not a fix.
12. Stats summary `"This session: 12 decisions, 2 mistakes."` (Stats.tsx:349 via `narrateStatsSummary`). Unbounded; Stats screen only, user-triggered.
13. Count read-back / answer beyond +-20 (`narrateReadback(25)`, `"The count is minus 25."`): clips stop at +-20 (spokenPhrases TC_MIN/MAX). A 52-card run cannot reach that, but a deep shoe can; harmless.

### 2c. Field test and misc literals (no clip)

- `"The field test is paused. Resume is the first button on the screen."` (FieldTest.tsx:655)
- Phone-lock results (FieldTest.tsx:2070-2079): `"The page kept running while the phone was locked."`, `"The page slowed down while the phone was locked, but kept running."`, `"The page was frozen while the phone was locked."`, `"That was too short to tell. Lock it again, for longer."`
- Deliberately unclipped calibration line (fieldTest.ts:1040, 1623) -> intended.
- Settings voice preview `"Queen. True count plus three."` -> intended TTS.
- ECHO_LINES, FIELD_TEST_STEPS `say`, corrections, bot turns, deal/shuffle/sit-out, quiz and flashcard prompts, answer echoes, "Did you have it?", all VOICE_CONVERSATION_LINES: covered (tests pass).

### 2d. Why the tests did not catch any of this
`clipCoverage.test.ts` + `spokenPhrases.ts` only see sentences that live in `src/audio/narrate.ts`. Every gap above is composed inline in a view (`narrateTcQuestion`, `countdownVerdict`, `resultSpeech`, `${action}. Had it?`, `Produce the true count.`, Table `countPromptText`) or in `narrateResult`/`actionNotAsked`, which the extractor does not enumerate. The fix that sticks: move each sentence builder into narrate.ts, list it in the extractor, regenerate `spoken-phrases.json`, add a coverage assertion. narrate.ts:372-410 documents this exact migration for the D2 lines.

## 3. Things that assume the earpiece is unfixable / are stale or now misleading

User-visible (wrong or misleading now):
- `src/ui/screens/Settings.tsx:258-267`: "Voice was used, so iOS may have moved the sound to the earpiece. Nothing in the app moves it back; reopening the app does." Shown for the rest of the page after any mic open, though recorded lines are on the loud speaker. True only for chimes and phone-voice lines. Misleading both ways: it tells the user to restart the app for a problem the clips no longer have.
- `src/ui/components/VoiceStatusBar.tsx:30-35` (`.voice-status-earpiece`) with doc comment :14-16: "If the sound moved to the earpiece, the microphone did it, reopening the app brings the speaker back." Same issue; appears on seven screens.
- `e2e/earpiece-notice.spec.ts:6-24` (header "It is not a fix... nothing to call"), :68-95 asserts the text containing "reopen". Must change with the two strings.

Comments / docs that now state the opposite of the code:
- `src/audio/clips.ts:795` "Used only while a voice session is running" (code at :1017 also uses it after the mic closes). `clips.ts:399` "ONE POOL, because clips never touch Web Audio any more" is false.
- `src/audio/unlock.ts:79-82` "Clips no longer go anywhere near the graph" and `:98-105` "no amount of digital gain competes with that" (about the earpiece).
- `src/audio/micSessionCost.ts:4-35, :44-46` ("There is nothing to call", "True means the audio is on the earpiece and will stay there until the app is closed"). The flag now means "use Web Audio", not "all audio is on the earpiece". `:62-70` doc for `isVoiceCaptureActive` mixes both.
- `src/audio/tone.ts:1-30`: argues the graph does not reliably wake and "the plain media element does", which is the opposite of the clip design and will be wrong if chimes move to Web Audio (the 2026-10-03 `chime-suspended` evidence still stands as a fallback requirement).
- `src/audio/speech.ts:906-908` "a clip is an element the head unit can see and the volume boost can reach": clips with the mic open have no element (head unit relies on the silent loop in audioFocus.ts). `:1456-1531` chime doc "ON AN ELEMENT, NOT AN OSCILLATOR". `:396` "Clips play through HTMLAudioElement".
- `src/audio/volume.ts:71-73` and Settings.tsx:249-252 ("Neither voice can go past 100% on iOS"): a gain node on the WA path could exceed 1, though 2026-10-02 showed amplification wrecking playback; leave, but the sentence is about the old path.
- `src/diag/carCheck.ts:36-47` ("nothing in a page could be found that moves it back"), `:238`; `src/diag/carCheckCatalog.ts:520-540, :557` (the output-route check plays on the element, so it measures the old path); `src/diag/testKit.ts:88-97` ("The untested path. If this one says loud speaker, the earpiece problem has a fix": answered). `src/audio/audioSession.ts` header and `src/store/persist.ts:75-86` are accurate history.
- `src/ui/screens/Drills.tsx:175-177` comment "the earpiece explanation is dropped because Settings carries its own copy".
- `docs/TODO.md`: G1 row was "Blocked in the browser" at line 25 when first grepped; it now says "Fixed in a real drill" (the file changed during the audit, probably by another agent). `docs/TODO.md:110-158` is historical. `docs/research/*` and `docs/2026-09-30-drive-card.md` are dated records; leave.

## 4. Prioritised fix list

### P0-1. Play chimes through Web Audio once the mic has been opened
- What: in `chime()` (speech.ts:1526-1531), when `isVoiceCaptureActive() || micSessionCostPaid()`, play the tone via the shared context: build a mono `AudioBuffer` once per frequency (fill the same faded sine tone.ts computes, `ctx.createBuffer(1, 2880, 24000)`, or `decodeAudioData` of the existing WAV bytes), `createBufferSource` -> `createGain` (gain = `chimePeak(volume)`) -> destination. Put it next to `playChainThroughWebAudio` (e.g. `playToneThroughWebAudio` in clips.ts). Must NOT use `activeChain` (chimes must never stop a prompt; clips.ts:540-547). Fall back to `playPooledTone` if no ctx or the ctx is not `running` after `resume()`, and log `chime path=webaudio|element` plus the existing `chime-suspended`.
- Risk: the tone.ts header documents a context staying `suspended` 8 s after a gesture on this phone (2026-10-03, build 89bd8db). That would make a silent beep, hence the mandatory element fallback; before the mic opens keep the element path (obeys nothing, same as today). Chimes overlap prompts (allowed) but now both go through the same context; check the gain stage does not clip when summed.
- Verify on phone (no Bluetooth, ring switch both positions): voice on, run Flashcards. Blind or by ear: the "your turn" tone, "got it" tone and Settings > Test audio beep should all come from the bottom speaker, same as the prompt. Export check: `speak chime kind=turn path=webaudio` and no `chime-suspended`. Then voice off and trigger a drill ding: still bottom speaker.

### P0-2. Mark the mic as opened from every opener, not just the recogniser
- What: call `markMicSessionOpened()` right after each `getUserMedia` resolves: carCheckCatalog.ts:651 (field test ambient), micSpectrum.ts:207, environment.ts:302, testKitIO.ts:275 (and `openMic`). Simplest: one helper `openMicStream(constraints)` in a new file that wraps `getUserMedia` and marks; replace the five call sites. Also mark when the recogniser reaches `starting` rather than only `listening`? `setVoiceCaptureActive(true)` at useVoiceControl.ts:454 already covers that window.
- Risk: the field test and test kit measure route cells keyed on mic state; flipping the clip path after an ambient reading changes which engine those route samples use. Coordinate with the protocol (leave the flag unset inside field-test legs, or record `path=` per sample; clip-chain already logs `path=webaudio`). 
- Verify: fresh page load, Field test ambient measurement (5 s mic), then speak a clip: log must show `clip-chain path=webaudio` and sound from the bottom speaker. Before this change it shows the element path and earpiece.

### P1-1. Close the whole-utterance TTS gaps that need zero or few clips (section 2a)
Do in this order, each is independent:
1. `narrateTcQuestion`: add the trailing period (or append "." in `narrateDecksRemaining` callers). 0 clips, fixes 492 strings. Move the builder to narrate.ts so a test covers it.
2. Flashcards reveal (Drills.tsx:727): use `narrateAnswerEcho(label) + ' ' + DID_YOU_HAVE_IT`. 0 clips.
3. Count drill honor result (CountDrillView.tsx:1171): use `narrateCountAnswer`. 0 clips.
4. Add clips: `Produce the true count.`; `Hit/Stand/Double/Split/Surrender isn't part of this question.` (5); `The card left over was <rank>.` (13) and reformat countdown verdict into sentences; `Push.`; `Running count?` and `True count?` (or reuse `narrateCountPrompt` + `What's the true count?`).
5. Phone-lock lines and the paused line (5 clips) if the field test is still being driven by voice.
- Where: add each sentence builder to narrate.ts; extend scripts/spokenPhrases.ts (and its expected-set test) and clipCoverage.test.ts; regenerate with `scripts/generate-audio-clips.py` for all three voices (af_bella, bf_emma, bm_george); the existing test "ships a file for every clip the manifest names" then guards the files.
- Risk: low. Clip regeneration changes three manifests and ~30 mp3s; the sentence-wording changes alter spoken output slightly (e.g. "Hit. Did you have it?").
- Verify: export shows `speak path path=clip` (not `tts why=no-clip`) for each line. Quick check in the field: run the TC drill eyes-free and read `path=` for the first prompt of every round.

### P1-2. Settlements (Table)
Split `narrateResult`/`narrateHandResult` into bounded sentences (`Win.` + `Plus one point five.`, `Hand two.`) and ship amount clips for the bet grid you actually use. Highest-frequency TTS left at the Table once P1-1 is done. Medium effort, low risk. Verify: play a hand with voice on, `path=clip` on the settlement.

### P1-3. Do not let Web Audio silently fall back to the earpiece
- What: (a) keep a persistent capture listener (`pointerdown`/`click`, plus `visibilitychange`) that calls `resumeSharedAudioContext()` when `ctx.state !== 'running'`, instead of the one-shot unlock (unlock.ts:~117-135). iOS moves a context to `interrupted`/`suspended` around mic open/close, calls and backgrounding; `playChainThroughWebAudio` only does an un-gestured `await ctx.resume()` (clips.ts:826-834), which can refuse, and then the whole chain plays on the element = earpiece. The wheel buttons are not gestures, so a steering-wheel session can hit this repeatedly. (b) Always log the fallback with the reason (it already writes `clip-webaudio-skip why=context-<state>`); add a counter to the export summary. (c) When the mic is paid and WA is unavailable, prefer TTS? No: keep the element, but log `earpiece-risk`.
- Risk: low. Verify: with voice on, lock the phone for 30 s, unlock, answer by wheel: next prompt must be `path=webaudio`; grep the export for `clip-webaudio-skip`.

### P1-4. Measure live TTS routing, then decide
No data exists for speechSynthesis with the mic open. Add two steps to the test kit (mic open and mic closed-after-open) that call `say()` and ask the same blind route question, plus the same for the `tick()`/chime path. If TTS is on the earpiece (likely), every remaining gap in section 2 is a real earpiece event, and P1-1/P1-2 are the fix. Also log `speak path=tts micPaid=true` (recordSpeechPath in speech.ts) so a drive export can list exactly which lines hit the earpiece-risk path. Low risk.

### P2-1. Rewrite the earpiece notices to match reality
Until P0-1 and P1 land, change Settings.tsx:258-267 and VoiceStatusBar.tsx:30-35 to say what is true: e.g. "Recorded lines play from the loud speaker. Alert tones and the phone's own voice may use the earpiece after voice has been on." Better: show the notice only when the app has actually used a non-Web-Audio path after the mic opened (a module flag set where the element path or TTS is chosen with `micSessionCostPaid()` true). Drop "reopening the app" advice for clips. Update e2e/earpiece-notice.spec.ts:6-24 and :68-95. Remove the notice entirely once P0-1 and P1 are done and TTS fallback is rare.

### P2-2. Fix stale comments (section 3), same commit as the code they describe
`clips.ts:399, 795`, `unlock.ts:79-82, 98-105`, `micSessionCost.ts:4-46, 62-70`, `tone.ts:1-30`, `speech.ts:396, 906-908, 1456-1531`, `testKit.ts:97`, `carCheck.ts:36-47, 238`, `carCheckCatalog.ts:520-557`, `Drills.tsx:175-177`. No behaviour change. Rename `micSessionCostPaid` semantics in its doc to "mic has been open; use Web Audio".

### P2-3. Smaller items
- Test kit `tick()` (testKitIO.ts:104) should reuse the pool or WA; it is an unpooled `new Audio` and can be refused outside a gesture.
- Delete or quarantine the dead car-check catalog checks (carCheckCatalog.ts:90-600): they test the element path, are unreachable, and their strings are stale.
- Pre-decode: with the mic paid, `decodeClip` fetches and decodes on first play (clips.ts:773-788), adding latency to the first line of each kind; warm the common clips (digits, ranks, "Correct.", "Wrong.") when `micSessionCostPaid()` flips.
- Unmeasured: the silent audioFocus `<audio>` loop next to WA (row 9). If a blind run ever puts WA on the earpiece with the loop running, test with the loop paused.
- Bluetooth: WA clips create no media element, so now-playing/AVRCP and the "head unit sees the clip" assumption (speech.ts:906, mediaSession.ts:1-12) rest entirely on the silent loop. TODO already lists "Web Audio over Bluetooth with mic open" as the first parked check; keep it.

## 5. One-line phone checklist (after P0 + P1-1)
Fresh page, no Bluetooth, ring switch on: Flashcards with voice on -> every prompt, every beep, every correction from the bottom speaker; TC drill eyes-free -> question is `path=clip`; Table with voice -> Push/Win lines `path=clip`; voice off -> still bottom speaker; export has no `speak path path=tts` except the settlement amounts you have not clipped yet.
