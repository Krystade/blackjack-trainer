import { test, expect } from '@playwright/test';
import { withProfile, withSettings, resolveInsurance, playRoundByAdvice } from './helpers';

/**
 * Two operator requests on the table screen.
 *
 * 1. The count peek. It was a toggle on request ("make the rc tc count reveal a
 *    toggle instead of having to hold it"); #40 (spec 2026-10-13) moved it to
 *    the bottom-left above the action bar and made it a HOLD again: show while
 *    pressed, hide on release, fixed width so revealing moves nothing.
 * 2. "If that's on purpose that's fine but should be a setting, most of the
 *    time I'm playing at a table with others so I want to emulate that"
 *    -- about a player blackjack ending the round without the dealer's hole
 *    card ever being revealed or counted.
 */

/**
 * A FIXED seed, and insurance resolved. Without both, the deal is random: some
 * rounds settle immediately (a natural) and some open an insurance prompt, so
 * "Stand" may never appear and the spec fails for a reason unrelated to what
 * it tests. An earlier version of this file passed in isolation and failed in
 * the full suite for exactly that reason.
 */
async function dealARound(page: import('@playwright/test').Page): Promise<void> {
  await withSettings(page, { countCheckEvery: 0 });
  await page.goto('/?seed=102&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
}

async function holdPeek(page: import('@playwright/test').Page): Promise<void> {
  const box = await page.locator('.tc-peek-btn').boundingBox();
  if (!box) throw new Error('peek button not laid out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

test('the count readout shows while held and hides on release', async ({ page }) => {
  await withProfile(page);
  await dealARound(page);

  const peek = page.locator('.tc-peek-btn');
  await expect(peek).toHaveText('Hold to peek');

  await holdPeek(page);
  await expect(peek).toContainText('RC');
  await expect(peek).toHaveAttribute('aria-pressed', 'true');
  // Still held, so still showing.
  await page.waitForTimeout(600);
  await expect(peek).toContainText('RC');

  await page.mouse.up();
  await expect(peek).toHaveText('Hold to peek');
  await expect(peek).toHaveAttribute('aria-pressed', 'false');
});

test('releasing off the button still ends the peek', async ({ page }) => {
  await withProfile(page);
  await dealARound(page);

  const peek = page.locator('.tc-peek-btn');
  await holdPeek(page);
  await expect(peek).toContainText('RC');
  // A thumb sliding off before lifting: the captured pointer still reports
  // the release to the button.
  await page.mouse.move(200, 300, { steps: 4 });
  await expect(peek).toContainText('RC');
  await page.mouse.up();
  await expect(peek).toHaveText('Hold to peek');
});

test('the keyboard holds the peek too', async ({ page }) => {
  await withProfile(page);
  await dealARound(page);

  const peek = page.locator('.tc-peek-btn');
  await peek.focus();
  await page.keyboard.down('Enter');
  await expect(peek).toContainText('RC');
  await page.keyboard.up('Enter');
  await expect(peek).toHaveText('Hold to peek');
});

test('the peek sits bottom-left above the action bar and revealing moves nothing', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await withProfile(page);
  await dealARound(page);

  const peek = page.locator('.tc-peek-btn');
  // Out of the topbar, into the thumb's corner.
  await expect(page.locator('.topbar .tc-peek-btn')).toHaveCount(0);
  const bar = await page.locator('.action-bar').boundingBox();
  const idle = await peek.boundingBox();
  if (!bar || !idle) throw new Error('not laid out');
  expect(idle.x).toBeLessThan(40);
  expect(idle.y + idle.height).toBeLessThanOrEqual(bar.y + 1);
  expect(bar.y - (idle.y + idle.height)).toBeLessThan(20);
  expect(idle.height).toBeGreaterThanOrEqual(44);

  const watched = ['.tc-peek-btn', '.dealer-area', '.hands-row', '.message-strip', '.action-bar', '.topbar'];
  const before = await Promise.all(watched.map((sel) => page.locator(sel).boundingBox()));
  await holdPeek(page);
  await expect(peek).toContainText('RC');
  const during = await Promise.all(watched.map((sel) => page.locator(sel).boundingBox()));
  await page.mouse.up();
  watched.forEach((sel, i) => expect(during[i], sel).toEqual(before[i]));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

/**
 * The dealer-reveal setting. Its ENGINE behaviour is pinned exhaustively in
 * src/engine/game.test.ts (including that it reveals without inventing draws);
 * this spec only proves the control exists, persists, and reaches the table.
 */
test('the dealer-reveal rule is a per-profile setting that persists', async ({ page }) => {
  // Deliberately NOT withProfile(): it seeds via addInitScript, which re-runs
  // on every navigation -- so the reload below would overwrite the very save
  // this spec exists to verify, and the test would fail for a reason that has
  // nothing to do with the feature.
  await page.goto('/?e2e=1');
  // The rule lives on the PROFILE, so it is edited in the profile editor --
  // reached from the Home profile chip, per e2e/profiles.spec.ts.
  await page.locator('.home-profile-chip').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit profile');

  const row = page.locator('.settings-toggle-row', { hasText: 'Dealer always shows the hole card' });
  await expect(row).toBeVisible();

  const box = row.locator('input[type="checkbox"]');
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(box).toBeChecked();

  // Saving is what persists it; reloading without saving would prove nothing.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload();
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(
    page.locator('.settings-toggle-row', { hasText: 'Dealer always shows the hole card' })
      .locator('input[type="checkbox"]'),
  ).toBeChecked();
});

/**
 * F9 (Wave A): the peek sat 48px above the count check's keypad and could be
 * held while it was open, and the peeked answer was graded correct.
 */
test('no peek while the count check is open', async ({ page }) => {
  await withProfile(page, { countCheckEvery: 1, countCheckAsk: 'running' });
  await withSettings(page, { countCheckEvery: 1 });
  await page.goto('/?seed=102&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  await playRoundByAdvice(page);
  await expect(page.locator('.tc-peek-btn')).toBeVisible();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.bottom-sheet', { hasText: 'Running count?' })).toBeVisible();
  await expect(page.locator('.tc-peek-btn')).toHaveCount(0);
});
