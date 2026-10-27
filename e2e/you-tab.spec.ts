import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * Wave W: the You tab. Jack asked to see his achievements from the tab bar;
 * the Stats tab became You, with Progress (streaks, the calendar, the
 * achievements) and Stats behind a switch at the top of both.
 */

const tabBar = (page: Page) => page.locator('.tab-bar');
const you = (page: Page) => tabBar(page).getByRole('button', { name: 'You', exact: true });
const current = (page: Page) => tabBar(page).locator('[aria-current="page"]');

test('You opens on Progress with the achievements, and switches to Stats', async ({ page }) => {
  await page.goto('/?e2e=1');
  // Six tabs, Stats renamed: no seventh.
  await expect(tabBar(page).getByRole('button')).toHaveText(['◆Home', '♠Play', '◎Drills', '▦Charts', '★You', '♣Casino']);
  await you(page).click();
  await expect(page.getByTestId('progress-screen')).toBeVisible();
  await expect(page.getByTestId('achievements-count')).toHaveText(/^\d+\/\d+$/);
  await expect(current(page)).toHaveText('★You');
  await expect(page.getByTestId('you-seg-progress')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('you-seg-stats')).toHaveAttribute('aria-selected', 'false');

  await page.getByTestId('you-seg-stats').click();
  await expect(page.locator('.stats-screen')).toBeVisible();
  await expect(page.getByTestId('progress-screen')).toHaveCount(0);
  await expect(current(page)).toHaveText('★You');
  // Every Stats tab is still there; the third is "Over time" beside the switch's Progress.
  await expect(page.locator('.stats-tabs [role="tab"]')).toHaveText(['Play', 'Drills', 'Over time']);

  await page.getByTestId('you-seg-progress').click();
  await expect(page.getByTestId('progress-screen')).toBeVisible();
});

test('the tab opens whichever half was open last, across a reload', async ({ page }) => {
  await page.goto('/?e2e=1');
  await you(page).click();
  await page.getByTestId('you-seg-stats').click();
  await expect(page.locator('.stats-screen')).toBeVisible();
  await tabBar(page).getByRole('button', { name: 'Home', exact: true }).click();
  await you(page).click();
  await expect(page.locator('.stats-screen')).toBeVisible();

  await page.reload();
  await you(page).click();
  await expect(page.locator('.stats-screen')).toBeVisible();

  await page.getByTestId('you-seg-progress').click();
  await tabBar(page).getByRole('button', { name: 'Casino', exact: true }).click();
  await you(page).click();
  await expect(page.getByTestId('progress-screen')).toBeVisible();
});

test("Home's ways in still land where they did, with You lit", async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByTestId('streak-card').click();
  await expect(page.getByTestId('progress-screen')).toBeVisible();
  await expect(current(page)).toHaveText('★You');

  await tabBar(page).getByRole('button', { name: 'Home', exact: true }).click();
  await page.locator('.home-stats-link').click();
  await expect(page.locator('.stats-screen')).toBeVisible();
  await expect(page.getByTestId('you-seg-stats')).toHaveAttribute('aria-selected', 'true');
  await expect(current(page)).toHaveText('★You');

  // A visit to Charts from Stats still offers the way back to Stats.
  await tabBar(page).getByRole('button', { name: 'Charts', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Stats' }).click();
  await expect(page.locator('.stats-screen')).toBeVisible();
});

for (const size of [{ width: 375, height: 812 }, { width: 320, height: 568 }]) {
  test(`${size.width}: the switch is whole, clear of the mute disc, and stays put on scroll`, async ({ page }) => {
    await page.setViewportSize(size);
    // The disc shows only with audio on.
    await withSettings(page, { audio: { enabled: true } });
    await page.goto('/?e2e=1');
    await you(page).click();
    await expect(page.getByTestId('progress-screen')).toBeVisible();
    for (const id of ['you-seg-progress', 'you-seg-stats']) {
      const over = await page.getByTestId(id).evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(over, `${id} is clipped`).toBeLessThanOrEqual(0);
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(42);
    }
    const seg = (await page.locator('.you-seg').boundingBox())!;
    const disc = (await page.locator('[data-testid~="mute-btn"]').boundingBox())!;
    expect(seg.x + seg.width, 'the switch runs under the mute disc').toBeLessThanOrEqual(disc.x);
    await page.mouse.wheel(0, 900);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    const after = (await page.locator('.you-seg').boundingBox())!;
    expect(Math.abs(after.y - seg.y), 'the bar scrolled away').toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
