import { test, expect, type Page } from '@playwright/test';

/**
 * Track 3 (3B): rust checks on Home. A rung passed and then left unpractised
 * for 14 days reads rusty and its re-test becomes the step; 4 of 5 fresh
 * table-pace runs keep it, 2 of 5 put it back to work.
 */

test.use({ viewport: { width: 375, height: 812 } });

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const IDS = ['ins', '16v10', '15v10', 'TTv5', 'TTv6', '10v10', '12v3', '12v2', '11vA', '9v2', '10vA', '9v7', '16v9', '13v2', '12v4', '12v5', '12v6', '13v3', '14v10', '15v9', '15vA'];
const many = <T,>(n: number, row: T) => Array.from({ length: n }, () => row);
const countRun = (days: number, correct: boolean) => ({ date: ago(days), cards: 52, intervalMs: 550, correct });

/** Every rung passed, practised yesterday -- except the count runs, whose rows are given. */
function stats(countRows: unknown[]) {
  const D = ago(1);
  const strong = { right: 30, wrong: 0, lastAt: D };
  return {
    version: 1,
    cellStats: { 'hard-16-v-10': strong, 'soft-18-v-9': strong, 'pair-8-v-A': strong },
    masterySweepsCompleted: 1,
    countDrill: { history: countRows },
    deckEstimation: { history: many(10, { date: D, actualDecks: 3, guess: 3, errorDecks: 0, correct: true }) },
    trueCount: { history: many(10, { date: D, runningCount: 6, decksRemaining: 3, guess: 2, correctTc: 2, correct: true }) },
    perIndex: Object.fromEntries(IDS.map((id) => [id, { right: 10, wrong: 0 }])),
    betSizing: { history: many(10, { date: D, rc: 6, decksRemaining: 3, tc: 2, taken: 4, correct: 4, ok: true }) },
    sessions: [{ date: D, rounds: 45, graded: 40, correct: 38, bankrollDelta: 0, plays: 40, playsCorrect: 38 }],
  };
}

async function seed(page: Page, s: unknown, rust?: unknown) {
  await page.addInitScript(
    ([st, r]) => {
      // Once only: a reload must read what Home saved, not the seed again.
      if (sessionStorage.getItem('rust-seeded')) return;
      sessionStorage.setItem('rust-seeded', '1');
      localStorage.setItem('bjtrainer.stats.v1', JSON.stringify(st));
      if (r) localStorage.setItem('bjtrainer.rust.v1', JSON.stringify(r));
    },
    [s, rust ?? null] as const,
  );
}

const card = (page: Page) => page.getByRole('region', { name: 'Next step' });
const countRow = (page: Page) => page.locator('.ladder-row[data-rung="count"]');
const savedRust = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.rust.v1') ?? 'null'));

/** An open count re-test, from 10 days ago. */
const openRetest = (step: number) => ({
  version: 1,
  rungs: { count: { step, provenAt: Date.now() - 40 * DAY, retest: { from: Date.now() - 10 * DAY, baseline: { n: 0, right: 0 } } } },
});

test('a rung left 20 days reads rusty, and its re-test is the step', async ({ page }) => {
  await seed(page, stats(many(5, countRun(20, true))));
  await page.goto('/?e2e=1');
  await expect(countRow(page)).toHaveAttribute('data-state', 'rusty');
  await expect(countRow(page)).toHaveAttribute('aria-label', '3. Running count at table pace, rusty: re-test due');
  await expect(countRow(page).locator('.ladder-mark')).toHaveText('↻');
  await expect(countRow(page).locator('.ladder-progress')).toHaveText('Re-test due');
  await expect(page.locator('.ladder-row[data-state="done"]')).toHaveCount(6);
  await expect(card(page)).toHaveAttribute('data-card', 'retest');
  await expect(card(page).locator('.next-step-title')).toHaveText('Re-test: Running count at table pace');
  await expect(card(page).locator('.next-step-why')).toHaveText(
    'Passed 20 days ago and not practised since. 5 table-pace runs, 4 right, to keep it.',
  );
  await expect(card(page).getByRole('button', { name: 'Start', exact: true })).toHaveAttribute('data-launch', 'count');
  // Home saved the re-test it shows, and a reload shows it again.
  await expect.poll(async () => (await savedRust(page))?.rungs?.count?.retest?.from).toBeGreaterThan(0);
  await page.reload();
  await expect(countRow(page)).toHaveAttribute('data-state', 'rusty');
  if (process.env.RUST_SHOTS) {
    for (const theme of ['midnight-felt', 'bone-ink']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.screenshot({ path: `${process.env.RUST_SHOTS}/rust-home-${theme}.png`, fullPage: true });
    }
  }
});

test('4 of 5 fresh table-pace runs pass the re-test: done, and the next one is 30 days out', async ({ page }) => {
  const rows = [...many(5, countRun(30, true)), ...[true, false, true, true, true].map((c) => countRun(5, c))];
  await seed(page, stats(rows), openRetest(0));
  await page.goto('/?e2e=1');
  await expect(countRow(page)).toHaveAttribute('data-state', 'done');
  await expect(card(page)).not.toHaveAttribute('data-card', 'retest');
  await expect.poll(async () => (await savedRust(page))?.rungs?.count?.step).toBe(1);
  expect((await savedRust(page)).rungs.count.retest).toBeUndefined();
});

test('2 of 5 misses the re-test: the rung is back to work', async ({ page }) => {
  const rows = [...many(5, countRun(30, true)), ...[true, false, false, true, false].map((c) => countRun(5, c))];
  await seed(page, stats(rows), openRetest(2));
  await page.goto('/?e2e=1');
  await expect(countRow(page)).toHaveAttribute('data-state', 'current');
  await expect(card(page)).toHaveAttribute('data-card', 'retest');
  await expect(card(page).locator('.next-step-why')).toHaveText(/^Missed its re-test: 2 of 5\./);
  await expect.poll(async () => (await savedRust(page))?.rungs?.count?.needsWork).toBe(true);
  expect((await savedRust(page)).rungs.count.step).toBe(0);
  if (process.env.RUST_SHOTS) {
    for (const theme of ['midnight-felt', 'bone-ink']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.screenshot({ path: `${process.env.RUST_SHOTS}/rust-needswork-${theme}.png`, fullPage: true });
    }
  }
});
