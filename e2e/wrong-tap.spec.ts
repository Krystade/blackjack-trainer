import { test, expect, type Page } from '@playwright/test';
import { readStats, withStats } from './helpers';
import { EMPTY_STATS } from '../src/store/types';

/**
 * #22 "Wrong tap": a miss on the B1 strip can be withdrawn until the next
 * answer. Withdrawing it must leave Stats and the spaced-repetition deck
 * exactly as they were before the answer (plus one misclick), and in mastery
 * put the run back where it was.
 *
 * Each hand drill is driven by answering the first enabled button until the
 * strip shows a miss. The state is read BEFORE every answer, so whichever
 * answer turns out to be the miss, its "before" is known exactly.
 */

async function openDrill(page: Page, name: string) {
  // A full blob from the start, so "before" is comparable even when the very
  // first answer is the miss.
  await withStats(page, EMPTY_STATS as unknown as Record<string, unknown>);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function snapshot(page: Page, srKeys: string[]) {
  return page.evaluate((keys) => {
    const read = (k: string) => {
      const raw = window.localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as unknown) : null;
    };
    // An SR deck nobody has written yet and an empty one are the same deck.
    return { stats: read('bjtrainer.stats.v1'), sr: keys.map((k) => read(k) ?? {}) };
  }, srKeys);
}

/** Answer with the first enabled button until a miss is on the strip; return
 *  the state as it was just before the miss. */
async function answerUntilMiss(page: Page, srKeys: string[]) {
  const strip = page.locator('[data-testid="result-strip"]');
  for (let i = 0; i < 40; i += 1) {
    const before = await snapshot(page, srKeys);
    const result = strip.locator('.hand-result');
    const prevId = (await result.count()) > 0 ? await result.getAttribute('data-result-id') : null;
    await page.locator('.action-bar button:not([disabled])').first().click();
    await expect(result).toHaveCount(1);
    if (prevId !== null) await expect(result).not.toHaveAttribute('data-result-id', prevId);
    if ((await strip.getAttribute('data-tone')) === 'miss') return before;
  }
  throw new Error('no miss in 40 answers');
}

for (const [drill, srKeys] of [
  ['Flashcards', ['bjtrainer.flashsr.v1']],
  ['Deviation quiz', ['bjtrainer.quizsr.v1']],
  ['Mixed', ['bjtrainer.flashsr.v1', 'bjtrainer.quizsr.v1']],
] as const) {
  test(`wrong tap (${drill}): the miss leaves Stats and the review deck as they were, and counts a misclick`, async ({ page }) => {
    await openDrill(page, drill);
    const before = await answerUntilMiss(page, [...srKeys]);

    const strip = page.locator('[data-testid="result-strip"]');
    await strip.getByRole('button', { name: 'Wrong tap', exact: true }).click();
    await expect(strip.getByTestId('hand-result-undone')).toContainText('Not counted:');
    await expect(strip.getByRole('button', { name: 'Wrong tap' })).toHaveCount(0);

    const after = await snapshot(page, [...srKeys]);
    const beforeStats = (before.stats ?? {}) as Record<string, unknown>;
    expect(after.sr).toEqual(before.sr);
    expect(after.stats).toEqual({ ...beforeStats, misclicks: ((beforeStats.misclicks as number) ?? 0) + 1 });
  });
}

test('wrong tap is offered only until the next answer, and never on a correct strip', async ({ page }) => {
  await openDrill(page, 'Flashcards');
  await answerUntilMiss(page, []);
  const strip = page.locator('[data-testid="result-strip"]');
  await expect(strip.getByRole('button', { name: 'Wrong tap' })).toHaveCount(1);

  // Answer until a CORRECT strip: it never carries the link, and the miss
  // before it can no longer be withdrawn.
  for (let i = 0; i < 40; i += 1) {
    await page.locator('.action-bar button:not([disabled])').last().click();
    if ((await strip.getAttribute('data-tone')) === 'ok') break;
  }
  await expect(strip).toHaveAttribute('data-tone', 'ok');
  await expect(strip.getByRole('button', { name: 'Wrong tap' })).toHaveCount(0);
});

test('wrong tap (mastery): the run goes back to where it was, the same hand returns, Stats show the misclick', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('bjtrainer.masteryrun.v1', JSON.stringify({ scope: 'all', seed: 12345, index: 110 }));
  });
  await openDrill(page, 'Mastery challenge');
  const progress = page.locator('[data-testid="mastery-progress"]');
  await expect(progress).toContainText('110 / 330 cleared');
  const before = await readStats(page);

  // Stand on 4,4 v 4 is wrong under every rule set (see mastery-challenge.spec #10).
  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  await expect(progress).toContainText('0 / 330 cleared');

  const strip = page.locator('[data-testid="result-strip"]');
  await strip.getByRole('button', { name: 'Wrong tap', exact: true }).click();
  await expect(progress).toContainText('110 / 330 cleared');
  await expect(strip.getByTestId('hand-result-undone')).toHaveText('Not counted: 4,4 v 4');
  await expect(page.locator('.hands-row .card-rank')).toHaveText(['4', '4']);
  await expect(page.locator('.dealer-area .card-rank')).toHaveText(['4']);

  const after = await readStats(page);
  expect(after).toEqual({ ...(before ?? {}), misclicks: 1 });

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true }).click();
  await page.locator('.home-stats-link').click();
  await expect(page.getByTestId('stats-misclicks')).toContainText('1');
});
