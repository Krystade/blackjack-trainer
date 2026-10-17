import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance, shot } from './helpers';

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
  await expect(head).toHaveText(/^(−\d+\.\d\d u|0 u|Under 0\.01 u) lost to mistakes per 100 hands$/);
  const total = Number(await head.getAttribute('data-units-total'));
  const hands = Number(await head.getAttribute('data-hands'));
  expect(hands).toBeGreaterThanOrEqual(3);
  expect(total).toBeCloseTo(units.reduce((a, b) => a + b, 0), 3);
  const shown = Number((await head.innerText()).replace('−', '').split(' ')[0]);
  if (!Number.isNaN(shown)) expect(shown).toBeCloseTo((total / hands) * 100, 2);
  await expect(page.locator('.report-screen')).not.toContainText(/per hour/i);
  await shot(page, 'b6-report');
});

test('B6: a session that only sat out shows no per-100 headline', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page, { betSpreadOn: true, countCheckEvery: 0 });
  await page.goto('/?seed=4&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Sit out', exact: true }).click();
  await endWithReport(page);
  await expect(page.locator('.report-screen')).toBeVisible();
  await expect(page.locator('.report-headline')).toHaveCount(0);
  await expect(page.locator('.report-screen')).not.toContainText(/NaN|Infinity/);
});

test('B6: Drill these hands opens Custom with exactly the missed cells as Focus', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
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
  await page.getByRole('button', { name: 'Drill these hands', exact: true }).click();
  await expect(page.getByTestId('cde-counts')).toHaveText(`${cells.length} Focus · 0 Regular · 0 Rare · ${330 - cells.length} Off`);
  const focus = await page.locator('.cpg-cell[data-tier="focus"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cell!).sort());
  expect(focus).toEqual(cells);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1')!).drill.custom.tiers);
  expect(Object.keys(stored).sort()).toEqual(cells);
});
