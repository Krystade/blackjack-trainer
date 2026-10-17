import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance, playRoundByAdvice } from './helpers';

/**
 * B2 #1: the count check's keypad must fit a 375x812 phone without scrolling
 * the page -- the minus key, 0 and delete were below the screen edge, so a
 * negative count meant scrolling first (with the notch inset, 1-3 too).
 * B2 #48: the report then opened scrolled down, its title under the status bar.
 */

test.use({ viewport: { width: 375, height: 812 } });

const INSET = ':root { --safe-top: 47px; --safe-bottom: 34px; }';

async function openCheck(page: Page, inset: boolean): Promise<void> {
  await withSettings(page, { countCheckEvery: 1, dealSpeedMs: 0 });
  await withProfile(page, { countCheckEvery: 1, countCheckAsk: 'running' });
  await page.goto('/?seed=4&e2e=1');
  if (inset) await page.addStyleTag({ content: INSET });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  await playRoundByAdvice(page);
}

/** Plays a dealt round, taking one non-advised action (as play-report.spec.ts). */
async function playRoundWithOneMistake(page: Page): Promise<void> {
  let mistaken = false;
  for (let guard = 0; guard < 30; guard++) {
    if (await resolveInsurance(page, false)) continue;
    const bar = page.locator('.action-bar[data-advice]');
    if (!(await bar.isVisible().catch(() => false))) return;
    const advice = (await bar.getAttribute('data-advice'))!;
    const enabled = bar.locator('button.action-btn:not([disabled])');
    if (!mistaken) {
      for (let i = 0; i < (await enabled.count()); i++) {
        if ((await enabled.nth(i).innerText()).trim().toLowerCase() !== advice) { mistaken = true; await enabled.nth(i).click(); break; }
      }
      if (mistaken) continue;
    }
    await bar.getByRole('button', { name: advice.charAt(0).toUpperCase() + advice.slice(1), exact: true }).click();
  }
  throw new Error('round did not settle');
}

/** Every keypad key's box against the visible viewport, measured without scrolling. */
async function keyBoxes(page: Page) {
  return page.evaluate(() => {
    const safe = (name: string) => {
      const probe = document.createElement('div');
      probe.style.height = `var(${name}, 0px)`;
      document.body.appendChild(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      return h;
    };
    const bottomLimit = window.innerHeight - safe('--safe-bottom');
    const keys = [...document.querySelectorAll<HTMLElement>('.bottom-sheet .numpad button')];
    return {
      bottomLimit,
      keys: keys.map((k) => {
        const r = k.getBoundingClientRect();
        return { label: (k.getAttribute('aria-label') ?? k.innerText).trim(), top: r.top, bottom: r.bottom };
      }),
    };
  });
}

for (const inset of [false, true]) {
  test(`B2 #1: the whole count keypad is on screen at 375x812${inset ? ' with the notch inset' : ''}`, async ({ page }) => {
    await openCheck(page, inset);
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await expect(page.locator('.bottom-sheet', { hasText: 'Running count?' })).toBeVisible();
    const { bottomLimit, keys } = await keyBoxes(page);
    expect(keys.length, 'vacuity guard: the keypad has its keys').toBeGreaterThanOrEqual(12);
    for (const k of keys) {
      expect(k.bottom, `${k.label} bottom ${k.bottom} > ${bottomLimit}`).toBeLessThanOrEqual(bottomLimit + 0.5);
      expect(k.top, `${k.label} top`).toBeGreaterThanOrEqual(0);
    }
  });
}

test('B2 #48: the report opens at its top after the End count check', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page, { gradeDeviations: false, countCheckEvery: 6, countCheckAsk: 'running' });
  await page.goto('/?seed=4&e2e=1');
  await page.addStyleTag({ content: INSET });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // Enough mistakes that the report is taller than the screen, so a carried
  // scroll would not simply be clamped away.
  for (let r = 0; r < 6; r++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await playRoundWithOneMistake(page);
  }
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  const sheet = page.locator('.bottom-sheet', { hasText: 'Running count?' });
  await expect(sheet).toBeVisible();
  // Whatever the sheet did to the page's scroll, the report must not inherit it.
  await page.evaluate(() => window.scrollTo(0, 120));
  for (const k of ['0', 'OK']) await sheet.getByRole('button', { name: k, exact: true }).click();
  await expect(page.locator('.report-screen')).toBeVisible();
  const tall = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(tall, 'vacuity guard: the report must be scrollable').toBeGreaterThan(120);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const h1 = await page.locator('.report-screen h1').evaluate((el) => el.getBoundingClientRect().top);
  expect(h1).toBeGreaterThanOrEqual(0);
});
