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

/**
 * #24 (R8): a missed index never comes straight back while its answer is on the
 * strip, the last two are avoided, and copying the shown answer is not a
 * clean recall. Seeded so every index is learned and not due -- the shape that
 * made a just-missed (box 0, due now) card win the draw 60% of the time.
 */
test('a missed index is not asked again straight away, and is not promoted on a copied answer', async ({ page }) => {
  const deck: Record<string, unknown> = {};
  for (const id of Object.keys(H17)) deck[id] = { box: 2, dueAt: 4e12, lastSeenAt: 1, lapses: 0, reviews: 3 };
  await page.addInitScript((d) => {
    if (sessionStorage.getItem('seeded') === '1') return;
    localStorage.setItem('bjtrainer.quizsr.v1', d);
    sessionStorage.setItem('seeded', '1');
  }, JSON.stringify(deck));
  await openIndexTest(page);
  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    const { id, index } = await asked(page);
    // Never the last item, nor the one before it.
    expect(seen.slice(-2), `item ${i}: ${id} came back after ${seen.slice(-2).join(', ')}`).not.toContain(id);
    seen.push(id);
    await typeIndex(page, index + 7);
    await expect(page.getByTestId('result-strip')).toHaveAttribute('data-tone', 'miss');
    // A miss is due again soon, never "tomorrow".
    await expect(page.getByTestId('index-test-result')).toContainText('again soon');
  }
});

test('copying the answer shown after a miss holds the index at "soon"; a later recall promotes it', async ({ page }) => {
  const deck: Record<string, unknown> = {};
  for (const id of Object.keys(H17)) deck[id] = { box: 2, dueAt: 4e12, lastSeenAt: 1, lapses: 0, reviews: 3 };
  await page.addInitScript((d) => {
    if (sessionStorage.getItem('seeded') === '1') return;
    localStorage.setItem('bjtrainer.quizsr.v1', d);
    sessionStorage.setItem('seeded', '1');
  }, JSON.stringify(deck));
  await openIndexTest(page);
  const missed = await asked(page);
  await typeIndex(page, missed.index + 7);
  const result = page.getByTestId('index-test-result');
  let copies = 0;
  for (let i = 0; i < 60 && copies < 2; i++) {
    const { id, index } = await asked(page);
    await typeIndex(page, index);
    if (id !== missed.id) continue;
    copies += 1;
    // First right answer after the miss is a copy: held at box 0, due soon.
    // The second is a recall and earns the next box (tomorrow).
    await expect(result).toContainText(copies === 1 ? 'again soon' : 'again tomorrow');
  }
  expect(copies).toBe(2);
});

/**
 * #28: with an iPhone 13 mini's insets (47px status bar, 34px home indicator)
 * a miss strip must not push OK into the home-indicator zone. Headless has no
 * env() insets, so both are injected: --safe-top as the app's own variable and
 * the keypad's env(safe-area-inset-bottom) padding as 34px.
 */
test('with notch insets, OK stays above the home indicator after a miss', async ({ page }) => {
  await page.addInitScript(() => {
    const add = () => {
      const s = document.createElement('style');
      s.textContent = ':root{--safe-top:47px !important} .numpad{padding-bottom:calc(var(--space-3) + 34px) !important}';
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  });
  await openIndexTest(page);
  for (let i = 0; i < 4; i++) {
    const { index } = await asked(page);
    await typeIndex(page, index + 5);
    await expect(page.getByTestId('result-strip')).toHaveAttribute('data-tone', 'miss');
    const ok = (await page.getByRole('button', { name: 'OK', exact: true }).boundingBox())!;
    expect(ok.y + ok.height, `item ${i}: OK bottom`).toBeLessThanOrEqual(812 - 34);
    expect(await page.evaluate(() => document.documentElement.scrollHeight), `item ${i}: page height`).toBeLessThanOrEqual(812);
  }
});
