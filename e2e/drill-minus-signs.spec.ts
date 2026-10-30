import { test, expect, type Page } from '@playwright/test';
import { withSettings, pastCountLeadIn } from './helpers';

/**
 * Wave A: one minus sign throughout the drills. The index labels use U+2212
 * ("TC ≤ −3"); the keypad, buttons and prompts beside them used the ASCII
 * hyphen, which is short and easy to misread at a glance.
 */

const MINUS = '−';

async function openDrill(page: Page, name: string): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText(name);
}

test('the keypad shows a negative entry with a real minus sign', async ({ page }) => {
  await withSettings(page, { audio: { enabled: false } });
  await openDrill(page, 'True count drill');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'Plus or minus', exact: true }).click();
  await expect(page.locator('.numpad-display')).toHaveText(`${MINUS}3`);
});

test('pair cancellation answer buttons use a real minus sign', async ({ page }) => {
  await withSettings(page, { audio: { enabled: false } });
  await openDrill(page, 'Pair cancellation');
  const labels = await page.locator('.pair-cancel-answers button.action-btn').allInnerTexts();
  expect(labels).toEqual([`${MINUS}2`, `${MINUS}1`, '0', '+1', '+2']);
});

test('distraction prompts use real minus signs', async ({ page }) => {
  test.setTimeout(60_000);
  // Near-count operands sit near the running count; a run whose count goes
  // negative puts a minus in the prompt. Answer every prompt until one has.
  await withSettings(page, {
    audio: { enabled: false },
    drill: { countManual: true, countLengthCards: 52, countGroup: 1, distractionFreq: 'relentless' },
  });
  await openDrill(page, 'Count drill');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await pastCountLeadIn(page);
  let sawMinus = false;
  for (let i = 0; i < 120 && !sawMinus; i++) {
    if (await page.locator('.distraction-area').isVisible()) {
      const prompt = await page.locator('.distraction-prompt').innerText();
      expect(prompt, 'an ASCII hyphen in a distraction prompt').not.toContain('-');
      sawMinus = prompt.includes(MINUS);
      await page.locator('.distraction-area .numpad-btn', { hasText: /^1$/ }).click();
      await page.getByRole('button', { name: 'OK', exact: true }).click();
      continue;
    }
    if (!(await page.locator('.manual-tap-zone').isVisible())) break;
    await page.locator('.manual-tap-zone').click();
  }
  expect(sawMinus, 'no prompt had a negative number, so nothing was checked').toBe(true);
});
