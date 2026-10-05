# Closed-vocabulary recognition in iOS Safari, in car noise

Date: 2026-10-05. Scope: research only, no repo changes. Context: `docs/TODO.md` G3-d, `src/audio/voiceRecognition.ts`, `RecognitionLike` seam in `src/audio/voiceControl.ts`.

Honesty note: several primary sources were unreachable (egress proxy blocks picovoice.ai, k2-fsa.github.io, community.home-assistant.io; GitHub API blocked for non-attached repos). Things I could not confirm are marked **(unverified)**. Nobody, to my knowledge, publishes freeway-SNR numbers for any of these on iOS; all "noise robustness" below is general evidence, not a measurement on this app. The only trustworthy number will come from the prototype.

## 1. Bottom line

Ranked recommendation:

1. **Vosk (vosk-browser) with a JSON grammar, as an A/B arm, first.** It is the only candidate with a *true closed-vocabulary decoder* available as a drop-in npm package, it needs **no SharedArrayBuffer / COOP / COEP** (so GitHub Pages is fine and no service-worker header hack is needed), and the grammar constructor is confirmed in the published typings. Weak points: the package is unmaintained since Dec 2022, the small model is ~40 MB, and iOS memory/stability is unproven.
2. **sherpa-onnx WASM keyword spotter (zipformer gigaspeech 3.3M, ~5.5 MB model) as the fallback / second arm.** Tiny model, open-vocabulary keywords from text (no retraining), actively maintained (Apache-2.0, release 1.13.8 on 2026-09-10). But it is a *spotter*, not a classifier, the stock WASM build asks for 512 MB initial memory (iOS risk), and there is no ready npm browser package (own emscripten build needed).
3. **Custom CNN KWS trained on Jack's own voice (TF.js speech-commands transfer learning, or a small ONNX CNN)**: the likeliest to win in the end for 16 phrases from one speaker, but it needs a data collection and training pipeline. Do this only if 1 and 2 both fail. The upstream TF.js library is stale (last release 2023-10).
4. **Whisper tiny/base in the browser: do not pursue on iOS.** Open issues show crashes on iOS Safari for exactly these models, WebGPU is not usable in Safari, and constrained decoding in the WASM ports is not available/reliable.
5. **Picovoice Rhino/Porcupine: ruled out on cost/licence.** The free tier was discontinued 2026-06-30 and paid plans are sales-quote enterprise subscriptions (secondary sources; **unverified** on Picovoice's own site). Technically the best fit (Rhino is literally speech-to-intent for a closed grammar and has a web SDK that runs in Safari), so revisit only if the operator accepts a commercial plan.

Do not expect any of these to fix the **earpiece/mic-session problem**: any `getUserMedia` capture puts iOS into the play-and-record route, same as Web Speech. The app already works around it with Web Audio output (G1 fix); the same fix covers these recognisers because the output path is independent of who consumes the mic.

## 2. Platform constraints that decide the ranking

### 2.1 SharedArrayBuffer / threads on GitHub Pages
- Safari/iOS supports SharedArrayBuffer only when the page is cross-origin isolated (COOP `same-origin` + COEP `require-corp`) since Safari 15.2: https://www.testmuai.com/learning-hub/sharedarraybuffer-browser-support/ , WebKit changeset https://trac.webkit.org/changeset/281832/webkit
- GitHub Pages cannot set response headers. Workaround: a service worker that re-fetches and injects headers, `coi-serviceworker` (MIT): https://github.com/gzuidhof/coi-serviceworker . Its README says it **reloads the page on first load**, must be served from your own origin (not bundled / not from a CDN), and prefers COEP `credentialless` with a `require-corp` fallback. It says nothing about iOS Safari or standalone home-screen PWAs, and I found no report confirming `crossOriginIsolated === true` from a service worker on iOS standalone **(unverified)**. Under `require-corp`, every cross-origin subresource (CDN scripts, model files on another host) needs CORS/CORP headers, so all assets must be same-origin. WebKit support for COEP `credentialless` is **unverified**.
- Caveat found: a service worker that serves from cache must re-attach the headers on every response, or `crossOriginIsolated` flips to false on cache hits (https://www.systemshardening.com/articles/wasm/wasm-webkit-mobile-security/ , secondary source). One failure of that kind in the car would silently break voice.
- The repo today has **no service worker** (grep of `src`, `public`, `index.html` for `serviceWorker` returned nothing). Adding one is its own risk (stale caches, update flow).
- **Consequence: prefer a single-threaded WASM build.** vosk-browser's bundle contains no SharedArrayBuffer reference (I grepped `vosk.js` in vosk-browser 0.0.8: none). The sherpa KWS WASM CMake has no `-pthread` flags (https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/wasm/kws/CMakeLists.txt). onnxruntime-web / transformers.js can run single-threaded (`numThreads=1`) at a latency cost.

### 2.2 Capture on iOS
- Safari does not support the `noiseSuppression` constraint (https://blog.addpipe.com/getusermedia-audio-constraints/ , secondary). `echoCancellation` is on by default. So the Vosk README sample's `noiseSuppression: true` is probably a no-op on iOS; read `track.getSettings()` and log it. No software suppression unless we add one (e.g. RNNoise WASM; **not evaluated**).
- Whatever recogniser we pick must resample: the iOS AudioContext runs at the hardware rate (44.1/48 kHz), recognisers want 16 kHz. Do it in an AudioWorklet (not the deprecated ScriptProcessor the Vosk README uses). **AudioContext sampleRate behaviour with a MediaStreamSource on iOS: unverified**; the repo's own `caa5a73` note says the mic moves the hardware rate.
- The app can choose the input device with `deviceId`; useful to pin the phone mic vs car Bluetooth HFP (8/16 kHz narrowband, which is itself a large accuracy hit for any model trained on wideband audio). **Run the whole bench in both Bluetooth-on and Bluetooth-off modes.**

### 2.3 iOS memory
iOS Safari kills tabs that grow too large; WebKit also reserves memory up-front for shared/growable Wasm memory (https://github.com/Automattic/kandelo/pull/1410 , secondary). A 40 MB Vosk model decompresses into a larger in-memory filesystem; sherpa's stock KWS build starts at **512 MB** (`INITIAL_MEMORY=512MB`, see CMakeLists above), which should be reduced for iOS. No measured numbers available **(unverified)**; measure peak with Safari Web Inspector on a Mac.

## 3. Candidate evaluation

### 3.1 Vosk / vosk-browser (Kaldi)
- Source: https://github.com/ccoreilly/vosk-browser ; npm `vosk-browser` 0.0.8, **last published 2022-12-25**, Apache-2.0. Demo https://ccoreilly.github.io/vosk-browser/ . The GitHub repo page itself 404'd via my fetch tool, but the README raw file and the npm tarball were read.
- Grammar: the published typings declare `new (sampleRate: number, grammar?: string)` (`dist/model.d.ts`, line 25) and `grammar?: string` in the message interface. The `lib/README.md` API reference does not document it (the fetch summary said "not supported"; the typings contradict that, so it is supported but undocumented). Vosk grammar is a JSON array of phrases, e.g. `["hit","stand","hit me","[unk]"]`; **include `[unk]`** so out-of-grammar noise has somewhere to go. **Whether the small model's dynamic-graph (`vosk-model-small-en-us`) honours this on the WASM build: unverified until the prototype runs**; in the native Vosk docs, runtime grammar needs a model with the dynamic graph, which the small models have, and the big ones do not.
- iOS Safari: plain WASM in a Web Worker, no threads. I found **no iOS-specific issue or success report** (search returned nothing relevant). Treat as **unverified**; first prototype task is "does it load and recognise on the phone".
- Model: `vosk-model-small-en-us-0.15`, ~40 MB (https://www.kaggle.com/datasets/siddhartha22i258/vosk-model-small-en-us-0-15 and listings). Delivered as .tar.gz, cached once (Cache API/IndexedDB or the service worker). Free-text WER 9.85% LibriSpeech test-clean, 10.38% TEDLIUM (https://towardsdatascience.com/vosk-for-efficient-enterprise-grade-speech-recognition-an-evaluation-and-implementation-guide-87a599217a6c/). Not a noise number.
- Latency: streaming; partial results while speaking, final on endpoint silence. Expect ~0.3-1 s after the word on a modern iPhone **(unverified)**; the endpoint silence is the main component.
- Noise robustness: no published car-noise evidence. A restricted grammar removes the "fluent English fragment" failure that produces "Add" (the decoder can only emit grammar words or `[unk]`), but the acoustic model is a small Kaldi chain model trained mostly on clean read speech; at 0 dB cabin noise expect more `[unk]`/deletions, not substitutions. That is the right failure mode for a driver (ask again, don't act wrongly) **(this is reasoning, not evidence)**.
- Maintenance: effectively abandoned (3 years). Vendoring the 5.8 MB `vosk.js` (WASM inlined) is simple and avoids upstream drift, but any bug is ours. The underlying `alphacep/vosk-api` is alive.
- Fit: grammar yes; numbers -30..+30 need grammar entries like "minus twenty three", about 61 phrases; fine for a grammar.

### 3.2 sherpa-onnx WASM (keyword spotting / streaming transducer)
- Source: https://github.com/k2-fsa/sherpa-onnx , Apache-2.0, npm `sherpa-onnx` 1.13.8 (2026-09-10). Very active. WASM build scripts exist for ASR, VAD, KWS, TTS (`build-wasm-simd-kws.sh`). The **npm package is a Node target** (I inspected the tarball: `sherpa-onnx-wasm-nodejs.wasm`); a browser KWS build needs emscripten 4.0.23 and the `wasm/kws` demo (https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/wasm/kws/CMakeLists.txt). The prebuilt demo is a HF Space (https://huggingface.co/spaces) , not verified on iPhone.
- KWS model: `sherpa-onnx-kws-zipformer-gigaspeech-3.3M`, encoder int8 ~4.0 MB + decoder ~1.06 MB + joiner ~0.16 MB + bpe/tokens ~0.25 MB, total ~5.5 MB (https://huggingface.co/mobilebytesensei/sherpa-onnx-kws-zipformer-gigaspeech-3.3M , mirror). Keywords are given as text at runtime, encoded to BPE tokens, with per-keyword boost/threshold (`keywordsScore`, `keywordsThreshold` seen in `sherpa-onnx-kws.js`). Newer `zh-en-3M-2025-12-20` model listed at https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html (page not fetched; **unverified** details).
- Grammar restriction: **no**; it spots a keyword list, it does not force a closed-set decision. Each phrase has its own threshold, so short words (hit, no) will false-fire on speech from the radio/passengers, and "hit"/"hit me" overlap (prefix) needs the longest-match arbitration in app code. Calibrate thresholds per word with the Test kit.
- iOS: single-thread WASM SIMD; WASM SIMD is in Safari 16.4+. Stock build asks for 512 MB initial memory: lower it and test. Streaming zipformer ASR with hotwords is a separate larger option (**unverified**).
- Latency: chunked streaming, 16-frame chunks, so tens to a few hundred ms **(unverified)**.
- Noise: the model is trained on GigaSpeech (podcasts, audiobooks, YouTube) so some noise diversity, but no car-noise numbers. Small KWS networks are known to degrade sharply in noise unless trained with it: https://arxiv.org/pdf/2109.07930 ("models ... fail in noisy conditions, even when exposed to noise during training"). Useful as a reminder that nothing here is free.
- Effort: highest of the "off the shelf" options (own emscripten build, JS glue, hosting `.data`).

### 3.3 Whisper tiny/base (transformers.js, whisper.cpp WASM, WebGPU)
- transformers.js `@huggingface/transformers` 4.3.0 (2026-09-16), Apache-2.0; whisper-tiny.en ~40 MB.
- **iOS Safari evidence is bad**:
  - https://github.com/huggingface/transformers.js/issues/1241 : `onnx-community/whisper-base` on iPad iOS 18.3.2, WASM backend, fp32 and q4: Safari crashes and reloads in a loop on model load; works on Linux/Android; open, no resolution.
  - https://github.com/huggingface/transformers.js/issues/1242 : v3 crashes on iOS/macOS from growing memory; workaround is downgrading to v2.
  - https://github.com/rubasace/sidevoice/issues/31 (via search snippet; the page itself 404'd for me): on iPhone, iOS 18.7, Safari 26.1, WebGPU adapter is available but loading Whisper tiny/base through onnxruntime-web WebGPU fails, in the worst case reloading the tab. **Same iOS version as this operator.**
- Constrained decoding: whisper.cpp has GBNF grammar support in the native `command` example (tiny.en recommended, grammar penalty), but the examples report flaky/ineffective grammar behaviour (https://github.com/ggml-org/whisper.cpp/discussions/2003 , https://github.com/ggml-org/whisper.cpp/issues/2159). Whether grammar is exposed in whisper.cpp's WASM demo: **unverified**; transformers.js has no grammar constraint (a prompt only biases). Whisper also hallucinates on short clips of near-silence/noise.
- Latency: whisper processes 30 s windows by design; tiny on a phone WASM is typically 1-several seconds per utterance **(unverified)**. Too slow for a hit/stand loop.
- Verdict: do not build. Revisit only if the transformers.js iOS crash issues close.

### 3.4 Picovoice Rhino (speech-to-intent) / Porcupine (wake word)
- Rhino is the textbook fit: closed context grammar, web SDK for Chrome, Safari, Firefox, Edge (https://raw.githubusercontent.com/Picovoice/rhino/master/README.md). Porcupine is wake-word only (https://raw.githubusercontent.com/Picovoice/porcupine/master/README.md). npm `@picovoice/rhino-web` 4.1.0 (2026-09-08, active); package metadata says Apache-2.0 but the engine/models need a Picovoice **AccessKey** validated at init (https://picovoice.ai/docs/faq/general/ per search snippet).
- Cost: search results say the **free tier ends 2026-06-30, AccessKeys disabled, no non-commercial tier**; paid plans are enterprise, quote-only (Home Assistant community thread https://community.home-assistant.io/t/fyi-picovoice-confirmed-free-tier-accesskeys-will-stop-working-after-june-30-2026/1012744 , blocked to me, content known only from search snippets; Hackster https://www.hackster.io/news/picovoice-launches-completely-free-usage-tier-for-offline-voice-recognition-for-up-to-three-users-e1eafbc97bb0 for the old tier). **Unverified against picovoice.ai** (egress blocked). Re-check pricing before dismissing.
- iOS web specifics: needs Web Workers and WASM; thread/SAB requirement **unverified**.
- Verdict: best accuracy per effort *if* it can be licensed for one hobbyist user. Otherwise out. Email Picovoice sales is a 10-minute action if the operator wants to keep the option.

### 3.5 TF.js speech-commands / custom KWS on the operator's own voice
- https://github.com/tensorflow/tfjs-models/tree/master/speech-commands (README read). Default vocabulary: digits zero-nine, up, down, left, right, go, stop, yes, no (+ background, unknown). Supports transfer learning in-browser. Only "yes", "no", and number words 0-9 overlap with our vocabulary; hit/stand/double/split/surrender are not in it, so it must be trained on recorded data. `@tensorflow-models/speech-commands` 0.5.4, **last published 2023-10-17**, Apache-2.0, uses WebGL; stale but small. Model about 1 MB (**unverified**).
- Approach strength: a single-speaker, 17-class classifier with explicit `_background_noise_` and `_unknown_` classes, trained on recordings of Jack in the actual car (and noise mixes) is the one design that sees the *target acoustics*. Frame-level classification of 1-s windows gives low latency (~200-500 ms after the word) and a naturally closed decision.
- Costs: Jack must record ~20-40 examples per class (16 + 61 numbers is too many; use number words at word level, 0-30 digits spoken as 2 tokens needs a sequence model or a rule), plus freeway noise to mix. G3-e (noise bench) was parked because Jack passed on sending recordings; this route requires them. Numbers (-30..+30) are the hard part for a pure single-word KWS; keep Web Speech or Vosk for numbers.
- Noise: published KWS-in-noise literature (https://arxiv.org/pdf/2109.07930 , https://arxiv.org/pdf/1906.08415) says noise-matched training data is what matters; a personalised model trained with car-noise augmentation can reach good accuracy but this is **not validated** here.
- Alternative cheap variant: DTW template matching on MFCCs of Jack's own recordings (no ML framework, ~KB). Fast to build, fragile to level/noise changes **(my suggestion, no source)**.

## 4. Comparison table

| | iOS Safari | Needs SAB/COOP/COEP | Model / first load | Latency | Grammar-restricted | Noise evidence | License | Maintenance |
|---|---|---|---|---|---|---|---|---|
| vosk-browser (small en) | probably; **unverified on iOS** | No (grep shows none) | ~40 MB (+5.8 MB JS) | ~0.3-1 s, streaming (unverified) | **Yes** (constructor `grammar`) | None published | Apache-2.0 | npm last 2022-12; core alive |
| sherpa-onnx KWS | WASM SIMD ok; **memory 512 MB default risk** | No (no -pthread) | ~5.5 MB model + wasm | tens-hundreds ms (unverified) | No (keyword list, thresholds) | Generic KWS lit only | Apache-2.0 | Very active |
| Whisper tiny/base | **Crashes reported on iOS 18** | Optional (threads) | 40-150 MB | seconds | No (prompt only; GBNF native only) | Whisper robust in general, but hallucinates on short clips | MIT/Apache | Active |
| Picovoice Rhino | Yes (documented) | unverified | small | low | **Yes** (native context) | Vendor claims | Needs AccessKey, free tier ended 2026-06-30 (secondary) | Active |
| TF.js KWS custom | Yes (WebGL / WASM) | No | ~1 MB (unverified) + user data | ~200-500 ms | Closed classes by construction | Only if trained with noise | Apache-2.0 | Stale (2023) |

## 5. Prototype plan (offline-first, then phone)

### 5.1 Seam
`createVoiceController` takes a `RecognitionLike` (`src/audio/voiceControl.ts` lines 49-82: `start/abort`, `onstart`, `onaudiostart`, `onend`, `onerror`, `onresult` with `results[i][j].transcript/confidence`). Implement a **`GrammarRecognition` class that satisfies `RecognitionLike`** and emit `onresult` with the grammar phrase as the transcript, so `resolveSpoken`, aliases, the answer gate and the log all work unchanged. `browserRecognition()` (`voiceRecognition.ts:929`) is the factory; add an engine selection there (setting or URL flag `?engine=vosk`), defaulting to Web Speech. Because grammar output is already in-vocabulary, the matcher should be a pass-through for those.

### 5.2 New files (names suggested)
- `src/audio/engines/grammarRecognition.ts`: `RecognitionLike` wrapper; owns lifecycle, restarts, `[unk]` handling, `onaudiostart` fired when the first worklet block arrives (the same event the controller waits on; otherwise it burns `AUDIOSTART_GRACE_MS` = 1500 ms).
- `src/audio/engines/capture.ts`: `getUserMedia` (with `deviceId`, `echoCancellation: true`, request `noiseSuppression` but trust `getSettings()`), AudioContext, AudioWorklet downsampler to 16 kHz mono Int16/Float32, ring buffer; log track settings, context sampleRate and route.
- `public/worklets/pcm-downsample.js` (AudioWorklet module; same-origin).
- `src/audio/engines/voskEngine.ts`: loads vendored `vosk.js` + model, builds the grammar JSON from the voice vocabulary and number words (`voiceNumber.ts`), posts audio, maps `result` to `onresult`.
- `src/audio/engines/sherpaKwsEngine.ts` (phase 2 only).
- `public/models/vosk-model-small-en-us-0.15.tar.gz` (not committed to git if repo size matters; use a Release asset or LFS-free download step in the Pages build; Pages file limit 100 MB per file, 1 GB site).
- Offline bench: `scripts/engine-bench.ts` plus labelled clips (see 5.4).

### 5.3 Steps
1. **Desk, Chromium (Playwright):** load Vosk and the grammar, feed WAV via `--use-file-for-fake-audio-capture`, confirm `[unk]` behaviour and that grammar phrases return. Measure model load, peak heap, per-word latency from the end of speech.
2. **iPhone, installed app:** a hidden Test-kit step "Engine smoke test": load model, record peak memory by watching for tab reload, report `getSettings()`, AudioContext rate. First go/no-go gate: does it survive three minutes on the phone without a reload?
3. **A/B inside the existing calibration step** (see 5.4).
4. If Vosk passes: persistent model cache and an offline-first load state ("model ready" indicator) before drills accept voice.
5. If Vosk fails on iOS memory or accuracy: build the sherpa KWS WASM with `INITIAL_MEMORY` small, same wrapper.

### 5.4 Measuring against Web Speech with the Test kit
The existing calibration (`src/diag/testKit.ts`: `CALIBRATE` step, `calibrationSchedule`, `scoreSample`, `summariseCalibration`, 2 rounds, alternating one-word/two-word forms) already produces target vs heard vs confidence. Plan:
- Add `engine` to each `CalibrationSample` and log it; run the same schedule **twice, back to back, same session**: once with Web Speech, once with the grammar engine (order alternated across runs, since mic warm-up affects the first). Even better: tee the *same* mic stream to both. Web Speech opens its own capture, so true simultaneity is not possible; do interleaved words (odd words engine A, even words engine B) as the kit already interleaves forms.
- Metrics per engine per condition (parked, Bluetooth off, Bluetooth on, freeway): accuracy, **wrong-action rate** (substitution), **no-answer rate** (deletion), median latency from prompt end to result, mic open-to-first-audio time, and false-accept count over a 60 s silent/radio-on window (the `[unk]` stress test).
- Decision metric: the wrong-action rate matters more than accuracy (a mis-play beats a re-ask). Success criterion for adoption: freeway wrong-action rate lower than Web Speech's and accuracy not lower by more than a few points, over at least ~60 words per arm per condition.
- G3-e (recorded-noise bench) remains the cheaper path to many conditions if Jack ever allows a recording: mix 60 s freeway noise at -5/0/+5/+10 dB SNR.

## 6. Risks
- iOS memory/reload with Vosk 40 MB model: unmeasured; could be a kill.
- iOS may refuse a second concurrent audio session or flip the earpiece differently between `getUserMedia` and Web Speech; the Web Audio output fix covers prompts only. Both engines see the same G1 behaviour; no new regression expected but test.
- First mic open of a page loses the input route (`devicechange` ×2 then `audio-capture`, from the desk run): a `getUserMedia` engine will hit the same bug; needs the same retry.
- Bluetooth HFP is 8/16 kHz narrowband; Kaldi small models are 16 kHz wideband trained, narrowband input costs accuracy.
- Abandoned dependency (vosk-browser): any WASM bug is on us.
- Vosk grammar via WASM with the small model: undocumented; may behave differently from native.
- Service worker for model caching adds update/stale-cache risk (the repo has none today); prefer Cache API from page code.
- Grammar recogniser forces *some* answer: radio words may be mapped to commands unless `[unk]` is tuned and a confidence/margin check added.

## 7. What would change this recommendation
- Vosk crashes or reloads on the phone, or small-model accuracy in the car is not better than Web Speech: go to sherpa KWS, then custom KWS.
- Freeway wrong-action rate under Web Speech is already acceptable after the shipped two-word forms and aliases (G3-a data): do not build any of this.
- Picovoice offers a licence that covers one hobbyist user at low cost: Rhino becomes #1 (best fit, purpose-built).
- transformers.js iOS issues #1241/#1242 close and WebGPU ships in Safari for iOS: re-evaluate Whisper only for number answers (open vocabulary parts), never for hit/stand.
- Jack is willing to record a labelled data set (his voice + car noise): a personal CNN becomes #1.
- A reliable service-worker cross-origin-isolation recipe is confirmed on iOS standalone: unlocks multithreaded onnxruntime/sherpa builds, but still only if single-thread latency proves inadequate.

## Sources
- https://github.com/ccoreilly/vosk-browser (README via raw.githubusercontent.com; npm tarball vosk-browser 0.0.8 inspected locally)
- https://registry.npmjs.org/vosk-browser , /sherpa-onnx , /@picovoice/rhino-web , /@picovoice/porcupine-web , /@tensorflow-models/speech-commands , /@huggingface/transformers , /onnxruntime-web (versions, dates, licences)
- https://github.com/k2-fsa/sherpa-onnx and wasm/kws files on raw.githubusercontent.com
- https://huggingface.co/mobilebytesensei/sherpa-onnx-kws-zipformer-gigaspeech-3.3M
- https://github.com/gzuidhof/coi-serviceworker
- https://trac.webkit.org/changeset/281832/webkit ; https://www.testmuai.com/learning-hub/sharedarraybuffer-browser-support/ ; https://www.systemshardening.com/articles/wasm/wasm-webkit-mobile-security/
- https://github.com/huggingface/transformers.js/issues/1241 , /1242 ; https://github.com/rubasace/sidevoice/issues/31 (snippet only)
- https://github.com/ggml-org/whisper.cpp/discussions/2003 , /issues/2159 (snippets)
- https://raw.githubusercontent.com/Picovoice/rhino/master/README.md , https://raw.githubusercontent.com/Picovoice/porcupine/master/README.md
- https://community.home-assistant.io/t/fyi-picovoice-confirmed-free-tier-accesskeys-will-stop-working-after-june-30-2026/1012744 (snippet only; blocked)
- https://raw.githubusercontent.com/tensorflow/tfjs-models/master/speech-commands/README.md
- https://arxiv.org/pdf/2109.07930 ; https://arxiv.org/pdf/1906.08415 (KWS in noise)
- https://blog.addpipe.com/getusermedia-audio-constraints/ ; https://github.com/Automattic/kandelo/pull/1410
- https://towardsdatascience.com/vosk-for-efficient-enterprise-grade-speech-recognition-an-evaluation-and-implementation-guide-87a599217a6c/
