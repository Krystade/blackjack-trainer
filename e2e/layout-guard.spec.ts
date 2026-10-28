import { test, expect, type Locator, type Page } from '@playwright/test';
import { withSettings, withStats, openSettingsScreen, statsTab, shot, openCountOptions } from './helpers';

/**
 * Cross-cutting layout guards at 375x812 (iPhone 13 mini).
 *
 * 1. B1 (D3): the global mute control sits in each screen's top bar, not in a
 *    44px strip above every screen. On every screen, scrolled to the top and
 *    to the bottom, no control and no heading text may be visible under the
 *    disc, and no text may paint under the status bar. Run at no inset, at
 *    the 13 mini's 47px inset, and at 375x667 (Safari with its toolbars up,
 *    where the disc shrinks to 32px).
 * 2. Controls the operator hits one-handed are at least 44px in both axes.
 */
test.use({ viewport: { width: 375, height: 812 } });

const MUTE = '[data-testid~="mute-btn"]';

async function openDrill(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

const INTERACTIVE = 'button, input, select, textarea, a[href], [role="button"], [role="switch"], summary';
const HEADING = 'h1, h2, h3, [class*="heading"], [class*="title"]';

/** Controls or heading WORDS visible under the disc (topmost at the overlap). [] = clear. */
async function discOffenders(page: Page): Promise<string[]> {
  return page.evaluate(([MUTE_SEL, INT, HEAD]) => {
    const disc = document.querySelector(MUTE_SEL);
    if (!disc) return ['no mute button'];
    const d = disc.getBoundingClientRect();
    if (d.bottom <= 0) return []; // scrolled away with the top of the page (absolute mode)
    const visibleAt = (el: Element, x: number, y: number) => {
      const top = document.elementsFromPoint(x, y).find((e) => !e.closest(MUTE_SEL));
      return !!top && (top === el || el.contains(top));
    };
    const hit = (r: DOMRect) => {
      const l = Math.max(r.left, d.left), t = Math.max(r.top, d.top);
      const rr = Math.min(r.right, d.right), b = Math.min(r.bottom, d.bottom);
      return rr > l && b > t ? [(l + rr) / 2, (t + b) / 2] : null;
    };
    const out = new Set<string>();
    for (const el of document.querySelectorAll(INT)) {
      if (el.closest(MUTE_SEL)) continue;
      const p = hit(el.getBoundingClientRect());
      if (p && visibleAt(el, p[0]!, p[1]!)) out.add(`control ${el.tagName}.${el.className} "${(el.textContent ?? '').trim().slice(0, 24)}"`);
    }
    for (const el of document.querySelectorAll(HEAD)) {
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          const p = hit(r);
          if (p && visibleAt(el, p[0]!, p[1]!)) out.add(`heading .${el.className} "${node.textContent!.trim().slice(0, 24)}"`);
        }
      }
    }
    return [...out];
  }, [MUTE, INTERACTIVE, HEADING] as const);
}

/** Visible text painted above `inset` (the status bar). [] = clear. */
async function statusBarOffenders(page: Page, inset: number): Promise<string[]> {
  if (inset === 0) return [];
  return page.evaluate((inset) => {
    const out = new Set<string>();
    for (const el of document.querySelectorAll('body *')) {
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.height === 0 || r.bottom <= 0 || r.top >= inset) continue;
          const x = Math.min(Math.max(r.left + 2, 0), innerWidth - 1);
          // Probe INSIDE the band the text shares with the status bar: a line
          // box whose top edge dips under the strip by a fraction of a pixel
          // (the Drills picker scrolled to its end) used to be probed at
          // top + 1, below the strip, and read as uncovered.
          const y = (Math.max(r.top, 0) + Math.min(r.bottom, inset)) / 2;
          const top = document.elementsFromPoint(x, y)[0];
          if (top && (top === el || el.contains(top))) out.add(`${el.className || el.tagName} "${node.textContent!.trim().slice(0, 24)}"`);
        }
      }
    }
    return [...out];
  }, inset);
}

async function checkScreen(page: Page, name: string, inset: number): Promise<void> {
  for (const where of ['top', 'bottom'] as const) {
    if (where === 'bottom') {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    expect(await discOffenders(page), `${name} (${where}): under the mute control`).toEqual([]);
    expect(await statusBarOffenders(page, inset), `${name} (${where}): under the status bar`).toEqual([]);
    if (process.env.B1_SHOTS) await shot(page, `b1-${inset}-${name.replace(/\W+/g, '-')}-${where}`);
  }
}

const SEED = {
  cellStats: {
    'hard-16-v-10': { right: 30, wrong: 0, lastAt: '' },
    'soft-18-v-9': { right: 30, wrong: 0, lastAt: '' },
    'pair-8-v-A': { right: 30, wrong: 0, lastAt: '' },
  },
  masterySweepsCompleted: 1,
  countDrill: { history: Array.from({ length: 12 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 1, 10, i)).toISOString(), cards: 52, intervalMs: 700, correct: i % 3 !== 0 })) },
  sessions: [{ date: '2026-10-01T10:00:00.000Z', rounds: 40, graded: 60, correct: 55, bankrollDelta: -3 }],
};

