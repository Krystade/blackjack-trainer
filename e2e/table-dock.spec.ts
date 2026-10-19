import { test, expect, type Locator, type Page } from '@playwright/test';
import { withSettings, withProfile, playRoundByAdvice } from './helpers';

/**
 * Wave J (review B1): on a phone the table's decision buttons are on screen
 * without a scroll. A full table -- three bots, a back-counter's narration,
 * a ×2 ramp's hands toggle, two hands on the felt -- is taller than 812px,
 * and Watch / Sit in (and Deal / Leave) used to sit below the fold.
 *
 * Every click here is a dispatched event, and the page is scrolled to the top
 * before each check, so Playwright's actionability scroll can never be what
 * brings a button into view. Each check first proves the page DOES overflow,
 * so a short table cannot pass it vacuously. The iPhone 13 mini's notch
 * insets are set (env() cannot be emulated; the app reads it through
 * --safe-top / --safe-bottom), so "on screen" means above the home indicator.
 */

test.use({ viewport: { width: 375, height: 812 } });

const SETTINGS = { feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0, audio: { enabled: true } };
/** 1u below 0; two hands of 2u from 0 up. Entry 0, three bots. */
const PROFILE = {
  betSpreadOn: true,
  backCount: true,
  wongInTc: 0,
  countCheckEvery: 0,
  seats: { bots: 3 },
  spread: [
    { minTc: -99, units: 1 },
    { minTc: 0, units: 2, hands: 2 },
  ],
};

/** iPhone 13 mini notch insets, as the layout specs set them. */
async function notch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const add = () => {
      const s = document.createElement('style');
      s.textContent = ':root{--safe-top:47px !important;--safe-bottom:34px !important}';
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  });
}

async function atTopAllInView(page: Page, buttons: Locator[]): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const overflow = await page.evaluate(
    () => document.scrollingElement!.scrollHeight - window.innerHeight,
  );
  expect(overflow, 'the table must be taller than the screen for this check to mean anything').toBeGreaterThan(0);
  for (const b of buttons) {
    const box = await b.boundingBox();
    expect(box, `${b} is not rendered`).not.toBeNull();
    expect(box!.y, `${b} above the top`).toBeGreaterThanOrEqual(0);
    // Above the 34px home-indicator band, not just inside the viewport.
    expect(box!.y + box!.height, `${b} below the fold`).toBeLessThanOrEqual(812 - 34);
  }
}

test('watching and seated at a full table, the decision buttons are on screen at the top of the page', async ({ page }) => {
  await notch(page);
  await withSettings(page, SETTINGS);
  await withProfile(page, PROFILE);
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  const watch = page.getByRole('button', { name: 'Watch', exact: true });
  const sitIn = page.getByRole('button', { name: 'Sit in', exact: true });
  // Watched rounds put the bots' hands and the narration on the felt: the
  // reviewer's state is round 2 of seed 7.
  for (const round of [1, 2]) {
    await watch.dispatchEvent('click');
    await expect(page.locator('.topbar-stat', { hasText: 'Round' })).toHaveText(`Round ${round}`);
    await expect(page.locator('.message-sat-out')).toHaveText('Watching — no bet.');
  }
  await expect(page.locator('.bot-seat')).toHaveCount(3);
  await atTopAllInView(page, [watch, sitIn]);

  // Seated: sit in, then two hands at the ×2 count.
  await sitIn.dispatchEvent('click');
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await playRoundByAdvice(page);
  const two = page.getByRole('button', { name: '2 hands', exact: true });
  await two.dispatchEvent('click');
  await expect(two).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.chip-btn', { hasText: /^2$/ }).dispatchEvent('click');
  const deal = page.getByRole('button', { name: 'Deal', exact: true });
  await deal.dispatchEvent('click');
  await expect(page.locator('.player-hand')).toHaveCount(2);
  await playRoundByAdvice(page);
  const leave = page.getByRole('button', { name: 'Leave', exact: true });
  await expect(deal).toBeVisible();
  await atTopAllInView(page, [deal, leave, two, page.locator('.chip-btn', { hasText: /^2$/ })]);
});
