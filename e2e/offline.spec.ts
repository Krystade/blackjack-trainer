import { test, expect } from '@playwright/test';
import {
  withSettings,
  withProfile,
  openCountOptions,
  answerSelfReportIfPresent,
  resolveInsurance,
  readStats,
  statsTab,
} from './helpers';

/**
 * CAN HE TRAIN ON A PLANE?
 *
 * Everything else in this suite runs against the dev server, where there is no
 * service worker at all. This one project runs against `vite preview` over a
 * freshly built `dist/`, because the worker is registered only in a production
 * build -- and because an offline claim verified against anything other than
 * the artefact that ships is not verified.
 *
 * The test is the question itself: save it, pull the network out, reload, and
 * see whether the app is still there.
 */
const SAVE_TIMEOUT = 120_000;

async function workerReady(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return Boolean(reg.active);
    },
    undefined,
    { timeout: 30_000 },
  );
}

async function saveForOffline(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.locator('summary', { hasText: 'Offline' }).click();
  await page.getByTestId('offline-save').click();
  await expect(page.getByTestId('offline-result')).toBeVisible({ timeout: SAVE_TIMEOUT });
}

test('the app launches and keeps its voice with the network pulled out', async ({ page, context }) => {
  test.setTimeout(SAVE_TIMEOUT + 60_000);

  await page.goto('/');
  await workerReady(page);
  await saveForOffline(page);

  const saved = await page.getByTestId('offline-result').innerText();
  expect(saved, `the download reported failures: ${saved}`).not.toContain('failed');

  /*
   * THE MOMENT THE DOOR CLOSES. Before the fix this reload lands on the
   * browser's own no-internet page: there is no cached document, so the
   * installed app has nothing to run and the whole flight is lost.
   */
  await context.setOffline(true);
  await page.reload();

  await expect(
    page.getByTestId('testkit-open'),
    'the app did not come up offline',
  ).toBeVisible({ timeout: 20_000 });

  // And the voice is really on the phone, not merely the shell. A drill that
  // boots and then falls back to live iOS speech is the failure this exists to
  // prevent, and on a plane it is discovered mid-hand.
  const clip = await page.evaluate(async () => {
    const res = await fetch('./clips/index.json');
    if (!res.ok) return { ok: false, voice: null as string | null };
    const index = (await res.json()) as { default: string };
    const manifestRes = await fetch(`./clips/${index.default}/manifest.json`);
    if (!manifestRes.ok) return { ok: false, voice: index.default };
    const manifest = (await manifestRes.json()) as { clips: Record<string, string> };
    const first = Object.values(manifest.clips)[0];
    const mp3 = await fetch(`./clips/${index.default}/${first}`);
    const bytes = mp3.ok ? (await mp3.arrayBuffer()).byteLength : 0;
    return { ok: mp3.ok && bytes > 0, voice: index.default, bytes };
  });
  expect(clip.ok, `no clip audio offline: ${JSON.stringify(clip)}`).toBe(true);
});

test('a media element can still ask for byte ranges offline', async ({ page, context }) => {
  /*
   * Clips play through an HTMLAudioElement as well as through Web Audio, and a
   * media element asks for ranges. A worker that answers a range request with
   * the whole file is how offline playback fails SILENTLY -- the fetch looks
   * fine and nothing comes out of the speaker.
   */
  test.setTimeout(SAVE_TIMEOUT + 60_000);

  await page.goto('/');
  await workerReady(page);
  await saveForOffline(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('testkit-open')).toBeVisible({ timeout: 20_000 });

  const ranged = await page.evaluate(async () => {
    const index = (await (await fetch('./clips/index.json')).json()) as { default: string };
    const manifest = (await (await fetch(`./clips/${index.default}/manifest.json`)).json()) as {
      clips: Record<string, string>;
    };
    const url = `./clips/${index.default}/${Object.values(manifest.clips)[0]}`;
    const res = await fetch(url, { headers: { Range: 'bytes=0-99' } });
    return {
      status: res.status,
      length: (await res.arrayBuffer()).byteLength,
      contentRange: res.headers.get('content-range'),
    };
  });

  expect(ranged.status, 'the range request was answered with a whole file').toBe(206);
  expect(ranged.length).toBe(100);
  expect(ranged.contentRange).toMatch(/^bytes 0-99\/\d+$/);
});

