import { test, expect, type Page, type Response as PWResponse } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * T0 gap 1 (the headline gap, docs/research/2026-07-26-test-coverage-matrix.md
 * "SPEC -- Clip-playback harness"): a NON-`?e2e=1` harness for real clip
 * playback. Every other e2e spec navigates with `?e2e=1`, which makes
 * `isE2eAudioMode()` true and short-circuits `speak()`/`speakAsync()` into
 * `window.__speechLog` BEFORE the clips.ts gate (src/audio/speech.ts) -- so
 * `playClipsAsync` (real mp3 fetch + HTMLAudio playback) has never once run
 * under Playwright. This spec runs WITHOUT `?e2e=1` in the `chromium-audio`
 * Playwright project (playwright.config.ts), which launches Chromium with
 * `--autoplay-policy=no-user-gesture-required` so audio can play headless.
 *
 * Headless Chromium can't "hear," so the harness asserts on the maximal
 * reachable signal instead of audible sound: real network fetches of the
 * clip assets, the eyes-free drill loop actually completing (a stuck clip
 * promise would hang the loop and time out), and a clean console (catches
 * decode/MIME/`playbackRate` exceptions).
 */

const MP3_RE = /\/clips\/af_bella\/.*\.mp3(\?.*)?$/;
const INDEX_RE = /\/clips\/index\.json(\?.*)?$/;
const MANIFEST_RE = /\/clips\/af_bella\/manifest\.json(\?.*)?$/;

interface ClipHarness {
  mp3Responses: PWResponse[];
  indexResponses: PWResponse[];
  manifestResponses: PWResponse[];
  consoleErrors: string[];
  pageErrors: string[];
}

/** `<audio>` elements issue HTTP Range requests, so a real successfully-served
 * mp3 can legitimately come back `206 Partial Content` rather than `200` --
 * this is correct server/browser behavior, not a failure. Both mean "the
 * asset was actually served"; only a 404/5xx indicates a real miss. */
function expectServedOk(res: PWResponse): void {
  expect([200, 206], `expected 200 or 206 for ${res.url()}, got ${res.status()}`).toContain(res.status());
}

/** Attaches response/console/pageerror listeners. Must be called BEFORE
 * page.goto() -- listeners attached after navigation would miss requests
 * fired during the initial load. */
function attachClipHarness(page: Page): ClipHarness {
  const harness: ClipHarness = {
    mp3Responses: [],
    indexResponses: [],
    manifestResponses: [],
    consoleErrors: [],
    pageErrors: [],
  };

  page.on('response', (res) => {
    const url = res.url();
    if (MP3_RE.test(url)) harness.mp3Responses.push(res);
    else if (INDEX_RE.test(url)) harness.indexResponses.push(res);
    else if (MANIFEST_RE.test(url)) harness.manifestResponses.push(res);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') harness.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    harness.pageErrors.push(err.message);
  });

  return harness;
}

/**
 * Settings.tsx is the ONLY place in the app that calls `loadClipIndex()`
 * (its Audio-section effect populates the clip-voice picker); clips.ts's own
 * internal calls to it are short-circuited away whenever `clipVoice` is
 * pinned (`currentClipVoice ||` in `playClipsAsync`/`resolveVoiceIdSync`
 * never reaches the fallback branch once a real voice id is set). Since this
 * harness pins `clipVoice: 'af_bella'` for deterministic filenames (matrix
 * spec step 1), a real user reaches that same state by visiting Settings and
 * toggling "Use recorded voice" -- so a brief Settings visit here is both
 * how `index.json` actually gets fetched AND a realistic path to this state,
 * not a workaround.
 */
async function warmSettingsForClipIndex(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Settings');
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
}

/** Navigates to Drills -> Count Drill, enables eyes-free audio, and starts a
 * short auto (non-manual) run -- the same shape as audio.spec.ts's Case 4b,
 * except real clip playback runs here because there's no `?e2e=1`. */
