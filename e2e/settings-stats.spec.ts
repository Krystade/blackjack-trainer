import { test, expect } from '@playwright/test';
import { shot, withSettings, withStats, withProfile, playRoundByAdvice, readStats } from './helpers';

test('a changed setting persists across reload', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Settings');
  await shot(page, '21-settings-default');

  const countPeekToggle = page.locator('.settings-toggle-row', { hasText: 'Count peek' }).locator('input.settings-toggle');
  await expect(countPeekToggle).toBeChecked();
  await countPeekToggle.click();
  await expect(countPeekToggle).not.toBeChecked();
  await shot(page, '22-settings-changed');

  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const countPeekToggleAfterReload = page
    .locator('.settings-toggle-row', { hasText: 'Count peek' })
    .locator('input.settings-toggle');
  await expect(countPeekToggleAfterReload).not.toBeChecked();
  await shot(page, '23-settings-persisted-after-reload');
});

test('a short session shows up on the stats screen', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  await page.locator('.end-btn').click();
  await expect(page.locator('.home-title')).toBeVisible();

  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await expect(page.locator('.stats-heading')).toHaveText('Stats');
  await expect(page.locator('.session-row')).not.toHaveCount(0);
  await shot(page, '24-stats-with-session');
});

test('export downloads bjtrainer-export.json', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Stats', exact: true }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('bjtrainer-export.json');
});

test('importing garbage shows an error and leaves the app navigable', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Stats', exact: true }).click();

  page.once('dialog', (dialog) => dialog.accept());
  const fileInput = page.locator('input.stats-file-input');
  await fileInput.setInputFiles({
    name: 'garbage.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not valid json {{{'),
  });

  await expect(page.locator('.stats-message')).toContainText('Import failed');
  await shot(page, '25-stats-import-error');

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
});

test('importing a valid export blob restores stats (success path)', async ({ page }) => {
  // T0 gap #28 (docs/research/2026-07-26-test-coverage-matrix.md): the
  // existing "importing garbage" spec above only proves the failure path.
  // This is a well-formed exportAll()-shaped blob (persist.ts's importAll
  // validates `version === 1` on both settings and stats, then merges each
  // over its defaults), so it should actually restore.
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Stats', exact: true }).click();

  const validExport = JSON.stringify({
    settings: { version: 1 },
    stats: {
      version: 1,
      sessions: [
        {
          date: new Date().toISOString(),
          rounds: 3,
          graded: 3,
          correct: 2,
          bankrollDelta: 5,
          profileId: 'e2e-import-profile',
          profileName: 'Imported Profile',
        },
      ],
    },
  });

  page.once('dialog', (dialog) => dialog.accept());
  const fileInput = page.locator('input.stats-file-input');
  await fileInput.setInputFiles({
    name: 'valid-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(validExport),
  });

  await expect(page.locator('.stats-message')).toContainText('Import successful');
  await expect(page.locator('.session-row', { hasText: 'Imported Profile' })).toBeVisible();
  await shot(page, '26-stats-import-success');

  // Confirm the restored blob was actually persisted, not just rendered.
  const persisted = await readStats(page);
  const sessions = (persisted as { sessions?: { profileName?: string }[] } | null)?.sessions ?? [];
  expect(sessions.some((s) => s.profileName === 'Imported Profile')).toBe(true);
});

test('Reset stats clears all persisted stats after confirmation', async ({ page }) => {
  // T0 gap #28: the Reset-stats danger button (handleReset in Stats.tsx)
  // has never been clicked by an e2e spec.
  await withStats(page, {
    sessions: [
      { date: new Date().toISOString(), rounds: 1, graded: 1, correct: 1, bankrollDelta: 1 },
    ],
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await expect(page.locator('.session-row')).not.toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.stats-danger-btn', { hasText: 'Reset stats' }).click();

  await expect(page.locator('.stats-message')).toContainText('Stats reset.');
  await expect(page.locator('.session-row')).toHaveCount(0);
  await shot(page, '27-stats-reset');

  const persisted = await readStats(page);
  expect((persisted as { sessions?: unknown[] } | null)?.sessions).toEqual([]);
});

test('Speak summary narrates the session summary under ?e2e=1', async ({ page }) => {
  // T0 gap #28: handleSpeakSummary (Stats.tsx) calls audio.say(
  // narrateStatsSummary(stats)); useAudio's `say` no-ops unless
  // audio.enabled && verbosity !== 'off', so both must be seeded. Under
  // ?e2e=1 speak() short-circuits straight to window.__speechLog.
  await withSettings(page, { audio: { enabled: true, verbosity: 'results' } });
  await withStats(page, { mistakes: { 'basic-error': 2 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Stats', exact: true }).click();

  await page.locator('.stats-action-btn', { hasText: 'Speak summary' }).click();

  const speechLog = await page.evaluate(
    () => (window as unknown as { __speechLog?: string[] }).__speechLog ?? [],
  );
  expect(speechLog.some((s) => s.startsWith('This session:'))).toBe(true);
});

test('CVCX profile header renders score/EV/ROR/note plus actual accuracy from a played session', async ({ page }) => {
  // T0 gap #28: seeds a profile carrying CVCX numbers directly via
  // withProfile (not through the ProfileEditor UI), plays a short session so
  // Stats.tsx's `actualAccuracyPct` / `unitsPerHourProxy` also have real data
  // (rather than the dash "no data" placeholder), and asserts the whole
  // per-profile header block renders.
  await withProfile(page, {
    name: 'CVCX Header Profile',
    cvcx: { score: 87, evPerHour: 24, riskOfRuin: 3, simNote: 'CVCX N0 sim, 500M rounds' },
  });
  await withSettings(page, { countCheckEvery: 0 });
  await page.goto('/?seed=9&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  await page.locator('.end-btn').click();
  await expect(page.locator('.home-title')).toBeVisible();

  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await expect(page.locator('.mistake-row', { hasText: 'CVCX score' })).toContainText('87');
  await expect(page.locator('.mistake-row', { hasText: 'CVCX EV/hr' })).toContainText('+24');
  await expect(page.locator('.mistake-row', { hasText: 'CVCX risk of ruin' })).toContainText('3%');
  await expect(page.locator('.mistake-row', { hasText: 'CVCX sim note' })).toContainText('CVCX N0 sim, 500M rounds');
  await expect(page.locator('.mistake-row', { hasText: 'Actual play accuracy' })).not.toContainText('—');
  await expect(page.locator('.mistake-row', { hasText: 'Actual units/hr' })).not.toContainText('—');
  await shot(page, '28-stats-cvcx-header-session');
});
