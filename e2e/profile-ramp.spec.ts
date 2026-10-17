import { test, expect, type Page } from '@playwright/test';
import { withProfile } from './helpers';

test.use({ viewport: { width: 375, height: 812 } });
const ramp = (page: Page) => page.getByTestId('profile-ramp');

async function openFromPlayGear(page: Page) {
  await page.goto('/?seed=2&e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Play settings' }).click();
  await page.getByRole('dialog', { name: 'Play settings' }).getByRole('button', { name: 'Edit profile and bet ramp', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit profile');
}

test('the ramp editor never shows the −99 sentinel, and negative counts use a real minus', async ({ page }) => {
  await withProfile(page, { betSpreadOn: true, spread: [{ minTc: -99, units: 1 }, { minTc: -1, units: 2 }, { minTc: 2, units: 4 }] });
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(ramp(page)).not.toContainText('99');
  await expect(ramp(page).locator('.spread-row').first()).toContainText('Any count');
  await expect(ramp(page).locator('.spread-row').nth(1).locator('.stepper-value').first()).toHaveText('−1');
});

test('Edit profile and bet ramp opens the active profile at its ramp, and Save returns to Play', async ({ page }) => {
  await withProfile(page, { betSpreadOn: true });
  page.on('dialog', (d) => { throw new Error(`unexpected dialog: ${d.message()}`); });
  await openFromPlayGear(page);
  await expect(ramp(page)).toBeInViewport();
  const bar = await page.locator('.settings-topbar').boundingBox();
  expect((await ramp(page).boundingBox())!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
  await ramp(page).locator('.spread-row').last().getByRole('button', { name: '+', exact: true }).last().click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
});

test('with the spread off, it lands on the Vary bets toggle (Review Focus 4)', async ({ page }) => {
  await withProfile(page, { betSpreadOn: false });
  await openFromPlayGear(page);
  await expect(page.getByTestId('profile-ramp-toggle')).toBeInViewport();
  await page.locator('.settings-topbar').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
});
