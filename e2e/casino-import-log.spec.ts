import { test, expect, type Page } from '@playwright/test';
import { flushStoredDiagnostics, readStoredDiagnostics } from './helpers';

/**
 * Wave X (item 5): a casino Import JSON left no line in the diagnostic log, so
 * a failed import was invisible in an exported log. Each import now leaves a
 * `casino import` entry -- the counts when it saved, the reason when it did
 * not -- and never a casino's name, area, notes or rules.
 */

test.use({ viewport: { width: 375, height: 812 } });

const AT = '2026-10-01T00:00:00.000Z';
const base = { createdAt: AT, updatedAt: AT, status: 'ok' };
const FILE = {
  app: 'bjtrainer-casino-log',
  version: 2,
  exportedAt: AT,
  casinos: [
    {
      ...base,
      id: 'c1',
      name: 'Golden Nugget',
      area: 'Downtown',
      notes: 'Ray on swing shift',
      games: [{ id: 'g-nug', label: 'Main pit', decks: 6, s17: false, das: true, midShoeEntry: 'no', csm: false }],
    },
  ],
  sessions: [],
  settings: { startingBankroll: null, updatedAt: null },
  lastExportAt: AT,
};

const openCasino = (page: Page) => page.locator('.tab-bar').getByRole('button', { name: 'Casino', exact: true }).click();

type Entry = { category: string; event: string; detail?: Record<string, unknown> };

async function importLines(page: Page): Promise<Entry[]> {
  await flushStoredDiagnostics(page);
  const raw = (await readStoredDiagnostics(page)) ?? '[]';
  return (JSON.parse(raw) as Entry[]).filter((e) => e.event === 'casino import');
}

test('a casino import writes its outcome to the diagnostic log, failed or saved, without names or rules', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openCasino(page);
  const input = page.getByTestId('casino-import-file');
  await expect(input).toBeAttached();

  // Not JSON: refused, and the log says why.
  await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"oops"') });
  await expect(page.getByRole('status').filter({ hasText: 'Import failed' })).toBeVisible();
  await expect.poll(async () => (await importLines(page)).length).toBe(1);
  const [failed] = await importLines(page);
  expect(failed!.category).toBe('set');
  expect(failed!.detail).toMatchObject({ ok: false, from: 'file', stage: 'check', reason: 'Import failed: That file is not JSON.' });

  // A real export: previewed, imported, and the counts logged.
  await input.setInputFiles({ name: 'log.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(FILE)) });
  await page.getByTestId('import-confirm').click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible();
  await expect.poll(async () => (await importLines(page)).length).toBe(2);
  const saved = (await importLines(page))[1]!;
  expect(saved.detail).toMatchObject({
    ok: true,
    from: 'file',
    casinosAdded: 1,
    casinosUpdated: 0,
    sessionsAdded: 0,
    sessionsUpdated: 0,
    kept: 0,
    skipped: 0,
  });

  const all = (await readStoredDiagnostics(page)) ?? '';
  for (const secret of ['Golden Nugget', 'Downtown', 'Ray on swing shift', 'Main pit', 'g-nug']) {
    expect(all, secret).not.toContain(secret);
  }
});
