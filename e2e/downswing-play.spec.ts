import { test, expect, type Page } from '@playwright/test';
import { readStats } from './helpers';

/**
 * V3-7: the Downswing drill was a STAND-ONLY WALL.
 *
 * Every hand it dealt was a made hard 17-19, so basic strategy stood on all of
 * them, the action bar rendered exactly one button, and the entire play phase
 * was Stand pressed twenty-five times. Which meant tilt — the whole subject of
 * the drill — had nothing to corrupt except the bet.
 *
 * Chasing is not only a betting behaviour. It is hitting a stiff you should
 * stand, standing on one you should hit, and doubling to win it all back in one
 * hand. The rig now deals stiff hands that lose down EVERY line (see
 * downswingShoe.ts's DECISION_LOSSES and the card-count invariant proven
 * against the engine in downswingShoe.test.ts), so there is a real decision to
 * get wrong under pressure, and it is graded.
 */

const ROUNDS = 25;

async function openDownswing(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Downswing', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Downswing');
}

/** Play the whole session, always choosing `action` when it is offered. */
async function playSession(
  page: Page,
  action: string,
): Promise<{ maxButtons: number; sawHit: boolean; sawWrongPlay: boolean }> {
  let maxButtons = 0;
  let sawHit = false;
  let sawWrongPlay = false;

  for (let r = 0; r < ROUNDS; r++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    const bar = page.locator('.action-bar .action-btn');
    const count = await bar.count();
    if (count > 0) {
      maxButtons = Math.max(maxButtons, count);
      const labels = await bar.allTextContents();
      if (labels.includes('Hit')) sawHit = true;
      const chosen = page.getByRole('button', { name: action, exact: true });
      await (await chosen.isVisible().catch(() => false)
        ? chosen
        : bar.first()
      ).click();
    }
    if (await page.locator('.message-strip .result-wrong').first().isVisible().catch(() => false)) {
      const strip = await page.locator('.message-strip').textContent();
      if (strip?.includes('the correct play was')) sawWrongPlay = true;
    }
    await page
      .getByRole('button', { name: r < ROUNDS - 1 ? 'Next hand' : 'See result', exact: true })
      .click();
  }
  return { maxButtons, sawHit, sawWrongPlay };
}

test('the session deals hands with a real decision on them, not just Stand', async ({ page }) => {
  test.setTimeout(60_000);
  await openDownswing(page);

  const { maxButtons, sawHit } = await playSession(page, 'Stand');

  // The old drill rendered exactly one button on every hand of the session.
  expect(maxButtons).toBeGreaterThan(1);
  expect(sawHit).toBe(true);
  // The record of what a player actually sees at the end of a tilted session.
  await page.setViewportSize({ width: 420, height: 1000 });
  await page.locator('.drill-result').screenshot({ path: 'e2e/screenshots/downswing-result.png' });
});

test('standing on every hand is named as a mistake and scored as one', async ({ page }) => {
  test.setTimeout(60_000);
  await openDownswing(page);

  const { sawWrongPlay } = await playSession(page, 'Stand');
  // The verdict lands on the hand it happened on, while the cards are still up.
  expect(sawWrongPlay).toBe(true);

  const result = page.locator('.drill-result');
  await expect(result).toBeVisible();
  const play = result.locator('.downswing-play-score');
  await expect(play).toBeVisible();
  // Some of those stands were wrong, so the play score cannot be perfect --
  // and it must not read "no decisions dealt" either.
  await expect(play).not.toContainText('no decisions dealt');
  const text = (await play.textContent()) ?? '';
  const scored = Number(/(\d+)%/.exec(text)?.[1]);
  expect(scored).toBeLessThan(100);

  // The bet was never chased (Deal takes the default min chip), so the two
  // halves of the verdict are reported apart rather than blended into one.
  await expect(result).toContainText('Spread-conformity');
  await expect(result).toContainText('Correct play under pressure');
});

test('the play score reaches Stats alongside the bet score', async ({ page }) => {
  test.setTimeout(60_000);
  await openDownswing(page);
  await playSession(page, 'Stand');
  await expect(page.locator('.drill-result')).toBeVisible();

  const stats = await readStats(page);
  const history =
    (stats?.downswing as { history: Record<string, number>[] } | undefined)?.history ?? [];
  expect(history).toHaveLength(1);
  const row = history[0]!;
  expect(row.total).toBe(ROUNDS);
  // Decisions are a SUBSET of the hands: a session where every hand counted
  // would mean the pat hands were being graded too, which would let a wall of
  // forced Stands read as discipline.
  expect(row.playTotal).toBeGreaterThan(0);
  expect(row.playTotal).toBeLessThan(ROUNDS);
  expect(row.playCorrect).toBeLessThan(row.playTotal!);

  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await page.locator('.home-stats-link').click();
  await page.locator('.stats-tabs').getByRole('tab', { name: 'Progress', exact: true }).click();
  const section = page.locator('.stats-section', { hasText: 'Downswing' });
  await expect(section.locator('.mistake-row', { hasText: 'Correct play' })).toContainText('%');
});

/**
 * The session must still be a guaranteed drawdown. A decision hand that could
 * be WON down some line would turn the tilt drill into an ordinary shoe.
 */
test('every hand still loses, whichever line the player takes', async ({ page }) => {
  test.setTimeout(60_000);
  await openDownswing(page);

  for (let r = 0; r < ROUNDS; r++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    const bar = page.locator('.action-bar .action-btn');
    if ((await bar.count()) > 0) {
      // Alternate between standing and hitting so both lines are exercised.
      const hit = page.getByRole('button', { name: 'Hit', exact: true });
      await (r % 2 === 0 && (await hit.isVisible().catch(() => false)) ? hit : bar.first()).click();
    }
    await expect(page.locator('.message-strip')).toContainText('Lost');
    await page
      .getByRole('button', { name: r < ROUNDS - 1 ? 'Next hand' : 'See result', exact: true })
      .click();
  }

  const stats = await readStats(page);
  const history =
    (stats?.downswing as { history: Record<string, number>[] } | undefined)?.history ?? [];
  expect(history[0]!.drawdown).toBeGreaterThan(0);
});
