import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { shot, withSettings, withProfile, resolveInsurance, playRoundByAdvice } from './helpers';

test('home renders and navigates to the table', async ({ page }) => {
  await page.goto('/?e2e=1');
  await expect(page.locator('.home-title')).toHaveText('Blackjack Trainer');
  // Navigation is the persistent tab bar since C4; Stats hangs off the Home
  // dashboard rather than taking a tab from Settings.
  for (const label of ['Home', 'Play', 'Drills', 'Charts', 'Settings']) {
    await expect(page.locator('.tab-bar').getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.locator('.home-stats-link')).toBeVisible();
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
    const modal = page.locator('.bottom-sheet', { hasText: 'Insurance?' });
    if (await modal.isVisible().catch(() => false)) {
      found = true;
      await expect(modal).toContainText('The dealer shows an ace');
      // #37: a sheet under the felt, so the up-card ace and the player's
      // hand stay visible while deciding.
      await expect(page.locator('.modal-backdrop')).toHaveCount(0);
      const top = (await modal.boundingBox())!.y;
      const bottoms = await page
        .locator('.dealer-area .card[data-card], .hands-row .card[data-card]')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
      expect(bottoms.length).toBeGreaterThanOrEqual(3);
      for (const b of bottoms) expect(b).toBeLessThanOrEqual(top + 0.5);
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

  const overlay = page.locator('.modal-backdrop', { hasText: 'Wrong play' });
  await expect(overlay).toBeVisible();
  // The overlay now renders the shared MistakeCard, which labels the two
  // plays in a column ("You played" / "Correct") rather than the old inline
  // "You: X — Correct: Y" sentence. Same contract: it must name the correct
  // play and show the count/basis the correction rests on.
  await expect(overlay).toContainText('Correct');
  await expect(overlay).toContainText('You played');
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

  await page.locator('.end-btn').click(); // arms: the second tap ends
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-screen')).toBeVisible();
  await expect(page.locator('.report-categories tbody tr')).not.toHaveCount(0);
  await expect(page.locator('.report-mistakes li')).not.toHaveCount(0);
  await shot(page, '06-test-mode-report');

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
});

/** The cards on the felt, dealer then player, as `data-card` strings. */
async function feltCards(page: Page): Promise<string[]> {
  return page
    .locator('.dealer-area .card[data-card], .hands-row .card[data-card]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-card') ?? ''));
}

