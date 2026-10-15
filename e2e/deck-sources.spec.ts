import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip, withSettings } from './helpers';

/**
 * B2 deck sources: settings.drill.deck picks where the hand drills draw from,
 * within the Hard / Soft / Pairs scope.
 */

async function openDrill(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

const deck = (page: Page) => page.getByRole('combobox', { name: 'Deck', exact: true });
const scopeChip = (page: Page, name: string) =>
  page.locator('.settings-row', { hasText: 'Hands' }).getByRole('button', { name, exact: true });

test('flashcards on the Indexes deck, Pairs only: every hand is 10,10 v 5 or v 6', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openDrill(page, 'Flashcards');
  await scopeChip(page, 'Pairs').click();
  await deck(page).selectOption('indexes');
  await expect(deck(page)).toHaveValue('indexes');

  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await answerAndReadStrip(page, page.getByRole('button', { name: 'Stand', exact: true }));
    seen.add((await page.locator('[data-testid="result-strip"] .hand-result').getAttribute('data-cell-id')) ?? '');
  }
  for (const id of seen) expect(['pair-10-v-5', 'pair-10-v-6']).toContain(id);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill?.deck);
  expect(saved).toBe('indexes');
});

test('an empty Marked deck says so instead of dealing, and Chart brings the drill back', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openDrill(page, 'Flashcards');
  await deck(page).selectOption('marked');

  await expect(page.getByTestId('empty-deck')).toContainText('No hands are marked yet');
  await expect(page.locator('.action-bar')).toHaveCount(0);

  await deck(page).selectOption('chart');
  await expect(page.getByTestId('empty-deck')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeVisible();
});

test('mastery walks the deck: Indexes within Pairs is a two-hand sweep', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openDrill(page, 'Mastery challenge');
  await scopeChip(page, 'Pairs').click();
  await deck(page).selectOption('indexes');
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 2 cleared · Indexes · Pairs');
});

test('mastery on the Marked deck sweeps exactly the marked hands', async ({ page }) => {
  await withSettings(page, {
    drill: { deck: 'marked', markers: { 'hard-16-v-10': 'red', 'soft-18-v-9': 'blue', 'pair-8-v-A': 'green' } },
  });
  await page.goto('/?e2e=1');
  await openDrill(page, 'Mastery challenge');
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 3 cleared · Marked · All');
  const order = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.masteryrun.v1') ?? '{}').order);
  expect([...order].sort()).toEqual(['hard-16-v-10', 'pair-8-v-A', 'soft-18-v-9']);
});

test('mixed on an empty deck shows the message, with its scope and deck controls', async ({ page }) => {
  await withSettings(page, { drill: { deck: 'indexes', scopes: ['soft'] } });
  await page.goto('/?e2e=1');
  await openDrill(page, 'Mixed');
  await expect(page.getByTestId('empty-deck')).toHaveText(
    'No index plays among Soft hands. Choose more hands or another deck.',
  );
  await scopeChip(page, 'Hard').click();
  await expect(page.getByTestId('empty-deck')).toHaveCount(0);
  await expect(page.locator('.drill-heading')).toHaveText('Mixed');
});

test('the Drills picker lists Custom', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Custom', exact: true })).toBeVisible();
});
