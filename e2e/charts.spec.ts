import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { answerAndReadStrip, shot, withProfile, withSettings } from './helpers';

/**
 * Operator item #6: viewable strategy charts.
 *
 * The screen renders getChart(activeProfile.rules) -- the SAME assembled chart
 * src/engine/strategy.ts grades against -- so most correctness lives in
 * src/ui/screens/chartRows.test.ts (pure, 37 cases). What only a browser can
 * prove is asserted here: the row-order toggle and its persistence, that every
 * grid fits a 375px phone with nothing scrolling sideways (B4), the mute disc
 * sitting in the header bar rather than over cells (#24), and the highlight
 * API opening scrolled to one ringed cell with its neighbours still on screen.
 */

async function openCharts(page: Page, url = '/?e2e=1'): Promise<void> {
  await page.goto(url);
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.locator('.charts-heading')).toHaveText('Strategy charts');
}

/** The visible row labels of one section, top to bottom. */
function rowLabels(page: Page, section: string) {
  return page.locator(`[data-section="${section}"] .chart-rowlabel`);
}

test('Home offers a Charts destination that opens the viewer', async ({ page }) => {
  await withProfile(page);
  await openCharts(page);

  await expect(page.locator('[data-section="HARD"]')).toBeVisible();
  await expect(page.locator('[data-section="SOFT"]')).toBeVisible();
  await expect(page.locator('[data-section="PAIRS"]')).toBeVisible();

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
});

test('the header names the ACTIVE profile ruleset, so which chart is on screen is unambiguous', async ({ page }) => {
  await withProfile(page, { rules: { decks: 2, s17: true, das: false, ls: false } });
  await openCharts(page);

  await expect(page.locator('.charts-ruleset')).toHaveText('2 deck · S17 · No DAS · No surrender');
});

test('a different ruleset renders a different chart, not a relabelled one', async ({ page }) => {
  // 6D H17 with surrender: hard 17 vs A is Rs, so the all-stand tail is 18+.
  await withProfile(page);
  await openCharts(page);
  await expect(rowLabels(page, 'HARD').first()).toHaveText('18+');

  // Drop surrender and the 17 row becomes all-stand, folding into a 17+ tail.
  await withProfile(page, { rules: { ls: false } });
  await openCharts(page);
  await expect(rowLabels(page, 'HARD').first()).toHaveText('17+');
});

test('row order defaults to descending and the toggle flips every section', async ({ page }) => {
  await withProfile(page);
  await openCharts(page);

  await expect(rowLabels(page, 'HARD').first()).toHaveText('18+');
  await expect(rowLabels(page, 'SOFT').first()).toHaveText('A,9-10');
  await expect(rowLabels(page, 'PAIRS').first()).toHaveText('A,A');

  await page.getByRole('button', { name: 'Lowest first', exact: true }).click();

  await expect(rowLabels(page, 'HARD').first()).toHaveText('4-8');
  await expect(rowLabels(page, 'SOFT').first()).toHaveText('A,2');
  await expect(rowLabels(page, 'PAIRS').first()).toHaveText('2,2');
});

test('the chosen row order survives a reload in its own storage key', async ({ page }) => {
  await withProfile(page);
  await openCharts(page);
  await page.getByRole('button', { name: 'Lowest first', exact: true }).click();
  await expect(rowLabels(page, 'HARD').first()).toHaveText('4-8');

  expect(await page.evaluate(() => window.localStorage.getItem('bjtrainer.chartOrder.v1'))).toBe('ascending');

  await openCharts(page);
  await expect(rowLabels(page, 'HARD').first()).toHaveText('4-8');
});

