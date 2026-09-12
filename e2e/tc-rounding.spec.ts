import { test, expect } from '@playwright/test';
import { withProfile, withSettings, resolveInsurance, playRoundByAdvice } from './helpers';

/**
 * V5-4 (docs/BACKLOG.md): the true-count rounding convention comes from the
 * profile, not a hardcoded floor.
 *
 * The engine half is unit-tested. What only a browser can check is that the
 * profile field actually reaches the running game: `GameConfig.tcRounding` is
 * optional and defaults to floor, so a `useGame` that forgot to forward it
 * still compiles, still passes every engine test, and silently grades every
 * negative-count deviation under the wrong rule.
 */

test('the rounding control is on the profile editor, defaults to floor, and saves', async ({
  page,
}) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit Profile');

  const row = page.locator('.settings-row', { hasText: 'True count rounding' });
  await expect(row).toBeVisible();
  // Defaults to the app's historical behaviour, for a profile that predates
  // the field entirely.
  await expect(row.locator('.segmented-btn-active')).toHaveText('Floor');

  await row.getByRole('button', { name: 'Truncate', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  // Read the persisted blob directly rather than reloading -- Save writes
  // synchronously, and a reload would re-run any addInitScript seeding.
  const saved = await page.evaluate(() => {
    const raw = window.localStorage.getItem('bjtrainer.profiles.v1');
    return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
  });
  expect(saved[0]?.tcRounding).toBe('truncate');
});

test('the control is reachable with the bet spread OFF -- it is not a ramp setting', async ({
  page,
}) => {
  // Regression guard. It shipped inside the `betSpreadOn &&` ramp section
  // first, which hid it from exactly the people who most need it: the
  // convention governs index plays and insurance too, so a flat-betting
  // player drilling deviations was graded under a rule they could not see or
  // change.
  await withProfile(page, { betSpreadOn: false });
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit Profile');

  // The ramp section really is absent -- otherwise this proves nothing.
  await expect(page.locator('.settings-row', { hasText: 'True count rounding' })).toBeVisible();
  await expect(page.getByText('Ramp is sorted by TC when you save.')).toHaveCount(0);
});

test('the convention reaches the live table count, not just the profile', async ({ browser }) => {
  // Deal the same seeded shoe under both conventions and read the TC the TABLE
  // itself reports, off the peek button. Under the real rule truncate is
  // floor's reading or one above it, never below; a table that ignored the
  // profile would report identical readings throughout.
  const readCounts = async (tcRounding: 'floor' | 'truncate') => {
    const page = await browser.newPage();
    await withSettings(page, { countCheckEvery: 0, countPeek: true });
    await withProfile(page, { tcRounding });
    await page.goto('/?seed=102&e2e=1');
    await page.getByRole('button', { name: 'Play', exact: true }).click();

    const peek = page.locator('.tc-peek-btn');
    const seen: number[] = [];
    for (let round = 0; round < 12; round++) {
      const deal = page.getByRole('button', { name: 'Deal', exact: true });
      if (!(await deal.isVisible().catch(() => false))) break;
      await deal.click();
      await resolveInsurance(page, false);

      await peek.click();
      const text = await peek.innerText();
      const m = /TC ([+-]?\d+)/.exec(text);
      if (m) seen.push(Number(m[1]));
      await peek.click();

      await playRoundByAdvice(page);
    }
    await page.close();
    return seen;
  };

  const floor = await readCounts('floor');
  const truncate = await readCounts('truncate');

  expect(floor.length, 'read no true counts from the table').toBeGreaterThan(3);
  expect(truncate.length).toBe(floor.length);
  for (let i = 0; i < floor.length; i++) {
    const delta = truncate[i]! - floor[i]!;
    expect(delta, `round ${i}: floor ${floor[i]}, truncate ${truncate[i]}`).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThanOrEqual(1);
  }
  expect(truncate, 'identical readings: the profile never reached the table').not.toEqual(floor);
});
