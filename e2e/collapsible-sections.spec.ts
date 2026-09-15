import { test, expect, type Page } from '@playwright/test';

/**
 * The sections on Settings, Stats and the Profile editor collapse, because at
 * 375x812 (an iPhone 13 mini) those screens measured 4085px, 2470px and 2084px
 * — five, three and two and a half full screens.
 *
 * EVERY TEST HERE LOADS WITHOUT `?e2e=1`, on purpose. That flag forces every
 * section open so the ~300 feature specs can go on clicking the controls they
 * are actually about (see ui/components/CollapsibleSection.tsx). The cost of
 * that shortcut is that no other spec can catch a control stranded behind a
 * closed section. This file is the one that pays it back, so it must see the
 * screen the way a real visitor does.
 */

const MINI = { width: 375, height: 812 };

test.use({ viewport: MINI });

async function pageHeight(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollHeight);
}

async function openSettings(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.locator('.settings-heading')).toBeVisible();
}

test('Settings opens as a short list of headings, not five screens', async ({ page }) => {
  await openSettings(page);

  // The whole point of the change. 812 * 2 is a generous ceiling: it was 4085.
  const h = await pageHeight(page);
  expect(h).toBeLessThan(MINI.height * 2);

  // And it is short because content is COLLAPSED, not because content is gone.
  const sections = page.locator('details.settings-section');
  expect(await sections.count()).toBeGreaterThan(5);
});

test('a collapsed section genuinely hides its content, and the summary reveals it', async ({
  page,
}) => {
  await openSettings(page);

  const theme = page.locator('details.settings-section', { hasText: 'Theme' }).first();
  const body = theme.locator('.settings-section-body');

  // Closed: not merely short — not visible. (A CSS `display` that overrode the
  // UA's hiding would leave this visible while still looking collapsed.)
  await expect(body).toBeHidden();

  await theme.locator('summary').click();
  await expect(body).toBeVisible();
  await expect(page.getByText('Midnight Felt')).toBeVisible();

  // ...and closes again, so the control is a toggle rather than a one-way door.
  await theme.locator('summary').click();
  await expect(body).toBeHidden();
});

test('opening a section makes the page taller — the height win is real, not clipping', async ({
  page,
}) => {
  await openSettings(page);
  const before = await pageHeight(page);

  for (const s of await page.locator('details.settings-section summary').all()) {
    await s.click();
  }
  const after = await pageHeight(page);

  // If the collapsed page were short because an ancestor clipped it, expanding
  // everything would not move scrollHeight.
  expect(after).toBeGreaterThan(before * 2);
});

test('Stats and the Profile editor collapse too', async ({ page }) => {
  await page.goto('/');
  await page.locator('.home-stats-link').click();
  expect(await pageHeight(page)).toBeLessThan(MINI.height * 2);
  expect(await page.locator('details.stats-section').count()).toBeGreaterThan(5);

  await page.goto('/');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  expect(await pageHeight(page)).toBeLessThan(MINI.height * 2);
});

test('the e2e flag forces sections open, which is what the other specs rely on', async ({
  page,
}) => {
  // Guards the shortcut itself: if this stops working, ~300 specs start failing
  // for a reason that has nothing to do with what they test.
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  const theme = page.locator('details.settings-section', { hasText: 'Theme' }).first();
  await expect(theme.locator('.settings-section-body')).toBeVisible();
});
