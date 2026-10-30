import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance } from './helpers';

/**
 * M8: bot cards used to render instantly while the narration paced.
 *
 * Bots resolve to completion inside `act()` — a bot that hits three times has
 * all five cards in `seat.hands[0].cards` before React ever renders. The
 * narration, meanwhile, reveals one line per `dealSpeedMs`. So the felt showed
 * the finished hand while the commentary was still on "P2 hits", and the pacing
 * that exists to make a full table followable was describing a past the screen
 * had already skipped past.
 *
 * Cards now arrive with the line that dealt them.
 */

const BOTS = 3;

async function countBotCards(page: Page): Promise<number> {
  return page.locator('.bot-seat .bot-hand-cards .card').count();
}

/**
 * Deal a round at a slow pace and, if the bots have anything to narrate,
 * report how many bot cards are on screen mid-pacing versus after skipping it.
 * Returns null on a seed where the round short-circuits with nothing to pace
 * (a dealer natural, say).
 */
async function pacedVsSkipped(
  page: Page,
  seed: number,
): Promise<{ during: number; after: number } | null> {
  await page.goto(`/?seed=${seed}&e2e=1`);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.bot-seat')).toHaveCount(BOTS);
  await resolveInsurance(page, false);

  // With the player at first base, every bot acts in `resolveBotsAfter` --
  // i.e. only once the player is done. That is where the pacing actually is.
  const stand = page.getByRole('button', { name: 'Stand', exact: true });
  while (await stand.isVisible().catch(() => false)) await stand.click();

  const ff = page.locator('.fast-forward-btn');
  if (!(await ff.isVisible().catch(() => false))) return null;

  const during = await countBotCards(page);
  await page.locator('.message-strip').click(); // fast-forward the narration
  await expect(ff).toHaveCount(0);
  const after = await countBotCards(page);
  return { during, after };
}

test('a bot card does not appear before the line that dealt it', async ({ page }) => {
  test.setTimeout(120_000);
  // Slow enough that pacing is genuinely mid-flight when we look.
  await withSettings(page, { dealSpeedMs: 1500 });
  await withProfile(page, {
    name: 'Paced Table',
    seats: { playerHands: 1, bots: BOTS, botMistakePct: 0, playerPosition: 0 },
  });

  let sawWithheld = false;
  let sawAny = false;

  for (let seed = 1; seed <= 25 && !sawWithheld; seed++) {
    const result = await pacedVsSkipped(page, seed);
    if (!result) continue;
    sawAny = true;
    // Never MORE cards mid-pacing than after it: the pacing can only ever
    // delay a card, never invent or lose one.
    expect(result.during, `seed ${seed}`).toBeLessThanOrEqual(result.after);
    // Every bot always has its opening two.
    expect(result.during, `seed ${seed}`).toBeGreaterThanOrEqual(BOTS * 2);
    if (result.during < result.after) sawWithheld = true;
  }

  expect(sawAny, 'expected at least one seed in 1..25 to pace bot narration').toBe(true);
  // The discriminating half. Without the fix `during` always equals `after`,
  // because every card was on screen the moment the bots resolved.
  expect(sawWithheld, 'expected at least one seed where a bot drew a card mid-pacing').toBe(true);
});

/**
 * The final frame is never short. Whatever the reveal arithmetic makes of a
 * split, a settled round shows every card it dealt.
 */
test('a settled round shows every bot card, pacing or not', async ({ page }) => {
  test.setTimeout(120_000);
  await withSettings(page, { dealSpeedMs: 0 });
  await withProfile(page, {
    name: 'Settled Table',
    seats: { playerHands: 1, bots: BOTS, botMistakePct: 0, playerPosition: 0 },
  });

  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  const stand = page.getByRole('button', { name: 'Stand', exact: true });
  while (await stand.isVisible().catch(() => false)) await stand.click();

  // Settled: every bot seat carries a verdict, and the hand under it is whole.
  await expect(page.locator('.bot-result-marker').first()).toBeVisible();
  for (let i = 0; i < BOTS; i++) {
    await expect(
      page.locator('.bot-seat').nth(i).locator('.bot-hand-cards .card'),
    ).not.toHaveCount(0);
  }
});

/**
 * Wave L C-extra follow-up: the peek during the bots' paced turns counts the
 * felt, not the engine. Bots resolve inside act(), so the engine's running
 * count already has every bot card; the peek takes back the ones not shown.
 */
test('a peek while bot turns are still being paced counts only the cards on the felt', async ({ page }) => {
  test.setTimeout(300_000);
  await withSettings(page, { dealSpeedMs: 1200, countCheckEvery: 0 });
  await withProfile(page, { name: 'Paced Peek', seats: { playerHands: 1, bots: BOTS, botMistakePct: 0, playerPosition: 0 } });
  const tag = (card: string) => (/^[2-6]/.test(card) ? 1 : /^(10|[JQKA])/.test(card) ? -1 : 0);
  const botCards = () => page.locator('.bot-seat .bot-hand-cards [data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')!));
  const rcHeld = async () => {
    const box = await page.locator('.tc-peek-btn').boundingBox();
    if (!box) throw new Error('peek button not laid out');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const text = (await page.locator('.peek-counts').textContent())!;
    await page.mouse.up();
    const m = /RC ([+−-]?)(\d+)/.exec(text)!;
    return (m[1] === '−' || m[1] === '-' ? -1 : 1) * Number(m[2]);
  };
  let checked = false;
  for (let seed = 1; seed <= 25 && !checked; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);
    const ff = page.locator('.fast-forward-btn');
    // Let the opening deal reach the felt first (no peek while it goes down).
    await expect(ff).toHaveCount(0, { timeout: 30_000 });
    const stand = page.getByRole('button', { name: 'Stand', exact: true });
    while (await stand.isVisible().catch(() => false)) await stand.click();
    if (!(await ff.isVisible().catch(() => false))) continue;
    if ((await page.locator('.tc-peek-btn').count()) === 0) continue;
    const before = await botCards();
    const rcDuring = await rcHeld();
    if ((await botCards()).length !== before.length) continue; // a card landed mid-read
    await page.locator('.message-strip').click();
    await expect(ff).toHaveCount(0);
    const after = await botCards();
    const late = after.slice();
    for (const c of before) late.splice(late.indexOf(c), 1);
    const lateSum = late.reduce((n, c) => n + tag(c), 0);
    if (lateSum === 0) continue; // nothing to tell the two counts apart
    const rcAfter = await rcHeld();
    expect(rcDuring, `seed ${seed}: late cards ${late.join(' ')}`).toBe(rcAfter - lateSum);
    checked = true;
  }
  expect(checked, 'expected a seed in 1..25 with unseen bot cards that move the count').toBe(true);
});
