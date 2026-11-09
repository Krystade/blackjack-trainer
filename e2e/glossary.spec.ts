import { test, expect, type Page } from '@playwright/test';
import { withProfile } from './helpers';

/**
 * T2-2B: the glossary. A dotted word opens a plain definition in a sheet at
 * the foot of the screen; one sheet at a time; Escape, the Close button or a
 * tap above the sheet closes it. Inside a settings toggle row the word opens
 * the sheet and does NOT flip the switch, while the rest of the row still
 * does.
 */

const sheet = (page: Page) => page.getByTestId('glossary-sheet');

async function openCharts(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.locator('.charts-heading')).toHaveText('Strategy charts');
}

async function openProfileEditor(page: Page) {
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
}

test.use({ viewport: { width: 375, height: 812 } });

test('Charts: the ruleset line keeps its text, and S17 opens its definition at the foot of the screen', async ({
  page,
}) => {
  await withProfile(page, { rules: { decks: 2, s17: true, das: false, ls: false } });
  await openCharts(page);
  await expect(page.locator('.charts-ruleset')).toHaveText('2 decks · S17 · No DAS · No surrender');

  const word = page.locator('.charts-ruleset .term', { hasText: 'S17' });
  await expect(word).toHaveAttribute('aria-expanded', 'false');
  await word.click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('.bottom-sheet-title')).toHaveText('S17 (dealer stands on soft 17)');
  await expect(word).toHaveAttribute('aria-expanded', 'true');

  // Docked at the bottom, fully on screen, Close reachable.
  const box = (await sheet(page).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(812 + 0.5);
  expect(box.y).toBeGreaterThan(812 / 3);
  const close = sheet(page).getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeInViewport({ ratio: 1 });

  await close.click();
  await expect(sheet(page)).toHaveCount(0);

  // The next word opens its own sheet; there is only ever one.
  await page.locator('.charts-ruleset .term', { hasText: 'No DAS' }).click();
  await expect(sheet(page)).toHaveCount(1);
  await expect(sheet(page).locator('.bottom-sheet-title')).toHaveText('DAS (double after split)');
});

test('Charts: Escape closes and gives focus back to the word; a tap above the sheet closes it', async ({ page }) => {
  await withProfile(page);
  await openCharts(page);
  const fab4 = page.locator('.index-group[data-group="illustrious"] .index-group-title .term');
  await fab4.click();
  await expect(sheet(page).locator('.bottom-sheet-title')).toHaveText('Illustrious 18');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(fab4).toBeFocused();
  // Escape went to the sheet, not to the screen behind it.
  await expect(page.locator('.charts-heading')).toBeVisible();

  await fab4.click();
  await expect(sheet(page)).toBeVisible();
  await page.mouse.click(187, 60);
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('.charts-heading')).toBeVisible();
});

test('Profile editor: the word in a toggle row opens the sheet without flipping the switch; the rest of the row still flips it', async ({
  page,
}) => {
  await withProfile(page, { rules: { das: true } });
  await openProfileEditor(page);
  const row = page.locator('.settings-toggle-row', { hasText: 'Double after split (DAS)' });
  const box = row.locator('input.settings-toggle');
  await expect(box).toBeChecked();

  await row.locator('.term').click();
  await expect(sheet(page).locator('.bottom-sheet-title')).toHaveText('DAS (double after split)');
  await expect(box).toBeChecked();
  await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(box).toBeChecked();

  // The plain part of the label is still the switch's label.
  await row.getByText('Double after split', { exact: false }).first().click({ position: { x: 4, y: 8 } });
  await expect(box).not.toBeChecked();
  await expect(sheet(page)).toHaveCount(0);
});

test('Flashcards: the rules chip opens its term, and a key typed in the sheet is not graded as an answer', async ({
  page,
}) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  const chip = page.getByTestId('rules-chip').locator('.term').first();
  await chip.click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('.bottom-sheet-title')).toHaveText(/^(Surrender|Double)$/);

  for (const k of ['h', 's', 'd', '1', '2']) await page.keyboard.press(k);
  await expect(page.locator('[data-testid="result-strip"] .hand-result')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  // Still on the drill, still unanswered.
  await expect(page.getByRole('button', { name: 'Hit', exact: true })).toBeEnabled();
  await expect(page.locator('[data-testid="result-strip"] .hand-result')).toHaveCount(0);
});
