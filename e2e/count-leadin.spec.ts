import { test, expect, type Page } from '@playwright/test';
import { openCountOptions, withProfile, withSettings } from './helpers';

/**
 * Wave X (item 7): "a short countdown at the start before it begins flipping
 * through them". On screen, 3-2-1 a beat each and then the first card; no card
 * shows during it. Eyes-free, one neutral chime and the same beat -- and no
 * words, so the car hears nothing new but the ding. Driven on the page's fake
 * clock, so every beat is exact.
 */

test.use({ viewport: { width: 375, height: 812 } });

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);

async function openCount(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await openCountOptions(page);
}

test('on screen: 3, 2, 1, a beat each, then the first card -- and nothing to count before it', async ({ page }) => {
  await page.clock.install();
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full' },
    drill: { countManual: false, countLengthCards: 6, countGroup: 1, countIntervalMs: 2000 },
  });
  await openCount(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  const leadIn = page.getByTestId('count-leadin');
  const cards = page.locator('.count-flash-cards .card');
  for (const n of ['3', '2', '1']) {
    await expect(leadIn).toHaveText(n);
    await expect(cards).toHaveCount(0);
    await page.clock.runFor(600);
  }
  await expect(leadIn).toHaveCount(0);
  await expect(cards).toHaveCount(1);
  await expect(page.locator('.count-flash-progress')).toContainText('1 / 6');
  // Visual: a numeral, not a sound.
  expect((await spoken(page)).filter((e) => e.startsWith('chime:'))).toEqual([]);
});

test('eyes-free: one chime and a beat before the first card is read, no words added', async ({ page }) => {
  await page.clock.install();
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 0 },
    drill: { countManual: false, countLengthCards: 6, countGroup: 1, countIntervalMs: 0 },
  });
  await openCount(page);
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  const before = (await spoken(page)).length;
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect.poll(async () => (await spoken(page)).slice(before)).toEqual(['chime:attention']);
  await page.clock.runFor(500);
  // Still the beat: nothing read yet.
  expect((await spoken(page)).slice(before)).toEqual(['chime:attention']);
  await page.clock.runFor(200);
  await expect.poll(async () => (await spoken(page)).length - before).toBeGreaterThan(1);
  const said = (await spoken(page)).slice(before);
  expect(said[0]).toBe('chime:attention');
  // The next thing heard is a card, not a line about starting.
  expect(said[1]).toMatch(/^(ace|king|queen|jack|ten|nine|eight|seven|six|five|four|three|two)\b/i);
});
