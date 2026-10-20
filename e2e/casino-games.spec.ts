import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';
import { worstContrast } from './contrast';

/**
 * Wave K: several games per casino, each worked out by the in-app simulator,
 * and the "Games ranked" list built from them.
 *
 * The simulator runs in a Web Worker; `window.__bjCasinoSimBudget` caps each
 * run at a few thousand rounds so a compute finishes in about a second. The
 * figures at that budget are noisy, so nothing here pins a dollar amount: the
 * spec checks the ORDER against the figures shown, the states a result moves
 * through (none -> current -> stale -> current), and what each card says.
 */

test.use({ viewport: { width: 375, height: 812 } });

const KEY = 'bjtrainer.casinoLog.v1';
const STATS_KEY = 'bjtrainer.casinoGameStats.v1';
const AT = '2026-10-01T00:00:00.000Z';

const good = { id: 'g-good', decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1, minBet: 25, maxBet: 1000, midShoeEntry: 'allowed', csm: false };
const csm = { id: 'g-csm', label: 'CSM pit', decks: 6, s17: false, das: true, surrender: false, payout: '6:5', cutDecksLeft: null, minBet: 15, maxBet: null, midShoeEntry: 'unknown', csm: true };
const deep = { id: 'g-deep', decks: 2, s17: true, das: true, surrender: false, payout: '3:2', cutDecksLeft: 0.75, minBet: 25, maxBet: 500, midShoeEntry: 'no', csm: false };
const base = { notes: '', createdAt: AT, updatedAt: AT, status: 'ok' };

const LOG = {
  version: 2,
  casinos: [
    { ...base, id: 'c1', name: 'Golden Nugget', notes: 'Ray on swing shift watches the spread\nComps at the cage', games: [good, csm], driveMinutes: 20, location: { lat: 36.11, lon: -115.17 } },
    { ...base, id: 'c2', name: 'El Cortez', games: [deep], driveMinutes: 90 },
    { ...base, id: 'c3', name: 'Burned Palace', status: 'burned', burnedUntil: '2099-01-01', games: [{ ...good, id: 'g-burned' }] },
  ],
  sessions: [],
  settings: { startingBankroll: 10000, updatedAt: AT },
  lastExportAt: AT,
};

/** Seed the log once per test (a reload keeps what the page wrote), and set the tiny budget on every load. */
async function seed(page: Page, budget = 4000): Promise<void> {
  await page.addInitScript(
    ([k, log, b]) => {
      (window as unknown as { __bjCasinoSimBudget: number }).__bjCasinoSimBudget = b as number;
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(k as string, log as string);
        sessionStorage.setItem('seeded', '1');
      }
    },
    [KEY, JSON.stringify(LOG), budget],
  );
}

const openCasino = (page: Page) => page.locator('.tab-bar').getByRole('button', { name: 'Casino', exact: true }).click();
const back = (page: Page) => page.getByRole('button', { name: /Back$/ }).click();
const ranked = (page: Page) => page.getByTestId('games-ranked');
const rows = (page: Page) => ranked(page).getByTestId('rank-row');

/** "+$123/h" / "−$45/h" -> number. */
function money(text: string): number {
  const m = /([+−-])?\$([\d,.]+)/.exec(text);
  if (!m) throw new Error(`no dollar figure in "${text}"`);
  const v = Number(m[2]!.replace(/,/g, ''));
  return m[1] === '−' || m[1] === '-' ? -v : v;
}

