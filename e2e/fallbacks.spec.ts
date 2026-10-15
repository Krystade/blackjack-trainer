import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip, withSettings } from './helpers';

/**
 * #27: with Fallbacks on, some double cells are dealt as three cards. The
 * deck here is one marked cell, hard 11 v 5 (Dh), so every hand is either
 * the two-card double or its three-card fallback.
 */

async function openDrill(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

const handCards = (page: Page) => page.locator('.hands-row .hand-cards > *');

for (const drill of ['Flashcards', 'Mastery challenge']) {
  test(`${drill}: a three-card 11 v 5 says No double, has no Double, and Hit is right`, async ({ page }) => {
    await withSettings(page, { drill: { deck: 'marked', markers: { 'hard-11-v-5': 'red' } } });
    await page.goto('/?e2e=1');
    await openDrill(page, drill);

    const toggle = page.getByRole('button', { name: 'Fallbacks', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill?.fallbacks);
    expect(saved).toBe(true);

    const double = page.getByRole('button', { name: 'Double', exact: true });
    const mastery = drill === 'Mastery challenge';
    // A one-cell mastery sweep ends on every correct answer; start the next.
    const answerRight = async (button: typeof double) => {
      if (!mastery) {
        expect(await answerAndReadStrip(page, button)).toBe('ok');
        return;
      }
      await button.click();
      await expect(page.locator('.mastery-complete')).toContainText('Sweep complete');
    };
    let threeCard = false;
    for (let i = 0; i < 80 && !threeCard; i++) {
      if ((await handCards(page).count()) === 3) {
        threeCard = true;
        break;
      }
      await expect(page.getByTestId('rules-chip')).not.toContainText('No double');
      await answerRight(double);
      if (mastery) await page.getByRole('button', { name: 'Start a new sweep', exact: true }).click();
    }
    expect(threeCard).toBe(true);
    await expect(page.getByTestId('rules-chip')).toContainText('No double');
    await expect(page.getByTestId('rules-chip')).toContainText('No surrender');
    await expect(double).toBeDisabled();
    await answerRight(page.getByRole('button', { name: 'Hit', exact: true }));
  });
}