const tab = (page: Page, name: string) => page.locator('.tab-bar').getByRole('button', { name, exact: true }).click();

/** Every screen at 375 wide. Task 2 appends the screens other lanes own. */
const SCREENS: { name: string; open: (page: Page) => Promise<void> }[] = [
  { name: 'Home', open: async () => {} },
  { name: 'Stats Play', open: async (p) => { await p.locator('.home-stats-link').click(); } },
  { name: 'Stats Drills', open: async (p) => { await p.locator('.home-stats-link').click(); await statsTab(p, 'Drills'); } },
  { name: 'Stats Over time', open: async (p) => { await p.locator('.home-stats-link').click(); await statsTab(p, 'Over time'); } },
  // Wave W: the You tab's other half, which has the same sticky bar now.
  // (The tab opens the half seen last, and Stats was just shown above.)
  { name: 'You Progress', open: async (p) => { await tab(p, 'You'); await p.getByTestId('you-seg-progress').click(); await expect(p.getByTestId('progress-screen')).toBeVisible(); } },
  { name: 'Settings', open: (p) => openSettingsScreen(p) },
  { name: 'Profiles', open: async (p) => { await p.locator('.home-profile-chip').click(); } },
  { name: 'Profile editor', open: async (p) => { await p.locator('.home-profile-chip').click(); await p.getByRole('button', { name: 'Edit', exact: true }).first().click(); } },
  { name: 'Test kit', open: async (p) => { await openSettingsScreen(p); await p.getByTestId('settings-testkit-open').click(); } },
  { name: 'Field test gate', open: async (p) => { await openSettingsScreen(p); await p.getByTestId('settings-testkit-open').click(); await p.getByTestId('fieldtest-open').click(); } },
  { name: 'Charts (from Home)', open: (p) => tab(p, 'Charts') },
];

const drill = (name: string, run?: (p: Page) => Promise<void>) => ({
  name: `Drill ${name}${run ? ' (running)' : ''}`,
  open: async (p: Page) => { await tab(p, 'Drills'); await p.getByRole('button', { name, exact: true }).click(); await expect(p.locator('.drill-topbar')).toBeVisible(); if (run) await run(p); },
});
const start = async (p: Page) => { await p.getByRole('button', { name: 'Start', exact: true }).click(); };
SCREENS.push(
  { name: 'Drills picker', open: (p) => tab(p, 'Drills') },
  drill('Flashcards'), drill('Deviation quiz'), drill('Mixed'), drill('Mastery challenge'), drill('Speed'),
  drill('Custom'), drill('Pair cancellation'), drill('Bet sizing'), drill('Rules differences'),
  drill('Count drill', openCountOptions), drill('Count drill', start),
  drill('True count drill', start), drill('Deck estimation', start), drill('Produce the true count', start),
  { name: 'Table (bet)', open: (p) => tab(p, 'Play') },
  { name: 'Table (dealt)', open: async (p) => { await tab(p, 'Play'); await p.getByRole('button', { name: 'Deal', exact: true }).click(); await expect(p.locator('.action-bar')).toBeVisible(); } },
  { name: 'Session report', open: async (p) => { await tab(p, 'Play'); await p.getByRole('button', { name: 'Deal', exact: true }).click(); await p.locator('.end-btn').click(); await p.locator('.end-btn').click(); await expect(p.locator('.report-screen')).toBeVisible(); } },
  { name: 'Charts (from Drills)', open: async (p) => { await tab(p, 'Drills'); await tab(p, 'Charts'); } },
  { name: 'Charts (from Settings)', open: async (p) => { await openSettingsScreen(p); await tab(p, 'Charts'); } },
);

