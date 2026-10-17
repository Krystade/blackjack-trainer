import { test, expect, type Page } from '@playwright/test';
import { withProfile } from './helpers';

test.use({ viewport: { width: 375, height: 812 } });

// Published indices for the default profile (6D H17, Fab 4 off, extras off).
const H17: Record<string, number> = {
  ins: 3, '16v10': 0, '15v10': 4, TTv5: 5, TTv6: 4, '10v10': 4, '12v3': 2, '12v2': 3,
  '9v2': 1, '10vA': 3, '9v7': 3, '16v9': 4, '13v2': -1, '12v4': 0, '12v5': -2, '12v6': -3, '13v3': -2,
};

async function openIndexTest(page: Page) {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills' }).first().click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await page.getByRole('button', { name: 'Index test', exact: true }).click();
  await expect(page.getByTestId('index-test-prompt')).toBeVisible();
}

async function typeIndex(page: Page, n: number) {
  for (const d of String(Math.abs(n))) await page.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
  if (n < 0) await page.getByRole('button', { name: 'Plus or minus' }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
}

async function asked(page: Page): Promise<{ id: string; index: number }> {
  const id = (await page.getByTestId('index-test-prompt').getAttribute('data-deviation-id'))!;
  expect(id in H17, `unexpected index ${id}`).toBe(true);
  return { id, index: H17[id]! };
}

test('a right index is graded right and shows the play it triggers', async ({ page }) => {
  await openIndexTest(page);
  const { index } = await asked(page);
  await typeIndex(page, index);
  const strip = page.getByTestId('result-strip');
  await expect(strip).toHaveAttribute('data-tone', 'ok');
  await expect(page.getByTestId('index-test-result')).toContainText('Correct!');
  await expect(page.getByTestId('index-test-play-line')).toContainText(/ at TC ≥ /);
});

test('a wrong index shows the answered hand, the right index and the play', async ({ page }) => {
  await openIndexTest(page);
  const { index } = await asked(page);
  await typeIndex(page, index + 2);
  await expect(page.getByTestId('result-strip')).toHaveAttribute('data-tone', 'miss');
  const result = page.getByTestId('index-test-result');
  await expect(result).toContainText(' v ');
  await expect(result).toContainText(`you said ${index + 2 > 0 ? '+' : index + 2 < 0 ? '−' : ''}${Math.abs(index + 2)}`);
  await expect(page.getByTestId('index-test-right-index')).toHaveText(`Index ${index > 0 ? '+' : index < 0 ? '−' : ''}${Math.abs(index)}`);
  await expect(page.getByTestId('index-test-play-line')).toContainText(' below');
});

test('an answer reviews that index in the quiz deck', async ({ page }) => {
  await openIndexTest(page);
  const { id, index } = await asked(page);
  await typeIndex(page, index);
  const deck = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.quizsr.v1') ?? '{}'));
  expect(deck[id]?.reviews).toBe(1);
});

test('Ask is remembered and Best play brings the play quiz back', async ({ page }) => {
  await openIndexTest(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await expect(page.getByTestId('index-test-prompt')).toBeVisible();
  await page.getByRole('button', { name: 'Best play', exact: true }).click();
  await expect(page.locator('.quiz-tc')).toBeVisible();
  await expect(page.getByTestId('index-test-prompt')).toHaveCount(0);
});

test('fits a 375×812 phone: OK and the strip are on screen after a miss', async ({ page }) => {
  await openIndexTest(page);
  const { index } = await asked(page);
  await typeIndex(page, index + 1);
  const ok = await page.getByRole('button', { name: 'OK', exact: true }).boundingBox();
  expect(ok!.y + ok!.height).toBeLessThanOrEqual(812);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
