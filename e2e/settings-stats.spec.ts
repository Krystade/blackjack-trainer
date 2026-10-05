import { test, expect, type Page } from '@playwright/test';
import { shot, withSettings, withStats, withProfile, playRoundByAdvice, readStats, statsTab } from './helpers';

test('a changed setting persists across reload', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Settings');
  await shot(page, '21-settings-default');

  const feedback = page.locator('.settings-row', { hasText: 'Feedback' });
  await expect(feedback.locator('.segmented-btn-active')).toHaveText('Training');
  await feedback.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(feedback.locator('.segmented-btn-active')).toHaveText('Test');
  await shot(page, '22-settings-changed');

  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.locator('.settings-row', { hasText: 'Feedback' }).locator('.segmented-btn-active'),
  ).toHaveText('Test');
  await shot(page, '23-settings-persisted-after-reload');
});

test('a short session shows up on the stats screen', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  await page.locator('.end-btn').click();
  await expect(page.locator('.home-title')).toBeVisible();

  await page.locator('.home-stats-link').click();
  await expect(page.locator('.stats-heading')).toHaveText('Stats');
  await statsTab(page, 'Progress');
  await expect(page.locator('.session-row')).not.toHaveCount(0);
  await shot(page, '24-stats-with-session');
});

test('export downloads bjtrainer-export.json', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('bjtrainer-export.json');
});

test('importing garbage shows an error and leaves the app navigable', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();

  page.once('dialog', (dialog) => dialog.accept());
  const fileInput = page.locator('input.stats-file-input');
  await fileInput.setInputFiles({
    name: 'garbage.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not valid json {{{'),
  });

  await expect(page.locator('.stats-message')).toContainText('Import failed');
  await shot(page, '25-stats-import-error');

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
});

test('importing a valid export blob restores stats (success path)', async ({ page }) => {
  // T0 gap #28 (docs/research/2026-07-26-test-coverage-matrix.md): the
  // existing "importing garbage" spec above only proves the failure path.
  // This is a well-formed exportAll()-shaped blob (persist.ts's importAll
  // validates `version === 1` on both settings and stats, then merges each
  // over its defaults), so it should actually restore.
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();

  const validExport = JSON.stringify({
    settings: { version: 1 },
    stats: {
      version: 1,
      sessions: [
        {
          date: new Date().toISOString(),
          rounds: 3,
          graded: 3,
          correct: 2,
          bankrollDelta: 5,
          profileId: 'e2e-import-profile',
          profileName: 'Imported Profile',
        },
      ],
    },
  });

  page.once('dialog', (dialog) => dialog.accept());
  const fileInput = page.locator('input.stats-file-input');
  await fileInput.setInputFiles({
    name: 'valid-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(validExport),
  });

  await expect(page.locator('.stats-message')).toContainText('Import successful');
  await statsTab(page, 'Progress');
  await expect(page.locator('.session-row', { hasText: 'Imported Profile' })).toBeVisible();
  await shot(page, '26-stats-import-success');

  // Confirm the restored blob was actually persisted, not just rendered.
  const persisted = await readStats(page);
  const sessions = (persisted as { sessions?: { profileName?: string }[] } | null)?.sessions ?? [];
  expect(sessions.some((s) => s.profileName === 'Imported Profile')).toBe(true);
});

test('Reset stats clears all persisted stats after confirmation', async ({ page }) => {
  // T0 gap #28: the Reset-stats danger button (handleReset in Stats.tsx)
  // has never been clicked by an e2e spec.
  await withStats(page, {
    sessions: [
      { date: new Date().toISOString(), rounds: 1, graded: 1, correct: 1, bankrollDelta: 1 },
    ],
  });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Progress');
  await expect(page.locator('.session-row')).not.toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.stats-danger-btn', { hasText: 'Reset stats' }).click();

  await expect(page.locator('.stats-message')).toContainText('Stats reset.');
  await statsTab(page, 'Progress');
  await expect(page.locator('.session-row')).toHaveCount(0);
  await shot(page, '27-stats-reset');

  const persisted = await readStats(page);
  expect((persisted as { sessions?: unknown[] } | null)?.sessions).toEqual([]);
});

