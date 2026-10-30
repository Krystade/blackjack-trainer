import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance, playRoundByAdvice } from './helpers';

/**
 * C-R10: the Play table at 375x812 with the notch insets (iPhone 13 mini).
 * (a) with a bet spread on, the bet bar (In/Out toggle and Deal) is fully on screen;
 * (b) with voice on, the voice strip does not push the action bar off screen;
 * (c) the count-check sheet may cover the felt, but the round banner stays
 *     readable or is repeated in the sheet.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const INSET = ':root { --safe-top: 47px; --safe-bottom: 34px; }';
const SHOTS = process.env.C_R10_SHOTS;

async function shotIf(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** The visible area inside the insets, and a box for each selector's elements. */
async function boxes(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const safe = (name: string) => {
      const probe = document.createElement('div');
      probe.style.height = `var(${name}, 0px)`;
      document.body.appendChild(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      return h;
    };
    return {
      bottomLimit: window.innerHeight - safe('--safe-bottom'),
      width: window.innerWidth,
      docH: document.documentElement.scrollHeight,
      els: [...document.querySelectorAll<HTMLElement>(sel)].map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.innerText.trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      }),
    };
  }, selector);
}

function expectOnScreen(b: Awaited<ReturnType<typeof boxes>>, what: string) {
  expect(b.els.length, `vacuity guard: ${what} exists`).toBeGreaterThan(0);
  for (const e of b.els) {
    expect(e.bottom, `${what} "${e.text}" bottom ${e.bottom} > ${b.bottomLimit} (page ${b.docH})`).toBeLessThanOrEqual(b.bottomLimit + 0.5);
    expect(e.top, `${what} "${e.text}" top`).toBeGreaterThanOrEqual(0);
    expect(e.left, `${what} "${e.text}" left`).toBeGreaterThanOrEqual(-0.5);
    expect(e.right, `${what} "${e.text}" right ${e.right} > ${b.width}`).toBeLessThanOrEqual(b.width + 0.5);
  }
}

async function withFakeRecognition(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      onstart: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      start(): void {
        setTimeout(() => {
          this.onstart?.();
          this.onaudiostart?.();
        }, 0);
      }
      stop(): void {
        this.onend?.();
      }
      abort(): void {
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
}

test('C-R10a: with a bet spread, the In/Out toggle and Deal are fully on screen inside the notch insets', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { betSpreadOn: true, countCheckEvery: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.addStyleTag({ content: INSET });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('group', { name: 'In or out' }).getByRole('button', { name: 'Out', exact: true })).toBeVisible();
  await shotIf(page, 'c-r10a-bet-bar');
  expectOnScreen(await boxes(page, '.action-bar-bet button'), 'bet bar button');
});

test('C-R10b: with voice on, the action bar stays on screen inside the notch insets', async ({ page }) => {
  await withFakeRecognition(page);
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { countCheckEvery: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.addStyleTag({ content: INSET });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.locator('.voice-btn').click();
  await expect(page.locator('.voice-status')).toBeVisible();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  await expect(page.locator('.action-bar[data-advice]')).toBeVisible();
  await shotIf(page, 'c-r10b-voice-actions');
  expectOnScreen(await boxes(page, '.action-bar[data-advice] button.action-btn'), 'action button');
  expectOnScreen(await boxes(page, '.voice-status'), 'voice strip');
});

test('C-R10c: the count-check sheet leaves the round banner readable, or repeats it', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 1, dealSpeedMs: 0 });
  await withProfile(page, { countCheckEvery: 1, countCheckAsk: 'running' });
  await page.goto('/?seed=4&e2e=1');
  await page.addStyleTag({ content: INSET });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  await playRoundByAdvice(page);
  const banner = page.locator('.round-banner').first();
  await expect(banner).toBeVisible();
  const bannerText = ((await banner.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  expect(bannerText.length, 'vacuity guard: the banner says something').toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  const sheet = page.locator('.bottom-sheet', { hasText: 'Running count?' });
  await expect(sheet).toBeVisible();
  await shotIf(page, 'c-r10c-count-sheet');
  // Readable: either the banner is not under the sheet (and on screen), or the
  // sheet carries the banner's text itself.
  const geometry = await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('.round-banner')!.getBoundingClientRect();
    const s = document.querySelector<HTMLElement>('.bottom-sheet')!.getBoundingClientRect();
    return { bannerTop: b.top, bannerBottom: b.bottom, sheetTop: s.top };
  });
  const sheetText = (await sheet.innerText()).replace(/\s+/g, ' ');
  const uncovered = geometry.bannerBottom <= geometry.sheetTop + 0.5 && geometry.bannerTop >= 0;
  expect(uncovered || sheetText.includes(bannerText), `banner "${bannerText}" covered: ${JSON.stringify(geometry)}`).toBe(true);
});

