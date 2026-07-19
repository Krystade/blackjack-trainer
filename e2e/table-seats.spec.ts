import { test, expect, type Page } from '@playwright/test';
import { shot, withSettings, withProfile, resolveInsurance, playRoundByAdvice } from './helpers';

/** Parses "Bankroll: 106<profile name...>" out of the topbar-stat text (the
 * profile name span is nested in the same div with no separator, but a
 * profile name never starts with a digit, so this stays unambiguous). */
async function readBankroll(page: Page): Promise<number> {
  const text = await page.locator('.topbar-stat').first().innerText();
  const match = text.match(/Bankroll:\s*(-?\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`could not parse bankroll from "${text}"`);
  return Number(match[1]);
}

/** Parses the trailing signed number off a ".message-result" line (e.g.
 * "Hand 1: Win +2" -> 2, "Hand 2: Lose -8" -> -8); a bare "Push" has no
 * number and nets 0. */
function parseNet(resultText: string): number {
  const match = resultText.match(/(-?\d+(?:\.\d+)?)\s*$/);
  return match ? Number(match[1]) : 0;
}

test('full table: 3 bots deal, play, and settle with W/L/P markers + narration', async ({ page }) => {
  test.setTimeout(120_000);
  await withSettings(page, { dealSpeedMs: 0 });
  await withProfile(page, {
    name: 'Full Table Profile',
    seats: { playerHands: 1, bots: 3, botMistakePct: 0, playerPosition: 0 },
  });

  let dealt = false;
  for (let seed = 1; seed <= 30 && !dealt; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();

    // The two-pass casino deal seats every hand of every seat before any
    // peek/insurance/player decision happens, so this holds even on a seed
    // that's about to short-circuit (dealer or player natural).
    await expect(page.locator('.bot-seat')).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(page.locator('.bot-seat').nth(i).locator('.bot-hand-cards .card')).toHaveCount(2);
    }
    await expect(page.locator('.bot-seat-label')).toHaveText(['P1', 'P2', 'P3']);

    await resolveInsurance(page, false);

    const bar = page.locator('.action-bar[data-advice]');
    if (!(await bar.isVisible().catch(() => false))) continue; // dealer/player natural short-circuit -- retry another seed

    await expect(page.locator('.player-hand')).toHaveCount(1);
    await expect(page.locator('.player-hand .hand-cards .card')).toHaveCount(2);
    await shot(page, '46-table-full-bots-dealt');

    await playRoundByAdvice(page);
    dealt = true;
  }
  expect(dealt, 'expected at least one of seeds 1..30 to reach a live player decision').toBe(true);

  // Round settled: every bot seat shows a W/L/P marker.
  await expect(page.locator('.bot-seat')).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('.bot-seat').nth(i).locator('.bot-result-marker')).toBeVisible();
  }

  // Fast-forward is idempotent -- clicking it guarantees full narration
  // reveal regardless of how much dealSpeedMs pacing has already caught up.
  await page.locator('.message-strip').click();
  const narrationLines = await page.locator('.message-bot-narration').allTextContents();
  expect(narrationLines.length).toBeGreaterThan(0);
  expect(narrationLines.some((l) => l.startsWith('P1'))).toBe(true);
  expect(narrationLines.some((l) => l.startsWith('P2'))).toBe(true);
  expect(narrationLines.some((l) => l.startsWith('P3'))).toBe(true);
  await shot(page, '47-table-full-bots-settled');
});

test('fast-forward: bot narration reveals in full immediately, without waiting out the pacing', async ({ page }) => {
  test.setTimeout(120_000);
  // Same seat config as the full-table case, just a much slower dealSpeedMs
  // -- large enough that waiting out even one un-skipped narration line
  // would blow well past every assertion's timeout below, so a passing test
  // proves the fast-forward control actually skipped the pacing.
  await withSettings(page, { dealSpeedMs: 5000 });
  await withProfile(page, {
    name: 'Fast Forward Profile',
    seats: { playerHands: 1, bots: 3, botMistakePct: 0, playerPosition: 0 },
  });

  let dealt = false;
  for (let seed = 1; seed <= 30 && !dealt; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);

    const bar = page.locator('.action-bar[data-advice]');
    if (!(await bar.isVisible().catch(() => false))) continue; // dealer/player natural short-circuit -- retry another seed

    await playRoundByAdvice(page); // settles the round; bot-narration pacing has NOT caught up yet at 5000ms/line

    const ffBtn = page.locator('.fast-forward-btn');
    await expect(ffBtn).toBeVisible({ timeout: 2000 });
    await ffBtn.click();
    await shot(page, '48-table-fastforward-clicked');

    // Immediately (no additional wait) -- if fast-forward hadn't skipped the
    // pacing, only the first bot's first line would be visible this soon.
    const narrationText = await page.locator('.message-strip').innerText();
    expect(narrationText).toContain('P1');
    expect(narrationText).toContain('P2');
    expect(narrationText).toContain('P3');
    await expect(page.locator('.fast-forward-btn')).toHaveCount(0); // fully caught up now
    dealt = true;
  }
  expect(dealt, 'expected at least one of seeds 1..30 to reach a live player decision').toBe(true);
});

