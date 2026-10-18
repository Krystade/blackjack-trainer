import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip, withSettings } from './helpers';

/**
 * E1 (W2-11): every Mixed item shows a true count, in the same element.
 *
 * A Mixed flashcard used to show no count while an index item did, so the
 * screen said which kind of question it was before the learner had to judge
 * whether the count mattered. Pinned like drills.spec's Mixed test:
 * Math.random = 0.42 gives the interleave quiz,quiz,quiz,flash,flash,flash
 * (locked in src/drills/mixedSession.test.ts), and every answer is right, so
 * no learning-step re-deal moves it.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const SHOTS = process.env.E2E_SHOTS_DIR;
const INSET = ':root { --safe-top: 47px; --safe-bottom: 34px; }';

async function openMixed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mixed', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Mixed');
  await page.addStyleTag({ content: INSET });
}

/** Answer the item on screen right (the e2e-only `data-correct`). */
async function answerRight(page: Page): Promise<'ok' | 'miss'> {
  const correct = (await page.locator('.drill-screen').getAttribute('data-correct'))!;
  if (correct === 'take-insurance' || correct === 'decline-insurance') {
    const name = correct === 'take-insurance' ? 'Take insurance' : 'Decline insurance';
    return answerAndReadStrip(page, page.getByRole('button', { name, exact: true }));
  }
  const label = correct.charAt(0).toUpperCase() + correct.slice(1);
  return answerAndReadStrip(page, page.locator('.action-bar button.action-btn', { hasText: label }));
}

test('E1: a flash item and a quiz item both show the TC, in the same element', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openMixed(page);

  const tcByType: Record<string, string[]> = { flash: [], quiz: [] };
  const labelByType: Record<string, string[]> = { flash: [], quiz: [] };
  for (let i = 0; i < 6; i++) {
    const screen = page.locator('.drill-screen');
    const type = (await screen.getAttribute('data-item-type'))!;
    expect(['flash', 'quiz']).toContain(type);
    // ONE selector, both kinds: exactly one TC element, real minus signs.
    const tc = page.locator('.drill-screen > .quiz-tc');
    await expect(tc).toHaveCount(1);
    await expect(tc).toBeVisible();
    const text = (await tc.innerText()).trim();
    expect(text).toMatch(/^TC (\+\d+|−\d+|\+0)$/);
    tcByType[type]!.push(text);

    if (type === 'flash' && tcByType.flash!.length === 1) {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/e1-mixed-flash-item.png` });
      // The voice says the count on a flash item too (the quiz prompt builder).
      const prompts = await page.evaluate(() => (window.__speechLog ?? []).filter((l) => l.startsWith('You have')));
      expect(prompts.at(-1), 'the flash item was spoken with its count').toMatch(/True count (zero|plus \w+|minus \w+)\.$/);
    }
    if (type === 'quiz' && tcByType.quiz!.length === 1 && SHOTS) {
      await page.screenshot({ path: `${SHOTS}/e1-mixed-quiz-item.png` });
    }

    expect(await answerRight(page)).toBe('ok');
    // The answered item on the strip: its count and a quiz-shaped label.
    const result = page.locator('[data-testid="result-strip"] .hand-result');
    await expect(result.locator('.hand-result-ok')).toContainText(`at ${text}`);
    const label = result.locator('.quiz-label');
    await expect(label).toHaveCount(1);
    labelByType[type]!.push((await label.innerText()).trim());
    if (type === 'flash' && labelByType.flash!.length === 1 && SHOTS) {
      await page.screenshot({ path: `${SHOTS}/e1-mixed-flash-strip.png` });
    }
  }

  // Both kinds were reached (non-vacuity), and every one carried a count.
  expect(tcByType.quiz!.length).toBe(3);
  expect(tcByType.flash!.length).toBe(3);
  // A flash label reads like the quiz's own no-index item, or an index label.
  for (const l of labelByType.flash!) expect(l).toMatch(/^(No index applies here — basic strategy\.|.+: \w+ at TC ≥ )/);
});

test('E1: the eyes-free correction panel shows the same label element for a flash item', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'results', answerPauseMs: 15000 } });
  await openMixed(page);
  // Past the three quiz items to the first flash item.
  for (let i = 0; i < 3; i++) expect(await answerRight(page)).toBe('ok');
  await expect(page.locator('.drill-screen')).toHaveAttribute('data-item-type', 'flash');

  await page.getByLabel('Eyes-free audio').check();
  await expect(page.locator('.zone-pad')).toBeVisible();
  // Answer through the keyboard alias of the pad (1-5 = hit..surrender).
  const correct = (await page.locator('.drill-screen').getAttribute('data-correct'))!;
  const key = { hit: '1', stand: '2', double: '3', split: '4', surrender: '5' }[correct]!;
  await page.keyboard.press(key);
  const panel = page.locator('.message-strip');
  await expect(panel.locator('.result-correct')).toBeVisible();
  await expect(panel.locator('.quiz-label')).toHaveCount(1);
  await expect(panel.locator('.feedback-cell')).toHaveCount(0);
  await expect(panel.locator('.quiz-label')).toHaveText(/^(No index applies here — basic strategy\.|.+: \w+ at TC ≥ )/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/e1-mixed-flash-eyesfree-feedback.png` });
});
