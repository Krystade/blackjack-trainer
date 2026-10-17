import { test, expect, type Page } from '@playwright/test';
import { withSettings, resolveInsurance, playRoundByAdvice, readStats } from './helpers';

/**
 * F1 (Wave A): a Play session's graded decisions are committed to Stats as each
 * round settles, so a reload, an iOS eviction or leaving through the gear loses
 * nothing. End then writes the session row only -- never the events a second
 * time. F22: End at round 0 writes nothing and shows no empty report.
 */

type Tally = { right: number; wrong: number };

async function gradedInStats(page: Page): Promise<number> {
  const stats = (await readStats(page)) as { categories?: Record<string, Tally> } | null;
  if (!stats?.categories) return 0;
  return Object.values(stats.categories).reduce((n, t) => n + t.right + t.wrong, 0);
}

async function sessionsInStats(page: Page): Promise<{ graded: number; rounds: number }[]> {
  const stats = (await readStats(page)) as { sessions?: { graded: number; rounds: number }[] } | null;
  return stats?.sessions ?? [];
}

async function playRounds(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);
    await playRoundByAdvice(page);
    await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  }
}

test('settled rounds are in Stats before End, with the bankroll they moved', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, bankrollStart: 100 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  expect(await gradedInStats(page)).toBe(0);

  await playRounds(page, 3);
  const graded = await gradedInStats(page);
  expect(graded).toBeGreaterThanOrEqual(3);
  expect(await sessionsInStats(page)).toHaveLength(0);

  // The bankroll those rounds moved is stored with their events: a reload (or
  // an eviction) reopens Play on it, not on the session's starting stake.
  const bankroll = page.locator('.topbar-stat', { hasText: /^Bankroll: / });
  const before = (await bankroll.innerText()).match(/Bankroll: (-?\d+)/)![1];
  expect(before, 'vacuity guard: the three rounds must move the bankroll').not.toBe('100');
  await page.evaluate(() => window.localStorage.setItem('e2e.noReseed', '1'));
  await page.reload();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(bankroll).toHaveText(new RegExp(`^Bankroll: ${before}(?!\\d)`));
  await expect(page.locator('.topbar-stat', { hasText: /^Round / })).toHaveText('Round 0');
});

test('End writes the session row without counting the events twice', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, bankrollStart: 100 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await playRounds(page, 3);
  const graded = await gradedInStats(page);

  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-summary')).toContainText(`/ ${graded} correct`);
  expect(await gradedInStats(page)).toBe(graded);
  const sessions = await sessionsInStats(page);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ graded, rounds: 3 });
});

test('End at round 0 returns Home with no report and no session written', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, bankrollStart: 100 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-screen')).toHaveCount(0);
  await expect(page.locator('.table-screen')).toHaveCount(0);
  expect(await sessionsInStats(page)).toHaveLength(0);
});
