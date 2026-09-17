import { test, expect } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * Produce-the-True-Count, eyes-free.
 *
 * This was the one voice drill with no eyes-free mode (operator, 2026-09-16),
 * and the reason it was left out is the interesting part: a third of the drill
 * is judging a discard tray, and a tray cannot be heard. The eyes-free version
 * STATES the depth and keeps the other two thirds -- holding a count through a
 * stream you cannot see, and converting it. Those are the parts that fail at a
 * table, and they are the parts a car can practise.
 */

const SETTINGS = {
  audio: { enabled: true, verbosity: 'results', answerPauseMs: 300 },
  drill: { countLengthCards: 4, countIntervalMs: 40, countGroup: 1 },
};

async function open(page: import('@playwright/test').Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Produce the True Count', exact: true }).click();
}

function spoken(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => window.__speechLog ?? []);
}

test('it reads the cards out and tells you the depth, because a tray cannot be heard', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await withSettings(page, SETTINGS);
  await open(page);

  await page.getByLabel('Eyes-free audio').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.getByRole('button', { name: 'I had it' })).toBeVisible({ timeout: 10_000 });
  const log = await spoken(page);

  // The cards were SAID. Without this the drill would be a silent wait.
  expect(log.some((l) => /king|queen|jack|ace|ten|nine|eight|seven|six|five|four|three|two/i.test(l))).toBe(true);
  // The depth was stated rather than drawn.
  expect(log.some((l) => /decks? remaining/i.test(l))).toBe(true);
  expect(log.some((l) => l.includes('True count'))).toBe(true);
  expect(log.some((l) => l.includes('Did you have it?'))).toBe(true);

  // And no tray is on screen to be squinted at.
  await expect(page.locator('.table-discard-tray')).toHaveCount(0);
});

test('a self-report is recorded, and states no produced value', async ({ page }) => {
  test.setTimeout(30_000);
  await withSettings(page, SETTINGS);
  await open(page);
  await page.getByLabel('Eyes-free audio').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await page.getByRole('button', { name: 'I missed it' }).click({ timeout: 10_000 });
  await expect(page.locator('.drill-result .result-wrong')).toBeVisible();
  await expect(page.locator('.result-detail')).toContainText('Self-reported');

  const history = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bjtrainer.stats.v1') ?? '{}');
    return (raw.produceTc?.history ?? []) as { produced?: number; correct: boolean }[];
  });
  expect(history).toHaveLength(1);
  expect(history[0]!.correct).toBe(false);
  // THE ASSERTION THAT MATTERS: no number was said, so none is stored. Writing
  // the right answer into `produced` would report every admitted miss as an
  // exact hit.
  expect(history[0]!.produced).toBeUndefined();
});

/**
 * Eyes-on, the tolerance exists because you READ a tray and could be half a
 * deck out. Told the depth outright, there is nothing to forgive -- and
 * grading a stated depth loosely would quietly mark a wrong conversion right.
 */
/**
 * What this can prove from the outside is that the tray and its band are GONE
 * -- that eyes-free is not merely the eyes-on drill with narration bolted on.
 * Whether the grader forgives a range is not observable here (submitting a
 * wrong count is wrong under either rule at most depths), so the rule itself
 * is tested directly: drills/produceTcDrill.test.ts, `produceTcSlack`.
 */
