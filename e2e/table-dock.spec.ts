import { test, expect, type Locator, type Page } from '@playwright/test';
import { withSettings, withProfile, playRoundByAdvice } from './helpers';

/**
 * Wave J (review B1): on a phone the table's decision buttons are on screen
 * without a scroll. A full table -- three bots, a back-counter's narration,
 * a ×2 ramp's hands toggle, two hands on the felt -- is taller than 812px,
 * and the bet bar's buttons (now the In/Out toggle and Deal) used to sit
 * below the fold.
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
/** 1u below 0; two hands of 2u from 0 up. Entry 0, three bots, each shoe started Out. */
const PROFILE = {
  betSpreadOn: true,
  startShoeOut: true,
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
  // As a reader scrolling up would: the wheel ends the app's own placing of
  // the player's hand (fix round 2), then the page goes to its very top.
  await page.evaluate(() => {
    window.dispatchEvent(new WheelEvent('wheel'));
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  // Fix round 3 compacts a crowded phone table, so at 375x812 this one may
  // now fit outright; the matrix below covers the sticky dock where it doesn't.
  for (const b of buttons) {
    const box = await b.boundingBox();
    expect(box, `${b} is not rendered`).not.toBeNull();
    expect(box!.y, `${b} above the top`).toBeGreaterThanOrEqual(0);
    // Above the 34px home-indicator band, not just inside the viewport.
    expect(box!.y + box!.height, `${b} below the fold`).toBeLessThanOrEqual(812 - 34);
  }
}

test('out and in at a full table, the decision buttons are on screen at the top of the page', async ({ page }) => {
  await notch(page);
  await withSettings(page, SETTINGS);
  await withProfile(page, PROFILE);
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  const toggle = page.getByRole('group', { name: 'In or out' });
  const inBtn = toggle.getByRole('button', { name: 'In', exact: true });
  const outBtn = toggle.getByRole('button', { name: 'Out', exact: true });
  const deal = page.getByRole('button', { name: 'Deal', exact: true });
  // Rounds out put the bots' hands and the narration on the felt: the
  // reviewer's state is round 2 of seed 7.
  await expect(outBtn).toHaveAttribute('aria-pressed', 'true');
  for (const round of [1, 2]) {
    await deal.dispatchEvent('click');
    await expect(page.locator('.topbar-stat', { hasText: 'Round' })).toHaveText(`Round ${round}`);
    await expect(page.locator('.message-sat-out')).toHaveText('Out — no bet.');
  }
  await expect(page.locator('.bot-seat')).toHaveCount(3);
  await atTopAllInView(page, [inBtn, outBtn, deal]);

  // In, then two hands at the ×2 count.
  await inBtn.dispatchEvent('click');
  await deal.dispatchEvent('click');
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await playRoundByAdvice(page);
  const two = page.getByRole('button', { name: '2 hands', exact: true });
  await two.dispatchEvent('click');
  await expect(two).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.chip-btn', { hasText: /^2$/ }).dispatchEvent('click');
  await deal.dispatchEvent('click');
  await expect(page.locator('.player-hand')).toHaveCount(2);
  await playRoundByAdvice(page);
  await expect(deal).toBeVisible();
  await atTopAllInView(page, [deal, inBtn, outBtn, two, page.locator('.chip-btn', { hasText: /^2$/ })]);
});

/**
 * Fix rounds 2 and 3: what a phone must show, shown without a scroll by the
 * player. Between the pinned topbar and the docked bar (the "band"):
 *   - a decision: the dealer's up-card and the hand being played, with the
 *     action buttons on screen;
 *   - a settled round: the dealer's whole hand, every player hand and every
 *     result line, with the dock;
 *   - a round out: the dealer and the Watching spot.
 * At 375x812 (notch) and 320x568 (no notch), 1 and 3 bots, one hand and two,
 * over enough rounds that a four-card hand is among them. Clicks are
 * dispatched, so the scroll is always the app's own.
 */
type Box = { top: number; bottom: number; left: number; right: number };

async function regions(page: Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => {
    const box = (el: Element): Box => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    };
    const all = (sel: string) => [...document.querySelectorAll(sel)].map(box).filter((b) => b.bottom > b.top);
    const tb = document.querySelector('.table-screen > .topbar');
    const dock = all('.table-screen > .peek-dock, .table-screen > .action-bar:not(.action-bar-hidden)');
    return {
      bandTop: tb ? Math.max(0, tb.getBoundingClientRect().bottom) : 0,
      dockTop: Math.min(...dock.map((d) => d.top)),
      dockBottom: Math.max(...dock.map((d) => d.bottom)),
      dockCount: dock.length,
      vh: window.innerHeight,
      vw: window.innerWidth,
      upCard: all('.dealer-area .card')[0] ?? null,
      dealerCards: all('.dealer-area .card'),
      active: all('.player-hand.hand-active'),
      hands: all('.player-hand'),
      watching: all('.player-watching'),
      results: all('.message-strip > .message-result'),
      buttons: all('.table-screen > .action-bar .action-btn'),
      maxCards: Math.max(0, ...[...document.querySelectorAll('.player-hand .hand-cards')].map((h) => h.children.length)),
    };
  });
}

