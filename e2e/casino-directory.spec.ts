import { test, expect, type Page } from '@playwright/test';

/**
 * Wave W: the Casino tab as a directory of casinos and their rules (owner:
 * "a repository of all the casinos I put in there and their rules and
 * everything"). Search and sort, a page per casino with every game's full
 * rules, Paste JSON beside Import JSON, Copy JSON beside Export JSON, and
 * the live session one part over.
 */

test.use({ viewport: { width: 375, height: 812 } });

const KEY = 'bjtrainer.casinoLog.v3';
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
/**
 * Save the form. Review S2: when the version changed holds sessions or
 * figures, Save asks whether the casino changed the rules; these tests fix
 * a rule entered wrong, so "Fix this version". Whether figures have landed
 * by then depends on the simulator's pace, so the question is answered only
 * when it is asked.
 */
async function saveFixing(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save casino' }).click();
  const prompt = page.getByTestId('version-prompt');
  await expect(prompt.or(page.locator('[data-testid="casino-screen"]:not([data-view="casino"])'))).toBeVisible();
  if (await prompt.isVisible()) {
    await prompt.getByTestId('version-fix').click();
    await prompt.getByRole('button', { name: 'Save casino' }).click();
  }
}

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
  // Review S5: the whole order, by the figures shown -- best first, once both casinos have one.
  const evOf = (name: string) =>
    page.getByTestId('casino-row').filter({ hasText: name }).getByTestId('casino-row-ev').getAttribute('data-ev').then((v) => (v === null ? null : Number(v)));
  await expect.poll(async () => [await evOf('Golden Nugget'), await evOf('Aria')].every((v) => v !== null), { timeout: 30_000 }).toBe(true);
  const [nug, aria] = [(await evOf('Golden Nugget'))!, (await evOf('Aria'))!];
  expect(nug).not.toBe(aria);
  await expect.poll(() => names(page)).toEqual([...(nug > aria ? ['Golden Nugget', 'Aria'] : ['Aria', 'Golden Nugget']), 'Bicycle']);
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
  await saveFixing(page);
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
  // Review S3: first what it would do, nothing saved until Import.
  const preview = page.getByTestId('import-preview');
  await expect(preview.getByTestId('import-added')).toHaveText('Adds 2 casinos: Aria, Bicycle');
  await expect(preview.getByTestId('import-unchanged')).toHaveText('Already here: 1 casino');
  await expect(preview.getByTestId('import-sessions')).toHaveText('Sessions: 0 added, 0 updated');
  expect((await stored(page)).casinos).toHaveLength(1);
  await page.getByTestId('import-confirm').click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toHaveText(
    'Imported: 2 casinos added, 0 updated, 0 sessions added, 0 updated, 1 already up to date.',
  );
  await expect(page.getByTestId('casino-paste')).toHaveCount(0);
  await expect(page.getByTestId('casino-row')).toHaveCount(3);
  // Kept in this build's format (v3 since game versions), under its key.
  const after = await stored(page);
  expect(after.version).toBe(3);
  expect(after.casinos.map((c: { name: string }) => c.name).sort()).toEqual(['Aria', 'Bicycle', 'Golden Nugget']);

  // The same text through the file picker merges the same way: nothing new.
  await page.getByTestId('casino-import-file').setInputFiles({ name: 'log.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByTestId('import-preview').getByRole('heading')).toHaveText('Nothing new in it');
  await page.getByTestId('import-confirm').click();
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
  await page.getByTestId('import-confirm').click();
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

/*
 * Review S2: every place that shows a game's rules opens them for editing --
 * the casino page's game card and the game's stats card (reached from Ranked
 * too) -- at that game's block, and Save returns where it was opened. A rule
 * set clears its own "?" and no other.
 */
test('"Edit rules" on a game card and a stats card opens the form at that game, returns there, and clears only the ? it sets', async ({ page }) => {
  const two = { id: 'g-two', label: 'Double deck', decks: 2, s17: false, das: false, midShoeEntry: 'no', csm: false, unsure: ['decks', 's17'] };
  const nug = { ...nugget, unsure: ['das', 's17', 'minBet'] };
  await seed(page, { ...LOG, casinos: [{ ...LOG.casinos[0], games: [nug, two] }, LOG.casinos[2]] });
  await page.goto('/?e2e=1');
  await openCasino(page);
  await page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' }).click();
  const card = (id: string) => page.locator(`[data-testid="detail-game"][data-game="${id}"]`);
  const marks = (id: string) => card(id).locator('.cas-rule:has(.cas-rule-unsure)').evaluateAll((els) => els.map((e) => e.getAttribute('data-field')));
  expect(await marks('g-nug')).toEqual(['s17', 'das', 'minBet']);

  // The second game's card: the form opens at its block.
  await card('g-two').getByTestId('edit-rules').click();
  const editor = page.locator('[data-testid="game-editor"][data-game="g-two"]');
  await expect(editor).toBeInViewport();
  await expect(editor.locator('.cas-ge-title')).toBeFocused();
  await editor.getByRole('group', { name: 'Dealer soft 17' }).getByRole('button', { name: 'Stands (S17)' }).click();
  await saveFixing(page);
  await expect(page.getByTestId('casino-detail')).toBeVisible();
  expect(await marks('g-two')).toEqual(['decks']);
  expect(await marks('g-nug')).toEqual(['s17', 'das', 'minBet']);

  // The first game's stats card, from Ranked: Edit rules, set the DAS and the min bet, Save -- back on the card.
  await page.getByRole('button', { name: /Back$/ }).click();
  await page.getByRole('tab', { name: /Ranked/ }).click();
  await page.locator('[data-testid="rank-row"][data-game="g-nug"]').click();
  await expect(page.getByTestId('game-stats')).toBeVisible();
  await page.getByTestId('game-stats').getByTestId('edit-rules').click();
  const first = page.locator('[data-testid="game-editor"][data-game="g-nug"]');
  await expect(first.locator('.cas-ge-title')).toBeFocused();
  await first.getByRole('group', { name: 'Double after split' }).getByRole('button', { name: 'No', exact: true }).click();
  await first.locator('input[name="minBet-0"]').fill('50');
  await saveFixing(page);
  await expect(page.getByTestId('game-stats')).toBeVisible();
  await expect(page.getByTestId('game-stats').locator('.cas-gs-title')).toContainText('NDAS');
  // Back from the card: Ranked, where it was opened.
  await page.getByRole('button', { name: /Back$/ }).click();
  await expect(page.getByTestId('games-ranked')).toBeVisible();
  const games = (await stored(page)).casinos[0].games as { id: string; unsure?: string[]; das: boolean; minBet: number }[];
  expect(games.find((g) => g.id === 'g-nug')).toMatchObject({ das: false, minBet: 50, unsure: ['s17'] });
  expect(games.find((g) => g.id === 'g-two')!.unsure).toEqual(['decks']);

  // A variant's card has it too, and the form returns to it.
  await page.getByRole('tab', { name: /Casinos/ }).click();
  await page.getByTestId('casino-row').filter({ hasText: 'Bicycle' }).click();
  await page.getByTestId('detail-game').getByRole('button', { name: 'Figures' }).click();
  await expect(page.getByTestId('game-stats')).toHaveAttribute('data-state', 'variant');
  await page.getByTestId('game-stats').getByTestId('edit-rules').click();
  await expect(page.locator('[data-testid="game-editor"][data-game="g-bike"] .cas-ge-title')).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('game-stats')).toHaveAttribute('data-state', 'variant');
});

/*
 * Review S7: the form opened from a casino's page returns there, even after
 * a detour into one of its sessions or a game's card and Back.
 */
test("the form keeps where it returns through a session and a game's card: Back, then Save, lands on the casino's page", async ({ page }) => {
  const start = '2026-10-02T18:00:00.000Z';
  const end = '2026-10-02T21:00:00.000Z';
  const session = { id: 's1', casinoId: 'c1', start, end, buyIns: [500], cashOut: 800, heat: 'none', notes: '', createdAt: start, updatedAt: end };
  await seed(page, { ...LOG, casinos: [LOG.casinos[0]], sessions: [session] });
  await page.goto('/?e2e=1');
  await openCasino(page);
  await page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' }).click();
  const detail = page.getByTestId('casino-detail');
  const back = () => page.getByRole('button', { name: /Back$/ }).click();

  // Page → Edit → a session in "Sessions here" → Back → the form → Save: the page.
  await page.getByRole('button', { name: 'Edit casino', exact: true }).click();
  await page.getByTestId('casino-form').locator('.cas-hist').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit session');
  await back();
  await expect(page.getByTestId('casino-form')).toBeVisible();
  await page.getByRole('button', { name: 'Save casino' }).click();
  await expect(detail).toBeVisible();

  // Page → Edit → "Stats ›" → Back → the form → Back: the page.
  await page.getByRole('button', { name: 'Edit casino', exact: true }).click();
  await page.getByTestId('game-stats-link').click();
  await expect(page.getByTestId('game-stats')).toBeVisible();
  await back();
  await expect(page.getByTestId('casino-form')).toBeVisible();
  await back();
  await expect(detail).toBeVisible();

  // And the session's own Save (not Back) returns to the form too, which then saves to the page.
  await page.getByRole('button', { name: 'Edit casino', exact: true }).click();
  await page.getByTestId('casino-form').locator('.cas-hist').first().click();
  await page.getByRole('button', { name: 'Save session' }).click();
  await expect(page.getByTestId('casino-form')).toBeVisible();
  await page.getByRole('button', { name: 'Save casino' }).click();
  await expect(detail).toBeVisible();
});

/*
 * Review S3: a casino in the file under another id but the name of one here
 * is flagged in the preview, merged into it by default or added beside it;
 * Cancel saves nothing; and a merge keeps every game and note here.
 */
test('Paste: a same-named casino from another record is flagged, merged or added as chosen, and nothing here is dropped', async ({ page }) => {
  await seed(page, { ...LOG, casinos: [LOG.casinos[0]] });
  await page.goto('/?e2e=1');
  await openCasino(page);
  const theirs = {
    ...LOG.casinos[0],
    id: 'x-other',
    notes: 'Comps desk by the cage',
    updatedAt: '2026-10-20T00:00:00.000Z',
    games: [{ id: 'g-other', label: 'DD', decks: 2, s17: false, midShoeEntry: 'no', csm: false }],
  };
  const text = JSON.stringify({ app: 'bjtrainer-casino-log', version: 3, casinos: [theirs], sessions: [] });
  const paste = async () => {
    await page.getByRole('button', { name: 'Paste JSON' }).click();
    await page.getByTestId('casino-paste-text').fill(text);
    await page.getByTestId('casino-paste-import').click();
  };
  await paste();
  const preview = page.getByTestId('import-preview');
  const match = preview.getByTestId('import-name-match');
  await expect(match).toContainText('“Golden Nugget” in the file is a different record from the one here of that name.');
  await expect(match.getByTestId('import-merge')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview.getByTestId('import-updated')).toHaveText('Updates 1: Golden Nugget');
  // Add instead: the preview follows.
  await match.getByTestId('import-add').click();
  await expect(match.getByTestId('import-add')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview.getByTestId('import-added')).toHaveText('Adds 1 casino: Golden Nugget');
  // Cancel: nothing saved.
  const before = JSON.stringify(await stored(page));
  await preview.getByRole('button', { name: 'Cancel' }).click();
  await expect(preview).toHaveCount(0);
  expect(JSON.stringify(await stored(page))).toBe(before);

  // Merge (the default): one Golden Nugget, with its games and notes and the file's.
  await page.getByTestId('casino-paste-import').click();
  await page.getByTestId('import-confirm').click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toContainText('0 casinos added, 1 updated');
  const c = (await stored(page)).casinos;
  expect(c).toHaveLength(1);
  expect(c[0].id).toBe('c1');
  expect(c[0].games.map((g: { id: string }) => g.id)).toEqual(['g-other', 'g-nug']);
  expect(c[0].notes).toBe('Comps desk by the cage\n\nRay on swing shift');
  await expect(page.getByTestId('casino-file')).toContainText('every game, version and note on either copy is kept');
  await expect(page.getByTestId('casino-file')).not.toContainText('nothing is deleted');
});