test('the update file is never saved, so a new build can still arrive', async ({ page, context }) => {
  /*
   * THE TRAP IN EVERY OFFLINE APP. `updateCheck` polls version.json to learn
   * whether a newer build has shipped. Cache it and the answer is frozen at
   * the day the cache was warmed, and an installed phone can never be told to
   * update again -- which on this project means a drive spent testing a build
   * that was replaced a week earlier.
   *
   * THE FETCH BELOW IS THE TEST. An earlier version of this spec only looked
   * in the cache after pressing Save, and passed with the exclusion deleted
   * from both the worker and the url list: `startUpdateWatch` had not polled
   * yet, so version.json was never requested, and a policy about requests that
   * never happen cannot be checked. So the request is made here, exactly as
   * `updateCheck` makes it -- cache-busting query and all -- and then the cache
   * is searched by path, since that query is what a naive key would hide it
   * behind.
   */
  test.setTimeout(SAVE_TIMEOUT + 60_000);

  await page.goto('/');
  await workerReady(page);
  await saveForOffline(page);

  const fetched = await page.evaluate(async () => {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    return { ok: res.ok, status: res.status };
  });
  expect(fetched.ok, `the build does not serve version.json (${fetched.status}), so this test proves nothing`).toBe(
    true,
  );

  const cachedVersionFiles = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        if (new URL(req.url).pathname.endsWith('/version.json')) out.push(req.url);
      }
    }
    return out;
  });
  expect(cachedVersionFiles, 'version.json was cached').toEqual([]);

  // And offline it fails rather than being answered out of a cache.
  await context.setOffline(true);
  const reachable = await page.evaluate(async () => {
    try {
      const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      return res.ok;
    } catch {
      return false;
    }
  });
  expect(reachable, 'version.json answered offline, so it came from a cache').toBe(false);
});

test('a whole drill runs with the network pulled out', async ({ page, context }) => {
  /*
   * THE ACTUAL CLAIM. The tests above prove the app comes up offline and that
   * clip audio is retrievable; neither proves a drill RUNS. On a plane the
   * difference is everything -- a shell that boots and then stalls waiting for
   * a recording it never saved fails in the middle of a hand, which is the one
   * place it cannot be recovered from.
   *
   * So this is the flight: save on the ground, pull the network, reload, and
   * play an eyes-free count drill to its result with nothing but what is on
   * the phone.
   */
  test.setTimeout(SAVE_TIMEOUT + 120_000);

  await withSettings(page, {
    audio: {
      enabled: true,
      useClips: true,
      verbosity: 'full',
      clipVoice: 'af_bella',
      answerPauseMs: 500,
    },
    drill: {
      countManual: false,
      countLengthCards: 5,
      countGroup: 1,
      countIntervalMs: 0,
      wheelMode: 'answer',
    },
  });
  await withProfile(page, { name: 'Offline Flight Profile' });

  await page.goto('/');
  await workerReady(page);
  await saveForOffline(page);

  await context.setOffline(true);
  await page.reload();

  // Every request from here on can only be answered out of the cache.
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(r.url()));

  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await openCountOptions(page);
  await page.getByLabel('Eyes-free audio').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await answerSelfReportIfPresent(page);
  await expect(page.locator('.drill-result'), 'the drill never reached a result offline').toBeVisible({
    timeout: 60_000,
  });

  // The recordings really came off the phone. version.json is the one request
  // that is SUPPOSED to fail offline -- it is deliberately never cached.
  const unexpected = failed.filter((u) => !u.includes('version.json'));
  expect(unexpected, `requests failed offline: ${JSON.stringify(unexpected.slice(0, 5))}`).toEqual([]);
});

