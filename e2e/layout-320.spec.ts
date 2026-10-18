import { test, expect, type Page } from '@playwright/test';
import { withStats } from './helpers';

/**
 * Wave I: the shell and Home at 320x693 as well as 375x812, with notch insets.
 *
 * Every other layout spec runs at 375 wide. 320 is iOS Display Zoom on a
 * mini (and an SE): the same phone with less room. Jack's screenshot of the
 * installed app showed the tab labels cut off at the bottom edge, a two-line
 * title beside a two-line profile pill, and the Next step reason squeezed
 * into a column beside Start.
 *
 * Insets come from `--safe-top` / `--safe-bottom` (primitives.css), which is
 * what every inset rule reads, because env() cannot be set from a test.
 */

const SIZES = [
  { width: 320, height: 693 },
  { width: 375, height: 812 },
] as const;
const TOP = 47;
const BOTTOM = 34;

/** Jack's shape: lots of answers from before per-hand tracking, none since. */
const STATS = {
  categories: {
    hard: { right: 400, wrong: 12 },
    soft: { right: 150, wrong: 6 },
    pairs: { right: 120, wrong: 3 },
    surrender: { right: 30, wrong: 1 },
    insurance: { right: 10, wrong: 0 },
    bet: { right: 0, wrong: 0 },
    countCheck: { right: 200, wrong: 5 },
    wong: { right: 0, wrong: 0 },
  },
  perIndex: { '16v10': { right: 3, wrong: 0 } },
  latencyHistory: Array.from({ length: 30 }, () => ({ category: 'countCheck', elapsedMs: 1400, correct: true })),
};

async function insets(page: Page): Promise<void> {
  await page.addInitScript(([t, b]) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = `:root { --safe-top: ${t}px !important; --safe-bottom: ${b}px !important; }`;
      document.head.appendChild(s);
    });
  }, [TOP, BOTTOM] as const);
}

/** How many lines an element's text runs to. */
function lines(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const tops = new Set<number>();
    for (const rect of r.getClientRects()) if (rect.width > 0 && rect.height > 0) tops.add(Math.round(rect.top));
    return tops.size;
  });
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const tab = (page: Page, name: string) =>
  page.locator('.tab-bar').getByRole('button', { name, exact: true }).click();

