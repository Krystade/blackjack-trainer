import { test, expect, type Page } from '@playwright/test';
import { readStats, withSettings } from './helpers';

/**
 * C-R1 (W9): Speed and Bet sizing, eyes-free, answered from the wheel.
 *
 * The app states a proposition, forward is yes and back is no, and the answer
 * is graded like the drill's on-screen answers: the score / Stats row, the
 * result strip, and a spoken verdict. No microphone, no clock.
 */

const SHOTS = 'C:/Users/jackp/AppData/Local/Temp/claude/C--Users-jackp/5eb9dd98-f8da-490b-a046-a394be7c9a16/scratchpad/waveC/w-shots';
const PHONE = { width: 375, height: 812 };

async function press(page: Page, command: 'forward' | 'back'): Promise<void> {
  const handled = await page.evaluate((c) => window.__wheelPress?.(c) ?? false, command);
  expect(handled, 'the press reached no screen').toBe(true);
}

const spoken = (page: Page) => page.evaluate(() => window.__speechLog ?? []);

async function open(page: Page, drill: 'Speed' | 'Bet sizing'): Promise<void> {
  await page.setViewportSize(PHONE);
  await withSettings(page, { audio: { enabled: true }, drill: { wheelMode: 'answer' } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: drill, exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText(drill);
}

test('Speed, eyes-free: the hand and question are said, forward is yes, the verdict is spoken', async ({ page }) => {
  await open(page, 'Speed');
  await page.getByRole('checkbox', { name: 'Eyes-free audio' }).check();
  await expect.poll(async () => (await spoken(page)).some((l) => /^You have .*Surrender\?$/.test(l))).toBe(true);
  await page.screenshot({ path: `${SHOTS}/c-r1-speed-eyes-free.png` });

  const asked = await page.getByTestId('speed-hand').getAttribute('data-cell-id');
  const before = (await spoken(page)).length;
  await press(page, 'forward');
  await expect(page.getByTestId('speed-result')).toHaveAttribute('data-cell-id', asked!);
  await expect(page.getByTestId('speed-score')).toHaveText(/^\d\/1$/);
  const strip = await page.getByTestId('speed-result').innerText();
  const verdict = (await spoken(page)).slice(before);
  if (strip.startsWith('Correct')) expect(verdict).toContain('Correct.');
  else expect(verdict).toContain('Wrong. The answer is no.');
  await page.screenshot({ path: `${SHOTS}/c-r1-speed-verdict.png` });

  // Forward on the verdict goes on to the next question, which is said.
  await press(page, 'forward');
  await expect.poll(async () => (await spoken(page)).slice(before + 1).some((l) => /Surrender\?$/.test(l))).toBe(true);
  await press(page, 'back');
  await expect(page.getByTestId('speed-score')).toHaveText(/^\d\/2$/);
  // No clock eyes-free: a wheel answer is not a reaction time.
  await expect(page.getByTestId('speed-median')).toHaveText('–');
});

test('Bet sizing, eyes-free: a proposed bet, back is no, graded and recorded', async ({ page }) => {
  await open(page, 'Bet sizing');
  await page.getByRole('checkbox', { name: 'Eyes-free audio' }).check();
  await expect
    .poll(async () => (await spoken(page)).some((l) => /^Running count .* (Bet .* units?\?|Sit out\?)$/.test(l)))
    .toBe(true);
  await expect(page.getByTestId('bet-proposition')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/c-r1-bet-eyes-free.png` });

  const before = (await spoken(page)).length;
  await press(page, 'back');
  await expect(page.locator('.bet-verdict')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/c-r1-bet-verdict.png` });

  const stats = (await readStats(page)) as {
    betSizing: { history: { taken: number | 'sit'; correct: number | 'sit'; ok: boolean; saidYes?: boolean }[] };
  };
  const row = stats.betSizing.history.at(-1)!;
  expect(row.saidYes).toBe(false);
  // Default profile, no cover bets: the proposal is right exactly when it is the ramp's answer.
  expect(row.ok).toBe(row.taken !== row.correct);
  const verdict = (await spoken(page)).slice(before);
  if (row.ok) expect(verdict).toContain('Correct.');
  else expect(verdict.some((l) => /^Wrong\. The ramp says (sit out|\w+ units?)\.$/.test(l)), verdict.join(' | ')).toBe(true);

  await press(page, 'forward');
  await expect(page.locator('.bet-verdict')).toBeHidden();
  await press(page, 'forward');
  const rows = ((await readStats(page)) as { betSizing: { history: { saidYes?: boolean }[] } }).betSizing.history;
  expect(rows).toHaveLength(2);
  expect(rows[1]!.saidYes).toBe(true);
});

test('Bet sizing off eyes-free keeps its rung buttons and proposes nothing', async ({ page }) => {
  await open(page, 'Bet sizing');
  await expect(page.locator('.bet-sizing-btn').first()).toBeVisible();
  await expect(page.getByTestId('bet-proposition')).toHaveCount(0);
});
