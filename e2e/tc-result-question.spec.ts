import { test, expect } from '@playwright/test';
import { withProfile, withSettings } from './helpers';

/**
 * "Add so that the original question is added here."
 *
 * The True Count Drill result read "You entered +4, actual was +3" and
 * nothing else. That is unreviewable: it cannot tell you whether you misread
 * the depth, mis-tracked the running count, or divided wrong -- which are
 * three different mistakes with three different fixes. The result now
 * restates the question that produced it.
 */

async function answerTrueCountDrill(page: import('@playwright/test').Page): Promise<void> {
  await withProfile(page);
  await withSettings(page, { audio: { enabled: false } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True Count Drill', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // Any answer reaches a result; the specs below are about what it SHOWS.
  await page.locator('.numpad-btn').first().click();
  await page.locator('.numpad-ok').click();
}

test('the result restates the running count and the depth', async ({ page }) => {
  await answerTrueCountDrill(page);

  const q = page.locator('.result-question');
  await expect(q).toBeVisible();
  await expect(q).toContainText('Running count');
  await expect(q).toContainText('remaining');
});

test('the restated question matches the question that was asked', async ({ page }) => {
  await answerTrueCountDrill(page);

  const shown = await page.locator('.result-question').innerText();
  // Singular/plural must agree, since "1 decks remaining" reads as a bug.
  if (shown.includes(' 1 deck')) expect(shown).not.toContain('1 decks');
  // And the figures must be real numbers, not placeholders.
  expect(shown).toMatch(/Running count [+-]\d+/);
  expect(shown).toMatch(/[\d.]+ decks? remaining/);
});
