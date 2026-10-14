import { test, expect } from '@playwright/test';
import { answerAndReadStrip } from './helpers';

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
 * The flow the operator screenshotted: a graded mistake offers "Show on
 * chart", which opens the chart as an OVERLAY over the live drill.
 *
 * #2: its Back is a pill pinned bottom-centre, named for where it goes, and
 * still on screen -- and on top -- however far the overlay has scrolled. The
 * ringed cell is often in PAIRS, a long way below the header where Back used
 * to live.
 *
 * (Charts is not reachable from the Table at all: the tab bar is hidden in
 * the table's immersive mode, which is why this covers the overlay instead.)
 */
test.describe('the study overlay', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('Back to hand is a bottom-centre pill that stays reachable while scrolling, and returns to the hand', async ({
    page,
  }) => {
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Flashcards', exact: true }).click();

    const buttons = page.locator('.action-bar button.action-btn:not([disabled])');
    let tone: 'ok' | 'miss' = 'ok';
    for (let i = 0; i < 12 && tone !== 'miss'; i += 1) tone = await answerAndReadStrip(page, buttons.first());
    expect(tone, 'no wrong answer in 12 cards').toBe('miss');
    const strip = page.locator('[data-testid="result-strip"][data-tone="miss"]');
    const answered = await strip.getByTestId('hand-result-hand').innerText();

    await strip.getByRole('button', { name: 'Show on chart', exact: true }).click();
    const overlay = page.locator('.study-chart-overlay');
    await expect(overlay).toBeVisible();

    // One Back, and it is the pill: the header no longer carries a second one.
    const back = overlay.getByRole('button', { name: 'Back to hand', exact: true });
    await expect(back).toHaveCount(1);
    await expect(overlay.locator('.charts-back-btn')).toHaveCount(0);

    const viewport = page.viewportSize()!;
    const pillIsReachable = async (where: string) => {
      const box = (await back.boundingBox())!;
      expect(box.height, `${where}: pill is a full tap target`).toBeGreaterThanOrEqual(44);
      expect(Math.abs(box.x + box.width / 2 - viewport.width / 2), `${where}: centred`).toBeLessThan(2);
      expect(box.y + box.height, `${where}: above the bottom edge`).toBeLessThanOrEqual(viewport.height);
      expect(viewport.height - (box.y + box.height), `${where}: pinned near the bottom`).toBeLessThan(40);
      // On top of the grid, not under it: the pill is what a tap there hits.
      const onTop = await page.evaluate(
        ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.floating-back-pill'),
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      );
      expect(onTop, `${where}: nothing covers the pill`).toBe(true);
    };

    await pillIsReachable('on open');
    await overlay.evaluate((el) => {
      const pairs = el.querySelector('[data-section="PAIRS"]')!;
      el.scrollTop += pairs.getBoundingClientRect().top - 60;
    });
    await expect(overlay.locator('[data-section="PAIRS"] .chart-section-title')).toBeInViewport();
    await pillIsReachable('scrolled to PAIRS');
    await overlay.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await pillIsReachable('scrolled to the end');
    // The last line on the page can be scrolled clear of the pill.
    const noteBottom = (await overlay.locator('[data-section="PAIRS"] .chart-section-note').boundingBox())!;
    const pillTop = (await back.boundingBox())!.y;
    expect(noteBottom.y + noteBottom.height).toBeLessThanOrEqual(pillTop);

    await back.click();
    await expect(overlay).toHaveCount(0);
    // And it lands back on the SAME correction, not a fresh card.
    await expect(strip.getByTestId('hand-result-hand')).toHaveText(answered);
  });
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
