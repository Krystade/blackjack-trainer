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
      name: 'chromium-audio',
      testMatch: /clip-playback\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
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
