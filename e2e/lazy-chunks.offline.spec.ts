import { test, expect, type Page, type Request } from '@playwright/test';

/**
 * F11 (W2-24): the bundle split, checked against the BUILT app (this file
 * runs in the `offline` project, over `vite preview` of a fresh dist/).
 *
 *  1. The rarely used screens really are lazy: their chunks are not
 *     requested at launch, only when the screen is opened.
 *  2. The service worker still holds every chunk, so a phone that never
 *     opened FieldTest can open it with the network out.
 *  3. A chunk that fails to load goes down the existing update path (reload
 *     onto the deployed build) when there is one, and to the error boundary
 *     when there is not.
 */

const CHUNK = (name: string) => new RegExp(`/assets/${name}-[^/]+\\.js$`);

function chunkRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r: Request) => {
    const m = /\/assets\/([A-Za-z]+)-[^/]+\.js$/.exec(new URL(r.url()).pathname);
    if (m) seen.push(m[1]!);
  });
  return seen;
}

test('FieldTest, the Test Kit and the profile editor load their chunks only when opened', async ({ page }) => {
  const seen = chunkRequests(page);
  // ?e2e=1: no service worker, so every chunk is a real request this page makes.
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('testkit-open')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(seen).toContain('index');
  expect(seen).toContain('vendor');
  expect(seen).not.toContain('TestKit');
  expect(seen).not.toContain('FieldTest');
  expect(seen).not.toContain('ProfileEditor');

  await page.getByTestId('testkit-open').click();
  await expect(page.getByTestId('testkit-screen')).toBeVisible();
  expect(seen).toContain('TestKit');
  expect(seen).not.toContain('FieldTest');

  const fieldTest = page.waitForRequest(CHUNK('FieldTest'));
  await page.getByTestId('fieldtest-open').click();
  await fieldTest;
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  expect(seen).not.toContain('ProfileEditor');
});

test('every chunk is precached: FieldTest and the profile editor open offline though never opened online', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const html = await (await page.request.get('/')).text();
  const listed = [...html.matchAll(/<link rel="precache" href="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]!);
  expect(listed.some((f) => CHUNK('FieldTest').test(`/${f}`))).toBe(true);
  expect(listed.some((f) => CHUNK('vendor').test(`/${f}`))).toBe(true);

  await page.goto('/');
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.ready).active), undefined, {
    timeout: 30_000,
  });
  // The first load was not controlled by the worker; this navigation is, and
  // the worker stores the document only with every file it names.
  await page.reload();
  await page.waitForFunction(
    async (files) => {
      const cache = await caches.open('bjtrainer-offline-v2');
      const keys = (await cache.keys()).map((r) => new URL(r.url).pathname);
      return files.every((f) => keys.some((k) => k.endsWith(`/${f}`)));
    },
    listed,
    { timeout: 30_000 },
  );

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('testkit-open')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('testkit-open').click();
  await expect(page.getByTestId('testkit-screen')).toBeVisible();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  await expect(page.getByText('Something broke on this screen.')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.home-profile-chip')).toBeVisible({ timeout: 20_000 });
  await page.locator('.home-profile-chip').click();
  await expect(page.locator('.profile-editor-screen')).toBeVisible();

  // Wave O: Play and Stats are lazy too, and open offline though never opened online.
  await page.reload();
  // Wave W: Stats is the second half of the You tab, which opens on Progress.
  await page.locator('.tab-bar').getByRole('button', { name: 'You', exact: true }).click({ timeout: 20_000 });
  await expect(page.locator('.tab-bar [aria-current="page"]')).toContainText('You');
  await expect(page.getByTestId('progress-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('you-seg-stats').click({ timeout: 20_000 });
  await expect(page.locator('.stats-screen')).toBeVisible({ timeout: 20_000 });
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Something broke on this screen.')).toHaveCount(0);
  await context.setOffline(false);
});

test('Wave O: the heavy chunks are not in the first load; Play and Stats are fetched only once it is done', async ({ page }) => {
  // The shipped document: nothing heavy is modulepreloaded (review N4).
  const html = await (await page.request.get('/')).text();
  const preloaded = [...html.matchAll(/rel="modulepreload"[^>]*href="\.\/assets\/([A-Za-z]+)-/g)].map((m) => m[1]!);
  expect(preloaded.length).toBeGreaterThan(0);
  for (const name of ['Table', 'Stats', 'Progress', 'strategy', 'sideBetConfig', 'VariantCharts', 'SideCountDrillView', 'VariantDrillView']) {
    expect(preloaded, name).not.toContain(name);
  }
  // Review S2: Play and Stats are then prefetched when idle -- AFTER the load event.
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('testkit-open')).toBeVisible();
  const timing = await page.waitForFunction(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const res = performance.getEntriesByType('resource').filter((e) => /\/assets\/(Table|Stats)-[^/]+\.js$/.test(e.name));
    if (!nav || nav.loadEventEnd === 0 || res.length < 2) return null;
    return { load: nav.loadEventEnd, first: Math.min(...res.map((e) => e.startTime)) };
  }, undefined, { timeout: 15_000 });
  const t = (await timing.jsonValue())!;
  expect(t.first, 'a lazy chunk was fetched before the first load finished').toBeGreaterThanOrEqual(t.load);
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
});

test('a chunk that fails to load reloads onto a newer deployed build', async ({ page }) => {
  await page.route(CHUNK('TestKit'), (route) => route.abort());
  await page.route(/\/version\.json(\?.*)?$/, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ buildId: 'newer-build', builtAt: '' }) }),
  );
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await page.waitForURL(/[?&]v=newer-build/);
  await expect(page.getByTestId('testkit-open')).toBeVisible();
});

test('a chunk that fails with no newer build shows the error panel, not a reload loop', async ({ page }) => {
  await page.route(CHUNK('TestKit'), (route) => route.abort());
  let navigations = 0;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navigations += 1;
  });
  await page.goto('/?e2e=1');
  const before = navigations;
  await page.getByTestId('testkit-open').click();
  await expect(page.getByText('Something broke on this screen.')).toBeVisible();
  expect(navigations).toBe(before);
  expect(page.url()).not.toMatch(/[?&]v=/);
});

test("Settings' offline save stores every chunk, the lazy screens' included, without opening them", async ({ page }) => {
  test.setTimeout(90_000);
  // Shell only: with no clip voice list the save skips the 615 recordings.
  await page.route(/\/clips\/index\.json$/, (route) => route.fulfill({ status: 404, body: '' }));
  const html = await (await page.request.get('/')).text();
  const listed = [...html.matchAll(/<link rel="precache" href="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]!);
  expect(listed.length).toBeGreaterThanOrEqual(5);
  // ?e2e=1: no service worker, so only the page's own save can fill the cache.
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  // The section may already be open (it remembers); open it only if not.
  if (!(await page.getByTestId('offline-save').isVisible())) await page.locator('summary', { hasText: 'Offline' }).click();
  await page.getByTestId('offline-save').click();
  await expect(page.getByTestId('offline-result')).toBeVisible({ timeout: 60_000 });
  const cached = await page.evaluate(async () => {
    const cache = await caches.open('bjtrainer-offline-v2');
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
  for (const f of listed) expect(cached.some((k) => k.endsWith(`/${f}`)), f).toBe(true);
});
