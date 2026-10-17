import { test, expect } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * s03/s04/s08: native form controls ignored the app's look on WebKit -- the
 * profile name in Times, grey native selects, glaring white checkboxes on the
 * dark themes. Every input/select uses the app font, the selects and the
 * checkboxes draw themselves from theme tokens.
 */

test('the profile name input uses the app font', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'New profile', exact: true }).click();
  const fonts = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    input: getComputedStyle(document.querySelector('.profile-text-input')!).fontFamily,
  }));
  expect(fonts.input).toBe(fonts.body);
});

test('checkboxes and selects draw themselves, in the theme', async ({ page }) => {
  await withSettings(page, { theme: 'amoled-night' });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const got = await page.evaluate(() => {
    const box = document.querySelector('input[type="checkbox"]') as HTMLElement;
    const sel = document.querySelector('select') as HTMLElement;
    const b = getComputedStyle(box);
    const s = getComputedStyle(sel);
    return {
      boxAppearance: b.appearance,
      boxBg: b.backgroundColor,
      selAppearance: s.appearance,
      selFont: s.fontFamily,
      selChevron: s.backgroundImage,
      body: getComputedStyle(document.body).fontFamily,
    };
  });
  expect(got.boxAppearance).toBe('none');
  // Not a white native box on a black theme.
  expect(got.boxBg).not.toBe('rgb(255, 255, 255)');
  expect(got.selAppearance).toBe('none');
  expect(got.selFont).toBe(got.body);
  expect(got.selChevron).toContain('gradient');
});

test('a checked checkbox still reads as checked', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const row = page.locator('.settings-toggle-row', { hasText: 'Double after split (DAS)' });
  const box = row.locator('input.settings-toggle');
  await expect(box).toBeChecked();
  const checked = await box.evaluate((el) => ({
    bg: getComputedStyle(el).backgroundColor,
    mark: getComputedStyle(el, '::before').opacity,
  }));
  await box.click();
  await expect(box).not.toBeChecked();
  const unchecked = await box.evaluate((el) => ({
    bg: getComputedStyle(el).backgroundColor,
    mark: getComputedStyle(el, '::before').opacity,
  }));
  expect(checked.bg).not.toBe(unchecked.bg);
  expect(checked.mark).toBe('1');
  expect(unchecked.mark).toBe('0');
  // Still the 44px target the settings toggles were sized to.
  const size = await box.boundingBox();
  expect(size!.width).toBeGreaterThanOrEqual(44);
});
