import { test, expect } from '@playwright/test';
import { shot, withSettings } from './helpers';

const SPEED_TIERS = ['Learning', 'Table-ready', 'Pro', 'Expert'];

test('count drill: flash 4 cards fast, submit RC, see result', async ({ page }) => {
  await withSettings(page, { drill: { countIntervalMs: 300, countLengthCards: 4, countGroup: 1 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await expect(page.locator('.drills-title')).toHaveText('Drills');
  await shot(page, '12-drills-picker');

  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();
  await shot(page, '13-count-drill-setup');

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-flash-area')).toBeVisible();
  await shot(page, '14-count-drill-flashing');

  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await shot(page, '15-count-drill-answering');

  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-correct, .result-wrong')).toBeVisible();
  await shot(page, '16-count-drill-result');

  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();
});

/**
 * Timed Challenge (speed ramp): a short deck + a fast (but floored) starting
 * pace keeps this deterministic and quick under `?e2e=1` (timers still run
 * for real there, they just aren't wall-clock-slow) -- 5 cards ramping down
 * from 300ms settle well within Playwright's default timeouts. Doesn't
 * assert on the exact tier (the drawn count/random RC entry make the
 * elapsed-time-driven tier non-deterministic across CI machines); asserts
 * the timed result block renders with a valid time, a benchmark-normalised
 * speed, and one of the four known tier labels.
 */
test('count drill: timed challenge auto-advances and reports elapsed time + speed tier', async ({ page }) => {
  await withSettings(page, {
    drill: { countLengthCards: 5, countGroup: 1, countTimedStartMs: 300 },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();

  await page.getByLabel('Timed challenge (speed ramp)').check();
  await expect(page.getByText('Starting pace')).toBeVisible();
  await shot(page, '59-timed-challenge-setup');

  await page.getByRole('button', { name: 'Start', exact: true }).click();

  // Auto-advances with no taps -- unlike manual mode, nothing here drives
  // the flash forward except the ramp effect itself.
  await expect(page.locator('.count-flash-area')).toBeVisible();
  await expect(page.locator('.count-timed-badge')).toBeVisible();
  await shot(page, '60-timed-challenge-flashing');

  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.timed-result')).toBeVisible();
  await shot(page, '61-timed-challenge-result');

  const time = await page.locator('.timed-result-time').innerText();
  expect(time).toMatch(/^\d+\.\ds$/);

  const spd = await page.locator('.timed-result-spd').innerText();
  expect(spd).toMatch(/^\d+\.\ds \/ deck$/);

  const tier = await page.locator('.timed-result-tier').innerText();
  expect(SPEED_TIERS).toContain(tier);

  await expect(page.locator('.timed-result-benchmark')).toContainText('table-ready');

  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();
});

test('flashcards: answer shows feedback, Next draws a new card', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
  await shot(page, '17-flashcard-question');

  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  await expect(page.locator('.feedback-cell')).toBeVisible();
  await shot(page, '18-flashcard-feedback');

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.feedback-cell')).not.toBeVisible();
});

test('deviation quiz: answer shows feedback with the index/label text', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Deviation Quiz');
  await shot(page, '19-quiz-question');

  const insurancePrompt = page.locator('.quiz-insurance-prompt');
  if (await insurancePrompt.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Decline Insurance', exact: true }).click();
  } else {
    await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  }

  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  const label = page.locator('.quiz-label');
  await expect(label).toBeVisible();
  await expect(label).not.toHaveText('');
  await shot(page, '20-quiz-feedback');

  await page.getByRole('button', { name: 'Next', exact: true }).click();
});