test('compute all, then the ranking follows the figures; the cards say what they are', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);

  // Three games listed (the burned casino's is left out), none computed yet.
  await expect(rows(page)).toHaveCount(3);
  await expect(ranked(page)).not.toContainText('Burned Palace');
  await expect(rows(page).getByTestId('rank-ev')).toHaveText(['not computed', 'not computed', 'not computed']);
  await expect(ranked(page).getByTestId('compute-all')).toContainText('Compute all');

  // One at a time, then all done.
  await ranked(page).getByTestId('compute-all').click();
  await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(3, { timeout: 30_000 });
  await expect(ranked(page).getByTestId('rank-busy')).toHaveCount(0);
  await expect(ranked(page).getByTestId('compute-all')).toHaveCount(0);

  // Sorted by EV per hour, highest first.
  const evs = (await rows(page).getByTestId('rank-ev').allTextContents()).map(money);
  expect(evs).toEqual([...evs].sort((a, b) => b - a));
  // The shuffler machine is a flat bet into the house edge: negative, and no style badge.
  const csmRow = rows(page).and(page.locator('[data-game="g-csm"]'));
  expect(money((await csmRow.getByTestId('rank-ev').textContent())!)).toBeLessThan(0);
  await expect(csmRow.getByTestId('best-style')).toHaveCount(0);
  await expect(csmRow.getByTestId('warn-badge')).toContainText(['6:5', 'CSM']);
  // A countable game names its best style.
  await expect(rows(page).and(page.locator('[data-game="g-good"]')).getByTestId('best-style')).toHaveText(/^(Back-count|Wong out|Play all|Flat)$/);

  // The countable card: every method side by side, the profile named, the best one marked.
  await rows(page).and(page.locator('[data-game="g-good"]')).click();
  const card = page.getByTestId('game-stats');
  await expect(card).toHaveAttribute('data-state', 'current');
  await expect(card).toContainText('Stopped at the test round budget.');
  expect(await card.getByTestId('gs-method').count()).toBeGreaterThanOrEqual(6);
  await expect(card.locator('[data-testid="gs-method"][data-best="true"]')).toHaveCount(1);
  await expect(card.getByTestId('gs-profile')).toContainText('Default (6D H17)');
  await expect(card.getByTestId('gs-assumed')).toHaveCount(0);
  // The card's best EV is the ranking's figure for the game.
  const bestEv = money((await card.getByTestId('gs-best-ev').textContent())!);
  await back(page);
  expect(money((await rows(page).and(page.locator('[data-game="g-good"]')).getByTestId('rank-ev').textContent())!)).toBe(bestEv);

  // The shuffler's card: the flat house edge only, its unknown cut marked as assumed.
  await csmRow.click();
  await expect(card).toContainText('Continuous shuffler: not countable');
  await expect(card.getByTestId('gs-method')).toHaveCount(0);
  await expect(card.getByTestId('gs-assumed')).toContainText('cut');
  await back(page);

  // No mid-shoe entry at El Cortez: no back-count method was even worked out.
  await rows(page).and(page.locator('[data-game="g-deep"]')).click();
  await expect(card.getByTestId('gs-method').filter({ hasText: /back-count/i })).toHaveCount(0);

  // The results survive a reload.
  await page.reload();
  await openCasino(page);
  await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(3);
});

test('editing a rule makes the result stale; Re-run makes it current again', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  const goodRow = rows(page).and(page.locator('[data-game="g-good"]'));
  await goodRow.click();
  const card = page.getByTestId('game-stats');
  await expect(card).toHaveAttribute('data-state', 'none');
  await card.getByTestId('compute-game').click();
  await expect(card).toHaveAttribute('data-state', 'current', { timeout: 20_000 });
  const before = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).results['g-good'].key as string, STATS_KEY);
  await back(page);

  // Open Golden Nugget, two games in its editor; switch the first to S17.
  await page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' }).click();
  const editors = page.getByTestId('game-editor');
  await expect(editors).toHaveCount(2);
  await editors.nth(0).getByRole('group', { name: 'Dealer soft 17' }).getByRole('button', { name: 'Stands (S17)' }).click();
  await page.getByRole('button', { name: 'Save casino' }).click();

  // Stale in the list and on the card, the old figures still shown and marked.
  await expect(goodRow).toHaveAttribute('data-state', 'stale');
  await expect(goodRow.getByTestId('stale-badge')).toHaveText('Stale');
  await expect(goodRow).toContainText('S17');
  await goodRow.click();
  await expect(card).toHaveAttribute('data-state', 'stale');
  await expect(card.getByTestId('stale-note')).toBeVisible();
  await expect(card.getByTestId('gs-hero')).toHaveAttribute('data-stale', 'true');
  await card.getByTestId('rerun-game').click();
  await expect(card).toHaveAttribute('data-state', 'current', { timeout: 20_000 });
  const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).results['g-good'].key as string, STATS_KEY);
  expect(after).not.toBe(before);

  // Rounds per hour is applied when shown, not simulated: changing it keeps the result current.
  await back(page);
  await page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' }).click();
  await page.locator('input[name="roundsPerHour-0"]').fill('120');
  await page.getByRole('button', { name: 'Save casino' }).click();
  await expect(goodRow).toHaveAttribute('data-state', 'current');
});

test('a running compute shows its progress and can be cancelled', async ({ page }) => {
  // A budget big enough to still be running when we look.
  await seed(page, 30_000_000);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await rows(page).and(page.locator('[data-game="g-good"]')).click();
  const card = page.getByTestId('game-stats');
  await card.getByTestId('compute-game').click();
  await expect(card).toHaveAttribute('data-state', 'running');
  await expect(card.getByTestId('sim-running')).toContainText('rounds', { timeout: 10_000 });
  await expect(card.getByRole('progressbar')).toBeVisible();
  await card.getByRole('button', { name: 'Cancel' }).click();
  await expect(card).not.toHaveAttribute('data-state', 'running');
  // Enough had run to keep (>= 20,000 rounds by then, or nothing): either way the worker stopped.
  await expect(card.getByTestId('sim-running')).toHaveCount(0);
});