async function startEyesFreeCountDrill(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await page.getByLabel('Eyes-free audio').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

async function seedClipDrillSettings(page: Page, audioPatch: Record<string, unknown> = {}): Promise<void> {
  await withSettings(page, {
    audio: {
      enabled: true,
      useClips: true,
      verbosity: 'full',
      cardDetail: 'full',
      clipVoice: 'af_bella',
      answerPauseMs: 500,
      ...audioPatch,
    },
    drill: { countManual: false, countLengthCards: 5, countGroup: 1, countIntervalMs: 0 },
  });
}

/* ------------------------------------------------------------------------ */
/* Main harness: real clip fetch + playback + clean completion              */
/* ------------------------------------------------------------------------ */

test('clip playback (no ?e2e=1): eyes-free count drill fetches real clips and completes cleanly', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await seedClipDrillSettings(page);
  await withProfile(page, { name: 'Clip Playback E2E Profile' });

  const harness = attachClipHarness(page);

  await warmSettingsForClipIndex(page);
  await startEyesFreeCountDrill(page);

  // The no-hang guarantee: if a clip promise never resolves, the eyes-free
  // auto loop (CountDrillView's speech-driven effect) stalls forever and
  // this times out.
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 20_000 });

  const distinctMp3Urls = new Set(harness.mp3Responses.map((r) => r.url()));
  expect(
    distinctMp3Urls.size,
    `expected >=5 distinct mp3 fetches, got ${JSON.stringify([...distinctMp3Urls])}`,
  ).toBeGreaterThanOrEqual(5);
  for (const res of harness.mp3Responses) {
    expectServedOk(res);
  }

  expect(harness.indexResponses.length, 'expected index.json fetched exactly once (memoized)').toBe(1);
  expect(harness.indexResponses[0]?.status()).toBe(200);
  expect(harness.manifestResponses.length, 'expected af_bella manifest.json fetched exactly once (memoized)').toBe(
    1,
  );
  expect(harness.manifestResponses[0]?.status()).toBe(200);

  expect(harness.consoleErrors, `expected zero console errors, got ${JSON.stringify(harness.consoleErrors)}`).toEqual(
    [],
  );
  expect(harness.pageErrors, `expected zero page errors, got ${JSON.stringify(harness.pageErrors)}`).toEqual([]);
});

/* ------------------------------------------------------------------------ */
/* Fallback variant: unresolvable clip voice -> live-TTS fallback           */
/* ------------------------------------------------------------------------ */

test('clip playback fallback: a bogus clip voice still completes the drill via live TTS', async ({ page }) => {
  test.setTimeout(30_000);
  // Bogus clipVoice -> `/clips/<bogus>/manifest.json` 404s -> loadVoiceManifest
  // resolves `{}` -> segmentForClips never matches -> every speak()/speakAsync()
  // call falls back to live speechSynthesis. Proves the cascade-miss path
  // doesn't hang or throw even when NOTHING resolves to a clip.
  await seedClipDrillSettings(page, { clipVoice: 'not-a-real-voice-id' });
  await withProfile(page, { name: 'Clip Playback Fallback Profile' });

  const harness = attachClipHarness(page);

  await page.goto('/');
  await startEyesFreeCountDrill(page);

  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 20_000 });

  expect(
    harness.mp3Responses.length,
    `expected no mp3 fetches for a bogus voice, got ${JSON.stringify(harness.mp3Responses.map((r) => r.url()))}`,
  ).toBe(0);
  expect(harness.consoleErrors, `expected zero console errors, got ${JSON.stringify(harness.consoleErrors)}`).toEqual(
    [],
  );
  expect(harness.pageErrors, `expected zero page errors, got ${JSON.stringify(harness.pageErrors)}`).toEqual([]);
});

/* ------------------------------------------------------------------------ */
/* Rate variant: fast playbackRate doesn't break the clip chain             */
/* ------------------------------------------------------------------------ */

test('clip playback at rate=2.0 still fetches clips and completes cleanly', async ({ page }) => {
  test.setTimeout(30_000);
  await seedClipDrillSettings(page, { rate: 2.0 });
  await withProfile(page, { name: 'Clip Playback Rate2 Profile' });

  const harness = attachClipHarness(page);

  await warmSettingsForClipIndex(page);
  await startEyesFreeCountDrill(page);

  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 20_000 });

  const distinctMp3Urls = new Set(harness.mp3Responses.map((r) => r.url()));
  expect(
    distinctMp3Urls.size,
    `expected clips to still be fetched at rate 2.0, got ${JSON.stringify([...distinctMp3Urls])}`,
  ).toBeGreaterThanOrEqual(5);
  for (const res of harness.mp3Responses) {
    expectServedOk(res);
  }

  expect(harness.consoleErrors, `expected zero console errors, got ${JSON.stringify(harness.consoleErrors)}`).toEqual(
    [],
  );
  expect(harness.pageErrors, `expected zero page errors, got ${JSON.stringify(harness.pageErrors)}`).toEqual([]);
});