/**
 * D17: THE FELT'S BANNER IS NOT SLICED IN HALF BEHIND THE SHEET. The sheet
 * repeats the result in its own body (C-R10c), so the felt copy, cut through
 * its letters at the sheet's top edge, was pure noise. It is hidden (not
 * removed: specs and the layout still use its box) while the sheet carries
 * the banner, and comes back when the sheet closes.
 */
test('D17: the felt round banner is hidden while the count sheet repeats it', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 1, dealSpeedMs: 0 });
  await withProfile(page, { countCheckEvery: 1, countCheckAsk: 'running' });
  await page.goto('/?seed=4&e2e=1');
  await page.addStyleTag({ content: INSET });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  await playRoundByAdvice(page);
  const banner = page.locator('.round-banner').first();
  await expect(banner).toBeVisible();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.getByTestId('count-sheet-banner')).toBeVisible();
  await expect(banner).toHaveCSS('visibility', 'hidden');
  await expect(banner).toHaveCount(1);
});

/**
 * D-R10: the strip must not be cut off part way through a line. It used to
 * shrink and scroll inside itself; now every line it shows is whole.
 */
test('D-R10: with voice on, the voice strip shows whole lines, never one cut in half', async ({ page }) => {
  await withFakeRecognition(page);
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { countCheckEvery: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.addStyleTag({ content: INSET });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.locator('.voice-btn').click();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  await expect(page.locator('.action-bar[data-advice]')).toBeVisible();
  await shotIf(page, 'd-r10-voice-strip');
  const fit = await page.locator('.voice-status').evaluate((el) => {
    const strip = el.getBoundingClientRect();
    return {
      overflow: el.scrollHeight - el.clientHeight,
      // Every visible child line ends inside the strip's padding box.
      cut: [...el.children]
        .filter((c) => getComputedStyle(c).display !== 'none')
        .map((c) => ({ cls: c.className, bottom: c.getBoundingClientRect().bottom, limit: strip.bottom }))
        .filter((c) => c.bottom > c.limit + 0.5),
    };
  });
  expect(fit.overflow, 'the strip scrolls inside itself').toBeLessThanOrEqual(0);
  expect(fit.cut).toEqual([]);
  expectOnScreen(await boxes(page, '.action-bar[data-advice] button.action-btn'), 'action button');
});

/** D-R11: with the strip showing, the table is held to --app-h, not 100svh. */
test('D-R11: the voice-on table height follows --app-h', async ({ page }) => {
  await withFakeRecognition(page);
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { countCheckEvery: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.addStyleTag({ content: ':root { --app-h: 700px !important; }' });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.locator('.voice-btn').click();
  await expect(page.locator('.voice-status')).toBeVisible();
  const h = await page.locator('.table-screen').evaluate((el) => {
    const probe = document.createElement('div');
    probe.style.height = 'var(--chrome-top, 0px)';
    el.appendChild(probe);
    const chrome = probe.getBoundingClientRect().height;
    probe.remove();
    return { height: el.getBoundingClientRect().height, chrome };
  });
  expect(Math.abs(h.height - (700 - h.chrome))).toBeLessThanOrEqual(1);
});
