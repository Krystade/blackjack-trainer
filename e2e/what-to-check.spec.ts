import { test, expect, type Page } from '@playwright/test';
import { playRoundByAdvice, readStats } from './helpers';

/**
 * T1-1B: Play's "What to check". A fresh install plays basic strategy only;
 * each switch adds one thing. Fresh storage here on purpose (no withProfile
 * / withSettings): the beginner table is what a new player gets.
 */

const roundStat = (page: Page) => page.locator('.topbar-stat', { hasText: /^Round \d+$/ });

async function openTable(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?seed=7&e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
}

async function openGear(page: Page) {
  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  await expect(sheet).toBeVisible();
  return sheet;
}

const toggle = (sheet: ReturnType<Page['getByRole']>, label: string) =>
  sheet.getByTestId('what-to-check').getByRole('checkbox', { name: label, exact: true });

async function typeOnPad(page: Page, n: number): Promise<void> {
  const pad = page.locator('.bottom-sheet .numpad');
  if (n < 0) await pad.getByRole('button', { name: 'Plus or minus' }).click();
  for (const d of String(Math.trunc(Math.abs(n)))) await pad.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
  // Owner 2026-11-10: an Expert division's half goes on with the .5 key.
  if (!Number.isInteger(n)) await pad.getByTestId('numpad-half').click();
  await pad.locator('.numpad-ok').click();
}

/** Solve the sum on screen (U+2212 minus, × times, ÷ divided by). */
async function solveDistraction(page: Page): Promise<number> {
  const text = (await page.getByTestId('play-distraction-prompt').innerText()).replace(/−/g, '-').replace(/×/g, '*');
  const m = /^\s*(-?\d+)\s*([+*÷-])\s*\(?(-?\d+)\)?\s*$/.exec(text);
  if (!m) throw new Error(`unreadable sum: ${text}`);
  const a = Number(m[1]);
  const b = Number(m[3]);
  return m[2] === '+' ? a + b : m[2] === '-' ? a - b : m[2] === '÷' ? a / b : a * b;
}

type Seen = { countSheets: number; distractions: number };

/** Deal and play `rounds` rounds, answering whatever sheet comes up. */
async function playRounds(page: Page, rounds: number, onDistraction?: () => Promise<void>): Promise<Seen> {
  const seen: Seen = { countSheets: 0, distractions: 0 };
  for (let i = 0; i < rounds; i++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    if (await page.getByTestId('play-distraction-prompt').isVisible()) {
      seen.distractions++;
      if (onDistraction) await onDistraction();
      else await typeOnPad(page, await solveDistraction(page));
    }
    if (await page.locator('.bottom-sheet', { hasText: 'Running count?' }).isVisible()) {
      seen.countSheets++;
      await typeOnPad(page, 0);
      const held = page.getByTestId('count-held-deal');
      if (await held.isVisible()) await held.click();
    }
    await playRoundByAdvice(page);
  }
  return seen;
}

