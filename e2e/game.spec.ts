import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { shot, withSettings, resolveInsurance, playRoundByAdvice } from './helpers';

test('home renders and navigates to the table', async ({ page }) => {
  await page.goto('/?e2e=1');
  await expect(page.locator('.home-title')).toHaveText('Blackjack Trainer');
  for (const label of ['Play', 'Drills', 'Stats', 'Settings']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await shot(page, '01-home');

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  await shot(page, '02-table-idle-bet');
});

test('full round via clicks settles and shows a result', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0 });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();

  await playRoundByAdvice(page);

  await expect(page.locator('.message-strip .message-result').first()).toBeVisible();
  await shot(page, '03-table-round-settled');
});

test('dealer showing an ace triggers the insurance modal', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0 });

  let found = false;
  for (let seed = 1; seed <= 25 && !found; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    const modal = page.locator('.modal-backdrop', { hasText: 'Insurance?' });
    if (await modal.isVisible().catch(() => false)) {
      found = true;
      await expect(modal).toContainText('Dealer shows an Ace');
      await shot(page, '04-insurance-modal');
      await modal.getByRole('button', { name: 'Decline', exact: true }).click();
      await playRoundByAdvice(page);
    }
  }
  expect(found, 'expected at least one of seeds 1..25 to deal a dealer ace up-card').toBe(true);
});

test('training mode: a wrong action shows the mistake overlay', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'training', countCheckEvery: 0 });
  await page.goto('/?seed=3&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);

  const bar = page.locator('.action-bar[data-advice]');
  await expect(bar).toBeVisible();
  const advice = await bar.getAttribute('data-advice');
  expect(advice).toBeTruthy();

  const enabledButtons = bar.locator('button.action-btn:not([disabled])');
  const count = await enabledButtons.count();
  let wrongLabel: string | null = null;
  for (let i = 0; i < count; i++) {
    const text = (await enabledButtons.nth(i).innerText()).trim();
    if (text.toLowerCase() !== advice) {
      wrongLabel = text;
      break;
    }
  }
  expect(wrongLabel, 'expected at least one legal action other than the advised one').toBeTruthy();

  await bar.getByRole('button', { name: wrongLabel!, exact: true }).click();

  const overlay = page.locator('.modal-backdrop', { hasText: 'Wrong Play' });
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Correct:');
  await expect(overlay).toContainText(/Basic|TC/i);
  await shot(page, '05-training-wrong-overlay');

  await overlay.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(overlay).not.toBeVisible();
});

/** Play a round, deliberately taking one legal-but-wrong action so the
 * session accumulates at least one mistake for the report to show. */
async function playRoundWithOneMistake(page: Page): Promise<void> {
  let usedMistake = false;
  for (let guard = 0; guard < 30; guard++) {
    if (await resolveInsurance(page, false)) continue;

    const bar = page.locator('.action-bar[data-advice]');
    if (!(await bar.isVisible().catch(() => false))) return;
    const advice = await bar.getAttribute('data-advice');
    if (!advice) return;

    if (!usedMistake) {
      const enabledButtons = bar.locator('button.action-btn:not([disabled])');
      const count = await enabledButtons.count();
      for (let i = 0; i < count; i++) {
        const text = (await enabledButtons.nth(i).innerText()).trim();
        if (text.toLowerCase() !== advice) {
          usedMistake = true;
          await bar.getByRole('button', { name: text, exact: true }).click();
          break;
        }
      }
      if (usedMistake) continue;
    }

    const label = advice.charAt(0).toUpperCase() + advice.slice(1);
    await bar.getByRole('button', { name: label, exact: true }).click();
  }
  throw new Error('playRoundWithOneMistake: exceeded guard iterations without settling');
}

test('test mode: a 3-round session reports categories and misses', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', countCheckEvery: 0 });
  await page.goto('/?seed=4&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  for (let round = 0; round < 3; round++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await playRoundWithOneMistake(page);
  }

  await page.locator('.end-btn').click();
  await expect(page.locator('.report-screen')).toBeVisible();
  await expect(page.locator('.report-categories tbody tr')).not.toHaveCount(0);
  await expect(page.locator('.report-mistakes li')).not.toHaveCount(0);
  await shot(page, '06-test-mode-report');

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
});

test('count-check modal appears after a round and grades a running-count entry', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 1 });
  await page.goto('/?seed=5&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);

  const modal = page.locator('.modal-backdrop', { hasText: 'Running Count?' });
  await expect(modal).toBeVisible();
  await expect(modal.locator('.numpad-label')).toHaveText('Enter running count');
  await shot(page, '07-count-check-numpad');

  await modal.getByRole('button', { name: '5', exact: true }).click();
  await modal.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
});

test('bet spread: a deliberately bad bet is graded and shows in the test-mode report', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', betSpreadOn: true, countCheckEvery: 0 });
  await page.goto('/?seed=6&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  // At tc 0 the default spread's correct bet is 1 unit; deliberately pick 8.
  await expect(page.locator('.bet-chips')).toBeVisible();
  await page.locator('.chip-btn', { hasText: /^8$/ }).click();
  await shot(page, '08-bet-chip-selected');
  await page.getByRole('button', { name: 'Deal', exact: true }).click();

  await playRoundByAdvice(page);
  await page.locator('.end-btn').click();

  await expect(page.locator('.report-screen')).toBeVisible();
  const betRow = page.locator('.report-categories tr', { hasText: 'bet' });
  await expect(betRow).toBeVisible();
  await expect(betRow).toContainText('bet');
  await shot(page, '09-bet-spread-report');
});

test('split flow: find a ten-value pair seed, split, and play both hands out', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0 });

  const TEN_GROUP = new Set(['10', 'J', 'Q', 'K']);
  function rankOf(dataCard: string): string {
    return dataCard.slice(0, -1); // strip trailing suit char
  }

  let foundSeed: number | null = null;
  for (let seed = 1; seed <= 50; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);

    // If dealer/player blackjack settled the round immediately, no pair to split.
    const cards = page.locator('.hands-row .player-hand').first().locator('.card[data-card]');
    const cardCount = await cards.count();
    if (cardCount !== 2) continue;

    const [c0, c1] = await Promise.all([cards.nth(0).getAttribute('data-card'), cards.nth(1).getAttribute('data-card')]);
    if (!c0 || !c1) continue;
    const r0 = rankOf(c0);
    const r1 = rankOf(c1);
    if (TEN_GROUP.has(r0) && TEN_GROUP.has(r1)) {
      foundSeed = seed;
      break;
    }
  }

  expect(foundSeed, 'expected at least one of seeds 1..50 to deal a ten-value pair').not.toBeNull();
  console.log(`[split-seed-hunt] found ten-value pair at seed=${foundSeed}`);

  const splitBtn = page.locator('.action-bar[data-advice] button.action-btn', { hasText: 'Split' });
  await expect(splitBtn).toBeEnabled();
  await splitBtn.click();

  await expect(page.locator('.hands-row .player-hand')).toHaveCount(2);
  await shot(page, '10-split-two-hands');

  await playRoundByAdvice(page);
  await expect(page.locator('.message-strip .message-result')).not.toHaveCount(0);
  await shot(page, '11-split-round-settled');
});
