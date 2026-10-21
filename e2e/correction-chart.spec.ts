import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { answerAndReadStrip, withSettings } from './helpers';

/**
 * Operator items #7 ("check the correct table" from a mistake) and #2
 * (repeat the last spoken line).
 *
 * The property that matters for #7 is not that a chart appears -- it is that
 * the chart appears OVER the drill, ringed on the cell the mistake belongs
 * to, and that closing it returns to the SAME card. A correction that sends
 * you back to a fresh unrelated hand is not an anchor.
 */

/** Answer flashcards until one is graded wrong, clicking any enabled
 * action. Returns the label clicked. B1: every answer deals the next card at
 * once, and the miss is described by the result strip. */
async function answerWrong(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const buttons = page.locator('.action-bar button.action-btn:not([disabled])');
    await expect(buttons.first()).toBeVisible();
    const label = (await buttons.first().innerText()).trim();
    if ((await answerAndReadStrip(page, buttons.first())) === 'miss') return label;
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

  // B1: the next card is already up. The strip describes the ANSWERED one,
  // and the chart must open on that, not on the card now on screen.
  const strip = page.locator('[data-testid="result-strip"][data-tone="miss"]');
  await expect(strip).toBeVisible();
  const answered = await strip.getByTestId('hand-result-hand').innerText();
  const liveHand = await page.locator('.hand-cards').innerText();

  // The miss names the right play and classifies the error.
  await expect(strip.getByTestId('hand-result-expected')).toBeVisible();
  await expect(strip.locator('.hand-result-class')).toBeVisible();

  await strip.getByRole('button', { name: 'Show on chart', exact: true }).click();

  const overlay = page.locator('.study-chart-overlay');
  await expect(overlay).toBeVisible();

  // Exactly one cell is ringed, and its neighbours are still on screen --
  // the whole point is reading the decision against the ones either side.
  const highlighted = overlay.locator('[data-highlight="true"]');
  await expect(highlighted).toHaveCount(1);
  await expect(highlighted).toBeInViewport();
  const row = highlighted.locator('xpath=ancestor::tr[1]');
  expect(await row.locator('td').count()).toBeGreaterThan(1);

  // Closing returns to the same unanswered card, with the miss still up.
  await overlay.getByRole('button', { name: /back/i }).click();
  await expect(overlay).toHaveCount(0);
  await expect(strip.getByTestId('hand-result-hand')).toHaveText(answered);
  expect(await page.locator('.hand-cards').innerText()).toBe(liveHand);
});

test('#7 the chart is not offered until an answer is actually wrong', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openFlashcards(page);

  await expect(page.getByRole('button', { name: 'Show on chart', exact: true })).toHaveCount(0);
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
  // Disabled on purpose: audio ships on now (store/types.ts), and the control
  // this guards is the one that should not exist when it is off.
  await withSettings(page, { audio: { enabled: false } });
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
  // Named, not `.first()`: this used to be the first .count-toggle on the
  // screen, and a later feature adding its own toggle above it silently
  // pointed this line at the wrong checkbox.
  await page.locator('.count-toggle', { hasText: 'Eyes-free audio' }).locator('input').check();
  await expect(page.locator('.zone-pad')).toBeVisible();

  await page.evaluate(() => { window.__speechLog = []; });
  const storedGrades = () =>
    page.evaluate(() =>
      ['bjtrainer.stats.v1', 'bjtrainer.flashsr.v1'].map((k) => window.localStorage.getItem(k)),
    );
  const before = await storedGrades();

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

  // ...and critically, it did NOT grade. No verdict, no correction panel --
  // read once, now: a panel that did open auto-advances away within seconds,
  // so a retrying count(0) would wait for it to leave and pass. And nothing
  // reached Stats or the review deck, which outlive the screen.
  expect(await page.locator('.mistake-card').count()).toBe(0);
  expect(await page.locator('.message-strip .result-correct').count()).toBe(0);
  expect(await storedGrades()).toEqual(before);
});
