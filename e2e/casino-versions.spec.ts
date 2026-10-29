import { test, expect, type Page } from '@playwright/test';

/**
 * Wave W (review S2): versions of a game. The owner: "When I do adjust the
 * rules I want a new 'version' of the casino made so previous data on it is
 * saved for the old versions." A v2 log (the build before) migrates with
 * every session kept; a rule change on a version with sessions or figures
 * asks; "New version" keeps the old rules with their sessions and figures
 * under Earlier versions; "Fix this version" corrects in place; a session
 * records the game and version it was played at.
 */

// The dates on the page are local: pinned to the owner's zone, so the seeded days read as themselves.
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'America/Los_Angeles' });

const KEY = 'bjtrainer.casinoLog.v3';
const PREV_KEY = 'bjtrainer.casinoLog.v2';
const AT = '2026-10-01T19:00:00.000Z';
const base = { createdAt: AT, updatedAt: AT, status: 'ok', notes: '' };
const nugget = {
  id: 'g-nug', label: 'Main pit', decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1.5, minBet: 25, maxBet: 1000,
  midShoeEntry: 'no', csm: false,
};
const sess = (id: string, casinoId: string, day: number, cashOut: number) => {
  const start = `2026-10-0${day}T18:00:00.000Z`;
  const end = `2026-10-0${day}T21:00:00.000Z`;
  return { id, casinoId, start, end, buyIns: [500], cashOut, heat: 'none', notes: '', createdAt: start, updatedAt: end };
};
/** As the build before versions stored it: version 2, under the v2 key. */
const V2 = {
  version: 2,
  casinos: [
    { ...base, id: 'c1', name: 'Golden Nugget', games: [nugget] },
    {
      ...base,
      id: 'c2',
      name: 'Two Pits',
      games: [
        { id: 'g-shoe', label: 'Shoe', decks: 6, s17: true, midShoeEntry: 'unknown', csm: false },
        { id: 'g-dd', label: 'Double deck', decks: 2, s17: false, midShoeEntry: 'no', csm: false },
      ],
    },
    { ...base, id: 'c3', name: 'Bicycle', kind: 'cardroom', games: [{ id: 'g-bike', variant: 'freebet', commissionPer100: 1, midShoeEntry: 'unknown', csm: false }] },
  ],
  sessions: [sess('s1', 'c1', 2, 800), sess('s2', 'c1', 3, 400), sess('s3', 'c2', 4, 650)],
  settings: { startingBankroll: null, updatedAt: null },
  lastExportAt: AT,
};

async function seedV2(page: Page): Promise<void> {
  await page.addInitScript(
    ([k, l]) => {
      (window as unknown as { __bjCasinoSimBudget: number }).__bjCasinoSimBudget = 2000;
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(k as string, l as string);
        sessionStorage.setItem('seeded', '1');
      }
    },
    [PREV_KEY, JSON.stringify(V2)],
  );
}

const openCasino = (page: Page) => page.locator('.tab-bar').getByRole('button', { name: 'Casino', exact: true }).click();
const openPage = async (page: Page, name: string) => {
  await page.getByTestId('casino-seg-casinos').click();
  await page.getByTestId('casino-row').filter({ hasText: name }).click();
  await expect(page.getByTestId('casino-detail')).toHaveAttribute('data-casino', name);
};
const read = (page: Page, k: string) => page.evaluate((key) => localStorage.getItem(key), k);
const stored = async (page: Page) => JSON.parse((await read(page, KEY))!);
const figures = (page: Page) => page.getByTestId('detail-figures').first();
const back = (page: Page) => page.getByRole('button', { name: /Back$/ }).click();