for (const [label, inset, height] of [['inset 0', 0, 812], ['inset 47', 47, 812], ['short 667', 0, 667]] as const) {
  test(`B1: nothing under the mute control or the status bar, scrolled or not (${label})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 375, height });
    await withSettings(page, { audio: { enabled: true } });
    await withStats(page, SEED);
    if (inset > 0) {
      await page.addInitScript((px) => {
        document.addEventListener('DOMContentLoaded', () => {
          const s = document.createElement('style');
          s.textContent = `:root { --safe-top: ${px}px; }`;
          document.head.appendChild(s);
        });
      }, inset);
    }
    for (const s of SCREENS) {
      await page.goto('/?e2e=1&seed=4');
      await s.open(page);
      await checkScreen(page, s.name, inset);
    }
  });
}

test('B1: the 44px strip is gone; the reclaimed space is content', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1');
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingTop)).toBe('0px');
  const head = await page.locator('.home-head').boundingBox();
  expect(head!.y).toBeLessThan(44);
  for (const open of [() => page.locator('.home-stats-link').click(), () => openSettingsScreen(page)]) {
    await page.goto('/?e2e=1');
    await open();
    const bar = page.locator('.stats-topbar, .settings-topbar').first();
    const [b, d] = [await bar.boundingBox(), await page.locator(MUTE).boundingBox()];
    expect(d!.y, 'the disc sits inside the bar').toBeGreaterThanOrEqual(b!.y - 0.5);
    expect(d!.y + d!.height).toBeLessThanOrEqual(b!.y + b!.height + 0.5);
  }
});

/**
 * Home has no bar, so the disc must leave with the top of the page rather than
 * float over what scrolls up to it, and go under the status-bar strip as it
 * leaves rather than be drawn over the clock. The tour above cannot see either
 * yet: today's Home scrolls too little for anything it counts to reach the
 * disc. 375x667 at the 47px inset, where Home scrolls well past 30px.
 */
test('B1: with no bar, the disc scrolls away with the page and under the status bar (Home)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1');
  await page.addStyleTag({ content: ':root { --safe-top: 47px; }' });
  const disc = page.locator(MUTE);
  const before = (await disc.boundingBox())!;
  expect(before.y, 'at rest the disc sits below the status bar').toBeGreaterThanOrEqual(47);
  await page.evaluate(() => window.scrollTo(0, 30));
  expect(await page.evaluate(() => window.scrollY), 'Home must scroll for this to mean anything').toBe(30);
  const after = (await disc.boundingBox())!;
  expect(after.y, 'the disc moved up with the page').toBeCloseTo(before.y - 30, 0);
  expect(after.y, 'and is now partly inside the status bar').toBeLessThan(40);
  const onTopInStatusBar = await page.evaluate((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    return document.elementsFromPoint(r.left + r.width / 2, 40)[0]?.closest(sel) ? 'disc' : 'strip';
  }, MUTE);
  expect(onTopInStatusBar, 'what is on top where the disc meets the status bar').toBe('strip');
});

test('B1: the Custom editor palette sticks below the drill bar, not under it', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1');
  await tab(page, 'Drills');
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 900));
  const [bar, pal] = [await page.locator('.drill-topbar').boundingBox(), await page.locator('.cde-palette').boundingBox()];
  expect(pal!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
});

test('B1/s09: the Charts bar is one line from every origin; Back only where it goes somewhere', async ({ page }) => {
  await page.goto('/?e2e=1');
  const oneLine = (sel: string) => page.locator(sel).evaluate((el) => {
    const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects().length;
  });
  await tab(page, 'Charts');
  await expect(page.locator('.charts-heading')).toBeVisible();
  await expect(page.locator('.charts-back-btn')).toHaveCount(0);
  expect(await oneLine('.charts-heading')).toBe(1);
  for (const origin of ['Drills', 'Settings'] as const) {
    await page.goto('/?e2e=1');
    if (origin === 'Settings') await openSettingsScreen(page); else await tab(page, 'Drills');
    await tab(page, 'Charts');
    const back = page.locator('.charts-back-btn');
    await expect(back).toHaveText('Back');
    await expect(back).toHaveAccessibleName(`Back to ${origin}`);
    expect(await oneLine('.charts-back-btn')).toBe(1);
    expect(await oneLine('.charts-heading')).toBe(1);
    expect((await page.locator('.charts-topbar').boundingBox())!.height).toBeLessThanOrEqual(57);
  }
});

test('B1: Stats is a tab screen with no Back to Home', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await expect(page.getByTestId('you-seg-stats')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Back to Home' })).toHaveCount(0);
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
  // Wave I: the current rung keeps 44px; the rungs ahead are 36px single
  // lines (layoutFit.css), a full-width target with no neighbour to mis-hit.
  await tall('.ladder-row[data-state="current"]', 'Home ladder row (current)');
  for (const h of await page.locator('.ladder-row:not([data-state="current"])').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
    expect(h, 'Home ladder row (ahead) height').toBeGreaterThanOrEqual(36);
  }
  await tall('.next-step-btn', 'Home Start');
  await tall(MUTE, 'mute');

  // Stats tabs and range chips.
  await page.locator('.home-stats-link').click();
  // Wave O: lazy screens mount a moment after the click.
  await expect(page.locator('.stats-tab').first()).toBeVisible();
  await tall('.stats-tab', 'Stats tab');
  await tall('.stats-range-btn', 'Stats range chip');

  // Settings checkboxes.
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await tall('.settings-toggle', 'Settings checkbox');

  // Table HUD.
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // Wave O: lazy screens mount a moment after the click.
  await expect(page.locator('.table-screen')).toBeVisible();
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
  // Wave O: lazy screens mount a moment after the click.
    await expect(page.locator('.table-screen')).toBeVisible();
    await run('.table-discard-label');
    await run('.discard-tick-label');
    await run('.repeat-btn');
    await run('.voice-btn');
    const bad = checks.filter((c) => c.ratio < 4.5).map((c) => `${c.sel} ${c.ratio.toFixed(2)}`);
    expect(bad, `low contrast in ${theme}`).toEqual([]);
  });
}
