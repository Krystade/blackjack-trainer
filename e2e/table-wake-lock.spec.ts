import { test, expect } from '@playwright/test';

/**
 * B9: the eyes-free Play table holds a screen wake lock for itself, not only
 * while a microphone window is open, and lets go when eyes-free goes off.
 */
test('an eyes-free table keeps the screen awake, and releases it when the table is left', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __wake: { held: number; requests: number } };
    w.__wake = { held: 0, requests: 0 };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          w.__wake.requests += 1;
          w.__wake.held += 1;
          let released = false;
          const target = new EventTarget();
          return Object.assign(target, {
            get released() {
              return released;
            },
            type: 'screen',
            release: async () => {
              if (!released) {
                released = true;
                w.__wake.held -= 1;
              }
            },
          });
        },
      },
    });
  });
  const held = () => page.evaluate(() => (window as unknown as { __wake: { held: number } }).__wake.held);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mixed', exact: true }).click();
  await page.getByLabel('Eyes-free audio').check();
  // Out of the drill, so its own hold is gone, then the table.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
  await expect.poll(held).toBe(0);
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  await expect.poll(held).toBe(1);
  // Leaving the table (End, with no round played, goes straight home) lets go.
  await page.locator('.end-btn').click();
  if (!(await page.locator('.home-title').isVisible())) await page.locator('.end-btn').click();
  await expect(page.locator('.home-title')).toBeVisible();
  await expect.poll(held).toBe(0);
});

test('a table that is not eyes-free takes no wake lock', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __wakeRequests: number };
    w.__wakeRequests = 0;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          w.__wakeRequests += 1;
          return Object.assign(new EventTarget(), { released: false, type: 'screen', release: async () => undefined });
        },
      },
    });
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __wakeRequests: number }).__wakeRequests)).toBe(0);
});
