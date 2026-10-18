import { test, expect, type Page } from '@playwright/test';
import { generateAllCells } from '../src/drills/flashcards';
import { answerAndReadStrip } from './helpers';

/**
 * E2 (W2-2): the learning step. A missed hand is dealt again after 3-6 other
 * cards (src/drills/learningRedeal.ts), in Flashcards, the Deviation quiz and
 * Mixed, and one right answer on its re-deal keeps it in box 0.
 *
 * Unpinned on purpose: the re-deal is a slot, not a likelihood, so every run
 * must land in the window whatever the draw -- the 500-seed proof is in
 * learningRedeal.test.ts. `data-item-key` (?e2e=1 only) names the item's SR
 * key so a spec can tell the same hand from a look-alike.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const SHOTS = process.env.E2E_SHOTS_DIR;

async function itemKey(page: Page): Promise<string> {
  return (await page.locator('.drill-screen').getAttribute('data-item-key'))!;
}

/** Answer the item on screen right, or wrong with another legal play. */
async function answer(page: Page, right: boolean): Promise<void> {
  const correct =
    (await page.locator('.drill-screen').getAttribute('data-correct')) ??
    (await page.locator('.action-bar').getAttribute('data-advice'))!;
  if (correct === 'take-insurance' || correct === 'decline-insurance') {
    const take = (correct === 'take-insurance') === right;
    await answerAndReadStrip(page, page.getByRole('button', { name: take ? 'Take insurance' : 'Decline insurance', exact: true }));
    return;
  }
  const buttons = page.locator('.action-bar button.action-btn:not([disabled])');
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const t = (await buttons.nth(i).innerText()).trim().toLowerCase();
    if ((t === correct) === right) {
      await answerAndReadStrip(page, buttons.nth(i));
      return;
    }
  }
  throw new Error(`no button to answer ${right ? 'right' : 'wrong'} (correct: ${correct})`);
}

const SR_KEY: Record<string, string | null> = {
  Flashcards: 'bjtrainer.flashsr.v1',
  'Deviation quiz': 'bjtrainer.quizsr.v1',
  // A Mixed flash miss can be a phantom deviation, reviewed under its index
  // (F4b/R9), so which deck holds the card depends on the answer chosen.
  Mixed: null,
};

for (const drill of ['Flashcards', 'Deviation quiz', 'Mixed'] as const) {
  test(`E2 ${drill}: a missed hand comes back after 3-6 others, still in box 0 after one right answer`, async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: drill, exact: true }).click();
    await expect(page.locator('.action-bar')).toBeVisible();

    const keys = [await itemKey(page)];
    expect(keys[0]).not.toBe('distractor');
    await answer(page, false);
    await expect(page.locator('[data-testid="result-strip"]')).toHaveAttribute('data-tone', 'miss');

    const srKey = SR_KEY[drill];
    const readCard = (id: string) =>
      page.evaluate(
        ([k, i]) => (JSON.parse(localStorage.getItem(k!) ?? '{}') as Record<string, { box: number; learningStep?: number }>)[i!],
        [srKey, id] as const,
      );
    let afterRedeal: { box: number; learningStep?: number } | undefined;
    for (let i = 1; i <= 8; i++) {
      keys.push(await itemKey(page));
      const isRedeal = keys[i] === keys[0] && keys.indexOf(keys[0]!, 1) === i;
      if (isRedeal && SHOTS) await page.screenshot({ path: `${SHOTS}/e2-${drill.replace(' ', '-').toLowerCase()}-redeal.png` });
      await answer(page, true);
      // Read straight after the re-deal's answer: the same index can come up
      // again on its own later in the run, and a second right answer cards
      // apart is meant to promote it.
      if (isRedeal && srKey) afterRedeal = await readCard(keys[0]!);
    }

    const back = keys.indexOf(keys[0]!, 1);
    expect(back, `missed ${keys[0]}; dealt ${keys.join(' | ')}`).toBeGreaterThanOrEqual(4);
    expect(back, `missed ${keys[0]}; dealt ${keys.join(' | ')}`).toBeLessThanOrEqual(7);

    // The re-deal was answered right once: the learning step holds it at box 0.
    if (srKey) {
      expect(afterRedeal, `no SR card for ${keys[0]}`).toBeTruthy();
      expect(afterRedeal!.box).toBe(0);
      expect(afterRedeal!.learningStep).toBe(1);
    }
  });
}

test('E2 Review: a missed due cell comes back after 3-6 others, and the review ends only once it is answered right', async ({ page }) => {
  test.setTimeout(60_000);
  const D = '2026-10-16T10:00:00.000Z';
  const due = generateAllCells().map((c) => c.id).slice(40, 61); // 21 due cells: the Review step opens at 20 (ladderRules REVIEW_DUE_MIN)
  await page.addInitScript(([cells, d]) => {
    if (localStorage.getItem('e2e.seeded') === '1') return;
    localStorage.setItem('e2e.seeded', '1');
    // Rung 4 current (count passed), so a review can come first (review-session.spec).
    const strong = { right: 30, wrong: 0, lastAt: d };
    localStorage.setItem('bjtrainer.stats.v1', JSON.stringify({
      version: 1,
      cellStats: { 'hard-16-v-10': strong, 'soft-18-v-9': strong, 'pair-8-v-A': strong },
      masterySweepsCompleted: 1,
      countDrill: { history: Array.from({ length: 5 }, () => ({ date: d, cards: 52, intervalMs: 700, correct: true })) },
    }));
    const past = Date.now() - 86_400_000;
    localStorage.setItem('bjtrainer.flashsr.v1', JSON.stringify(Object.fromEntries(
      cells.map((id) => [id, { box: 2, dueAt: past, lastSeenAt: past - 86_400_000, lapses: 0, reviews: 3 }]),
    )));
  }, [due, D] as const);
  await page.goto('/?e2e=1');
  await page.getByRole('region', { name: 'Next step' }).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Review · 21 due');

  const keys = [await itemKey(page)];
  await answer(page, false);
  for (let i = 1; i <= 21 && (await page.getByTestId('review-done').count()) === 0; i++) {
    keys.push(await itemKey(page));
    await answer(page, true);
  }
  const back = keys.indexOf(keys[0]!, 1);
  expect(back, `missed ${keys[0]}; dealt ${keys.join(' | ')}`).toBeGreaterThanOrEqual(4);
  expect(back, `missed ${keys[0]}; dealt ${keys.join(' | ')}`).toBeLessThanOrEqual(7);
  // 21 cells, one miss: 22 answers, and only then the end state.
  expect(keys).toHaveLength(22);
  await expect(page.getByTestId('review-done')).toContainText('Review done: all 21 cells answered right.');
});
