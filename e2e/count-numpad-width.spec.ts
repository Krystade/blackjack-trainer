import { test, expect, type Page } from '@playwright/test';
import { withSettings, openCountOptions, submitZero } from './helpers';

/**
 * #45: the checkpoint and distraction keypads shrink-wrapped.
 *
 * Both sit in a centred flex column (`align-items: center`), so the NumPad was
 * sized to its content: about 36px keys on a 375px phone, against the ~110px
 * keys of the count-answer keypad, which stretches. Every keypad in a count
 * run must be the same full-width keypad, so a thumb that learnt one hits the
 * others.
 */

test.use({ viewport: { width: 375, height: 812 } });

const SHORT_RUN = { countLengthCards: 10, countGroup: 1 as const, countManual: true };

async function openCountDrill(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await openCountOptions(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

async function advanceUntil(page: Page, until: () => Promise<boolean>, maxTaps: number) {
  for (let i = 0; i < maxTaps; i++) {
    if (await until()) return true;
    await page.locator('.manual-tap-zone').click();
  }
  return until();
}

/** The keypad's outer box and one digit key, in CSS px. */
async function measure(page: Page) {
  const pad = await page.locator('.numpad').boundingBox();
  const key = await page.locator('.numpad-btn').first().boundingBox();
  const ok = await page.locator('.numpad-ok').boundingBox();
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  return { pad: pad!, key: key!, ok: ok!, sideways };
}

const ok = (page: Page) => page.getByRole('button', { name: 'OK', exact: true });

test('the checkpoint keypad is the same full-width keypad as the final answer', async ({ page }) => {
  await withSettings(page, { drill: { ...SHORT_RUN, countCheckpoints: 'one' } });
  await openCountDrill(page);
  expect(await advanceUntil(page, () => page.locator('.checkpoint-area').isVisible(), 12)).toBe(true);
  const checkpoint = await measure(page);
  await submitZero(page);

  expect(await advanceUntil(page, () => ok(page).isVisible(), 12)).toBe(true);
  const answer = await measure(page);

  // Vacuity guard: the answer keypad really is the wide one.
  expect(answer.key.width).toBeGreaterThan(90);
  expect(Math.abs(checkpoint.key.width - answer.key.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(checkpoint.ok.width - answer.ok.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(checkpoint.pad.x - answer.pad.x)).toBeLessThanOrEqual(1);
  expect(checkpoint.key.height).toBeGreaterThanOrEqual(44);
  expect(checkpoint.sideways).toBe(false);
});

test('the distraction keypad is the same full-width keypad as the final answer', async ({ page }) => {
  await withSettings(page, { drill: { ...SHORT_RUN, distractionFreq: 'relentless' } });
  await openCountDrill(page);
  expect(await advanceUntil(page, () => page.locator('.distraction-area').isVisible(), 12)).toBe(true);
  const distraction = await measure(page);

  // Answer the distractions (any number resumes the stream) to reach the end.
  for (let i = 0; i < 12; i++) {
    if (await page.locator('.distraction-area').isVisible()) {
      await submitZero(page);
      continue;
    }
    if (await page.locator('.numpad').isVisible()) break;
    await page.locator('.manual-tap-zone').click();
  }
  await expect(page.locator('.numpad-label')).toHaveText('Enter the running count');
  const answer = await measure(page);

  expect(answer.key.width).toBeGreaterThan(90);
  expect(Math.abs(distraction.key.width - answer.key.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(distraction.ok.width - answer.ok.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(distraction.pad.x - answer.pad.x)).toBeLessThanOrEqual(1);
  expect(distraction.sideways).toBe(false);
});

/**
 * D11: THE COUNT ANSWER IS UNDER THE THUMB. The keypad and OK sat at the top
 * of the screen (y 196-465 of 812) with the lower half empty, while True
 * count, Produce TC and Play's count check keep theirs at the bottom.
 */
test('D11: the count drill answer keypad sits at the foot of the screen', async ({ page }) => {
  await withSettings(page, { drill: SHORT_RUN });
  await openCountDrill(page);
  expect(await advanceUntil(page, () => ok(page).isVisible(), 14)).toBe(true);
  const { pad, key } = await measure(page);
  expect(key.height).toBeGreaterThanOrEqual(44);
  // The keypad's foot within a home indicator's reach of the bottom edge.
  expect(812 - (pad.y + pad.height), 'the keypad floats above an empty lower screen').toBeLessThanOrEqual(48);
  expect(pad.y + pad.height).toBeLessThanOrEqual(812);
});
