import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance, playRoundByAdvice, shot } from './helpers';

test.use({ viewport: { width: 375, height: 812 } });

/** Plays a dealt round, taking the first legal non-advised action once. */
export async function playRoundWithOneMistake(page: Page): Promise<void> {
  let mistaken = false;
  for (let guard = 0; guard < 30; guard++) {
    if (await resolveInsurance(page, false)) continue;
    const bar = page.locator('.action-bar[data-advice]');
    if (!(await bar.isVisible().catch(() => false))) return;
    const advice = (await bar.getAttribute('data-advice'))!;
    const enabled = bar.locator('button.action-btn:not([disabled])');
    if (!mistaken) {
      for (let i = 0; i < (await enabled.count()); i++) {
        const t = (await enabled.nth(i).innerText()).trim();
        if (t.toLowerCase() !== advice) { mistaken = true; await enabled.nth(i).click(); break; }
      }
      if (mistaken) continue;
    }
    await bar.getByRole('button', { name: advice.charAt(0).toUpperCase() + advice.slice(1), exact: true }).click();
  }
  throw new Error('round did not settle');
}

export async function endWithReport(page: Page): Promise<void> {
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
}

test('B6: plays and count checks are separate, plays sorted by cost, headline is u lost per 100 hands', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  // Basic grading only, so every play mistake is a priced basic error; one check, asked at End.
  await withProfile(page, { gradeDeviations: false, countCheckEvery: 3, countCheckAsk: 'running' });
  await page.goto('/?seed=4&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  for (let r = 0; r < 3; r++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await playRoundWithOneMistake(page);
  }
  await endWithReport(page);
  const sheet = page.locator('.bottom-sheet');
  await expect(sheet.locator('.bottom-sheet-title')).toHaveText('Running count?');
  for (const k of ['3', '0', 'OK']) await sheet.getByRole('button', { name: k, exact: true }).click(); // +30: impossible after 3 rounds
  await expect(page.locator('.report-screen')).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Plays', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Count checks', exact: true })).toBeVisible();
  await expect(page.locator('.report-counts li')).toHaveCount(1);
  await expect(page.locator('.report-counts li')).toHaveText(/^RC off by \d+ · you said \+30 · it was (0|[+−]\d+)$/);
  await expect(page.locator('.report-plays')).not.toContainText('count');

  const units = await page.locator('.report-plays li[data-units]').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.units)));
  expect(units.length, 'need two priced rows to check the order').toBeGreaterThanOrEqual(2);
  expect([...units].sort((a, b) => b - a)).toEqual(units);

  const head = page.locator('.report-headline');
  // B2, R3 (deliberately changed): the figure says it prices PLAY mistakes.
  await expect(head).toHaveText(/^(−\d+\.\d\d u|0 u|Under 0\.01 u) lost to playing mistakes per 100 hands$/);
  const total = Number(await head.getAttribute('data-units-total'));
  const hands = Number(await head.getAttribute('data-hands'));
  expect(hands).toBeGreaterThanOrEqual(3);
  expect(total).toBeCloseTo(units.reduce((a, b) => a + b, 0), 3);
  const shown = Number((await head.locator('.report-headline-loss').innerText()).replace('−', '').split(' ')[0]);
  if (!Number.isNaN(shown)) expect(shown).toBeCloseTo((total / hands) * 100, 2);
  await expect(page.locator('.report-screen')).not.toContainText(/per hour/i);
  await shot(page, 'b6-report');
});

/**
 * H7 (retest story 9): a Plays row's reason is the wrong-play card's (E6) --
 * the chart region and the dealer's bust chance -- not the engine's "Basic hit
 * vs dealer 7" placeholder, which only named the verdict again.
 */
