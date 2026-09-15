import { test, expect, type Page } from '@playwright/test';
import { withProfile } from './helpers';

/**
 * RV3. The engine side is covered exhaustively by
 * src/engine/surrenderIndices.test.ts; what unit tests cannot see is the
 * WIRING — the profile flag reaching the surfaces that advise and grade. Every
 * one of those surfaces took `activeProfile.rules` before this feature and
 * still compiles if it keeps doing so, silently ignoring the toggle. So every
 * assertion here runs the same screen with the flag on and off and demands the
 * two differ.
 *
 * Note on what is deliberately NOT asserted: round-tripping the toggle through
 * a reload. `withProfile` installs its blob via addInitScript, which re-runs on
 * every navigation — so a reload restores the SEEDED profile, and such a test
 * would be measuring the helper rather than the app.
 */

const SURRENDER_ROW = '.settings-toggle-row';

/** The chip opens the profiles LIST; the editor is behind that row's Edit. */
async function openProfileEditor(page: Page) {
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit' }).first().click();
}

async function openDeviationQuiz(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills' }).first().click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
}

/** Every index the quiz offers, read off the <select> the drill is driven by. */
function indexOptions(page: Page) {
  return page.locator('.quiz-index-select option');
}

test('the toggle reflects the profile it was given', async ({ page }) => {
  await withProfile(page, { surrenderIndices: false });
  await openProfileEditor(page);
  await expect(
    page.locator(SURRENDER_ROW, { hasText: 'Surrender indices' }).locator('input'),
  ).not.toBeChecked();

  await withProfile(page, { surrenderIndices: true });
  await openProfileEditor(page);
  await expect(
    page.locator(SURRENDER_ROW, { hasText: 'Surrender indices' }).locator('input'),
  ).toBeChecked();
});

test('late surrender off disables the control instead of offering a dead setting', async ({ page }) => {
  await withProfile(page, { rules: { ls: false }, surrenderIndices: true });
  await openProfileEditor(page);

  const row = page.locator(SURRENDER_ROW, { hasText: 'Surrender indices' });
  await expect(row.locator('input')).toBeDisabled();
  // ...and it reads as off, rather than a checked box that does nothing.
  await expect(row.locator('input')).not.toBeChecked();
  await expect(page.getByText(/Needs late surrender/)).toBeVisible();
});

test('the quiz index list grows by the Fab 4 only when the flag is on', async ({ page }) => {
  await withProfile(page, { surrenderIndices: false });
  await openDeviationQuiz(page);
  const off = await indexOptions(page).allTextContents();
  expect(off.filter((t) => /surrender at TC/.test(t))).toEqual([]);

  await withProfile(page, { surrenderIndices: true });
  await openDeviationQuiz(page);
  const on = await indexOptions(page).allTextContents();
  const surrenders = on.filter((t) => /surrender at TC/.test(t));

  expect(surrenders).toHaveLength(6);
  expect(surrenders.join(' | ')).toContain('16 v 8: surrender at TC ≥ +4');
  expect(surrenders.join(' | ')).toContain('15 v 10: surrender at TC ≥ 0');
  // The eighteen it already had are all still there.
  expect(on.length).toBe(off.length + 6);
});

test('S17 carries four surrender indices, not the six H17 does', async ({ page }) => {
  await withProfile(page, { surrenderIndices: true, rules: { s17: true } });
  await openDeviationQuiz(page);
  const texts = (await indexOptions(page).allTextContents()).join(' | ');

  // The two cells with no S17 source must be ABSENT, not carried over from H17.
  expect(texts).not.toContain('16 v 8: surrender');
  expect(texts).not.toContain('16 v 9: surrender');
  // And the cell that genuinely moves between rulesets shows its S17 value.
  expect(texts).toContain('15 v A: surrender at TC ≥ +1');
  expect(texts).not.toContain('15 v A: surrender at TC ≥ −1');
});
