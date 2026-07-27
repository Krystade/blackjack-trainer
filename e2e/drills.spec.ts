import { test, expect, type Page } from '@playwright/test';
import { shot, withSettings, withStats, readStats, goHomeAndNavigate } from './helpers';

const SPEED_TIERS = ['Learning', 'Table-ready', 'Pro', 'Expert'];

/**
 * T0 gaps #14-23 (docs/research/2026-07-26-test-coverage-matrix.md §3): drill
 * sub-modes and keyboard-input parity that the original per-feature specs
 * above never drove. These three helpers mirror e2e/audio.spec.ts's
 * `__speechLog`/settings-readback idioms locally (e2e/helpers.ts is for
 * cross-suite reuse only) rather than importing from that spec file.
 */
declare global {
  interface Window {
    __speechLog?: string[];
  }
}

async function readSpeechLog(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__speechLog ?? []);
}

/** Polls `window.__speechLog` until some entry matches `re`, or times out --
 * see audio.spec.ts's identical helper for why this is a poll, not a single
 * read (narration is paced by an async effect, even at 0ms configured pace). */
async function waitForSpeechLogMatch(page: Page, re: RegExp, timeoutMs = 10_000): Promise<void> {
  await page.waitForFunction(
    (source) => {
      const log = (window as unknown as { __speechLog?: string[] }).__speechLog;
      if (!log) return false;
      const regex = new RegExp(source);
      return log.some((l) => regex.test(l));
    },
    re.source,
    { timeout: timeoutMs },
  );
}

/**
 * Read back the persisted settings blob (`bjtrainer.settings.v1`) WITHOUT
 * navigating -- per the known trap, `withSettings`'s `page.addInitScript`
 * re-seeds this key on every navigation/reload, so a real (post-toggle) value
 * can only be read reliably by evaluating the live page's localStorage in
 * place, never after a reload.
 */
async function readSettings(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const json = window.localStorage.getItem('bjtrainer.settings.v1');
    return json ? (JSON.parse(json) as Record<string, unknown>) : null;
  });
}

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

/**
 * R2 (docs/BACKLOG.md, accuracy-gated difficulty): with Adaptive difficulty
 * ON (the default), a history of accurate table-ready-tier runs should
 * unlock 'pro' and pace the NEXT run's ramp at pro's faster rate --
 * regardless of the configured "Starting pace" setting (2000ms/card here,
 * deliberately slow) and regardless of the un-earned 'learning' default a
 * fresh user would get. Proven two ways: the persisted history's new entry
 * records `attemptedTier: 'pro'`, and the run's measured elapsedMs is far
 * below what either the configured 2000ms/card or the learning-tier 900ms/
 * card pace would produce for 5 cards (~10000ms / ~4500ms respectively) --
 * pro's pace (drills/countSpeed.ts tierStartIntervalMs('pro') ~423ms/card)
 * finishes in ~2.1s.
 */