test('a fresh install: all five switches off, and no count check in 7 rounds', async ({ page }) => {
  await openTable(page);
  const sheet = await openGear(page);
  await expect(sheet.getByTestId('what-to-check-note')).toHaveText(
    'Play grades your basic strategy. Each switch adds one more thing to check.',
  );
  for (const label of ['Count checks', 'Deviations', 'Bet checks', 'Dealer mistakes', 'Distractions']) {
    await expect(toggle(sheet, label)).not.toBeChecked();
  }
  // The cadence stepper left the gear for the profile editor.
  await expect(sheet.locator('.count-ask-row')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Flat bets: no chips and no In/Out toggle.
  await expect(page.locator('.chip-btn')).toHaveCount(0);
  await expect(page.locator('.in-out-toggle')).toHaveCount(0);
  const seen = await playRounds(page, 7);
  expect(seen.countSheets).toBe(0);
  await expect(roundStat(page)).toHaveText('Round 7');
});

test('Count checks on: a new shoe on close, then a running-count check by round 5', async ({ page }) => {
  await openTable(page);
  const sheet = await openGear(page);
  await toggle(sheet, 'Count checks').check();
  await expect(sheet.getByTestId('tab-sheet-when')).toContainText('Changed. A new shoe');
  await expect(sheet.getByTestId('what-to-check-when')).toBeVisible();
  await page.keyboard.press('Escape');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.profiles.v1')!)[0]);
  expect(stored.playChecks).toEqual({ count: true, deviations: false, bets: false });
  expect(stored.countCheckEvery).toBe(5);
  const seen = await playRounds(page, 6);
  expect(seen.countSheets).toBeGreaterThanOrEqual(1);
});

test('Distractions on (live): a quick sum within 7 rounds, then the running count, recorded as Play', async ({ page }) => {
  await openTable(page);
  const sheet = await openGear(page);
  await toggle(sheet, 'Count checks').check();
  await toggle(sheet, 'Distractions').check();
  await page.keyboard.press('Escape');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1')!));
  expect(settings.tableChecks).toEqual({ dealerMistakes: false, distractions: true });

  let kept: boolean | null = null;
  const seen = await playRounds(page, 8, async () => {
    // The round's result is repeated in the sheet; the felt's copy, which the
    // sheet would slice through, is hidden meanwhile.
    await expect(page.getByTestId('distraction-sheet-banner')).toBeVisible();
    for (const b of await page.locator('.table-screen .round-banner').all()) await expect(b).toBeHidden();
    await typeOnPad(page, await solveDistraction(page));
    // The running count is asked straight after, the sum's verdict above it.
    const check = page.locator('.bottom-sheet', { hasText: 'Running count?' });
    await expect(check).toBeVisible();
    await expect(check.getByTestId('play-distraction-verdict')).toContainText('Sum ✓');
    await typeOnPad(page, 0);
    const held = page.getByTestId('count-held-deal');
    kept = !(await held.isVisible());
    if (!kept) await held.click();
  });
  expect(seen.distractions).toBeGreaterThanOrEqual(1);
  const stats = (await readStats(page)) as { distraction: { history: Record<string, unknown>[] } };
  const last = stats.distraction.history.at(-1)!;
  expect(last.source).toBe('play');
  expect(last.answerCorrect).toBe(true);
  expect(last.countKept).toBe(kept);
});

test('Dealer mistakes on writes the gate and an occasional rate', async ({ page }) => {
  await openTable(page);
  const sheet = await openGear(page);
  await toggle(sheet, 'Dealer mistakes').check();
  await expect(toggle(sheet, 'Dealer mistakes')).toBeChecked();
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1')!));
  expect(s.tableChecks.dealerMistakes).toBe(true);
  expect(s.dealerMistakesMode).toBe('occasional');
});

test('Bet checks on: chips and the In/Out toggle come back', async ({ page }) => {
  await openTable(page);
  const sheet = await openGear(page);
  await toggle(sheet, 'Bet checks').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('.chip-btn').first()).toBeVisible();
  await expect(page.locator('.in-out-toggle')).toBeVisible();
});

test('D11: Show chips sits in the Play gear and applies live, with no new shoe', async ({ page }) => {
  await openTable(page);
  const sheet = await openGear(page);
  await sheet.getByRole('checkbox', { name: 'Show chips', exact: true }).check();
  await expect(sheet.getByTestId('tab-sheet-when')).not.toContainText('Changed');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1')!));
  expect(s.showChips).toBe(true);
});

test('a reload with a distraction open resumes the shoe cleanly, the check still to come', async ({ page }) => {
  await openTable(page);
  const sheet = await openGear(page);
  await toggle(sheet, 'Count checks').check();
  await toggle(sheet, 'Distractions').check();
  await page.keyboard.press('Escape');
  let roundAtSum = -1;
  for (let i = 0; i < 9 && roundAtSum < 0; i++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    if (await page.getByTestId('play-distraction-prompt').isVisible()) {
      roundAtSum = Number((await roundStat(page).innerText()).replace('Round ', ''));
      break;
    }
    if (await page.locator('.bottom-sheet', { hasText: 'Running count?' }).isVisible()) {
      await typeOnPad(page, 0);
      const held = page.getByTestId('count-held-deal');
      if (await held.isVisible()) await held.click();
    }
    await playRoundByAdvice(page);
  }
  expect(roundAtSum).toBeGreaterThan(0);
  // Saves skip while the sum is open; the shoe on disk is the settled round.
  await page.evaluate(() => localStorage.setItem('e2e.noReseed', '1'));
  await page.reload();
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
  await expect(page.locator('.error-boundary')).toHaveCount(0);
  await expect(roundStat(page)).toHaveText(`Round ${roundAtSum}`);
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
});