test('multi-hand: two independent bets, two hands played out, per-hand results sum to the bankroll delta', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await withSettings(page, { dealSpeedMs: 0 });
  await withProfile(page, {
    name: 'Multi-Hand Profile',
    betSpreadOn: true,
    seats: { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 },
  });

  let settledCleanly = false;
  for (let seed = 1; seed <= 40 && !settledCleanly; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();

    const betHandRows = page.locator('.bet-hand-row');
    await expect(betHandRows).toHaveCount(2);
    await page.getByRole('button', { name: 'Hand 1 raise bet' }).click(); // 1u -> 2u
    await page.getByRole('button', { name: 'Hand 2 raise bet' }).click(); // 1u -> 2u
    await page.getByRole('button', { name: 'Hand 2 raise bet' }).click(); // 2u -> 4u
    await expect(page.locator('.bet-stepper-value').nth(0)).toHaveText('2u');
    await expect(page.locator('.bet-stepper-value').nth(1)).toHaveText('4u');
    await shot(page, '49-table-multihand-bets-set');

    const bankrollBefore = await readBankroll(page);
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);

    await expect(page.locator('.player-hand')).toHaveCount(2);
    await expect(page.locator('.hand-label')).toHaveText(['Hand 1', 'Hand 2']);
    await shot(page, '50-table-multihand-dealt');

    await playRoundByAdvice(page);

    const handCountAfter = await page.locator('.player-hand').count();
    if (handCountAfter !== 2) continue; // advice split a pair this seed -- retry to keep the "two hands" case clean

    await expect(page.locator('.message-result')).toHaveCount(2);
    const lines = await page.locator('.message-result').allTextContents();
    expect(lines[0]).toContain('Hand 1');
    expect(lines[1]).toContain('Hand 2');
    const nets = lines.map(parseNet);
    const bankrollAfter = await readBankroll(page);
    expect(bankrollAfter - bankrollBefore).toBeCloseTo(nets.reduce((a, b) => a + b, 0), 5);
    await shot(page, '51-table-multihand-settled');
    settledCleanly = true;
  }
  expect(settledCleanly, 'expected at least one of seeds 1..40 to settle two hands without a split').toBe(true);
});

test('seats config round-trip: editing the active profile\'s Seats section reaches the table', async ({ page }) => {
  await withSettings(page, { dealSpeedMs: 0 });
  await withProfile(page, { name: 'Seats RT Profile' }); // default seats: solo, no bots

  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  const row = page.locator('.profile-row', { hasText: 'Seats RT Profile' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit Profile');

  const handsRow = page.locator('.settings-row', { hasText: 'Your hands' });
  await handsRow.getByRole('button', { name: '2', exact: true }).click();
  await expect(handsRow.getByRole('button', { name: '2', exact: true })).toHaveClass(/segmented-btn-active/);

  const botsRow = page.locator('.settings-row', { hasText: 'Bot players' });
  await botsRow.locator('.stepper-btn', { hasText: '+' }).click(); // 0 -> 1
  await botsRow.locator('.stepper-btn', { hasText: '+' }).click(); // 1 -> 2
  await expect(botsRow.locator('.stepper-value')).toHaveText('2');
  await shot(page, '52-profile-editor-seats-set');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);

  // Proves the editor's seats config reached the table: 2 bot rows AND 2
  // player hands, from a profile that started solo (0 bots, 1 hand).
  await expect(page.locator('.bot-seat')).toHaveCount(2);
  await expect(page.locator('.player-hand')).toHaveCount(2);
  await shot(page, '53-table-seats-roundtrip-dealt');
});

test('solo parity: bots:0/playerHands:1 renders no bot rows and no per-hand labels', async ({ page }) => {
  await withSettings(page, { dealSpeedMs: 0 });
  await withProfile(page, { name: 'Solo Parity Profile' }); // default seats

  await page.goto('/?seed=1&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);

  await expect(page.locator('.bot-seat')).toHaveCount(0);
  await expect(page.locator('.bot-seats-row')).toHaveCount(0);
  await expect(page.locator('.hand-label')).toHaveCount(0);
  await expect(page.locator('.fast-forward-btn')).toHaveCount(0);
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await shot(page, '54-table-solo-parity-dealt');
});