test('cells are colour-coded by action and always keep their letter', async ({ page }) => {
  await withProfile(page);
  await openCharts(page);

  const hard16 = page.locator('[data-section="HARD"] [data-row="HARD:16"]');
  await expect(hard16.locator('[data-up="2"]')).toHaveText('S');
  await expect(hard16.locator('[data-up="10"]')).toHaveText('Rh');

  // Different actions must not share a background -- colour carries the shape.
  const bg = (sel: string) =>
    page.locator(sel).evaluate((el) => window.getComputedStyle(el).backgroundColor);
  const stand = await bg('[data-section="HARD"] [data-row="HARD:16"] [data-up="2"]');
  const hit = await bg('[data-section="HARD"] [data-row="HARD:16"] [data-up="7"]');
  const surrender = await bg('[data-section="HARD"] [data-row="HARD:16"] [data-up="10"]');
  expect(new Set([stand, hit, surrender]).size).toBe(3);

  // The legend spells out every code, fallbacks included.
  await expect(page.locator('.chart-legend-item')).toHaveCount(8);
  await expect(page.locator('.chart-legend-item', { hasText: 'Dh' })).toContainText('Double if allowed, else hit');
  await expect(page.locator('.chart-legend-item', { hasText: 'Rp' })).toContainText(
    'Surrender if allowed, else split',
  );
});

/**
 * B4 / #24: every chart fits the phone. Measured per section at Jack's
 * iPhone 13 mini width: nothing scrolls sideways (page or grid), the ace
 * column sits inside the frame on screen, no row label is clipped, and the
 * codes stay at a legible size.
 */
async function expectGridsFit(page: Page, root: string): Promise<void> {
  const sections = await page.evaluate((rootSel) => {
    const d = document.documentElement;
    const scope = document.querySelector(rootSel)!;
    // The screen-reader caption is a 1px clipped box by design; skip it.
    const sideScrollers = [...scope.querySelectorAll('.charts-screen, .charts-screen *:not(.chart-caption)')].filter((el) => {
      const ox = getComputedStyle(el).overflowX;
      return el.scrollWidth > el.clientWidth + 1 && ox !== 'visible' && ox !== 'clip';
    });
    return {
      pageOverflow: d.scrollWidth - d.clientWidth,
      viewport: window.innerWidth,
      sideScrollers: sideScrollers.map((el) => el.className),
      list: [...scope.querySelectorAll('[data-section]')].map((sec) => {
        const frame = sec.querySelector('.chart-frame')!.getBoundingClientRect();
        const table = sec.querySelector('.chart-table')!.getBoundingClientRect();
        const ace = sec.querySelector('.chart-cell[data-up="A"]')!.getBoundingClientRect();
        const cell = sec.querySelector('.chart-cell')!;
        return {
          id: (sec as HTMLElement).dataset.section,
          frameLeft: frame.left,
          frameRight: frame.right,
          tableRight: table.right,
          aceRight: ace.right,
          aceWidth: ace.width,
          // The TEXT must sit inside its box. (Not scrollWidth: the ringed
          // cell's highlight ring deliberately overhangs its own box.)
          clipped: [...sec.querySelectorAll('.chart-rowlabel, .chart-corner, .chart-up, .chart-cell')]
            .filter((el) => {
              const range = document.createRange();
              range.selectNodeContents(el);
              const text = range.getBoundingClientRect();
              const box = el.getBoundingClientRect();
              return text.left < box.left - 0.5 || text.right > box.right + 0.5;
            })
            .map((el) => el.textContent),
          cellFont: parseFloat(getComputedStyle(cell).fontSize),
          labelFont: parseFloat(getComputedStyle(sec.querySelector('.chart-rowlabel')!).fontSize),
        };
      }),
    };
  }, root);

  expect(sections.pageOverflow, 'the page scrolls sideways').toBeLessThanOrEqual(1);
  expect(sections.sideScrollers, 'something on the chart scrolls sideways').toEqual([]);
  expect(sections.list.map((s) => s.id)).toEqual(['HARD', 'SOFT', 'PAIRS']);
  for (const s of sections.list) {
    // 16px gutters: the frame is 343 wide on a 375 screen.
    expect(s.frameLeft, `${s.id}: left gutter`).toBeGreaterThanOrEqual(16);
    expect(sections.viewport - s.frameRight, `${s.id}: right gutter`).toBeGreaterThanOrEqual(16);
    expect(s.tableRight, `${s.id}: the grid overruns its frame`).toBeLessThanOrEqual(s.frameRight);
    expect(s.aceRight, `${s.id}: the ace column is off the frame`).toBeLessThanOrEqual(s.frameRight);
    expect(s.aceWidth, `${s.id}: the ace column is squeezed`).toBeGreaterThanOrEqual(26);
    expect(s.clipped, `${s.id}: clipped text`).toEqual([]);
    expect(s.cellFont, `${s.id}: cell codes too small to read`).toBeGreaterThanOrEqual(11);
    expect(s.labelFont, `${s.id}: row labels too small to read`).toBeGreaterThanOrEqual(11);
  }
}

