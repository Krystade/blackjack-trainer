import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance, playRoundByAdvice, shot } from './helpers';

test.use({ viewport: { width: 375, height: 812 } });
const THEMES = ['midnight-felt', 'bone-ink', 'amoled-night', 'slate-copper'] as const;
const SOLO = { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 };

/** Deal seeds from `firstSeed` until one stops at a player decision. */
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

async function boxes(page: Page, sel: string) {
  return page.locator(sel).evaluateAll((els) =>
    els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right }; }));
}

const BANNER = /^(Win \+[\d.]+|Lose −[\d.]+|Push|Blackjack! \+[\d.]+|Surrender −[\d.]+) · You (\d+( \(bust\))?|blackjack) · Dealer (\d+( \(bust\))?|blackjack|shows (A|[2-9]|10|J|Q|K))$/;

test('B5/W5: a settled hand shows its result and both totals at 20px or more', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { seats: SOLO });
  await dealPlayerTurn(page);
  await playRoundByAdvice(page);
  const banner = page.locator('.round-banner');
  await expect(banner).toHaveCount(1);
  await expect(banner).toHaveText(BANNER);
  expect(await banner.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);
});

test('B5/W5: two hands get a banner each, labelled in play order', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { seats: { ...SOLO, playerHands: 2 } });
  await dealPlayerTurn(page);
  await playRoundByAdvice(page);
  const banners = page.locator('.round-banner');
  const n = await banners.count();
  expect(n).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < n; i++) await expect(banners.nth(i)).toHaveText(new RegExp(`^Hand ${i + 1}: .+ · You .+ · Dealer .+$`));
});

/** A multi-hand banner: the play-order label, then the full solo grammar. */
const HAND_BANNER = new RegExp(`^Hand [1-9]: ${BANNER.source.slice(1)}`);

// Two hands, so the "Hand N:" label makes a banner too long for one line at
// 375px: a banner that cannot wrap runs into the strip's padding and fails
// here. The bound is the strip's content box, not the viewport -- an unwrapped
// two-hand banner is ~375px wide, so it sits exactly on the screen edges.
for (const theme of THEMES) {
  test(`B5/W5: the banners sit inside the message strip at 375px in ${theme}`, async ({ page }) => {
    await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0, theme });
    await withProfile(page, { seats: { ...SOLO, playerHands: 2 } });
    await dealPlayerTurn(page);
    await playRoundByAdvice(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const banners = page.locator('.round-banner');
    await expect(banners.first()).toBeVisible();
    const n = await banners.count();
    expect(n).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < n; i++) await expect(banners.nth(i)).toHaveText(HAND_BANNER);
    const strip = await page.locator('.message-strip').evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) };
    });
    const parts = await boxes(page, '.round-banner, .round-banner-head, .round-banner-totals');
    expect(parts.length).toBe(n * 3);
    for (const b of parts) {
      expect(b.x).toBeGreaterThanOrEqual(strip.left - 0.5);
      expect(b.right).toBeLessThanOrEqual(strip.right + 0.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await shot(page, `b5-banner-${theme}`);
  });
}
