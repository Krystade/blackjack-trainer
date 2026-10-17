import { test, expect } from '@playwright/test';
import { answerAndReadStrip, withSettings } from './helpers';

/**
 * B7: a basic-strategy miss in Flashcards teaches the chart REGION the hand
 * sits in ("Hard 12–16 v 7–A: hit.") instead of the bare cell label ("Basic
 * hard 16 vs dealer 10"). The deviation quiz keeps its index label.
 */

const REASON = '[data-testid="result-strip"] .hand-result-reason';
const RULE =
  /^Basic strategy error\. Hard (\d+)(?:–(\d+)|(\+))? v (\d+|A|any dealer card)(–(\d+|A))?: (hit|stand|double|surrender)/;

test('a flashcard miss names the chart region it belongs to', async ({ page }) => {
  await withSettings(page, { drill: { scopes: ['hard'] } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');

  const stand = page.locator('.action-bar button.action-btn', { hasText: /^Stand$/ });
  let missed = false;
  for (let i = 0; i < 20 && !missed; i++) {
    missed = (await answerAndReadStrip(page, stand)) === 'miss';
  }
  expect(missed, 'Stand was right on 20 hard cards in a row').toBe(true);

  const reason = (await page.locator(REASON).innerText()).trim();
  expect(reason).not.toMatch(/Basic \w+ vs dealer/);
  const m = RULE.exec(reason);
  expect(m, reason).not.toBeNull();

  const cellId = await page
    .locator('[data-testid="result-strip"] .hand-result[data-cell-id]')
    .getAttribute('data-cell-id');
  const total = Number(/^hard-(\d+)-v-/.exec(cellId ?? '')?.[1]);
  const lo = Number(m![1]);
  const hi = m![3] ? 21 : m![2] ? Number(m![2]) : lo;
  expect(total, `${cellId} inside "${reason}"`).toBeGreaterThanOrEqual(lo);
  expect(total, `${cellId} inside "${reason}"`).toBeLessThanOrEqual(hi);
});

test('the deviation quiz keeps its index label', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await page.locator('.quiz-index-select').selectOption('16v10');

  // Double is never the play on a hard 16: a guaranteed miss.
  const double = page.locator('.action-bar button.action-btn', { hasText: 'Double' });
  expect(await answerAndReadStrip(page, double)).toBe('miss');
  const reason = await page.locator(REASON).innerText();
  expect(reason).toContain(':');
  expect(reason).toContain('TC');
});
