import { test, expect } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

const BOTS = { bots: 2, playerHands: 1, playerPosition: 0, botMistakePct: 0 };

/** #48-51: the Losing shoe toggle (the Play gear sheet since #33), and its badge at the table. */
test('Losing shoe is off by default, and turning it on badges the table', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0 });
  await withProfile(page, { countCheckEvery: 0, seats: BOTS });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.getByTestId('losing-shoe-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.bot-seat')).toHaveCount(2);

  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  const toggle = sheet.getByRole('checkbox', { name: 'Losing shoe' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  // Closing deals the new (rigged) shoe.
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(page.getByTestId('losing-shoe-badge')).toHaveText('Losing shoe');
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  // The rig is a solo script: the profile's bots sit this one out.
  await expect(page.locator('.bot-seat')).toHaveCount(0);
});

test('a stored losingShoe: false deals a fair table with no badge', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, losingShoe: false });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.getByTestId('losing-shoe-badge')).toHaveCount(0);
});

test('a multi-hand profile with the bet ramp deals one hand on the losing shoe', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withSettings(page, { countCheckEvery: 0, losingShoe: true });
  await withProfile(page, {
    countCheckEvery: 0,
    betSpreadOn: true,
    seats: { bots: 0, playerHands: 2, playerPosition: 0, botMistakePct: 0 },
  });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('losing-shoe-badge')).toBeVisible();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.player-hand')).toHaveCount(1);
  expect(errors).toEqual([]);
});
