import { test, expect, type Page } from '@playwright/test';
import { readStats, withSettings } from './helpers';

/** #15 / #19: the yes/no Speed drill. */

async function openSpeed(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Speed', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Speed');
}

test('speed: an answer deals the next hand and the strip describes the answered one', async ({ page }) => {
  await withSettings(page, {});
  await openSpeed(page);
  await expect(page.getByTestId('speed-question')).toHaveText('Surrender?');
  await expect(page.getByTestId('speed-score')).toHaveText('0/0');
  await expect(page.getByTestId('speed-median')).toHaveText('–');

  for (let i = 1; i <= 4; i++) {
    const asked = await page.getByTestId('speed-hand').getAttribute('data-cell-id');
    await page.getByTestId(i % 2 ? 'speed-yes' : 'speed-no').click();
    await expect(page.getByTestId('speed-result')).toHaveAttribute('data-cell-id', asked!);
    // No Next: a new hand is already up (the draw avoids the cell just asked).
    await expect(page.getByTestId('speed-hand')).not.toHaveAttribute('data-cell-id', asked!);
    await expect(page.getByTestId('speed-score')).toHaveText(new RegExp(`^\\d+/${i}$`));
    await expect(page.getByTestId('speed-result-reason')).toContainText('Chart: ');
  }
  await expect(page.getByTestId('speed-median')).toHaveText(/^\d+\.\ds$/);

  // Recorded through the stats path: per-cell tallies and flashcard accuracy.
  const stats = (await readStats(page)) as {
    cellStats?: Record<string, { right: number; wrong: number }>;
    bySource?: Record<string, Record<string, { right?: number; wrong?: number }>>;
  };
  const tallied = Object.values(stats.cellStats ?? {}).reduce((n, c) => n + c.right + c.wrong, 0);
  expect(tallied).toBe(4);
  expect(stats.bySource?.flashcard).toBeTruthy();
});

test('speed: the score counts exactly the answers the strip marks right', async ({ page }) => {
  await withSettings(page, { drill: { speedMode: 'split', scopes: ['pairs'], flashCategory: 'pairs' } });
  await openSpeed(page);
  await expect(page.getByTestId('speed-question')).toHaveText('Split?');
  let right = 0;
  for (let i = 1; i <= 6; i++) {
    await page.getByTestId('speed-yes').click();
    const strip = page.getByTestId('result-strip');
    await expect(page.getByTestId('speed-score')).toHaveText(new RegExp(`/${i}$`));
    if ((await strip.getAttribute('data-tone')) === 'ok') right++;
    else await expect(page.getByTestId('speed-result')).toContainText('you said Yes, answer No');
  }
  await expect(page.getByTestId('speed-score')).toHaveText(`${right}/6`);
});

test('speed: Y / N and the arrow keys answer', async ({ page }) => {
  await withSettings(page, {});
  await openSpeed(page);
  await page.keyboard.press('y');
  await expect(page.getByTestId('speed-score')).toHaveText(/\/1$/);
  await page.keyboard.press('n');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('speed-score')).toHaveText(/\/4$/);
  await page.keyboard.press('1');
  await expect(page.getByTestId('speed-score')).toHaveText(/\/4$/);
});

test('speed: the mode is saved, and Deviation shows a true count', async ({ page }) => {
  await withSettings(page, {});
  await openSpeed(page);
  await expect(page.getByTestId('speed-tc')).toHaveCount(0);
  await page.getByTestId('speed-mode-deviation').click();
  await expect(page.getByTestId('speed-question')).toContainText('Deviation here?');
  await expect(page.getByTestId('speed-tc')).toHaveText(/^TC [+-]\d+$/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));
  expect(saved.drill.speedMode).toBe('deviation');
});

test('speed: Split with only Hard hands says why there is nothing to ask', async ({ page }) => {
  await withSettings(page, { drill: { speedMode: 'split', scopes: ['hard'], flashCategory: 'hard' } });
  await openSpeed(page);
  await expect(page.getByTestId('speed-nothing')).toContainText('Split? needs pairs');
  await expect(page.getByTestId('speed-yes')).toBeDisabled();
});

test('speed: a bounced double tap grades once', async ({ page }) => {
  await page.addInitScript(() => {
    window.__e2eAnswerBounceMs = 250;
  });
  await withSettings(page, {});
  await openSpeed(page);
  await page.waitForTimeout(300);
  await page.getByTestId('speed-yes').dblclick();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('speed-score')).toHaveText(/\/1$/);
});

test('speed: fits a 375px phone, big buttons at the bottom, opens at the top', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await withSettings(page, {});
  await openSpeed(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  for (const id of ['speed-yes', 'speed-no']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(64);
    expect(box.y + box.height).toBeGreaterThan(812 - 140);
  }
  for (const m of ['surrender', 'deviation', 'double', 'split']) {
    expect((await page.getByTestId(`speed-mode-${m}`).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});
