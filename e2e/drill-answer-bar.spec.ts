import { test, expect } from '@playwright/test';
import { withProfile, withSettings } from './helpers';

/**
 * Wave A (s03 high): with Options open, a miss's correction pushed the answer
 * bar for the next card below the fold on a 375x812 phone.
 */
test.use({ viewport: { width: 375, height: 812 } });

test('flashcards with Options open: after misses the answer bar stays on screen', async ({ page }) => {
  await withProfile(page);
  await withSettings(page, { drill: { withCount: true, flashCategory: 'hard', scopes: ['hard'] } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.locator('details.drill-options > summary').click();
  await expect(page.locator('details.drill-options')).toHaveAttribute('open', '');

  let misses = 0;
  for (let i = 0; i < 40 && misses < 3; i++) {
    const bar = page.locator('.drill-screen > .action-bar');
    await expect(bar).toBeVisible();
    // Answer with whichever of Hit/Stand is enabled first; misses come quickly.
    const btn = page.locator('.action-bar button.action-btn:enabled', { hasText: i % 2 ? 'Hit' : 'Stand' });
    await btn.click();
    const tone = await page.locator('[data-testid="result-strip"]').getAttribute('data-tone');
    if (tone === 'miss') {
      misses++;
      const box = await page.locator('.drill-screen > .action-bar').boundingBox();
      expect(box, 'answer bar missing').not.toBeNull();
      expect(box!.y + box!.height, 'answer bar is below the fold').toBeLessThanOrEqual(812 + 0.5);
      expect(box!.y).toBeGreaterThanOrEqual(0);
    }
  }
  expect(misses, 'never produced a miss; the check above never ran').toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/wave-a-answer-bar.png' });
});
