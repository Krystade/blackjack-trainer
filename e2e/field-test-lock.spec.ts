import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';
import { FIELD_TEST_STEPS } from '../src/diag/fieldTest';

/**
 * THE LOCK PROBE, DRIVEN.
 *
 * `lockProbe.test.ts` pins the arithmetic. This proves the runner actually
 * does it: ticks land while the step shows, a hidden/visible cycle is scored
 * from them, and a page killed under the lock is scored by the next boot. A
 * probe whose arithmetic is right and whose wiring is missing writes nothing,
 * which reads in the export exactly like a frozen page.
 *
 * Chromium here is never really hidden, so the "lock" is `visibilityState`
 * faked and `visibilitychange` dispatched; the page keeps ticking through it,
 * which is the NORMAL verdict. The frozen and throttled verdicts are pinned
 * in the unit test; the killed-page verdict is a real reload below.
 */

async function entries(page: Page): Promise<{ event: string; detail: Record<string, unknown> }[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
    return raw
      ? (JSON.parse(raw) as { event: string; detail?: Record<string, unknown> }[]).map((e) => ({
          event: e.event,
          detail: e.detail ?? {},
        }))
      : [];
  });
}

async function openTest(page: Page): Promise<void> {
  await withSettings(page, {});
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  const start = page.getByTestId('fieldtest-start');
  await start.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
}

async function goToStep(page: Page, id: string): Promise<void> {
  const want = FIELD_TEST_STEPS.find((s) => s.id === id);
  expect(want, `${id} is not in the protocol`).toBeTruthy();
  const title = page.getByTestId('fieldtest-title');
  for (let i = 0; i < FIELD_TEST_STEPS.length + 2; i++) {
    if ((await title.innerText()) === want!.title) return;
    await page.getByTestId('fieldtest-skip').click();
  }
  throw new Error(`never reached ${id}`);
}

async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('scores a lock from its own ticks, and says so', async ({ page }) => {
  await openTest(page);
  await goToStep(page, 'lock-probe');

  // Ticks are landing before anything is locked -- the clock is the probe's
  // own, not borrowed from a step that happens to be speaking.
  await expect
    .poll(async () => (await entries(page)).filter((e) => e.event === 'lock-probe-tick').length, {
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(1);

  await setVisibility(page, 'hidden');
  await page.waitForTimeout(6_500);
  await setVisibility(page, 'visible');

  await expect
    .poll(async () => (await entries(page)).some((e) => e.event === 'lock-probe-result'), {
      timeout: 5_000,
    })
    .toBe(true);
  const result = (await entries(page)).find((e) => e.event === 'lock-probe-result')!;
  expect(result.detail.classification, 'a page that kept ticking was not called normal').toBe(
    'normal',
  );
  expect(result.detail.hiddenMs as number).toBeGreaterThanOrEqual(6_000);
  expect(result.detail.ticksInside as number).toBeGreaterThanOrEqual(2);

  // The verdict is spoken as well as written: the operator has just unlocked
  // the phone and is not reading the log.
  const spoken = await page.evaluate(
    () => (window as unknown as { __speechLog?: string[] }).__speechLog ?? [],
  );
  expect(spoken.some((line) => /kept running/i.test(line))).toBe(true);

  // Scored once: the marker is cleared, so a second boot has nothing to find.
  const marker = await page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.fieldTestRun.v1');
    return raw ? (JSON.parse(raw) as { lockProbe?: unknown }).lockProbe : undefined;
  });
  expect(marker).toBeUndefined();
});

test('a page killed under the lock is scored by the next boot', async ({ page }) => {
  await openTest(page);
  await goToStep(page, 'lock-probe');
  await expect
    .poll(async () => (await entries(page)).filter((e) => e.event === 'lock-probe-tick').length, {
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(1);

  await setVisibility(page, 'hidden');
  await page.waitForTimeout(500);
  // Nothing is scored while the probe's own session is still alive: a stamp
  // written here would be the runner scoring its own marker as a kill.
  expect((await entries(page)).filter((e) => e.event === 'lock-probe-result')).toHaveLength(0);
  // iOS discarding the page: a fresh session id, the run back on the gate.
  await page.reload();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();

  await expect
    .poll(
      async () =>
        (await entries(page)).find((e) => e.event === 'lock-probe-result')?.detail.classification,
      { timeout: 5_000 },
    )
    .toBe('frozen-unloaded');
  // ...and exactly once, whatever the gate re-renders.
  await page.waitForTimeout(1_500);
  expect((await entries(page)).filter((e) => e.event === 'lock-probe-result')).toHaveLength(1);
});
