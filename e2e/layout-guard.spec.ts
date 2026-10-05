import { test, expect, type Locator, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * Cross-cutting layout guards at 375x812 (iPhone 13 mini).
 *
 * 1. The global mute button must never overlap a real control. It used to
 *    float bottom-left and covered Deal, Back to Home, the numpad minus key
 *    and the chip rows. It now lives in a strip the body reserves above every
 *    screen, so these specs measure boxes instead of trusting that.
 * 2. Controls the operator hits one-handed are at least 44px in both axes.
 */
test.use({ viewport: { width: 375, height: 812 } });

const MUTE = '[data-testid~="mute-btn"]';

/** Interactive elements the mute button's box intersects (should be none). */
async function muteOverlaps(page: Page): Promise<string[]> {
  await expect(page.locator(MUTE)).toBeVisible();
  return page.evaluate((sel) => {
    const m = document.querySelector(sel)!.getBoundingClientRect();
    const out: string[] = [];
    const els = document.querySelectorAll(
      'button, input, select, textarea, a[href], [role="button"], [role="switch"]',
    );
    for (const el of els) {
      if (el.matches(sel)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      const hit = m.left < r.right && r.left < m.right && m.top < r.bottom && r.top < m.bottom;
      if (hit) out.push(`${el.tagName}.${el.className} "${(el.textContent ?? '').trim().slice(0, 20)}"`);
    }
    return out;
  }, MUTE);
}

async function expectClear(page: Page, where: string): Promise<void> {
  expect(await muteOverlaps(page), `mute button overlaps a control on ${where}`).toEqual([]);
}

async function openDrill(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('mute button clears every control: Home, Table, drills', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true }, feedbackMode: 'test', countCheckEvery: 0 });
  await page.goto('/?seed=4&e2e=1');
  await expectClear(page, 'Home');

  // Table: bet screen, dealt, report.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expectClear(page, 'Table (bet)');
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.action-bar')).toBeVisible();
  await expectClear(page, 'Table (dealt)');
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-screen')).toBeVisible();
  await expectClear(page, 'Session report');
  await page.getByRole('button', { name: /Back to Home/ }).click();

  // True count drill numpad.
  await openDrill(page, 'True count drill');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible();
  await expectClear(page, 'True count numpad');

  // Deck estimation.
  await page.goto('/?e2e=1');
  await openDrill(page, 'Deck estimation');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.deck-guess-btn').first()).toBeVisible();
  await expectClear(page, 'Deck estimation');

  // Downswing.
  await page.goto('/?e2e=1');
  await openDrill(page, 'Downswing');
  await expectClear(page, 'Downswing (start)');
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expectClear(page, 'Downswing (dealt)');
});

test('mute button clears controls on the scrolling tab screens too', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1');
  for (const tab of ['Drills', 'Charts', 'Settings']) {
    await page.getByRole('button', { name: tab, exact: true }).first().click();
    await expectClear(page, tab);
  }
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await page.locator('.home-stats-link').click();
  await expectClear(page, 'Stats');
});

test('hit targets are at least 44px', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1');

  const tall = async (sel: string | Locator, label: string): Promise<void> => {
    const loc = typeof sel === 'string' ? page.locator(sel) : sel;
    expect(await loc.count(), `${label}: ${sel} not found`).toBeGreaterThan(0);
    const boxes = await loc.evaluateAll((els) =>
      els
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0)
        .map((r) => ({ w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 })),
    );
    for (const b of boxes) {
      expect(b.h, `${label} height`).toBeGreaterThanOrEqual(44);
      expect(b.w, `${label} width`).toBeGreaterThanOrEqual(44);
    }
  };

  await tall('.home-stats-link', 'Home All stats');
  await tall(MUTE, 'mute');

  // Stats tabs and range chips.
  await page.locator('.home-stats-link').click();
  await tall('.stats-tab', 'Stats tab');
  await tall('.stats-range-btn', 'Stats range chip');

  // Settings checkboxes.
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await tall('.settings-toggle', 'Settings checkbox');

  // Table HUD.
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await tall('.tc-peek-btn', 'Peek');
  await tall('.end-btn', 'End');
  await tall('.repeat-btn', 'Repeat');
  await tall('.voice-btn', 'Voice');

  // Profile Edit / Duplicate.
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');
  await tall(page.getByRole('button', { name: 'Edit', exact: true }), 'Profile Edit');
  await tall(page.getByRole('button', { name: 'Duplicate', exact: true }), 'Profile Duplicate');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await tall('.settings-toggle', 'Profile checkbox');
});

test('numpad has a side gutter', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openDrill(page, 'True count drill');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible();
  const box = await page.locator('.numpad-grid').boundingBox();
  const lbl = await page.locator('.numpad-label').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(16);
  expect(375 - (box!.x + box!.width)).toBeGreaterThanOrEqual(16);
  expect(lbl!.x).toBeGreaterThanOrEqual(16);
});

/* ---------- Contrast (WCAG AA, 4.5:1 for normal text) ---------- */

const THEMES = ['midnight-felt', 'bone-ink', 'amoled-night', 'slate-copper'];

/** Contrast of each matching element's text against its effective background. */
async function contrasts(page: Page, selector: string): Promise<{ sel: string; ratio: number }[]> {
  return page.evaluate((sel) => {
    const parse = (c: string): number[] => {
      const m = c.match(/[\d.]+/g)!.map(Number);
      return [m[0]!, m[1]!, m[2]!, m[3] ?? 1];
    };
    const lum = (c: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
    };
    // The theme's page ground, resolved through a probe element.
    const probe = document.createElement('i');
    probe.style.color = 'var(--bg)';
    document.body.appendChild(probe);
    const ground = parse(getComputedStyle(probe).color);
    probe.remove();
    const bgOf = (el: Element): number[] => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c[3]! > 0.95) return c;
      }
      return ground;
    };
    const out: { sel: string; ratio: number }[] = [];
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      const op = Number(cs.opacity);
      const bg = bgOf(el);
      const mixed = [0, 1, 2].map((i) => fg[i]! * op + bg[i]! * (1 - op));
      const [a, b] = [lum(mixed), lum(bg)];
      out.push({ sel, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) });
    }
    return out;
  }, selector);
}

for (const theme of THEMES) {
  test(`small labels reach 4.5:1 in ${theme}`, async ({ page }) => {
    await withSettings(page, { theme });
    await page.goto('/?e2e=1');
    const checks: { sel: string; ratio: number }[] = [];
    const run = async (sel: string) => {
      const r = await contrasts(page, sel);
      expect(r.length, `${sel} not found`).toBeGreaterThan(0);
      checks.push(...r);
    };
    await run('.readiness-label');
    await run('.home-build');
    await run('.tab-label');
    await page.getByRole('button', { name: 'Drills', exact: true }).first().click();
    await run('.drills-group-title');
    await page.getByRole('button', { name: 'Charts', exact: true }).first().click();
    await run('.charts-order-btn-active');
    await run('.charts-order-btn');
    await page.getByRole('button', { name: 'Home', exact: true }).first().click();
    await page.getByRole('button', { name: 'Play', exact: true }).first().click();
    await run('.table-discard-label');
    await run('.repeat-btn');
    await run('.voice-btn');
    const bad = checks.filter((c) => c.ratio < 4.5).map((c) => `${c.sel} ${c.ratio.toFixed(2)}`);
    expect(bad, `low contrast in ${theme}`).toEqual([]);
  });
}
