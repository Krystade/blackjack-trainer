import { test, expect } from '@playwright/test';
import { withProfile, withSettings, playRoundByAdvice } from './helpers';
import { signed } from '../src/drills/signed';

test.use({ viewport: { width: 375, height: 812 } });

/**
 * B2 #21: a true count accepted through the by-eye depth band used to tick
 * the graded figure, not the one typed: type −2, read "True count ✓ −3". The
 * verdict now repeats the typed number and names the graded one as also
 * right. Seed 102 under truncate reaches such a check (the finding's round 37).
 */
test('a count check accepted through the depth band repeats what you typed', async ({ page }) => {
  test.setTimeout(180_000);
  await withSettings(page, { countCheckEvery: 1 });
  await withProfile(page, { countCheckEvery: 1, countCheckAsk: 'true', tcRounding: 'truncate' });
  await page.goto('/?seed=102&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();

  const peek = page.locator('.tc-peek-btn');
  const modal = page.locator('.bottom-sheet', { hasText: 'True count?' });
  const strip = page.getByTestId('result-strip');
  for (let round = 1; round <= 70; round++) {
    await playRoundByAdvice(page);
    await peek.focus();
    await page.keyboard.down('Enter');
    const actual = Number(await peek.getAttribute('data-tc'));
    await page.keyboard.up('Enter');

    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await expect(modal).toBeVisible();
    // One toward zero: what truncating the exact quotient gives when the
    // half-deck-snapped depth rounds the graded TC away from zero.
    const guess = actual === 0 ? 0 : actual - Math.sign(actual);
    for (const d of String(Math.abs(guess))) await modal.getByRole('button', { name: d, exact: true }).click();
    if (guess < 0) await modal.getByRole('button', { name: 'Plus or minus' }).click();
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(modal).not.toBeVisible();

    const tone = await strip.getAttribute('data-tone');
    if (tone === 'ok' && guess === actual) {
      await expect(strip).toHaveText(`True count ✓ ${signed(actual)}`);
    }
    if (tone === 'ok' && guess !== actual) {
      await expect(strip).toHaveText(`True count ✓ ${signed(guess)} (${signed(actual)} also right)`);
      return;
    }
  }
  throw new Error('no band-accepted off-by-one check in 70 rounds');
});
