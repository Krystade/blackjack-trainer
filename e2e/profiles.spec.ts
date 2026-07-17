import { test, expect } from '@playwright/test';
import { shot, withSettings, withProfile, resolveInsurance } from './helpers';

test('profile create + switch: a new S17 profile can be created, saved, and activated from Home', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');
  await shot(page, '26-profiles-list-initial');

  await page.getByRole('button', { name: 'New Profile', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('New Profile');
  await shot(page, '27-profile-editor-new');

  const s17Row = page.locator('.settings-row', { hasText: 'Dealer soft 17' });
  await s17Row.getByRole('button', { name: 'S17', exact: true }).click();
  await expect(s17Row.getByRole('button', { name: 'S17', exact: true })).toHaveClass(/segmented-btn-active/);
  await shot(page, '28-profile-editor-new-s17-set');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  const newRow = page.locator('.profile-row', { hasText: 'New Profile' });
  await expect(newRow).toBeVisible();
  await shot(page, '29-profiles-list-after-save');

  await newRow.locator('.profile-row-select').click();
  await expect(newRow).toHaveClass(/profile-row-active/);
  await expect(newRow.locator('.profile-row-badge')).toHaveText('Active');

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
  await expect(page.locator('.home-profile-chip')).toHaveText('New Profile');
  await shot(page, '30-home-chip-active-profile');
});

test('S17 profile: the dealer stands on a two-card soft 17 (seed-hunt for an A,6 dealer hand)', async ({ page }) => {
  // A specific two-card up+hole combo (A,6 in either order) out of a 6-deck
  // shoe is a ~1.2% draw (engine/cards.ts's Shoe always builds 6 decks
  // regardless of the profile's rules.decks — see report concerns), so a
  // seed-hunt over 1..60 (as used elsewhere in this suite for a much-more-
  // common ten-value pair) is not reliable here: it can come up empty ~50%
  // of the time. Widened to 1..250 (offline-verified via a standalone replay
  // of the exact mulberry32+Fisher-Yates algorithm in cards.ts: the first
  // hit is deterministically at seed=244, dealer up=6/hole=A, no earlier
  // seed matches) so this test is reliable rather than merely probable.
  test.setTimeout(120_000);
  // feedbackMode 'test' (not the default 'training') so a deliberately
  // sub-optimal Stand doesn't pop the training wrong-play overlay — this
  // test only cares about the dealer's own hit/stand behavior.
  await withSettings(page, { feedbackMode: 'test' });
  await withProfile(page, { name: 'S17 Test Profile', rules: { s17: true } });

  let foundSeed: number | null = null;
  for (let seed = 1; seed <= 250 && foundSeed === null; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);

    const bar = page.locator('.action-bar[data-advice]');
    if (!(await bar.isVisible().catch(() => false))) continue; // player natural blackjack settled the round immediately

    await bar.getByRole('button', { name: 'Stand', exact: true }).click();

    const dealerCards = page.locator('.dealer-area .card[data-card]');
    const count = await dealerCards.count();
    if (count < 2) continue; // hole never got revealed on this path

    const [c0, c1] = await Promise.all([dealerCards.nth(0).getAttribute('data-card'), dealerCards.nth(1).getAttribute('data-card')]);
    if (!c0 || !c1) continue;
    const r0 = c0.slice(0, -1);
    const r1 = c1.slice(0, -1);
    const isSoftSeventeen = (r0 === 'A' && r1 === '6') || (r0 === '6' && r1 === 'A');
    if (isSoftSeventeen) {
      foundSeed = seed;
    }
  }

  expect(foundSeed, 'expected at least one of seeds 1..250 to deal the dealer an A,6 two-card hand').not.toBeNull();
  console.log(`[s17-seed-hunt] found dealer A,6 at seed=${foundSeed}`);

  // S17 is on: the dealer must stand on this soft 17 rather than hitting a third card.
  await expect(page.locator('.dealer-area .card[data-card]')).toHaveCount(2);
  await expect(page.locator('.message-strip .message-result').first()).toBeVisible();
  await shot(page, '31-table-dealer-soft17-stand');
});

test('migration: a v1-only settings blob (no profiles keys) migrates to "Default (6D H17)"', async ({ page }) => {
  // Deliberately use withSettings only — no withProfile call — so the
  // profiles/activeProfile keys are entirely absent on first load, matching
  // the true first-run migration path in store/profiles.ts.
  await withSettings(page, { betSpreadOn: true, bankrollStart: 250, countCheckEvery: 3, penetration: 0.6 });
  await page.goto('/?e2e=1');

  await expect(page.locator('.home-profile-chip')).toHaveText('Default (6D H17)');
  await shot(page, '32-home-chip-migrated-default');
});
