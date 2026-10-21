import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, playRoundByAdvice } from './helpers';

/**
 * Wave O (item 3, review B1/S1): the sticky "Hold to peek" dock covered the
 * Play message strip on a short screen, hiding the bet and side-bet miss
 * lines said as a round opens. Whether a line would be covered is measured;
 * a covered one moves into the dock beside the peek button. Checked:
 *   - mid-round (seed 7: a hand to play),
 *   - after the round settles (seed 7, played out),
 *   - a round that settles at the deal (seed 11: dealer A-Q, insurance declined),
 * at 320x568, 320x641, 375x629 and 375x812, in a light and a dark theme. The
 * line is never painted over, the dealer stays in the band, and at 375x812
 * (where nothing collides) it stays in the strip as before.
 */

const SHOTS = process.env.O_SHOTS;
const SIZES = [
  { w: 320, h: 568, top: 20, bottom: 0 },
  { w: 320, h: 641, top: 0, bottom: 0 },
  { w: 375, h: 629, top: 0, bottom: 0 },
  { w: 375, h: 812, top: 47, bottom: 34 },
] as const;
const THEMES = ['bone-ink', 'midnight-felt'] as const;
type Stage = 'mid-round' | 'settled' | 'settled-at-deal';

async function insets(page: Page, t: number, b: number): Promise<void> {
  await page.addInitScript(([top, bottom]) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = `:root { --safe-top: ${top}px !important; --safe-bottom: ${bottom}px !important; }`;
      document.head.appendChild(s);
    });
  }, [t, b] as const);
}

async function openRound(page: Page, theme: string, stage: Stage): Promise<void> {
  await withSettings(page, { theme, feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0, audio: { enabled: true } });
  // Royal Match pays every hand: dealing without it is a side-bet miss.
  await withProfile(page, { countCheckEvery: 0, rules: { decks: 6, s17: true }, sideBet: { enabled: true, stake: 25, bet: 'royalMatch', payTable: 'rm-v2' } });
  await page.goto(`/?seed=${stage === 'settled-at-deal' ? 11 : 7}&e2e=1`);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.getByTestId('side-miss')).toHaveCount(1);
  const deal = page.getByRole('button', { name: 'Deal', exact: true });
  if (stage === 'mid-round') {
    await expect(page.locator('.action-bar[data-advice]')).toBeVisible();
  } else if (stage === 'settled') {
    await expect(page.locator('.action-bar[data-advice]')).toBeVisible();
    await playRoundByAdvice(page);
    await expect(deal).toBeVisible();
  } else {
    // Dealer ace: the insurance offer, declined, and the dealer's blackjack settles it.
    const sheet = page.locator('.bottom-sheet', { hasText: 'Insurance?' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Decline', exact: true }).click();
    await expect(deal).toBeVisible();
    await expect(page.locator('.action-bar[data-advice]')).toHaveCount(0);
  }
  // Let the placement settle (Table keeps placing for up to 2 s).
  await page.waitForTimeout(2300);
}

/** Every miss line: painted over anywhere? in the dock? Plus the band's edges. */
function geometry(page: Page) {
  return page.evaluate(() => {
    const strips = [...document.querySelectorAll<HTMLElement>('.table-screen .bet-miss')].map(
      (m) => m.closest<HTMLElement>('.result-strip')!,
    );
    const covered = strips.map((strip) => {
      const r = strip.getBoundingClientRect();
      const pts: [number, number][] = [
        [r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4],
        [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
      ];
      return pts.filter(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !hit || !strip.contains(hit);
      }).length;
    });
    const top = document.querySelector('.table-screen > .topbar')?.getBoundingClientRect().bottom ?? 0;
    const up = document.querySelector('.table-screen > .dealer-area .card')!.getBoundingClientRect();
    const result = document.querySelector('.message-strip .message-result');
    let resultCovered = 0;
    if (result) {
      const r = result.getBoundingClientRect();
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      resultCovered = !hit || !result.contains(hit) ? 1 : 0;
    }
    return {
      count: strips.length,
      covered,
      inDock: strips.map((s) => !!s.closest('.peek-dock')),
      dockHeight: document.querySelector('.table-screen > .peek-dock')!.getBoundingClientRect().height,
      offScreen: strips.some((s) => s.getBoundingClientRect().bottom > window.innerHeight || s.getBoundingClientRect().top < top - 0.5),
      dealerTop: up.top,
      topbarBottom: top,
      hasResult: !!result,
      resultCovered,
    };
  });
}

for (const theme of THEMES) {
  for (const size of SIZES) {
    const at = `${size.w}x${size.h}`;
    test.describe(`${theme} ${at}`, () => {
      test.use({ viewport: { width: size.w, height: size.h } });
      for (const stage of ['mid-round', 'settled', 'settled-at-deal'] as const) {
        test(`${stage}: the side-bet miss line is never under the dock`, async ({ page }) => {
          await insets(page, size.top, size.bottom);
          await openRound(page, theme, stage);
          const r = await geometry(page);
          if (SHOTS) await page.screenshot({ path: `${SHOTS}/peek-strip-${at}-${stage}-${theme}.png` });
          expect(r.count).toBe(1);
          expect(r.covered, `covered sample points: ${JSON.stringify(r)}`).toEqual([0]);
          expect(r.offScreen).toBe(false);
          expect(r.dealerTop).toBeGreaterThanOrEqual(r.topbarBottom - 0.5);
          if (stage !== 'mid-round') {
            expect(r.hasResult).toBe(true);
            // Moving the misses out frees the result line below them. At
            // 320x568 a solo table's full-size cards leave no room for it
            // either way (as before Wave O; only a crowded table is compacted).
            if (size.h > 568) expect(r.resultCovered, 'the result line is under the dock').toBe(0);
          }
          // In the dock it sits beside the peek: the dock keeps its height.
          expect(r.dockHeight).toBeLessThanOrEqual(56.5);
          // Where nothing collides, nothing moves: the strip, as before Wave O.
          if (size.h === 812) expect(r.inDock).toEqual([false]);
        });
      }
    });
  }
}
