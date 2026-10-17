import { test, expect, type Page } from '@playwright/test';
import { readStats, withProfile, withSettings } from './helpers';

/**
 * Wave A (s05 high): an ordinary double-tap in the counting drills.
 *
 * The bounce guard is 0 under ?e2e=1 (specs answer faster than any person),
 * so these specs switch it back on at its real length.
 */

async function realBounceGuard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __e2eAnswerBounceMs: number }).__e2eAnswerBounceMs = 250;
  });
}

async function openDrill(page: Page, name: string): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText(name);
}

test('true count drill: a double-tapped OK grades one answer, not a phantom 0 on the next question', async ({ page }) => {
  await realBounceGuard(page);
  await withSettings(page, { audio: { enabled: false } });
  await openDrill(page, 'True count drill');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible();
  await page.waitForTimeout(400);
  await page.locator('.numpad-btn', { hasText: /^1$/ }).click();
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  const box = (await ok.boundingBox())!;
  const t0 = Date.now();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(Date.now() - t0, 'the two taps must land inside the guard to test it').toBeLessThan(250);

  await page.waitForTimeout(300);
  const stats = await readStats(page);
  expect(stats, 'no stats saved').not.toBeNull();
  const history = (stats!.trueCount as { history: { guess?: number }[] }).history;
  expect(history).toHaveLength(1);
  expect(history[0]!.guess).toBe(1);
});

test('deck estimation: a double-tapped bottom-row answer shows the result, not the Drills list', async ({ page }) => {
  await realBounceGuard(page);
  await withProfile(page, { rules: { decks: 6 } });
  await openDrill(page, 'Deck estimation');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForTimeout(400);
  const last = page.locator('.deck-guess-btn').last();
  const box = (await last.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.drill-heading')).toHaveText('Deck estimation');
  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.drill-result')).toContainText('You guessed');
  // And after the guard, Next works.
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.deck-guess-btn').first()).toBeVisible();
});

test('produce the true count: the next round waits on Next instead of flashing under the result', async ({ page }) => {
  await realBounceGuard(page);
  await withSettings(page, {
    audio: { enabled: false },
    drill: { countLengthCards: 4, countIntervalMs: 10, countGroup: 1 },
  });
  await openDrill(page, 'Produce the true count');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible();
  await page.waitForTimeout(400);
  await page.locator('.numpad-btn', { hasText: /^0$/ }).click();
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  const box = (await ok.boundingBox())!;
  // A double-tap on OK. Next is not under OK in this layout, so this part
  // checks the stop on the result; the Next guard has its own test below.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.getByTestId('result-strip')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator('.count-flash-area')).toHaveCount(0);
  await expect(page.getByTestId('result-strip')).toBeVisible();
  const stats = await readStats(page);
  expect(stats, 'no stats saved').not.toBeNull();
  expect((stats!.produceTc as { history: unknown[] }).history).toHaveLength(1);

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible();
});

test('produce the true count: a touch on Next inside the guard after OK is not taken as Next', async ({ page }) => {
  await realBounceGuard(page);
  await withSettings(page, {
    audio: { enabled: false },
    drill: { countLengthCards: 4, countIntervalMs: 10, countGroup: 1 },
  });
  await openDrill(page, 'Produce the true count');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible();
  await page.waitForTimeout(400);
  await page.locator('.numpad-btn', { hasText: /^0$/ }).click();
  // OK, then Next the moment it renders: the second touch of a fast pair that
  // reaches Next (a larger finger, a different layout).
  const gapMs = await page.evaluate(async () => {
    const byText = (sel: string, text: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(sel)].find((b) => b.textContent?.trim() === text);
    const t0 = performance.now();
    byText('button.numpad-ok', 'OK')!.click();
    const next = await new Promise<HTMLButtonElement>((resolve) => {
      const tick = () => {
        const b = byText('.drill-primary-bar button', 'Next');
        if (b) resolve(b);
        else requestAnimationFrame(tick);
      };
      tick();
    });
    next.click();
    return performance.now() - t0;
  });
  expect(gapMs, 'Next must be touched inside the guard to test it').toBeLessThan(250);

  await page.waitForTimeout(1000);
  await expect(page.locator('.count-flash-area')).toHaveCount(0);
  await expect(page.getByTestId('result-strip')).toBeVisible();
  // After the guard, Next works.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible();
});

test('OK with nothing typed grades nothing; a typed 0 is an answer', async ({ page }) => {
  await withSettings(page, { audio: { enabled: false } });
  await openDrill(page, 'True count drill');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible();
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  // No '0' on an empty pad: that read as an answer already typed.
  await expect(page.locator('.numpad-display')).not.toHaveText(/^0$/);
  await expect(ok).toBeDisabled();
  await page.keyboard.press('Enter');
  // The minus key alone is not a number either.
  await page.getByRole('button', { name: 'Plus or minus' }).click();
  await expect(ok).toBeDisabled();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const before = await readStats(page);
  expect(((before?.trueCount as { history?: unknown[] } | undefined)?.history ?? []).length).toBe(0);
  await expect(page.locator('.numpad')).toBeVisible();

  await page.getByRole('button', { name: 'Plus or minus' }).click();
  await page.locator('.numpad-btn', { hasText: /^0$/ }).click();
  await expect(page.locator('.numpad-display')).toHaveText('0');
  await ok.click();
  await expect.poll(async () => {
    const st = await readStats(page);
    return ((st?.trueCount as { history?: unknown[] } | undefined)?.history ?? []).length;
  }).toBe(1);
  const history = ((await readStats(page))!.trueCount as { history: { guess?: number }[] }).history;
  expect(history[0]!.guess).toBe(0);
});
