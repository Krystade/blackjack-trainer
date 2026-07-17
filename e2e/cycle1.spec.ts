import { test, expect } from '@playwright/test';
import { shot, withSettings, withProfile, playRoundByAdvice } from './helpers';

test('manual countdown: tapping the zone through all groups reaches the answer/result screens', async ({ page }) => {
  await withSettings(page, {
    drill: { countManual: true, countLengthCards: 13, countGroup: 1, countIntervalMs: 300 },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();

  const modeRow = page.locator('.settings-row', { hasText: 'Mode' });
  await expect(modeRow.getByRole('button', { name: 'Manual', exact: true })).toHaveClass(/segmented-btn-active/);
  await shot(page, '33-count-drill-manual-setup');

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.manual-tap-zone')).toBeVisible();
  await shot(page, '34-count-drill-manual-tapzone');

  for (let guard = 0; guard < 20; guard++) {
    if (!(await page.locator('.manual-tap-zone').isVisible().catch(() => false))) break;
    await page.locator('.manual-tap-zone').click();
  }

  await expect(page.locator('.numpad')).toBeVisible();
  await shot(page, '35-count-drill-manual-answering');

  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await shot(page, '36-count-drill-manual-result');
});

test('deviation quiz: an index filter of 16v10 keeps drawing the same scenario across Next cycles', async ({ page }) => {
  await withSettings(page, { drill: { quizIndex: '16v10' } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Deviation Quiz');

  const select = page.locator('.quiz-index-select');
  await expect(select).toHaveValue('16v10');
  await shot(page, '37-quiz-16v10-question');

  const expectedLabel = '16 v 10: stand at TC ≥ 0';
  for (let cycle = 0; cycle < 3; cycle++) {
    await expect(select).toHaveValue('16v10');
    await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
    await expect(page.locator('.quiz-label')).toHaveText(expectedLabel);
    if (cycle === 0) await shot(page, '38-quiz-16v10-feedback');
    if (cycle === 2) await shot(page, '39-quiz-16v10-cycle3-feedback');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
});

test('CVCX paste import: happy path parses/previews/saves a ramp, then a bad paste shows a line-1 error', async ({ page }) => {
  await withProfile(page, {
    name: 'CVCX Test Profile',
    betSpreadOn: true,
    spread: [{ minTc: -99, units: 1 }],
  });
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();

  const row = page.locator('.profile-row', { hasText: 'CVCX Test Profile' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit Profile');

  await page.getByRole('button', { name: 'Paste from CVCX', exact: true }).click();
  await expect(page.locator('.cvcx-textarea')).toBeVisible();
  await shot(page, '40-cvcx-import-panel-empty');

  await page.locator('.cvcx-textarea').fill('1\t2\n2\t4');
  await page.getByRole('button', { name: 'Parse', exact: true }).click();

  await expect(page.locator('.cvcx-preview-row')).toHaveCount(2);
  await expect(page.locator('.cvcx-preview-row').nth(0)).toContainText('1');
  await expect(page.locator('.cvcx-preview-row').nth(0)).toContainText('2');
  await expect(page.locator('.cvcx-preview-row').nth(1)).toContainText('2');
  await expect(page.locator('.cvcx-preview-row').nth(1)).toContainText('4');
  await shot(page, '41-cvcx-import-preview');

  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('.cvcx-import-panel')).not.toBeVisible();
  await expect(page.locator('.spread-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit Profile');
  await expect(page.locator('.spread-row')).toHaveCount(2);
  await shot(page, '42-profile-editor-ramp-after-cvcx-confirm');

  // Error path: a paste that can't be parsed at all shows a line-1 error and
  // leaves the panel open/editable (does not silently guess or discard input).
  await page.getByRole('button', { name: 'Paste from CVCX', exact: true }).click();
  await page.locator('.cvcx-textarea').fill('abc\txyz');
  await page.getByRole('button', { name: 'Parse', exact: true }).click();

  await expect(page.locator('.cvcx-error')).toBeVisible();
  await expect(page.locator('.cvcx-error')).toContainText('Line 1');
  await expect(page.locator('.cvcx-textarea')).toBeVisible();
  await expect(page.locator('.cvcx-textarea')).toBeEditable();
  await shot(page, '43-cvcx-import-error');
});

test('bet-spread grading against a profile ramp: a wrong bet is graded and shows in the test-mode report', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test' });
  await withProfile(page, {
    name: 'Bet Spread Test Profile',
    betSpreadOn: true,
    spread: [{ minTc: -99, units: 1 }],
    countCheckEvery: 0,
  });
  await page.goto('/?seed=6&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  // Ramp says 1 unit at every TC (single-row spread); deliberately pick 8.
  await expect(page.locator('.bet-chips')).toBeVisible();
  await page.locator('.chip-btn', { hasText: /^8$/ }).click();
  await shot(page, '44-profile-bet-chip-selected');
  await page.getByRole('button', { name: 'Deal', exact: true }).click();

  await playRoundByAdvice(page);
  await page.locator('.end-btn').click();

  await expect(page.locator('.report-screen')).toBeVisible();
  const betRow = page.locator('.report-categories tr', { hasText: 'bet' });
  await expect(betRow).toBeVisible();
  await shot(page, '45-profile-bet-spread-report');
});