test.describe('at 375x812', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('B4: every chart section fits the width, with no sideways scroll and nothing clipped', async ({ page }) => {
    await withProfile(page);
    await openCharts(page);
    await expectGridsFit(page, 'body');
    // Every column is on screen at once: the ace cell of a mid-grid row is in
    // the viewport without any horizontal scrolling.
    const ace = page.locator('[data-section="HARD"] [data-row="HARD:16"] [data-up="A"]');
    await ace.scrollIntoViewIfNeeded();
    await expect(ace).toBeInViewport({ ratio: 1 });
  });

  test('B4: the study overlay fits the width too', async ({ page }) => {
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
    const buttons = page.locator('.action-bar button.action-btn:not([disabled])');
    let tone: 'ok' | 'miss' = 'ok';
    for (let i = 0; i < 12 && tone !== 'miss'; i += 1) tone = await answerAndReadStrip(page, buttons.first());
    expect(tone, 'no wrong answer in 12 cards').toBe('miss');
    await page
      .locator('[data-testid="result-strip"][data-tone="miss"]')
      .getByRole('button', { name: 'Show on chart', exact: true })
      .click();
    await expect(page.locator('.study-chart-overlay')).toBeVisible();
    await expectGridsFit(page, '.study-chart-overlay');
  });

  /**
   * #24: the mute disc sat in a transparent strip the page scrolled under, so
   * chart cells slid beneath it. On Charts it has a seat in a sticky, opaque
   * header bar: whatever the scroll position, the thing directly under the
   * disc is that bar, never a chart cell.
   */
  test('#24: the mute disc sits in the header bar, never over chart cells', async ({ page }) => {
    await withSettings(page, { audio: { enabled: true } });
    await withProfile(page);
    await openCharts(page);
    await expect(page.locator('.mute-btn')).toBeVisible();

    const underDisc = () =>
      page.evaluate(() => {
        const r = document.querySelector('.mute-btn')!.getBoundingClientRect();
        const bar = document.querySelector('.charts-topbar')!.getBoundingClientRect();
        // Every corner of the disc as well as its centre.
        const points = [
          [r.left + 2, r.top + 2],
          [r.right - 2, r.top + 2],
          [r.left + 2, r.bottom - 2],
          [r.right - 2, r.bottom - 2],
          [r.left + r.width / 2, r.top + r.height / 2],
        ];
        const beneath = points.map(([x, y]) => {
          const el = document.elementsFromPoint(x, y).find((e) => !e.closest('.mute-btn'));
          return el?.closest('.charts-topbar') ? 'bar' : String(el?.className ?? 'nothing');
        });
        return { beneath, inside: r.top >= bar.top - 0.5 && r.bottom <= bar.bottom + 0.5 };
      });

    const atRest = await underDisc();
    expect(atRest.beneath, 'top of the page: what the disc covers').toEqual(['bar', 'bar', 'bar', 'bar', 'bar']);
    expect(atRest.inside, 'top of the page: the disc sits within the header bar').toBe(true);

    for (const section of ['HARD', 'SOFT', 'PAIRS']) {
      // Scroll the section's grid up to where the disc is.
      await page.locator(`[data-section="${section}"] .chart-frame`).evaluate((el) => {
        window.scrollBy(0, el.getBoundingClientRect().top + 30);
      });
      const seen = await underDisc();
      expect(seen.beneath, `${section}: what the disc covers`).toEqual(['bar', 'bar', 'bar', 'bar', 'bar']);
      expect(seen.inside, `${section}: the disc sits within the header bar`).toBe(true);
    }
    // Back is still there at the bottom of the page: the bar is sticky.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('.charts-back-btn')).toBeInViewport({ ratio: 1 });
  });

  test('#24: the disc is not moved on other screens', async ({ page }) => {
    await withSettings(page, { audio: { enabled: true } });
    await page.goto('/?e2e=1');
    // Elsewhere it stays at the very top of its reserved strip (no status-bar
    // inset in a headless browser, so that is y = 0); only a chart nudges it
    // down to the centre of the header bar.
    const discTop = async () => (await page.locator('.mute-btn').boundingBox())!.y;
    expect(await discTop(), 'Home').toBe(0);
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await expect(page.locator('.drills-picker')).toBeVisible();
    expect(await discTop(), 'Drills').toBe(0);
    await page.getByRole('button', { name: 'Charts', exact: true }).click();
    await expect(page.locator('.charts-topbar')).toBeVisible();
    expect(await discTop(), 'Charts').toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
    await expect(page.locator('.drills-picker')).toBeVisible();
    expect(await discTop(), 'back on Drills').toBe(0);
  });
});

