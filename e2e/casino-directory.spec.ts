import { test, expect, type Page } from '@playwright/test';

/**
 * Wave W: the Casino tab as a directory of casinos and their rules (owner:
 * "a repository of all the casinos I put in there and their rules and
 * everything"). Search and sort, a page per casino with every game's full
 * rules, Paste JSON beside Import JSON, Copy JSON beside Export JSON, and
 * the live session one part over.
 */

test.use({ viewport: { width: 375, height: 812 } });

const KEY = 'bjtrainer.casinoLog.v2';
const AT = '2026-10-01T00:00:00.000Z';
const base = { createdAt: AT, updatedAt: AT, status: 'ok' };
const nugget = {
  id: 'g-nug', label: 'Main pit', decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1.5, minBet: 25, maxBet: 1000,
  midShoeEntry: 'no', csm: false, maxSplitHands: 4, doubleOn: 'any2', unsure: ['das'], notes: 'Pit 3 deals deepest',
  sideBets: [{ bet: 'luckyLadies', payTable: 'll-a', minBet: 5, maxBet: 100 }],
};
const LOG = {
  version: 2,
  casinos: [
    { ...base, id: 'c1', name: 'Golden Nugget', area: 'Downtown', notes: 'Ray on swing shift', games: [nugget], driveMinutes: 20 },
    { ...base, id: 'c2', name: 'Aria', area: 'Strip', notes: '', games: [{ id: 'g-aria', decks: 8, s17: true, midShoeEntry: 'unknown', csm: true }], miles: 4 },
    { ...base, id: 'c3', name: 'Bicycle', kind: 'cardroom', notes: '', games: [{ id: 'g-bike', variant: 'freebet', commissionPer100: 1, midShoeEntry: 'unknown', csm: false }], driveMinutes: 45 },
  ],
  sessions: [],
  settings: { startingBankroll: null, updatedAt: null },
  lastExportAt: AT,
};

async function seed(page: Page, log: unknown = LOG): Promise<void> {
  await page.addInitScript(
    ([k, l]) => {
      (window as unknown as { __bjCasinoSimBudget: number }).__bjCasinoSimBudget = 2000;
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(k as string, l as string);
        sessionStorage.setItem('seeded', '1');
      }
    },
    [KEY, JSON.stringify(log)],
  );
}

const openCasino = (page: Page) => page.locator('.tab-bar').getByRole('button', { name: 'Casino', exact: true }).click();
const names = (page: Page) => page.getByTestId('casino-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-casino')));
const search = (page: Page) => page.locator('input[name="casinoSearch"]');
const sortBy = (page: Page, label: string) => page.getByRole('group', { name: 'Sort casinos by' }).getByRole('button', { name: label, exact: true }).click();
const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY);