test('strict mode shows no tray and claims no accepted range', async ({ page }) => {
  test.setTimeout(60_000);
  // A ONE-DECK shoe dealt half down. This is the condition under which the
  // tray tolerance actually bites: with five decks left a half-deck misread
  // barely moves the quotient, so a test run there cannot tell an exact
  // grader from a forgiving one at all -- it would pass either way, which is
  // exactly what the first version of this test did.
  await withProfile(page, { rules: { decks: 1 } });
  await withSettings(page, {
    ...SETTINGS,
    drill: { ...SETTINGS.drill, countLengthCards: 26, depthResolution: 'half' },
  });
  await open(page);
  await page.getByLabel('Eyes-free audio').check();
  await page.getByLabel('Strict mode (entry, graded)').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  let rounds = 0;
  let offRounds = 0;
  // Submit zero every time and read back what the answer actually was. Any
  // round whose true count was not zero must be marked wrong -- with slack
  // applied, several of them would be marked right.
  for (let i = 0; i < 8; i++) {
    await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.table-discard-tray')).toHaveCount(0);
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.locator('.drill-result')).toBeVisible();

    const detail = await page.locator('.result-detail').innerText();
    const actual = Number(/true count was ([+-]?\d+)/i.exec(detail)?.[1] ?? 'NaN');
    expect(Number.isFinite(actual)).toBe(true);
    const wrong = (await page.locator('.result-wrong').count()) > 0;
    rounds++;
    if (actual !== 0) {
      offRounds++;
      expect(wrong, `true count ${actual} submitted as 0 must be wrong`).toBe(true);
    } else {
      expect(wrong).toBe(false);
    }
    // No band explanation either -- there is no band when nothing was estimated.
    expect(detail).not.toContain('either way');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }

  expect(rounds).toBe(8);
  // Vacuity guard: without this the whole loop passes on eight zero answers,
  // which would prove nothing about tolerance at all.
  expect(offRounds).toBeGreaterThan(0);
});

test('the wheel runs the whole thing, which is the point of it being eyes-free', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await withSettings(page, SETTINGS);
  await open(page);
  await page.getByLabel('Eyes-free audio').check();

  const press = async (c: 'forward' | 'back') => {
    expect(await page.evaluate((x) => window.__wheelPress?.(x) ?? false, c)).toBe(true);
  };

  await press('forward'); // Start
  await expect(page.getByRole('button', { name: 'I had it' })).toBeVisible({ timeout: 10_000 });
  await press('back'); // "I missed it"
  await expect(page.locator('.drill-result .result-wrong')).toBeVisible();
});

/**
 * The complaint that started this: "true count drill sucks currently, pretty
 * much the whole thing, especially the pausing, just not usable."
 *
 * Two separate faults were behind it, and this covers the second. The first
 * was the pause running concurrently with the question (audio/answerPause.ts).
 * This one is that the drill STOPPED after every question and waited to be
 * restarted -- one tap on screen, but in a car an indefinite silence that
 * looks exactly like the microphone having died.
 */
test('it keeps asking without being asked to', async ({ page }) => {
  test.setTimeout(60_000);
  await withSettings(page, SETTINGS);
  await open(page);
  await page.getByLabel('Eyes-free audio').check();
  await expect(page.getByLabel('Keep going (next question on its own)')).toBeChecked();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await page.getByRole('button', { name: 'I had it' }).click({ timeout: 10_000 });

  // No tap, no word, no wheel press: a second question arrives on its own.
  await expect(page.getByRole('button', { name: 'I had it' })).toBeVisible({ timeout: 20_000 });
  const log = await spoken(page);
  const asks = log.filter((l) => /Produce the true count/i.test(l)).length;
  expect(asks).toBeGreaterThan(1);
  // And it never told the operator to ask for what it was about to do anyway.
  expect(log.some((l) => /say yes/i.test(l))).toBe(false);
});

test('turning it off leaves the drill where it was', async ({ page }) => {
  test.setTimeout(60_000);
  await withSettings(page, SETTINGS);
  await open(page);
  await page.getByLabel('Eyes-free audio').check();
  await page.getByLabel('Keep going (next question on its own)').uncheck();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await page.getByRole('button', { name: 'I had it' }).click({ timeout: 10_000 });
  await expect(page.locator('.drill-result')).toBeVisible();

  // Vacuity guard for the test above: with the toggle off, the same wait
  // produces no second question.
  await page.waitForTimeout(6000);
  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
});
