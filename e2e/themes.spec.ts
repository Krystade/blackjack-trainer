import { test, expect } from '@playwright/test';
import { withSettings } from './helpers';

/** C2: four selectable themes, defaulting to the pre-existing palette. */

test('defaults to Midnight Felt without touching the picker', async ({ page }) => {
  await page.goto('/?e2e=1');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight-felt');
});

test('picking a theme applies it, persists it, and survives a reload', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  await page.locator('.theme-option[data-theme-id="amoled-night"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'amoled-night');

  // The ground actually changed, not just the attribute.
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(0, 0, 0)');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'amoled-night');
});

test('a stored theme id that no longer exists falls back to the default', async ({ page }) => {
  // A build that drops a theme, or a hand-edited blob: an unknown value on
  // <html> selects no token block at all, leaving the app with no palette.
  await withSettings(page, { theme: 'vegas-neon' });
  await page.goto('/?e2e=1');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight-felt');
});

test('the light theme keeps text readable against its own ground', async ({ page }) => {
  // Bone & Ink is the only light theme, so it is where a token mapped for
  // dark grounds only would show up as invisible text.
  await withSettings(page, { theme: 'bone-ink' });
  await page.goto('/?e2e=1');
  const { bg, fg } = await page.evaluate(() => {
    const s = getComputedStyle(document.body);
    return { bg: s.backgroundColor, fg: s.color };
  });
  const lum = (c: string) => {
    const [r, g, b] = c.match(/\d+/g)!.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // Light ground, dark ink — inverted from every other theme.
  expect(lum(bg)).toBeGreaterThan(180);
  expect(lum(fg)).toBeLessThan(80);
});

/**
 * The readability spec above only inspects <body>, so it stayed green while
 * the Charts screen was rendering its own hardcoded dark palette on top of a
 * light app -- a light ground with a light tab bar and a dark green screen
 * between them, two themes on screen at once. `.charts-screen` declared its
 * own `--surface` / `--ink`, which SHADOW the theme tokens for that whole
 * subtree, so the theme switcher never reached it.
 *
 * Every screen, not just body, has to follow the selected theme.
 */
test('the Charts screen follows the theme instead of its own palette', async ({ page }) => {
  await withSettings(page, { theme: 'bone-ink' });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.locator('.charts-screen')).toBeVisible();

  const { bg, fg } = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.charts-screen')!);
    return { bg: s.getPropertyValue('--surface').trim(), fg: s.color };
  });

  const lum = (c: string) => {
    const nums = c.match(/\d+/g);
    if (c.startsWith('#')) {
      const h = c.slice(1);
      const n = parseInt(h.length === 3 ? h.replace(/./g, (d) => d + d) : h, 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    }
    const [r, g, b] = nums!.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  // Light surface, dark ink — matching the rest of the app in this theme.
  expect(lum(bg)).toBeGreaterThan(180);
  expect(lum(fg)).toBeLessThan(80);
});
