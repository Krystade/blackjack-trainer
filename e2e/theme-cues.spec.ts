import { test, expect } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * s09 theme findings: the stored theme applies before the app's script runs
 * (no Midnight frame for a daylight user), theme-color follows the theme, and
 * "selected" is marked by more than text colour -- in Bone & Ink the active tab
 * and the selected segment were indistinguishable from their neighbours.
 */

test('a stored theme is on <html> before the app script has run', async ({ page }) => {
  await withSettings(page, { theme: 'bone-ink' });
  // Hold the app's entry module, so anything seen meanwhile came from the
  // document itself.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/src\/main\.tsx/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/?e2e=1', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.readyState !== 'loading');
  const early = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    color: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    rootRendered: (document.getElementById('root')?.childElementCount ?? 0) > 0,
  }));
  release();
  expect(early.rootRendered, 'the app rendered: the check ran too late to mean anything').toBe(false);
  expect(early.theme).toBe('bone-ink');
  expect(early.color).toBe('#f2ece0');
});

test('theme-color follows a theme picked in Settings', async ({ page }) => {
  await page.goto('/?e2e=1');
  const meta = page.locator('meta[name="theme-color"]');
  await expect(meta).toHaveAttribute('content', '#0d2318');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.locator('.theme-option[data-theme-id="bone-ink"]').click();
  await expect(meta).toHaveAttribute('content', '#f2ece0');
  await page.locator('.theme-option[data-theme-id="amoled-night"]').click();
  await expect(meta).toHaveAttribute('content', '#000000');
});

for (const theme of ['bone-ink', 'midnight-felt']) {
  test(`${theme}: the active tab and the selected segment carry a non-hue cue`, async ({ page }) => {
    await withSettings(page, { theme });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?e2e=1');
    await page.locator('.tab-bar').getByRole('button', { name: 'Charts' }).click();

    const tabCue = await page.evaluate(() => {
      const active = document.querySelector('.tab-btn-active')!;
      const other = document.querySelector('.tab-btn:not(.tab-btn-active)')!;
      const bar = getComputedStyle(active, '::before');
      return {
        activeWeight: Number(getComputedStyle(active).fontWeight),
        otherWeight: Number(getComputedStyle(other).fontWeight),
        barHeight: parseFloat(bar.height || '0'),
        barContent: bar.content,
      };
    });
    expect(tabCue.activeWeight).toBeGreaterThan(tabCue.otherWeight);
    expect(tabCue.barContent).not.toBe('none');
    expect(tabCue.barHeight).toBeGreaterThanOrEqual(2);

    // A segmented control: the gear sheet on Charts has Decks / Dealer soft 17.
    await page.getByRole('button', { name: /settings/i }).first().click();
    const seg = await page.evaluate(() => {
      const active = document.querySelector('.segmented-btn-active') as HTMLElement | null;
      const other = active?.parentElement?.querySelector('.segmented-btn:not(.segmented-btn-active)');
      if (!active || !other) return null;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const probe = document.createElement('div');
      probe.style.color = accent;
      document.body.appendChild(probe);
      const accentRgb = getComputedStyle(probe).color;
      probe.remove();
      return {
        activeBg: getComputedStyle(active).backgroundColor,
        otherBg: getComputedStyle(other).backgroundColor,
        accentRgb,
        activeWeight: Number(getComputedStyle(active).fontWeight),
      };
    });
    expect(seg, 'no segmented control found in the Charts gear sheet').not.toBeNull();
    expect(seg!.activeBg).toBe(seg!.accentRgb);
    expect(seg!.activeBg).not.toBe(seg!.otherBg);
    expect(seg!.activeWeight).toBeGreaterThanOrEqual(700);
  });
}

test('Bone & Ink: the mute disc stands out from the band behind it', async ({ page }) => {
  await withSettings(page, { theme: 'bone-ink', audio: { enabled: true } });
  await page.goto('/?e2e=1');
  const disc = await page.evaluate(() => {
    const el = document.querySelector('.mute-btn') as HTMLElement | null;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { opacity: Number(cs.opacity), border: cs.borderTopColor, bg: cs.backgroundColor };
  });
  expect(disc, 'mute disc not rendered').not.toBeNull();
  expect(disc!.opacity).toBe(1);
  // Not the near-invisible --line (#d8cdb8) ring on a #f2ece0 band.
  expect(disc!.border).not.toBe('rgb(216, 205, 184)');
});
