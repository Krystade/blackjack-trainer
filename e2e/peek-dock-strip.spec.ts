import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * Wave O: at 320x568 the sticky "Hold to peek" dock covered the Play message
 * strip, hiding the bet and side-bet miss lines said as a round opens. The
 * miss line must sit above the dock (inside the visible band) at 320x568, and
 * the 375x812 layout is unchanged.
 */

const SHOTS = process.env.O_SHOTS;

async function insets(page: Page, t: number, b: number): Promise<void> {
  await page.addInitScript(([top, bottom]) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = `:root { --safe-top: ${top}px !important; --safe-bottom: ${bottom}px !important; }`;
      document.head.appendChild(s);
    });
  }, [t, b] as const);
}

async function openMissedRound(page: Page, theme: string): Promise<void> {
  await withSettings(page, { theme, feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0, audio: { enabled: true } });
  // Royal Match pays every hand: dealing without it is a side-bet miss.
  await withProfile(page, { countCheckEvery: 0, rules: { decks: 6, s17: true }, sideBet: { enabled: true, stake: 25, bet: 'royalMatch', payTable: 'rm-v2' } });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.getByTestId('side-miss')).toBeVisible();
  // Let the placement settle (Table keeps placing for up to 2 s).
  await page.waitForTimeout(2300);
}

/** Where the miss line is, and whether anything is painted over its corners or centre. */
function geometry(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="side-miss"]')!;
    const strip = el.closest<HTMLElement>('.result-strip')!;
    const r = strip.getBoundingClientRect();
    const pts: [number, number][] = [
      [r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4],
      [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
    ];
    const covered = pts.filter(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !hit || !strip.contains(hit);
    }).length;
    const top = document.querySelector('.table-screen > .topbar')?.getBoundingClientRect().bottom ?? 0;
    const dealer = document.querySelector('.table-screen > .dealer-area .card')!.getBoundingClientRect();
    return { covered, missTop: r.top, missBottom: r.bottom, vh: window.innerHeight, topbarBottom: top, dealerTop: dealer.top, inDock: !!strip.closest('.peek-dock') };
  });
}

// A light theme and the dark default.
for (const scheme of ['bone-ink', 'midnight-felt'] as const) {
  test.describe(`${scheme}`, () => {

    test.describe('320x568', () => {
      test.use({ viewport: { width: 320, height: 568 } });
      test(`the side-bet miss line is above the peek dock (${scheme})`, async ({ page }) => {
        await insets(page, 20, 0);
        await openMissedRound(page, scheme);
        const r = await geometry(page);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/peek-strip-320-${scheme}.png` });
        expect(r.covered).toBe(0);
        expect(r.missTop).toBeGreaterThanOrEqual(r.topbarBottom - 0.5);
        expect(r.missBottom).toBeLessThanOrEqual(r.vh);
        // The dealer's up-card still shows too.
        expect(r.dealerTop).toBeGreaterThanOrEqual(r.topbarBottom - 0.5);
      });
    });

    test.describe('375x812', () => {
      test.use({ viewport: { width: 375, height: 812 } });
      test(`unchanged: the miss line shows above the dock (${scheme})`, async ({ page }) => {
        await insets(page, 47, 34);
        await openMissedRound(page, scheme);
        const r = await geometry(page);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/peek-strip-375-${scheme}.png` });
        expect(r.covered).toBe(0);
        // Still in the message strip, not moved into the dock.
        expect(r.inDock).toBe(false);
      });
    });
  });
}