type Regions = Awaited<ReturnType<typeof regions>>;

function inBand(r: Regions, b: Box, what: string): void {
  expect(b.top, `${what}: under the topbar (top ${b.top}, band ${r.bandTop})`).toBeGreaterThanOrEqual(r.bandTop - 0.5);
  expect(b.bottom, `${what}: under the dock (bottom ${b.bottom}, dock ${r.dockTop})`).toBeLessThanOrEqual(r.dockTop + 0.5);
  expect(b.left, `${what}: off the left edge`).toBeGreaterThanOrEqual(-0.5);
  expect(b.right, `${what}: off the right edge`).toBeLessThanOrEqual(r.vw + 0.5);
}

function dockOnScreen(r: Regions, stage: string): void {
  expect(r.dockCount, `${stage}: no dock`).toBe(2);
  expect(r.dockBottom, `${stage}: dock below the screen`).toBeLessThanOrEqual(r.vh + 0.5);
}

for (const [w, h] of [[375, 812], [320, 568]] as const) {
  for (const bots of [1, 3]) {
    test(`${w}x${h}, ${bots} bot(s): up-card and hand at every decision; dealer, hands and result once settled`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      // 320x568 is the iPhone SE (1st gen) size, which has no notch.
      if (h === 812) await notch(page);
      await withSettings(page, SETTINGS);
      await withProfile(page, { ...PROFILE, seats: { bots } });
      await page.goto('/?seed=7&e2e=1');
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      const btn = (name: string) => page.getByRole('button', { name, exact: true });
      let decisions = 0;
      let maxCards = 0;

      /** Plays the round out by the advice, checking every decision, then the settled table. */
      const playChecked = async (tag: string) => {
        for (let guard = 0; guard < 30; guard++) {
          if (await btn('Decline').isVisible()) {
            await btn('Decline').dispatchEvent('click');
            continue;
          }
          const bar = page.locator('.action-bar[data-advice]');
          if (!(await bar.isVisible())) break;
          const r = await regions(page);
          const stage = `${tag}, decision ${guard}`;
          expect(r.upCard, `${stage}: no up-card`).not.toBeNull();
          inBand(r, r.upCard!, `${stage}, the up-card`);
          expect(r.active.length, `${stage}: no active hand`).toBe(1);
          inBand(r, r.active[0], `${stage}, the active hand`);
          dockOnScreen(r, stage);
          expect(r.buttons.length, `${stage}: no action buttons`).toBeGreaterThan(0);
          for (const b of r.buttons) expect(b.bottom, `${stage}: an action button below the screen`).toBeLessThanOrEqual(r.vh + 0.5);
          maxCards = Math.max(maxCards, r.maxCards);
          decisions++;
          const a = (await bar.getAttribute('data-advice'))!;
          await bar.getByRole('button', { name: a[0].toUpperCase() + a.slice(1), exact: true }).dispatchEvent('click');
        }
        await expect(btn('Deal')).toBeVisible();
        const r = await regions(page);
        const stage = `${tag}, settled`;
        for (const c of r.dealerCards) inBand(r, c, `${stage}, a dealer card`);
        expect(r.hands.length, `${stage}: no hands`).toBeGreaterThan(0);
        for (const hand of r.hands) inBand(r, hand, `${stage}, a player hand`);
        expect(r.results.length, `${stage}: no result line`).toBe(r.hands.length);
        for (const line of r.results) inBand(r, line, `${stage}, a result line`);
        dockOnScreen(r, stage);
        maxCards = Math.max(maxCards, r.maxCards);
      };

      // "Start each shoe out": the first rounds are dealt Out.
      for (const round of [1, 2]) {
        await btn('Deal').dispatchEvent('click');
        await expect(page.locator('.topbar-stat', { hasText: 'Round' })).toHaveText(`Round ${round}`);
        const r = await regions(page);
        for (const c of r.dealerCards) inBand(r, c, `watching round ${round}, a dealer card`);
        expect(r.watching.length).toBe(1);
        inBand(r, r.watching[0], `watching round ${round}, the Watching spot`);
        dockOnScreen(r, `watching round ${round}`);
      }
      await page.getByRole('group', { name: 'In or out' }).getByRole('button', { name: 'In', exact: true }).dispatchEvent('click');
      await btn('Deal').dispatchEvent('click');
      await expect(page.locator('.player-hand')).toHaveCount(1);
      await playChecked('one hand, round 3');
      await btn('Deal').dispatchEvent('click');
      await playChecked('one hand, round 4');

      await page.getByRole('button', { name: '2 hands', exact: true }).dispatchEvent('click');
      await page.locator('.chip-btn', { hasText: /^2$/ }).dispatchEvent('click');
      for (const round of [5, 6, 7, 8]) {
        await btn('Deal').dispatchEvent('click');
        await expect(page.locator('.topbar-stat', { hasText: 'Round' })).toHaveText(`Round ${round}`);
        await playChecked(`two hands, round ${round}`);
      }
      // Vacuity guards: decisions were checked, and a four-card hand was on the felt.
      expect(decisions, 'no decision was ever checked').toBeGreaterThan(3);
      expect(maxCards, 'no four-card hand came up; add rounds').toBeGreaterThanOrEqual(4);
    });
  }
}
