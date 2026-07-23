import { test, expect } from '@playwright/test';
import { shot, withSettings, readStats } from './helpers';

const SPEED_TIERS = ['Learning', 'Table-ready', 'Pro', 'Expert'];

test('count drill: flash 4 cards fast, submit RC, see result', async ({ page }) => {
  await withSettings(page, { drill: { countIntervalMs: 300, countLengthCards: 4, countGroup: 1 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await expect(page.locator('.drills-title')).toHaveText('Drills');
  await shot(page, '12-drills-picker');

  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();
  await shot(page, '13-count-drill-setup');

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-flash-area')).toBeVisible();
  await shot(page, '14-count-drill-flashing');

  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await shot(page, '15-count-drill-answering');

  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-correct, .result-wrong')).toBeVisible();
  await shot(page, '16-count-drill-result');

  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();
});

/**
 * Timed Challenge (speed ramp): a short deck + a fast (but floored) starting
 * pace keeps this deterministic and quick under `?e2e=1` (timers still run
 * for real there, they just aren't wall-clock-slow) -- 5 cards ramping down
 * from 300ms settle well within Playwright's default timeouts. Doesn't
 * assert on the exact tier (the drawn count/random RC entry make the
 * elapsed-time-driven tier non-deterministic across CI machines); asserts
 * the timed result block renders with a valid time, a benchmark-normalised
 * speed, and one of the four known tier labels.
 */
test('count drill: timed challenge auto-advances and reports elapsed time + speed tier', async ({ page }) => {
  await withSettings(page, {
    drill: { countLengthCards: 5, countGroup: 1, countTimedStartMs: 300 },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();

  await page.getByLabel('Timed challenge (speed ramp)').check();
  await expect(page.getByText('Starting pace')).toBeVisible();
  await shot(page, '59-timed-challenge-setup');

  await page.getByRole('button', { name: 'Start', exact: true }).click();

  // Auto-advances with no taps -- unlike manual mode, nothing here drives
  // the flash forward except the ramp effect itself.
  await expect(page.locator('.count-flash-area')).toBeVisible();
  await expect(page.locator('.count-timed-badge')).toBeVisible();
  await shot(page, '60-timed-challenge-flashing');

  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.timed-result')).toBeVisible();
  await shot(page, '61-timed-challenge-result');

  const time = await page.locator('.timed-result-time').innerText();
  expect(time).toMatch(/^\d+\.\ds$/);

  const spd = await page.locator('.timed-result-spd').innerText();
  expect(spd).toMatch(/^\d+\.\ds \/ deck$/);

  const tier = await page.locator('.timed-result-tier').innerText();
  expect(SPEED_TIERS).toContain(tier);

  await expect(page.locator('.timed-result-benchmark')).toContainText('table-ready');

  // Telemetry (docs/research/2026-07-21-priority-list.md item 8): a timed
  // run must persist to timedCount.history, and -- per the "do not
  // double-count" requirement -- must NOT also land in countDrill.history
  // (that section stays reserved for ordinary, non-timed runs).
  const stats = await readStats(page);
  const timedHistory = (stats?.timedCount as { history: unknown[] } | undefined)?.history ?? [];
  expect(timedHistory).toHaveLength(1);
  const timedEntry = timedHistory[0] as {
    cards: number;
    elapsedMs: number;
    secondsPerDeck: number;
    tier: string;
    correct: boolean;
  };
  expect(timedEntry.cards).toBe(5);
  expect(timedEntry.elapsedMs).toBeGreaterThan(0);
  expect(timedEntry.secondsPerDeck).toBeGreaterThan(0);
  expect(SPEED_TIERS.map((t) => t.toLowerCase())).toContain(timedEntry.tier);
  expect(typeof timedEntry.correct).toBe('boolean');
  const countDrillHistory = (stats?.countDrill as { history: unknown[] } | undefined)?.history ?? [];
  expect(countDrillHistory).toHaveLength(0);

  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();
});

test('true count drill: answering a question persists a trueCount history entry', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True Count Drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();

  expect(await readStats(page)).toBeNull(); // nothing persisted before the first attempt

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible();

  // Submit a guess of 0 (OK with an empty display defaults to 0, same idiom
  // NumPad uses elsewhere) -- the point here is proving persistence
  // happens, not exercising every guess value.
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-correct, .result-wrong')).toBeVisible();

  const stats = await readStats(page);
  const history = (stats?.trueCount as { history: unknown[] } | undefined)?.history ?? [];
  expect(history).toHaveLength(1);
  const entry = history[0] as {
    date: string;
    runningCount: number;
    decksRemaining: number;
    guess: number;
    correctTc: number;
    correct: boolean;
  };
  expect(entry.guess).toBe(0);
  expect(typeof entry.runningCount).toBe('number');
  expect(typeof entry.decksRemaining).toBe('number');
  expect(typeof entry.correctTc).toBe('number');
  expect(typeof entry.correct).toBe('boolean');
  expect(entry.correct).toBe(entry.guess === entry.correctTc);
  expect(new Date(entry.date).toString()).not.toBe('Invalid Date');
});

test('deck estimation drill: answering a question persists a deckEstimation history entry', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deck Estimation', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();

  expect(await readStats(page)).toBeNull(); // nothing persisted before the first attempt

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.deck-guess-grid')).toBeVisible();

  await page.locator('.deck-guess-btn').first().click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-correct, .result-wrong')).toBeVisible();

  const stats = await readStats(page);
  const history = (stats?.deckEstimation as { history: unknown[] } | undefined)?.history ?? [];
  expect(history).toHaveLength(1);
  const entry = history[0] as {
    date: string;
    actualDecks: number;
    guess: number;
    errorDecks: number;
    correct: boolean;
  };
  expect(entry.guess).toBe(0.5); // the first half-deck-stepped option
  expect(typeof entry.actualDecks).toBe('number');
  expect(entry.errorDecks).toBeCloseTo(Math.abs(entry.guess - entry.actualDecks), 10);
  expect(typeof entry.correct).toBe('boolean');
  expect(new Date(entry.date).toString()).not.toBe('Invalid Date');
});

test('flashcards: answer shows feedback, Next draws a new card', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
  await shot(page, '17-flashcard-question');

  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  await expect(page.locator('.feedback-cell')).toBeVisible();
  await shot(page, '18-flashcard-feedback');

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.feedback-cell')).not.toBeVisible();
});

/**
 * Keyboard input (operator request): pressing '2' must feed the exact same
 * handleAction the "Stand" ActionBar button calls -- not a parallel path
 * that merely looks similar. Proved by fixing Math.random (so the SAME
 * flashcard is drawn on both loads below) and diffing the full result --
 * feedback text AND persisted stats -- between a keyboard-driven answer and
 * a click-driven answer to the identical card.
 */
test('flashcards: pressing "2" answers Stand, grading identically to a click', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');

  await page.keyboard.press('2');
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  const keyboardResult = await page.locator('.message-strip').innerText();
  const keyboardStats = await readStats(page);

  // Reset both persisted stats and the flashcard weighting (which a wrong
  // answer would otherwise perturb) before replaying the identical seed via
  // a real click, so the two runs start from identical conditions.
  await page.evaluate(() => {
    window.localStorage.removeItem('bjtrainer.stats.v1');
    window.localStorage.removeItem('bjtrainer.flashweights.v1');
  });
  await page.reload();
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');

  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  const clickResult = await page.locator('.message-strip').innerText();
  const clickStats = await readStats(page);

  expect(keyboardResult).toBe(clickResult);
  expect(keyboardStats).toEqual(clickStats);
});

/**
 * Keyboard input (operator request): digits typed on the keyboard build the
 * SAME NumPad value the on-screen digit buttons build, and Enter calls the
 * same submit path as the OK button -- proved end-to-end by checking the
 * display echoes the typed digit and the result screen reflects the typed
 * value, exactly like e2e's existing tap-driven count-drill spec above.
 */
test('count drill: typed digit + Enter submits the running-count answer via keyboard', async ({ page }) => {
  await withSettings(page, { drill: { countIntervalMs: 300, countLengthCards: 4, countGroup: 1 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('3');
  await expect(page.locator('.numpad-display')).toHaveText('3');
  await page.keyboard.press('Enter');

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-correct, .result-wrong')).toBeVisible();
  await expect(page.locator('.result-detail')).toContainText('You entered 3');
});

test('deviation quiz: answer shows feedback with the index/label text', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Deviation Quiz');
  await shot(page, '19-quiz-question');

  const insurancePrompt = page.locator('.quiz-insurance-prompt');
  if (await insurancePrompt.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Decline Insurance', exact: true }).click();
  } else {
    await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  }

  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  const label = page.locator('.quiz-label');
  await expect(label).toBeVisible();
  await expect(label).not.toHaveText('');
  await shot(page, '20-quiz-feedback');

  await page.getByRole('button', { name: 'Next', exact: true }).click();
});

test('deviation quiz: "Mix in fakes" segmented control persists quizDistractorPct across reload', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();

  const mixRow = page.locator('.settings-row', { hasText: 'Mix in fakes' });
  await expect(mixRow.getByRole('button', { name: '0%', exact: true })).toHaveClass(/segmented-btn-active/);

  await mixRow.getByRole('button', { name: '50%', exact: true }).click();
  await expect(mixRow.getByRole('button', { name: '50%', exact: true })).toHaveClass(/segmented-btn-active/);

  await page.reload();
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  const mixRowAfterReload = page.locator('.settings-row', { hasText: 'Mix in fakes' });
  await expect(mixRowAfterReload.getByRole('button', { name: '50%', exact: true })).toHaveClass(/segmented-btn-active/);
});

/**
 * quizDistractorPct: 100 forces EVERY draw to be a distractor (see
 * drills/deviationQuiz.ts drawQuizItem) regardless of the item's own random
 * seed -- a deterministic path without needing to pin the seed itself.
 * Presentation is identical to a real item (no visual tell); only the
 * post-answer label differs, which is what this test pins down.
 */
test('deviation quiz distractors: quizDistractorPct 100 always shows the "no index applies" feedback label', async ({ page }) => {
  await withSettings(page, { drill: { quizDistractorPct: 100 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Deviation Quiz');

  await expect(page.locator('.settings-row', { hasText: 'Mix in fakes' })).toBeVisible();
  await shot(page, '61-quiz-distractor-question');

  const insurancePrompt = page.locator('.quiz-insurance-prompt');
  if (await insurancePrompt.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Decline Insurance', exact: true }).click();
  } else {
    await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  }

  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  await expect(page.locator('.quiz-label')).toContainText('No index applies here');
  await shot(page, '62-quiz-distractor-feedback');

  await page.getByRole('button', { name: 'Next', exact: true }).click();
});
