import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * B2 (#9): the Custom drill editor -- paint tiers on the chart grid by drag
 * or tap, the session mix, Favour missed, Auto, Clear and Start. Mounted on
 * its own by e2e/harness/custom-drill-editor.html, with settings and stats
 * going through the real store.
 */

const HARNESS = '/e2e/harness/custom-drill-editor.html?e2e=1';

async function storedCustom(page: Page): Promise<Record<string, any> | undefined> {
  return page.evaluate(
    () => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill?.custom,
  );
}

function cell(page: Page, id: string) {
  return page.locator(`[data-cell="${id}"]`);
}

async function centre(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = (await cell(page, id).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(HARNESS);
  await expect(cell(page, 'hard-16-v-10')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await withSettings(page, {});
});

test('a mouse drag paints every cell it crosses, even when the moves skip cells', async ({ page }) => {
  await open(page);
  await page.getByRole('radio', { name: 'Focus' }).click();
  await cell(page, 'hard-14-v-2').scrollIntoViewIfNeeded();

  const from = await centre(page, 'hard-14-v-2');
  const to = await centre(page, 'hard-14-v-7');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // ONE move event from 2 to 7: the cells between are only painted if the
  // stroke fills the gap the pointer jumped.
  await page.mouse.move(to.x, to.y, { steps: 1 });
  await page.mouse.up();

  for (const up of ['2', '3', '4', '5', '6', '7']) {
    await expect(cell(page, `hard-14-v-${up}`)).toHaveAttribute('data-tier', 'focus');
    await expect(cell(page, `hard-14-v-${up}`)).toHaveAttribute('data-painted', 'true');
  }
  await expect(cell(page, 'hard-14-v-8')).toHaveAttribute('data-tier', 'regular');
  await expect(cell(page, 'hard-13-v-2')).toHaveAttribute('data-tier', 'regular');

  const saved = await storedCustom(page);
  expect(saved?.tiers['hard-14-v-5']).toBe('focus');
  expect(saved?.painted['hard-14-v-5']).toBe(true);
  expect(saved?.tiers['hard-14-v-8']).toBe('regular');
});

test('a touch drag paints, and the page still scrolls from outside the cells', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await withSettings(page, {});
  await page.goto(HARNESS);
  await page.getByRole('radio', { name: 'Rare' }).click();
  await cell(page, 'soft-18-v-2').scrollIntoViewIfNeeded();

  const cdp = await context.newCDPSession(page);
  const a = await centre(page, 'soft-18-v-2');
  const b = await centre(page, 'soft-16-v-2');
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  await touch('touchStart', a);
  for (let i = 1; i <= 8; i++) await touch('touchMove', { x: a.x, y: a.y + ((b.y - a.y) * i) / 8 });
  await touch('touchEnd');

  // A vertical drag on a cell is a stroke, not a scroll.
  for (const row of ['18', '17', '16']) {
    await expect(cell(page, `soft-${row}-v-2`)).toHaveAttribute('data-tier', 'rare');
  }
  expect((await storedCustom(page))?.tiers['soft-17-v-2']).toBe('rare');

  // Only the cells claim the gesture; the labels and the page around them
  // keep the browser's own panning.
  expect(await cell(page, 'soft-18-v-2').evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
  expect(await page.locator('[data-row="soft-18"] .cpg-label').evaluate((el) => getComputedStyle(el).touchAction)).toBe('auto');
  expect(await page.locator('.cpg-grid').first().evaluate((el) => getComputedStyle(el).touchAction)).toBe('auto');
  await context.close();
});

test('a tap paints one cell; a row label paints the row; Off removes the tier', async ({ page }) => {
  await open(page);
  await page.getByRole('radio', { name: 'Off' }).click();
  await page.locator('[data-row="pair-8"] .cpg-label').click();
  for (const up of ['2', '9', 'A']) await expect(cell(page, `pair-8-v-${up}`)).toHaveAttribute('data-tier', 'off');
  await expect(cell(page, 'pair-9-v-2')).toHaveAttribute('data-tier', 'regular');

  await page.getByRole('radio', { name: 'Focus' }).click();
  await cell(page, 'pair-8-v-A').click();
  await expect(cell(page, 'pair-8-v-A')).toHaveAttribute('data-tier', 'focus');
  await expect(cell(page, 'pair-8-v-10')).toHaveAttribute('data-tier', 'off');

  const saved = await storedCustom(page);
  expect(saved?.tiers['pair-8-v-A']).toBe('focus');
  expect('pair-8-v-10' in saved!.tiers).toBe(false);
  expect(saved?.painted['pair-8-v-10']).toBe(true);
});

test('the mix sliders keep summing to 100 and Favour missed persists', async ({ page }) => {
  await open(page);
  await expect(page.getByLabel('Focus share')).toHaveValue('60');
  await expect(page.getByLabel('Regular share')).toHaveValue('30');
  await expect(page.getByLabel('Rare share')).toHaveValue('10');

  await page.getByLabel('Focus share').fill('80');
  await expect(page.getByLabel('Regular share')).toHaveValue('15');
  await expect(page.getByLabel('Rare share')).toHaveValue('5');
  expect((await storedCustom(page))?.mix).toEqual({ focus: 80, regular: 15, rare: 5 });

  const toggle = page.getByRole('button', { name: /Favour missed cells/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect((await storedCustom(page))?.favourMissed).toBe(true);

  await page.evaluate(() => window.localStorage.setItem('e2e.noReseed', '1'));
  await page.reload();
  await expect(page.getByLabel('Focus share')).toHaveValue('80');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('Auto sets tiers from accuracy and leaves hand-painted cells alone', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'bjtrainer.stats.v1',
      JSON.stringify({
        version: 1,
        cellStats: {
          'hard-16-v-10': { right: 1, wrong: 3, lastAt: '' }, // 25% -> Focus
          'hard-12-v-2': { right: 17, wrong: 3, lastAt: '' }, // 85% -> Regular
          'soft-18-v-9': { right: 20, wrong: 0, lastAt: '' }, // 100% -> Rare
          'pair-9-v-7': { right: 0, wrong: 5, lastAt: '' }, // 0%, but painted below
        },
      }),
    );
  });
  await open(page);
  await page.getByRole('radio', { name: 'Rare' }).click();
  await cell(page, 'pair-9-v-7').click();

  await page.getByRole('button', { name: 'Auto', exact: true }).click();
  await expect(cell(page, 'hard-16-v-10')).toHaveAttribute('data-tier', 'focus');
  await expect(cell(page, 'hard-12-v-2')).toHaveAttribute('data-tier', 'regular');
  await expect(cell(page, 'soft-18-v-9')).toHaveAttribute('data-tier', 'rare');
  await expect(cell(page, 'pair-9-v-7')).toHaveAttribute('data-tier', 'rare');
  await expect(cell(page, 'hard-5-v-2')).toHaveAttribute('data-tier', 'regular');
  // Auto is not painting: the cells it set carry no hand mark.
  await expect(cell(page, 'hard-16-v-10')).not.toHaveAttribute('data-painted', 'true');
  expect((await storedCustom(page))?.tiers['hard-16-v-10']).toBe('focus');
});

test('Clear turns every cell Off and Start waits for a painted cell', async ({ page }) => {
  await open(page);
  const flash = page.getByRole('button', { name: 'Flashcards', exact: true });
  await expect(flash).toBeEnabled();

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('.cpg-cell[data-tier="off"]')).toHaveCount(330);
  await expect(flash).toBeDisabled();
  await expect(page.getByTestId('cde-counts')).toContainText('Every cell is Off');

  await page.getByRole('radio', { name: 'Focus' }).click();
  await page.getByRole('button', { name: 'Paint hard totals against dealer 10' }).click();
  await expect(page.locator('.cpg-cell[data-tier="focus"]')).toHaveCount(15);
  await expect(page.getByTestId('cde-counts')).toHaveText('15 Focus · 0 Regular · 0 Rare · 315 Off');

  await page.getByRole('button', { name: 'Mastery', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  expect(
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return [w.__customStarts, w.__customBacks];
    }),
  ).toEqual([['mastery'], 1]);
});

test('the grid fits a 375px phone with no sideways scroll', async ({ page }) => {
  await open(page);
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    grid: document.querySelector('.cpg-grid')!.getBoundingClientRect().width,
    lastCell: document.querySelector('[data-cell="hard-19-v-A"]')!.getBoundingClientRect().right,
  }));
  expect(widths.scroll).toBe(widths.client);
  expect(widths.grid).toBeLessThanOrEqual(343);
  expect(widths.lastCell).toBeLessThanOrEqual(375 - 16);
});
