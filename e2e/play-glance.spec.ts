import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance, playRoundByAdvice, shot, openCountOptions } from './helpers';

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

for (const hands of [1, 2] as const) {
  test(`B5/W4: ${hands} hand(s): cards ≥ 70px at 375, centred, one row, no sideways scroll`, async ({ page }) => {
    await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
    await withProfile(page, { seats: { ...SOLO, playerHands: hands } });
    await dealPlayerTurn(page);
    const player = await boxes(page, '.hands-row .card');
    const dealer = await boxes(page, '.dealer-area .card');
    expect(player.length).toBeGreaterThanOrEqual(hands * 2);
    for (const b of [...player, ...dealer]) {
      expect(b.w).toBeGreaterThanOrEqual(70);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(375);
    }
    const handBoxes = await boxes(page, '.player-hand');
    expect(new Set(handBoxes.map((h) => Math.round(h.y))).size).toBe(1);
    const left = Math.min(...handBoxes.map((h) => h.x));
    const right = 375 - Math.max(...handBoxes.map((h) => h.right));
    expect(Math.abs(left - right)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
}

test('B5/W4: three hands shrink to fit one row', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { seats: { ...SOLO, playerHands: 3 } });
  await dealPlayerTurn(page);
  const player = await boxes(page, '.hands-row .card');
  for (const b of player) { expect(b.w).toBeLessThan(70); expect(b.w).toBeGreaterThanOrEqual(32); expect(b.right).toBeLessThanOrEqual(375); }
  expect(new Set((await boxes(page, '.player-hand')).map((h) => Math.round(h.y))).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('B5/W4: action-bar labels are at least 13px and none is cut off', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { seats: SOLO });
  await dealPlayerTurn(page);
  const m = await page.locator('.action-bar .action-btn').evaluateAll((els) =>
    els.map((e) => ({ px: parseFloat(getComputedStyle(e).fontSize), fits: e.scrollWidth <= e.clientWidth, h: e.getBoundingClientRect().height })));
  expect(m).toHaveLength(5);
  for (const b of m) { expect(b.px).toBeGreaterThanOrEqual(13); expect(b.fits).toBe(true); expect(b.h).toBeGreaterThanOrEqual(48); }
});

test('B5: the skip control is a styled button, not an emoji', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 400 });
  await page.goto('/?seed=3&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  const ff = page.locator('.fast-forward-btn');
  await expect(ff).toBeVisible();
  await expect(ff).toHaveText('Skip');
  expect(await ff.innerText()).not.toMatch(/\p{Extended_Pictographic}/u);
  expect((await ff.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await ff.click();
  await expect(ff).toHaveCount(0);
});

for (const [group, min] of [[1, 96], [3, 70]] as const) {
  test(`B5/W4: the Count drill flashes big cards (group of ${group})`, async ({ page }) => {
    await withSettings(page, { drill: { countLengthCards: 6, countGroup: group, countManual: true } });
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Count drill', exact: true }).click();
    await openCountOptions(page);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const cards = await boxes(page, '.manual-tap-zone .count-flash-cards .card');
    expect(cards).toHaveLength(group);
    for (const c of cards) { expect(c.w).toBeGreaterThanOrEqual(min); expect(c.right).toBeLessThanOrEqual(375); }
  });
}

test('B5/W4: Pair cancellation shows both cards at least 90px wide', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Pair cancellation', exact: true }).click();
  const cards = await boxes(page, '.pair-cancel-cards .card');
  expect(cards).toHaveLength(2);
  for (const c of cards) { expect(c.w).toBeGreaterThanOrEqual(90); expect(c.right).toBeLessThanOrEqual(375); }
});

for (const theme of THEMES) {
  test(`B5 screenshots: felt and banner at 375x812 in ${theme}`, async ({ page }) => {
    // The 220ms fly-in would catch the cards half-faded; shoot them at rest.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await withSettings(page, { theme, countCheckEvery: 0, dealSpeedMs: 0 });
    await withProfile(page, { seats: { ...SOLO, playerHands: 2 } });
    await dealPlayerTurn(page);
    await shot(page, `b5-felt-${theme}`);
    await playRoundByAdvice(page);
    await shot(page, `b5-banner-${theme}`);
  });
}