test('a v2 log migrates with every session; "New version" keeps the old rules with their sessions and figures under Earlier versions', async ({ page }) => {
  await seedV2(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await openPage(page, 'Golden Nugget');
  await expect(page.getByTestId('detail-session')).toHaveCount(2);
  await expect(page.getByTestId('earlier-versions')).toHaveCount(0);
  // The figures for the rules as they are, before they change.
  await expect(figures(page)).not.toHaveText('Figures being worked out…', { timeout: 30_000 });
  const before = await figures(page).textContent();

  // Edit rules: surrender gone, the min bet up. The version holds two sessions and figures: Save asks.
  await page.getByTestId('edit-rules').click();
  const editor = page.locator('[data-testid="game-editor"][data-game="g-nug"]');
  await editor.getByRole('group', { name: 'Late surrender' }).getByRole('button', { name: 'No', exact: true }).click();
  await editor.locator('input[name="minBet-0"]').fill('50');
  // At 320 the question is scrolled to, its heading clear of the sticky top bar.
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('button', { name: 'Save casino' }).click();
  const prompt = page.getByTestId('version-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole('heading')).toBeFocused();
  const bar = (await page.locator('.casino-topbar').boundingBox())!;
  const head = (await prompt.getByRole('heading').boundingBox())!;
  expect(head.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(prompt.getByTestId('version-ask')).toHaveCount(1);
  await expect(prompt.locator('.cas-ver-changes li')).toHaveText(['Late surrender: Yes → No', 'Min bet: $25 → $50']);
  // New version is the default; its hint says what it keeps.
  await expect(prompt.getByTestId('version-new')).toHaveAttribute('aria-pressed', 'true');
  await expect(prompt.getByTestId('version-fix')).toHaveAttribute('aria-pressed', 'false');
  await expect(prompt.getByTestId('version-new')).toContainText('The old rules keep their 2 sessions and figures, under Earlier versions.');
  await prompt.getByRole('button', { name: 'Save casino' }).click();

  // Back on the page: the new rules, and the old ones with their sessions and their own figures.
  const detail = page.getByTestId('casino-detail');
  await expect(detail).toBeVisible();
  await expect(detail.locator('.cas-rule[data-field="surrender"] dd')).toHaveText('No');
  await expect(page.getByTestId('current-version')).toContainText('No sessions at these rules.');
  const earlier = page.getByTestId('earlier-version');
  await expect(earlier).toHaveCount(1);
  await expect(earlier.locator('.cas-ver-dates')).toHaveText(/^1 Oct 2026 – \d+ \w{3,4} 2026$/);
  await expect(earlier.getByTestId('earlier-version-changes')).toContainText('Late surrender: Yes → No; Min bet: $25 → $50.');
  await expect(earlier.getByTestId('earlier-version-sessions')).toHaveText('2 sessions · +$200 over 6.0 h');
  await expect(earlier.getByTestId('earlier-version-session')).toHaveCount(2);
  // Its figures are the old rules' own -- the ones the page showed before the change.
  await expect(earlier.getByTestId('earlier-version-figures').locator('.cas-ver-figure-text')).toHaveText(before!);
  // The casino's sessions are all still here.
  await expect(page.getByTestId('detail-session')).toHaveCount(2);

  // Stored: v3 under its own key, the v2 bytes untouched (the backup), every session kept and attached to version 1.
  expect(await read(page, PREV_KEY)).toBe(JSON.stringify(V2));
  const log = await stored(page);
  expect(log.version).toBe(3);
  const g = log.casinos[0].games[0];
  expect(g.versions.map((v: { versionId: string }) => v.versionId)).toEqual(['g-nug-v1', g.versionId]);
  expect(g.versions[0].rules).toMatchObject({ surrender: true, minBet: 25 });
  expect(log.sessions.map((s: { id: string; versionId?: string }) => [s.id, s.versionId ?? null])).toEqual([
    ['s1', 'g-nug-v1'],
    ['s2', 'g-nug-v1'],
    ['s3', null],
  ]);

  // An earlier version's session opens, and Back comes to the page.
  await earlier.getByTestId('earlier-version-session').first().click();
  await expect(page.getByTestId('session-form')).toBeVisible();
  await back(page);
  await expect(detail).toBeVisible();
});

test('"Fix this version" corrects in place; a version with no sessions or figures is never asked about; Back to editing keeps the form', async ({ page }) => {
  await seedV2(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await openPage(page, 'Golden Nugget');
  await page.getByTestId('edit-rules').click();
  const editor = page.locator('[data-testid="game-editor"][data-game="g-nug"]');
  await editor.getByRole('group', { name: 'Double after split' }).getByRole('button', { name: 'No', exact: true }).click();
  await page.getByRole('button', { name: 'Save casino' }).click();
  const prompt = page.getByTestId('version-prompt');
  // Back to editing: the form as it was, the question gone; an edit asks again.
  await prompt.getByRole('button', { name: 'Back to editing' }).click();
  await expect(prompt).toHaveCount(0);
  await editor.getByRole('group', { name: 'Late surrender' }).getByRole('button', { name: 'No', exact: true }).click();
  await page.getByRole('button', { name: 'Save casino' }).click();
  await expect(prompt.locator('.cas-ver-changes li')).toHaveText(['Double after split: Yes → No', 'Late surrender: Yes → No']);
  await prompt.getByTestId('version-fix').click();
  await expect(prompt.getByTestId('version-fix')).toHaveAttribute('aria-pressed', 'true');
  await expect(prompt.getByTestId('version-fix')).toContainText('The 2 sessions stay, with the rules corrected.');
  await prompt.getByRole('button', { name: 'Save casino' }).click();
  await expect(page.getByTestId('casino-detail')).toBeVisible();
  await expect(page.getByTestId('earlier-versions')).toHaveCount(0);
  let g = (await stored(page)).casinos[0].games[0];
  expect(g.versionId).toBe('g-nug-v1');
  expect(g.versions).toHaveLength(1);
  expect(g.versions[0].rules).toMatchObject({ das: false, surrender: false });

  // A variant game is never simulated and Bicycle has no sessions: its version holds nothing, so Save just saves.
  await back(page);
  await openPage(page, 'Bicycle');
  await page.getByTestId('edit-rules').click();
  await page.locator('input[name="commission-0"]').fill('2');
  await page.getByRole('button', { name: 'Save casino' }).click();
  await expect(page.getByTestId('casino-detail')).toBeVisible();
  g = (await stored(page)).casinos[2].games[0];
  expect(g.versions).toHaveLength(1);
  expect(g.versions[0].rules.commissionPer100).toBe(2);
});

test('a session records its game and version: one tap at a casino of one game, which game at several; a v2 session there can be told which', async ({ page }) => {
  await seedV2(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  // At a casino of several: the tap asks which game.
  await page.getByTestId('casino-seg-sessions').click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.getByTestId('start-at').filter({ hasText: 'Two Pits' }).click();
  const games = page.getByTestId('start-games');
  await expect(games.getByTestId('start-game')).toHaveText([/^Shoe: 6D/, /^Double deck: 2D/]);
  await expect(games.getByTestId('start-several')).toBeVisible();
  await games.locator('[data-game="g-dd"]').click();
  await expect(page.getByTestId('casino-screen')).toHaveAttribute('data-view', 'home');
  const started = (await stored(page)).sessions.find((s: { end: string | null }) => s.end === null);
  expect(started).toMatchObject({ casinoId: 'c2', gameId: 'g-dd', versionId: 'g-dd-v1' });

  // The v2 session at Two Pits never said which game: its edit form can.
  await openPage(page, 'Two Pits');
  await page.getByTestId('detail-session').filter({ hasText: '+$150' }).click();
  const pick = page.locator('select[name="gameId"]');
  await expect(pick).toHaveValue('');
  await pick.selectOption('g-shoe');
  await page.getByRole('button', { name: 'Save session' }).click();
  const s3 = (await stored(page)).sessions.find((s: { id: string }) => s.id === 's3');
  expect(s3).toMatchObject({ gameId: 'g-shoe', versionId: 'g-shoe-v1' });
});

/*
 * Controller ruling: only sessions (logged results) make a rule change ask.
 * A game with sim figures and no sessions is edited in place, its old
 * figures kept in the archive under their spec key.
 */
test('a game with figures but no sessions is fixed in place without asking; its old figures stay archived', async ({ page }) => {
  await seedV2(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await openPage(page, 'Two Pits');
  // The v2 session at Two Pits is casino-level, so the double deck holds no session -- only figures, once worked out.
  const dd = page.locator('[data-testid="detail-game"][data-game="g-dd"]');
  await expect(dd.getByTestId('detail-figures')).not.toHaveText('Figures being worked out…', { timeout: 30_000 });
  const cache = () => page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.casinoGameStats.v1') ?? '{}'));
  await expect.poll(async () => (await cache()).results?.['g-dd']?.key ?? null, { timeout: 30_000 }).not.toBeNull();
  const oldKey: string = (await cache()).results['g-dd'].key;

  await dd.getByTestId('edit-rules').click();
  const editor = page.locator('[data-testid="game-editor"][data-game="g-dd"]');
  await editor.getByRole('group', { name: 'Dealer soft 17' }).getByRole('button', { name: /^Stands/ }).click();
  await page.getByRole('button', { name: 'Save casino' }).click();
  await expect(page.getByTestId('casino-detail')).toBeVisible();
  await expect(page.getByTestId('version-prompt')).toHaveCount(0);
  const g = (await stored(page)).casinos[1].games[1];
  expect(g.versions).toHaveLength(1);
  expect(g.s17).toBe(true);
  // The new rules are worked out afresh; the old figures sit in the archive under their key.
  await expect.poll(async () => (await cache()).results?.['g-dd']?.key, { timeout: 30_000 }).not.toBe(oldKey);
  expect(Object.keys((await cache()).archive ?? {})).toContain(oldKey);
});
