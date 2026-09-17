import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * The steering wheel, end to end.
 *
 * This is the input method that has to work with nobody looking at the screen,
 * and it is the one that cannot be exercised by clicking: a press arrives
 * through `navigator.mediaSession`, which only the car can send. Hence
 * `window.__wheelPress` (App.tsx), a seam present only under `?e2e=1`.
 *
 * What is being proven is the thing the 2026-09-16 report asked for: two
 * buttons, "next or prev", entering a running or true count with the
 * microphone shut -- because an open microphone flips the car to its
 * hands-free route and the wheel stops reaching the app at all.
 */

const READBACK_MS = 900;
const COMMIT_MS = 3000;

/**
 * Deliver presses in ONE round trip.
 *
 * Not a shortcut: a press per `page.evaluate` puts a browser round trip
 * between each one, and against a dev server under load those gaps have
 * exceeded the three-second commit window -- the entry submits half a count
 * and the remaining presses land on the result screen. That is a property of
 * the harness, not of the app (the same sequence through a built bundle
 * accumulates correctly either way), and a test that fails on it is measuring
 * Playwright. Spacing that MATTERS is tested explicitly below, with waits
 * chosen against the two delays rather than left to chance.
 */
async function press(page: Page, command: 'forward' | 'back', times = 1): Promise<void> {
  const handled = await page.evaluate(
    ({ c, n }) => {
      const results: boolean[] = [];
      for (let i = 0; i < n; i++) results.push(window.__wheelPress?.(c) ?? false);
      return results;
    },
    { c: command, n: times },
  );
  // Vacuity guard, and the one that matters most: a press that reached no
  // screen is silently a no-op, which is exactly what a broken wheel looks
  // like. Every test below would pass on an unclaimed wheel without this.
  expect(handled).toEqual(Array.from({ length: times }, () => true));
}

function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__speechLog ?? []);
}

async function openTrueCountDrill(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True Count Drill', exact: true }).click();
}

test('forward starts the drill', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openTrueCountDrill(page);

  await press(page, 'forward');
  await expect(page.getByText('Enter the true count')).toBeVisible();
});

/**
 * Back means "say it again" everywhere the drill is not waiting for a number.
 * While it IS waiting for one, back is minus one -- the number is what the
 * buttons are for at that moment, and there is no third button to hold both
 * meanings at once.
 */
test('back says the result again once the question is answered', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openTrueCountDrill(page);
  await press(page, 'forward'); // Start
  // One press, then silence: the proposal submits itself, which is how every
  // wheel answer is confirmed.
  await press(page, 'forward');
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 8000 });

  await page.evaluate(() => {
    window.__speechLog = [];
  });
  await press(page, 'back');
  await expect
    .poll(async () => (await spoken(page)).some((l) => l.includes('True count')))
    .toBe(true);
});

test('the two buttons walk a true count and quiet submits it', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openTrueCountDrill(page);
  await press(page, 'forward'); // Start

  // Four up, one back: the proposal is walked, not typed, and a correction is
  // just more pressing.
  await press(page, 'forward', 4);
  await press(page, 'back');

  // Nothing is submitted that has not been said first -- silence stands in for
  // the "yes" the voice path gets.
  await expect
    .poll(async () => await spoken(page), { timeout: 4000 })
    .toContain('plus 3. Correct?');
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('.result-detail')).toContainText('+3');
});

test('a press during the correction window pushes the submission back', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openTrueCountDrill(page);
  await press(page, 'forward');

  await press(page, 'forward', 2);
  // Long enough to have been read back, nowhere near long enough to submit.
  await page.waitForTimeout(READBACK_MS + 300);
  await expect(page.locator('.drill-result')).toHaveCount(0);

  await press(page, 'forward');
  await page.waitForTimeout(COMMIT_MS - 800);
  // Still open: the third press restarted the clock rather than arriving after
  // an answer had already been graded.
  await expect(page.locator('.drill-result')).toHaveCount(0);

  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('.result-detail')).toContainText('+3');
});

/**
 * "Did you have it?" is two outcomes, and the wheel has exactly two buttons.
 * This is the shape every eyes-free drill ends on, so getting the directions
 * the wrong way round would quietly record the opposite of what happened.
 */
test('on a self-check, forward is "I had it" and back is "I missed it"', async ({ page }) => {
  test.setTimeout(30_000);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'results', answerPauseMs: 300 },
  });
  await openTrueCountDrill(page);

  await page.getByLabel('Eyes-free audio').check();
  await press(page, 'forward'); // Start

  await expect(page.getByRole('button', { name: 'I missed it' })).toBeVisible({ timeout: 10_000 });
  await press(page, 'back');
  await expect(page.locator('.drill-result .result-wrong')).toBeVisible();
});

test('the count drill takes a running count from the wheel too', async ({ page }) => {
  test.setTimeout(30_000);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full' },
    drill: { countLengthCards: 4, countIntervalMs: 50, countGroup: 1 },
  });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await press(page, 'forward'); // Start

  await expect(page.getByText('Enter the running count')).toBeVisible({ timeout: 10_000 });
  await press(page, 'back', 2);

  await expect
    .poll(async () => await spoken(page), { timeout: 4000 })
    .toContain('minus 2. Correct?');
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 6000 });
});
