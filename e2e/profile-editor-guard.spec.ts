import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * F13 / s08: THE PROFILE EDITOR LOST UNSAVED EDITS ON A TAB TAP.
 *
 * Save sat about 2,450px down the page, and tapping any tab threw the draft
 * away without a word. Now a Save bar pins to the bottom as soon as something
 * changed, leaving asks first, and a new profile is the active one on Save.
 */

async function openEditor(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit profile');
}

const nameInput = (page: Page) => page.locator('.profile-text-input').first();

test('the Save bar is pinned on screen only once something changed', async ({ page }) => {
  await openEditor(page);
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save, 'an untouched form should not nag').not.toBeInViewport();

  await nameInput(page).fill('Edited name');
  await expect(save).toBeInViewport();
  await expect(page.locator('.profile-edit-actions')).toContainText('Unsaved changes');
  // And not under the tab bar.
  const bar = await page.locator('.tab-bar').boundingBox();
  const btn = await save.boundingBox();
  expect(btn!.y + btn!.height).toBeLessThanOrEqual(bar!.y + 1);
});

test('a tab tap with unsaved edits asks first; dismissing keeps the draft', async ({ page }) => {
  await openEditor(page);
  await nameInput(page).fill('Keep me');

  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.locator('.tab-bar').getByRole('button', { name: 'Stats' }).click();
  expect(asked).toMatch(/unsaved/i);
  await expect(page.locator('.settings-heading')).toHaveText('Edit profile');
  await expect(nameInput(page)).toHaveValue('Keep me');

  page.once('dialog', (d) => void d.accept());
  await page.locator('.tab-bar').getByRole('button', { name: 'Stats' }).click();
  await expect(page.locator('.settings-heading')).toHaveCount(0);
  const names = await page.evaluate(() =>
    (JSON.parse(localStorage.getItem('bjtrainer.profiles.v1') ?? '[]') as { name: string }[]).map(
      (p) => p.name,
    ),
  );
  expect(names).not.toContain('Keep me');
});

test('an untouched form leaves on a tab tap without asking', async ({ page }) => {
  await openEditor(page);
  let asked = false;
  page.on('dialog', (d) => {
    asked = true;
    void d.dismiss();
  });
  await page.locator('.tab-bar').getByRole('button', { name: 'Stats' }).click();
  await expect(page.locator('.settings-heading')).toHaveCount(0);
  expect(asked).toBe(false);
});

test('a new profile is the active one after Save', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'New profile', exact: true }).click();
  await nameInput(page).fill('Local 2D');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const row = page.locator('.profile-row', { hasText: 'Local 2D' });
  await expect(row).toHaveClass(/profile-row-active/);
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-profile-chip')).toContainText('Local 2D');
});
