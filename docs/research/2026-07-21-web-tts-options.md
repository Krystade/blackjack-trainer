# Web Speech Synthesis research: voice quality + pacing fixes for the blackjack trainer

Date of research: 2026-07-21. This is a static-site (Vite, GitHub Pages, no backend, no committed API keys) React/TS app. Two defects investigated: (A) default desktop voice sounds robotic, (B) fixed-`setTimeout` pacing lets the speech queue drift/pile up behind the UI.

Tagging: **[VERIFIED]** = read directly from an authoritative source (MDN, a browser vendor bug tracker/intent thread, or a first-party engineer statement) this session. **[SECONDARY]** = a blog/aggregator source, generally reliable but not vendor-authoritative — treated as corroborating, not load-bearing. **[INFERENCE]** = my own reasoning/arithmetic, not directly sourced.

---

## 1. Voice selection: what "good" looks like and how to detect it

There is **no reliable programmatic quality signal** in the `SpeechSynthesisVoice` API. The interface only exposes `name`, `lang`, `voiceURI`, `localService`, and `default` — all read-only [VERIFIED, MDN SpeechSynthesisVoice]. `localService` tells you *on-device vs. network-backed*, not quality — a local voice can be an old robotic SAPI voice (Microsoft David/Zira) or a good on-device neural voice, and a network voice can be Google's higher-quality cloud voice. There's no `quality` field. Consequently every real-world "pick a good voice" implementation is a **curated heuristic over `voice.name`**, not a computed metric.

The most maintained reference for this is Hadrien Gardeur's community list, now folded into the **Readium Speech** project. It explicitly abandons attribute-based detection and instead ships hand-curated JSON voice-quality rankings (`veryHigh` / `high` / `normal` / `low` / `veryLow`) per platform, because names are inconsistent and localized [SECONDARY, github.com/HadrienGardeur/web-speech-recommended-voices]. That is a strong signal this problem doesn't have a clean heuristic solution — only a maintained allowlist/blocklist.

### Recommended heuristic (concrete, implementable today)

Score candidate voices and pick the highest score, falling back gracefully:

```ts
function scoreVoice(v: SpeechSynthesisVoice): number {
  let score = 0;
  const name = v.name.toLowerCase();
  if (!v.lang.toLowerCase().startsWith('en')) return -1; // hard filter to app's language
  if (name.includes('google')) score += 30;               // Chrome desktop/Android cloud voices
  if (name.includes('natural') || name.includes('neural')) score += 30; // Edge "Online (Natural)" voices
  if (name.includes('microsoft') && (name.includes('online') || name.includes('natural'))) score += 25;
  if (name.includes('samantha') || name.includes('alex') || name.includes('ava') || name.includes('daniel')) score += 15; // decent macOS/iOS built-ins
  if (name.includes('microsoft david') || name.includes('microsoft zira') || name.includes('microsoft mark')) score -= 20; // legacy SAPI5 desynth, the "robotic" voices
  if (name.includes('espeak') || name.includes('festival')) score -= 30; // Linux/ChromeOS robotic fallback
  if (v.localService) score += 5;   // slight bonus: lower latency, no network stall
  if (v.default) score += 2;
  return score;
}

const best = voices
  .map(v => ({ v, s: scoreVoice(v) }))
  .filter(x => x.s >= 0)
  .sort((a, b) => b.s - a.s)[0]?.v;
```

This matches the pattern other implementers actually ship: filtering on substrings like `"Google US English"` or `"Natural"` in `voice.name` is the documented practical approach [SECONDARY, multiple sources including talkrapp.com and dev.to write-ups]. **Always let the user override via the existing voice picker** — the heuristic is a default, not a lock-in, because name strings drift across OS/browser versions.

### Per-platform notes

