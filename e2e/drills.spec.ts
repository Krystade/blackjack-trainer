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

/* R8/CM#1: the adversarial "Count bias" control clusters same-sign cards so */
/* the count runs through zero. This asserts the control persists the setting */
/* AND that a biased shoe drills end-to-end to a graded result (the setting   */
/* actually reaches makeCountDrill; the biasing MECHANIC is proven exactly in */
/* src/drills/countDrill.test.ts). */
test('count drill: Count bias control persists and a biased shoe drills to a graded result', async ({
  page,
}) => {
  await withSettings(page, { drill: { countIntervalMs: 200, countLengthCards: 6, countGroup: 1 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();

  // Default is None; switch to Neg-first via the setup control.
  const biasRow = page.locator('.settings-row', { hasText: 'Count bias' });
  await expect(biasRow.getByRole('button', { name: 'None', exact: true })).toHaveClass(/segmented-btn-active/);
  await biasRow.getByRole('button', { name: 'Neg-first', exact: true }).click();
  await expect(biasRow.getByRole('button', { name: 'Neg-first', exact: true })).toHaveClass(
    /segmented-btn-active/,
  );
  const biasSettings = await readSettings(page);
  expect((biasSettings?.drill as { countBias?: string } | undefined)?.countBias).toBe('negative');

  // A biased run still reaches a normal graded finish (not stuck, not thrown).
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-flash-area')).toBeVisible();
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await page.locator('.numpad-btn', { hasText: /^0$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-correct, .result-wrong')).toBeVisible();
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
    window.localStorage.removeItem('bjtrainer.flashsr.v1');
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

  // Answer through the run: the jittered cadence (RV5) may fire more than one
  // distraction, so answer each numpad that appears until the FINAL running-
  // count numpad (shown with NO distraction-area) is submitted. The answer
  // values aren't asserted -- only that the stream resumes to a graded finish.
  for (let guard = 0; guard < 12; guard++) {
    await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
    const isDistraction = await page
      .locator('.distraction-area')
      .isVisible()
      .catch(() => false);
    await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    if (!isDistraction) break; // that was the final count answer
  }

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-correct, .result-wrong')).toBeVisible();
  await shot(page, '72-distraction-result');

  const stats = await readStats(page);
  const distractionHistory =
    (stats?.distraction as { history: Record<string, unknown>[] } | undefined)?.history ?? [];
  // Jittered cadence (RV5): at least one distraction fired; assert the first.
  expect(distractionHistory.length).toBeGreaterThanOrEqual(1);
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
      window.localStorage.removeItem('bjtrainer.flashsr.v1');
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
      window.localStorage.removeItem('bjtrainer.flashsr.v1');
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
    window.localStorage.removeItem('bjtrainer.quizsr.v1');
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

/* ==================================================================== */
/* T0 gap #15: Count drill Countdown mode (52-card, guess the hidden      */
/* card's tag) -- unit-tested (countDrill.test's makeCountdown) but never */
/* e2e'd end to end through the toggle -> tag-guess -> result path.       */
/* ==================================================================== */

test('count drill: Countdown mode reaches the tag-guess result and records a 52-card entry', async ({ page }) => {
  test.setTimeout(30_000);
  await withSettings(page, { drill: { countManual: true } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();

  await page
    .locator('.count-toggle', { hasText: 'Countdown' })
    .locator('input[type="checkbox"]')
    .check();
  // Countdown mode hides the ordinary-drill-only Length/Group-size rows.
  await expect(page.getByText('Group size')).toHaveCount(0);

  await page.getByRole('button', { name: 'Start', exact: true }).click();

  const tapZone = page.locator('.manual-tap-zone');
  await expect(tapZone).toBeVisible();

  // A countdown round is the full 52-card deck minus the one hidden card --
  // 51 shown cards, one manual tap per card (see makeCountdown/countDrill.ts).
  for (let i = 0; i < 51; i++) {
    await tapZone.click();
  }

  await expect(page.locator('.tag-guess')).toBeVisible();
  await page.locator('.tag-guess-btn', { hasText: '0' }).click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-correct, .result-wrong')).toBeVisible();

  const stats = await readStats(page);
  const history = (stats?.countDrill as { history: { cards: number }[] } | undefined)?.history ?? [];
  expect(history).toHaveLength(1);
  expect(history[0]!.cards).toBe(52);
});

/* ==================================================================== */
/* T0 gap #16: Count drill eyes-free STRICT mode -- unlike the honor-     */
/* system self-check (audio.spec Case 4), strict mode still shows the     */
/* graded NumPad and writes a countDrill.history entry.                   */
/* ==================================================================== */

test('count drill: eyes-free Strict mode grades via NumPad and speaks the verdict (unlike the honor self-check)', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'results', cardDetail: 'full' },
    drill: { countManual: false, countLengthCards: 4, countGroup: 1, countIntervalMs: 0 },
  });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();

  await page.getByLabel('Eyes-free audio').check();
  await page.getByLabel('Strict mode (keypad entry, graded)').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  // Strict mode still shows the graded NumPad -- the honor-system
  // self-check path (audio.spec Case 4) never shows a keypad at all.
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press('3');
  await page.keyboard.press('Enter');

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-correct, .result-wrong')).toBeVisible();

  const log = await readSpeechLog(page);
  const verdictIndex = log.findIndex((l) => l === 'Correct.' || l.startsWith('Wrong. '));
  expect(verdictIndex, `expected a spoken verdict in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);

  // Strict mode GRADES (unlike the self-check honor path, which never
  // writes stats) -- proven by an actual countDrill.history write.
  const stats = await readStats(page);
  const history = (stats?.countDrill as { history: unknown[] } | undefined)?.history ?? [];
  expect(history).toHaveLength(1);
});

/* ==================================================================== */
/* T0 gap #17: distraction cadence/mode variants -- only 'relentless' +   */
/* 'near-count' were e2e'd before; these close 'occasional' cadence and   */
/* 'generic' mode.                                                        */
/* ==================================================================== */

test('count drill: occasional distractions interrupt mid-stream (jittered, sparser than relentless)', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await withSettings(page, {
    drill: { countIntervalMs: 150, countLengthCards: 8, countGroup: 1, distractionFreq: 'occasional' },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();

  const freqRow = page.locator('.settings-row', { hasText: 'Distractions' });
  await expect(freqRow.getByRole('button', { name: 'Occasional', exact: true })).toHaveClass(/segmented-btn-active/);
  await expect(page.locator('.settings-note-row', { hasText: 'unpredictable' })).toBeVisible();

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-flash-area')).toBeVisible();

  // Mid-stream (RV5: jittered cadence, one per 7-card window) at least one
  // distraction fires before the count answer; it's not the very first card.
  await expect(page.locator('.distraction-area')).toBeVisible({ timeout: 10_000 });

  // Answer through the run: answer each numpad until the FINAL count numpad
  // (no distraction-area) is submitted -- robust to how many distractions the
  // jittered cadence fires across the 8-card run.
  for (let guard = 0; guard < 12; guard++) {
    await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
    const isDistraction = await page
      .locator('.distraction-area')
      .isVisible()
      .catch(() => false);
    await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    if (!isDistraction) break;
  }

  await expect(page.locator('.drill-result')).toBeVisible();

  const stats = await readStats(page);
  const distractionHistory =
    (stats?.distraction as { history: Record<string, unknown>[] } | undefined)?.history ?? [];
  expect(distractionHistory.length).toBeGreaterThanOrEqual(1);
  expect(distractionHistory[0]!.kind).toBe('near-count');
});

test('count drill: distraction type "Generic" poses plain arithmetic unrelated to the running count', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await withSettings(page, {
    drill: {
      countIntervalMs: 150,
      countLengthCards: 4,
      countGroup: 1,
      distractionFreq: 'relentless',
      distractionMode: 'generic',
    },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();

  const typeRow = page.locator('.settings-row', { hasText: 'Distraction type' });
  await expect(typeRow.getByRole('button', { name: 'Generic', exact: true })).toHaveClass(/segmented-btn-active/);

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.distraction-area')).toBeVisible({ timeout: 10_000 });

  // Generic operands are fixed 2..12 joined by + or × (drills/distraction.ts
  // GENERIC_MIN/MAX) -- never the near-count mode's count-relative operands.
  const prompt = await page.locator('.distraction-prompt').innerText();
  expect(prompt).toMatch(/^\d+ [+×] \d+$/);

  // Answer through the run (jittered cadence may fire more than one) until the
  // final count numpad (no distraction-area) is submitted.
  for (let guard = 0; guard < 12; guard++) {
    await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
    const isDistraction = await page
      .locator('.distraction-area')
      .isVisible()
      .catch(() => false);
    await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    if (!isDistraction) break;
  }
  await expect(page.locator('.drill-result')).toBeVisible();

  const stats = await readStats(page);
  const distractionHistory =
    (stats?.distraction as { history: Record<string, unknown>[] } | undefined)?.history ?? [];
  expect(distractionHistory.length).toBeGreaterThanOrEqual(1);
  expect(distractionHistory[0]!.kind).toBe('generic');
});

/* ==================================================================== */
/* T0 gap #18: count group size 2/3 -- every prior e2e used group 1;      */
/* multi-card groups were unit-tested (countDrill.test) but never         */
/* rendered through the real UI.                                         */
/* ==================================================================== */

test('count drill: group size 2 and 3 flash multiple cards per flash step', async ({ page }) => {
  await withSettings(page, { drill: { countManual: true, countLengthCards: 6, countGroup: 3 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();

  const groupRow = page.locator('.settings-row', { hasText: 'Group size' });
  await expect(groupRow.getByRole('button', { name: '3', exact: true })).toHaveClass(/segmented-btn-active/);

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.manual-tap-zone')).toBeVisible();
  await expect(page.locator('.count-flash-cards .card')).toHaveCount(3);

  // CountDrillView's "Back" button exits all the way to the Drills picker
  // (its onBack prop is Drills.tsx's setMode('picker')), not back to this
  // drill's own setup phase -- re-enter via the picker rather than assuming
  // an in-place phase reset.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();

  await groupRow.getByRole('button', { name: '2', exact: true }).click();
  await expect(groupRow.getByRole('button', { name: '2', exact: true })).toHaveClass(/segmented-btn-active/);

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.manual-tap-zone')).toBeVisible();
  await expect(page.locator('.count-flash-cards .card')).toHaveCount(2);
});

/* ==================================================================== */
/* T0 gap #19: True Count drill eyes-free honor self-check + strict mode  */
/* -- mirrors CountDrillView's precedent (audio.spec Case 4 / gap #16     */
/* above) but for TrueCountDrillView, which had zero eyes-free coverage.  */
/* ==================================================================== */

test('true count drill: eyes-free honor self-check speaks without grading; strict mode grades via NumPad', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await withSettings(page, { audio: { enabled: true, verbosity: 'results', answerPauseMs: 300 } });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True Count Drill', exact: true }).click();

  await page.getByLabel('Eyes-free audio').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.locator('.count-flash-progress')).toContainText('Listen for the running count');
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.result-detail')).toContainText('self-check, no grade recorded');

  const selfCheckLog = await readSpeechLog(page);
  expect(selfCheckLog.some((l) => l.startsWith('Running count'))).toBe(true);
  expect(selfCheckLog.some((l) => l.startsWith('True count'))).toBe(true);
  // Honor-system self-check never writes telemetry -- nothing to grade.
  expect(await readStats(page)).toBeNull();

  // Fresh setup (component remount resets the local eyesFree/strictMode
  // state) -- this time with Strict mode on too.
  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True Count Drill', exact: true }).click();

  await page.getByLabel('Eyes-free audio').check();
  await page.getByLabel('Strict mode (keypad entry, graded)').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.locator('.numpad')).toBeVisible();
  await page.keyboard.press('0');
  await page.keyboard.press('Enter');

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-detail')).not.toContainText('self-check');

  const stats = await readStats(page);
  const history = (stats?.trueCount as { history: unknown[] } | undefined)?.history ?? [];
  expect(history).toHaveLength(1);
});

/* ==================================================================== */
/* T0 gap #21: Deviation Quiz eyes-free ACTION ZonePad (non-insurance) -- */
/* audio.spec Case 5/6 cover flashcards' action zonepad and the quiz's    */
/* insurance-variant zonepad; the quiz's own non-insurance action zonepad */
/* path was never separately exercised.                                  */
/* ==================================================================== */

test('eyes-free deviation quiz: action ZonePad (non-insurance item), quadrant tap logs echo + verdict + chime', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'results' },
    drill: { quizIndex: '16v10' }, // forces a real (non-insurance) action item
  });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.dealer-area')).toBeVisible(); // non-insurance: cards render, not the insurance prompt

  await page.getByLabel('Eyes-free audio').check();
  const zonePad = page.locator('.zone-pad');
  await expect(zonePad).toBeAttached();
  await expect(page.locator('.zone-pad-quadrants')).toBeVisible(); // action mode, not the insurance halves

  // Tap the top-left quadrant of the pad's OWN bounding box -> 'hit'. Computed
  // from the pad rect (not a fixed viewport coordinate) because T0-BUG1's fix
  // starts the pad below the control strip: the pad no longer spans from y=0,
  // so a hardcoded (60,100) would land on the controls above it. 25%/25% is
  // well clear of the center 'surrender' circle regardless of the strip's
  // measured height (ZonePad hit-tests against this same rect).
  const box = await zonePad.boundingBox();
  if (!box) throw new Error('ZonePad has no bounding box');
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);

  await waitForSpeechLogMatch(page, /^Hit/);
  const log = await readSpeechLog(page);
  const echoIndex = log.findIndex((l) => l.startsWith('Hit'));
  expect(echoIndex, `expected the "Hit..." echo in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);

  const verdictIndex = log.findIndex((l, i) => i > echoIndex && (l === 'Correct.' || l.startsWith('Wrong. ')));
  expect(verdictIndex, `expected a verdict line in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);

  const chimeIndex = log.findIndex((l, i) => i > verdictIndex && (l === 'chime:good' || l === 'chime:bad'));
  expect(chimeIndex, `expected a chime after the verdict in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);

  expect(await readStats(page)).not.toBeNull();
});

/* ==================================================================== */
/* T0 gap #22: "Dim screen" (dimZones) toggle -- never exercised anywhere. */
/* ==================================================================== */

/**
 * T0-BUG1 REGRESSION GUARD (docs/BACKLOG.md "T0 status"): "Dim screen" is the
 * ONLY on-screen control for `audio.dimZones` anywhere in the app
 * (Settings.tsx has no copy of it), and it's `disabled={!eyesFree}` -- it can
 * only ever be checked while eyes-free is already on, which mounts the
 * `.zone-pad` overlay. The bug was that the pad (a fixed, opaque,
 * full-viewport `inset:0` overlay) physically covered this very checkbox, so
 * a real tap/click was intercepted -- reproducible in Playwright AND under a
 * real finger. The fix starts the pad BELOW the drill's control strip (a
 * `--zone-pad-top` offset measured from the strip's height), leaving the
 * toggle uncovered. This test therefore asserts a REAL `.check()` succeeds
 * (NO `force: true`, which would silently mask exactly the click-block the
 * bug was about); if the pad ever creeps back over the toggle, Playwright's
 * actionability check makes this fail again.
 */
test('flashcards: Dim screen toggle switches the ZonePad to hidden-but-tappable and persists dimZones', async ({
  page,
}) => {
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();

  await page.getByLabel('Eyes-free audio').check();
  const zonePad = page.locator('.zone-pad');
  await expect(zonePad).toBeAttached();
  await expect(zonePad).not.toHaveClass(/zone-pad-hidden/);

  // A REAL mouse/touch .check() -- no force -- must reach the toggle. Before
  // the T0-BUG1 fix this timed out with the ZonePad's opaque overlay
  // "intercepts pointer events"; now the pad starts below the control strip,
  // so the pointer hit-test lands on the checkbox itself.
  await page.getByLabel('Dim screen').check();

  await expect(zonePad).toHaveClass(/zone-pad-hidden/);
  await expect(zonePad).toBeAttached(); // still attached/tappable, just visually dimmed

  // Read the just-saved value straight out of localStorage WITHOUT a reload
  // -- withSettings' addInitScript would re-seed the pre-toggle blob on any
  // subsequent navigation (the documented trap), so a reload would silently
  // read back the ORIGINAL seeded value, not what was just toggled.
  const settings = await readSettings(page);
  expect((settings?.audio as { dimZones?: boolean } | undefined)?.dimZones).toBe(true);
});

/* ==================================================================== */
/* T0 gap #23: Flashcards' INLINE Category segmented -- the Settings-     */
/* screen copy of this same control is also uncovered, but this closes    */
/* the more direct, always-visible inline one on the drill screen itself. */
/* ==================================================================== */

test('flashcards: inline Category segmented redraws from the chosen category and persists flashCategory', async ({
  page,
}) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();

  const categoryRow = page.locator('.settings-row', { hasText: 'Category' });
  await expect(categoryRow.getByRole('button', { name: 'All', exact: true })).toHaveClass(/segmented-btn-active/);

  await categoryRow.getByRole('button', { name: 'Pairs', exact: true }).click();
  await expect(categoryRow.getByRole('button', { name: 'Pairs', exact: true })).toHaveClass(/segmented-btn-active/);

  // Redraw actually respected the filter -- the graded answer's cellId is a
  // pair cell (drills/flashcards.ts: "pair-<rank>-v-<up>"), never hard/soft.
  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  await expect(page.locator('.feedback-cell')).toBeVisible();
  const cellId = await page.locator('.feedback-cell').innerText();
  expect(cellId.startsWith('pair-'), `expected a pair cell, got "${cellId}"`).toBe(true);

  const settings = await readSettings(page);
  expect((settings?.drill as { flashCategory?: string } | undefined)?.flashCategory).toBe('pairs');
});

/* ==================================================================== */
/* R4 (docs/BACKLOG.md): interleaved / mixed-session mode. Blends       */
/* flashcard items (basic strategy, NO true count) with deviation-quiz  */
/* items (count-dependent) in one session. Pinning Math.random makes    */
/* the interleave seed deterministic (randomSeed() = floor(0.42*1e9) =  */
/* 420000000), whose pickMixedType schedule is quiz,quiz,quiz,flash,    */
/* flash,flash (proven in src/drills/mixedSession.test.ts) -- so a      */
/* 6-item run deterministically grades BOTH a quiz-type and a           */
/* flashcard-type item. Every item grades through the SAME shared path  */
/* the standalone drills use (src/drills/gradeAnswer.ts), so both       */
/* histories populate from one session.                                 */
/* ==================================================================== */

test('mixed session: interleaves flashcard + quiz items, grading each through its standalone path', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await expect(page.locator('.drills-title')).toHaveText('Drills');

  await page.getByRole('button', { name: 'Mixed', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Mixed');
  await shot(page, '80-mixed-session');

  // The seeded interleave for this pinned session (see mixedSession.test.ts).
  const EXPECTED_TYPES = ['quiz', 'quiz', 'quiz', 'flash', 'flash', 'flash'];
  let sawFlash = false;
  let sawQuiz = false;

  for (let i = 0; i < EXPECTED_TYPES.length; i++) {
    // A quiz item shows a true count (.quiz-tc); a flashcard item never does.
    // That visible cue IS the discrimination the mode trains.
    await expect(page.locator('.action-bar')).toBeVisible();
    const isQuiz = (await page.locator('.quiz-tc').count()) > 0;
    expect(isQuiz ? 'quiz' : 'flash', `item ${i} type`).toBe(EXPECTED_TYPES[i]);

    // Answer via the SAME surfaces the standalone views expose: insurance
    // items get Decline; everything else gets Stand.
    const insurancePrompt = page.locator('.quiz-insurance-prompt');
    if (await insurancePrompt.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Decline Insurance', exact: true }).click();
    } else {
      await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
    }

    // Feedback renders per item -- reusing the standalone feedback surfaces:
    // flashcards show .feedback-cell (the chart cell), quiz items .quiz-label.
    await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();
    if (await page.locator('.feedback-cell').isVisible().catch(() => false)) sawFlash = true;
    if (await page.locator('.quiz-label').isVisible().catch(() => false)) sawQuiz = true;

    if (i === 0) await shot(page, '81-mixed-quiz-item-feedback');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toHaveCount(0);
  }

  // BOTH item types appeared and were graded across the seeded run.
  expect(sawFlash, 'a flashcard-type item must appear').toBe(true);
  expect(sawQuiz, 'a quiz-type item must appear').toBe(true);

  // Telemetry: one mixed session naturally populates BOTH histories through
  // the shared grade path. Every graded item (flash + quiz) captures an R1
  // latency; only the 3 real quiz items write perIndex (flashcards never do),
  // so the counts prove exactly which path each item took -- no drift.
  const stats = await readStats(page);
  const latency = (stats?.latencyHistory as { elapsedMs: number }[] | undefined) ?? [];
  expect(latency).toHaveLength(6);
  for (const l of latency) expect(l.elapsedMs).toBeGreaterThan(0);

  const categories = (stats?.categories as Record<string, { right: number; wrong: number }> | undefined) ?? {};
  const categoryGrades = Object.values(categories).reduce((sum, t) => sum + t.right + t.wrong, 0);
  expect(categoryGrades, 'every graded item bumps exactly one category tally').toBe(6);

  const perIndex = (stats?.perIndex as Record<string, { right: number; wrong: number }> | undefined) ?? {};
  const quizGrades = Object.values(perIndex).reduce((sum, t) => sum + t.right + t.wrong, 0);
  expect(quizGrades, 'the 3 quiz items graded through the quiz path (flashcards write no perIndex)').toBe(3);

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();
});

/* R8/TS#6: pair-cancellation drill. Two cards, pick the net Hi-Lo tag. This  */
/* validates the full wiring deterministically WITHOUT pre-computing the      */
/* seed's net: it clicks a fixed answer, then reads the recorded telemetry    */
/* and asserts self-consistency (guess matches, net in range, correctness =   */
/* (net===0)). The net-computation itself is proven in the unit tests. */
test('pair cancellation: answering a pair grades it and records self-consistent telemetry', async ({
  page,
}) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Pair Cancellation', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Pair Cancellation');
  await expect(page.locator('.pair-cancel-cards .card')).toHaveCount(2);
  await shot(page, '90-pair-cancel');

  // Answer "0" (a fixed choice from the five −2..+2 buttons).
  await page.locator('.pair-cancel-answers button.action-btn', { hasText: /^0$/ }).click();
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();

  const stats = await readStats(page);
  const history = (stats?.pairCancel as { history: Record<string, number | boolean>[] } | undefined)?.history ?? [];
  expect(history).toHaveLength(1);
  const row = history[0]!;
  expect(row.guess).toBe(0);
  expect([-2, -1, 0, 1, 2]).toContain(row.net);
  expect(row.correct).toBe(row.net === 0); // grading is consistent with the shown net
  expect(row.cancelling).toBe(row.net === 0 ? row.cancelling : false);
  expect(row.elapsedMs as number).toBeGreaterThanOrEqual(0);

  // Next draws a fresh pair and clears the feedback.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toHaveCount(0);
  await expect(page.locator('.pair-cancel-cards .card')).toHaveCount(2);
});

/* R9 / red-team #7: "messy" card presentation applies a small per-card         */
/* rotation/offset so the visual-recognition half of counting is trained. This  */
/* asserts the transform is actually applied to flashed cards when the toggle    */
/* is on (the jitter math is proven in src/drills/cardJitter.test.ts). */
test('count drill: Messy cards applies a per-card transform to the flashed cards', async ({ page }) => {
  await withSettings(page, { drill: { countIntervalMs: 500, countLengthCards: 4, countGroup: 1 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();

  await page.getByRole('checkbox', { name: /Messy cards/ }).check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  // A flashed card is wrapped in a .messy-card span carrying a translate+rotate.
  const messy = page.locator('.count-flash-cards .messy-card').first();
  await expect(messy).toBeVisible();
  const transform = await messy.evaluate((el) => (el as HTMLElement).style.transform);
  expect(transform).toContain('rotate');
  expect(transform).toContain('translate');
});

/* ET7: adversarial dealer-pace pressure — sudden fast bursts on the count-drill */
/* flash. Asserts the toggle persists AND a pressured run drills to a graded     */
/* result (the burst timing math is proven in src/drills/pacePressure.test.ts). */
test('count drill: Pace pressure toggle persists and a pressured run drills to a graded result', async ({
  page,
}) => {
  await withSettings(page, { drill: { countIntervalMs: 150, countLengthCards: 6, countGroup: 1 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();

  const paceToggle = page.getByRole('checkbox', { name: /Pace pressure/ });
  await expect(paceToggle).not.toBeChecked();
  await paceToggle.check();
  await expect(paceToggle).toBeChecked();
  const settings = await readSettings(page);
  expect((settings?.drill as { pacePressure?: boolean } | undefined)?.pacePressure).toBe(true);

  // A pressured run still reaches a normal graded finish (bursts shorten some
  // intervals but never stall the drill).
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-flash-area')).toBeVisible();
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await page.locator('.numpad-btn', { hasText: /^0$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.result-correct, .result-wrong')).toBeVisible();
});

/* ET3: bet/sit/leave decision drill. Validates wiring deterministically without */
/* pinning the seed: click a fixed action, then assert the recorded telemetry is */
/* self-consistent (the consensus grading rule is proven in betSitLeave.test.ts). */
test('bet/sit/leave: answering a scenario grades it and records self-consistent telemetry', async ({
  page,
}) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Bet / Sit / Leave', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Bet / Sit / Leave');
  await expect(page.locator('.bsl-tc')).toBeVisible();
  await shot(page, '95-bet-sit-leave');

  await page.locator('.bsl-answers').getByRole('button', { name: 'Bet', exact: true }).click();
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toBeVisible();

  const stats = await readStats(page);
  const history = (stats?.betSitLeave as { history: Record<string, unknown>[] } | undefined)?.history ?? [];
  expect(history).toHaveLength(1);
  const row = history[0]!;
  expect(row.taken).toBe('bet');
  expect(['bet', 'sit', 'leave']).toContain(row.correctAction);
  expect(row.correct).toBe(row.taken === row.correctAction); // grading is consistent

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.message-strip .result-correct, .message-strip .result-wrong')).toHaveCount(0);
  await expect(page.locator('.bsl-tc')).toBeVisible();
});

/* ET1: the tilt-inoculation Downswing session. The count now SWINGS (draw-out  */
/* rounds push it positive, pat rounds negative), so the ramp bet varies. This  */
/* plays it with PERFECT discipline — betting the DEFAULT_SPREAD ramp for the    */
/* TC shown each hand — and asserts that scores 100% conformity + held-discipline*/
/* through the drawdown. The rig's per-round loss + count swing are proven       */
/* against the engine in downswingShoe.test.ts. */
test('downswing: betting the ramp for the (swinging) count holds discipline — 100% conformity as the bankroll falls', async ({
  page,
}) => {
  test.setTimeout(30_000);
  // DEFAULT_SPREAD ramp: TC<=0->1, 1->2, 2->4, 3->8, 4->10, 5+->12 units.
  const rampBet = (tc: number) => (tc <= 0 ? 1 : tc === 1 ? 2 : tc === 2 ? 4 : tc === 3 ? 8 : tc === 4 ? 10 : 12);

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Downswing', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Downswing');
  await shot(page, '96-downswing');

  for (let r = 0; r < 25; r++) {
    // Read the shown true count and bet the ramp exactly.
    const tcText = await page.locator('.downswing-count').innerText(); // e.g. "TC +2"
    const tc = parseInt(tcText.replace(/[^-\d]/g, ''), 10) || 0;
    await page.locator('.bet-chips').getByRole('button', { name: String(rampBet(tc)), exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    const stand = page.getByRole('button', { name: 'Stand', exact: true });
    if (await stand.isVisible().catch(() => false)) await stand.click();
    await page.getByRole('button', { name: r < 24 ? 'Next hand' : 'See result', exact: true }).click();
  }

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.drill-result .result-correct')).toContainText('held your discipline');
  await expect(page.locator('.drill-result')).toContainText('100%');
  await expect(page.locator('.drill-result')).toContainText('downswing');
  await shot(page, '97-downswing-report');
});