/**
 * EVERY DRILL, PLAY INCLUDED, WITH THE NETWORK OUT.
 *
 * Asked for in those words: "check all drills offline and check actual play
 * and counting offline too." The tests above prove the shell boots and that
 * one eyes-free count drill runs; neither says anything about the other ten
 * modes or about playing a hand, and a drill that needs one uncached file
 * fails in the air with no way to fix it.
 *
 * This is `smoke.spec.ts`'s full journey, run offline against the built app.
 * Two things make it a different test rather than a copy:
 *
 *   - It carries NO `?e2e=1`, so speech is not stubbed out. Every line goes
 *     through the real clip path, out of the cache, which is what the phone
 *     will do -- the dev-server smoke test never exercises that at all.
 *   - It fails on any request that failed after take-off, so a file nobody
 *     thought to save is caught here rather than at 35,000 feet. That is how
 *     the car's now-playing artwork was found.
 *
 * The tie-together assertion at the end is the counting half: it reads the
 * persisted stats and requires that the count drill, the true count, the deck
 * estimation and Produce-the-TC each actually SCORED a run, so "it rendered"
 * cannot pass for "it counted".
 */
test('every drill, a played hand and the counting all work offline', async ({ page, context }) => {
  test.setTimeout(SAVE_TIMEOUT + 300_000);

  await withProfile(page);
  await withSettings(page, {
    countCheckEvery: 0,
    audio: { enabled: true, useClips: true, verbosity: 'results', clipVoice: 'af_bella' },
    drill: { countLengthCards: 4, countGroup: 1, countIntervalMs: 300 },
  });

  await page.goto('/');
  await workerReady(page);
  await saveForOffline(page);

  await context.setOffline(true);
  await page.reload();

  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  /*
   * AND COUNT WHAT WAS SERVED. Without this the test passes just as well
   * when no audio was ever requested -- 'nothing failed' is true of a walk
   * that never asked for a recording, which is precisely the silent-drill
   * failure this is supposed to catch.
   */
  const servedMp3 = new Set<string>();
  page.on('response', (r) => {
    if (r.url().endsWith('.mp3') && r.ok()) servedMp3.add(r.url());
  });
  await expect(page.locator('.home-title')).toBeVisible({ timeout: 20_000 });

  // --- Play: deal a hand and play it out by the advice the app gives -------
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  /*
   * STAND, rather than `playRoundByAdvice`. That helper returns as soon as
   * `.action-bar[data-advice]` is absent, and without `?e2e=1` the advice
   * attribute is not there the instant the cards land -- so it walked away
   * from a live hand and the result never came. The claim here is that a
   * hand can be PLAYED and SETTLED with no network, not that the advice
   * engine was consulted; `game.spec.ts` owns that online.
   */
  await resolveInsurance(page, false);
  await page.locator('.action-bar .action-btn', { hasText: 'Stand' }).first().click();
  await expect(
    page.locator('.message-strip .message-result').first(),
    'a hand could not be played and settled offline',
  ).toBeVisible({ timeout: 30_000 });
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await page.locator('.report-done-btn').click();
  await expect(page.locator('.home-title')).toBeVisible();

  // --- Count drill: run it and submit a count on the keypad ---------------
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await expect(page.locator('.drills-title')).toHaveText('Drills');

  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await openCountOptions(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad'), 'the count drill never dealt offline').toBeVisible({
    timeout: 30_000,
  });
  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('.drill-result')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();

  // --- True count drill ---------------------------------------------------
  await page.getByRole('button', { name: 'True count drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('.drill-result')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();

  // --- Deck estimation ----------------------------------------------------
  await page.getByRole('button', { name: 'Deck estimation', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.deck-guess-grid')).toBeVisible({ timeout: 30_000 });
  await page.locator('.deck-guess-btn').first().click();
  await expect(page.locator('.drill-result')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();

  // --- Flashcards ---------------------------------------------------------
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  await expect(page.locator('.feedback-cell')).toBeVisible();
  await page.locator('.drill-back-btn', { hasText: 'Back' }).click();

  // --- Deviation quiz -----------------------------------------------------
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Deviation quiz');
  const insurance = page.locator('.quiz-insurance-prompt');
  if (await insurance.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Decline insurance', exact: true }).click();
  } else {
    await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  }
  await expect(page.locator('.quiz-label')).not.toHaveText('');
  await page.locator('.drill-back-btn', { hasText: 'Back' }).click();

  // --- Pair cancellation --------------------------------------------------
  await page.getByRole('button', { name: 'Pair cancellation', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Pair cancellation');
  await page.locator('.pair-cancel-answers .action-btn').first().click();
  await expect(page.locator('.drill-next-btn')).toBeVisible();
  await page.locator('.drill-back-btn', { hasText: 'Back' }).click();

  // --- Produce the true count ---------------------------------------------
  await page.getByRole('button', { name: 'Produce the true count', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Produce the true count');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('.drill-result')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  // --- Mixed --------------------------------------------------------------
  await page.getByRole('button', { name: 'Mixed', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Mixed');
  await page.locator('.action-bar button.action-btn').first().click();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
  await page.locator('.drill-back-btn', { hasText: 'Back' }).click();

  // --- Mastery challenge --------------------------------------------------
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Mastery challenge');
  await page.locator('.action-bar button.action-btn').first().click();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
  await page.locator('.drill-back-btn', { hasText: 'Back' }).click();

  // --- Bet / sit / leave --------------------------------------------------
  await page.getByRole('button', { name: 'Bet / sit / leave', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Bet / sit / leave');
  await page.locator('.bsl-answers .action-btn').first().click();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
  await page.locator('.drill-back-btn', { hasText: 'Back' }).click();

  // --- Downswing: bet, deal, settle one hand ------------------------------
  await page.getByRole('button', { name: 'Downswing', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Downswing');
  await page.locator('.chip-btn').first().click();
  await page.locator('.deal-btn').click();
  await page.locator('.action-bar .action-btn', { hasText: 'Stand' }).click();
  await expect(page.locator('.drill-next-btn')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();

  /*
   * THE COUNTING HALF. "It rendered" must not pass for "it counted", so the
   * persisted stats are read back: each counting drill has to have scored a
   * run, and the played hand has to have left a session behind.
   */
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await page.locator('.home-stats-link').click();
  await expect(page.locator('.stats-heading')).toHaveText('Stats');
  await statsTab(page, 'Drills');
  // The history sections are collapsed <details>; only `?e2e=1` forces them
  // open, and this spec cannot carry it (the worker skips registration).
  await page.locator('summary', { hasText: 'Count drill' }).first().click();
  await expect(
    page.locator('.count-history-row').first(),
    'the count drill left no history to show',
  ).toBeVisible();

  const stats = await readStats(page);
  expect(stats).not.toBeNull();
  const history = (key: string): unknown[] =>
    (stats?.[key] as { history?: unknown[] } | undefined)?.history ?? [];

  expect(
    (stats?.sessions as unknown[] | undefined) ?? [],
    'the played hand scored nothing',
  ).not.toHaveLength(0);
  expect(history('countDrill'), 'the count drill scored nothing offline').not.toHaveLength(0);
  expect(history('trueCount'), 'the true count drill scored nothing offline').not.toHaveLength(0);
  expect(history('deckEstimation'), 'deck estimation scored nothing offline').not.toHaveLength(0);
  expect(history('produceTc'), 'produce-the-true-count scored nothing offline').not.toHaveLength(0);
  expect(
    (stats?.latencyHistory as unknown[] | undefined) ?? [],
    'the graded drills recorded no answers offline',
  ).not.toHaveLength(0);

  // Nothing may have failed after take-off except the update file, which is
  // deliberately never cached.
  const unexpected = failed.filter((u) => !u.includes('version.json'));
  expect(unexpected, `requests failed offline: ${JSON.stringify(unexpected.slice(0, 8))}`).toEqual([]);

  // The app really spoke, out of the cache, with no network to fetch from.
  expect(servedMp3.size, 'no recording was played offline at all').toBeGreaterThan(0);
});