for (const size of SIZES) {
  const at = `${size.width}x${size.height}`;

  test.describe(at, () => {
    test.use({ viewport: size });

    test(`${at}: every tab label is whole and above the home indicator, on every tab screen`, async ({ page }) => {
      await withStats(page, STATS);
      await insets(page);
      await page.goto('/?e2e=1');
      for (const name of ['Home', 'Drills', 'Charts', 'Stats'] as const) {
        await tab(page, name);
        await expect(page.locator('.tab-bar [aria-current="page"]')).toContainText(name);
        const labels = await page.locator('.tab-label').evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { text: el.textContent, top: r.top, bottom: r.bottom, over: el.scrollWidth - el.clientWidth };
          }),
        );
        expect(labels).toHaveLength(5);
        for (const l of labels) {
          expect(l.bottom, `${name}: "${l.text}" runs into the home indicator`).toBeLessThanOrEqual(size.height - BOTTOM);
          expect(l.over, `${name}: "${l.text}" is clipped`).toBeLessThanOrEqual(0);
        }
        expect(await noSideScroll(page), `${name} scrolls sideways`).toBeLessThanOrEqual(0);
      }
    });

    test(`${at}: Home's head is one row: one-line title, one-line profile pill`, async ({ page }) => {
      await withStats(page, STATS);
      await insets(page);
      await page.goto('/?e2e=1');
      const chip = page.locator('.home-profile-chip');
      await expect(chip).toHaveText('Default (6D H17)');
      expect(await lines(page, '.home-title'), 'the title wraps').toBe(1);
      expect(await lines(page, '.home-profile-chip-name'), 'the profile pill wraps').toBe(1);
      const [title, pill, head] = await Promise.all(
        ['.home-title', '.home-profile-chip', '.home-head'].map(async (s) => (await page.locator(s).boundingBox())!),
      );
      expect(Math.abs(title!.y + title!.height / 2 - (pill!.y + pill!.height / 2)), 'title and pill share a row').toBeLessThan(4);
      expect(head!.height, 'the head is taller than one row').toBeLessThanOrEqual(48);
      expect(head!.y, 'the head starts under the status bar').toBeGreaterThanOrEqual(TOP);
      // Jack's own profile name fits whole at both widths.
      expect(await page.locator('.home-profile-chip-name').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    });

    test(`${at}: Next step's reason has the card's width and Start sits below it`, async ({ page }) => {
      await withStats(page, STATS);
      await insets(page);
      await page.goto('/?e2e=1');
      const card = page.getByRole('region', { name: 'Next step' });
      // The 0-answers line names the older answers, so it cannot read as lost history.
      await expect(card.locator('.next-step-why')).toContainText('earlier answers predate it');
      const [why, start, box] = [
        (await card.locator('.next-step-why').boundingBox())!,
        (await card.locator('.next-step-btn').boundingBox())!,
        (await card.boundingBox())!,
      ];
      const inner = await card.evaluate((el) => {
        const cs = getComputedStyle(el);
        return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      });
      expect(why.width, 'the reason is squeezed beside Start').toBeGreaterThanOrEqual(inner - 1);
      expect(start.y, 'Start sits beside the reason').toBeGreaterThanOrEqual(why.y + why.height - 1);
      expect(start.y + start.height, 'Start is below the fold').toBeLessThanOrEqual(size.height);
      expect(start.x + start.width).toBeLessThanOrEqual(box.x + box.width);

      // The rungs ahead are one compact line each; the current one keeps its 44px.
      const rows = await page.locator('.ladder-row').evaluateAll((els) =>
        els.map((el) => ({ state: el.getAttribute('data-state'), h: el.getBoundingClientRect().height })),
      );
      for (const r of rows) {
        if (r.state === 'current') expect(r.h).toBeGreaterThanOrEqual(44);
        else expect(r.h, 'a rung ahead is taller than one line').toBeLessThanOrEqual(40);
      }
    });

    test(`${at}: the readiness tiles are not clipped`, async ({ page }) => {
      await withStats(page, STATS);
      await insets(page);
      await page.goto('/?e2e=1');
      await page.locator('.readiness').scrollIntoViewIfNeeded();
      const panel = (await page.locator('.readiness').boundingBox())!;
      const tiles = await page.locator('.readiness-stat > *').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { text: el.textContent, left: r.left, right: r.right, over: el.scrollWidth - el.clientWidth };
        }),
      );
      expect(tiles).toHaveLength(6);
      for (const t of tiles) {
        expect(t.over, `"${t.text}" is clipped`).toBeLessThanOrEqual(0);
        expect(t.left, `"${t.text}" leaves the panel`).toBeGreaterThanOrEqual(panel.x);
        expect(t.right, `"${t.text}" leaves the panel`).toBeLessThanOrEqual(panel.x + panel.width);
      }
    });
  });
}

/**
 * The installed app's bar correction is measured, not assumed (viewportGap.ts).
 * Chromium cannot run standalone, so the phone's situation is staged: the app
 * believes it is standalone, and the stylesheet's assumed gap is the -50px
 * Jack's iPhone computed from `100svh - 100vh`. The fixed box here ends on
 * the screen edge, as it now does on iOS, so the measured gap is 0 and the
 * bar stays on screen. Applying the assumed -50px put the labels off it.
 */
test('the tab bar is not pushed off the screen by an assumed viewport gap', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q: string) =>
      q.includes('display-mode: standalone')
        ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList)
        : real(q);
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = ':root { --vp-gap: -50px; } .tab-bar { bottom: var(--vp-gap); }';
      document.head.appendChild(s);
    });
  });
  await page.goto('/?e2e=1');
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--vp-gap'))).toBe('0px');
  const bar = (await page.locator('.tab-bar').boundingBox())!;
  expect(bar.y + bar.height, 'the bar runs off the bottom of the screen').toBeLessThanOrEqual(812.5);
  for (const box of await page.locator('.tab-label').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom))) {
    expect(box).toBeLessThanOrEqual(812);
  }
});
