import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { withProfile, withSettings, playRoundByAdvice } from './helpers';
import { signed } from '../src/drills/signed';

test.use({ viewport: { width: 375, height: 812 } });

/**
 * B2 #21: a true count accepted through the by-eye depth band used to tick
 * the graded figure, not the one typed: type −2, read "True count ✓ −3". The
 * verdict now repeats the typed number and names the graded one as also
 * right. Seed 102 under truncate reaches such a check (the finding's round 37).
 */
const SEED_URL = '/?seed=102&e2e=1';
const PROFILE = { countCheckAsk: 'true', tcRounding: 'truncate' } as const;

/**
 * B2 #31 hides the peek while a count check is owed, so the graded TC can no
 * longer be read in the gap the check asks about. Count checks draw nothing
 * from the RNG (only the shuffle, the cut and mistake picks do), so the same
 * seed played the same way deals the same rounds with checks off: read each
 * round's TC off the peek there, then replay it with checks on.
 */
async function gradedTcs(page: Page, rounds: number): Promise<number[]> {
  await withSettings(page, { countCheckEvery: 0 });
  await withProfile(page, { ...PROFILE, countCheckEvery: 0 });
  await page.goto(SEED_URL);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  const peek = page.locator('.tc-peek-btn');
  const tcs: number[] = [];
  for (let round = 1; round <= rounds; round++) {
    await playRoundByAdvice(page);
    await peek.focus();
    await page.keyboard.down('Enter');
    tcs.push(Number(await peek.getAttribute('data-tc')));
    await page.keyboard.up('Enter');
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
  }
  return tcs;
}

test('a count check accepted through the depth band repeats what you typed', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const recorder = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const tcs = await gradedTcs(recorder, 70);
  await recorder.close();

  await withSettings(page, { countCheckEvery: 1 });
  await withProfile(page, { ...PROFILE, countCheckEvery: 1 });
  await page.goto(SEED_URL);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();

  const modal = page.locator('.bottom-sheet', { hasText: 'True count?' });
  const strip = page.getByTestId('result-strip');
  for (let round = 1; round <= 70; round++) {
    await playRoundByAdvice(page);
    // Settled first (playRoundByAdvice returns once the action bar goes, which
    // can be before the dealer has finished): the owed check starts here.
    await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
    await expect(page.locator('.tc-peek-btn')).toHaveCount(0); // #31: no peek while the check is owed
    const actual = tcs[round - 1];

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
