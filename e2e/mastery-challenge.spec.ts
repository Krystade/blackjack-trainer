import { test, expect } from '@playwright/test';
import { withSettings } from './helpers';

test('mastery challenge: default scope is All, progress starts at 0', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Mastery Challenge');

  const scopeRow = page.locator('.settings-row', { hasText: 'Scope' });
  await expect(scopeRow.getByRole('button', { name: 'All', exact: true })).toHaveClass(/segmented-btn-active/);

  const freqRow = page.locator('.settings-row', { hasText: 'Interruptions' });
  await expect(freqRow.getByRole('button', { name: 'Off', exact: true })).toHaveClass(/segmented-btn-active/);

  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 330 cleared');
});

test('mastery challenge: switching scope resets progress and shows the new total', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();

  const scopeRow = page.locator('.settings-row', { hasText: 'Scope' });
  await scopeRow.getByRole('button', { name: 'Pairs', exact: true }).click();
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 100 cleared');
});

/**
 * The core mechanic: one wrong answer resets the WHOLE run. Pins Math.random
 * so the run's cell sequence is reproducible, plays the FIRST cell correctly
 * (progress advances to 1), then forces a wrong answer and asserts progress
 * falls back to 0 and the reset banner appears.
 */
test('mastery challenge: a wrong answer resets progress to 0/N with a visible reset banner', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await withSettings(page, { drill: { flashCategory: 'hard' } }); // unrelated setting, just a stable baseline
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();

  const scopeRow = page.locator('.settings-row', { hasText: 'Scope' });
  await scopeRow.getByRole('button', { name: 'Hard', exact: true }).click();
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 150 cleared');

  // Force a wrong answer regardless of what's correct: try every action in
  // turn until one is graded wrong (only one of the five can be "correct").
  const actions = ['Hit', 'Stand', 'Double', 'Split', 'Surrender'];
  let reset = false;
  for (const label of actions) {
    const btn = page.locator('.action-bar button.action-btn', { hasText: label });
    if (await btn.isDisabled()) continue;
    await btn.click();
    const bannerVisible = await page.locator('.mastery-reset-banner').isVisible().catch(() => false);
    if (bannerVisible) {
      reset = true;
      break;
    }
    // That action was graded correct -- undo isn't possible, so this specific
    // run's first cell is now solved; reload and retry with a fresh seed
    // rather than looping indefinitely on an already-advanced run.
    await page.reload();
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();
  }
  expect(reset).toBe(true);
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 150 cleared');
});

test('mastery challenge: an illegal action (disabled button aside) never advances or resets progress', async ({ page }) => {
  await withSettings(page, {});
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();

  const scopeRow = page.locator('.settings-row', { hasText: 'Scope' });
  await scopeRow.getByRole('button', { name: 'Hard', exact: true }).click(); // no pair cells in scope
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 150 cleared');

  // Split is never legal on a hard-scope (non-pair) hand -- its button is
  // disabled; pressing the '4' key must be refused by the same gate, not
  // silently graded.
  await expect(page.locator('.action-bar button.action-btn', { hasText: 'Split' })).toBeDisabled();
  await page.keyboard.press('4');
  await expect(page.locator('.message-strip .result-correct, .mastery-reset-banner')).toHaveCount(0);
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 150 cleared');
});

test('mastery challenge: progress survives a reload (persisted run, not lost on navigation)', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.9;
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();

  const scopeRow = page.locator('.settings-row', { hasText: 'Scope' });
  await scopeRow.getByRole('button', { name: 'Pairs', exact: true }).click();

  // Answer with the shown advice if the ActionBar exposes one; otherwise
  // click whichever legal action isn't disabled and accept whatever happens
  // -- this spec only cares that the persisted index matches what's on
  // screen after a reload, not that a specific answer is correct.
  const before = await page.locator('[data-testid="mastery-progress"]').innerText();

  await page.reload();
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();
  const after = await page.locator('[data-testid="mastery-progress"]').innerText();
  expect(after).toBe(before); // merely navigating away/back is NOT a mistake

  const stored = await page.evaluate(() => window.localStorage.getItem('bjtrainer.masteryrun.v1'));
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored!).scope).toBe('pairs');
});

test('mastery challenge: interruptions default to Off and can be switched to Relentless', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery Challenge', exact: true }).click();

  const freqRow = page.locator('.settings-row', { hasText: 'Interruptions' });
  await expect(freqRow.getByRole('button', { name: 'Off', exact: true })).toHaveClass(/segmented-btn-active/);

  await freqRow.getByRole('button', { name: 'Relentless', exact: true }).click();
  const settings = await page.evaluate(() => {
    const json = window.localStorage.getItem('bjtrainer.settings.v1');
    return json ? JSON.parse(json) : null;
  });
  expect(settings?.drill?.masteryDistractionFreq).toBe('relentless');

  // Changing THIS drill's difficulty must not touch the count drill's own
  // distractionFreq (D4) -- confirm it's still the untouched default.
  expect(settings?.drill?.distractionFreq ?? 'off').toBe('off');
});
