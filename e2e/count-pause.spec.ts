import { test, expect, type Page } from '@playwright/test';
import { withSettings, openCountOptions, readStats } from './helpers';
import { RANKS } from '../src/engine/cards';
import { hiLoTag } from '../src/engine/count';
import { narrateCountAnswer, narrateRank } from '../src/audio/narrate';

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

/** Sets which spoken lines the e2e harness reports as unheard ('*' = all). */
async function unheard(page: Page, which: string | undefined): Promise<void> {
  await page.evaluate((w) => {
    (window as { __e2eSpeechUnheard?: string }).__e2eSpeechUnheard = w;
  }, which);
}

/** The card line last attempted before the hold (not "Paused." or the probe). */
async function lastCardLine(page: Page): Promise<string> {
  return page.evaluate(() => {
    const log = (window.__speechLog ?? []).filter((t) => t !== 'Paused.' && t !== 'Resuming.' && !t.startsWith('chime:'));
    return log[log.length - 1]!;
  });
}

async function startEyesFreeRun(page: Page): Promise<void> {
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full' },
    drill: { wheelMode: 'answer', countLengthCards: 12, countIntervalMs: 800, countGroup: 1 },
  });
  await openCountDrill(page);
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(progress(page)).toHaveText(/^2 \/ 12/);
}

/**
 * A12: a card that goes unheard (clip and live fallback both failed) holds
 * the run on that card, and resuming says it again -- marked "Again:", so
 * it is never counted twice -- instead of moving on.
 */
test('an unheard card holds the run, and resuming replays it marked "Again:"', async ({ page }) => {
  await startEyesFreeRun(page);
  await unheard(page, '*');
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible({ timeout: 5000 });
  const held = await cardNumber(page);
  const heldLine = await lastCardLine(page);
  await page.waitForTimeout(2400);
  expect(await cardNumber(page), 'a card was dealt past one nobody heard').toBe(held);

  // Only the probe stays unheard, so the wheel (not the probe) resumes it.
  await unheard(page, 'Resuming.');
  const spokenBefore = await page.evaluate(() => (window.__speechLog ?? []).length);
  await press(page, 'forward');
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeHidden();
  await expect.poll(() => page.evaluate((n) => (window.__speechLog ?? []).slice(n), spokenBefore)).toContain(`Again: ${heldLine}`);
  expect(await cardNumber(page)).toBe(held);
});

/**
 * Review of A12: the hold lifts by itself once audio is confirmed playing
 * again -- a short "Resuming." completes, then the card replays.
 */
test('an unheard hold lifts by itself once "Resuming." is heard', async ({ page }) => {
  await startEyesFreeRun(page);
  await unheard(page, '*');
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible({ timeout: 5000 });
  const held = await cardNumber(page);
  const heldLine = await lastCardLine(page);
  // Still failing: the probe goes unheard and the run stays held.
  await page.waitForTimeout(5000);
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible();

  const spokenBefore = await page.evaluate(() => (window.__speechLog ?? []).length);
  await unheard(page, undefined);
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeHidden({ timeout: 10_000 });
  const after = await page.evaluate((n) => (window.__speechLog ?? []).slice(n), spokenBefore);
  expect(after.indexOf('Resuming.'), 'no "Resuming." before the replay').toBeGreaterThanOrEqual(0);
  expect(after.indexOf(`Again: ${heldLine}`)).toBeGreaterThan(after.indexOf('Resuming.'));
  expect(await cardNumber(page)).toBe(held);
});

/**
 * A14: a pause that lands while an eyes-free card is being said cuts that
 * card off. Resuming says it again, marked "Again:", instead of dealing on
 * from it -- the cut card is still in the count, so skipping it left Jack
 * counting one card short and graded wrong.
 */
test('a pause that cuts an eyes-free card off mid-word says it again on resume', async ({ page }) => {
  test.setTimeout(45_000);
  const SAY_MS = 3000;
  // Every line takes SAY_MS to say, and each is timestamped as it starts.
  await page.addInitScript((sayMs) => {
    const w = window as unknown as { __e2eSpeechDelayMs: number; __speechLog: string[]; __speechAt: number[] };
    w.__e2eSpeechDelayMs = sayMs;
    const log: string[] = [];
    const at: number[] = [];
    log.push = (...items: string[]) => {
      for (let i = 0; i < items.length; i++) at.push(performance.now());
      return Array.prototype.push.apply(log, items);
    };
    w.__speechLog = log;
    w.__speechAt = at;
  }, SAY_MS);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 500 },
    drill: { wheelMode: 'answer', countLengthCards: 6, countIntervalMs: 100, countGroup: 1 },
  });
  await openCountDrill(page);
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(progress(page)).toHaveText(/^2 \/ 6/, { timeout: 10_000 });

  // Pause from inside the page, measuring there how far into the card it is,
  // so the runner's own latency cannot decide whether it landed mid-card.
  const { cut, intoCardMs, handled } = await page.evaluate(() => {
    const w = window as unknown as { __speechLog: string[]; __speechAt: number[] };
    const i = w.__speechLog.length - 1;
    const intoCardMs = performance.now() - w.__speechAt[i]!;
    const handled = window.__wheelPress?.('back') ?? false;
    return { cut: w.__speechLog[i]!, intoCardMs, handled };
  });
  expect(handled).toBe(true);
  expect(intoCardMs, 'the pause must land while the card is still being said').toBeLessThan(SAY_MS);
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible();

  // Fast from here on, so the run finishes.
  await page.evaluate(() => {
    (window as unknown as { __e2eSpeechDelayMs: number }).__e2eSpeechDelayMs = 1;
  });
  const before = await page.evaluate(() => (window.__speechLog ?? []).length);
  await press(page, 'forward');
  const prompt = "What's the running count?";
  await expect.poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 15_000 }).toContain(prompt);
  const all = await page.evaluate(() => window.__speechLog ?? []);
  const after = all.slice(before, all.indexOf(prompt)).filter((t) => t !== 'Paused.' && !t.startsWith('chime:'));
  expect(after[0], `resumed with ${JSON.stringify(after)}`).toBe(`Again: ${cut}`);
  // The cut card and the four after it: every card of the run is heard once.
  expect(after).toHaveLength(5);

  // And the cards heard add up to the count the app says.
  const tag = new Map(RANKS.map((r) => [narrateRank(r), hiLoTag(r)]));
  const earlier = all.slice(0, before).filter((t) => tag.has(t));
  expect(earlier.pop(), 'the last card said before the pause is the cut one').toBe(cut);
  const heard = [...earlier, ...after.map((t) => t.replace(/^Again: /, ''))];
  expect(heard).toHaveLength(6);
  const rc = heard.reduce((sum, word) => sum + tag.get(word)!, 0);
  await expect.poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 15_000 }).toContain(narrateCountAnswer(rc));
});
