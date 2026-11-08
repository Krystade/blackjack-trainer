import { test, expect, type Page } from '@playwright/test';
import { withProfile, withSettings, withStats, readStats, openCountOptions } from './helpers';

/**
 * T2-2A: the count rung means table pace (a deck in 30 s, 576 ms a card), and
 * the pace ramp steps a beginner up to it, five steps from Easy first run's
 * 2000 ms, one step per held accuracy. The ramp is derived from history and
 * never writes Time per card -- that is also the eyes-free gap.
 *
 * Every run here is a real 52-card run on the page's fake clock, so the
 * pace each card is shown for is measured, not assumed.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

/** The fake clock starts here and is paused once setup is up, so time moves only by runFor. */
const T0 = new Date('2026-11-07T09:00:00Z');
const freeze = (page: Page) => page.clock.pauseAt(new Date(T0.getTime() + 60_000));

const day = (i: number) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString();
const row = (i: number, intervalMs: number, correct: boolean) => ({ date: day(i), cards: 52, intervalMs, correct });

async function openCount(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();
}

/** The Time per card stepper's own label (the ramp's note also mentions 'time per card'). */
const timePerCard = (page: Page) => page.locator('.settings-label', { hasText: /^Time per card$/ });

function tagOf(dataCard: string): number {
  const rank = dataCard.slice(0, -1);
  if (['2', '3', '4', '5', '6'].includes(rank)) return 1;
  if (['7', '8', '9'].includes(rank)) return 0;
  return -1;
}

async function enter(page: Page, n: number): Promise<void> {
  for (const d of String(Math.abs(n))) await page.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
  if (n < 0) await page.getByRole('button', { name: 'Plus or minus' }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
}

/**
 * Start, then step the fake clock through the lead-in and every card. Each
 * card is checked to be still up 100 ms before `perCardMs` and gone at it,
 * which is the pace actually dealt. Returns the running count.
 */
async function dealRun(page: Page, perCardMs: number): Promise<number> {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // The lead-in is up before the clock moves (Easy first run starts a render later).
  await expect(page.getByTestId('count-leadin')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.clock.runFor(600);
  const progress = page.locator('.count-flash-progress');
  let rc = 0;
  for (let i = 1; i <= 52; i++) {
    await expect(progress).toContainText(`${i} / 52`);
    const cards = await page.locator('.count-flash-cards .card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card') ?? ''));
    expect(cards).toHaveLength(1);
    rc += tagOf(cards[0]!);
    if (i === 1) {
      await page.clock.runFor(perCardMs - 100);
      await expect(progress).toContainText('1 / 52');
      await page.clock.runFor(100);
    } else {
      await page.clock.runFor(perCardMs);
    }
  }
  await expect(page.locator('.numpad')).toBeVisible();
  return rc;
}

test('the ramp deals at its step, not the stepper, and steps up once accuracy holds', async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: T0 });
  await withProfile(page);
  await withSettings(page, {
    drill: { countPaceRamp: true, countManual: false, countLengthCards: 52, countGroup: 1, countIntervalMs: 800 },
  });
  await withStats(page, { countDrill: { history: [row(0, 2000, true), row(1, 2000, true)] } });
  await openCount(page);
  await freeze(page);

  await expect(page.getByTestId('pace-ramp-status')).toHaveText(
    'Pace step 1 of 5 · 2000 ms a card. 1 more right run at this pace unlocks 1500 ms.',
  );
  await openCountOptions(page);
  // The ramp owns the visual pace: no Time per card stepper while it is on.
  await expect(page.getByTestId('pace-ramp-note')).toContainText('2000ms now');
  await expect(timePerCard(page)).toHaveCount(0);

  const rc = await dealRun(page, 2000);
  await enter(page, rc);
  await expect(page.locator('.result-correct')).toBeVisible();
  await expect(page.getByTestId('pace-ramp-result')).toHaveText('Pace up: the next run deals at 1500 ms a card (step 2 of 5).');
  // 2000 ms is not table pace, and the result says so.
  await expect(page.getByTestId('rung-miss')).toContainText('Too slow to count toward the step: 2000 ms a card.');

  const stats = (await readStats(page)) as { countDrill: { history: { intervalMs: number }[] } };
  expect(stats.countDrill.history.at(-1)!.intervalMs).toBe(2000);
  // Time per card itself was never written.
  const settings = await page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1')!));
  expect(settings.drill.countIntervalMs).toBe(800);

  await page.locator('.drill-back-btn').first().click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await expect(page.getByTestId('pace-ramp-status')).toHaveText(
    'Pace step 2 of 5 · 1500 ms a card. 3 more right runs at this pace unlock 1100 ms.',
  );
});

