import { test, expect, type Page } from '@playwright/test';

/**
 * Wave W: saved Custom lists (owner: "save a custom weight list for the
 * flashcard and mastery custom test"). Save as, Load, Overwrite, Rename,
 * Delete in the Custom editor; a list picked straight from the Flashcards
 * and Mastery Deck select; kept under its own key, across tabs.
 */

const KEY = 'bjtrainer.customLists.v1';
const cell = (page: Page, id: string) => page.locator(`[data-cell="${id}"]`);
const deck = (page: Page) => page.getByRole('combobox', { name: 'Deck', exact: true });
const panel = (page: Page) => page.getByTestId('saved-lists');
const status = (page: Page) => page.getByTestId('scl-status');
const row = (page: Page, name: string) => page.locator(`[data-testid="scl-row"][data-list="${name}"]`);

async function openEditor(page: Page): Promise<void> {
  await page.locator('.tab-bar').getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await expect(cell(page, 'hard-16-v-10')).toBeVisible();
}

/** Clear, then paint one cell Focus: a selection that is surely not the default. */
async function paintOnly(page: Page, id: string): Promise<void> {
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('radio', { name: 'Focus' }).click();
  await cell(page, id).click();
  await expect(cell(page, id)).toHaveAttribute('data-tier', 'focus');
}

async function saveAs(page: Page, name: string): Promise<void> {
  await panel(page).getByRole('button', { name: 'Save as…', exact: true }).click();
  await panel(page).locator('input[name="listName"]').fill(name);
  await panel(page).getByRole('button', { name: 'Save', exact: true }).click();
}

const stored = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{"lists":[]}') as { lists: { id: string; name: string; selection: { tiers: Record<string, string> } }[] }, KEY);
const drill = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill);

for (const size of [{ width: 375, height: 812 }, { width: 320, height: 568 }]) {
  test(`${size.width}: save as, change, save back, load, rename, delete -- and it survives a reload`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?e2e=1');
    await openEditor(page);
    await expect(status(page)).toHaveText('Not saved as a list.');

    await paintOnly(page, 'hard-16-v-10');
    await saveAs(page, 'Sixteen v ten');
    await expect(status(page)).toHaveText('This is “Sixteen v ten”.');
    await expect(row(page, 'Sixteen v ten')).toContainText('1 Focus · 0 Regular · 0 Rare');

    // Painting more is the working copy only; the list says so and can take it.
    await cell(page, 'hard-15-v-10').click();
    await expect(status(page)).toHaveText('Changed since “Sixteen v ten”.');
    await expect(row(page, 'Sixteen v ten')).toContainText('1 Focus');
    await page.getByTestId('scl-save-origin').click();
    await expect(status(page)).toHaveText('This is “Sixteen v ten”.');
    await expect(row(page, 'Sixteen v ten')).toContainText('2 Focus');

    await paintOnly(page, 'soft-18-v-9');
    await saveAs(page, 'Soft eighteen');
    expect((await stored(page)).lists.map((l) => l.name)).toEqual(['Sixteen v ten', 'Soft eighteen']);

    // The painting is a list, so Load asks nothing.
    await row(page, 'Sixteen v ten').getByRole('button', { name: 'Load', exact: true }).click();
    await expect(cell(page, 'hard-16-v-10')).toHaveAttribute('data-tier', 'focus');
    await expect(cell(page, 'hard-15-v-10')).toHaveAttribute('data-tier', 'focus');
    await expect(cell(page, 'soft-18-v-9')).toHaveAttribute('data-tier', 'off');
    await expect(status(page)).toHaveText('This is “Sixteen v ten”.');
    await expect(row(page, 'Sixteen v ten')).toHaveAttribute('data-current', 'true');

    // A name in use is not silently replaced.
    await panel(page).getByRole('button', { name: 'Save as…', exact: true }).click();
    await panel(page).locator('input[name="listName"]').fill('soft EIGHTEEN');
    await panel(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toHaveText('“Soft eighteen” is already a list.');
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await stored(page)).lists[1]!.selection.tiers).toEqual({ 'soft-18-v-9': 'focus' });

    await row(page, 'Sixteen v ten').getByRole('button', { name: 'More for Sixteen v ten' }).click();
    await row(page, 'Sixteen v ten').getByRole('button', { name: 'Rename', exact: true }).click();
    await row(page, 'Sixteen v ten').locator('input[name="renameList"]').fill('Tens');
    await row(page, 'Sixteen v ten').getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(row(page, 'Tens')).toBeVisible();
    await expect(status(page)).toHaveText('This is “Tens”.');

    await row(page, 'Soft eighteen').getByRole('button', { name: 'More for Soft eighteen' }).click();
    await row(page, 'Soft eighteen').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row(page, 'Soft eighteen')).toContainText('Delete the list “Soft eighteen”?');
    await row(page, 'Soft eighteen').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row(page, 'Soft eighteen')).toHaveCount(0);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.reload();
    await openEditor(page);
    await expect(row(page, 'Tens')).toBeVisible();
    await expect(status(page)).toHaveText('This is “Tens”.');
    expect((await stored(page)).lists.map((l) => l.name)).toEqual(['Tens']);
  });
}

