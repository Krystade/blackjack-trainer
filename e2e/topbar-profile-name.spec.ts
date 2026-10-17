import { test, expect } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * F28: the Play topbar's profile name rendered at 9.5px and 65% opacity --
 * 3.21:1 in Bone & Ink, unreadable in sunlight. It must be at least 12px,
 * fully opaque, and AA (4.5:1) against the bar in every theme.
 */

function luminance([r, g, b]: number[]): number {
  const c = [r!, g!, b!].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

for (const theme of ['bone-ink', 'midnight-felt', 'amoled-night', 'slate-copper']) {
  test(`${theme}: the profile name under the bankroll is readable`, async ({ page }) => {
    await withProfile(page, { name: 'Local 2D S17' });
    await withSettings(page, { theme });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?e2e=1');
    await page.locator('.tab-bar').getByRole('button', { name: 'Play' }).click();
    const name = page.locator('.topbar-profile-name');
    await expect(name).toHaveText('Local 2D S17');

    const got = await name.evaluate((el) => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
      let bgEl: Element | null = el;
      let bg = [0, 0, 0, 0];
      while (bgEl) {
        bg = parse(getComputedStyle(bgEl).backgroundColor);
        if (bg.length === 3 || (bg[3] ?? 0) > 0.9) break;
        bgEl = bgEl.parentElement;
      }
      let opacity = 1;
      for (let e: Element | null = el; e; e = e.parentElement) {
        opacity *= Number(getComputedStyle(e).opacity);
      }
      const cs = getComputedStyle(el);
      return { fontPx: parseFloat(cs.fontSize), color: parse(cs.color), bg, opacity };
    });
    expect(got.fontPx).toBeGreaterThanOrEqual(12);
    expect(got.opacity).toBe(1);
    const [l1, l2] = [luminance(got.color), luminance(got.bg)].sort((a, b) => b - a);
    const ratio = (l1! + 0.05) / (l2! + 0.05);
    expect(ratio, `contrast ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
}
