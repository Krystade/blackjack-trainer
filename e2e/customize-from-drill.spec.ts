import { test, expect, type Page } from '@playwright/test';

/**
 * Wave M (owner, 2026-10-20): the Custom deck could only be painted from Home.
 * Flashcards and Mastery now carry a "Customize…" entry in their Deck picker
 * that opens the same editor and comes back to the drill, on the Custom deck.
 */

async function openDrill(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

const deck = (page: Page) => page.getByRole('combobox', { name: 'Deck', exact: true });

for (const width of [375, 320]) {
  test(`Flashcards -> Customize -> paint -> Back returns to Flashcards on Custom (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 812 });
    await page.goto('/?e2e=1');
    await openDrill(page, 'Flashcards');
    await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeVisible();
    // The extra option must not widen the Deck pill over the scope chips (a
    // native select sizes to its longest option: "Customize…" overlapped
    // Pairs by 25px at 320 before the pill was sized by the chosen deck).
    const pairs = await page.locator('.scope-chip', { hasText: 'Pairs' }).boundingBox();
    const pill = await page.locator('.deck-select').boundingBox();
    expect(pairs!.x + pairs!.width).toBeLessThanOrEqual(pill!.x);
    await deck(page).selectOption({ label: 'Customize…' });

    await expect(page.locator('.drill-heading', { hasText: 'Custom drill' })).toBeVisible();
    await page.getByRole('radio', { name: 'Focus' }).click();
    await page.locator('[data-cell="hard-16-v-10"]').click();
    await page.getByRole('button', { name: 'Back to Flashcards' }).click();

    await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeVisible();
    await expect(deck(page)).toHaveValue('custom');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill);
    expect(saved.deck).toBe('custom');
    expect(saved.custom.tiers['hard-16-v-10']).toBe('focus');
    // An edit lands on Custom over every scope, as Start does.
    expect(saved.scopes).toEqual(['hard', 'soft', 'pairs']);
    // No horizontal overflow in the drill row at this width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

/*
 * Review S3: Back after only LOOKING at the editor must leave the deck and
 * scopes he had. A Soft-only chart session silently became Custom over every
 * scope (and the scopes are shared with Speed and Mastery).
 */
test('Flashcards -> Customize -> Back without painting keeps the deck and scopes', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await openDrill(page, 'Flashcards');
  await page.getByRole('group', { name: 'Hands' }).getByRole('button', { name: 'Soft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Soft', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await deck(page).selectOption('indexes');
  await expect(deck(page)).toHaveValue('indexes');
  await deck(page).selectOption({ label: 'Customize…' });
  await expect(page.locator('.drill-heading', { hasText: 'Custom drill' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Flashcards' }).click();

  await expect(deck(page)).toHaveValue('indexes');
  await expect(page.getByRole('button', { name: 'Soft', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill);
  expect(saved.deck).toBe('indexes');
  expect(saved.scopes).toEqual(['soft']);
});

test('Mastery -> Customize -> Back without painting stays on the chart deck', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await openDrill(page, 'Mastery challenge');
  await expect(page.getByTestId('mastery-progress')).toBeVisible();
  await deck(page).selectOption({ label: 'Customize…' });
  await expect(page.locator('.drill-heading', { hasText: 'Custom drill' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Mastery' }).click();
  await expect(page.getByTestId('mastery-progress')).toBeVisible();
  await expect(deck(page)).toHaveValue('chart');
});

test('Mastery -> Customize -> paint -> Back returns to Mastery on Custom', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await openDrill(page, 'Mastery challenge');
  await expect(page.getByTestId('mastery-progress')).toBeVisible();
  await deck(page).selectOption({ label: 'Customize…' });
  await expect(page.locator('.drill-heading', { hasText: 'Custom drill' })).toBeVisible();
  await page.getByRole('radio', { name: 'Focus' }).click();
  await page.locator('[data-cell="hard-16-v-10"]').click();
  await page.getByRole('button', { name: 'Back to Mastery' }).click();
  await expect(page.getByTestId('mastery-progress')).toContainText('Custom');
  await expect(deck(page)).toHaveValue('custom');
});

test('the Customize entry never becomes the selected deck', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openDrill(page, 'Flashcards');
  await expect(deck(page)).toHaveValue('chart');
  // Opened from the picker, Back goes to the picker as before.
  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Flashcards', exact: true })).toBeVisible();
});
