import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip, withSettings } from './helpers';
import { confusabilityWeight } from '../src/drills/confusability';

/**
 * #52: "Follow each hand with a look-alike" is a forced follow -- with
 * probability 0.5 the next card comes ONLY from the previous cell's
 * confusable set. The coin is the seed's first rng value (unit-tested in
 * flashcards.test.ts). What only a browser can check is the CHAIN: the view
 * must hand the cell it just showed to the next draw.
 *
 * Math.random pinned to 0.1 gives seed 100000000, whose coin is 0.119 --
 * heads on every draw. So with the option on, every card after the first must
 * be a look-alike of the one before it. The same pinned session with it off is
 * the vacuity guard: there the chain must break somewhere.
 */

async function pinRandom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0.1;
  });
}
async function openFlashcards(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
}

/** Answer `rounds` cards, returning the cellId shown for each. */
async function cellSequence(page: Page, rounds: number): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < rounds; i++) {
    // Any action produces feedback; which one is irrelevant to the draw.
    // B1: the answer deals the next card; the strip carries the answered
    // card's cellId.
    await answerAndReadStrip(page, page.getByRole('button', { name: 'Stand', exact: true }));
    const cell =
      (await page.locator('[data-testid="result-strip"] .hand-result').getAttribute('data-cell-id')) ?? '';
    seen.push(cell.trim());
  }
  return seen;
}

async function runSession(page: Page, byConfusability: boolean): Promise<string[]> {
  await pinRandom(page);
  await withSettings(page, { drill: { flashByConfusability: byConfusability } });
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  return cellSequence(page, 8);
}

const chained = (cells: string[]) => cells.slice(1).every((c, i) => confusabilityWeight(c, cells[i]!) > 1);

test('on, a heads coin forces every card to be a look-alike of the one before', async ({ browser }) => {
  const onPage = await browser.newPage();
  const on = await runSession(onPage, true);
  await onPage.close();
  expect(chained(on), `not a look-alike chain: ${on.join(', ')}`).toBe(true);

  const offPage = await browser.newPage();
  const off = await runSession(offPage, false);
  await offPage.close();
  expect(chained(off), `off also chained, so the check proves nothing: ${off.join(', ')}`).toBe(false);
});


test('on, the toggle is present and persists', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openFlashcards(page);

  await page.locator('details.drill-options > summary').click();
  const toggle = page.locator('.count-toggle', { hasText: 'Follow each hand with a look-alike' }).locator('input');
  await expect(toggle).not.toBeChecked();
  await toggle.check();

  await page.reload();
  await openFlashcards(page);
  await expect(
    page.locator('.count-toggle', { hasText: 'Follow each hand with a look-alike' }).locator('input'),
  ).toBeChecked();
});
