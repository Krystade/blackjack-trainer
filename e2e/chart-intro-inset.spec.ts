import { test, expect, type Page } from '@playwright/test';

/**
 * D-R12 (#3): the first-run "How to read the chart" card on a 13 mini with
 * BOTH insets (47px status bar, 34px home indicator). The heading and the
 * whole Start quiz button sit below the drill top bar, uncovered, and the bar
 * pins once at the status-bar line with no empty strip above it.
 */
test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const TOP = 47;
const BOTTOM = 34;

async function openIntro(page: Page) {
  await page.addInitScript(([t, b]) => {
    const add = () => {
      const s = document.createElement('style');
      s.textContent = `:root{--safe-top:${t}px !important;--safe-bottom:${b}px !important}`;
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  }, [TOP, BOTTOM] as const);
  await page.goto('/?e2e=1&intro=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.getByTestId('chart-intro')).toBeVisible();
}

const hit = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px!, py!);
    return el ? `${el.tagName}.${(el as HTMLElement).className}` : 'none';
  }, [x, y]);

test('47/34 insets: heading and full Start quiz below the top bar, uncovered', async ({ page }) => {
  await openIntro(page);
  const intro = page.getByTestId('chart-intro');
  const bar = (await intro.locator('.drill-topbar').boundingBox())!;
  expect(bar.y, 'bar pinned once, at the status-bar line').toBe(TOP);

  const h2 = (await intro.getByRole('heading', { name: 'How to read the chart' }).boundingBox())!;
  expect(h2.y, 'heading below the bar').toBeGreaterThanOrEqual(bar.y + bar.height);
  for (const x of [h2.x + 4, h2.x + h2.width / 2]) {
    expect(await hit(page, x, h2.y + h2.height / 2), `heading at x=${x}`).toMatch(/^H2/);
  }

  const start = (await intro.locator('.chart-intro-start').boundingBox())!;
  expect(start.y, 'Start quiz below the bar').toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(start.y + start.height, 'Start quiz above the home indicator').toBeLessThanOrEqual(812 - BOTTOM);
  for (const y of [start.y + 1, start.y + start.height / 2, start.y + start.height - 1]) {
    // 16px in from the sides: the 12px corner radius is not the button.
    for (const x of [start.x + 16, start.x + start.width / 2, start.x + start.width - 16]) {
      expect(await hit(page, x, y), `Start quiz at ${x},${y}`).toMatch(/chart-intro-start/);
    }
  }
});
