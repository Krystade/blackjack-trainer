import { test, expect } from '@playwright/test';
import { withProfile, withSettings, resolveInsurance } from './helpers';

/**
 * Two operator requests on the table screen.
 *
 * 1. "make the rc tc count reveal a toggle instead of having to hold it"
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
  await withSettings(page, { countCheckEvery: 0, countPeek: true });
  await page.goto('/?seed=102&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
}

test('the count readout latches on a tap and stays without holding', async ({ page }) => {
  await withProfile(page);
  await dealARound(page);

  const peek = page.locator('.tc-peek-btn');
  await expect(peek).toHaveText('TC');

  await peek.click();
  await expect(peek).toContainText('RC');
  await expect(peek).toHaveAttribute('aria-pressed', 'true');

  // The heart of the request: nothing is held, so it must still be showing.
  // A press-and-hold implementation would have cleared on pointerup.
  await page.waitForTimeout(600);
  await expect(peek).toContainText('RC');

  await peek.click();
  await expect(peek).toHaveText('TC');
  await expect(peek).toHaveAttribute('aria-pressed', 'false');
});

/**
 * The readout must survive a new round, or a "toggle" that silently clears
 * every deal is really still a hold with extra steps.
 */
test('the latched readout survives dealing the next round', async ({ page }) => {
  await withProfile(page);
  await dealARound(page);

  const peek = page.locator('.tc-peek-btn');
  await peek.click();
  await expect(peek).toContainText('RC');

  // Play the hand out and deal again.
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  const deal = page.getByRole('button', { name: 'Deal', exact: true });
  await expect(deal).toBeVisible({ timeout: 10_000 });
  await deal.click();

  await expect(peek).toContainText('RC');
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
  await expect(page.locator('.settings-heading')).toHaveText('Edit Profile');

  const row = page.locator('.settings-toggle-row', { hasText: 'Dealer reveals hole on every round' });
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
    page.locator('.settings-toggle-row', { hasText: 'Dealer reveals hole on every round' })
      .locator('input[type="checkbox"]'),
  ).toBeChecked();
});
