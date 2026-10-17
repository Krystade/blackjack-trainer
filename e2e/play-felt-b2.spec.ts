import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance, playRoundByAdvice } from './helpers';

/**
 * Wave B2 on the felt.
 * #34: a banner that wraps breaks between the result and the totals with no
 *      dot left hanging at the end of the first line.
 * #33: with two hands, one hit no longer shrinks every card below 70px while
 *      the felt below stays empty -- the hands take a row each instead.
 */

const SOLO = { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 };

async function dealPlayerTurn(page: Page, firstSeed = 1): Promise<number> {
  for (let seed = firstSeed; seed < firstSeed + 30; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);
    if (await page.locator('.action-bar[data-advice]').isVisible().catch(() => false)) return seed;
  }
  throw new Error('no seed reached a player decision');
}

/** Per banner: did the totals wrap under the result, and is the dot drawn? */
async function bannerLines(page: Page) {
  return page.locator('.round-banner').evaluateAll((els) =>
    els.map((el) => {
      const head = el.querySelector('.round-banner-head')!.getBoundingClientRect();
      const totals = el.querySelector('.round-banner-totals')!.getBoundingClientRect();
      const sep = el.querySelector('.round-banner-sep')!;
      const sepBox = sep.getBoundingClientRect();
      return {
        text: el.textContent,
        wrapped: totals.top > head.top + head.height / 2,
        sepDrawn: sep.getClientRects().length > 0 && sepBox.width > 0,
        sepTop: sepBox.top,
        headTop: head.top,
      };
    }),
  );
}

test('B2 #34: a wrapped banner drops the dot; an unwrapped one keeps it on the line', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { seats: { ...SOLO, playerHands: 2 } });
  await dealPlayerTurn(page);
  await playRoundByAdvice(page);
  await expect(page.locator('.round-banner').first()).toBeVisible();
  const narrow = await bannerLines(page);
  expect(narrow.some((b) => b.wrapped), 'vacuity guard: a two-hand banner wraps at 375').toBe(true);
  for (const b of narrow) {
    if (b.wrapped) expect(b.sepDrawn, `${b.text}: dot left at a line end`).toBe(false);
    else expect(b.sepDrawn).toBe(true);
    // The text itself is unchanged, dot included, for anything that reads it.
    expect(b.text).toMatch(/^Hand \d: .+ · You .+ · Dealer .+$/);
  }

  // Wide enough for one line: the dot is back, on the result's line.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(async () => (await bannerLines(page)).every((b) => !b.wrapped)).toBe(true);
  for (const b of await bannerLines(page)) {
    expect(b.sepDrawn).toBe(true);
    expect(Math.abs(b.sepTop - b.headTop)).toBeLessThanOrEqual(4);
  }
});

async function cardWidths(page: Page): Promise<number[][]> {
  return page.locator('.hands-row .player-hand').evaluateAll((hands) =>
    hands.map((h) => [...h.querySelectorAll('.card')].map((c) => Math.round(c.getBoundingClientRect().width))),
  );
}

test('B2 #33: two hands keep cards at 70px or more as they draw, a row each when one row cannot', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { seats: { ...SOLO, playerHands: 2 } });
  let sawThree = false;
  for (let seed = 1; seed < 40 && !sawThree; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    for (let guard = 0; guard < 30; guard++) {
      if (await resolveInsurance(page, false)) continue;
      const bar = page.locator('.action-bar[data-advice]');
      if (!(await bar.isVisible().catch(() => false))) break;
      const widths = await cardWidths(page);
      const counts = widths.map((w) => w.length);
      if (counts.length === 2 && Math.max(...counts) >= 3 && Math.max(...counts) <= 4) {
        sawThree = true;
        for (const w of widths.flat()) expect(w, `cards ${JSON.stringify(widths)}`).toBeGreaterThanOrEqual(70);
        const box = await page.locator('.hands-row .player-hand').evaluateAll((hs) => hs.map((h) => h.getBoundingClientRect().right));
        for (const r of box) expect(r).toBeLessThanOrEqual(375);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      }
      const advice = (await bar.getAttribute('data-advice'))!;
      await bar.getByRole('button', { name: advice[0]!.toUpperCase() + advice.slice(1), exact: true }).click();
    }
  }
  expect(sawThree, 'vacuity guard: some round had a two-hand table with a 3- or 4-card hand').toBe(true);
});