test('Casinos is the default part: every casino with every game rules line, searchable, in four orders kept on this device', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await expect(page.getByTestId('casino-seg-casinos')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('casino-dir-count')).toHaveText('3 casinos');
  const row = page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' });
  await expect(row.getByTestId('casino-row-game')).toContainText('Main pit: 6D H17 DAS? LS 3:2');
  await expect(row.getByTestId('casino-row-game')).toContainText('$25–$1,000 · No mid-shoe · Side: Lucky Ladies');
  await expect(page.getByTestId('casino-row').filter({ hasText: 'Bicycle' }).getByTestId('kind-badge')).toBeVisible();

  // Search reaches the rules, the side bets, the notes and the kind, every word.
  for (const [q, want] of [
    ['lucky', ['Golden Nugget']],
    ['ray', ['Golden Nugget']],
    ['csm', ['Aria']],
    ['free bet', ['Bicycle']],
    ['card room', ['Bicycle']],
    ['strip 8d', ['Aria']],
  ] as const) {
    await search(page).fill(q);
    await expect.poll(() => names(page), q).toEqual(want);
  }
  await search(page).fill('nowhere at all');
  await expect(page.getByTestId('casino-dir-none')).toHaveText('No casino matches “nowhere at all”.');
  await expect(page.getByTestId('casino-dir-count')).toHaveText('0 of 3 casinos match');
  await page.getByRole('button', { name: 'Clear the search' }).click();
  await expect(search(page)).toHaveValue('');
  await expect(page.getByTestId('casino-row')).toHaveCount(3);

  await sortBy(page, 'A–Z');
  await expect.poll(() => names(page)).toEqual(['Aria', 'Bicycle', 'Golden Nugget']);
  // 4 miles is nearer than a 20-minute drive at the assumed speed? Distance uses one scale; the 45-minute drive is last.
  await sortBy(page, 'Distance');
  const byDistance = await names(page);
  expect(byDistance[byDistance.length - 1]).toBe('Bicycle');
  // EV: the variant game is never worked out, so the card room sorts after both casinos with figures.
  await sortBy(page, 'EV/h');
  await expect(page.getByTestId('casino-row-ev')).toHaveCount(3);
  await expect(page.getByTestId('casino-row').filter({ hasText: 'Bicycle' }).getByTestId('casino-row-ev')).toHaveText('—');
  await expect.poll(async () => (await names(page))[2], { timeout: 30_000 }).toBe('Bicycle');
  // Review S1: the figure carries its interval, as on Ranked.
  await expect(page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' }).getByTestId('casino-row-ev')).toContainText(/[+−]\$[\d,]+ ±\$\d[\d,]*\/h/, { timeout: 30_000 });

  await page.reload();
  await openCasino(page);
  await expect(page.getByRole('group', { name: 'Sort casinos by' }).getByRole('button', { name: 'EV/h' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('bjtrainer.casinoDirSort.v1'))).toBe('ev');
});

test("a casino's page: every rule, the unknowns and ? marks, side bets, notes, figures; Edit and Back come home to it", async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' }).click();
  const detail = page.getByTestId('casino-detail');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Golden Nugget');
  await expect(detail.getByTestId('casino-detail-meta')).toHaveText('Downtown · 20 min drive · never visited');
  await expect(detail.getByTestId('casino-detail-totals')).toHaveText('Never played here yet.');
  await expect(detail.locator('textarea[name="casinoNotes"]')).toHaveValue('Ray on swing shift');

  const game = detail.getByTestId('detail-game');
  await expect(game.getByRole('heading', { name: 'Main pit' })).toBeVisible();
  const rule = (field: string) => game.locator(`.cas-rule[data-field="${field}"] dd`);
  await expect(rule('decks')).toHaveText('6');
  await expect(rule('s17')).toHaveText('Hits (H17)');
  await expect(rule('das')).toHaveText('Yes ? (not sure)');
  await expect(rule('cutDecksLeft')).toHaveText('1.5 decks left (75% dealt)');
  await expect(rule('doubleOn')).toHaveText('Any two cards');
  await expect(rule('rsa')).toHaveText('Not logged');
  await expect(game.locator('.cas-rule[data-field="rsa"]')).toHaveAttribute('data-unknown', 'true');
  await expect(rule('midShoeEntry')).toHaveText('Not allowed');
  await expect(game.getByTestId('detail-side-bets')).toHaveText('Lucky Ladies (Table A (1000/125/19/9/4)) $5–$100');
  await expect(game).toContainText('Pit 3 deals deepest');
  // Review S1: the figure with its interval (a verdict only when all of it is one side of zero), the edge beside it.
  await expect(game.getByTestId('detail-figures')).toHaveText(/^(about break-even, )?[+−]\$[\d,]+ ±\$\d[\d,]*\/h$/, { timeout: 30_000 });
  await expect(game.getByTestId('detail-figures-sub')).toContainText(/edge −?\d+\.\d\d%/);

  // Figures opens the game's card; Back returns to this page.
  await game.getByRole('button', { name: 'Figures' }).click();
  await expect(page.getByTestId('game-stats')).toBeVisible();
  await page.getByRole('button', { name: /Back$/ }).click();
  await expect(detail).toBeVisible();

  // Edit, change a rule, Save: back on the page, showing it.
  await page.getByRole('button', { name: 'Edit casino', exact: true }).click();
  await page.getByTestId('game-editor').first().getByRole('group', { name: 'Dealer soft 17' }).getByRole('button', { name: 'Stands (S17)' }).click();
  await page.getByRole('button', { name: 'Save casino' }).click();
  await expect(detail).toBeVisible();
  await expect(rule('s17')).toHaveText('Stands (S17)');
  // Edit then Back: the page again.
  await page.getByRole('button', { name: 'Edit casino', exact: true }).click();
  await page.getByRole('button', { name: /Back$/ }).click();
  await expect(detail).toBeVisible();
  // Back: the directory, as it was left.
  await page.getByRole('button', { name: /Back$/ }).click();
  await expect(page.getByTestId('casino-directory')).toBeVisible();

  // Deleting from the form opened on the page lands home, not on a page for nothing.
  await page.getByTestId('casino-row').filter({ hasText: 'Aria' }).click();
  await page.getByRole('button', { name: 'Edit casino', exact: true }).click();
  await page.getByRole('button', { name: 'Delete casino' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByTestId('casino-directory')).toBeVisible();
  await expect(page.getByTestId('casino-row')).toHaveCount(2);
});

test('Paste JSON runs the same merge as Import JSON, and says why a bad paste is refused', async ({ page }) => {
  await seed(page, { ...LOG, casinos: [LOG.casinos[0]] });
  await page.goto('/?e2e=1');
  await openCasino(page);
  await page.getByRole('button', { name: 'Paste JSON' }).click();
  const box = page.getByTestId('casino-paste-text');
  await page.getByTestId('casino-paste-import').click();
  await expect(page.getByRole('status').filter({ hasText: 'Paste' })).toHaveText('Paste the text of a casino log file first.');
  await box.fill('{"not": "a log"');
  await page.getByTestId('casino-paste-import').click();
  await expect(page.getByRole('status').filter({ hasText: 'Import failed' })).toBeVisible();
  // Refused: nothing changed, the text is still there to fix.
  await expect(box).toHaveValue('{"not": "a log"');
  expect((await stored(page)).casinos).toHaveLength(1);

  const file = { app: 'bjtrainer-casino-log', version: 2, exportedAt: AT, ...LOG };
  await box.fill(JSON.stringify(file));
  await page.getByTestId('casino-paste-import').click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toHaveText(
    'Imported: 2 casinos added, 0 updated, 0 sessions added, 0 updated, 1 already up to date.',
  );
  await expect(page.getByTestId('casino-paste')).toHaveCount(0);
  await expect(page.getByTestId('casino-row')).toHaveCount(3);
  // Kept in the v2 format, under its key.
  const after = await stored(page);
  expect(after.version).toBe(2);
  expect(after.casinos.map((c: { name: string }) => c.name).sort()).toEqual(['Aria', 'Bicycle', 'Golden Nugget']);

  // The same text through the file picker merges the same way: nothing new.
  await page.getByTestId('casino-import-file').setInputFiles({ name: 'log.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toHaveText(
    'Imported: 0 casinos added, 0 updated, 0 sessions added, 0 updated, 3 already up to date.',
  );
});

test('Copy JSON puts the whole log on the clipboard, and it pastes back in', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await page.getByRole('button', { name: 'Copy JSON' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toHaveText('Copied: 3 casinos and 0 sessions, as JSON.');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = JSON.parse(text);
  expect(parsed.app).toBe('bjtrainer-casino-log');
  expect(parsed.casinos.map((c: { name: string }) => c.name).sort()).toEqual(['Aria', 'Bicycle', 'Golden Nugget']);

  // Wiped, then the copied text pasted back: everything returns.
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.reload();
  await openCasino(page);
  await expect(page.getByRole('heading', { name: 'Your casinos and their rules' })).toBeVisible();
  await page.getByRole('button', { name: 'Paste JSON' }).click();
  await page.getByTestId('casino-paste-text').fill(text);
  await page.getByTestId('casino-paste-import').click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toContainText('3 casinos added');
  expect((await stored(page)).casinos).toEqual(parsed.casinos);
});

test('without a clipboard, Copy JSON shows the text to select instead of claiming a copy', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await page.getByRole('button', { name: 'Copy JSON' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copy' })).toHaveText('Copy failed here: select the text below and copy it.');
  const shown = JSON.parse(await page.getByTestId('casino-copy-text').inputValue());
  expect(shown.casinos).toHaveLength(3);
});

test('a running session opens on Sessions; Casinos carries a strip back to it', async ({ page }) => {
  const started = new Date(Date.now() - 20 * 60_000).toISOString();
  const session = { id: 's1', casinoId: 'c1', start: started, end: null, buyIns: [500], cashOut: null, heat: 'none', notes: '', createdAt: started, updatedAt: started };
  await seed(page, { ...LOG, sessions: [session] });
  await page.goto('/?e2e=1');
  await openCasino(page);
  await expect(page.getByTestId('casino-seg-sessions')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('casino-seg-sessions')).toHaveAccessibleName('Sessions (running)');
  await expect(page.getByTestId('casino-live')).toBeVisible();
  await page.getByTestId('casino-seg-casinos').click();
  await expect(page.getByTestId('casino-live')).toHaveCount(0);
  await expect(page.getByTestId('casino-live-strip')).toHaveText(/Session running at Golden Nugget/);
  await page.getByTestId('casino-live-strip').click();
  await expect(page.getByTestId('casino-live')).toBeVisible();
});

for (const width of [375, 320]) {
  test(`${width}: the parts, the directory and a casino page fit with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 812 });
    await seed(page);
    await page.goto('/?e2e=1');
    await openCasino(page);
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    // The three part labels and four sort labels each sit inside their button, on one line.
    const clipped = await page.locator('.cas-seg .segmented-btn, .cas-dir-controls .segmented-btn').evaluateAll((els) =>
      els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().height > 60).map((e) => e.textContent),
    );
    expect(clipped).toEqual([]);
    expect(await fits()).toBeLessThanOrEqual(0);
    await page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' }).click();
    await expect(page.getByTestId('detail-rules')).toBeVisible();
    expect(await fits()).toBeLessThanOrEqual(0);
  });
}

/*
 * Review S1: at a continuous shuffler there is no count to play, so a short
 * run's noise must never read as a profit. The runs are seeded from their
 * inputs, so this run is the same every time; the wording is checked against
 * the figures the page itself shows.
 */
test('a CSM game reads "No counting edge" with its interval, on its page and its directory row, never a bare +$', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await sortBy(page, 'EV/h');
  const ev = page.getByTestId('casino-row').filter({ hasText: 'Aria' }).getByTestId('casino-row-ev');
  await expect(ev).toContainText('No counting edge', { timeout: 30_000 });
  const rowText = (await ev.locator('.cas-dir-ev-text').textContent())!;
  expect(rowText).toMatch(/^No counting edge · (about break-even ±\$\d[\d,]*\/h|loses \$[\d,]+\/h( ±\$\d[\d,]*)?)$/);
  // The run is short here: it is marked as such.
  await expect(ev.getByTestId('figure-partial').or(ev.getByTestId('figure-estimate'))).toBeVisible();

  await page.getByTestId('casino-row').filter({ hasText: 'Aria' }).click();
  const line = page.getByTestId('detail-figures');
  await expect(line).toHaveText(rowText);
  expect(rowText).not.toContain('+$');
  await expect(page.getByTestId('detail-figures-sub')).toContainText(/edge −?\d+\.\d\d% ±\d+\.\d\d%/);
});