test('H7: report play rows read the chart region and bust line, never "Basic X vs dealer N"', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page, { gradeDeviations: false, countCheckEvery: 0 });
  await page.goto('/?seed=4&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  for (let r = 0; r < 3; r++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await playRoundWithOneMistake(page);
  }
  await endWithReport(page);
  await expect(page.locator('.report-screen')).toBeVisible();
  const rows = await page.locator('.report-plays li[data-units]').allInnerTexts();
  expect(rows.length, 'basic grading only: every play row is a priced basic error').toBeGreaterThanOrEqual(2);
  for (const row of rows) {
    expect(row).not.toMatch(/Basic \w+ vs dealer/);
    // "— Hard 12–16 v 7–A: hit. Dealer busts 26% with a 7 up."
    expect(row).toMatch(/ — (Hard|Soft|[0-9A,]+ v) [^:]*: [^.]+\. Dealer busts \d+% with\san?\s(\d+|ace)\sup\./);
  }
  await page.addStyleTag({ content: ':root { --safe-top: 47px; --safe-bottom: 34px; }' });
  if (process.env.E2E_SHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/h7-report-plays.png`, fullPage: true });
});

test('B6: a session that only sat out shows no per-100 headline', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  // D-R1: exit point 0, so sitting out the fresh shoe's TC 0 is right.
  await withProfile(page, { betSpreadOn: true, countCheckEvery: 0, wongExitTc: 0 });
  await page.goto('/?seed=4&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('group', { name: 'In or out' }).getByRole('button', { name: 'Out', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await endWithReport(page);
  await expect(page.locator('.report-screen')).toBeVisible();
  await expect(page.locator('.report-headline')).toHaveCount(0);
  await expect(page.locator('.report-screen')).not.toContainText(/NaN|Infinity/);
});

/** A saved Custom deck "Drill these hands" must leave exactly as it was (R5). */
const SAVED_CUSTOM = { tiers: { 'soft-18-v-9': 'focus', 'hard-12-v-3': 'rare' }, painted: { 'soft-18-v-9': true }, mix: { focus: 60, regular: 30, rare: 10 } };

test('B6 / B2 #46: Drill these hands deals exactly the missed cells, labelled, and leaves the saved Custom deck alone', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0, drill: { deck: 'custom', custom: SAVED_CUSTOM } });
  await withProfile(page, { gradeDeviations: false, countCheckEvery: 0 });
  await page.goto('/?seed=4&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  for (let r = 0; r < 3; r++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await playRoundWithOneMistake(page);
  }
  await endWithReport(page);
  const cells = await page.locator('.report-plays li[data-cell]').evaluateAll((els) =>
    [...new Set(els.map((e) => (e as HTMLElement).dataset.cell!))].sort());
  expect(cells.length).toBeGreaterThanOrEqual(1);
  const savedDrill = () => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('bjtrainer.settings.v1')!).drill));
  const before = await savedDrill();
  await page.getByRole('button', { name: 'Drill these hands', exact: true }).click();

  // Flashcards on the session's hands, visibly labelled -- not the Custom editor.
  const n = cells.length;
  await expect(page.locator('.drill-heading')).toHaveText('Your session');
  await expect(page.getByTestId('review-status')).toHaveText(`Drilling ${n} ${n === 1 ? 'hand' : 'hands'} from your session · ${n} left`);
  await expect(page.locator('.cde-counts, [data-testid="cde-counts"]')).toHaveCount(0);

  // Exactly the missed cells, each once when answered right, then done.
  const dealt: string[] = [];
  for (let i = 0; i < n + 5 && (await page.getByTestId('review-done').count()) === 0; i++) {
    const bar = page.locator('.action-bar[data-advice]');
    const advice = (await bar.getAttribute('data-advice'))!;
    await bar.getByRole('button', { name: advice.charAt(0).toUpperCase() + advice.slice(1), exact: true }).click();
    dealt.push((await page.locator('.hand-result').first().getAttribute('data-cell-id'))!);
  }
  await expect(page.getByTestId('review-done')).toBeVisible();
  expect([...dealt].sort()).toEqual(cells);

  // R5: the saved deck is untouched -- no tiers rewritten, nothing marked painted.
  expect(await savedDrill()).toBe(before);
  expect(JSON.parse(before).custom).toEqual(SAVED_CUSTOM);
});

test('B2 R3/#15: bet and sit misses are counted beside the headline and listed in plain words', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page, { betSpreadOn: true, countCheckEvery: 0, wongExitTc: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // Fresh shoe, TC 0: at exit point 0 (D-R1) the ramp sits out, so dealing in is a play-or-sit
  // miss. C-R6 (deliberately changed): the 2u is not graded on top of it --
  // one round, one bet decision.
  await page.locator('.bet-chips .chip-btn', { hasText: /^2$/ }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  await endWithReport(page);
  await expect(page.locator('.report-screen')).toBeVisible();
  const head = page.locator('.report-headline');
  await expect(head).toHaveText(/^(−\d+\.\d\d u|0 u|Under 0\.01 u) lost to playing mistakes per 100 hands · 1 bet decision off$/);
  const rows = page.locator('.report-bets li');
  await expect(rows).toHaveText(['TC +0 · you stayed in · you leave at +0']);
  await expect(page.locator('.report-bets')).not.toContainText(/wong|sit-out|played play|tc \d/);
  await shot(page, 'b2-r3-bet-misses');
});
