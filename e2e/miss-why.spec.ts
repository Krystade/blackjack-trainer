import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip, withProfile, withSettings } from './helpers';
import { missWhy } from '../src/ui/screens/drills/missWhy';
import { DEFAULT_RULES } from '../src/engine/ruleset';

/**
 * T2-2B: a basic-strategy miss in Flashcards or Mastery says WHY the chart
 * plays the hand that way, in one line under the miss strip -- shown, not
 * folded, because it fits at 375x812 with the next hand's buttons on screen.
 */

test.use({ viewport: { width: 375, height: 812 } });

// withProfile's default rules are DEFAULT_RULES (6 decks, H17, DAS, LS).
const RULES = DEFAULT_RULES;

async function openDrill(page: Page, name: string) {
  await withProfile(page);
  await withSettings(page, { drill: { scopes: ['hard'] } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function standUntilMiss(page: Page): Promise<string> {
  const stand = page.locator('.action-bar').getByRole('button', { name: 'Stand', exact: true });
  for (let i = 0; i < 60; i += 1) {
    if ((await answerAndReadStrip(page, stand)) === 'miss') {
      const id = await page.locator('[data-testid="result-strip"] .hand-result').getAttribute('data-cell-id');
      if (!id) throw new Error('miss strip has no cell id');
      return id;
    }
  }
  throw new Error('no miss in 60 answers');
}

test('Flashcards: a miss says why, for the cell that was missed, with the next hand still answerable on screen', async ({
  page,
}) => {
  await openDrill(page, 'Flashcards');
  const cellId = await standUntilMiss(page);
  const why = page.getByTestId('miss-why');
  await expect(why).toHaveCount(1);
  const expected = missWhy(cellId, RULES);
  expect(expected, cellId).not.toBeNull();
  await expect(why).toHaveText(`Why: ${expected}`);

  // Fits: the line and every answer button are on screen together.
  await expect(why).toBeInViewport({ ratio: 1 });
  const bar = page.locator('.action-bar');
  const box = (await bar.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(812);
  for (const name of ['Hit', 'Stand']) {
    await expect(bar.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }

  // Wrong tap takes it away with the miss.
  await page.locator('[data-testid="result-strip"]').getByRole('button', { name: 'Wrong tap', exact: true }).click();
  await expect(why).toHaveCount(0);
});

test('Mastery: a miss says why too', async ({ page }) => {
  await openDrill(page, 'Mastery challenge');
  const stand = page.locator('.action-bar').getByRole('button', { name: 'Stand', exact: true });
  const strip = page.locator('[data-testid="result-strip"]');
  for (let i = 0; i < 60; i += 1) {
    await stand.click();
    if ((await strip.count()) && (await strip.getAttribute('data-tone')) === 'miss') break;
    const again = page.getByRole('button', { name: 'Start a new sweep', exact: true });
    if (await again.count()) await again.click();
  }
  await expect(strip).toHaveAttribute('data-tone', 'miss');
  const cellId = await strip.locator('.hand-result').getAttribute('data-cell-id');
  await expect(page.getByTestId('miss-why')).toHaveText(`Why: ${missWhy(cellId!, RULES)}`);
  await expect(page.getByTestId('miss-why')).toBeInViewport({ ratio: 1 });
});
