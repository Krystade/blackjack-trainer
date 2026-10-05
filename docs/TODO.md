# TODO — working list

The list Claude maintains between sessions. It holds what is in flight and what is next, and
records **how** each item gets done, how we know it worked, and what it depends on.
`BACKLOG.md` is still where training-feature ideas get ranked; this file is the four
operating goals and the work under them.

**Status keys:** `[ ]` not started · `[~]` in progress · `[x]` done (with the commit) ·
`[?]` blocked on a decision from Jack · `[-]` dropped (with the reason)

**Rules for this file**
- Every item has a **Method** (what will actually be done) and a **Done when** (an observable
  result: a log line, a passing spec, a drive step, or Jack's ear), not "should work".
- A claim about the phone is settled by the phone. Desk results are labelled as desk results.
- Items are updated in the same commit as the work, never afterwards from memory.

Last updated: 2026-10-05 (first cloud session).

---

## The four goals

| # | Goal | Where it stands |
|---|------|-----------------|
| G1 | Phone alone, **no Bluetooth**: sound from the **loud speaker**, voice answers accepted | **Blocked in the browser.** Once the page has opened a mic, output goes to the earpiece for the rest of the page's life. Native is ruled out; three web/no-code probes are left (G1-a, G1-b, G1-e) |
| G2 | **Bluetooth on**: sound through the **car speakers**, voice answers accepted | Car output **works**. The mic side is unresolved: iOS picks the car's hands-free mic and the call route, and a web page cannot choose otherwise |
| G3 | Voice recognition that holds up at **freeway noise** | Misrecognises **even in a quiet room** ("hit" → "Add"). The cause is the recogniser model, not noise. Two-word commands and taught aliases shipped, but are **not yet measured** |
| G4 | Ongoing UX/UI improvement | Settings cull, wording pass and Flashcards layout are **in flight** (agents) |

---

## G0 · Housekeeping carried over from the local session

- [~] **Settings cull — preferences half** (In the car, Theme, Play, Drills, Audio, Car check).
  - Method: agent in an isolated worktree. Each setting is presumed dead unless proven live
    and wanted. Deletions remove the control, the stored field (plus a migration), the
    consuming branch and any tests that exist only for it.
  - Done when: merged, `tsc -b` + lint + vitest green, e2e shows no new failures, and the
    keep/kill table is posted for Jack to veto.
- [~] **Settings cull — voice/diagnostics half** (Car controls, mic panels, Diagnostic log,
  Voice control). Same method. Includes removing the dead **Switch** option: `persist.ts`
  rewrites `'switch'` to `'auto'` on every load, so picking it silently reverts. The three
  `speaker-handoff` specs that call `listenInCountDrill(page,'switch')` go with it.
- [~] **Wording pass — core screens** (Home, Table, Charts, Stats, ProfileEditor, App,
  components). One term per concept; glossary in the report. Voice vocabulary is untouched.
- [~] **Wording pass — drills + Field test**, now also covering the **Flashcards layout**
  from Jack's 2026-10-05 screenshots:
  - At 390×844 the action bar (Hit/Stand/Double/Split/Surrender) is below the fold.
    "Surrender" truncates to "Surren…".
  - Five toggles sit above the cards. Cull them to the Settings standard; survivors go
    behind a collapsed "Options".
  - The Listening panel takes three lines plus a permanent earpiece hint. Make it one line.
  - Done when: an e2e assertion at 390×844 shows the dealer card, the hand and the full
    action bar all inside the viewport without scrolling.
- [ ] **Merge the four agent branches**, resolve conflicts (`Settings.tsx` and `persist.ts`
  are touched by two of them) and run the full suite once. Push only after that.
- [ ] **Recover the local session's unpushed work.** The local transcript shows
  `e2e/drill-layout.spec.ts` (+100) and `__probe2.spec.ts` (+36), which never reached the
  remote. Two findings came with them:
  - **ZonePad surrender circle covers the quadrant labels.** The circle is `44vmin`,
    absolutely positioned at the centre, and ZonePad receives no legality information.
    - Method: pass legal actions into ZonePad. Size the circle so it cannot intersect the
      quadrant label boxes. Hide or disable surrender when it is illegal.
    - Done when: a layout spec asserts there is no bounding-box overlap at 375×812 and
      390×844.
  - **`playClipsResumable` race.** `stopActiveChain()` runs before the `await`s, so two
    calls 5ms apart both find nothing to stop and both start chains.
    - Method: take a chain token synchronously at entry, and have a stale chain bail
      after each `await`.
    - Also find the caller that asks to speak twice.
    - Done when: a unit test fires two calls back to back and only the second chain plays.
  - Ask Jack whether the local checkout still has these files. If not, rebuild them from
    the descriptions above.
- [ ] **Flaky `voice-aliases.spec.ts:119`.** The fake recogniser never fires
  `onaudiostart`, so every session waits out `AUDIOSTART_GRACE_MS` (1500ms). Under full-suite
  load that pushes it over the timeout.
  - Method: make the e2e fake fire `onaudiostart` right after `onstart`, as Safari does.
  - Done when: it passes 10/10 with `--repeat-each=10` under full-suite parallelism.
- [ ] **The other pre-existing red voice specs** (6 known; one is `field-test`). Root-cause
  each one. A spec that now tests a retired mode gets deleted along with the mode. A spec
  that catches a real bug gets the bug fixed. None is skipped.

---

## Test kit (Home → Test kit) — the one-button runner

- [x] **Shipped 2026-10-05.** Three kits: at my desk, car with Bluetooth, car without
  Bluetooth. Covers G1-a, G1-b, G1-e, G2-a, G3-a and the G3-e recordings in one guided run
  each. Step data and scoring: `src/diag/testKit.ts`. I/O: `src/diag/testKitIO.ts`.
  Screen: `src/ui/screens/TestKit.tsx`.
  - Results go to the diagnostic log under `test kit-*`. "Copy results" copies only the
    lines written since the kit started.
  - Recordings stay in memory until "Save recordings" (share sheet or download). They are
    never committed.
- [ ] Jack runs the **desk kit**. Then read the log and update G1/G2/G3 below with what it
  settled.
- [ ] Jack runs the **car kits**: Bluetooth on first (that's how he drives), then off.

## G1 · Loud speaker + voice, no Bluetooth

**Evidence so far (do not re-run):**
- `navigator.audioSession.type = 'playback'` while capturing: the log reads back `playback`,
  but the sound still comes out of the earpiece. Disproved.
- Capture stopped, `'playback'` declared, then clips played (the WebKit bug 218012 order):
  the 17:00 log on build `e60a90f` shows the mic shut and `type=playback` confirmed, with
  three seconds of clip on the earpiece. Disproved (commit `ec67e35`).
- "Switch" mode (close the mic around every utterance) caused a repeat loop and fixed
  nothing. Retired.
- Conclusion recorded in `ec67e35`: **once a page has opened a microphone, the loud speaker
  is gone for the life of that page.**

**Remaining methods, cheapest first:**

- [ ] **G1-a · One last web probe: Web Audio output instead of `<audio>`.** Every test so far
  played clips through media elements.
  - Method: decode a clip into an `AudioBuffer` and play it through the shared
    `AudioContext` while the mic is live. Add it as a Car check step and log the route
    readback. Only Jack's ear can tell which speaker it came out of.
  - Why it might differ: WebKit routes `AudioContext` and media elements through different
    session paths, and some iOS reports have them behaving differently after
    `getUserMedia`. Low odds, but cheap, and it is the only untested output path.
  - Done when: one parked test where Jack reports "speaker" or "earpiece" for each path.
- [ ] **G1-b · Page reload as a reset.** If the earpiece lock lasts for the page's life, a
  fresh page load starts on the speaker.
  - Method: measure whether a reload after mic use restores the speaker, and how long the
    page takes to come back to a ready drill.
  - Probably unusable mid-drill. Worth knowing because it bounds what "page life" means.
  - Done when: one parked reading.
- [-] **G1-c · Native iOS shell (Capacitor).** Dropped 2026-10-05. Jack: "no shot im making
  this an app, especially in its current state." Everything below stays inside the browser.
  Don't propose it again unless the web paths below are all exhausted *and* Jack raises it.
- [ ] **G1-e · iOS "Call Audio Routing" = Speaker** (no code).
  - Settings → Accessibility → Touch → Call Audio Routing → Speaker.
  - Why it might work: the earpiece is iOS's receiver route for a record-capable session,
    which is the same route a call uses. This setting forces call audio to the speaker
    system-wide, and may cover WebKit's capture session too. Untested.
  - Method: flip it, run one parked drill with voice on and no Bluetooth, and listen. Flip it
    back afterwards if it breaks anything else.
  - Done when: Jack reports "speaker" or "earpiece".
- [ ] **G1-d · Fallback that works today: no-mic speaker mode.** Voice off, answers by tap
  or wheel. The loud speaker holds because nothing ever opens a mic.
  - Method: make sure this is a one-toggle state and that the app never opens a mic in it.
    Add a Car check assertion that `session-at-mic-open` never appears.
  - Done when: a parked test on the speaker with zero mic rows in the log.

---

## G2 · Bluetooth: car speakers + voice

**Evidence so far:**
- Clips reach the car speakers over Bluetooth. Settled 09-27 and 09-29.
- The wheel arrives as `nexttrack`/`previoustrack`, and works with the screen off.
- Opening a mic switches the car to its hands-free CALL route. Wheel buttons then belong to
  the "call".
- WebKit sets `AllowBluetooth` (the hands-free profile, HFP) unconditionally for
  PlayAndRecord. The input is `currentRoute.inputs.firstObject`, which the page cannot
  choose. The log lists "iPhone Microphone | TOYOTA Corolla" with nothing to pick between
  them.
- The HFP mic is narrowband: ~8kHz, or 16kHz with wideband speech. That is a hard ceiling
  for recognition.

**Methods:**
- [ ] **G2-a · Settle which mic the recogniser is actually on, with Bluetooth connected.**
  - Method: the spectral probe from `a4d87bb` (`diag/micSpectrum.ts`), run in two places:
    - parked with the engine off;
    - on the freeway (drive card step 9).
  - `highRatio` near 0 with no live bands above 4kHz means the car mic over HFP. A
    wideband reading means the phone mic.
  - Done when: two readings logged, one per condition.
- [ ] **G2-b · Recheck "car speakerphone mic" feasibility** (Jack: "doesn't seem feasible,
  will need to recheck").
  - Method:
    - Compare recognition accuracy on the same word list through each input. Use
      intent-labelled samples from G3-a, not impressions.
    - If HFP is wideband in this car (mSBC, 16kHz), the car mic may be *better* than the
      phone in the cradle: it is closer to the mouth and has the car's own noise processing.
  - Done when: per-input accuracy on ≥20 labelled words each, at freeway speed.
- [-] **G2-c · Native A2DP output + phone mic.** Dropped with G1-c (no native app). On the
  web the input is whatever iOS picks. The only levers left are which Bluetooth profile the
  car offers (G2-e) and when the mic is open (G2-d).
- [ ] **G2-e · Car-side and phone-side settings** (no code).
  - Check the car's Bluetooth phone settings for a "hands-free mic" or "phone audio" option.
    Some Toyota units let media and phone profiles be paired separately.
  - Check that iOS Bluetooth → the car → Device Type is "Car Stereo".
  - Method: one parked session per setting change, with the spectral probe (G2-a) recording
    which input was live.
  - Done when: each setting has a probe reading against it.
- [ ] **G2-d · Web-only mitigation: wheel push-to-talk.** Keep the mic closed by default,
  so the car stays on the media route. A wheel press opens the mic for one answer window,
  then it closes.
  - Cost: each open re-enters the call route (~1.2s handshake, measured `confirmedInMs`),
    and the route settle (~1.6s) applies when the mic closes.
  - Method: prototype behind a setting. Log open→heard→close timings on a drive.
  - Done when: a drive log shows the wheel working between answers and an answer accepted
    after each press.

---

## G3 · Recognition in freeway noise

**Evidence so far:**
- Room test 2026-10-05: quiet room, wideband phone mic, `audiostart afterStartMs=0`, and
  "hit" still came back as "Add" (confidence 0.737; the four correct words were 0.86–0.997).
  So it is **not** noise, the car mic, or a clipped onset. It is the model.
- WebKit runs Web Speech with `SFSpeechRecognitionTaskHintDictation`. Only lang,
  continuous, interimResults and maxAlternatives reach it: no `.confirmation` hint, no
  contextual strings.
- Shipped but unmeasured:
  - two-word command forms ("hit me", "stand pat", …), commit `bd060dd`;
  - taught aliases (`18cb059`);
  - asking for 10 alternatives, with `asked`/`offered` logged.
- `offered=1` in 5 of 5 samples: iOS may only ever return one transcription. Unconfirmed.

**Methods:**
- [ ] **G3-a · Build a measurement before changing anything else.** Nothing currently
  records what Jack *meant*, so no change can be scored.
  - Method: a "calibration" run in Car check/Field test.
    - The app shows (and, through the car, speaks) a target word.
    - Jack says it, and the app logs `target`, `heard`, `confidence` and `offered`.
    - 20 words per run, alternating one-word and two-word forms *within* the run, so road
      noise affects both arms equally.
  - Output: accuracy for one-word vs two-word forms, and a confusion list that seeds the
    aliases automatically.
  - Done when: one parked run and one freeway run produce two accuracy numbers each.
- [ ] **G3-b · Decide the vocabulary from G3-a data.**
  - Method: keep whichever form scores higher. Pick replacement words with distinct
    consonant skeletons (the matcher keys on those) and ≥2 syllables, e.g.
    "hit"→"hit me", "stand"→"stay" (test it).
  - Done when: the winner is the documented default and the loser is retired or kept as an
    alias only.
- [ ] **G3-c · Use alternatives properly if iOS returns them.** If G3-a shows `offered>1`,
  rescore all alternatives against the active command set before rejecting.
  - Method: the rescoring exists in `resolveSpoken` with length guards. Confirm it is wired
    on every drill path.
  - Done when: a logged rescue (`rank>0` accepted) on the phone.
- [ ] **G3-d · Constrained-vocabulary recogniser in the browser.** This is the main lever
  for G3 now that native is out: a recogniser that can only answer with one of ~12 words
  cannot hear "Add".
  - Native route: dropped (see G1-c).
  - Web route: `getUserMedia` (with `noiseSuppression`/`echoCancellation`) feeding a
    WASM recogniser restricted to a grammar. Candidates: Vosk with a JSON grammar list, or
    a small custom keyword-spotting model.
    - Caveat: this still opens a page mic, so G1's earpiece problem stays on the web path.
    - Upside: it beats G3's model problem without native.
  - Method: prototype the web version offline first, since it can be desk-tested in
    Chromium. Measure the bundle size (the Vosk small English model is ~40MB, cached once)
    and latency.
  - Done when: in a desk test with recorded road noise mixed in at freeway SNR, the
    grammar recogniser beats Web Speech on the same labelled clips.
- [ ] **G3-e · Recorded-noise test bench (desk).** Today every recognition change waits for
  a drive.
  - Method:
    - Record Jack saying the command set once, parked (a calibration run that saves audio,
      opt-in).
    - Record ~60s of freeway cabin noise.
    - Mix them at −5/0/+5/+10 dB SNR.
    - Play the mixes into Chromium's fake mic (`--use-file-for-fake-audio-capture`) for any
      web recogniser, or into the native recogniser on a Mac.
  - Note: recordings contain Jack's voice. Keep them off the public repo, as with the drive
    logs.
  - Done when: `npm run noise-bench` prints accuracy per SNR per recogniser.
- [ ] **G3-f · Prompt and turn-taking hygiene** (affects G1 and G2 too).
  - Mic opens only after the app stops talking: shipped in `e60a90f`. Verify on the drive
    log.
  - Mic-live tone: shipped. Check that its timing aligns with `audiostart`, not `onstart`.
  - Done when: a drive log shows no `mic suppressed` rows caused by our own prompt.

---

## G4 · UX/UI

- [~] Settings cull, wording pass, Flashcards layout (see G0).
- [ ] **Car mode screen.** One screen for driving: big text, the current prompt, a single
  status line (listening / speaking / heard X), no toggles.
  - Method: derive it from the Flashcards and count-drill layouts once the G0 layout work
    lands.
  - Done when: Jack uses it on a drive and the note box has no layout complaints.
- [ ] **Listening status line.** Show "heard X → not a command" briefly, then clear it.
  Point at teaching that word as an alias when it repeats.
- [ ] **Layout regression guard.** One spec visits every screen at 375×812 and 390×844 and
  asserts that primary actions are in the viewport and no text is truncated
  (`scrollWidth > clientWidth` on buttons).

---

## Decisions waiting on Jack

1. ~~Native shell?~~ **No** (2026-10-05). Web-only from here.
2. **Unpushed local work** (`drill-layout.spec.ts`, `__probe2.spec.ts`, any uncommitted
   fixes): is it still on your Mac? Push it, or I rebuild it.
3. **Voice recording for the noise bench (G3-e):** OK to record your command words once,
   stored locally and never committed?
