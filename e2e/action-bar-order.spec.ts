import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance } from './helpers';

/**
 * Owner 2026-11-07: "hit and stand on top is good but then I want it to be
 * surrender double split on the bottom row so double is easy to hit in the
 * middle and split is closer to my hand than surrender."
 *
 * Read from the drawn geometry, not the markup: Hit | Stand on the top row,
 * Surrender | Double | Split below (Split under a right thumb), mirrored to
 * Split | Double | Surrender by the Handedness setting. Play and Flashcards
 * both draw the two rows on a tall phone; a short one keeps one row in the
 * same order.
 */

const SOLO = { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 };
const BOTTOM = { right: ['Surrender', 'Double', 'Split'], left: ['Split', 'Double', 'Surrender'] } as const;

type Box = { label: string; x: number; y: number; w: number; h: number };

async function bar(page: Page): Promise<Box[]> {
  return page.locator('.action-bar .action-btn').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { label: e.textContent ?? '', x: r.x, y: r.y, w: r.width, h: r.height };
    }));
}

/** Deal seeds until every one of the five answers is live (a splittable pair). */
async function dealAllFive(page: Page): Promise<void> {
  for (let seed = 1; seed < 200; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);
    if (!(await page.locator('.action-bar[data-advice]').isVisible().catch(() => false))) continue;
    if ((await page.locator('.action-bar .action-btn:not([disabled])').count()) === 5) return;
  }
  throw new Error('no seed dealt a hand with all five answers live');
}

/** Two rows: Hit | Stand above, the hand's bottom three in a row below, left to right. */
function expectTwoRows(boxes: Box[], hand: 'right' | 'left') {
  const by = (l: string) => boxes.find((b) => b.label === l)!;
  const [hit, stand] = [by('Hit'), by('Stand')];
  expect(Math.abs(hit.y - stand.y)).toBeLessThan(1);
  expect(hit.x).toBeLessThan(stand.x);
  const bottom = boxes.filter((b) => b.label !== 'Hit' && b.label !== 'Stand');
  for (const b of bottom) {
    expect(b.y, `${b.label} is not below the Hit | Stand row`).toBeGreaterThanOrEqual(hit.y + hit.h - 1);
    expect(Math.abs(b.y - bottom[0].y)).toBeLessThan(1);
  }
  expect([...bottom].sort((a, b) => a.x - b.x).map((b) => b.label)).toEqual([...BOTTOM[hand]]);
  // Double centred under the gap between Hit and Stand.
  const double = by('Double');
  const mid = (hit.x + stand.x + stand.w) / 2;
  expect(Math.abs(double.x + double.w / 2 - mid)).toBeLessThan(2);
}

for (const hand of ['right', 'left'] as const) {
  test(`Play, ${hand}-handed at 375x812: Hit | Stand on top, ${BOTTOM[hand].join(' | ')} below`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0, handedness: hand });
    await withProfile(page, { seats: SOLO });
    await dealAllFive(page);
    await expect(page.locator('.action-bar')).toHaveAttribute('data-hand', hand);
    expectTwoRows(await bar(page), hand);
  });

  test(`Play, ${hand}-handed at 375x568: one row, Hit, Stand, ${BOTTOM[hand].join(', ')}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 568 });
    await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0, handedness: hand });
    await withProfile(page, { seats: SOLO });
    await dealAllFive(page);
    const boxes = await bar(page);
    for (const b of boxes) expect(Math.abs(b.y - boxes[0].y)).toBeLessThan(1);
    expect([...boxes].sort((a, b) => a.x - b.x).map((b) => b.label)).toEqual(['Hit', 'Stand', ...BOTTOM[hand]]);
  });

  test(`Flashcards, ${hand}-handed at 375x812: the same two rows`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await withSettings(page, { handedness: hand, drill: { flashCategory: 'pairs' } });
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
    await expect(page.locator('.action-bar .action-btn')).toHaveCount(5);
    expectTwoRows(await bar(page), hand);
  });
}