test('Load asks before throwing away painting that is in no list, and Keep keeps it', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openEditor(page);
  await paintOnly(page, 'hard-16-v-10');
  await saveAs(page, 'Sixteen');
  await paintOnly(page, 'pair-8-v-A');
  await expect(status(page)).toHaveText('Changed since “Sixteen”.');

  await row(page, 'Sixteen').getByRole('button', { name: 'Load', exact: true }).click();
  await expect(row(page, 'Sixteen')).toContainText('The painting above is not saved as a list.');
  await row(page, 'Sixteen').getByRole('button', { name: 'Keep painting', exact: true }).click();
  await expect(cell(page, 'pair-8-v-A')).toHaveAttribute('data-tier', 'focus');

  await row(page, 'Sixteen').getByRole('button', { name: 'Load', exact: true }).click();
  await row(page, 'Sixteen').getByRole('button', { name: 'Load “Sixteen”', exact: true }).click();
  await expect(cell(page, 'pair-8-v-A')).toHaveAttribute('data-tier', 'off');
  await expect(cell(page, 'hard-16-v-10')).toHaveAttribute('data-tier', 'focus');
});

/** Two saved lists, each one Focus cell, written before the app loads. */
async function seedLists(page: Page): Promise<void> {
  const sel = (id: string) => ({ tiers: { [id]: 'focus' }, painted: {}, mix: { focus: 60, regular: 30, rare: 10 }, favourMissed: false });
  const doc = {
    version: 1,
    lists: [
      { id: 'cl-pairs', name: 'Eights v ace, a long list name', selection: sel('pair-8-v-A'), savedAt: '2026-10-26T12:00:00.000Z' },
      { id: 'cl-hard', name: 'Sixteen', selection: sel('hard-16-v-10'), savedAt: '2026-10-26T12:00:00.000Z' },
    ],
  };
  await page.addInitScript(([k, v]) => {
    if (!localStorage.getItem(k)) localStorage.setItem(k, v);
  }, [KEY, JSON.stringify(doc)] as const);
}

for (const width of [375, 320]) {
  test(`${width}: Flashcards' Deck select deals a saved list straight away, its name on the pill`, async ({ page }) => {
    await seedLists(page);
    await page.setViewportSize({ width, height: width === 320 ? 568 : 812 });
    await page.goto('/?e2e=1');
    await page.locator('.tab-bar').getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeVisible();

    await deck(page).selectOption({ label: 'Eights v ace, a long list name' });
    await expect(deck(page)).toHaveValue('list:cl-pairs');
    await expect(page.getByTestId('deck-label')).toHaveText('Eights v ace, a long list name');
    const d = await drill(page);
    expect(d.deck).toBe('custom');
    expect(d.customListId).toBe('cl-pairs');
    expect(d.custom.tiers).toEqual({ 'pair-8-v-A': 'focus' });

    // The long name is cut on the pill, which stays clear of the chips and the screen edge.
    const pairs = (await page.locator('.scope-chip', { hasText: 'Pairs' }).boundingBox())!;
    const pill = (await page.locator('.deck-select').boundingBox())!;
    expect(pairs.x + pairs.width).toBeLessThanOrEqual(pill.x);
    expect(pill.x + pill.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // The one cell in the list is what is dealt: the answer is graded on it.
    await page.getByRole('button', { name: 'Stand', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('bjtrainer.stats.v1') ?? '{}').cellStats ?? {})))
      .toEqual(['pair-8-v-A']);
  });
}

test("Mastery's Deck select offers the lists too, and asks before replacing unsaved painting", async ({ page }) => {
  await seedLists(page);
  await page.goto('/?e2e=1');
  await openEditor(page);
  await paintOnly(page, 'soft-13-v-5');
  await page.getByRole('button', { name: 'Mastery', exact: true }).click();
  await expect(deck(page)).toHaveValue('custom');

  // Dismissed: the painting stays the deck.
  page.once('dialog', (dlg) => {
    expect(dlg.message()).toBe('Replace your unsaved Custom painting with “Sixteen”?');
    void dlg.dismiss();
  });
  await deck(page).selectOption({ label: 'Sixteen' });
  await expect(deck(page)).toHaveValue('custom');
  expect((await drill(page)).custom.tiers).toEqual({ 'soft-13-v-5': 'focus' });

  page.once('dialog', (dlg) => void dlg.accept());
  await deck(page).selectOption({ label: 'Sixteen' });
  await expect(deck(page)).toHaveValue('list:cl-hard');
  expect((await drill(page)).custom.tiers).toEqual({ 'hard-16-v-10': 'focus' });
});

test("a list saved in one tab shows in the other's editor, and the other's save keeps it", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  for (const p of [a, b]) {
    await p.goto('/?e2e=1');
    await openEditor(p);
  }
  await paintOnly(a, 'hard-16-v-10');
  await saveAs(a, 'From A');
  await expect(row(b, 'From A')).toBeVisible();
  await paintOnly(b, 'soft-18-v-9');
  await saveAs(b, 'From B');
  await expect(row(a, 'From B')).toBeVisible();
  // A saves again: what B added is still there afterwards.
  await saveAs(a, 'From A again');
  await expect(row(b, 'From A again')).toBeVisible();
  expect((await stored(a)).lists.map((l) => l.name)).toEqual(['From A', 'From B', 'From A again']);
});
