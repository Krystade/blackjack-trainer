import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * V5-1 (docs/BACKLOG.md): the flashcard draw is biased toward the cells most
 * easily confused with the one just answered.
 *
 * The weighting itself is unit-tested. What only a browser can check is the
 * CHAIN: the view has to remember the cell it just showed and hand it back to
 * the next draw. If `lastCellRef` is never updated the feature is silently
 * inert -- every draw sees `null`, every weight collapses to 1, and every unit
 * test still passes because they pass the previous cell in by hand.
 *
 * Pinning Math.random removes the seed as a variable. It does NOT make the
 * draw constant -- the SR deck mutates on every answer, so the weights move
 * even with the toggle off (a first version of this spec asserted otherwise
 * and failed, which is why the comparison below is structured the way it is).
 *
 * So the test runs the SAME pinned session twice, once with the toggle off and
 * once on, answering identically both times. Card 1 is drawn with no previous
 * cell and must match. Up to the first divergence both runs have seen the same
 * seeds and the same SR history, so if the sequences differ AT ALL the only
 * input that could have caused it is the previous-cell term -- which is
 * exactly the chain being tested. `.feedback-cell` is existing production
 * markup that renders the cellId, so nothing here is a test-only affordance.
 */

async function pinRandom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0.4242;
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
    await page.getByRole('button', { name: 'Stand', exact: true }).click();
    const cell = await page.locator('.feedback-cell').innerText();
    seen.push(cell.trim());
    await page.locator('.drill-next-btn').click();
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

test('the previous cell reaches the draw and changes it', async ({ browser }) => {
  const offPage = await browser.newPage();
  const off = await runSession(offPage, false);
  await offPage.close();

  const onPage = await browser.newPage();
  const on = await runSession(onPage, true);
  await onPage.close();

  // Sanity: the first card is drawn with no previous cell, so the two runs
  // must start identically. If this fails the comparison below is meaningless
  // -- something other than the toggle differs between the runs.
  expect(on[0], `runs started differently: ${off.join(', ')} vs ${on.join(', ')}`).toBe(off[0]);

  // And then they must part company. Identical throughout would mean the
  // previous cell never reached the weights.
  expect(on, `sequences identical, so the term did nothing: ${on.join(', ')}`).not.toEqual(off);
});

test('on, the toggle is present and persists', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openFlashcards(page);

  const toggle = page.locator('.count-toggle', { hasText: 'Follow each hand with one you' }).locator('input');
  await expect(toggle).not.toBeChecked();
  await toggle.check();

  await page.reload();
  await openFlashcards(page);
  await expect(
    page.locator('.count-toggle', { hasText: 'Follow each hand with one you' }).locator('input'),
  ).toBeChecked();
});