test('count drill: adaptive difficulty picks a faster start after a history of accurate runs', async ({
  page,
}) => {
  const accurateTableReadyRuns = Array.from({ length: 8 }, () => ({
    date: new Date().toISOString(),
    cards: 52,
    elapsedMs: 20_000,
    secondsPerDeck: 20,
    tier: 'table-ready',
    correct: true,
    attemptedTier: 'table-ready',
  }));
  await withStats(page, { timedCount: { history: accurateTableReadyRuns } });
  await withSettings(page, {
    drill: { countLengthCards: 5, countGroup: 1, countTimedStartMs: 2000 },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();

  await page.getByLabel('Timed challenge (speed ramp)').check();
  // Adaptive difficulty defaults to true -- left unchecked/untouched here to
  // exercise the shipped default rather than forcing it.
  await expect(page.getByLabel('Adaptive difficulty')).toBeChecked();
  await expect(page.locator('.settings-note-row', { hasText: 'Paces this run' })).toContainText('Pro');

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-flash-area')).toBeVisible();

  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.timed-result')).toBeVisible();

  const stats = await readStats(page);
  const timedHistory = (stats?.timedCount as { history: Record<string, unknown>[] } | undefined)?.history ?? [];
  expect(timedHistory).toHaveLength(9); // the 8 seeded + this run
  const newEntry = timedHistory[8]!;
  expect(newEntry.attemptedTier).toBe('pro');
  // Well under the learning-tier (900ms/card * 5 ~= 4500ms) and configured
  // (2000ms/card * 5 = 10000ms) baselines -- proves the FASTER, earned pace
  // was actually used, not just recorded.
  expect(newEntry.elapsedMs as number).toBeLessThan(3500);

  await expect(page.locator('.timed-result-gate')).toContainText('Unlocked: Pro');
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
 * R1 (docs/BACKLOG.md, decision-latency telemetry): answering a flashcard
 * must record a positive `elapsedMs` into stats.latencyHistory -- proof the
 * capture actually fires end-to-end (component mounts, prompt is shown,
 * `performance.now()` is read at draw time and again at grade time), not
 * just that the types compile. A tiny artificial delay before answering
 * guarantees elapsedMs is meaningfully > 0 rather than a flaky near-zero
 * timing race.
 */
test('flashcards: answering records a positive elapsedMs into stats.latencyHistory', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');

  expect(await readStats(page)).toBeNull(); // nothing persisted before the first attempt

  await page.waitForTimeout(120); // ensure a non-trivial, deterministic elapsed time

  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();

  const stats = await readStats(page);
  const latencyHistory = (stats?.latencyHistory as { category: string; elapsedMs: number }[] | undefined) ?? [];
  expect(latencyHistory).toHaveLength(1);
  expect(latencyHistory[0]!.elapsedMs).toBeGreaterThan(0);
  expect(latencyHistory[0]!.elapsedMs).toBeGreaterThanOrEqual(100); // the waitForTimeout(120) floor, with slack
  expect(['hard', 'soft', 'pairs', 'surrender']).toContain(latencyHistory[0]!.category);
});

/**
 * R1 (docs/BACKLOG.md, decision-latency telemetry): the captured latency
 * must actually SURFACE on the Stats screen, next to that category's
 * existing accuracy -- not just sit unused in localStorage. Reads back
 * which category the answered card landed in (drawFlashcard's category is
 * seed-driven, so this doesn't pin a specific one) and checks that row's
 * median-decision figure is no longer the "no data" dash.
 */
test('flashcards: a graded answer surfaces a median decision time on the Stats screen', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');

  await page.waitForTimeout(120);
  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();

  const stats = await readStats(page);
  const latencyHistory = (stats?.latencyHistory as { category: string; elapsedMs: number }[] | undefined) ?? [];
  expect(latencyHistory).toHaveLength(1);
  const category = latencyHistory[0]!.category;

  const CATEGORY_LABELS: Record<string, string> = {
    hard: 'Hard totals',
    soft: 'Soft totals',
    pairs: 'Pairs',
    surrender: 'Surrender',
  };

  await goHomeAndNavigate(page, '/?e2e=1', 'Stats');
  await expect(page.locator('.stats-heading')).toHaveText('Stats');

  const row = page.locator('.category-row', { hasText: CATEGORY_LABELS[category] });
  await expect(row.locator('.category-latency')).not.toHaveText('—');
  await expect(row.locator('.category-latency')).toContainText('s');
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

  // R1 (decision-latency telemetry): elapsedMs is real wall-clock time, so
  // the keyboard run and the click run will legitimately differ by a few ms
  // even for an "identical" answer -- that's not a grading divergence, it's
  // two separate button presses taking two separate amounts of time. Both
  // paths must still capture SOME positive latency (proving the shared
  // grade site fires either way); the grading-equivalence check below
  // normalizes elapsedMs out so it keeps comparing everything else
  // byte-for-byte, exactly as before this field existed.
  const keyboardLatency = (keyboardStats?.latencyHistory as { elapsedMs: number }[] | undefined) ?? [];
  const clickLatency = (clickStats?.latencyHistory as { elapsedMs: number }[] | undefined) ?? [];
  expect(keyboardLatency).toHaveLength(1);
  expect(clickLatency).toHaveLength(1);
  expect(keyboardLatency[0]!.elapsedMs).toBeGreaterThan(0);
  expect(clickLatency[0]!.elapsedMs).toBeGreaterThan(0);

  const normalizeLatency = (stats: Record<string, unknown> | null) => ({
    ...stats,
    latencyHistory: ((stats?.latencyHistory as { category: string; elapsedMs: number }[] | undefined) ?? []).map(
      (e) => ({ category: e.category, elapsedMs: 'NORMALIZED' }),
    ),
  });
  expect(normalizeLatency(keyboardStats)).toEqual(normalizeLatency(clickStats));
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

/**
 * D1 part 2 (docs/BACKLOG.md, distraction training): the mid-drill
 * interruption generator (drills/distraction.ts, shipped part 1) actually
 * wired into the count drill. `distractionFreq: 'relentless'` fires on the
 * 3rd card shown (isDistractionPoint's fixed cadence -- deterministic given
 * only the index, no seed needed for WHEN it fires); `countLengthCards: 4`
 * makes that the ONLY interruption in the run (index 2 of 0..3), so the
 * stream resumes cleanly to a normal graded finish afterward. Math.random is
 * pinned (same idiom as the existing keyboard-vs-click parity test above)
 * purely so the whole run is fully reproducible, not because the trigger
 * itself needs a seed.
 *
 * Proves: the prompt appears mid-stream (not instead of the flash, not at
 * the start), answering it writes a distraction.history row with a real
 * elapsedMs, the stream resumes and reaches a normal graded result, and
 * countKept was back-filled to match the run's own final-count grade.
 */
test('count drill: relentless distractions interrupt mid-stream and grade countKept against the final count', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await withSettings(page, {
    drill: {
      countIntervalMs: 200,
      countLengthCards: 4,
      countGroup: 1,
      distractionFreq: 'relentless',
    },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();

  // The setup screen's own control reflects the forced setting.
  const freqRow = page.locator('.settings-row', { hasText: 'Distractions' });
  await expect(freqRow.getByRole('button', { name: 'Relentless', exact: true })).toHaveClass(/segmented-btn-active/);

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-flash-area')).toBeVisible();
  await shot(page, '70-distraction-flashing');

  // Mid-stream: the flash pauses and a distraction challenge appears --
  // never at the very start (isDistractionPoint(0, ...) is always false).
  await expect(page.locator('.distraction-area')).toBeVisible({ timeout: 10_000 });
  const prompt = await page.locator('.distraction-prompt').innerText();
  expect(prompt.trim().length).toBeGreaterThan(0);
  await shot(page, '71-distraction-prompt');

  // Answer it (the value itself isn't asserted -- this run isn't pinned to
  // land on the right answer, only that answering records real telemetry).
  await page.locator('.numpad-btn', { hasText: /^7$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  // Resumes the flashing stream -- the distraction UI is gone, and the run
  // reaches its normal graded finish (NOT stuck, NOT skipped ahead).
  await expect(page.locator('.distraction-area')).not.toBeVisible();
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-correct, .result-wrong')).toBeVisible();
  await shot(page, '72-distraction-result');

  const stats = await readStats(page);
  const distractionHistory =
    (stats?.distraction as { history: Record<string, unknown>[] } | undefined)?.history ?? [];
  expect(distractionHistory).toHaveLength(1);
  const row = distractionHistory[0]!;
  expect(row.kind).toBe('near-count'); // the default distractionMode
  expect(typeof row.answerCorrect).toBe('boolean');
  expect(row.elapsedMs as number).toBeGreaterThan(0);

  // countKept was back-filled from the run's own final grade -- cross-check
  // against the SAME run's countDrill.history entry rather than re-deriving
  // correctness independently (there's exactly one of each here).
  const countDrillHistory =
    (stats?.countDrill as { history: Record<string, unknown>[] } | undefined)?.history ?? [];
  expect(countDrillHistory).toHaveLength(1);
  expect(row.countKept).toBe(countDrillHistory[0]!.correct);

  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();
});

/**
 * D1 part 2: distractionFreq defaults to 'off', so an ordinary run (every
 * existing test/e2e's implicit assumption) never enters the 'distraction'
 * phase at all, regardless of run length -- proving the opt-in default keeps
 * pre-D1 behavior byte-for-byte unless a user explicitly turns it on.
 */
test('count drill: distractionFreq off (default) never shows a distraction, even across many cards', async ({
  page,
}) => {
  await withSettings(page, {
    drill: { countIntervalMs: 150, countLengthCards: 13, countGroup: 1 },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();

  const freqRow = page.locator('.settings-row', { hasText: 'Distractions' });
  await expect(freqRow.getByRole('button', { name: 'Off', exact: true })).toHaveClass(/segmented-btn-active/);

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-flash-area')).toBeVisible();

  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.distraction-area')).toHaveCount(0);
  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.locator('.drill-result')).toBeVisible();
  const stats = await readStats(page);
  const distractionHistory =
    (stats?.distraction as { history: unknown[] } | undefined)?.history ?? [];
  expect(distractionHistory).toHaveLength(0);
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

/* ==================================================================== */
/* T0 gap #14 / #20: keyboard input parity across the remaining drills. */
/* Count drill's typed-digit + Enter and flashcards' "2" key are already */
/* covered above; these close manual-mode advance keys, deck estimation's */
/* typed-value grammar, the deviation quiz's shared keydown wiring, and   */
/* flashcards' 3/4/5 + Enter/Space-next.                                  */
/* ==================================================================== */

test('count drill: manual mode advances via Space, Enter, and ArrowRight, matching a tap', async ({ page }) => {
  await withSettings(page, { drill: { countManual: true, countLengthCards: 4, countGroup: 1 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  const tapZone = page.locator('.manual-tap-zone');
  await expect(tapZone).toBeVisible();
  await expect(tapZone.locator('.manual-tap-hint')).toContainText('1/4');

  await page.keyboard.press('Space');
  await expect(tapZone.locator('.manual-tap-hint')).toContainText('2/4');

  await page.keyboard.press('Enter');
  await expect(tapZone.locator('.manual-tap-hint')).toContainText('3/4');

  await page.keyboard.press('ArrowRight');
  await expect(tapZone.locator('.manual-tap-hint')).toContainText('4/4');

  // One more advance FROM the last card enters the answering phase --
  // exactly what the manual-tap-zone's onClick does for the same card.
  await page.keyboard.press('Space');
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
});

test('deck estimation: typed digit + "." + Enter submits a half-deck guess via keyboard', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deck Estimation', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.deck-guess-grid')).toBeVisible();

  await page.keyboard.press('2');
  await page.keyboard.press('.');
  // Mid-entry ("2.") is deliberately incomplete -- shows the "still typing"
  // ellipsis rather than resolving/highlighting a grid option.
  await expect(page.locator('.deck-typed-display')).toContainText('Typed: 2.');
  await expect(page.locator('.deck-guess-btn-typed')).toHaveCount(0);

  await page.keyboard.press('5');
  await expect(page.locator('.deck-typed-display')).toContainText('Typed: 2.5');
  await expect(page.locator('.deck-guess-btn-typed')).toHaveText('2.5');

  await page.keyboard.press('Enter');
  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-detail').first()).toContainText('You guessed 2.5 decks');

  const stats = await readStats(page);
  const history = (stats?.deckEstimation as { history: { guess: number }[] } | undefined)?.history ?? [];
  expect(history).toHaveLength(1);
  expect(history[0]!.guess).toBe(2.5);
});

test('flashcards: keyboard 3/4/5 answer Double/Split/Surrender, grading identically to a click', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });

  const KEYS: { key: string; label: string }[] = [
    { key: '3', label: 'Double' },
    { key: '4', label: 'Split' },
    { key: '5', label: 'Surrender' },
  ];

  for (const { key, label } of KEYS) {
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
    await expect(page.locator('.drill-heading')).toHaveText('Flashcards');

    await page.keyboard.press(key);
    await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
    const keyboardResult = await page.locator('.message-strip').innerText();

    // Reset stats/weights (same idiom as the existing "pressing 2" spec)
    // before replaying the identical seed via a real click.
    await page.evaluate(() => {
      window.localStorage.removeItem('bjtrainer.stats.v1');
      window.localStorage.removeItem('bjtrainer.flashweights.v1');
    });
    await page.reload();
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
    await expect(page.locator('.drill-heading')).toHaveText('Flashcards');

    await page.locator('.action-bar button.action-btn', { hasText: label }).click();
    await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
    const clickResult = await page.locator('.message-strip').innerText();

    expect(keyboardResult, `key "${key}" (${label}) should grade identically to a click`).toBe(clickResult);

    await page.evaluate(() => {
      window.localStorage.removeItem('bjtrainer.stats.v1');
      window.localStorage.removeItem('bjtrainer.flashweights.v1');
    });
  }
});

test('flashcards: Enter and Space both advance past feedback via keyboard, same as clicking Next', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');

  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  await expect(page.locator('.feedback-cell')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.feedback-cell')).not.toBeVisible();

  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  await expect(page.locator('.feedback-cell')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('.feedback-cell')).not.toBeVisible();
});

test('deviation quiz: keyboard action key grades identically to clicking the matching button', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  // Pinned to a real (non-insurance) index so the item is deterministically
  // an action item -- the shared 1-5 key->action map is already fully
  // proven by the flashcards spec above; this proves the QUIZ view's own
  // keydown handler is wired to that same map and grading path.
  await withSettings(page, { drill: { quizIndex: '16v10' } });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Deviation Quiz');

  await page.keyboard.press('1'); // KEY_TO_ACTION['1'] = 'hit'
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  const keyboardResult = await page.locator('.message-strip').innerText();
  expect(await readStats(page)).not.toBeNull();

  await page.evaluate(() => {
    window.localStorage.removeItem('bjtrainer.stats.v1');
    window.localStorage.removeItem('bjtrainer.quizweights.v1');
  });
  await page.reload();
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Deviation Quiz');

  await page.locator('.action-bar button.action-btn', { hasText: 'Hit' }).click();
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  const clickResult = await page.locator('.message-strip').innerText();

  expect(keyboardResult).toBe(clickResult);
});

test('deviation quiz: keyboard "1" takes insurance identically to clicking Take Insurance', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.7;
  });
  await withSettings(page, { drill: { quizIndex: 'ins' } }); // forces every drawn item to insurance

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.quiz-insurance-prompt')).toBeVisible();

  await page.keyboard.press('1');
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  const keyboardResult = await page.locator('.message-strip').innerText();

  await page.evaluate(() => window.localStorage.removeItem('bjtrainer.stats.v1'));
  await page.reload();
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.quiz-insurance-prompt')).toBeVisible();

  await page.getByRole('button', { name: 'Take Insurance', exact: true }).click();
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  const clickResult = await page.locator('.message-strip').innerText();

  expect(keyboardResult).toBe(clickResult);
});

test('deviation quiz: keyboard "2" declines insurance identically to clicking Decline Insurance', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.7;
  });
  await withSettings(page, { drill: { quizIndex: 'ins' } });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.quiz-insurance-prompt')).toBeVisible();

  await page.keyboard.press('2');
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  const keyboardResult = await page.locator('.message-strip').innerText();

  await page.evaluate(() => window.localStorage.removeItem('bjtrainer.stats.v1'));
  await page.reload();
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.quiz-insurance-prompt')).toBeVisible();

  await page.getByRole('button', { name: 'Decline Insurance', exact: true }).click();
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
  const clickResult = await page.locator('.message-strip').innerText();

  expect(keyboardResult).toBe(clickResult);
});