test.describe('distance', () => {
  test.use({ geolocation: { latitude: 36.1, longitude: -115.17 }, permissions: ['geolocation'] });

  test('live miles once "Use my location" is on, drive minutes otherwise; sort by distance', async ({ page }) => {
    await seed(page);
    await page.goto('/?e2e=1');
    await openCasino(page);
    const nugget = rows(page).and(page.locator('[data-game="g-good"]'));
    const cortez = rows(page).and(page.locator('[data-game="g-deep"]'));
    await expect(nugget).toContainText('20 min drive');
    await expect(page.getByTestId('casino-row').filter({ hasText: 'El Cortez' })).toContainText('1 h 30 min drive');

    await ranked(page).getByTestId('use-location').check();
    await expect(nugget).toContainText('0.7 mi');
    await expect(page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' })).toContainText('0.7 mi');
    // No saved spot at El Cortez: still its drive time.
    await expect(cortez).toContainText('1 h 30 min drive');

    await ranked(page).getByRole('group', { name: 'Sort games by' }).getByRole('button', { name: 'Distance' }).click();
    await expect(rows(page).first()).toHaveAttribute('data-game', /^g-(good|csm)$/);
    const order = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-game')));
    expect(order.slice(0, 2).sort()).toEqual(['g-csm', 'g-good']);
    expect(order[2]).toBe('g-deep');

    // The choice is remembered on this device.
    await page.reload();
    await openCasino(page);
    await expect(ranked(page).getByTestId('use-location')).toBeChecked();
    await expect(nugget).toContainText('0.7 mi');
  });

  test('"Save this spot" stores where you are; Clear forgets it', async ({ page }) => {
    await seed(page);
    await page.goto('/?e2e=1');
    await openCasino(page);
    await page.getByTestId('casino-row').filter({ hasText: 'El Cortez' }).click();
    await page.getByTestId('save-spot').click();
    await expect(page.getByTestId('spot-saved')).toBeVisible();
    await page.getByRole('button', { name: 'Save casino' }).click();
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).casinos[1].location, KEY);
    expect(saved).toEqual({ lat: 36.1, lon: -115.17 });

    await page.getByTestId('casino-row').filter({ hasText: 'El Cortez' }).click();
    await page.getByTestId('casino-spot').getByRole('button', { name: 'Clear' }).click();
    await page.getByRole('button', { name: 'Save casino' }).click();
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).casinos[1].location ?? null, KEY)).toBeNull();
  });
});

test('casino notes save as you type, survive a reload, and head the casino row', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await page.getByTestId('casino-row').filter({ hasText: 'El Cortez' }).click();
  const box = page.locator('textarea[name="casinoNotes"]');
  await box.click();
  await box.pressSequentially('Swing shift 2am, pit boss Ray watches\nComps at the cage', { delay: 5 });
  // Saved on the short debounce while still focused, without the text jumping.
  await expect(page.getByTestId('notes-status')).toHaveText('Saved', { timeout: 5000 });
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('Swing shift 2am, pit boss Ray watches\nComps at the cage');
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).casinos[1], KEY);
  expect(stored.notes).toBe('Swing shift 2am, pit boss Ray watches\nComps at the cage');
  expect(stored.updatedAt).not.toBe(AT);

  await page.reload();
  await openCasino(page);
  await expect(page.getByTestId('casino-row').filter({ hasText: 'El Cortez' }).getByTestId('casino-row-note')).toHaveText(
    'Swing shift 2am, pit boss Ray watches',
  );
});

for (const theme of ['midnight-felt', 'bone-ink'] as const) {
  test(`the ranking and the stats card reach 4.5:1 in ${theme}, and fit at 320`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await withSettings(page, { theme });
    await seed(page);
    await page.goto('/?e2e=1');
    await openCasino(page);
    await ranked(page).getByTestId('compute-all').click();
    await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(3, { timeout: 30_000 });
    const bad: string[] = [];
    const check = async (sels: string[]) => {
      for (const sel of sels) {
        const ratio = await worstContrast(page, sel);
        if (ratio < 4.5) bad.push(`${sel} ${ratio.toFixed(2)}`);
      }
    };
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await check(['.cas-rank-row:not([data-greyed]) .cas-rank-meta', '.cas-rank-place', '.cas-rank-row [data-testid="best-style"]', '.cas-row-note', '.cas-rank-controls .cas-note']);
    expect(await fits()).toBeLessThanOrEqual(0);
    await rows(page).and(page.locator('[data-game="g-good"]')).click();
    await check(['.cas-gs-sub', '.cas-gs-fig dt', '.cas-gs-fig-sub', '.cas-gs-fig dd[data-sign="1"]', '.cas-gs-fig dd[data-sign="-1"]', '.cas-gs-notes', '.cas-gs-state']);
    expect(await fits()).toBeLessThanOrEqual(0);
    expect(bad, `low contrast in ${theme}`).toEqual([]);
  });
}
