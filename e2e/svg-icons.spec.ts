import { test, expect, type Locator, type Page } from '@playwright/test';
import { withSettings } from './helpers';
import { worstContrast } from './contrast';

/**
 * G4 (L-6): the mute disc and the tab gears draw an inline SVG in
 * currentColor, not an emoji. Same names, same pressed state, same 44px
 * target; and the icon takes the button's ink, so it reads in every theme.
 */
test.use({ viewport: { width: 375, height: 812 } });

const MUTE = '[data-testid~="mute-btn"]';
const tab = (page: Page, name: string) => page.locator('.tab-bar').getByRole('button', { name, exact: true }).click();

/** Everything a pictograph would leave behind: any text, and any emoji code point. */
async function iconFacts(btn: Locator) {
  return btn.evaluate((el) => {
    const svg = el.querySelector('svg');
    const b = el.getBoundingClientRect();
    const s = svg?.getBoundingClientRect();
    const painted = svg ? [...svg.querySelectorAll('path')].map((p) => {
      const cs = getComputedStyle(p);
      return cs.fill !== 'none' ? cs.fill : cs.stroke;
    }) : [];
    return {
      text: el.textContent ?? '',
      emoji: /\p{Extended_Pictographic}/u.test(el.textContent ?? ''),
      svgs: el.querySelectorAll('svg').length,
      hidden: svg?.getAttribute('aria-hidden'),
      icon: svg?.getAttribute('data-icon'),
      color: getComputedStyle(el).color,
      painted,
      w: b.width,
      h: b.height,
      iconW: s?.width ?? 0,
      dx: s ? Math.abs(s.left + s.width / 2 - (b.left + b.width / 2)) : 99,
      dy: s ? Math.abs(s.top + s.height / 2 - (b.top + b.height / 2)) : 99,
    };
  });
}

function expectIcon(f: Awaited<ReturnType<typeof iconFacts>>, icon: string) {
  expect(f.text.trim(), 'no text (the emoji is gone)').toBe('');
  expect(f.emoji).toBe(false);
  expect(f.svgs).toBe(1);
  expect(f.hidden).toBe('true');
  expect(f.icon).toBe(icon);
  // currentColor: every painted part is the button's own colour.
  expect(f.painted.length).toBeGreaterThan(0);
  for (const c of f.painted) expect(c).toBe(f.color);
  expect(f.w).toBeGreaterThanOrEqual(44);
  expect(f.h).toBeGreaterThanOrEqual(44);
  expect(f.iconW, 'drawn at about the old glyph size').toBeGreaterThanOrEqual(18);
  expect(f.iconW).toBeLessThanOrEqual(28);
  expect(f.dx, 'centred across').toBeLessThanOrEqual(1);
  expect(f.dy, 'centred down').toBeLessThanOrEqual(1);
}

test('mute: an SVG speaker, name and pressed state unchanged, crossed out when muted', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1');
  const btn = page.locator(MUTE);
  await expect(btn).toHaveAccessibleName('Mute');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  expectIcon(await iconFacts(btn), 'speaker');

  await btn.click();
  const on = page.locator('[data-testid~="mute-btn-on"]');
  await expect(on).toHaveAccessibleName('Unmute');
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  const muted = await iconFacts(on);
  expectIcon(muted, 'speaker-muted');
  // The muted state's red ring and ink reach the icon too.
  const bad = await page.evaluate(() => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--bad)';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(muted.color).toBe(bad);
});

for (const [name, open] of [
  ['Play', (p: Page) => tab(p, 'Play')],
  ['Drills', (p: Page) => tab(p, 'Drills')],
  ['Charts', (p: Page) => tab(p, 'Charts')],
] as const) {
  test(`${name} gear: an SVG cog, accessible name unchanged`, async ({ page }) => {
    await page.goto('/?e2e=1');
    await open(page);
    const gear = page.getByTestId(`tab-gear-${name.toLowerCase()}`);
    await expect(gear).toHaveAccessibleName(`${name} settings`);
    await expect(gear).toHaveAttribute('aria-expanded', 'false');
    expectIcon(await iconFacts(gear), 'gear');
    await gear.click();
    await expect(page.getByRole('dialog', { name: `${name} settings` })).toBeVisible();
  });
}

for (const theme of ['midnight-felt', 'bone-ink', 'amoled-night', 'slate-copper']) {
  test(`${theme}: both icons clear 3:1 against their disc`, async ({ page }) => {
    await withSettings(page, { theme, audio: { enabled: true } });
    await page.goto('/?e2e=1');
    await tab(page, 'Drills');
    // Non-text graphics: WCAG 1.4.11 asks 3:1.
    expect(await worstContrast(page, '.mute-btn'), 'mute').toBeGreaterThanOrEqual(3);
    expect(await worstContrast(page, '.tab-gear'), 'gear').toBeGreaterThanOrEqual(3);
    await page.locator(MUTE).click();
    expect(await worstContrast(page, '.mute-btn'), 'muted').toBeGreaterThanOrEqual(3);
  });
}
