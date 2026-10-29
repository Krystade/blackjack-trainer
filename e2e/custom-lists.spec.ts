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
    // Review S8: only the tiers the list uses.
    await expect(row(page, 'Sixteen v ten').getByTestId('scl-row-counts')).toHaveText('1 Focus');

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

/*
 * Review S4: the test above cannot tell a save from stale memory, since A has
 * already heard B's write when it saves. Here the list is written straight
 * into storage from A's own page: a same-tab write fires no storage event, so
 * A's copy is stale for sure. Every editor action must still keep it.
 */
test('every save, rename and delete re-reads storage: a list A has not heard of survives them', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openEditor(page);
  await paintOnly(page, 'hard-16-v-10');
  await saveAs(page, 'Mine');
  const plant = (name: string) =>
    page.evaluate(
      ([k, n]) => {
        const doc = JSON.parse(localStorage.getItem(k)!);
        doc.lists.push({ id: `cl-${n}`, name: n, selection: { tiers: { 'pair-8-v-A': 'focus' }, painted: {}, mix: { focus: 60, regular: 30, rare: 10 }, favourMissed: false }, savedAt: '2026-10-26T12:00:00.000Z' });
        localStorage.setItem(k, JSON.stringify(doc));
      },
      [KEY, name] as const,
    );
  const names = async () => (await stored(page)).lists.map((l) => l.name).sort();

  await plant('Planted 1');
  await expect(row(page, 'Planted 1')).toHaveCount(0);
  await paintOnly(page, 'soft-18-v-9');
  await saveAs(page, 'Second');
  expect(await names()).toEqual(['Mine', 'Planted 1', 'Second']);

  await plant('Planted 2');
  await page.getByTestId('scl-save-origin').waitFor({ state: 'detached' });
  await cell(page, 'soft-17-v-9').click();
  await page.getByTestId('scl-save-origin').click();
  expect(await names()).toEqual(['Mine', 'Planted 1', 'Planted 2', 'Second']);

  await plant('Planted 3');
  await row(page, 'Mine').getByRole('button', { name: 'More for Mine' }).click();
  await row(page, 'Mine').getByRole('button', { name: 'Rename', exact: true }).click();
  await row(page, 'Mine').locator('input[name="renameList"]').fill('Mine renamed');
  await row(page, 'Mine').getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(row(page, 'Mine renamed')).toBeVisible();
  expect(await names()).toEqual(['Mine renamed', 'Planted 1', 'Planted 2', 'Planted 3', 'Second']);

  await plant('Planted 4');
  await row(page, 'Second').getByRole('button', { name: 'More for Second' }).click();
  await row(page, 'Second').getByRole('button', { name: 'Delete', exact: true }).click();
  await row(page, 'Second').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row(page, 'Second')).toHaveCount(0);
  expect(await names()).toEqual(['Mine renamed', 'Planted 1', 'Planted 2', 'Planted 3', 'Planted 4']);
});

/* Review S6: "Save to" offered only while the painting is in no list, and a list gone meanwhile is said so. */
test('"Save to" waits while the painting is another list, and a list deleted meanwhile is named, not blamed on storage', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openEditor(page);
  await paintOnly(page, 'soft-18-v-9');
  await saveAs(page, 'Bee');
  await paintOnly(page, 'hard-16-v-10');
  await saveAs(page, 'Ay');
  // Painted back to exactly Bee: the status names Bee, and nothing offers to overwrite Ay with it.
  await paintOnly(page, 'soft-18-v-9');
  await expect(status(page)).toHaveText('This is “Bee”.');
  await expect(page.getByTestId('scl-save-origin')).toHaveCount(0);
  // In no list: Save to Ay is back.
  await cell(page, 'soft-17-v-9').click();
  await expect(status(page)).toHaveText('Changed since “Ay”.');
  await expect(page.getByTestId('scl-save-origin')).toHaveText('Save to “Ay”');

  // Ay deleted behind this page's back, then Save to Ay.
  await page.evaluate((k) => {
    const doc = JSON.parse(localStorage.getItem(k)!);
    doc.lists = doc.lists.filter((l: { name: string }) => l.name !== 'Ay');
    localStorage.setItem(k, JSON.stringify(doc));
  }, KEY);
  await page.getByTestId('scl-save-origin').click();
  await expect(panel(page).getByRole('status')).toHaveText('“Ay” is no longer a list (deleted, perhaps in another tab). Save as… to keep the painting.');
  expect((await stored(page)).lists.map((l) => l.name)).toEqual(['Bee']);
});

/*
 * Review S8: at 320 a list name broke inside "3-6" ("3-" / "6"), and the
 * counts, zeros and all, wrapped onto two or three lines.
 */
test('320: a saved list name breaks between words, and its counts stay on one line', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const sel = (ids: string[], favourMissed = false) => ({
    tiers: Object.fromEntries(ids.map((i) => [i, 'focus'])),
    painted: {},
    mix: { focus: 60, regular: 30, rare: 10 },
    favourMissed,
  });
  const at = '2026-10-26T12:00:00.000Z';
  const doc = {
    version: 1,
    lists: [
      { id: 'cl-1', name: 'Soft doubles v 3-6', selection: sel(['soft-13-v-5', 'soft-14-v-5', 'soft-17-v-3', 'soft-18-v-3']), savedAt: at },
      { id: 'cl-3', name: 'Splits', selection: sel(['pair-8-v-A', 'pair-9-v-7'], true), savedAt: at },
    ],
  };
  await page.addInitScript(([k, j]) => localStorage.setItem(k as string, j as string), [KEY, JSON.stringify(doc)]);
  await page.goto('/?e2e=1');
  await openEditor(page);
  const soft = row(page, 'Soft doubles v 3-6');
  await expect(soft.getByTestId('scl-row-counts')).toHaveText('4 Focus');
  await expect(row(page, 'Splits').getByTestId('scl-row-counts')).toHaveText('2 Focus · favour missed');
  // "3-6" on one line: every box of its characters at the same top.
  const tops = await soft.locator('.scl-row-name').evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf('3-6');
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 3);
      return [...r.getClientRects()].map((b) => Math.round(b.top));
    }
    return [];
  });
  expect(tops.length).toBeGreaterThan(0);
  expect(new Set(tops).size, '"3-6" split across lines').toBe(1);
  for (const name of ['Soft doubles v 3-6', 'Splits']) {
    const lines = await row(page, name)
      .getByTestId('scl-row-counts')
      .evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return new Set([...r.getClientRects()].filter((b) => b.width > 0).map((b) => Math.round(b.top))).size;
      });
    expect(lines, `${name}: counts on one line`).toBe(1);
  }
});
