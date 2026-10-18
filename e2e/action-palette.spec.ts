import { test, expect, type Page } from '@playwright/test';
import { resolveInsurance, withProfile, withSettings } from './helpers';
import { worstContrast } from './contrast';

/**
 * F8 (W2-19, D4): ONE action palette. Charts, the Custom painter and the
 * mistake card's cell all read themes.css --act-* (fill + its own ink), so the
 * same decision is the same colour wherever it is drawn -- and every one of
 * those surfaces is AA in all four themes.
 *
 * The equality checks compare COMPUTED colours across screens, so a surface
 * that kept a palette of its own (the painter's old brown surrender, the
 * mistake card's gold cell) fails here rather than only looking different.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const THEMES = ['midnight-felt', 'bone-ink', 'amoled-night', 'slate-copper'] as const;
const SHOTS = process.env.SHOT_DIR ?? 'e2e/screenshots';
const UPS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'] as const;

/** iPhone 13 mini notch insets, as the layout specs set them. */
async function notch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const add = () => {
      const s = document.createElement('style');
      s.textContent = ':root{--safe-top:47px !important;--safe-bottom:34px !important}';
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  });
}

/** Computed fill and ink of every cell in hard 12 on Charts (6D H17: H H S S S H H H H H). */
async function chartRow12(page: Page) {
  return rgbOf(page, '[data-section="HARD"] tr[data-row="HARD:12"] .chart-cell');
}

/**
 * Fill and ink of every match as 8-bit sRGB. A colour-mix() at 100% computes
 * as oklab(...) while a plain token computes as rgb(...), so both are painted
 * onto a canvas and read back: the comparison is of the pixels, not of how
 * the browser chose to serialise them.
 */
async function rgbOf(page: Page, sel: string) {
  return page.locator(sel).evaluateAll((els) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const px = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(',');
    };
    return els.map((el) => ({ bg: px(getComputedStyle(el).backgroundColor), ink: px(getComputedStyle(el).color) }));
  });
}

async function openPainter(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Custom drill');
}

/** Paint a whole painter row with a brush through its row-label button. */
async function paintRow(page: Page, brush: 'Focus' | 'Regular' | 'Rare' | 'Off', label: string) {
  await page.getByRole('radio', { name: brush }).click();
  await page.getByRole('button', { name: `Paint the ${label} row`, exact: true }).click();
}

for (const theme of THEMES) {
  test(`F8: ${theme}: a Focus painter cell is exactly the Charts cell, and both pass AA`, async ({ page }) => {
    await withSettings(page, { theme });
    await withProfile(page);
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Charts', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const chart = await chartRow12(page);
    expect(chart).toHaveLength(10);
    // Hit and stand are different families here, so the comparison below
    // cannot pass on one colour painted everywhere.
    expect(chart[0]!.bg).not.toBe(chart[2]!.bg);
    const chartAA = await worstContrast(page, '.chart-table .chart-cell');
    expect(chartAA, `${theme} chart cells ${chartAA.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);

    await openPainter(page);
    await paintRow(page, 'Focus', '12');
    const painted = await rgbOf(page, '[data-row="hard-12"] .cpg-cell');
    expect(painted).toEqual(chart);

    // Every tier's code is AA on its own cell: Focus, Regular, Rare and Off,
    // across hit, stand, double, split and surrender rows.
    await paintRow(page, 'Rare', '11');
    await paintRow(page, 'Off', '10');
    await paintRow(page, 'Rare', '16');
    await paintRow(page, 'Focus', '15');
    for (const tier of ['focus', 'regular', 'rare', 'off']) {
      const sel = `.cpg-cell[data-tier="${tier}"] .cpg-code`;
      const r = await worstContrast(page, sel);
      expect(r, `${theme} painter ${tier} ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

for (const theme of THEMES) {
  test(`F8: ${theme}: the mistake card's cell wears its action's fill and ink`, async ({ page }) => {
    await withSettings(page, { theme, feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0 });
    await withProfile(page, { seats: { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 } });
    let reached = false;
    for (let seed = 1; seed < 31 && !reached; seed++) {
      await page.goto(`/?seed=${seed}&e2e=1`);
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await page.getByRole('button', { name: 'Deal', exact: true }).click();
      await resolveInsurance(page, false);
      reached = await page.locator('.action-bar[data-advice]').isVisible().catch(() => false);
    }
    expect(reached).toBe(true);
    const bar = page.locator('.action-bar[data-advice]');
    const advice = await bar.getAttribute('data-advice');
    const enabled = bar.locator('button.action-btn:not([disabled])');
    for (let i = 0; i < (await enabled.count()); i++) {
      if ((await enabled.nth(i).innerText()).trim().toLowerCase() !== advice) {
        await enabled.nth(i).click();
        break;
      }
    }
    const cell = page.locator('.wrong-play-sheet .mistake-cell');
    await expect(cell).toBeVisible();
    const act = (await cell.getAttribute('data-act'))!;
    expect(act).toBe(advice);
    const got = await cell.evaluate((el, family) => {
      const probe = (v: string) => {
        const p = document.createElement('div');
        p.style.color = v;
        document.body.appendChild(p);
        const c = getComputedStyle(p).color;
        p.remove();
        return c;
      };
      return {
        bg: getComputedStyle(el).backgroundColor,
        ink: getComputedStyle(el).color,
        wantBg: probe(`var(--act-${family})`),
        wantInk: probe(`var(--act-${family}-ink)`),
        accent: probe('var(--accent)'),
      };
    }, act);
    expect(got.bg).toBe(got.wantBg);
    expect(got.ink).toBe(got.wantInk);
    expect(got.bg).not.toBe(got.accent);
    const r = await worstContrast(page, '.wrong-play-sheet .mistake-cell');
    expect(r, `${theme} mistake cell ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
}

for (const theme of ['midnight-felt', 'bone-ink'] as const) {
  test(`F8 screenshots: Charts and the painter at 375x812 with notch insets in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await notch(page);
    await withSettings(page, { theme });
    await withProfile(page);
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Charts', exact: true }).click();
    await page.locator('[data-section="HARD"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/f8-charts-${theme}.png` });
    await openPainter(page);
    await paintRow(page, 'Focus', '12');
    await paintRow(page, 'Rare', '11');
    await paintRow(page, 'Off', '10');
    await page.locator('[data-row="hard-12"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/f8-painter-${theme}.png` });
    for (const up of UPS) await expect(page.locator(`[data-cell="hard-12-v-${up}"]`)).toHaveAttribute('data-tier', 'focus');
  });
}