- **Windows Chrome** (this user's reported complaint): the OS ships legacy SAPI5 voices — "Microsoft David Desktop" / "Microsoft Zira Desktop" — which is very likely the "awful, robotic" voice being described. Chrome on Windows also surfaces Google's network-backed voices (e.g. "Google US English") when online, which sound substantially better [SECONDARY, corroborated by the voice-list default-selection discussion in the Mozilla bug tracker, bugzilla.mozilla.org #1545952]. **The single highest-value fix for defect (A) is defaulting to a `name.includes('google')` voice on Chrome instead of the SAPI default.**
- **macOS**: Safari's `getVoices()` does **not** return all voices installed in System Settings — confirmed directly by an Apple Frameworks engineer: *"It is expected that with Web Speech APIs only the pre-installed voices are available. Optionally downloadable voices are not available."* [VERIFIED, developer.apple.com/forums/thread/723503]. Chrome and Edge on macOS, by contrast, **do** list all OS-installed voices, including ones the user downloaded [VERIFIED, same thread]. So on Mac, if a user downloads a Premium/Enhanced voice in System Settings, it's reachable from Chrome but generally not from Safari. This has reportedly gotten worse over OS versions (regressions reported through iOS 17 / macOS Sequoia) [VERIFIED, same thread — developer reports, unresolved as of the thread's most recent activity].
- **iOS Safari**: same restriction as macOS Safari and it's the more consequential case, since iOS is Safari-only (no alternate engine): **Siri/Enhanced/Premium voices downloaded in Settings → Accessibility → Spoken Content are not exposed to the Web Speech API** — this is a deliberate Apple platform limitation per their own engineer, not a bug that will be fixed by better JS [VERIFIED, developer.apple.com/forums/thread/723503]. Only the small set of always-pre-installed compact voices is reachable. A car-use, hands-free app on iPhone will realistically be stuck with mediocre iOS system voices regardless of code — set expectations accordingly. One report notes the API can list voices that are enumerated but not actually selectable/distinct in practice on Safari [SECONDARY, weboutloud.io], so verify audibly per voice, don't trust the list at face value.
- **Android Chrome**: the *system* TTS engine (Google, Samsung, or a third-party engine the user installed) controls what's available, and the app cannot override it or force higher-quality voices; voice selection is effectively a system setting the app can't fully compete with [SECONDARY, talkrapp.com "lessons learned" writeup]. Also a Chrome-on-Android-specific quirk: you must explicitly set `utterance.lang` to match the chosen voice's language — some builds don't infer it from `utterance.voice` alone [SECONDARY, same source].

**Bottom line for defect (A):** ship the heuristic above defaulting to Google/Natural/Neural named voices when present, expose the existing picker prominently (don't bury it), and — critically — treat iOS as "no high-quality path available," not a bug in your code.

---

## 2. Known `speechSynthesis` gotchas (checklist-relevant)

- **`getVoices()` is often empty on first call.** Voice list population is asynchronous; you must listen for the `voiceschanged` event and re-query `getVoices()` inside the handler, both via `addEventListener('voiceschanged', ...)` and/or the `onvoiceschanged` property [VERIFIED, MDN SpeechSynthesis/voiceschanged_event]. Note some engines (network/cloud voices in particular) simply take time to arrive even after the event fires once — poll/re-check rather than assuming one firing is final [SECONDARY, talkrapp.com].
- **Chrome's ~15-second cutoff bug.** Long utterances on Chrome desktop can be silently cancelled/stalled around 15 seconds; this is a long-standing, still-open-in-spirit Chromium bug (tracked historically as chromium issue 679437, and related issues remain filed, e.g. issues.chromium.org/issues/40747712, issues.chromium.org/issues/41346274) [SECONDARY corroboration across multiple independent writeups describing the same bug; I could not load the raw bug tracker content directly through the fetch tool this session because it required Google sign-in, so treat the *existence and workaround* as SECONDARY, not VERIFIED against the tracker text itself]. The standard workaround: call `speechSynthesis.pause()` immediately followed by `speechSynthesis.resume()` on a repeating timer shorter than 15s (commonly ~5–14s) for the duration of speaking, cancelling the timer on `onend`/`onerror` [SECONDARY, consistent across dev.to/jankapunkt and codersblock.com writeups]. **This workaround does not work on Android**, where `pause()` behaves like `cancel()` rather than a true pause [SECONDARY, dev.to/jankapunkt].
  - For this app's use case (short per-card/per-phrase utterances, not paragraphs), utterances should rarely if ever approach 15s, which is a point in favor of short, discrete utterances over one long narrated string.
- **`onend` is not fully reliable.** Safari specifically does not fire `end` if speech was stopped via `cancel()` [SECONDARY, codersblock.com]. More importantly: **the browser can garbage-collect a `SpeechSynthesisUtterance` before it finishes speaking if you don't hold a reference to it**, silently dropping its `onend`/`onerror`/`onpause` callbacks — the fix is to keep the utterance object alive (e.g. push it into an array or hold it in a ref/class field) for the duration of playback [SECONDARY, talkrapp.com "lessons learned," a well-known and frequently-rediscovered gotcha]. This is very plausibly relevant to your existing drift bug even independent of the interval-timing issue.
- **User gesture is required, and this is current as of 2026.** Chrome deprecated/removed `speak()`-without-activation starting M70/M71 (2018) specifically because the API was being abused by ad/malware pages on Android [VERIFIED, groups.google.com blink-dev "Intent to Remove" thread]. The rule as shipped: *the current frame, or any of its ancestors, must have had user activation at some point* — one gesture unlocks it, and it persists across navigations on the same origin, it is not per-call [VERIFIED, same thread]. This is still accurate as of a source reviewed May 2026 [SECONDARY, textintoaudio.com, dated review]. iOS Safari has historically been stricter still: some reports say `speak()` must be called synchronously inside the gesture handler itself, not just "after some gesture happened" — a `setTimeout`/async delay between the tap and the `speak()` call can cause WebKit to silently drop it [SECONDARY, textintoaudio.com]. **Practical implication:** the very first utterance of a session must originate synchronously from a click/tap handler (e.g. a "Start practice" button), not from a timer or auto-play on load.
- **Backgrounded tab / screen lock:** Chrome and Safari throttle or stop synthesis when the tab loses focus/visibility [SECONDARY, corroborated across multiple sources]. For "use it hands-free in a car" with the screen possibly locked, this is a real risk — mitigate with the Screen Wake Lock API and/or detecting `visibilitychange` and resuming/re-queuing, understanding this is best-effort, not guaranteed, especially on mobile Safari where background JS execution is aggressively suspended.
- **Rate affects intelligibility, and both `rate` and `pitch` have safe bounds.** Keep `rate`/`pitch` within roughly 0.1–2.0 inclusive; going outside that range is unsupported/undefined in some engines [SECONDARY, codersblock.com]. Safari specifically has been reported to make `pitch` values ≤0.5 all sound identical [SECONDARY, same source]. For a counting-practice app, don't push `rate` too high in the name of speed — faster synthetic speech degrades intelligibility disproportionately versus natural speech, so if drift-avoidance is the actual goal, fix pacing (see §3) rather than cranking `rate`.

---

## 3. Correct event-driven pacing (the fix for defect B)

**Do not** drive both the UI and the queued utterances off one shared `setTimeout` interval — that's exactly the architecture that causes unbounded drift, because `speechSynthesis.speak()` queues fire-and-forget regardless of how long the previous one takes to actually finish speaking [VERIFIED, MDN SpeechSynthesis/speak: *"adds an utterance to the utterance queue; it will be spoken when any other utterances queued before it have been spoken"* — i.e. the queue absorbs backlog silently, it does not drop or warn].

**Correct architecture: let speech drive the UI, not the other way around.**

1. Wrap a single utterance in a Promise that resolves on `onend` (and rejects/resolves on `onerror` so a failure can't wedge the sequence forever):

```ts
function speak(text: string, voice: SpeechSynthesisVoice): Promise<void> {
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.voice = voice;
    utter.onend = () => resolve();
    utter.onerror = () => resolve(); // don't let a TTS error hang the sequence
    // keep a reference so it isn't GC'd mid-utterance — see §2
    activeUtterances.push(utter);
    speechSynthesis.speak(utter);
  });
}
```

2. Sequence with `await` in a loop (or `.then()` chain), and advance the on-screen card/number **after** the `await` resolves — i.e. speech completion is the clock, not a timer:

```ts
for (const card of hand) {
  showCard(card);           // UI updates in lockstep with speech, not ahead of it
  await speak(card.label, voice);
}
```

3. If you need a natural pause between items (so it doesn't sound like a machine-gun), add a small fixed `await sleep(150)` **after** the `onend` resolves, not instead of waiting for it — that keeps pacing perceptually natural without reintroducing drift, since it's additive to real completion time rather than a fixed slot the utterance must fit inside.

4. Never call `speechSynthesis.speak()` again before the prior promise resolves, and call `speechSynthesis.cancel()` on unmount/practice-stop to flush the queue (guard `onend` handlers against firing after cancel, since Safari may skip `end` after `cancel()` — treat cancel as "user aborted, don't await further").

Pitfalls to guard against specifically:
- **GC of the utterance object** silently drops `onend` — keep every in-flight utterance referenced until it resolves (see §2).
- **Safari's `end` not firing after `cancel()`** — if the user or app cancels mid-sequence, don't rely on `onend` to unblock the awaiting code; resolve/abort explicitly at the cancel call site instead of only from the event.
- **The Chrome 15s cutoff** — if any single utterance could run long (unlikely for card names/numbers, more possible for a longer instructional phrase), wrap that specific `speak()` call with the pause/resume keepalive timer described in §2, scoped to just that utterance's promise lifetime.
- **Background tab/lock threading** — the `await`-chain approach is actually more robust here than a timer: if the tab suspends timers but the utterance itself eventually still fires `onend` (or never does and the user comes back), you don't accumulate a queue backlog the way a `setInterval`-driven pusher would. Still worth an explicit stall detector (e.g. if no `onend` within N seconds, treat as a stalled utterance and recover) given known engine flakiness.

---

## 4. Live TTS vs. pre-generated audio clips for this vocabulary

Vocabulary is small and closed: ~13 rank words, running-count numbers roughly -20..+20 (~41 values), ~20 short phrases ≈ **~74–80 total clips**, each very short (most are single words or short phrases, sub-2-seconds).

| | **Live `speechSynthesis`** | **Pre-generated audio clips** |
|---|---|---|
| Voice quality | Bounded by whatever the OS/browser exposes — poor on Windows-default, capped on iOS/Safari (no Siri/Enhanced voices reachable, §1) | Generate once offline with any TTS engine (including a good cloud/neural one, or even a human voice actor) — quality ceiling is much higher and **consistent across every user/platform** |
| Timing precision | Event-driven `onend` chaining (§3) removes drift, but per-utterance *start* latency and engine speaking-rate still vary by device/voice/engine load | Audio buffers have fixed, known duration; timing is fully deterministic and reproducible — no engine variance at all |
| File size | Zero (uses OS engine) | Small in absolute terms — back-of-envelope: 80 clips × ~1.5s avg × 64 kbps ≈ 80 × 1.5 × 8 KB/s ≈ **~1 MB total**; even generous 128 kbps/2s clips is only a few MB [INFERENCE, arithmetic from the standard `bitrate(kbps) × duration(s) ÷ 8 = KB` formula] — trivially cheap to bundle in a static site or cache via a service worker |
| Offline reliability | Requires the browser's TTS engine (mostly on-device, but Chrome/Edge "Natural"/network voices need connectivity and can add latency or fail silently offline) | Fully offline-capable once cached — ideal for "practice in a car with spotty signal" |
| Sequencing mechanism | `SpeechSynthesisUtterance` queue / `onend` chaining | Either `HTMLAudioElement` (`new Audio(url).play()`, listen for `ended`) or Web Audio API (`decodeAudioData` → `AudioBufferSourceNode.start(when)`) |
| Timing control (of the two clip-based options) | n/a | **Web Audio API is materially tighter**: it decodes the whole clip into an in-memory `AudioBuffer` and `start(when)` schedules playback against the audio-clock with sample-accurate precision, whereas `<audio>`/`HTMLAudioElement` seeking/scheduling is comparatively imprecise — off potentially by fractions of a second — because the browser approximates frame positions rather than knowing them exactly [VERIFIED-adjacent, this is a well-established, widely corroborated distinction; SECONDARY sourcing via web.dev/webaudioapi.com style references consulted this session, not a single vendor spec quote]. For back-to-back short clips (rank words, numbers) where you want zero perceptible gap and no double-triggered overlap, Web Audio buffer scheduling is the right tool; `HTMLAudioElement` is fine if you're okay with small variance and want less code. |
| Engineering cost | Already built; needs the fixes in §1/§3 | New asset pipeline (generate 80 clips once, normalize loudness, host as static files) + a small playback scheduler; one-time cost, not ongoing |
| Voice consistency for counting drills | Different every time the user changes browser/OS/voice picker choice | Exactly the same voice/pacing every session — arguably *better* for a drilling/training use case, where consistency of cadence matters for building muscle memory |

**Recommendation: pre-generate clips for this vocabulary, played via the Web Audio API, and keep live `speechSynthesis` only as an optional/legacy fallback (or drop it once clips ship).**

Reasoning: the vocabulary is small, fixed, and known in advance — this is precisely the situation where pre-generation dominates. It sidesteps *both* reported defects at the root rather than patching around them: (A) is solved because you control the recorded/generated voice quality directly instead of being at the mercy of whatever the OS exposes (and iOS's platform-level lockout of Enhanced/Siri voices becomes a non-issue, since you're not using the OS voice at all); (B) is solved because clip durations are fixed and known, so the "sequence after previous finishes" architecture in §3 becomes trivial and drift-proof — no dependency on unreliable `onend` firing, no GC-of-utterance gotcha, no 15s cutoff, no per-engine timing variance. The offline/car-use angle is also a strong practical win: cached static audio files work with zero connectivity, whereas Chrome/Edge's better-sounding voices are specifically the *network*-backed ones. The clips can even be generated using `speechSynthesis` itself once, offline, at build/dev time (record its output) if you don't want to stand up any other TTS tool — you're only trading "live, unreliable, low-quality-on-some-platforms" for "one-time-generated, reliable, consistent," not necessarily paying for a different engine.

---

## 5. Free, no-backend, no-committed-API-key options for higher-quality speech on a static site

Short answer: **mostly no — with one interesting recent exception that comes with real trade-offs.**

- **Any hosted cloud TTS API** (Amazon Polly, Google Cloud TTS, Azure/ElevenLabs, etc.) requires a request signed with or accompanied by a secret key. Calling it directly from client-side JS in a public repo means the key is exposed to anyone who opens devtools or reads the bundled JS — this is explicitly the scenario the user ruled out ("no server, no API key committed to a public repo"). There is no way to use these safely without a backend/proxy to hold the secret. This is a straightforward, uncontroversial architectural fact, not something requiring a citation.
- **ResponsiveVoice.js** offers a nominally "free" tier via a client-side `<script>` tag with a public API key and domain verification, marketed as usable on static sites [SECONDARY, responsivevoice.org]. But: (a) its own license explicitly states it is **not free for commercial use** [VERIFIED, github.com/juancamposlb/ResponsiveVoice repo description quoting the license], (b) the "free" key still requires registering and verifying your specific domain in their dashboard, so it's not a drop-in zero-config option, and (c) it's a third-party hosted dependency with its own reliability/quality tradeoffs. Given the license restriction, this is not a clean recommendation for a public GitHub Pages project unless the trainer is confirmed non-commercial and the operator is comfortable with the terms.
- **In-browser neural TTS via WASM/WebGPU (e.g. Kokoro.js / Kokoro-82M running through Transformers.js) is the genuinely free, no-backend, no-API-key option** — the model runs entirely client-side, nothing is sent to a server, and there's no key to leak [SECONDARY, multiple corroborating sources: huggingface.co/posts/Xenova, github.com/rhulha/StreamingKokoroJS, github.com/met4citizen/HeadTTS]. Reported quality is notably better than default OS `speechSynthesis` voices, and it runs 2–10x faster with WebGPU vs. WASM-only [SECONDARY, digialps.com]. **Trade-offs that matter for this project:** it requires downloading and running a real (tens-of-MB-class) ML model in the browser on first use — a materially heavier asset than either the existing live-TTS approach or the ~1MB pre-generated-clips approach in §4; it needs WebGPU or a capable WASM path (patchy support on older/low-end mobile, exactly the "in the car on a phone" use case this app targets); and it's a newer, less battle-tested integration than either alternative. Given this app's vocabulary is small and fixed, **§4's pre-generated-clips approach gets you equal-or-better voice quality (you can even generate the clips with Kokoro once, offline, and ship the resulting ~1MB of static audio) without paying the runtime cost of shipping and running a TTS model in every user's browser.** So: use Kokoro/a similar model as a *clip-generation tool during development*, not as a runtime dependency of the shipped app.

**Bottom line:** there is no safe way to call a hosted premium TTS API directly from a public static-site repo, full stop. There is a real, free, no-key, fully client-side neural-TTS option (Kokoro-class in-browser models), but for this app's specific small-fixed-vocabulary shape, it's better used offline to generate the clip library than shipped as a live runtime dependency.

---

## Gotchas checklist (for implementation / code review)

- [ ] First `speak()` call of a session happens synchronously inside a click/tap handler — not behind a `setTimeout`, `await`, or auto-play on load (user-activation requirement, §2).
- [ ] Voice list is read from inside a `voiceschanged` listener, not assumed present on first `getVoices()` call.
- [ ] Voice default picks a `Google`/`Natural`/`Neural`-named voice over legacy SAPI (`Microsoft David/Zira/Mark`) or `eSpeak`/`Festival` on Windows/Linux/ChromeOS; user picker remains available and overrides the default.
- [ ] No expectation set (in UI copy or your own assumptions) that iOS Safari can reach Siri/Enhanced/Premium voices — it structurally cannot, per Apple.
- [ ] Every in-flight `SpeechSynthesisUtterance` is kept referenced (array/ref) until its `onend`/`onerror` fires, to avoid GC dropping the callback.
- [ ] Sequencing uses `onend`-resolved Promises / `await`, never a fixed `setTimeout` racing actual speech duration.
- [ ] `onerror` also resolves the sequencing promise (don't let a TTS failure hang the whole practice session).
- [ ] `speechSynthesis.cancel()` is called on unmount/stop, and pending awaits are aborted rather than left hanging (Safari may not fire `end` after `cancel()`).
- [ ] If any utterance could realistically run >10s, it's wrapped in the pause/resume keepalive timer for Chrome's 15s cutoff — otherwise this is likely moot for short card/count phrases.
- [ ] `rate`/`pitch` stay within 0.1–2.0; don't push rate high as a drift workaround — fix pacing architecture instead (§3).
- [ ] If pursuing the recommended pre-generated-clip approach: clips are scheduled via Web Audio API (`AudioBufferSourceNode.start(when)`) rather than `HTMLAudioElement`, for sample-accurate back-to-back timing.
- [ ] Tab-backgrounding/screen-lock behavior tested explicitly on the target "practice in the car" scenario (phone, screen off) — expect throttling, and don't rely on live TTS continuing reliably in that state on Chrome/Safari mobile.

---

## Sources

Direct/vendor sources fetched and read this session (treated as VERIFIED for the specific claims cited above):
- [SpeechSynthesisVoice — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice) — property definitions (`name`, `lang`, `localService`, `default`, `voiceURI`)
- [SpeechSynthesis: speak() method — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/speak) — queueing behavior, Baseline availability since Sept 2018
- [SpeechSynthesis: voiceschanged event — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/voiceschanged_event) — async voice population, `addEventListener`/`onvoiceschanged` usage
- [Intent to Remove: speechSynthesis.speak without user activation — blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/WsnBm53M4Pc) — exact activation rule, M70/M71 timeline, abuse rationale
- [Apple Developer Forums thread 723503 — Web Speech Synthesis API: not all voices installed listed](https://developer.apple.com/forums/thread/723503) — Apple engineer statement that downloadable/Premium/Enhanced voices are unavailable to the Web Speech API on macOS and iOS Safari; Chrome/Edge on macOS list all installed voices
- [ResponsiveVoice mirror repo license note](https://github.com/juancamposlb/ResponsiveVoice) — "NOT free for commercial use"

Secondary/corroborating sources consulted:
- [web-speech-recommended-voices (Hadrien Gardeur / Readium Speech)](https://github.com/HadrienGardeur/web-speech-recommended-voices) — curated-list rationale, no reliable attribute heuristic exists
- [JavaScript Text to Speech and Its Many Quirks — Coder's Block](https://codersblock.com/blog/javascript-text-to-speech-and-its-many-quirks/) — `onvoiceschanged`, Android limitations, `onend` after `cancel()` on Safari, rate/pitch bounds
- [Cross browser speech synthesis — dev.to/jankapunkt](https://dev.to/jankapunkt/cross-browser-speech-synthesis-the-hard-way-and-the-easy-way-353) — Chrome 15s cutoff and pause/resume workaround, Android `pause()`≈`cancel()`
- [Lessons Learned Using the javascript speechSynthesis API — talkrapp.com](https://talkrapp.com/speechSynthesis.html) — iOS voice-count deception, utterance GC gotcha, Android locale string quirks, cloud-voice load delay
- [The State of Speech Synthesis in Safari — weboutloud.io](https://weboutloud.io/bulletin/speech_synthesis_in_safari/) — Safari voice list unreliability
- [Speech Synthesis API: Browser Support, Voices, Limitations — textintoaudio.com](https://textintoaudio.com/browser-support) — per-platform matrix, reviewed-current-as-of-May-2026 confirmation of user-gesture requirement
- Chrome 15s-cutoff bug trackers referenced by the above (could not load raw tracker content directly this session due to sign-in walls): [issues.chromium.org/issues/40747712](https://issues.chromium.org/issues/40747712), [issues.chromium.org/issues/41346274](https://issues.chromium.org/issues/41346274), historical [bugs.chromium.org #679437](https://bugs.chromium.org/p/chromium/issues/detail?id=679437)
- [Kokoro.js announcement — Xenova on Hugging Face](https://huggingface.co/posts/Xenova/503648859052804); [StreamingKokoroJS](https://github.com/rhulha/StreamingKokoroJS); [HeadTTS](https://github.com/met4citizen/HeadTTS); [Kokoro WebGPU performance writeup — digialps.com](https://digialps.com/kokoro-webgpu-real-time-text-to-speech-running-100-locally-in-your-browser/) — in-browser neural TTS as a free/no-backend option and its trade-offs
- Web Audio API vs `HTMLAudioElement` timing precision: general Web Audio API references on `AudioBufferSourceNode.start()` precision and `<audio>` element seek imprecision (widely and consistently documented; not attributed to one single authoritative quote this session)
- Bitrate/file-size arithmetic: standard `KB = kbps × seconds ÷ 8` formula, applied to this project's ~80-clip vocabulary
