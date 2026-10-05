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
    content: `:root { --safe-top: ${INSET}px; } body { padding-top: 0 !important; } .charts-screen { padding-top: 0 !important; }`,
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

/**
 * ...INCLUDING THE FIELD TEST, which was the one full-screen root left out.
 *
 * It is not a tab, so the loop above could not reach it, and nobody added it
 * by hand — so `.fieldtest-screen` was missing from the `padding-top:
 * var(--safe-top)` list in primitives.css while every other root had it.
 * Measured on a running step at a 59px inset: the topbar occupied y=0..68 and
 * Pause y=10..58, entirely inside the status bar, with the step counter under
 * the battery. Pause is the only exit that keeps the run.
 *
 * Both screens of it: the gate is what an interrupted drive comes back to,
 * and the running screen is where the protocol is actually done.
 */
for (const where of ['gate', 'running'] as const) {
  test(`Field test (${where}): nothing paints under the status bar`, async ({ page }) => {
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Settings' }).first().click();
    await page.getByTestId('settings-testkit-open').click();
    await page.getByTestId('fieldtest-open').click();
    await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
    if (where === 'running') {
      const start = page.getByTestId('fieldtest-start');
      await start.click();
      if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
      await expect(page.getByTestId('fieldtest-title')).toBeVisible();
    }
    await withInset(page);

    const offenders = await page.evaluate((inset) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll('body *')) {
        for (const node of el.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent!.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          if (r.height > 0 && r.top < inset) {
            out.push(`${el.tagName.toLowerCase()} "${node.textContent!.trim().slice(0, 40)}"`);
          }
        }
      }
      return [...new Set(out)];
    }, INSET);

    expect(offenders, 'text is printed under the status bar').toEqual([]);

    // AND THE CONTROL ITSELF, not only its text: Pause is a 48px target whose
    // top half was inside the inset, where the system takes the touch.
    if (where === 'running') {
      const box = await page.getByTestId('fieldtest-pause').boundingBox();
      expect(box, 'Pause is not on the screen at all').toBeTruthy();
      expect(box!.y, 'the Pause button starts inside the status bar').toBeGreaterThanOrEqual(INSET);
    }
  });
}

/**
 * ...and that check can fail. Same page, same inset, reservation removed.
 */
test('the field-test check is discriminating', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('settings-testkit-open').click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  await page.addStyleTag({
    content: `:root { --safe-top: ${INSET}px; } body { padding-top: 0 !important; } .fieldtest-screen { padding-top: 0 !important; }`,
  });
  const topMost = await page.evaluate(() => {
    let min = Infinity;
    for (const el of document.querySelectorAll('.fieldtest-screen *')) {
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
  expect(topMost, 'without the reservation nothing sat in the inset either').toBeLessThan(INSET);
});
