import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip } from './helpers';

/**
 * #31: long-press the hand in Flashcards or Mastery to mark its cell with a
 * coloured dot. A long press must never also answer the hand.
 */

async function openDrill(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function holdHand(page: Page, ms: number): Promise<void> {
  const box = (await page.locator('.player-hand').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function storedMarkers(page: Page): Promise<Record<string, string>> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill?.markers ?? {},
  );
}

async function graded(page: Page): Promise<number> {
  return page.evaluate(() => {
    const stats = JSON.parse(localStorage.getItem('bjtrainer.stats.v1') ?? '{}');
    return (stats.latencyHistory ?? []).length;
  });
}

const picker = (page: Page) => page.getByRole('dialog', { name: /^Marker for / });

test('flashcards: a long press marks the cell, shows its dot, and answers nothing', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openDrill(page, 'Flashcards');

  // A short press is a tap, not a mark.
  await holdHand(page, 150);
  await expect(picker(page)).toHaveCount(0);

  await holdHand(page, 650);
  await expect(picker(page)).toBeVisible();
  await expect(page.locator('[data-testid="result-strip"]')).toHaveCount(0);
  expect(await graded(page)).toBe(0);

  await picker(page).getByRole('button', { name: 'Red marker', exact: true }).click();
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByTestId('marker-dot')).toHaveAttribute('aria-label', 'Red marker');
  const markers = await storedMarkers(page);
  expect(Object.values(markers)).toEqual(['red']);
  expect(await graded(page)).toBe(0);

  // The dot belongs to that cell: answering shows it was the hand marked.
  await answerAndReadStrip(page, page.getByRole('button', { name: 'Stand', exact: true }));
  const answered = await page.locator('[data-testid="result-strip"] .hand-result').getAttribute('data-cell-id');
  expect(Object.keys(markers)).toEqual([answered]);
});

test('flashcards: with the picker open, the answer bar and the number keys answer nothing', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openDrill(page, 'Flashcards');
  await holdHand(page, 650);
  await expect(picker(page)).toBeVisible();

  await page.keyboard.press('2');
  expect(await graded(page)).toBe(0);
  await expect(picker(page)).toBeVisible();

  // A tap where Stand is lands on the backdrop: the picker closes, the hand
  // is still waiting.
  const stand = (await page.getByRole('button', { name: 'Stand', exact: true }).boundingBox())!;
  await page.mouse.click(stand.x + stand.width / 2, stand.y + stand.height / 2);
  await expect(picker(page)).toHaveCount(0);
  expect(await graded(page)).toBe(0);
  await expect(page.locator('[data-testid="result-strip"]')).toHaveCount(0);
  expect(await storedMarkers(page)).toEqual({});
});

test('mastery: a marked cell joins the Marked deck, and None takes it out', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openDrill(page, 'Mastery challenge');
  await holdHand(page, 650);
  await picker(page).getByRole('button', { name: 'Green marker', exact: true }).click();
  await expect(page.getByTestId('marker-dot')).toHaveAttribute('aria-label', 'Green marker');
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 330 cleared');

  await page.getByRole('combobox', { name: 'Deck', exact: true }).selectOption('marked');
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 1 cleared · Marked · All');
  await expect(page.getByTestId('marker-dot')).toBeVisible();

  await holdHand(page, 650);
  await picker(page).getByRole('button', { name: 'No marker', exact: true }).click();
  expect(await storedMarkers(page)).toEqual({});
  // Nothing marked: the Marked deck is empty and says so.
  await expect(page.getByTestId('empty-deck')).toContainText('No hands are marked yet');
});
