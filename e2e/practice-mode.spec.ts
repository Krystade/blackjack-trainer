import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * Practice only: the mode that asks for nothing back.
 *
 * Asked for on 2026-09-16: "a no interaction mode where it just gives some
 * time to say the counts but then will [sovereignly] continue without
 * detecting an answer and state the correct answer after a pause just for
 * practice".
 *
 * Every other eyes-free path in this app needs SOMETHING back -- a word, a
 * zone, a wheel press -- and each of those can fail in a car, at which point
 * the drill stops dead in a silence indistinguishable from a dead microphone.
 * This mode asks for nothing, so nothing can fail. What is asserted here is
 * the pair of properties that make it that: it keeps going untouched, and it
 * records nothing while doing so.
 */

function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__speechLog ?? []);
}

async function historyLengths(page: Page): Promise<{ count: number; trueCount: number }> {
  return page.evaluate(() => {
    const stats = JSON.parse(window.localStorage.getItem('bjtrainer.stats.v1') ?? '{}');
    return {
      count: stats?.count?.history?.length ?? 0,
      trueCount: stats?.trueCount?.history?.length ?? 0,
    };
  });
}

async function openDrill(page: Page, name: string): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

const FAST_AUDIO = { enabled: true, verbosity: 'full' as const, answerPauseMs: 0, rate: 2 };

test('the true-count drill asks, answers and asks again, untouched', async ({ page }) => {
  await withSettings(page, { audio: FAST_AUDIO });
  await openDrill(page, 'True Count Drill');

  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.locator('label', { hasText: 'Practice only' }).locator('input').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.getByTestId('tc-practice')).toBeVisible();

  // Two full cycles with no input of any kind. A question, its answer, and
  // then a SECOND question -- the third utterance is the property: the drill
  // moved on by itself.
  await expect
    .poll(async () => (await spoken(page)).filter((s) => /decks remaining/i.test(s)).length, {
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(2);

  const said = await spoken(page);
  expect(said.some((s) => /true count/i.test(s)), 'no answer was ever stated').toBe(true);
  // ...and it never asked for a report it was not going to get.
  expect(said.join(' | ')).not.toContain('Did you have it?');
});

test('practice records nothing, which is what makes it practice', async ({ page }) => {
  await withSettings(page, { audio: FAST_AUDIO });
  await openDrill(page, 'True Count Drill');

  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.locator('label', { hasText: 'Practice only' }).locator('input').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect
    .poll(async () => (await spoken(page)).filter((s) => /decks remaining/i.test(s)).length, {
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(2);

  // Two questions have been asked and answered. A self-report nobody gave
  // would be a fabricated result, so there must be no rows at all.
  expect((await historyLengths(page)).trueCount).toBe(0);
});

test('the count drill practises the same way', async ({ page }) => {
  await withSettings(page, {
    audio: FAST_AUDIO,
    drill: { countLengthCards: 4, countGroup: 1, countIntervalMs: 0, countManual: false },
  });
  await openDrill(page, 'Count Drill');

  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.locator('label', { hasText: 'Practice only' }).locator('input').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.getByTestId('count-practice')).toBeVisible({ timeout: 15_000 });
  // The ANSWER, counted specifically. "running count" also matches the
  // question, so counting that would pass on a drill that asked three times
  // and never once said what the count was.
  await expect
    .poll(async () => (await spoken(page)).filter((s) => /^The count is/.test(s)).length, {
      timeout: 25_000,
    })
    .toBeGreaterThanOrEqual(2);
  // ...and it asked again after answering, which is the untouched loop.
  expect((await spoken(page)).filter((s) => /What's the running count\?/.test(s)).length)
    .toBeGreaterThanOrEqual(2);

  expect((await historyLengths(page)).count).toBe(0);
});

/**
 * The toggle is only offered where it means something. Strict mode is keypad
 * entry and graded; a "no answer needed" checkbox beside it would be offering
 * two contradictory things at once.
 */
test('practice is not offered alongside strict mode', async ({ page }) => {
  await withSettings(page, { audio: FAST_AUDIO });
  await openDrill(page, 'True Count Drill');

  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await expect(page.locator('label', { hasText: 'Practice only' })).toBeVisible();

  await page.locator('label', { hasText: 'Strict mode' }).locator('input').check();
  await expect(page.locator('label', { hasText: 'Practice only' })).toHaveCount(0);
});
