import { test, expect } from '@playwright/test';
import { answerAndReadStrip, withSettings } from './helpers';

/**
 * #53: With count on, a flashcard shows a TC and is graded at it, and the
 * strip says whether an index applied. One marked cell, 12 v 4: hit at any
 * negative TC (the index), stand otherwise.
 */
test('flashcards With count: 12 v 4 graded at the shown TC, the strip names the index', async ({ page }) => {
  await withSettings(page, { drill: { deck: 'marked', markers: { 'hard-12-v-4': 'red' } } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();

  const tcBox = page.locator('.quiz-tc');
  await expect(tcBox).toHaveCount(0);
  // Flashcards fold the deal toggles under Options; mastery shows them.
  const options = page.locator('details.drill-options > summary');
  if (await options.count()) await options.click();
  const toggle = page.getByRole('button', { name: 'With count', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill?.withCount);
  expect(saved).toBe(true);

  const seen = new Set<string>();
  for (let i = 0; i < 16; i++) {
    const text = (await tcBox.textContent()) ?? '';
    // Wave A: the TC is shown with a real minus sign (U+2212).
    const tc = Number(text.replace('TC', '').replace('+', '').replace('−', '-').trim());
    expect(Number.isInteger(tc)).toBe(true);
    const play = tc <= -1 ? 'Hit' : 'Stand';
    expect(await answerAndReadStrip(page, page.getByRole('button', { name: play, exact: true }))).toBe('ok');
    const note = page.getByTestId('hand-result-index');
    if (tc <= -1) await expect(note).toHaveText('Index: 12 v 4: hit at any negative TC');
    // Wave A (s03): the cell HAS an index the count has not reached.
    else await expect(note).toHaveText('Index not reached at this count: 12 v 4: hit at any negative TC');
    seen.add(play);
  }
  expect([...seen].sort()).toEqual(['Hit', 'Stand']);

  // A wrong answer at a count past the index is a missed deviation.
  for (let i = 0; i < 30; i++) {
    const tc = Number(((await tcBox.textContent()) ?? '').replace('TC', '').replace('+', '').replace('−', '-').trim());
    if (tc <= -1) {
      expect(await answerAndReadStrip(page, page.getByRole('button', { name: 'Stand', exact: true }))).toBe('miss');
      await expect(page.getByTestId('hand-result-expected')).toHaveText('Hit');
      // Wave A (s03): the miss line names the index, so the index note is
      // not printed a second time.
      await expect(page.locator('[data-testid="result-strip"]')).toContainText('12 v 4: hit at any negative TC');
      await expect(page.getByTestId('hand-result-index')).toHaveCount(0);
      return;
    }
    await answerAndReadStrip(page, page.getByRole('button', { name: 'Stand', exact: true }));
  }
  throw new Error('no negative count in 30 hands');
});

/**
 * Review fix: eyes-free never says the count, so switching it on over a
 * With-count card deals a plain card rather than grading at an unheard TC.
 */
test('flashcards With count: switching eyes-free on drops the count', async ({ page }) => {
  await withSettings(page, { drill: { withCount: true }, audio: { enabled: true, answerPauseMs: 0 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.quiz-tc')).toHaveCount(1);
  const options = page.locator('details.drill-options > summary');
  if (await options.count()) await options.click();
  await page.getByLabel('Eyes-free audio').check();
  await expect(page.locator('.quiz-tc')).toHaveCount(0);
});

/**
 * Wave A review (F4b): a missed With-count index is reviewed in the quiz deck
 * under the index, so the strip's "Next review" is the index's, and Wrong tap
 * puts the index's schedule back -- with the flash cell never touched.
 */
test('With count: a missed index shows the index review date, and Wrong tap restores the index', async ({ page }) => {
  const DAY = 86_400_000;
  await page.addInitScript((due) => {
    if (window.localStorage.getItem('e2e.seededSr') === '1') return;
    window.localStorage.setItem('e2e.seededSr', '1');
    // The flash cell is well learned: due a month out.
    window.localStorage.setItem(
      'bjtrainer.flashsr.v1',
      JSON.stringify({ 'hard-12-v-4': { box: 5, dueAt: due, lastSeenAt: due - 60 * 86_400_000, lapses: 0, reviews: 6 } }),
    );
  }, Date.now() + 30 * DAY);
  await withSettings(page, { drill: { deck: 'marked', markers: { 'hard-12-v-4': 'red' }, withCount: true } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();

  const tcBox = page.locator('.quiz-tc');
  const readTc = async () => Number(((await tcBox.textContent()) ?? '').replace('TC', '').replace('+', '').replace('−', '-').trim());
  const storage = (key: string) =>
    page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, unknown>, key);
  for (let i = 0; i < 40; i++) {
    if ((await readTc()) <= -1) break;
    // Off the index: a right Stand, which reviews the flash cell as usual.
    await answerAndReadStrip(page, page.getByRole('button', { name: 'Stand', exact: true }));
  }
  expect(await readTc(), 'no negative count in 40 hands').toBeLessThanOrEqual(-1);

  const flashBefore = await storage('bjtrainer.flashsr.v1');
  expect(flashBefore['hard-12-v-4']).toBeDefined();
  expect((await storage('bjtrainer.quizsr.v1'))['12v4']).toBeUndefined();

  // Past the index, Stand misses it.
  expect(await answerAndReadStrip(page, page.getByRole('button', { name: 'Stand', exact: true }))).toBe('miss');
  expect((await storage('bjtrainer.quizsr.v1'))['12v4'], 'the index was not reviewed').toBeDefined();
  expect(await storage('bjtrainer.flashsr.v1')).toEqual(flashBefore);
  // The index's review (just missed: soon), not the flash cell's (a month).
  const sr = page.locator('[data-testid="result-strip"] .hand-result-sr');
  await expect(sr).toHaveText(/^Next review: (now|in \d+ hours?)$/);

  await page.getByRole('button', { name: 'Wrong tap', exact: true }).click();
  await expect(page.getByTestId('hand-result-undone')).toBeVisible();
  expect((await storage('bjtrainer.quizsr.v1'))['12v4'], 'Wrong tap left the index review in place').toBeUndefined();
  expect(await storage('bjtrainer.flashsr.v1')).toEqual(flashBefore);
});
