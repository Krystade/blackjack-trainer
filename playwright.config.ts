import { defineConfig, devices } from '@playwright/test';

// Port is env-driven (default 4173) so multiple e2e runs can coexist on
// different ports without fighting over --strictPort. CI/local default is
// unchanged.
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = `http://localhost:${PORT}`;
/*
 * A SECOND SERVER, SERVING THE REAL BUILD.
 *
 * The offline spec is about the service worker, which is registered only in a
 * production build (see offline/registerOffline.ts: a worker in front of the
 * dev server would answer HMR out of a cache and would carry one spec's cached
 * page into the next across the 716 specs that share the dev server). So that
 * one spec talks to `vite preview` over `dist/`, which is the artefact that
 * actually ships.
 */
const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT ?? PORT + 1);
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // The default project runs every spec EXCEPT the real-audio clip-playback
      // harness (that one needs a different Chromium launch and must not use
      // ?e2e=1, so it lives in its own project below).
      testIgnore: /(clip-playback|field-test-audio|offline)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        // A FAKE MICROPHONE, so the one step whose entire product is a number
        // can be asserted on. `ambient` opens a real `getUserMedia` and folds
        // five seconds of frames into a dBFS figure; with no device and no
        // permission that call rejected in milliseconds, so every test
        // touching it -- including one named for leaving a measurement
        // running -- exercised only the rejection path and could not fail for
        // the thing it was named after. `--use-fake-device-for-media-stream`
        // is a generated tone, not a real microphone: nothing is recorded and
        // nothing is heard.
        permissions: ['microphone'],
        launchOptions: {
          /**
           * `--mute-audio` IS NOT OPTIONAL HERE EITHER, and the reason this
           * project went without it for so long was a wrong assumption.
           *
           * Nearly every spec navigates with `?e2e=1`, which short-circuits
           * `speak()` and `chime()` into `window.__speechLog` before any sound
           * is made -- so the default project looked silent by construction.
           * `collapsible-sections.spec.ts` does not: it measures the real
           * Settings page at a real viewport and loads `/` plainly, which
           * leaves the audio paths live. Jack heard it out of his speakers on
           * 2026-10-03, right after the chimes moved from a Web Audio
           * oscillator onto a media element and so began playing reliably.
           *
           * Muting is process-wide and stops nothing the suite asserts on:
           * elements still load, decode, fire `ended` and drive every loop,
           * and no spec anywhere asserts that something was AUDIBLE -- only
           * that it played, how long it took, and what it logged. The cost of
           * the flag is zero and the cost of omitting it is a suite nobody can
           * run while anyone else is in the room.
           */
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--mute-audio',
          ],
        },
      },
    },
    {
      // Real clip audio playback (T0): no ?e2e=1, so clips.ts actually fetches
      // and plays mp3s. Chromium must autoplay without a user gesture.
      //
      // `--mute-audio` is not optional and not a nicety: without it this
      // project plays every clip out of the operator's speakers, which made
      // the one harness that exercises real playback the one harness nobody
      // could ever run. Muting is process-wide and does not stop playback --
      // the elements still load, decode, fire `ended`, and drive the drill
      // loop, which is the entire signal this project asserts on.
      //
      // The specs add a second, independent guard: an init script that wraps
      // `HTMLMediaElement.prototype.play` and sets `volume = 0` and
      // `muted = true` through the real setters before the element starts.
      // Being heard through a speaker takes both of those failing.
      //
      // WHAT THAT SECOND GUARD DOES NOT COVER, said plainly rather than
      // implied: `clips.ts` can route an element through
      // `createMediaElementSource` into a `GainNode` for the above-unity
      // boost, and the launch flag is what covers that path. The guard used
      // to be a `muted` accessor shadowed on the prototype, which reached
      // Blink's internal flag not at all and silenced nothing whatsoever --
      // so for as long as it stood, this comment was the only thing between
      // the operator and a speaker.
      name: 'chromium-audio',
      testMatch: /(clip-playback|field-test-audio)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
      },
    },
    {
      // The only project pointed at the built app, because the service worker
      // it tests is registered only there.
      name: 'offline',
      testMatch: /offline\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        baseURL: PREVIEW_URL,
      },
    },
  ],
  webServer: [
    {
      command: `npm run dev -- --port ${PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      // Built fresh, so the spec can never pass against a stale `dist/`.
      command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
      url: PREVIEW_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
