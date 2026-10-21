import { test, expect, type Page } from '@playwright/test';
import { withProfile, withSettings, readStats } from './helpers';

/**
 * #54: the true count drill fast-advances. An answer goes straight to the
 * next question, and the B1 strip above it carries the previous result with
 * the exact working ("−6 ÷ 5.5 = −1.09 → floor −2") of the question that was
 * ASKED -- restating the question is what made a miss reviewable, and the
 * strip must not describe the new question instead.
 */

const MINUS = '−';

async function openDrill(page: Page): Promise<void> {
  await withProfile(page);
  await withSettings(page, { audio: { enabled: false } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True count drill', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

async function readQuestion(page: Page): Promise<{ rc: number; decks: number }> {
  const rc = Number((await page.locator('.quiz-tc').innerText()).replace(/−/g, '-').replace(/[^\d+-]/g, ''));
  const decks = Number((await page.locator('.tag-guess-label').innerText()).replace(/[^\d.]/g, ''));
  return { rc, decks };
}

async function enter(page: Page, n: number): Promise<void> {
  for (const d of String(Math.abs(n))) {
    await page.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
  }
  if (n < 0) await page.getByRole('button', { name: 'Plus or minus' }).click();
  await page.locator('.numpad-ok').click();
}

const signed = (n: number) => (n === 0 ? '0' : n > 0 ? `+${n}` : MINUS + Math.abs(n));

const plain = (n: number) => {
  const s = String(Number(n.toFixed(2)));
  return s.startsWith('-') ? MINUS + s.slice(1) : s;
};

test('an answer goes straight to the next question, and the strip shows the asked question worked', async ({
  page,
}) => {
  await openDrill(page);
  const { rc, decks } = await readQuestion(page);
  const floor = Math.floor(rc / decks);
  await enter(page, floor);

  // No result screen, no Next tap: the keypad is back for the next question.
  // The strip is the proof the answer was graded; the absence follows it.
  const strip = page.getByTestId('result-strip');
  await expect(strip).toHaveAttribute('data-tone', 'ok');
  await expect(page.locator('.drill-result')).toHaveCount(0);
  await expect(page.locator('.numpad')).toBeVisible();
  await expect(strip).toContainText(`Correct! ${signed(rc)} ÷ ${plain(decks)} = ${plain(rc / decks)}`);
  await expect(strip).toContainText('floor');

  const history = ((await readStats(page))!.trueCount as { history: { correct: boolean }[] }).history;
  expect(history).toHaveLength(1);
  expect(history[0]!.correct).toBe(true);
});

test('a truncate answer under a floor profile is wrong, and the strip names the convention', async ({
  page,
}) => {
  await openDrill(page);
  // Skip questions where floor and truncate agree; about half disagree.
  for (let i = 0; i < 40; i++) {
    const { rc, decks } = await readQuestion(page);
    const floor = Math.floor(rc / decks);
    const trunc = Math.trunc(rc / decks);
    if (floor === trunc) {
      await enter(page, floor);
      continue;
    }
    await enter(page, trunc);
    const strip = page.getByTestId('result-strip');
    await expect(strip).toHaveAttribute('data-tone', 'miss');
    await expect(strip).toContainText(`${signed(rc)} ÷ ${plain(decks)}`);
    await expect(strip).toContainText('your profile floors');
    await expect(strip).toContainText(`is truncate`);
    // Wave A: answer first, and no dash against a minus sign (floor and
    // truncate only disagree below zero, so this strip always has one).
    await expect(strip).toContainText(`Wrong: TC ${signed(floor)}, not ${signed(trunc)}`);
    expect(await strip.innerText()).not.toMatch(/[—-]\s*−/);
    const history = ((await readStats(page))!.trueCount as { history: { correct: boolean }[] }).history;
    expect(history.at(-1)!.correct).toBe(false);
    return;
  }
  throw new Error('no floor/truncate disagreement in 40 questions');
});
