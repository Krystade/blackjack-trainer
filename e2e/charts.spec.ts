import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { answerAndReadStrip, shot, withProfile, withSettings } from './helpers';
import { indexList } from '../src/ui/screens/indexChart';
import { DEFAULT_RULES } from '../src/engine/ruleset';

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
/** Answer flashcards until one is wrong, then open its chart over the drill. */
async function openStudyOverlay(page: Page): Promise<void> {
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
}

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
    await openStudyOverlay(page);
    await expectGridsFit(page, '.study-chart-overlay');
  });

  test('#23: an open index note keeps the grid fitting the width', async ({ page }) => {
    await withProfile(page, { surrenderIndices: true });
    await openCharts(page);
    await page.locator('[data-row="HARD:16"] [data-up="9"] button').click();
    await expect(page.locator('[data-testid="chart-index-note"]')).toBeVisible();
    await expectGridsFit(page, 'body');
  });

  test('#23: the index markers and note work in the study overlay', async ({ page }) => {
    await openStudyOverlay(page);
    const overlay = page.locator('.study-chart-overlay');
    await expect(overlay.locator('.chart-cell[data-index="true"]').first()).toBeAttached();
    const cell = overlay.locator('[data-row="HARD:16"] [data-up="10"] button');
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    const note = overlay.locator('[data-testid="chart-index-note"]');
    await expect(note.locator('.index-item')).toHaveText('16 v 10 · TC ≥ 0 · Stand');
    await expectGridsFit(page, '.study-chart-overlay');
    // An outside tap closes the note and nothing else: the overlay stays.
    await overlay.locator('[data-section="HARD"] .chart-section-title').click();
    await expect(note).toHaveCount(0);
    await expect(overlay).toBeVisible();
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

/**
 * #23: the Indexes section. Its entries come from the same index set the
 * grader uses (indexChart.test.ts holds the shaping); what the browser proves
 * is that the profile reaches it -- the Fab 4 appear only when the profile
 * plays them AND the table offers surrender.
 */
test.describe('#23 indexes', () => {
  const items = (page: Page) => page.locator('[data-testid="chart-indexes"] .index-item');

  test('lists every graded index as hand, dealer, index and play', async ({ page }) => {
    await withProfile(page);
    await openCharts(page);
    const expected = indexList(DEFAULT_RULES);
    await expect(items(page)).toHaveText(expected.entries.map((e) => e.text));
    await expect(items(page).filter({ hasText: '16 v 10' })).toHaveText('16 v 10 · TC ≥ 0 · Stand');
    await expect(page.locator('[data-group="fab4"]')).toHaveCount(0);
    // H17 switches 11 v A off; the list says so rather than being one short.
    await expect(page.locator('[data-testid="chart-indexes"] .chart-section-note:not([data-testid])')).toHaveText(expected.inactive);
  });

  test('marks exactly the cells that carry an index, and nothing else', async ({ page }) => {
    await withProfile(page, { surrenderIndices: true });
    await openCharts(page);
    const marked = page.locator('.chart-cell[data-index="true"]');
    // One marker per cell; 16 v 9 holds two indexes (stand and surrender).
    const withCell = indexList({ ...DEFAULT_RULES, surrenderIndices: true }).entries.filter((e) => e.hardTotal !== null);
    const cells = new Set(withCell.map((e) => `${e.hardTotal}:${e.dealer}`));
    await expect(marked).toHaveCount(cells.size);
    await expect(page.locator('[data-section="SOFT"] [data-index="true"], [data-section="PAIRS"] [data-index="true"]')).toHaveCount(0);
    await expect(page.locator('[data-row="HARD:17"] [data-index="true"]')).toHaveCount(0);
    // A marked cell's text is still exactly its code.
    await expect(page.locator('[data-row="HARD:16"] [data-up="10"]')).toHaveText('Rh');
    await expect(page.locator('[data-row="HARD:16"] [data-up="10"]')).toHaveAttribute('data-index', 'true');
    // Only marked cells are controls.
    await expect(page.locator('.chart-cell:not([data-index]) button')).toHaveCount(0);
  });

  test('tapping a marked cell shows its index under the row, without covering cells', async ({ page }) => {
    await withProfile(page, { surrenderIndices: true });
    await openCharts(page);
    const note = page.locator('[data-testid="chart-index-note"]');
    await expect(note).toHaveCount(0);

    // An unmarked cell does nothing.
    await page.locator('[data-row="HARD:17"] [data-up="9"]').click();
    await expect(note).toHaveCount(0);

    const cell16v9 = page.locator('[data-row="HARD:16"] [data-up="9"] button');
    await cell16v9.click();
    await expect(cell16v9).toHaveAttribute('aria-expanded', 'true');
    // Both of 16 v 9's indexes, as the list writes them.
    const both = indexList({ ...DEFAULT_RULES, surrenderIndices: true }).entries.filter((e) => e.hardTotal === 16 && e.dealer === '9');
    expect(both.length).toBe(2);
    await expect(note.locator('.index-item')).toHaveText(both.map((e) => e.text));

    // An inline note: it sits between rows and overlaps no cell.
    const overlaps = await page.evaluate(() => {
      const n = document.querySelector('[data-testid="chart-index-note"]')!.getBoundingClientRect();
      return [...document.querySelectorAll('.chart-cell, .chart-rowlabel')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < n.right && r.right > n.left && r.top < n.bottom && r.bottom > n.top;
      }).length;
    });
    expect(overlaps).toBe(0);
    const noteBox = (await note.boundingBox())!;
    const row16 = (await page.locator('[data-row="HARD:16"]').boundingBox())!;
    const row15 = (await page.locator('[data-row="HARD:15"]').boundingBox())!;
    expect(noteBox.y).toBeGreaterThanOrEqual(row16.y + row16.height - 1);
    expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(row15.y + 1);

    // Another marked cell moves it; tapping that cell again closes it.
    const cell16v10 = page.locator('[data-row="HARD:16"] [data-up="10"] button');
    await cell16v10.click();
    await expect(note).toHaveCount(1);
    await expect(note.locator('.index-item')).toHaveText('16 v 10 · TC ≥ 0 · Stand');
    await expect(cell16v9).toHaveAttribute('aria-expanded', 'false');
    await cell16v10.click();
    await expect(note).toHaveCount(0);

    // A tap anywhere outside closes it.
    await cell16v10.click();
    await expect(note).toHaveCount(1);
    await page.locator('.charts-ruleset').click();
    await expect(note).toHaveCount(0);
  });

  test('the ringed cell still opens its index when it has one', async ({ page }) => {
    await withProfile(page);
    await openCharts(page, '/?e2e=1&cell=HARD:16:10');
    await expect(page.locator('[data-highlight="true"]')).toHaveAttribute('data-index', 'true');
    await page.locator('[data-row="HARD:16"] [data-up="10"] button').click({ timeout: 3000 });
    await expect(page.locator('[data-testid="chart-index-note"] .index-item')).toHaveText(
      '16 v 10 · TC ≥ 0 · Stand',
    );
  });

  test('the index note works from the keyboard', async ({ page }) => {
    await withProfile(page);
    await openCharts(page);
    const cell = page.locator('[data-row="HARD:12"] [data-up="4"] button');
    await cell.focus();
    await page.keyboard.press('Enter');
    const note = page.locator('[data-testid="chart-index-note"]');
    await expect(note).toHaveText('12 v 4 · TC ≤ −1 · Hit');
    await expect(cell).toHaveAttribute('aria-controls', (await note.getAttribute('id'))!);
    await page.keyboard.press('Escape');
    await expect(note).toHaveCount(0);
    await expect(cell).toBeFocused();
  });

  test('adds the Fab 4 when the profile plays them, and only with surrender on', async ({ page }) => {
    await withProfile(page, { surrenderIndices: true });
    await openCharts(page);
    const withFab = indexList({ ...DEFAULT_RULES, surrenderIndices: true });
    await expect(items(page)).toHaveText(withFab.entries.map((e) => e.text));
    await expect(page.locator('[data-group="fab4"] .index-item')).toHaveCount(
      withFab.entries.filter((e) => e.group === 'fab4').length,
    );

    await withProfile(page, { rules: { ls: false }, surrenderIndices: true });
    await openCharts(page);
    await expect(page.locator('[data-group="fab4"]')).toHaveCount(0);
  });

  test('an index on a surrender cell says surrender comes first', async ({ page }) => {
    await withProfile(page);
    await openCharts(page);
    // 16 v 10 is Rh: a two-card 16 surrenders at every count, so the stand
    // index is only the play once surrender is gone.
    await page.locator('[data-row="HARD:16"] [data-up="10"] button').click();
    await expect(page.locator('[data-testid="chart-index-surrender-first"]')).toContainText('The stand index');
    // 12 v 4 is a plain hit cell: no such line.
    await page.locator('[data-row="HARD:12"] [data-up="4"] button').click();
    await expect(page.locator('[data-testid="chart-index-note"]')).toHaveText('12 v 4 · TC ≤ −1 · Hit');
    await expect(page.locator('[data-testid="chart-index-surrender-first"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="chart-indexes-surrender-first"]')).toContainText('16 v 10');
  });

  test.describe('on a touch screen', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });

    test('scrolling with the note open keeps it; a tap outside closes it', async ({ page, context }) => {
      await withProfile(page);
      await openCharts(page);
      const cell = page.locator('[data-row="HARD:16"] [data-up="10"] button');
      await cell.scrollIntoViewIfNeeded();
      await cell.tap();
      const note = page.locator('[data-testid="chart-index-note"]');
      await expect(note).toHaveCount(1);

      // A real touch pan, started on an unmarked cell: the browser scrolls
      // and cancels the pointer, which is not a tap.
      const box = (await page.locator('[data-row="HARD:14"] [data-up="2"]').boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const before = await page.evaluate(() => window.scrollY);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 20 }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
      await expect(note).toHaveCount(1);

      await page.locator('[data-row="HARD:17"] [data-up="2"]').tap();
      await expect(note).toHaveCount(0);
    });
  });
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
