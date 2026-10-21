import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, withStats, readStats, resolveInsurance, statsTab } from './helpers';

/**
 * F5 (W2-17): Play decisions are timed, Stats > Play shows the table's median
 * decision time, and the optional dealer-pace clock draws a bar, never plays
 * the hand, and tags slow decisions for the report.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const INSET = ':root { --safe-top: 47px; --safe-bottom: 34px; }';
const SHOTS = process.env.WAVE_F_B_SHOTS;

type DecisionRow = { elapsedMs: number; date?: string; slow?: true };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

async function openPlay(page: Page, seed = 4): Promise<void> {
  await page.goto(`/?seed=${seed}&e2e=1`);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // The table is a lazy chunk: wait for it, so an absence asserted next is
  // about the table and not about a Home screen that has not been replaced.
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
}

/** Plays the dealt round by the advice; `holdFirstMs` waits before the first decision. */
async function playRound(page: Page, holdFirstMs = 0): Promise<number> {
  let decisions = 0;
  for (let guard = 0; guard < 30; guard++) {
    if (await resolveInsurance(page, false)) continue;
    const bar = page.locator('.action-bar[data-advice]');
    if (!(await bar.isVisible().catch(() => false))) return decisions;
    const advice = (await bar.getAttribute('data-advice'))!;
    if (decisions === 0 && holdFirstMs > 0) {
      await expect(page.getByTestId('dealer-pace')).toBeVisible();
      await page.waitForTimeout(holdFirstMs);
    }
    await bar.getByRole('button', { name: advice.charAt(0).toUpperCase() + advice.slice(1), exact: true }).click();
    decisions += 1;
  }
  throw new Error('round did not settle');
}

/** Whether the pace track's background is the theme's miss colour, compared as sRGB pixels. */
function trackIsMissColour(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const track = document.querySelector('.dealer-pace');
    if (!track) return false;
    const probe = document.createElement('div');
    probe.style.color = 'var(--bad)';
    document.body.appendChild(probe);
    const bad = getComputedStyle(probe).color;
    probe.remove();
    const ctx = document.createElement('canvas').getContext('2d')!;
    const px = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).join(',');
    };
    return px(getComputedStyle(track).backgroundColor) === px(bad);
  });
}

async function endWithReport(page: Page): Promise<void> {
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-screen')).toBeVisible();
}

const tableRows = async (page: Page): Promise<DecisionRow[]> =>
  (((await readStats(page))?.tableDecisions as { history?: DecisionRow[] } | undefined)?.history ?? []);

