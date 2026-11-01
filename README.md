# Blackjack Trainer

A phone-first PWA for practising Hi-Lo card counting and basic strategy, built above all for
eyes-free drilling by voice (in the car). Play is graded against basic strategy and the index
deviations for the table rules you set. Table rules (decks, H17/S17 and the rest) are set per
profile; see the profile types in `src/store/types.ts` and the engine in `src/engine/`. Strategy
data is traced to the source documents in `docs/sources/`.

## Audio

- Audio is on by default (Settings → Audio). Spoken lines play from pre-recorded clips
  (`public/clips/<voice>/`, Kokoro voices, listed in `public/clips/index.json`); a line with no
  clip falls back to the device's speech synthesis.
- Once the microphone has opened, iOS sends `<audio>` to the earpiece, so clips then play through
  Web Audio. Where the sound goes is chosen per device by the route settings
  (`src/audio/audioRoute.ts`); what has been measured on Jack's phone is in `docs/NEXT-TEST.md`
  and `docs/research/2026-10-26-audio-routes.md`.
- The screen is kept awake while an audio mode runs (Screen Wake Lock, best effort).
- Adding or re-recording a spoken line: see "Spoken lines must be recorded" in `docs/HANDOFF.md`.
  Clips are served cache-first by the service worker, so a re-recorded clip gets a new filename.

## Getting started

```bash
npm install
npm run dev        # dev server
npm test           # unit tests (vitest)
npm run e2e        # Playwright e2e, local only
npm run build      # production build to dist/
```

## Deploying

Push to `main`. `.github/workflows/deploy.yml` runs lint, `tsc -b`, `npm test` and `npm run build`,
then publishes `dist/` to GitHub Pages. The e2e suite is not run in CI; run it locally.

## Where state lives

- Stats and settings: the browser's localStorage, per device (Export/Import on the Stats screen).
- Project state: `docs/HANDOFF.md` (start here), `docs/NEXT-TEST.md`, `docs/BACKLOG.md`.