test('owner 2026-11-09: How often and Difficulty sit under Distractions only while it is on, and Often + Hard reach the table', async ({ page }) => {
  await openTable(page);
  const sheet = await openGear(page);
  await expect(sheet.getByTestId('play-distraction-options')).toHaveCount(0);
  await toggle(sheet, 'Distractions').check();
  const opts = sheet.getByTestId('play-distraction-options');
  await expect(opts).toBeVisible();
  await expect(opts.getByRole('button', { name: 'Normal', exact: true })).toHaveCount(2);
  for (const b of await opts.getByRole('button', { name: 'Normal', exact: true }).all()) await expect(b).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByTestId('play-distraction-freq-note')).toHaveText('About one every 7 rounds.');
  await opts.getByRole('button', { name: 'Often', exact: true }).click();
  await opts.getByRole('button', { name: 'Hard', exact: true }).click();
  await expect(sheet.getByTestId('play-distraction-freq-note')).toHaveText('About one every 4 rounds.');
  await expect(sheet.getByTestId('play-distraction-difficulty-note')).toContainText('Two-digit');
  await page.keyboard.press('Escape');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1')!));
  expect(settings.playDistractionFreq).toBe('often');
  expect(settings.playDistractionDifficulty).toBe('hard');

  const prompts: string[] = [];
  const seen = await playRounds(page, 8, async () => {
    const text = (await page.getByTestId('play-distraction-prompt').innerText()).replace(/−/g, '-');
    prompts.push(text);
    await typeOnPad(page, await solveDistraction(page));
  });
  // One in every 4-round window: rounds 1-3 and 4-7 each bring one.
  expect(seen.distractions).toBeGreaterThanOrEqual(2);
  for (const p of prompts) {
    const nums = (p.match(/\d+/g) ?? []).map(Number);
    expect(Math.max(...nums) >= 11 || p.includes('×'), p).toBe(true);
  }

  // Off again: the options go with the switch.
  const again = await openGear(page);
  await toggle(again, 'Distractions').uncheck();
  await expect(again.getByTestId('play-distraction-options')).toHaveCount(0);
});

test('owner 2026-11-10: Expert poses divisions, and a .5 answer typed with the .5 key is graded right (and a whole one wrong)', async ({ page }) => {
  test.setTimeout(120_000);
  await openTable(page);
  const sheet = await openGear(page);
  await toggle(sheet, 'Distractions').check();
  const opts = sheet.getByTestId('play-distraction-options');
  await opts.getByRole('button', { name: 'Often', exact: true }).click();
  await opts.getByRole('button', { name: 'Expert', exact: true }).click();
  await expect(opts.getByRole('button', { name: 'Expert', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByTestId('play-distraction-difficulty-note')).toHaveText('Division with answers that can end in .5, like 63 ÷ 6.');
  // Four options still fit the 375px sheet: nothing scrolls sideways.
  const overflow = await opts.evaluate((el) =>
    [...el.querySelectorAll('.segmented')].map((s) => s.scrollWidth - s.clientWidth),
  );
  expect(overflow.every((d) => d <= 0), String(overflow)).toBe(true);
  await page.keyboard.press('Escape');
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1')!))).playDistractionDifficulty).toBe('expert');

  // Every sum answered right except the first .5 one, given its whole part:
  // the half is graded exactly, so that one must come back wrong.
  const verdicts: { prompt: string; answer: number; typed: number; correct: string | null }[] = [];
  let halvesRight = 0;
  let halvesWrong = 0;
  let divisions = 0;
  for (let round = 0; round < 40 && halvesRight < 1; round++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    if (await page.getByTestId('play-distraction-prompt').isVisible()) {
      const prompt = await page.getByTestId('play-distraction-prompt').innerText();
      const answer = await solveDistraction(page);
      const pad = page.locator('.bottom-sheet .numpad');
      if (prompt.includes('÷')) divisions++;
      // The .5 key shows on a division (whole answers too), never on a sum.
      await expect(pad.getByTestId('numpad-half')).toHaveCount(prompt.includes('÷') ? 1 : 0);
      let typed = answer;
      if (!Number.isInteger(answer) && halvesWrong === 0) {
        typed = Math.trunc(answer);
        halvesWrong++;
      } else if (!Number.isInteger(answer)) {
        halvesRight++;
        // The key toggles: on, off, on again, and the display shows the half.
        await pad.getByTestId('numpad-half').click();
        await expect(pad.locator('.numpad-display')).toHaveText('0.5');
        await pad.getByTestId('numpad-half').click();
        await expect(pad.locator('.numpad-display')).toHaveText('Type a number');
      }
      await typeOnPad(page, typed);
      const verdict = page.getByTestId('play-distraction-verdict').first();
      await expect(verdict).toBeVisible();
      verdicts.push({ prompt, answer, typed, correct: await verdict.getAttribute('data-correct') });
      if (!Number.isInteger(answer) && typed === answer) {
        await expect(verdict).toContainText(`= ${String(answer).replace('-', '−')}`);
      }
    }
    await playRoundByAdvice(page);
  }
  expect(divisions, JSON.stringify(verdicts)).toBeGreaterThanOrEqual(2);
  expect(halvesWrong, JSON.stringify(verdicts)).toBe(1);
  expect(halvesRight, JSON.stringify(verdicts)).toBe(1);
  for (const v of verdicts) expect(v.correct, JSON.stringify(v)).toBe(String(v.typed === v.answer));
});