test('a right run at the old 800 ms default does not count toward table pace, and says why', async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: T0 });
  await withProfile(page);
  await withSettings(page, { drill: { countManual: false, countLengthCards: 52, countGroup: 1, countIntervalMs: 800 } });
  await withStats(page, { countDrill: { history: [row(0, 550, true)] } });
  await openCount(page);
  await freeze(page);
  // Ramp off (the default): no ramp line, the stepper is there.
  await expect(page.getByTestId('pace-ramp-status')).toHaveCount(0);

  const rc = await dealRun(page, 800);
  await enter(page, rc);
  await expect(page.locator('.result-correct')).toBeVisible();
  await expect(page.getByTestId('rung-miss')).toHaveText(
    'Too slow to count toward the step: 800 ms a card. Table pace is a deck in 30 s (576 ms a card): 500 ms or faster on the stepper.',
  );
  // The seeded table-pace run counts; this one does not.
  await expect(page.getByTestId('rung-progress')).toHaveText('Running count at table pace: 1/5 table-pace deck runs');
  await expect(page.getByTestId('pace-ramp-result')).toHaveCount(0);
});

test('a grouped ramp run deals the step a card: two cards for 4000 ms at step 1', async ({ page }) => {
  await page.clock.install({ time: T0 });
  await withProfile(page);
  await withSettings(page, {
    drill: { countPaceRamp: true, countManual: false, countLengthCards: 52, countGroup: 2, countIntervalMs: 800 },
  });
  await openCount(page);
  await freeze(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // The lead-in is up before the clock moves (Easy first run starts a render later).
  await expect(page.getByTestId('count-leadin')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.clock.runFor(600);
  const progress = page.locator('.count-flash-progress');
  await expect(progress).toContainText('1 / 26');
  await page.clock.runFor(3900);
  await expect(progress).toContainText('1 / 26');
  await page.clock.runFor(100);
  await expect(progress).toContainText('2 / 26');
});

test('the toggle swaps the stepper for the ramp; eyes-free keeps the stepper and has no ramp', async ({ page }) => {
  await withProfile(page);
  await withSettings(page, { drill: { countManual: false, countIntervalMs: 800 } });
  await openCount(page);
  await openCountOptions(page);
  const toggle = page.locator('label', { hasText: 'Step the pace up as I get it right' }).locator('input');
  await expect(toggle).not.toBeChecked();
  await expect(timePerCard(page)).toHaveCount(1);

  await toggle.check();
  await expect(page.getByTestId('pace-ramp-status')).toHaveText(
    'Pace step 1 of 5 · 2000 ms a card. 3 more right runs at this pace unlock 1500 ms.',
  );
  await expect(timePerCard(page)).toHaveCount(0);
  const settings = await page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1')!));
  expect(settings.drill.countPaceRamp).toBe(true);

  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await expect(page.getByTestId('pace-ramp-status')).toHaveCount(0);
  await expect(page.locator('label', { hasText: 'Step the pace up as I get it right' })).toHaveCount(0);
  await expect(timePerCard(page)).toHaveCount(1);
});

test('Easy first run turns the ramp on and deals at its first step', async ({ page }) => {
  await page.clock.install({ time: T0 });
  await withProfile(page);
  await openCount(page);
  await freeze(page);
  await page.getByRole('button', { name: 'Easy first run', exact: true }).click();
  // The lead-in is up before the clock moves (Easy first run starts a render later).
  await expect(page.getByTestId('count-leadin')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.clock.runFor(600);
  const progress = page.locator('.count-flash-progress');
  await expect(progress).toContainText('1 / 52');
  await page.clock.runFor(1900);
  await expect(progress).toContainText('1 / 52');
  await page.clock.runFor(100);
  await expect(progress).toContainText('2 / 52');
  const settings = await page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1')!));
  expect(settings.drill.countPaceRamp).toBe(true);
});

/**
 * T2#1/#6: an eyes-free Countdown run is judged on what it really took, not on
 * the gap after each spoken card -- and the car hears why it did not count.
 */
test('eyes-free Countdown records its measured pace, and says once that it was too slow', async ({ page }) => {
  test.setTimeout(90_000);
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 0 },
    drill: { countIntervalMs: 900, countManual: false },
  });
  await openCount(page);
  await openCountOptions(page);
  await page.locator('label', { hasText: 'Countdown' }).locator('input').check();
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.tag-guess')).toBeVisible({ timeout: 60_000 });
  await page.locator('.tag-guess-btn').first().click();
  await expect(page.locator('.drill-result')).toBeVisible();

  const stats = (await readStats(page)) as { countDrill: { history: { intervalMs: number; eyesFree?: boolean; elapsedMs?: number }[] } };
  const last = stats.countDrill.history.at(-1)!;
  expect(last.intervalMs).toBe(900);
  expect(last.eyesFree).toBe(true);
  // 51 cards each followed by a 900 ms gap: well over 576 ms a card.
  expect(last.elapsedMs! / 52).toBeGreaterThan(576);
  const said = await page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
  expect(said.filter((l) => l.startsWith('Too slow to count toward the table pace step.'))).toHaveLength(1);
});