test('Speak summary narrates the session summary under ?e2e=1', async ({ page }) => {
  // T0 gap #28: handleSpeakSummary (Stats.tsx) calls audio.say(
  // narrateStatsSummary(stats)); useAudio's `say` no-ops unless
  // audio.enabled && verbosity !== 'off', so both must be seeded. Under
  // ?e2e=1 speak() short-circuits straight to window.__speechLog.
  await withSettings(page, { audio: { enabled: true, verbosity: 'results' } });
  await withStats(page, { mistakes: { 'basic-error': 2 } });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();

  await page.locator('.stats-action-btn', { hasText: 'Speak summary' }).click();

  const speechLog = await page.evaluate(
    () => (window as unknown as { __speechLog?: string[] }).__speechLog ?? [],
  );
  expect(speechLog.some((s) => s.startsWith('This session:'))).toBe(true);
});

test('CVCX profile header renders score/EV/ROR/note plus actual accuracy from a played session', async ({ page }) => {
  // T0 gap #28: seeds a profile carrying CVCX numbers directly via
  // withProfile (not through the ProfileEditor UI), plays a short session so
  // Stats.tsx's `actualAccuracyPct` / `unitsPerHourProxy` also have real data
  // (rather than the dash "no data" placeholder), and asserts the whole
  // per-profile header block renders.
  await withProfile(page, {
    name: 'CVCX Header Profile',
    cvcx: { score: 87, evPerHour: 24, riskOfRuin: 3, simNote: 'CVCX N0 sim, 500M rounds' },
  });
  await withSettings(page, { countCheckEvery: 0 });
  await page.goto('/?seed=9&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  await page.locator('.end-btn').click();
  await expect(page.locator('.home-title')).toBeVisible();

  await page.locator('.home-stats-link').click();
  await expect(page.locator('.mistake-row', { hasText: 'CVCX score' })).toContainText('87');
  await expect(page.locator('.mistake-row', { hasText: 'CVCX EV/hr' })).toContainText('+24');
  await expect(page.locator('.mistake-row', { hasText: 'CVCX risk of ruin' })).toContainText('3%');
  await expect(page.locator('.mistake-row', { hasText: 'CVCX sim note' })).toContainText('CVCX N0 sim, 500M rounds');
  await expect(page.locator('.mistake-row', { hasText: 'Actual play accuracy' })).not.toContainText('—');
  await expect(page.locator('.mistake-row', { hasText: 'Actual units/hr' })).not.toContainText('—');
  await shot(page, '28-stats-cvcx-header-session');
});

/* RV4: the Retention section shows RETAINED accuracy (correct on items recalled */
/* after a spaced gap) — distinct from in-drill accuracy. Seed a retention       */
/* history (the write path is unit-tested in gradeAnswer.test.ts) and assert the */
/* display; also assert the empty-state copy when there are no spaced reviews.   */
test('stats: Retention section renders retained accuracy from seeded gap reviews', async ({ page }) => {
  await withStats(page, {
    retention: {
      history: [
        { date: '2026-07-30T00:00:00.000Z', key: 'hard-16-v-10', box: 2, gapMs: 86400000, correct: true },
        { date: '2026-07-30T00:01:00.000Z', key: '16v10', box: 3, gapMs: 259200000, correct: true },
        { date: '2026-07-30T00:02:00.000Z', key: 'soft-18-v-9', box: 2, gapMs: 86400000, correct: false },
      ],
    },
  });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await expect(page.locator('.stats-heading')).toHaveText('Stats');

  await statsTab(page, 'Progress');

  const retention = page.locator('.stats-section', { hasText: 'Retention' });
  await expect(retention).toBeVisible();
  await expect(retention.locator('.mistake-row', { hasText: 'Spaced reviews' })).toContainText('3');
  await expect(retention.locator('.mistake-row', { hasText: 'Retained accuracy' })).toContainText('67%');
  await shot(page, 'stats-retention');
});

/* V3-6: the pooled retention figure hid two things -- the DECAY CURVE (gapMs   */
/* has been recorded on every row since RV4 and never read) and its own          */
/* precision. Both are now on the screen. These seed a deck that is perfect at a */
/* short gap and gone at a long one, which pools to a merely-mediocre 50%.       */
function gapRows(
  gapDays: number,
  count: number,
  correct: boolean,
): { date: string; key: string; box: number; gapMs: number; correct: boolean }[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-07-30T00:${String(i).padStart(2, '0')}:00.000Z`,
    key: `k${gapDays}-${i}`,
    box: 3,
    gapMs: gapDays * 86400000,
    correct,
  }));
}

async function openRetention(page: Page) {
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Progress');
  return page.locator('.stats-section', { hasText: 'Retention' });
}

test('stats: retention is broken out by gap length, so a decay the pooled figure hides is visible', async ({
  page,
}) => {
  await withStats(page, {
    retention: { history: [...gapRows(4, 10, true), ...gapRows(60, 10, false)] },
  });
  const retention = await openRetention(page);

  // The pooled number on its own reads as a middling deck.
  await expect(retention.locator('.mistake-row', { hasText: 'Retained accuracy' })).toContainText(
    '50%',
  );
  // The curve says what actually happened: intact at a week, gone at a month.
  await expect(retention.locator('.mistake-row', { hasText: '3-7 days' })).toContainText('100%');
  await expect(retention.locator('.mistake-row', { hasText: 'over a month' })).toContainText('0%');
  // And bands with nothing in them are not drawn as zeroes, which would read
  // as failures rather than as absent data.
  await expect(retention.locator('.mistake-row', { hasText: '1-2 weeks' })).toHaveCount(0);
  // Tall enough that the whole curve is in the frame -- this shot is the
  // record of what the section actually looks like, not just that it exists.
  await page.setViewportSize({ width: 420, height: 1400 });
  await retention.screenshot({ path: 'e2e/screenshots/stats-retention-curve.png' });
});

test('stats: the retention figure states how far off it could be, and the width tracks the sample', async ({
  page,
}) => {
  await withStats(page, { retention: { history: gapRows(4, 3, true) } });
  let retention = await openRetention(page);
  const few = await retention
    .locator('.mistake-row', { hasText: 'Could honestly be' })
    .locator('.mistake-value')
    .textContent();
  // Three-for-three is 100% on the row above; the interval is what stops that
  // being read as a result.
  await expect(retention.locator('.mistake-row', { hasText: 'Retained accuracy' })).toContainText(
    '100%',
  );
  const fewLow = Number(/^(\d+)%/.exec(few ?? '')?.[1]);
  expect(fewLow).toBeLessThan(60);

  // A second seed registers after the first, so it wins on the next load.
  await withStats(page, { retention: { history: gapRows(4, 300, true) } });
  retention = await openRetention(page);
  const many = await retention
    .locator('.mistake-row', { hasText: 'Could honestly be' })
    .locator('.mistake-value')
    .textContent();
  const manyLow = Number(/^(\d+)%/.exec(many ?? '')?.[1]);
  expect(manyLow).toBeGreaterThan(fewLow);
  expect(manyLow).toBeGreaterThan(95);
});

test('stats: with every review at one gap length it says there is no curve, rather than drawing one', async ({
  page,
}) => {
  await withStats(page, { retention: { history: gapRows(4, 6, true) } });
  const retention = await openRetention(page);
  await expect(retention).toContainText('one gap length');
  await expect(retention.locator('.mistake-row', { hasText: '3-7 days' })).toHaveCount(0);
});

test('stats: Retention section shows the empty state before any spaced reviews', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Progress');
  const retention = page.locator('.stats-section', { hasText: 'Retention' });
  await expect(retention).toBeVisible();
  await expect(retention).toContainText('No spaced reviews yet');
});

/* ET5: Endurance/fatigue drift — front-half vs back-half accuracy within a      */
/* practice session (vigilance decrement). Seed a session that declines and      */
/* assert the drift shows; the grouping math is unit-tested in fatigueDrift.test. */
test('stats: Endurance/fatigue shows front vs back-half drift from a declining session', async ({ page }) => {
  const T0 = Date.parse('2026-07-31T10:00:00.000Z');
  const history = [];
  for (let i = 0; i < 8; i++) {
    // 8 runs 1 min apart (one 30-min session); front 4 correct, back 4 wrong.
    history.push({ date: new Date(T0 + i * 60000).toISOString(), cards: 20, intervalMs: 800, correct: i < 4 });
  }
  await withStats(page, { countDrill: { history } });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();

  await statsTab(page, 'Progress');

  const section = page.locator('.stats-section', { hasText: 'Endurance' });
  await expect(section).toBeVisible();
  await expect(section.locator('.mistake-row', { hasText: 'Early-session' })).toContainText('100%');
  await expect(section.locator('.mistake-row', { hasText: 'Late-session' })).toContainText('0%');
  await expect(section.locator('.mistake-row', { hasText: 'Drift' })).toContainText('fatigue');
  await shot(page, 'stats-fatigue');
});

test('stats: Endurance/fatigue shows the empty state before enough back-to-back runs', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Progress');
  const section = page.locator('.stats-section', { hasText: 'Endurance' });
  await expect(section).toBeVisible();
  await expect(section).toContainText('Not enough back-to-back counting runs yet');
});

/**
 * V3-8 (docs/BACKLOG.md, "decision drills grade strictly binary"): the Cost of
 * mistakes section. Driven end-to-end rather than unit-tested alone, because the
 * three things that can go wrong here are all integration: the section could be
 * filed under the wrong tab and never render, the cell ids could reach the page
 * raw ("hard-19-v-6"), and the unpriced remainder could go unmentioned so the
 * list silently reads as the complete account of the learner's mistakes.
 */
test('the cost of mistakes is ranked by total units, not by how bad each one looked', async ({ page }) => {
  const row = (hand: string, expected: string, taken: string, units: number, times: number) =>
    Array.from({ length: times }, () => ({ category: 'hard', hand, expected, taken, units }));

  await withStats(page, {
    mistakes: {
      correct: 300,
      'basic-error': 21,
      'missed-deviation': 9,
      'phantom-deviation': 0,
      'wrong-anyway': 0,
    },
    evCost: {
      history: [
        // A cheap habit, twenty times over: 0.088 units in total.
        ...row('soft-18-v-2', 'double', 'stand', 0.0044, 20),
        // One memorable disaster, worth less than the habit.
        ...row('hard-19-v-6', 'stand', 'hit', 0.045, 1),
      ],
    },
  });

  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Play');

  const section = page.locator('.stats-section', { hasText: 'Cost of mistakes' });
  await expect(section).toBeVisible();
  await expect(section).toContainText('21 priced mistakes');

  const rows = section.locator('.mistake-row');
  await expect(rows).toHaveCount(2);
  // The ranking claim: the repeated cheap error is first, above the dear one.
  await expect(rows.first()).toContainText('Soft 18 v 2');
  await expect(rows.first()).toContainText('×20');
  await expect(rows.first()).toContainText('0.088 u');
  await expect(rows.nth(1)).toContainText('Hard 19 v 6');

  // Cell ids must be humanised, never printed raw.
  await expect(section).not.toContainText('soft-18-v-2');

  // And the list must not pass itself off as the whole account: nine missed
  // deviations were graded and cannot honestly be priced.
  await expect(section).toContainText('9 further mistakes are counted above but unpriced');

  await shot(page, '29-stats-cost-of-mistakes');
});

test('the cost of mistakes says so plainly when nothing has been priced', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Play');

  const section = page.locator('.stats-section', { hasText: 'Cost of mistakes' });
  await expect(section).toContainText('No priced mistakes yet');
  await expect(section.locator('.mistake-row')).toHaveCount(0);
});

/**
 * RT#12 in Stats: a run that ended on the right count after drifting is the
 * one a final-count-only score calls perfect, so the section has to name it.
 */
test('Stats reports checkpoints held, and the runs that only looked clean', async ({ page }) => {
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  await withStats(page, {
    countDrill: {
      history: [
        // Right at the end, wrong in the middle: the cancellation case.
        { date: day(1), cards: 52, intervalMs: 800, correct: true, checkpointsCorrect: 0, checkpointsTotal: 2 },
        // Clean all the way through.
        { date: day(2), cards: 52, intervalMs: 800, correct: true, checkpointsCorrect: 2, checkpointsTotal: 2 },
        // Not measured -- must not be counted as either.
        { date: day(3), cards: 52, intervalMs: 800, correct: true },
      ],
    },
  });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Drills');

  await expect(page.getByText(/Checkpoints held: 2\/4/)).toBeVisible();
  await expect(page.getByText(/over 2 runs/)).toBeVisible();
  await expect(page.getByText(/1 run ended on the RIGHT count after drifting/)).toBeVisible();
});

test('a history with no checkpoints says nothing about them, rather than claiming a clean sweep', async ({
  page,
}) => {
  await withStats(page, {
    countDrill: {
      history: [{ date: new Date().toISOString(), cards: 52, intervalMs: 800, correct: true }],
    },
  });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Drills');

  await expect(page.getByText(/Checkpoints held/)).toHaveCount(0);
  await expect(page.getByText(/after drifting/)).toHaveCount(0);
});

/* ---------------------------------------------------------------------- */
/* G1: a window that half the screen ignores is worse than no window       */
/* ---------------------------------------------------------------------- */

/**
 * One row 200 days old and one from today, in three sections that each read
 * their history through a different path -- a summarize(), a bare length,
 * and a summary helper. All three were reading the FULL history while the
 * sections around them were filtered.
 */
async function seedDatedStats(page: Page): Promise<void> {
  const day = 24 * 60 * 60 * 1000;
  const old = new Date(Date.now() - 200 * day).toISOString();
  const today = new Date().toISOString();
  await withStats(page, {
    trueCount: {
      history: [
        { date: old, runningCount: 6, decksRemaining: 3, guess: 2, correctTc: 2, correct: true },
        { date: today, runningCount: 6, decksRemaining: 2, guess: 1, correctTc: 3, correct: false },
      ],
    },
    betSitLeave: {
      history: [
        { date: old, taken: 'bet', correctAction: 'bet', correct: true },
        { date: today, taken: 'sit', correctAction: 'leave', correct: false },
      ],
    },
    distraction: {
      history: [
        { date: old, kind: 'near-count', answerCorrect: true, countKept: true },
        { date: today, kind: 'near-count', answerCorrect: false, countKept: false },
      ],
    },
  });
}

/** `?e2e=1` forces every <details> open, so a section only needs finding. */
function section(page: Page, title: string) {
  return page.locator('.stats-section', { hasText: title }).first();
}

/** The value cell of a named row inside a section. */
function rowValue(page: Page, title: string, label: string) {
  return section(page, title).locator('.mistake-row', { hasText: label }).locator('span').last();
}

test('the range picker reaches the sections that were reading lifetime totals', async ({
  page,
}) => {
  await seedDatedStats(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Stats' }).first().click();

  // All time: both rows, everywhere.
  await statsTab(page, 'Drills');
  await expect(section(page, 'True count drill')).toContainText('1/2');
  await expect(rowValue(page, 'Distraction', 'Attempts')).toHaveText('2');
  await statsTab(page, 'Play');
  await expect(rowValue(page, 'Bet / sit / leave', 'Decisions')).toHaveText('2');

  // ...and the same window has to reach all three, or the screen is showing
  // two different questions answered side by side with nothing saying which
  // figure is which.
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await expect(rowValue(page, 'Bet / sit / leave', 'Decisions')).toHaveText('1');
  await statsTab(page, 'Drills');
  await expect(
    section(page, 'True count drill'),
    'the true-count section ignored the window',
  ).toContainText('0/1');
  await expect(rowValue(page, 'Distraction', 'Attempts')).toHaveText('1');

  // And back, so this is a filter and not a one-way door.
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await expect(section(page, 'True count drill')).toContainText('1/2');
});
