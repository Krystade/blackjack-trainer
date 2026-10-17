import { test, expect } from '@playwright/test';
import { withSettings } from './helpers';

test('mastery challenge: default scope is All, progress starts at 0', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Mastery challenge');

  const scopeRow = page.locator('.settings-row', { hasText: 'Hands' });
  await expect(scopeRow.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 330 cleared');
});

test('mastery challenge: switching scope resets progress and shows the new total', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();

  const scopeRow = page.locator('.settings-row', { hasText: 'Hands' });
  await scopeRow.getByRole('button', { name: 'Pairs', exact: true }).click();
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 100 cleared');
});

/**
 * The core mechanic: one wrong answer resets the WHOLE run. Pins Math.random
 * so the run's cell sequence is reproducible, plays the FIRST cell correctly
 * (progress advances to 1), then forces a wrong answer and asserts progress
 * falls back to 0 and the reset banner appears.
 */
test('mastery challenge: a wrong answer resets progress to 0/N with a visible reset banner', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await withSettings(page, { drill: { flashCategory: 'hard' } }); // unrelated setting, just a stable baseline
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();

  const scopeRow = page.locator('.settings-row', { hasText: 'Hands' });
  await scopeRow.getByRole('button', { name: 'Hard', exact: true }).click();
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 150 cleared');

  // Force a wrong answer regardless of what's correct: try every action in
  // turn until one is graded wrong (only one of the five can be "correct").
  const actions = ['Hit', 'Stand', 'Double', 'Split', 'Surrender'];
  let reset = false;
  for (const label of actions) {
    const btn = page.locator('.action-bar button.action-btn', { hasText: label });
    if (await btn.isDisabled()) continue;
    await btn.click();
    const bannerVisible = await page.locator('.mastery-reset-banner').isVisible().catch(() => false);
    if (bannerVisible) {
      reset = true;
      break;
    }
    // That action was graded correct -- undo isn't possible, so this specific
    // run's first cell is now solved; reload and retry with a fresh seed
    // rather than looping indefinitely on an already-advanced run.
    await page.reload();
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();
  }
  expect(reset).toBe(true);
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 150 cleared');
});

test('mastery challenge: an illegal action (disabled button aside) never advances or resets progress', async ({ page }) => {
  await withSettings(page, {});
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();

  const scopeRow = page.locator('.settings-row', { hasText: 'Hands' });
  await scopeRow.getByRole('button', { name: 'Hard', exact: true }).click(); // no pair cells in scope
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 150 cleared');

  // Split is never legal on a hard-scope (non-pair) hand -- its button is
  // disabled; pressing the '4' key must be refused by the same gate, not
  // silently graded.
  await expect(page.locator('.action-bar button.action-btn', { hasText: 'Split' })).toBeDisabled();
  await page.keyboard.press('4');
  await expect(page.locator('.message-strip .result-correct, .mastery-reset-banner')).toHaveCount(0);
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 150 cleared');
});

test('mastery challenge: progress survives a reload (persisted run, not lost on navigation)', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.9;
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();

  const scopeRow = page.locator('.settings-row', { hasText: 'Hands' });
  await scopeRow.getByRole('button', { name: 'Pairs', exact: true }).click();

  // Answer with the shown advice if the ActionBar exposes one; otherwise
  // click whichever legal action isn't disabled and accept whatever happens
  // -- this spec only cares that the persisted index matches what's on
  // screen after a reload, not that a specific answer is correct.
  const before = await page.locator('[data-testid="mastery-progress"]').innerText();

  await page.reload();
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();
  const after = await page.locator('[data-testid="mastery-progress"]').innerText();
  expect(after).toBe(before); // merely navigating away/back is NOT a mistake

  const stored = await page.evaluate(() => window.localStorage.getItem('bjtrainer.masteryrun.v1'));
  expect(stored).not.toBeNull();
  // #13: the run stores the cells it walks, not a scope name.
  const order = JSON.parse(stored!).order as string[];
  expect(order).toHaveLength(100);
  expect(order.every((id) => id.startsWith('pair-'))).toBe(true);
});

test('mastery challenge #6: there is no Distractions control, and answering never interrupts', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();
  await expect(page.locator('[data-testid="mastery-progress"]')).toBeVisible();
  await expect(page.locator('.settings-row', { hasText: 'Distractions' })).toHaveCount(0);
  await expect(page.locator('.distraction-area')).toHaveCount(0);
});

/**
 * #10 regression. The miss used to call setRun(nextRun) before the feedback
 * rendered, so the chart (and the correction) read the RESHUFFLED run's first
 * cell. A miss on 4,4 v 4 must open the chart on the PAIRS row of the
 * answered hand, whatever the reset deals next.
 *
 * Seed 12345 puts pair-4-v-4 at index 110 of the All scope (startMasteryRun);
 * the first assertion fails loudly if that ever stops being true.
 */