test('#36: the count check is posed when Deal is pressed, over the settled hand, and the deal follows the answer', async ({
  page,
}) => {
  await withSettings(page, { countCheckEvery: 1 });
  await page.goto('/?seed=5&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);

  // Settled: the result is the screen. Nothing is asked yet.
  const prompt = page.locator('.bottom-sheet', { hasText: 'Running count?' });
  const round = page.locator('.topbar-stat', { hasText: /^Round / });
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  await expect(prompt).toHaveCount(0);
  await expect(round).toHaveText('Round 1');
  const settled = await feltCards(page);
  expect(settled.length).toBeGreaterThan(2);

  // Deal asks the count first; the settled hand is still what is on the felt.
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(prompt).toBeVisible();
  await expect(prompt.locator('.numpad-label')).toHaveText('Enter running count');
  expect(await feltCards(page)).toEqual(settled);
  await expect(round).toHaveText('Round 1');
  await shot(page, '07-count-check-numpad');

  // #37: the check is a sheet in the action-bar slot, not a modal over the
  // board. Nothing covers the felt, and every hand card sits fully above it.
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  const sheet = await prompt.boundingBox();
  const cardBoxes = await page
    .locator('.dealer-area .card[data-card], .hands-row .card[data-card]')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
  for (const bottom of cardBoxes) expect(bottom).toBeLessThanOrEqual(sheet!.y + 0.5);
  for (const key of await prompt.locator('.numpad-btn, .numpad-ok').all()) {
    expect((await key.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);

  // The answer deals the next round straight away.
  await prompt.getByRole('button', { name: '5', exact: true }).click();
  await prompt.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(prompt).not.toBeVisible();
  await expect(round).toHaveText('Round 2');
  expect(await feltCards(page)).not.toEqual(settled);
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
  await page.locator('.end-btn').click(); // arms: the second tap ends
  await page.locator('.end-btn').click();

  await expect(page.locator('.report-screen')).toBeVisible();
  const betRow = page.locator('.report-categories tr', { hasText: 'bet' });
  await expect(betRow).toBeVisible();
  await expect(betRow).toContainText('Bet sizing');
  await shot(page, '09-bet-spread-report');
});

test('wong-out (R5): Sit Out plays the round unstaked, keeps the bankroll flat, and grades the wong', async ({
  page,
}) => {
  await withSettings(page, { feedbackMode: 'test', betSpreadOn: true, countCheckEvery: 0 });
  await page.goto('/?seed=6&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  // The Sit Out button appears beside Deal only when a spread is configured
  // (wong-out is meaningless flat-betting) — the same gate the engine grades on.
  const sitOut = page.getByRole('button', { name: 'Sit out', exact: true });
  await expect(sitOut).toBeVisible();
  await sitOut.click();

  // The round settled with NO player hand: the wong-out message shows and no
  // player-result row appears — nothing was staked.
  await expect(page.locator('.message-sat-out')).toHaveText('Sat out — no bet.');
  await expect(page.locator('.hands-row .player-hand')).toHaveCount(0);
  await shot(page, '30-wong-sit-out');

  // We're back in the bet phase for the next round (the shoe/count kept
  // running through the sit-out). End the session and confirm the wong
  // decision was graded: a 'wong' category row in the test-mode report, and
  // no 'bet' row (a sit-out never stakes, so it emits no bet event).
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  await page.locator('.end-btn').click(); // arms: the second tap ends
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-screen')).toBeVisible();
  await expect(page.locator('.report-categories tr', { hasText: 'Play or sit out' })).toBeVisible();
  await expect(page.locator('.report-categories tr', { hasText: /^Bet sizing/ })).toHaveCount(0);
  await shot(page, '31-wong-report');
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

test('dealer showing an ace: taking insurance settles and shows an insurance-net message', async ({ page }) => {
  // T0 gap #24 (docs/research/2026-07-26-test-coverage-matrix.md): mirrors
  // the existing decline spec above but clicks Take, so the insure(true)
  // path (2:1 payout on dealer BJ, or -bet/2 otherwise -- engine/game.ts's
  // insuranceDecision) and its `insuranceNet` message get e2e coverage too.
  await withSettings(page, { countCheckEvery: 0 });

  let found = false;
  for (let seed = 1; seed <= 25 && !found; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    const modal = page.locator('.bottom-sheet', { hasText: 'Insurance?' });
    if (await modal.isVisible().catch(() => false)) {
      found = true;
      await modal.getByRole('button', { name: 'Take', exact: true }).click();
      await playRoundByAdvice(page);
    }
  }
  expect(found, 'expected at least one of seeds 1..25 to deal a dealer ace up-card').toBe(true);

  const insuranceMsg = page.locator('.message-strip .message-result', { hasText: 'Insurance' });
  await expect(insuranceMsg).toBeVisible();
  // insuranceNet is always non-null once insurance was taken -- either
  // +bet (dealer had blackjack, 2:1 payout) or -bet/2 (no dealer blackjack).
  // formatSigned always prefixes a sign, so either outcome matches.
  await expect(insuranceMsg).toHaveText(/Insurance [+-]\d+(\.\d+)?/);
  await shot(page, '12-insurance-take-result');
});

test('count-check modal: RC then TC two-stage prompt on the 2nd trigger (askTcToo)', async ({ page }) => {
  // T0 gap #25: engine/game.ts's finishRound() flips askTcToo true on every
  // EVEN-numbered count-check trigger (countCheckPromptCount % 2 === 0).
  // With countCheckEvery:1 every round triggers a check, so round 1 is
  // RC-only (askTcToo false) and round 2 is the RC->TC two-stage prompt
  // (Table.tsx's handleCountSubmit / countStage state machine).
  await withSettings(page, { countCheckEvery: 1 });
  await page.goto('/?seed=101&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  // Round 1: first trigger -> RC-only, asked when the next deal is.
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  await page.getByRole('button', { name: 'Deal', exact: true }).click();

  const modal = page.locator('.bottom-sheet');
  await expect(modal.locator('.bottom-sheet-title')).toHaveText('Running count?');
  await modal.getByRole('button', { name: '5', exact: true }).click();
  await modal.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(modal).not.toBeVisible();

  // The answer dealt round 2. Second trigger -> RC stage, then (without
  // closing) TC stage.
  await playRoundByAdvice(page);
  await page.getByRole('button', { name: 'Deal', exact: true }).click();

  await expect(modal.locator('.bottom-sheet-title')).toHaveText('Running count?');
  await modal.getByRole('button', { name: '3', exact: true }).click();
  await modal.getByRole('button', { name: 'OK', exact: true }).click();

  // Still open -- now asking for TC, not settled yet.
  await expect(modal).toBeVisible();
  await expect(modal.locator('.bottom-sheet-title')).toHaveText('True count?');
  await shot(page, '13-count-check-tc-stage');

  await modal.getByRole('button', { name: '1', exact: true }).click();
  await modal.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.locator('.topbar-stat', { hasText: /^Round / })).toHaveText('Round 3');
});

test('#3: count checks set to "true" ask the true count alone, and one answer deals', async ({ page }) => {
  await withProfile(page, { countCheckEvery: 1, countCheckAsk: 'true' });
  await page.goto('/?seed=101&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  // The answer deals the next round, so each pass starts mid-round.
  for (const round of [2, 3]) {
    await playRoundByAdvice(page);
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    const modal = page.locator('.bottom-sheet');
    // No running-count stage at all, on the first check or the second.
    await expect(modal.locator('.bottom-sheet-title')).toHaveText('True count?');
    await modal.getByRole('button', { name: '1', exact: true }).click();
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(modal).not.toBeVisible();
    await expect(page.locator('.topbar-stat', { hasText: /^Round / })).toHaveText(`Round ${round}`);
  }
});

test('#3: count checks set to "both" ask RC then TC on the first check', async ({ page }) => {
  await withProfile(page, { countCheckEvery: 1, countCheckAsk: 'both' });
  await page.goto('/?seed=101&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  const modal = page.locator('.bottom-sheet');
  await expect(modal.locator('.bottom-sheet-title')).toHaveText('Running count?');
  await modal.getByRole('button', { name: '3', exact: true }).click();
  await modal.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(modal.locator('.bottom-sheet-title')).toHaveText('True count?');
  await modal.getByRole('button', { name: '1', exact: true }).click();
  await modal.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.locator('.topbar-stat', { hasText: /^Round / })).toHaveText('Round 2');
});

test('a count check owed on the last round is asked before End shows the report', async ({ page }) => {
  await withProfile(page, { countCheckEvery: 1 });
  await page.goto('/?seed=101&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);

  await page.locator('.end-btn').click(); // arms: the second tap ends
  await page.locator('.end-btn').click();
  const modal = page.locator('.bottom-sheet');
  await expect(modal.locator('.bottom-sheet-title')).toHaveText('Running count?');
  await expect(page.locator('.report-screen')).toHaveCount(0);

  await modal.getByRole('button', { name: '2', exact: true }).click();
  await modal.getByRole('button', { name: 'OK', exact: true }).click();
  // The answer ends the session rather than dealing another round.
  await expect(page.locator('.report-screen')).toBeVisible();
  await expect(page.locator('.report-categories tr', { hasText: 'Count checks' })).toBeVisible();
});

/** Press and hold the peek with a real pointer (mouse down, no release). */
async function holdPeek(page: Page): Promise<void> {
  const box = await page.locator('.tc-peek-btn').boundingBox();
  if (!box) throw new Error('peek button not laid out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

test('TC peek shows RC/TC only while held and hides on release', async ({ page }) => {
  // T0 gap #26, then #40 (spec 2026-10-13): the peek was a toggle; it is a
  // HOLD now, so it must stay up for as long as the press lasts and drop the
  // moment the press ends.
  await withSettings(page, { countCheckEvery: 0 });
  await page.goto('/?seed=102&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);

  const peekBtn = page.locator('.tc-peek-btn');
  await expect(peekBtn).toHaveText('Hold to peek');
  await holdPeek(page);
  // #41: "RC +5 · TC +1.4 · 3.62 decks left" -- TC to one decimal, decks to
  // two. Two rounds' worth of cards at most have left a fresh 6-deck shoe.
  await expect(peekBtn).toHaveText(/^RC (0|[+-]\d+) · TC (0\.0|[+-]\d+\.\d) · 5\.\d\d decks left$/);
  await page.waitForTimeout(400);
  await expect(peekBtn).toContainText(/RC [+-]?\d+/);
  await shot(page, '14-tc-peek-revealed');
  await page.mouse.up();
  await expect(peekBtn).toHaveText('Hold to peek');
});

test('R7: peeks are counted once per press and flag a test-mode session as assisted', async ({ page }) => {
  // R7 (docs/BACKLOG.md, RT#5): the RC/TC peek is a legit training aid kept in
  // both modes, but a peek-assisted test-mode accuracy must be labelled so it
  // can't be read as unassisted.
  //
  // #40 made it a hold. Two presses are two peeks, and a held key -- whose
  // keydown auto-repeats -- is ONE press, not one per repeat.
  await withSettings(page, { feedbackMode: 'test', countCheckEvery: 0 });
  await page.goto('/?seed=102&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);

  const peekBtn = page.locator('.tc-peek-btn');
  await holdPeek(page);
  await page.mouse.up();
  await peekBtn.focus();
  await page.keyboard.down(' ');
  await page.keyboard.down(' '); // auto-repeat: still the same press
  await page.keyboard.down(' ');
  await expect(peekBtn).toContainText('RC');
  await page.keyboard.up(' ');
  await expect(peekBtn).toHaveText('Hold to peek');

  await playRoundByAdvice(page);
  await page.locator('.end-btn').click(); // arms: the second tap ends
  await page.locator('.end-btn').click();

  await expect(page.locator('.report-screen')).toBeVisible();
  await expect(page.locator('.report-assisted')).toHaveText('assisted — used 2 peeks');
  await shot(page, '14b-tc-peek-assisted-report');
});

test('player surrender: takes a -0.5 net when the LS rule is on', async ({ page }) => {
  // T0 gap #27: canSurrender (engine/game.ts's legalActionsForHand) only
  // requires a fresh 2-card hand + rules.ls -- it doesn't depend on the
  // advised action or the dealer's up-card -- so with LS on (the helper's
  // default), Surrender is enabled at the very first decision of almost any
  // non-immediately-settled round. Seed-hunt only to skip seeds that deal an
  // immediate blackjack push/settle (no player-phase decision at all).
  await withProfile(page); // default rules.ls: true (see helpers.ts)
  await withSettings(page, { countCheckEvery: 0 });

  let found = false;
  for (let seed = 1; seed <= 30 && !found; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);

    const bar = page.locator('.action-bar[data-advice]');
    if (!(await bar.isVisible().catch(() => false))) continue;
    const surrenderBtn = bar.getByRole('button', { name: 'Surrender', exact: true });
    if (await surrenderBtn.isEnabled().catch(() => false)) {
      found = true;
      await surrenderBtn.click();
    }
  }
  expect(found, 'expected at least one of seeds 1..30 to offer Surrender at the first decision').toBe(true);

  await expect(page.locator('.message-strip .message-result')).toContainText('Surrender -0.5');
  await shot(page, '15-surrender-result');
});

/* R6 (RT#3): the live discard-tray depth cue fills as the shoe burns, giving */
/* a by-eye referent to estimate decks-remaining from during count checks.    */
test('R6: the discard tray fills as the shoe burns through a round', async ({ page }) => {
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  const fill = page.locator('.table-discard-fill');
  await expect(fill).toBeVisible();
  const widthOf = () => fill.evaluate((el) => parseFloat((el as HTMLElement).style.width) || 0);
  const before = await widthOf();

  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  // A dealt round burns several cards, so the tray fill widens.
  await expect.poll(widthOf).toBeGreaterThan(before);
});

/* #38: a mark per whole deck dealt, labelled, so depth reads by eye. */
test('#38: the discard tray marks every whole deck, labelled with decks dealt', async ({ page }) => {
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const decks = parseInt(
    (await page.locator('.topbar').innerText()).match(/(\d+)D [HS]17/)![1],
    10,
  );
  const ticks = page.locator('.table-discard-tray .discard-tick');
  await expect(ticks).toHaveCount(decks - 1);
  expect(await ticks.allInnerTexts()).toEqual(
    Array.from({ length: decks - 1 }, (_, i) => String(i + 1)),
  );
  // Mark k sits k/decks of the way along the tray frame.
  const frame = (await page.locator('.table-discard-tray .table-discard-frame').boundingBox())!;
  const first = (await ticks.first().boundingBox())!;
  expect(Math.abs(first.x - (frame.x + frame.width / decks))).toBeLessThan(3);
});

/**
 * The last gap on the table row of the coverage matrix (2026-07-26, "Shuffle
 * message"): `.message-shuffle` was never asserted anywhere.
 *
 * It matters more than its size suggests, because a shuffle is the one event
 * that silently invalidates a count. A counter who misses it keeps counting a
 * shoe that no longer exists, and the app's only tell is this strip.
 */
test('the shuffle message appears on the round after the cut card is reached', async ({ page }) => {
  // A single deck cut a tenth of the way in reaches the cut card in one round,
  // where the shipped 6-deck/0.75 profile would take dozens.
  await withProfile(page, { name: 'Shuffle E2E Profile', rules: { decks: 1 }, penetration: 0.1 });
  await page.goto('/?seed=3&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  const shuffle = page.locator('.message-shuffle');
  await expect(shuffle).toHaveCount(0);

  // Play rounds until one announces the shuffle. Each deal that follows a
  // shallow shoe sets it, so this lands on the second round at the latest --
  // the loop is only for rounds that end instantly on a natural.
  let announced = false;
  for (let round = 0; round < 6 && !announced; round += 1) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);
    if (await page.locator('.action-bar[data-advice]').isVisible().catch(() => false)) {
      await playRoundByAdvice(page);
    }
    announced = await shuffle.isVisible().catch(() => false);
  }
  expect(announced, 'expected a shuffle to be announced within six single-deck rounds').toBe(true);
  await expect(shuffle).toHaveText('Shuffling…');
});

/**
 * RV7: the other half of R5's wong decision.
 *
 * Dealing in at a count the spread says to leave used to produce exactly one
 * grade — a CORRECT bet, because the table minimum is what the spread asked
 * for. The round the drill exists to discourage was the round it praised.
 */
test('RV7: dealing in at a should-wong count is graded, not just the min bet', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', betSpreadOn: true, countCheckEvery: 0 });
  await page.goto('/?seed=6&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  // Deal at the top of the shoe: TC 0, where the spread wants only the floor.
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);

  await page.locator('.end-btn').click(); // arms: the second tap ends
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-screen')).toBeVisible();

  // Both grades are there, and they disagree — which is the point. The bet
  // matched the spread; being in the hand at all did not.
  const wongRow = page.locator('.report-categories tr', { hasText: 'Play or sit out' });
  await expect(wongRow).toBeVisible();
  // Columns are right / wrong / percent, so the row reads "wong 0 1 0%".
  await expect(wongRow.locator('td')).toHaveText(['Play or sit out', '0', '1', '0%']);
  await expect(
    page.locator('.report-categories tr', { hasText: /^Bet sizing/ }).locator('td'),
  ).toHaveText(['Bet sizing', '1', '0', '100%']);
});

/**
 * RT#11: the app graded `bet === expected` every round, which is hundreds of
 * reps of the exact pattern that gets counters noticed. Cover mode makes room
 * for a deliberate over- or under-bet, and the report says how mechanical the
 * session was whether or not it is on.
 */
test('RT#11: cover mode accepts one rung either side of the ramp', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', countCheckEvery: 0 });
  await withProfile(page, { name: 'Cover Profile', betSpreadOn: true, coverBets: true });
  await page.goto('/?seed=6&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  // At the top of the shoe the ramp wants 1 unit. Bet the next rung up.
  await expect(page.locator('.bet-chips')).toBeVisible();
  await page.locator('.chip-btn', { hasText: /^2$/ }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);

  await page.locator('.end-btn').click(); // arms: the second tap ends
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-screen')).toBeVisible();
  await expect(page.locator('.report-categories tr', { hasText: /^Bet sizing/ }).locator('td')).toHaveText([
    'Bet sizing',
    '1',
    '0',
    '100%',
  ]);
});

test('RT#11: the cover toggle round-trips from the profile editor', async ({ page }) => {
  await withSettings(page, { dealSpeedMs: 0 });
  await withProfile(page, { name: 'Cover RT', betSpreadOn: true });

  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page
    .locator('.profile-row', { hasText: 'Cover RT' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();

  const row = page.locator('.settings-toggle-row', {
    hasText: 'Cover bets: allow one step off the ramp',
  });
  await expect(row).toBeVisible();
  const box = row.locator('input[type="checkbox"]');
  await expect(box).not.toBeChecked();
  await box.check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await page
    .locator('.profile-row', { hasText: 'Cover RT' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await expect(
    page
      .locator('.settings-toggle-row', { hasText: 'Cover bets: allow one step off the ramp' })
      .locator('input[type="checkbox"]'),
  ).toBeChecked();
});

test('RT#11: the report stays quiet below the sample floor, where a ratio is noise', async ({
  page,
}) => {
  await withSettings(page, { feedbackMode: 'test', countCheckEvery: 0 });
  await withProfile(page, { name: 'Short Session', betSpreadOn: true });
  await page.goto('/?seed=6&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);

  await page.locator('.end-btn').click(); // arms: the second tap ends
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-screen')).toBeVisible();
  // One round is not a pattern.
  await expect(page.locator('.report-cover, .report-tell')).toHaveCount(0);
});

test('RT#11: eight rounds of exact ramp conformity are named as the tell', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', countCheckEvery: 0 });
  await withProfile(page, { name: 'Mechanical', betSpreadOn: true });
  await page.goto('/?seed=6&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  // Bet whatever the ramp asks for, every round, which is precisely the habit.
  for (let i = 0; i < 8; i++) {
    const advised = page.locator('.chip-btn.chip-advised');
    if (await advised.isVisible().catch(() => false)) await advised.click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await playRoundByAdvice(page);
  }

  await page.locator('.end-btn').click(); // arms: the second tap ends
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-screen')).toBeVisible();
  await expect(page.locator('.report-tell')).toBeVisible();
  await expect(page.locator('.report-tell')).toContainText('8 of 8 rounds bet the ramp exactly');

  // A per-round grade repeats by nature: eight rounds into a dead count are
  // one habit, not eight problems, and listing them separately pushed every
  // other mistake off the screen. Grouped, with the repeat count kept.
  const rows = page.locator('.report-mistakes li');
  const wongMistakes = 8; // every round above dealt in at a should-wong count
  expect(await rows.count()).toBeLessThan(wongMistakes);
  const counts = await page.locator('.report-mistake-count').allInnerTexts();
  const summed = counts.reduce((n, t) => n + Number(t.replace(/\D/g, '')), 0);
  // Vacuity guard: the collapse must account for every round, not hide some.
  expect(summed).toBe(wongMistakes);
  await shot(page, '54-report-bet-tell');
});
