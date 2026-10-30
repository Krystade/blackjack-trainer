import { test, expect, type Page } from '@playwright/test';
import { withStats, statsTab, readStats } from './helpers';

/**
 * R1/R2 (lane B review): the import undo puts back every backed-up key, so it
 * must not outlive practice recorded on top of the import, and peeking at a
 * second file must not cost the first import its undo.
 */

const backup = (profileName: string, exportedAt: string) =>
  Buffer.from(
    JSON.stringify({
      settings: { version: 1 },
      stats: {
        version: 1,
        sessions: [{ date: exportedAt, rounds: 1, graded: 1, correct: 1, bankrollDelta: 1, profileName }],
      },
      meta: { app: 'bjtrainer', exportedAt },
    }),
  );

async function importFile(page: Page, name: string, buffer: Buffer, accept: boolean): Promise<string> {
  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    void (accept ? d.accept() : d.dismiss());
  });
  await page.locator('input.stats-file-input').setInputFiles({ name, mimeType: 'application/json', buffer });
  await expect.poll(() => asked).not.toBe('');
  return asked;
}

async function openStatsScreen(page: Page) {
  await page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true }).click();
  await page.locator('.home-stats-link').click();
}

test.beforeEach(async ({ page }) => {
  await withStats(page, {
    sessions: [{ date: new Date().toISOString(), rounds: 3, graded: 3, correct: 3, bankrollDelta: 5, profileName: 'Phone Profile' }],
  });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
});

test('R1: practising after an import ends the undo, and nothing is lost', async ({ page }) => {
  const asked = await importFile(page, 'a.json', backup('File A', '2026-01-02T20:00:00.000Z'), true);
  expect(asked).toContain('You can undo this until you practise or for 24 hours.');
  await expect(page.getByRole('button', { name: 'Undo import' })).toBeVisible();

  // One flashcard answer.
  await page.locator('.tab-bar').getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.locator('.action-bar button:not([disabled])').first().click();
  await expect(page.locator('.feedback-sr')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  await openStatsScreen(page);
  await expect(page.getByRole('button', { name: 'Export backup', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo import' })).toHaveCount(0);
  const stats = (await readStats(page)) as { sessions: { profileName?: string }[]; mistakes: Record<string, number> };
  expect(stats.sessions.map((s) => s.profileName)).toEqual(['File A']);
  expect(Object.values(stats.mistakes).reduce((a, b) => a + b, 0)).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('bjtrainer.importUndo.v1'))).toBeNull();
});

test('R2: picking a second file and cancelling keeps the first import undoable', async ({ page }) => {
  await importFile(page, 'a.json', backup('File A', '2026-01-02T20:00:00.000Z'), true);
  await expect(page.locator('.stats-message')).toHaveText('Backup imported.');
  await importFile(page, 'b.json', backup('File B', '2026-01-03T20:00:00.000Z'), false);

  await expect(page.getByRole('button', { name: 'Undo import' })).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Undo import' }).click();
  await expect(page.locator('.stats-message')).toHaveText('Import undone.');
  await statsTab(page, 'Over time');
  await expect(page.locator('.session-row', { hasText: 'Phone Profile' })).toBeVisible();
  await expect(page.locator('.session-row', { hasText: 'File A' })).toHaveCount(0);
});

test('R2: an Undo whose snapshot has gone says so, and the button goes', async ({ page }) => {
  await importFile(page, 'a.json', backup('File A', '2026-01-02T20:00:00.000Z'), true);
  await expect(page.locator('.stats-message')).toHaveText('Backup imported.');
  await page.evaluate(() => sessionStorage.removeItem('bjtrainer.importUndo.v1'));
  await page.getByRole('button', { name: 'Undo import' }).click();
  await expect(page.locator('.stats-message')).toContainText('The undo is no longer available');
  await expect(page.getByRole('button', { name: 'Undo import' })).toHaveCount(0);
});

test('R2: a file refused as not a backup leaves the import undoable', async ({ page }) => {
  await importFile(page, 'a.json', backup('File A', '2026-01-02T20:00:00.000Z'), true);
  await expect(page.locator('.stats-message')).toHaveText('Backup imported.');
  await page.locator('input.stats-file-input').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{{') });
  await expect(page.locator('.stats-message')).toContainText('Import failed');
  await expect(page.getByRole('button', { name: 'Undo import' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('bjtrainer.importUndo.v1'))).not.toBeNull();
});

test('R1: logging a casino session after an import ends the undo, and the session is kept', async ({ page }) => {
  await importFile(page, 'a.json', backup('File A', '2026-01-02T20:00:00.000Z'), true);
  await expect(page.locator('.stats-message')).toHaveText('Backup imported.');

  const casinoTab = page.locator('.tab-bar').getByRole('button', { name: 'Casino', exact: true });
  // Only looking at the Casino tab changes nothing: the undo stays.
  await casinoTab.click();
  await expect(page.getByRole('button', { name: 'Add a casino' })).toBeVisible();
  await openStatsScreen(page);
  await expect(page.getByRole('button', { name: 'Undo import' })).toBeVisible();

  // A casino and a session with a buy-in.
  await casinoTab.click();
  await page.getByRole('button', { name: 'Add a casino' }).click();
  await page.locator('input[name="name"]').fill('Golden Nugget');
  await page.getByRole('button', { name: 'Save casino' }).click();
  await page.getByTestId('casino-seg-sessions').click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.getByTestId('start-at').filter({ hasText: 'Golden Nugget' }).click();
  const live = page.getByTestId('casino-live');
  await live.locator('input[name="buyIn"]').fill('1000');
  await live.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(live.getByTestId('casino-buyin-total')).toHaveText('$1,000 in');

  await openStatsScreen(page);
  // The screen is up (a lazy screen shows no button before it mounts either).
  await expect(page.getByRole('button', { name: 'Export backup', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo import' })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('bjtrainer.importUndo.v1'))).toBeNull();
  const log = await page.evaluate(() => localStorage.getItem('bjtrainer.casinoLog.v3'));
  expect(log).toContain('Golden Nugget');
  expect(log).toContain('1000');
  const stats = (await readStats(page)) as { sessions: { profileName?: string }[] };
  expect(stats.sessions.map((s) => s.profileName)).toEqual(['File A']);
});
