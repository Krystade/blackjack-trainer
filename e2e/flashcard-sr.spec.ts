import { test, expect } from '@playwright/test';
import { answerAndReadStrip, withSettings } from './helpers';

/**
 * The spaced-repetition schedule, on the card.
 *
 * It already existed in aggregate -- the Drills picker's "N due" and the Stats
 * box histogram -- so the one place it was invisible was the place you are
 * actually answering. Asked for on 2026-09-16, and the right ask: a right
 * answer stops being a tick and becomes a fortnight of progress you can watch,
 * and a miss stops being a cross and becomes a box you visibly fell out of.
 */

async function openFlashcards(page: import('@playwright/test').Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.action-bar button').first()).toBeVisible();
}

/** Answer whatever is on screen, however it grades. */
async function answerAnything(page: import('@playwright/test').Page) {
  await page.locator('.action-bar button:not([disabled])').first().click();
}

test('a graded card shows its box and when it is next due', async ({ page }) => {
  await withSettings(page, {});
  await openFlashcards(page);

  await answerAnything(page);
  const sr = page.locator('.feedback-sr');
  await expect(sr).toBeVisible();
  await expect(sr).toContainText(/You'll see this again (soon|tomorrow|in \d+)/);
});

/**
 * The schedule is read AFTER grading, which is the whole value of putting it
 * here: a right answer has to visibly push the next review out.
 */
test('getting it right moves the card up a box', async ({ page }) => {
  await withSettings(page, {});
  await openFlashcards(page);

  // Play until a correct answer lands, then read the box off the card.
  let box: number | null = null;
  for (let i = 0; i < 12 && box === null; i++) {
    // B1: the strip holds the answered card's SR line; the next card is up.
    const tone = await answerAndReadStrip(page, page.locator('.action-bar button:not([disabled])').first());
    if (tone === 'ok') {
      box = Number(await page.locator('[data-testid="result-strip"] .feedback-sr').getAttribute('data-box'));
    }
  }

  expect(box, 'no correct answer in twelve tries').not.toBeNull();
  // A first correct answer promotes out of box 0; anything still at 0 after a
  // hit means the deck was not written before the line was read.
  expect(box!).toBeGreaterThan(0);
});

test('an unseen card says nothing rather than pretending to a schedule', async ({ page }) => {
  await withSettings(page, {});
  await openFlashcards(page);

  // Before any answer there is no feedback panel at all, so no schedule line.
  await expect(page.locator('.feedback-sr')).toHaveCount(0);
});
