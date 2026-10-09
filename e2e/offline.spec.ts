import { test, expect } from '@playwright/test';
import {
  withSettings,
  withProfile,
  openCountOptions,
  answerSelfReportIfPresent,
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
