import { test, expect } from '@playwright/test';

/**
 * Horizontal-gutter regression (operator report, iPhone 13 mini).
 *
 * `.settings-note-row` shipped as a class with NO CSS rule at all, used in 20
 * places. Inside Settings/Drills it sits in a padded panel so it looked fine;
 * as a bare direct child of `.drill-screen` -- which has no horizontal padding
 * of its own, because its bottom action bar is deliberately full-bleed -- the
 * prompt text ran from the left edge of the screen to the right edge.
 *
 * These specs run at 375px (13 mini) rather than the 390px project default,
 * since that is the narrowest phone the app targets and the width the operator
 * reported on.
 */

const W = 375;
/** Text must never come within this many px of the viewport edge. */
const MIN_GUTTER = 8;

/**
 * Every run of rendered text whose INK comes within MIN_GUTTER of either
 * viewport edge.
 *
 * Measured with a Range over each text node rather than the element's border
 * box, because those answer different questions. `.quiz-tc` is full-bleed with
 * centred content: its box spans the screen while the glyphs sit in the
 * middle, which is fine and must not fail. What the operator reported -- and
 * what this catches -- is glyphs actually reaching the edge. Descendants of a
 * horizontally scrollable box are skipped, since the strategy charts scroll
 * sideways by design and their far cells are correctly outside the viewport.
 */
async function edgeFlushText(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate((minGutter) => {
    const scrollable = (el: Element): boolean => {
      for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth) return true;
      }
      return false;
    };
    const out: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (scrollable(el)) continue;
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left < minGutter || r.right > window.innerWidth - minGutter) {
          const cls = typeof el.className === 'string' && el.className ? el.className : el.tagName;
          out.push(`${cls} [${Math.round(r.left)}..${Math.round(r.right)}] "${node.textContent!.trim().slice(0, 40)}"`);
        }
      }
    }
    return [...new Set(out)];
  }, MIN_GUTTER);
}

test.use({ viewport: { width: W, height: 812 } });

const DRILLS = [
  'Pair Cancellation',
  'Count Drill',
  'Deck Estimation',
  'True Count Drill',
  'Produce the True Count',
  'Bet / Sit / Leave',
  'Downswing',
  'Deviation Quiz',
  'Flashcards',
];

for (const drill of DRILLS) {
  test(`${drill}: no text touches the screen edge at ${W}px`, async ({ page }) => {
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: drill, exact: true }).click();
    await expect(page.locator('.drill-screen, .flashcards-screen').first()).toBeVisible();
    expect(await edgeFlushText(page)).toEqual([]);
  });
}

for (const tab of ['Home', 'Play', 'Drills', 'Charts', 'Settings']) {
  test(`${tab} tab: no text touches the screen edge at ${W}px`, async ({ page }) => {
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: tab, exact: true }).click();
    expect(await edgeFlushText(page)).toEqual([]);
  });
}
