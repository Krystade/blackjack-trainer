import { test, expect } from '@playwright/test';
import { statsTab, withProfile, withSettings, withStats } from './helpers';
import { worstContrast } from './contrast';

/**
 * H10 (wave H, story 1, C-R9): the " · not ended" tag on a Table sessions row
 * rendered at 0.75em of the row's 13.6px -- 10.2px. It is now the row's own
 * type-scale size, in the accent colour, at AA contrast on every theme.
 */

test.use({ viewport: { width: 375, height: 812 } });

for (const theme of ['midnight-felt', 'bone-ink', 'amoled-night', 'slate-copper'] as const) {
  test(`${theme}: the not-ended tag is at least 12px and AA`, async ({ page }) => {
    await withProfile(page);
    await withSettings(page, { theme });
    await withStats(page, {
      sessions: [
        { id: 'p1', date: new Date().toISOString(), rounds: 10, graded: 10, correct: 5, bankrollDelta: 1.5, provisional: true, profileId: 'e2e-profile', profileName: 'E2E Profile' },
      ],
    });
    await page.goto('/?e2e=1');
    await page.locator('.tab-bar').getByRole('button', { name: 'Stats', exact: true }).click();
    await statsTab(page, 'Progress');
    const tag = page.locator('.session-row .session-tag', { hasText: 'not ended' });
    await expect(tag).toHaveText(' · not ended');
    const px = await tag.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(px, 'tag font-size').toBeGreaterThanOrEqual(12);
    const ratio = await worstContrast(page, '.session-row .session-tag');
    expect(ratio, `${theme} tag contrast ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
}
