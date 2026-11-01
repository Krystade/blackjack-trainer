# Handoff: start here

Where the live work is:

- `docs/NEXT-TEST.md`: the next test run on Jack's phone, and what each step decides.
- `docs/BACKLOG.md`: open items and ranked ideas (its Status table lists what is open).
- `docs/superpowers/plans` and `docs/superpowers/specs`: plans for work in flight.
- `docs/TODO.md` and `docs/research/2026-10-06-session-handoff.md` are historical records.

## How to work here

- **Deploy = push to `main`.** `.github/workflows/deploy.yml` runs `npm run lint`, `npx tsc -b`,
  `npm test`, then `npm run build`, and publishes `dist/` to GitHub Pages. Lint warnings do not fail
  it; errors do. E2E is not run in CI: run the specs you touched locally before pushing.
  - After pushing, confirm the run succeeded. A red unit test silently blocks the deploy.
- **Any new localStorage key** must be registered in `src/store/crossTab.test.ts` (NOT_SYNCED or
  OWNED_KEYS) and `src/store/persistHardening.test.ts` (NOT_BACKED_UP), or CI fails.
- **The diagnostic log is the only log.** Every recorder writes there via `diag(category, event, {...})`
  (`src/diag/diagnosticLog.ts`). Settings → Diagnostic log → Copy is how Jack sends it.
- **Spoken lines must be recorded.** A sentence spoken without a clip falls back to the phone's own
  voice, which can land on the earpiece once the mic has opened.
  1. Put the sentence builder in `src/audio/narrate.ts` (or add it in `scripts/spokenPhrases.ts`).
  2. Run `UPDATE_SPOKEN_PHRASES=1 npx vitest run scripts/`.
  3. Generate the clips with Kokoro: `pip install kokoro-onnx soundfile`, fetch `kokoro-v1.0.onnx`
     and `voices-v1.0.bin` from the `model-files-v1.0` release of thewh1teagle/kokoro-onnx, then
     `python scripts/generate-audio-clips.py --engine kokoro --model-dir <dir> --voice af_bella,bf_emma,bm_george`.
     It only synthesises missing clips. `--force` re-records; a clip whose bytes changed gets a new
     content-hash filename so phones holding the old one in the service-worker cache fetch it
     (see the script's docstring). `scripts/clipCoverage.test.ts` fails on any unrecorded drill line.
- **Playwright:** give each parallel run its own `E2E_PORT`; the config reuses an existing dev
  server on that port. `e2e/charts.spec.ts` rewrites `docs/sources/chart-view-*.png`; restore them,
  don't commit them.