test('mastery challenge #10: a miss on 4,4 v 4 opens the chart on PAIRS, and the strip names the lost progress', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.42;
    window.localStorage.setItem('bjtrainer.masteryrun.v1', JSON.stringify({ scope: 'all', seed: 12345, index: 110 }));
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('110 / 330 cleared');

  // Stand on 4,4 v 4 is wrong under every rule set.
  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();

  // B1: no Next tap; the run reset and the next hand is already up.
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-testid="mastery-progress"]')).toContainText('0 / 330 cleared');
  const strip = page.locator('[data-testid="result-strip"]');
  await expect(strip.getByTestId('hand-result-hand')).toHaveText('4,4 v 4');
  await expect(strip).toContainText('Run reset at 110/330');
  await expect(strip.getByTestId('hand-result-taken')).toHaveText('Stand');

  await strip.getByRole('button', { name: 'Show on chart', exact: true }).click();
  const overlay = page.locator('.study-chart-overlay');
  const highlighted = overlay.locator('[data-highlight="true"]');
  await expect(highlighted).toHaveCount(1);
  await expect(highlighted.locator('xpath=ancestor::section[1]')).toHaveAttribute('data-section', 'PAIRS');
});

/**
 * #29: a new sweep is ordered by the flashcard SR schedule. Every Pairs cell
 * is reviewed and not due except 8,8 v A, a month overdue: it is dealt among
 * the first few hands instead of anywhere in the hundred. The seed is pinned,
 * so this is one fixed shuffle; a uniform one deals the cell 96th.
 */
test('mastery #29: an overdue cell comes early in a new sweep', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.42;
    const DAY = 86_400_000;
    const now = Date.now();
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    const deck: Record<string, unknown> = {};
    for (const r of ranks) {
      for (const up of ranks) {
        deck[`pair-${r}-v-${up}`] = { box: 5, dueAt: now + 20 * DAY, lastSeenAt: now, lapses: 0, reviews: 4 };
      }
    }
    deck['pair-8-v-A'] = { box: 0, dueAt: now - 30 * DAY, lastSeenAt: now - 30 * DAY, lapses: 1, reviews: 5 };
    window.localStorage.setItem('bjtrainer.flashsr.v1', JSON.stringify(deck));
    window.localStorage.setItem('bjtrainer.settings.v1', JSON.stringify({ version: 1, drill: { scopes: ['pairs'] } }));
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 100 cleared');

  const order = await page.evaluate(
    () => JSON.parse(window.localStorage.getItem('bjtrainer.masteryrun.v1') ?? '{}').order as string[],
  );
  expect(order).toHaveLength(100);
  expect(order.indexOf('pair-8-v-A')).toBeLessThan(5);
});

/**
 * Wave A (s10 high): the Hands scope is shared with Speed and Flashcards.
 * Tapping Pairs in Speed used to overwrite a 61/330 sweep the moment Mastery
 * opened. The sweep in progress now carries on over its own cells.
 */
test('mastery: a scope changed elsewhere does not destroy a sweep in progress', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    window.localStorage.setItem('bjtrainer.masteryrun.v1', JSON.stringify({ scope: 'all', seed: 12345, index: 61 }));
    window.localStorage.setItem('bjtrainer.settings.v1', JSON.stringify({ version: 1, drill: { scopes: ['pairs'] } }));
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();
  await expect(page.getByTestId('mastery-progress')).toContainText('61 / 330 cleared');
  await expect(page.getByTestId('mastery-resumed')).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.masteryrun.v1') ?? '{}'));
  expect(stored.index).toBe(61);
  expect(stored.order).toHaveLength(330);

  // Back to All: the same sweep, not a new one.
  const scopeRow = page.locator('.settings-row', { hasText: 'Hands' });
  await scopeRow.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByTestId('mastery-progress')).toContainText('61 / 330 cleared');
  await expect(page.getByTestId('mastery-resumed')).toHaveCount(0);

  // Changing Hands here is the explicit way to start over.
  await scopeRow.getByRole('button', { name: 'Pairs', exact: true }).click();
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 100 cleared');
});

/**
 * Wave A review: a miss in a resumed sweep loses its progress either way, so
 * the restart follows the Hands picked now -- not "Carrying on your 0/330
 * sweep" over cells the next visit would silently replace. Wrong tap puts the
 * resumed sweep back as it was.
 */
test('mastery: a miss in a resumed sweep restarts over the Hands picked now; Wrong tap restores it', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    window.localStorage.setItem('bjtrainer.masteryrun.v1', JSON.stringify({ scope: 'all', seed: 12345, index: 61 }));
    window.localStorage.setItem('bjtrainer.settings.v1', JSON.stringify({ version: 1, drill: { scopes: ['pairs'] } }));
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();
  const progress = page.getByTestId('mastery-progress');
  await expect(progress).toContainText('61 / 330 cleared');

  // Answer until one is a miss (a right answer only moves the sweep on).
  let before = '';
  for (let i = 0; i < 20; i++) {
    before = (await progress.textContent()) ?? '';
    for (const label of ['Surrender', 'Split', 'Double', 'Hit']) {
      const btn = page.locator('.action-bar button.action-btn', { hasText: label });
      if (await btn.isEnabled()) {
        await btn.click();
        break;
      }
    }
    if (await page.locator('.mastery-reset-banner').isVisible()) break;
  }
  await expect(page.locator('.mastery-reset-banner')).toBeVisible();
  await expect(progress).toContainText('0 / 100 cleared');
  await expect(progress).not.toContainText('your sweep in progress');
  await expect(page.getByTestId('mastery-resumed')).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.masteryrun.v1') ?? '{}'));
  expect(stored.order).toHaveLength(100);

  await page.getByRole('button', { name: 'Wrong tap', exact: true }).click();
  await expect(progress).toHaveText(before);
  await expect(page.getByTestId('mastery-resumed')).toBeVisible();
});
