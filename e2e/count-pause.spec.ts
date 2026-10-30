import { test, expect, type Page } from '@playwright/test';
import { withSettings, openCountOptions, readStats } from './helpers';

/**
 * C-R2 (W11): pausing a count run.
 *
 * Back on the wheel while the cards are flashing pauses the run: "Paused" is
 * said and shown, no card advances, and forward resumes from the NEXT card.
 * The paused time is not part of the run's pace. The on-screen run gets the
 * same Pause / Resume control.
 */

const SHOTS = 'C:/Users/jackp/AppData/Local/Temp/claude/C--Users-jackp/5eb9dd98-f8da-490b-a046-a394be7c9a16/scratchpad/waveC/w-shots';

async function press(page: Page, command: 'forward' | 'back'): Promise<void> {
  const handled = await page.evaluate((c) => window.__wheelPress?.(c) ?? false, command);
  expect(handled, 'the press reached no screen').toBe(true);
}

async function openCountDrill(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await openCountOptions(page);
}

const progress = (page: Page) => page.locator('.count-flash-progress');

/** "3 / 12" -> 3 */
async function cardNumber(page: Page): Promise<number> {
  const text = await progress(page).innerText();
  return Number(/(\d+)\s*\/\s*\d+/.exec(text)![1]);
}

test('wheel back pauses a flashing run, forward resumes from the next card', async ({ page }) => {
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full' },
    drill: { wheelMode: 'answer', countLengthCards: 12, countIntervalMs: 800, countGroup: 1 },
  });
  await openCountDrill(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(progress(page)).toHaveText(/^2 \/ 12/);

  await press(page, 'back');
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible();
  const held = await cardNumber(page);
  await expect.poll(() => page.evaluate(() => window.__speechLog ?? [])).toContain('Paused.');
  // Three intervals: unpaused, at least two cards would have gone by.
  await page.waitForTimeout(2400);
  expect(await cardNumber(page), 'a card advanced while paused').toBe(held);

  await press(page, 'forward');
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeHidden();
  // From the next card, at once -- not after another full interval.
  await expect(progress(page)).toHaveText(new RegExp(`^${held + 1} / 12`), { timeout: 500 });
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
});

test('the on-screen Pause / Resume control, 44px, fits the phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await withSettings(page, {
    drill: { countLengthCards: 12, countIntervalMs: 800, countGroup: 1 },
  });
  await openCountDrill(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(progress(page)).toHaveText(/^1 \/ 12/);

  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await expect(pause).toBeVisible();
  const box = (await pause.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.y + box.height).toBeLessThanOrEqual(812);
  await pause.click();
  const held = await cardNumber(page);
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/c-r2-count-paused.png` });
  await page.waitForTimeout(2000);
  expect(await cardNumber(page)).toBe(held);

  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(progress(page)).toHaveText(new RegExp(`^${held + 1} / 12`), { timeout: 500 });
});

test('paused time is not part of a timed run', async ({ page }) => {
  await withSettings(page, {
    // Not adaptive: the pace is the 300ms asked for, not an earned tier's.
    drill: { countLengthCards: 5, countGroup: 1, countTimedStartMs: 300, timedAdaptive: false },
  });
  await openCountDrill(page);
  await page.getByLabel('Timed challenge (gets faster every card)').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-timed-badge')).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();

  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('.timed-result')).toBeVisible();
  const stats = (await readStats(page)) as { timedCount: { history: { elapsedMs: number }[] } };
  const row = stats.timedCount.history.at(-1)!;
  // Five cards at <= 300ms each is at most 1.5s; the 3s pause must not be in it.
  expect(row.elapsedMs).toBeLessThan(2000);
});

test('a run paused for over ten minutes is still paused', async ({ page }) => {
  await page.clock.install();
  await withSettings(page, {
    drill: { wheelMode: 'answer', countLengthCards: 12, countIntervalMs: 800, countGroup: 1 },
  });
  await openCountDrill(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(progress(page)).toHaveText(/^1 \/ 12/);
  await press(page, 'back');
  const held = await cardNumber(page);
  await page.clock.fastForward('11:00');
  await page.clock.runFor(2000);
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible();
  expect(await cardNumber(page)).toBe(held);
  await press(page, 'forward');
  await expect(progress(page)).toHaveText(new RegExp(`^${held + 1} / 12`));
});

/**
 * A12: a run that loses the page (a call, Siri, a screen lock) pauses
 * instead of dealing on into nothing, and says so again on return.
 */
test('a hidden page pauses a flashing run, and "Paused." is said on return', async ({ page }) => {
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full' },
    drill: { wheelMode: 'answer', countLengthCards: 12, countIntervalMs: 800, countGroup: 1 },
  });
  await openCountDrill(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(progress(page)).toHaveText(/^2 \/ 12/);

  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { get: () => s, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);

  await setVisibility('hidden');
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible();
  const held = await cardNumber(page);
  await page.waitForTimeout(2400);
  expect(await cardNumber(page), 'a card was dealt while the page was hidden').toBe(held);

  const before = await page.evaluate(() => (window.__speechLog ?? []).filter((t) => t === 'Paused.').length);
  await setVisibility('visible');
  await expect
    .poll(() => page.evaluate(() => (window.__speechLog ?? []).filter((t) => t === 'Paused.').length))
    .toBe(before + 1);
  // Still held: coming back does not resume by itself.
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible();
  expect(await cardNumber(page)).toBe(held);
});

/**
 * A12: a card that goes unheard (clip and live fallback both failed) holds
 * the run on that card, and resuming says it again instead of moving on.
 */
test('an unheard card holds the run, and resuming replays it', async ({ page }) => {
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full' },
    drill: { wheelMode: 'answer', countLengthCards: 12, countIntervalMs: 800, countGroup: 1 },
  });
  await openCountDrill(page);
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(progress(page)).toHaveText(/^2 \/ 12/);

  await page.evaluate(() => {
    (window as { __e2eSpeechUnheard?: string }).__e2eSpeechUnheard = '*';
  });
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible({ timeout: 5000 });
  const held = await cardNumber(page);
  await page.waitForTimeout(2400);
  expect(await cardNumber(page), 'a card was dealt past one nobody heard').toBe(held);

  await page.evaluate(() => {
    (window as { __e2eSpeechUnheard?: string }).__e2eSpeechUnheard = undefined;
  });
  const spokenBefore = await page.evaluate(() => (window.__speechLog ?? []).length);
  const heldLine = await page.evaluate(() => {
    const log = (window.__speechLog ?? []).filter((t) => t !== 'Paused.');
    return log[log.length - 1];
  });
  await press(page, 'forward');
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeHidden();
  // The same card, said again -- not the next one.
  await expect.poll(() => page.evaluate((n) => (window.__speechLog ?? []).slice(n), spokenBefore)).toContain(heldLine);
  expect(await cardNumber(page)).toBe(held);
});
