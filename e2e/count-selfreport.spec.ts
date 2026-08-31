import { test, expect } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * "There's 0 feedback on if I get the running count correct."
 *
 * Eyes-free is the driving mode, and eyes-free routed the count drill to an
 * honor-system self-check: it spoke the answer, recorded nothing, and ended
 * on "self-check, no grade recorded". Strict mode DID grade, but only through
 * keypad entry -- precisely what you cannot do at the wheel. So the one mode
 * built for the car was the one mode that never told you whether you were
 * right.
 *
 * The drill now asks, out loud, and takes a two-zone tap.
 */

async function startEyesFreeCountDrill(page: import('@playwright/test').Page): Promise<void> {
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 0 },
    drill: { countLengthCards: 4, countGroup: 1, countIntervalMs: 0, countManual: false },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

test('the eyes-free drill asks whether you had it', async ({ page }) => {
  await startEyesFreeCountDrill(page);

  const yes = page.getByRole('button', { name: 'I had it' });
  await expect(yes).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'I missed it' })).toBeVisible();
  // The answer is shown as well as spoken, for a glance at a red light.
  await expect(page.locator('.selfreport-question')).toContainText('The count was');
});

test('reporting a hit gives a verdict instead of "no grade recorded"', async ({ page }) => {
  await startEyesFreeCountDrill(page);
  await page.getByRole('button', { name: 'I had it' }).click({ timeout: 15_000 });

  const result = page.locator('.drill-result');
  await expect(result.locator('.result-correct')).toHaveText('Correct!');
  await expect(result).toContainText('recorded');
  await expect(result).not.toContainText('no grade recorded');
});

test('reporting a miss is graded as wrong', async ({ page }) => {
  await startEyesFreeCountDrill(page);
  await page.getByRole('button', { name: 'I missed it' }).click({ timeout: 15_000 });

  await expect(page.locator('.drill-result .result-wrong')).toHaveText('Wrong');
});

/**
 * The half that makes it more than cosmetic: an eyes-free run must reach
 * Stats, or the count history stays blind to every drill done in the car.
 */
test('a self-reported run is written to the count history', async ({ page }) => {
  await startEyesFreeCountDrill(page);

  const before = await page.evaluate(
    () =>
      JSON.parse(window.localStorage.getItem('bjtrainer.stats.v1') ?? '{}')?.countDrill?.history
        ?.length ?? 0,
  );

  await page.getByRole('button', { name: 'I had it' }).click({ timeout: 15_000 });
  await expect(page.locator('.drill-result')).toBeVisible();

  const after = await page.evaluate(
    () =>
      JSON.parse(window.localStorage.getItem('bjtrainer.stats.v1') ?? '{}')?.countDrill?.history ?? [],
  );
  expect(after.length).toBe(before + 1);
  expect(after.at(-1).correct).toBe(true);
});

/** The spoken half: eyes on the road means the verdict has to be audible. */
test('the question and the verdict are both spoken', async ({ page }) => {
  await startEyesFreeCountDrill(page);
  await page.getByRole('button', { name: 'I had it' }).click({ timeout: 15_000 });

  const spoken = await page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
  expect(spoken.join(' | ')).toContain('Did you have it?');
  expect(spoken.join(' | ')).toContain('Correct.');
});
