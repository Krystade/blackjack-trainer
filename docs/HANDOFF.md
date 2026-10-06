# Handoff: where things stand

Written at the end of the first cloud session (2026-10-05/06, branch `claude/loving-cray-97klqt`, last
commit `f209d54`). Read this first, then `docs/TODO.md` (the working list) and
`docs/research/2026-10-05-roadmap.md` (the plan).

## Waiting on Jack (nothing to build until these come back)

1. **The car session.** Every kit is in the app: Home → Test kit (link under the build line), or
   Settings → Tests.
   - **Parked, Bluetooth on: "In the car — Bluetooth ON".**
     - Step 1 is six blind plays with the mic on. It's the gate: do drills, which now play through
       Web Audio once the mic opens, still reach the car speakers?
     - If not, restore the `<audio>` path when Bluetooth is connected. In `src/audio/clips.ts`,
       `playClipsResumable` chooses the path from `isVoiceCaptureActive() || micSessionCostPaid()`.
   - **Parked: "Bluetooth: phone mic?"** Can the app listen through the phone while the car plays?
   - **Driving: "Words at speed"**, twice: Bluetooth off, then on. These are the first recognition
     numbers ever taken at speed. Read them with the decision table in the roadmap.
2. **A preference:** the mute disc now sits in a 44px strip reserved at the top of every screen (the
   field test excepted). Jack may want it in each screen's header instead.

## How to work here

- **Deploy = push to `main`.** `.github/workflows/deploy.yml` runs `npm test`, then builds and
  publishes to GitHub Pages. Jack asked for a deploy after every major step: push the branch, then
  `git push origin HEAD:main`.
  - After pushing, confirm the run succeeded with the GitHub MCP `actions_list` (workflow
    `deploy.yml`). A red unit test silently blocks the deploy, which happened once this session.
- **Any new localStorage key** must be registered in `src/store/crossTab.test.ts` (NOT_SYNCED or
  OWNED_KEYS) and `src/store/persistHardening.test.ts` (NOT_BACKED_UP), or CI fails.
- **The diagnostic log is the only log.** Every recorder writes there via `diag(category, event, {...})`.
  The Test kit logs under `test kit-*`, and Settings → Diagnostic log → Copy is how Jack sends it.
- **Spoken lines must be recorded.** A sentence the app speaks without a clip falls back to the
  phone's own voice, which can land on the earpiece once the mic has opened.
  1. Put the sentence builder in `src/audio/narrate.ts` (or add it in `scripts/spokenPhrases.ts`).
  2. Run `UPDATE_SPOKEN_PHRASES=1 npx vitest run scripts/`.
  3. Generate the clips with Kokoro (below). `scripts/clipCoverage.test.ts` fails on any unrecorded
     drill line.
- **Kokoro in a cloud container:**
  - `pip install kokoro-onnx soundfile`.
  - Fetch `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the `model-files-v1.0` release of
    thewh1teagle/kokoro-onnx.
  - Run `python3 scripts/generate-audio-clips.py --engine kokoro --model-dir <dir> --voice af_bella,bf_emma,bm_george`.
  - It is incremental, so it only synthesises missing files.
- **Playwright in a cloud container:** the installed Chromium is build 1194, and Playwright 1.61
  wants 1228.
  - This session symlinked `/opt/pw-browsers/chromium_headless_shell-1228/chrome-headless-shell-linux64/*`
    to the 1194 headless shell. Redo that in a fresh container; never run `playwright install`.
  - When agents run e2e in parallel, give each one its own `E2E_PORT`, because the config reuses an
    existing dev server.
  - `charts.spec` rewrites `docs/sources/chart-view-*.png`. Restore them with `git checkout`, don't
    commit them.
- **Agents:**
  - Worktree agents commit on their own branch; merge their branch into the session branch, then
    deploy.
  - Merge conflicts this session were mostly a deleted-vs-modified file, or two culls removing the
    same thing; take the superset of deletions.
  - A small resolver script lived in the scratchpad. Rewrite it if needed: take ours/theirs/both per
    conflict hunk.

## What this session established (measured on Jack's phone, iOS 18.7, installed PWA)

- **Earpiece:** with a mic open, `<audio>` plays from the earpiece. Web Audio decoded buffers play
  from the loud speaker: 7 of 7, blind. Results tables are in TODO.md.
  - Web Audio obeys the ring switch only when no mic has opened.
  - Call Audio Routing = Speaker does not help.
- **Recognition:** 10/10 in a quiet room. The first mic open of a page can lose capture for about
  20 seconds after a route change, which is still open; the roadmap has it as R1.
- **Ruled out by Jack:** a native app, and sending voice recordings (so the noise bench is parked).

## Open work, ranked (see the roadmap for the reasoning)

1. Whatever the car session decides: the Bluetooth path fix, then the vocabulary default, then Vosk if
   accuracy at speed is poor.
2. The first-mic-open capture loss (roughly 20s deaf). Reproduce it from the 2026-10-05 desk-run log in
   TODO.md.
3. Settlement lines with amounts are still on live speech. Split them as bot turns were split, so they
   can be clipped.
4. Push-to-talk ("Talk" wheel mode) has not been checked against the Web Audio path.