test('the highlight API opens on one ringed cell with its neighbours still visible', async ({ page }) => {
  await withProfile(page);
  await openCharts(page, '/?e2e=1&cell=HARD:16:9');

  const marked = page.locator('[data-highlight="true"]');
  await expect(marked).toHaveCount(1);
  await expect(marked).toHaveAttribute('data-up', '9');
  await expect(marked).toBeInViewport();

  // Anchoring is the whole point: the cells around it must still be readable.
  await expect(page.locator('[data-row="HARD:16"] [data-up="8"]')).toBeInViewport();
  await expect(page.locator('[data-row="HARD:16"] [data-up="10"]')).toBeInViewport();
  await expect(page.locator('[data-row="HARD:15"] [data-up="9"]')).toBeInViewport();
  await expect(page.locator('[data-row="HARD:17"] [data-up="9"]')).toBeInViewport();

  await shot(page, 'charts-highlight');
});

test('a highlight aimed at a total that was folded into a collapsed row still lands', async ({ page }) => {
  await withProfile(page);
  await openCharts(page, '/?e2e=1&cell=HARD:20:6');

  const marked = page.locator('[data-highlight="true"]');
  await expect(marked).toHaveCount(1);
  // Hard 20 lives inside the '18+' row.
  await expect(page.locator('[data-row="HARD:18"] [data-highlight="true"]')).toHaveCount(1);
});

test('a PAIRS highlight lands on the pair row', async ({ page }) => {
  await withProfile(page);
  await openCharts(page, '/?e2e=1&cell=PAIRS:8:A');

  const marked = page.locator('[data-highlight="true"]');
  await expect(marked).toHaveCount(1);
  await expect(page.locator('[data-row="PAIRS:8"] [data-highlight="true"]')).toHaveText('Rp');
});

// ---------------------------------------------------------------------------
// Deliverable: the two screenshots the operator asked for so they can pick a
// default row order. Both frame the HARD section under the same 390x844 phone
// viewport every other spec uses, so they are directly comparable.
// ---------------------------------------------------------------------------

async function captureOrder(page: Page, order: 'Descending' | 'Ascending', file: string): Promise<void> {
  await withProfile(page);
  await openCharts(page);
  await page
    .getByRole('button', { name: order === 'Descending' ? 'Highest first' : 'Lowest first', exact: true })
    .click();
  await expect(page.locator('[data-section="HARD"]')).toBeVisible();
  await expect(rowLabels(page, 'HARD').first()).toHaveText(order === 'Descending' ? '18+' : '4-8');

  // The phone viewport is 390x844 and the HARD section runs past the fold, so
  // a plain viewport shot would cut the bottom rows off -- exactly the rows
  // that differ between the two orders. Clip a full-page capture from the top
  // of the screen to the bottom of the HARD grid instead: same 390px layout,
  // just tall enough to show the whole thing being compared.
  const box = (await page.locator('[data-section="HARD"]').boundingBox())!;
  await page.screenshot({
    path: file,
    fullPage: true,
    clip: { x: 0, y: 0, width: 390, height: Math.ceil(box.y + box.height + 12) },
  });
}

test('screenshot: descending row order', async ({ page }) => {
  await captureOrder(page, 'Descending', 'docs/sources/chart-view-descending.png');
});

test('screenshot: ascending row order', async ({ page }) => {
  await captureOrder(page, 'Ascending', 'docs/sources/chart-view-ascending.png');
});
