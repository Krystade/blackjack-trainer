import { test, expect, type Page } from '@playwright/test';
import { withSettings, resolveInsurance, playRoundByAdvice, readStats, openStats } from './helpers';

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

type Row = { id?: string; graded: number; rounds: number; bankrollDelta: number; provisional?: true };
async function sessionsInStats(page: Page): Promise<Row[]> {
  const stats = (await readStats(page)) as { sessions?: Row[] } | null;
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
  // Wave B2, R1 (deliberately changed from "no row before End"): one
  // provisional row per session, kept current after every settled round.
  const rows = await sessionsInStats(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ graded, rounds: 3, provisional: true });

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

  const provisionalId = (await sessionsInStats(page))[0]?.id;
  expect(provisionalId, 'the provisional row carries the session id').toBeTruthy();

  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-summary')).toContainText(`/ ${graded} correct`);
  expect(await gradedInStats(page)).toBe(graded);
  const sessions = await sessionsInStats(page);
  // R1: End finalises the SAME row -- no duplicate, no longer provisional.
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ graded, rounds: 3, id: provisionalId });
  expect(sessions[0]!.provisional).toBeUndefined();
});

test('R1: a shoe left without End is a session in Stats, and agrees with the bankroll', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, bankrollStart: 100 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await playRounds(page, 4);
  const bankroll = Number((await page.locator('.topbar-stat', { hasText: /^Bankroll: / }).innerText()).match(/Bankroll: (-?[\d.]+)/)![1]);

  // Evicted: no End, the page just goes away and comes back.
  await page.evaluate(() => window.localStorage.setItem('e2e.noReseed', '1'));
  await page.reload();
  const rows = await sessionsInStats(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ rounds: 4, provisional: true });
  expect(100 + rows[0]!.bankrollDelta).toBe(bankroll);

  await openStats(page);
  await page.locator('.stats-tabs').getByRole('tab', { name: 'Over time', exact: true }).click();
  await expect(page.locator('.session-row')).toHaveCount(1);
  await expect(page.locator('.session-row')).toContainText('4 rounds');
  await expect(page.getByText('No table sessions yet.')).toHaveCount(0);

  // The next shoe is a session of its own: a second row, the first untouched.
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await playRounds(page, 1);
  const after = await sessionsInStats(page);
  expect(after).toHaveLength(2);
  expect(after[0]).toEqual(rows[0]);
  expect(after[1]).toMatchObject({ rounds: 1, provisional: true });
  expect(after[1]!.id).not.toBe(rows[0]!.id);
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
