import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * Operator items #7 ("check the correct table" from a mistake) and #2
 * (repeat the last spoken line).
 *
 * The property that matters for #7 is not that a chart appears -- it is that
 * the chart appears OVER the drill, ringed on the cell the mistake belongs
 * to, and that closing it returns to the SAME card. A correction that sends
 * you back to a fresh unrelated hand is not an anchor.
 */

/** Answer the current flashcard wrongly by clicking any enabled action that
 * is not the graded-correct one. Returns the label clicked. */
async function answerWrong(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const buttons = page.locator('.action-bar button.action-btn:not([disabled])');
    await expect(buttons.first()).toBeVisible();
    const label = (await buttons.first().innerText()).trim();
    await buttons.first().click();

    // Wait for the graded outcome to actually render before reading it. A
    // bare isVisible() does not retry, so it can sample the DOM before React
    // has committed and mistake a miss for a hit.
    await expect(page.locator('.mistake-card, .message-strip .result-correct').first()).toBeVisible();
    if (await page.locator('.mistake-card').count()) return label;

    // That card happened to be answered correctly -- advance and try again.
    await page.locator('.drill-next-btn').click();
    await expect(page.locator('.message-strip .result-correct')).toHaveCount(0);
  }
  throw new Error('could not produce a wrong answer in 12 cards');
}

async function openFlashcards(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
}

test('#7 flashcards: a wrong answer offers the table, which opens ringed on the cell and returns to the same card', async ({
  page,
}) => {
  await page.goto('/?e2e=1');
  await openFlashcards(page);

  await answerWrong(page);

  // Captured AFTER the wrong answer lands: answerWrong may advance past cards
  // that happened to be answered correctly, so the hand under correction is
  // not necessarily the one first dealt.
  const handUnderCorrection = await page.locator('.hand-cards').innerText();

  const panel = page.locator('.mistake-card');
  await expect(panel).toBeVisible();

  // The correction names the correct play AND classifies the error.
  await expect(panel).toContainText('Correct');
  await expect(panel.locator('.mistake-class')).toBeVisible();

  await panel.getByRole('button', { name: 'Show me the table', exact: true }).click();

  const overlay = page.locator('.study-chart-overlay');
  await expect(overlay).toBeVisible();

  // Exactly one cell is ringed, and its neighbours are still on screen --
  // the whole point is reading the decision against the ones either side.
  const highlighted = overlay.locator('[data-highlight="true"]');
  await expect(highlighted).toHaveCount(1);
  await expect(highlighted).toBeInViewport();
  const row = highlighted.locator('xpath=ancestor::tr[1]');
  expect(await row.locator('td').count()).toBeGreaterThan(1);

  // Closing returns to the very same card, still showing its correction.
  await overlay.getByRole('button', { name: /back/i }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('.mistake-card')).toBeVisible();
  expect(await page.locator('.hand-cards').innerText()).toBe(handUnderCorrection);
});

test('#7 the chart is not offered until an answer is actually wrong', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openFlashcards(page);

  await expect(page.getByRole('button', { name: 'Show me the table', exact: true })).toHaveCount(0);
  await expect(page.locator('.study-chart-overlay')).toHaveCount(0);
});

test('#2 Repeat re-speaks the last utterance, and only appears when audio is on', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full', volume: 1 } });
  await page.goto('/?e2e=1');
  await openFlashcards(page);

  const repeat = page.getByRole('button', { name: 'Repeat', exact: true });
  await expect(repeat).toBeVisible();

  // Grade an answer first: outside eyes-free mode the prompt is not spoken,
  // so the correction is the first utterance there is anything to repeat.
  await page.locator('.action-bar button.action-btn:not([disabled])').first().click();

  // Whatever was said last is said again, verbatim -- Repeat replays the real
  // utterance rather than rebuilding a prompt from current state.
  await page.waitForFunction(() => (window.__speechLog?.length ?? 0) > 0);
  const before = await page.evaluate(() => window.__speechLog!.slice());
  await repeat.click();
  await page.waitForFunction(
    (n) => (window.__speechLog?.length ?? 0) > n,
    before.length,
  );
  const after = await page.evaluate(() => window.__speechLog!.slice());

  // The log interleaves chimes ("chime:good") with speech, and a chime is
  // deliberately NOT an utterance -- repeating one would be meaningless. So
  // the replay must reproduce the last SPOKEN line, which is generally not
  // the last log entry.
  const lastSpoken = (log: string[]) =>
    [...log].reverse().find((entry) => !entry.startsWith('chime:'));
  expect(after[after.length - 1]).toBe(lastSpoken(before));
  expect(after[after.length - 1]).not.toMatch(/^chime:/);
});

test('#2 no Repeat control when audio is disabled', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  await expect(page.getByRole('button', { name: 'Repeat', exact: true })).toHaveCount(0);
});

/**
 * A1 regression guard. Item #3 disabled the unavailable ActionBar buttons and
 * gated the keyboard, but left the eyes-free ZonePad ungated -- so the one
 * input with no disabled affordance was the only one that still GRADED an
 * impossible play, writing it into Stats and the spaced-repetition deck.
 */
test('A1 eyes-free: an unavailable action is refused out loud, not graded', async ({ page }) => {
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', volume: 1 },
    drill: { flashCategory: 'hard' },
  });
  await page.goto('/?e2e=1');
  await openFlashcards(page);

  // Hard category never deals a pair, so Split can never be legal here.
  await page.locator('.count-toggle input').first().check();
  await expect(page.locator('.zone-pad')).toBeVisible();

  await page.evaluate(() => { window.__speechLog = []; });

  // Tap the actual Split quadrant. Driving the real pad matters here: the
  // regression WAS that this path alone bypassed the gate, and the keyboard
  // alias would not exercise it (it also bails while a checkbox holds focus).
  const quad = page.locator('.zone-pad-quad-split');
  await expect(quad).toBeVisible();
  // force: the quadrant divs are labels; the pad itself owns the pointer
  // handler and hit-tests by coordinate, so Playwright sees them as covered.
  await quad.click({ force: true });

  // Refused: it says why...
  await page.waitForFunction(() =>
    (window.__speechLog ?? []).some((l) => /isn't available/i.test(l)));

  // ...and critically, it did NOT grade. No verdict, no correction panel.
  await expect(page.locator('.mistake-card')).toHaveCount(0);
  await expect(page.locator('.message-strip .result-correct')).toHaveCount(0);
});
