import { defineConfig, devices } from '@playwright/test';

// Port is env-driven (default 4173) so multiple e2e runs can coexist on
// different ports without fighting over --strictPort. CI/local default is
// unchanged.
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = `http://localhost:${PORT}`;

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
      testIgnore: /clip-playback\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
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
      // loop, which is the entire signal this project asserts on. The spec
      // adds a second, independent guard at the element level (see its
      // `muted` init script), so being heard would take both failing.
      name: 'chromium-audio',
      testMatch: /clip-playback\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
