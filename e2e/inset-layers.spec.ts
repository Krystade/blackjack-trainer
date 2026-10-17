import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip } from './helpers';

/**
 * #2 / #51: the first-run chart intro and the "Show on chart" overlay are
 * their own fixed scroll layers, padded by the status-bar inset. Their sticky
 * bars added the inset a second time, so on a 13 mini (47px) the drill bar
 * hid the intro heading, the Charts bar's cover sat over Start quiz, and
 * scrolled chart text painted under the status bar. layout-guard scrolls the
 * window only, so these layers are checked here, scrolled AS layers.
 */
test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const INSET = 47;

async function withInset(page: Page) {
  await page.addInitScript((inset) => {
    const add = () => {
      const s = document.createElement('style');
      s.textContent = `:root{--safe-top:${inset}px !important}`;
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  }, INSET);
}

/** The element painted at (x, y), described for a failure message. */
function hitAt(page: Page, x: number, y: number) {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px!, py!);
    return el ? `${el.tagName}.${(el as HTMLElement).className}` : 'none';
  }, [x, y]);
}

/** Text that paints inside the status-bar band (y < INSET) in a layer. */
function textInStatusBand(page: Page, layer: string) {
  return page.evaluate(([sel, inset]) => {
    const root = document.querySelector(sel as string)!;
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.height === 0 || r.bottom <= 0 || r.top >= (inset as number)) continue;
        // Painted, not merely positioned: something else on top hides it.
        const top = document.elementFromPoint(r.left + r.width / 2, Math.max(1, r.top + 1));
        if (top && (top === n.parentElement || n.parentElement!.contains(top))) out.push(n.textContent.trim());
      }
    }
    return out;
  }, [layer, INSET] as const);
}

test('chart intro at a 47px inset: bar pinned once, heading and Start quiz uncovered, nothing under the status bar', async ({ page }) => {
  await withInset(page);
  await page.goto('/?e2e=1&intro=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  const intro = page.getByTestId('chart-intro');
  await expect(intro).toBeVisible();

  const bar = (await intro.locator('.drill-topbar').boundingBox())!;
  expect(bar.y, 'drill bar top').toBe(INSET);

  const h2 = (await intro.getByRole('heading', { name: 'How to read the chart' }).boundingBox())!;
  expect(await hitAt(page, h2.x + 20, h2.y + h2.height / 2)).toMatch(/^H2/);
  const start = (await intro.locator('.chart-intro-start').boundingBox())!;
  for (const y of [start.y + 2, start.y + start.height - 2]) {
    expect(await hitAt(page, start.x + start.width / 2, y), `Start quiz at y=${y}`).toMatch(/chart-intro-start/);
  }

  for (const scroll of [300, 700, 1200]) {
    await intro.evaluate((el, s) => { el.scrollTop = s; }, scroll);
    await page.waitForTimeout(50);
    expect(await textInStatusBand(page, '[data-testid="chart-intro"]'), `scrolled ${scroll}`).toEqual([]);
    const charts = (await intro.locator('.charts-topbar').boundingBox())!;
    expect(charts.y, `charts bar top when scrolled ${scroll}`).toBeGreaterThanOrEqual(INSET);
  }
  // Scrolled into the chart, the Charts bar pins right under the status bar, with the disc in it.
  const charts = (await intro.locator('.charts-topbar').boundingBox())!;
  expect(charts.y).toBe(INSET);
  const disc = (await page.locator('.mute-btn').boundingBox())!;
  expect(disc.y).toBeGreaterThanOrEqual(charts.y);
  expect(disc.y + disc.height).toBeLessThanOrEqual(charts.y + charts.height);
  // The ringed cell's note pins straight under the bar, with no gap for cells to show through.
  const note = (await intro.locator('.charts-note').boundingBox())!;
  expect(note.y, 'note pinned under the bar').toBeCloseTo(charts.y + charts.height, 0);
});

test('Show on chart overlay at a 47px inset: bar pinned once with the disc in it, nothing under the status bar', async ({ page }) => {
  await withInset(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  for (let i = 0; i < 12; i++) {
    const b = page.locator('.action-bar button.action-btn:not([disabled])').first();
    if ((await answerAndReadStrip(page, b)) === 'miss') break;
  }
  await page.locator('[data-testid="result-strip"][data-tone="miss"]').getByRole('button', { name: 'Show on chart', exact: true }).click();
  const overlay = page.locator('.study-chart-overlay');
  await expect(overlay).toBeVisible();
  for (const scroll of [0, 400, 900]) {
    await overlay.evaluate((el, s) => { el.scrollTop = s; }, scroll);
    await page.waitForTimeout(50);
    const bar = (await overlay.locator('.charts-topbar').boundingBox())!;
    expect(bar.y, `bar top scrolled ${scroll}`).toBe(INSET);
    const disc = (await page.locator('.mute-btn').boundingBox())!;
    expect(disc.y, 'disc inside the bar').toBeGreaterThanOrEqual(bar.y);
    expect(disc.y + disc.height).toBeLessThanOrEqual(bar.y + bar.height);
    expect(await textInStatusBand(page, '.study-chart-overlay'), `scrolled ${scroll}`).toEqual([]);
  }
});
