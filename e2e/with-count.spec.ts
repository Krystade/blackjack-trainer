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
  const toggle = page.getByRole('button', { name: 'With count', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill?.withCount);
  expect(saved).toBe(true);

  const seen = new Set<string>();
  for (let i = 0; i < 16; i++) {
    const text = (await tcBox.textContent()) ?? '';
    const tc = Number(text.replace('TC', '').replace('+', '').trim());
    expect(Number.isInteger(tc)).toBe(true);
    const play = tc <= -1 ? 'Hit' : 'Stand';
    expect(await answerAndReadStrip(page, page.getByRole('button', { name: play, exact: true }))).toBe('ok');
    const note = page.getByTestId('hand-result-index');
    if (tc <= -1) await expect(note).toHaveText('Index: 12 v 4: hit at any negative TC');
    else await expect(note).toHaveText('No index here');
    seen.add(play);
  }
  expect([...seen].sort()).toEqual(['Hit', 'Stand']);

  // A wrong answer at a count past the index is a missed deviation.
  for (let i = 0; i < 30; i++) {
    const tc = Number(((await tcBox.textContent()) ?? '').replace('TC', '').replace('+', '').trim());
    if (tc <= -1) {
      expect(await answerAndReadStrip(page, page.getByRole('button', { name: 'Stand', exact: true }))).toBe('miss');
      await expect(page.getByTestId('hand-result-expected')).toHaveText('Hit');
      await expect(page.getByTestId('hand-result-index')).toHaveText('Index: 12 v 4: hit at any negative TC');
      return;
    }
    await answerAndReadStrip(page, page.getByRole('button', { name: 'Stand', exact: true }));
  }
  throw new Error('no negative count in 30 hands');
});