test('the pace bar runs over a decision only, and is off by default', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0, dealerPaceOn: true, dealerPaceSec: 3 });
  await withProfile(page);
  await openPlay(page);
  // Between rounds there is no decision, so no bar.
  await expect(page.getByTestId('dealer-pace')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  const bar = page.getByTestId('dealer-pace');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-label', 'Dealer pace, 3 seconds');
  // Thin, above the buttons and clear of the peek button, costing no height.
  const barBox = (await bar.boundingBox())!;
  const button = (await page.locator('.action-btn').first().boundingBox())!;
  const peekBtn = (await page.locator('.peek-hold-btn').boundingBox())!;
  expect(barBox.height).toBeLessThanOrEqual(4.5);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(button.y);
  expect(barBox.y).toBeGreaterThanOrEqual(peekBtn.y + peekBtn.height);
  // Running, the track is not yet the miss colour.
  expect(await trackIsMissColour(page)).toBe(false);

  if (SHOTS) {
    await page.addStyleTag({ content: INSET });
    await page.waitForTimeout(1200); // part-drained, so the shot shows a countdown
    await page.screenshot({ path: `${SHOTS}/f5-pace-bar-375x812.png` });
  }

  // Expiry never plays the hand: past the limit the buttons are still waiting.
  await page.waitForTimeout(3300);
  await expect(page.locator('.action-bar[data-advice]')).toBeVisible();
  // ...and the track has turned to the miss colour (both read back through a
  // canvas, so an oklab() and an rgb() of the same colour compare equal).
  await expect.poll(() => trackIsMissColour(page)).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f5-pace-bar-expired-375x812.png` });
  await playRound(page);
  await expect(page.getByTestId('dealer-pace')).toHaveCount(0);
});

test('control: with the setting absent there is no bar and no slow line', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page);
  await openPlay(page);
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  await expect(page.locator('.action-bar[data-advice]')).toBeVisible();
  await expect(page.getByTestId('dealer-pace')).toHaveCount(0);
  await playRound(page);
  await endWithReport(page);
  await expect(page.getByTestId('report-slow')).toHaveCount(0);
  // Decisions are timed whether or not the clock is on.
  const rows = await tableRows(page);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => !r.slow)).toBe(true);
});

test('a decision past the clock is tagged slow and counted in the report', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0, dealerPaceOn: true, dealerPaceSec: 2 });
  await withProfile(page);
  await openPlay(page);
  let decisions = 0;
  for (let r = 0; r < 3; r++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    // Round 2's first decision waits out the 2 s clock; every other is quick.
    decisions += await playRound(page, r === 1 ? 2400 : 0);
  }
  await endWithReport(page);

  const rows = await tableRows(page);
  expect(rows).toHaveLength(decisions);
  const slow = rows.filter((r) => r.slow === true);
  expect(slow).toHaveLength(1);
  expect(slow[0]!.elapsedMs).toBeGreaterThanOrEqual(2000);
  for (const r of rows.filter((x) => !x.slow)) expect(r.elapsedMs).toBeLessThan(2000);
  await expect(page.getByTestId('report-slow')).toHaveText('1 slow decision');
  await expect(page.getByTestId('report-slow')).toHaveAttribute('data-slow', '1');
  if (SHOTS) {
    await page.addStyleTag({ content: INSET });
    await page.screenshot({ path: `${SHOTS}/f5-report-slow-375x812.png` });
  }
});

test('Stats > Play shows the median of the table decision times, not the drills', async ({ page }) => {
  const day = new Date().toISOString();
  const table: DecisionRow[] = [1200, 4100, 2600, 9000, 1800].map((elapsedMs) => ({ elapsedMs, date: day }));
  // Drill answers are much faster: pooled in, they would drag the median down.
  const drills = [300, 320, 340, 360, 380, 400, 420].map((elapsedMs) => ({ category: 'hard', elapsedMs, date: day, correct: true }));
  await withStats(page, { tableDecisions: { history: table }, latencyHistory: drills });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Play');
  const line = page.getByTestId('play-decision-time');
  await expect(line).toHaveText(`Median decision time: ${secs(median(table.map((r) => r.elapsedMs)))}`);
  expect(secs(median(table.map((r) => r.elapsedMs)))).not.toBe(secs(median([...table, ...drills].map((r) => r.elapsedMs))));
  if (SHOTS) {
    await page.addStyleTag({ content: INSET });
    await line.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${SHOTS}/f5-stats-median-375x812.png` });
  }
});

test('the Play sheet switches the clock on and sets its length (default 4 s)', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page);
  await openPlay(page);
  await page.getByTestId('tab-gear-play').click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  const stepper = sheet.locator('.settings-row', { hasText: 'Dealer pace' }).filter({ has: page.locator('.stepper') });
  await expect(stepper.locator('.stepper-value')).toHaveText('4s');
  await expect(stepper.locator('.stepper-btn').last()).toBeDisabled(); // off: nothing to set yet
  await sheet.getByLabel('Dealer pace clock').check();
  await stepper.locator('.stepper-btn').last().click();
  await expect(stepper.locator('.stepper-value')).toHaveText('5s');
  if (SHOTS) {
    await page.addStyleTag({ content: INSET });
    await stepper.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${SHOTS}/f5-play-sheet-375x812.png` });
  }
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  await expect(page.getByTestId('dealer-pace')).toHaveAttribute('aria-label', 'Dealer pace, 5 seconds');
});

test('played decisions reach Stats > Play as its median decision time', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page);
  await openPlay(page);
  for (let r = 0; r < 2; r++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await playRound(page);
  }
  await endWithReport(page);
  const rows = await tableRows(page);
  expect(rows.length).toBeGreaterThan(0);
  await page.locator('.report-done-btn').click();
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Play');
  await expect(page.getByTestId('play-decision-time')).toHaveText(
    `Median decision time: ${secs(median(rows.map((r) => r.elapsedMs)))}`,
  );
});

test('no timed table decisions: no median line', async ({ page }) => {
  await withStats(page, { latencyHistory: [{ category: 'hard', elapsedMs: 900, correct: true }] });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Play');
  await expect(page.locator('[data-testid="play-categories"]')).toBeVisible();
  await expect(page.getByTestId('play-decision-time')).toHaveCount(0);
});
