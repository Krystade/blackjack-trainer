import { test, expect } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

const BOTS = { bots: 2, playerHands: 1, playerPosition: 0, botMistakePct: 0 };

/** #48-51: the Losing shoe toggle in Settings, and its badge at the table. */
test('Losing shoe is off by default, and turning it on badges the table', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0 });
  await withProfile(page, { countCheckEvery: 0, seats: BOTS });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.getByTestId('losing-shoe-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.bot-seat')).toHaveCount(2);

  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const toggle = page.getByRole('checkbox', { name: 'Losing shoe' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByRole('button', { name: 'Back to Home' }).first().click();

  await page.getByRole('button', { name: 'Play', exact: true }).click();
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
