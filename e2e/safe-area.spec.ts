import { test, expect } from '@playwright/test';

/**
 * Content must not run under the iPhone status bar.
 *
 * The PWA work set `viewport-fit=cover` and a `black-translucent` status bar,
 * which is what makes `env(safe-area-inset-*)` report real values -- and also
 * what lets the web view extend UNDER the clock. Nothing reserved that space,
 * so on an installed iPhone every screen's top bar sat beneath the status
 * bar: the operator's screenshot shows "Back to Home" with the time printed
 * through it.
 *
 * `env()` cannot be simulated from a test, which is exactly why the CSS reads
 * it once into `--safe-top`. These specs override that variable with a real
 * iPhone inset (47px on a 13 mini) and assert content actually moves -- so
 * the rule is verified rather than eyeballed.
 */

const INSET = 47;

test.use({ viewport: { width: 375, height: 812 } });

async function withInset(page: import('@playwright/test').Page): Promise<void> {
  await page.addStyleTag({ content: `:root { --safe-top: ${INSET}px; }` });
}

const SCREENS: [string, string][] = [
  ['Home', '.home-screen'],
  ['Charts', '.charts-screen'],
  ['Settings', '.settings-screen'],
];

for (const [tab, root] of SCREENS) {
  test(`${tab}: nothing paints under the status bar`, async ({ page }) => {
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expect(page.locator(root)).toBeVisible();
    await withInset(page);

    // Every element that owns text must start below the inset.
    const offenders = await page.evaluate((inset) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll('body *')) {
        for (const node of el.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent!.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          if (r.height === 0) continue;
          if (r.top < inset) {
            const cls = typeof el.className === 'string' && el.className ? el.className : el.tagName;
            out.push(`${cls} top=${Math.round(r.top)} "${node.textContent!.trim().slice(0, 30)}"`);
          }
        }
      }
      return [...new Set(out)];
    }, INSET);

    expect(offenders).toEqual([]);
  });
}

/**
 * Proof the specs above can fail: without the reservation, the same page at
 * the same inset DOES paint text in the status-bar strip. Without this, a
 * regression that removed the padding would still show an empty offender
 * list only if something else happened to be keeping content down.
 */
test('the check is discriminating: removing the reservation reintroduces the overlap', async ({
  page,
}) => {
  // Charts, because its topbar sits flush against the screen root -- this is
  // the exact screen from the operator's screenshot. (Home has generous top
  // padding of its own, so it would mask the regression and make this control
  // pass for the wrong reason.)
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.locator('.charts-screen')).toBeVisible();
  await page.addStyleTag({
    content: `:root { --safe-top: ${INSET}px; } .charts-screen { padding-top: 0 !important; }`,
  });

  const topMost = await page.evaluate(() => {
    let min = Infinity;
    for (const el of document.querySelectorAll('body *')) {
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.height > 0) min = Math.min(min, r.top);
      }
    }
    return min;
  });

  expect(topMost).toBeLessThan(INSET);
});
