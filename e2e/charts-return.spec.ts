import { test, expect } from '@playwright/test';

/**
 * "When presented to review the charts there needs to be an easy return
 * button to go back to whatever I was doing before."
 *
 * Charts is reachable from the tab bar at any moment, and its back button was
 * hardcoded to "Back to Home" -- so checking one cell mid-session threw away
 * whatever drill or table you had open.
 */

test('returns to Drills when opened from Drills', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Charts', exact: true }).click();

  const back = page.locator('.charts-back-btn');
  await expect(back).toHaveText('Back to Drills');
  await back.click();
  await expect(page.locator('.drills-picker')).toBeVisible();
});

/**
 * The flow the operator screenshotted: a graded mistake offers "Show me the
 * table", which opens the chart as an OVERLAY over the live drill. Its back
 * button always worked, but it was labelled "Back to Home" -- a destination
 * it never went to.
 *
 * (Charts is not reachable from the Table at all: the tab bar is hidden in
 * the table's immersive mode, which is why this covers the overlay instead.)
 */
test('the chart opened over a mistake returns to the hand', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();

  // Answer until one is graded wrong, so the correction panel appears.
  for (let i = 0; i < 12; i += 1) {
    if (await page.getByRole('button', { name: 'Show me the table' }).isVisible().catch(() => false)) break;
    await page.locator('.action-bar button').first().click();
    await page.waitForTimeout(120);
    if (await page.getByRole('button', { name: 'Next', exact: true }).isVisible().catch(() => false)) {
      if (await page.getByRole('button', { name: 'Show me the table' }).isVisible().catch(() => false)) break;
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
  }

  const show = page.getByRole('button', { name: 'Show me the table' });
  await expect(show).toBeVisible();
  await show.click();

  await expect(page.locator('.study-chart-overlay')).toBeVisible();
  const back = page.locator('.study-chart-overlay .charts-back-btn');
  await expect(back).toHaveText('Back to the hand');

  await back.click();
  await expect(page.locator('.study-chart-overlay')).toHaveCount(0);
  // And it lands back on the SAME correction, not a fresh card.
  await expect(page.getByRole('button', { name: 'Show me the table' })).toBeVisible();
});

test('still says Home when that is genuinely where you came from', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.locator('.charts-back-btn')).toHaveText('Back to Home');
});

// A second tap on the Charts tab must not make "back" a loop onto itself.
test('re-entering Charts keeps the original return target', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await page.getByRole('button', { name: 'Charts', exact: true }).click();

  await expect(page.locator('.charts-back-btn')).toHaveText('Back to Drills');
});
