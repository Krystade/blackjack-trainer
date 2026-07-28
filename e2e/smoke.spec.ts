import { test, expect } from '@playwright/test';
import { shot, withProfile, withSettings, readStats, playRoundByAdvice } from './helpers';

/**
 * T0 gap #2 (docs/research/2026-07-26-test-coverage-matrix.md, "SPEC — Single
 * full-journey smoke test"): one continuous session that walks every screen
 * and every drill mode, so a regression that breaks any screen's mount or a
 * nav edge is caught even before the per-feature specs run. Assertions are
 * deliberately LIGHT here (mount + one primary control + one primary action)
 * -- the per-feature specs (game/drills/profiles/settings-stats.spec.ts) own
 * the deep assertions for each mode.
 *
 * Known trap (see helpers.ts's withSettings/withProfile docs): both seed via
 * page.addInitScript, which RE-RUNS on every page.goto/reload. This spec
 * therefore does exactly ONE page.goto (with every needed patch seeded
 * up-front) and navigates the rest of the journey entirely through in-app
 * buttons -- a real SPA route change does not re-trigger addInitScript, so
 * settings/profile state set before the single goto stays intact for the
 * whole walk, and nothing gets silently re-seeded mid-journey.
 */
test('full journey: Home -> Profiles -> Settings -> Table -> every Drill mode -> Stats, one continuous session', async ({
  page,
}) => {
  test.setTimeout(90_000);

  // Deterministic profile (default rules from withProfile()) + settings that
  // keep the Table leg from stalling on an unrelated modal (countCheckEvery)
  // and keep the Count Drill leg short or fast. Both seeded before the ONE
  // navigation this whole test performs.
  await withProfile(page);
  await withSettings(page, {
    countCheckEvery: 0,
    drill: { countLengthCards: 4, countGroup: 1, countIntervalMs: 300 },
  });
  await page.goto('/?e2e=1');

  // ---------------------------------------------------------------
  // 1. Home
  // ---------------------------------------------------------------
  await expect(page.locator('.home-title')).toHaveText('Blackjack Trainer');
  await expect(page.locator('.home-profile-chip')).toBeVisible();
  for (const label of ['Play', 'Drills', 'Stats', 'Settings']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await shot(page, 'smoke-01-home');

  // ---------------------------------------------------------------
  // 2. Profiles: open editor on the active profile, Cancel, back to Home
  // ---------------------------------------------------------------
  await page.locator('.home-profile-chip').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit Profile');
  await shot(page, 'smoke-02-profile-editor');

  await page.locator('.profile-cancel-btn').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();

  // ---------------------------------------------------------------
  // 3. Settings: toggle Count peek off and back on (leaves state clean),
  //    confirm the Audio section (Test audio button) is present
  // ---------------------------------------------------------------
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Settings');

  const countPeekToggle = page
    .locator('.settings-toggle-row', { hasText: 'Count peek' })
    .locator('input.settings-toggle');
  await expect(countPeekToggle).toBeChecked();
  await countPeekToggle.click();
  await expect(countPeekToggle).not.toBeChecked();
  await countPeekToggle.click();
  await expect(countPeekToggle).toBeChecked();

  await expect(page.locator('.settings-test-audio-btn')).toBeVisible();
  await shot(page, 'smoke-03-settings');

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();

  // ---------------------------------------------------------------
  // 4. Table: Deal, play the round by advice, assert a result, End -> Home
  // ---------------------------------------------------------------
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();

  await playRoundByAdvice(page);
  await expect(page.locator('.message-strip .message-result').first()).toBeVisible();
  await shot(page, 'smoke-04-table-result');

  await page.locator('.end-btn').click();
  await expect(page.locator('.home-title')).toBeVisible();

  // ---------------------------------------------------------------
  // 5. Drills -> Count Drill: short run, submit via NumPad, assert result
  // ---------------------------------------------------------------
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await expect(page.locator('.drills-title')).toHaveText('Drills');
  await shot(page, 'smoke-05-drills-picker');

  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await shot(page, 'smoke-06-count-drill-result');

  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();

  // ---------------------------------------------------------------
  // 6. Drills -> True Count Drill: Start, submit, assert result
  // ---------------------------------------------------------------
  await page.getByRole('button', { name: 'True Count Drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.locator('.numpad')).toBeVisible();
  await page.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await shot(page, 'smoke-07-true-count-result');

  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();

  // ---------------------------------------------------------------
  // 7. Drills -> Deck Estimation: Start, guess, assert result
  // ---------------------------------------------------------------
  await page.getByRole('button', { name: 'Deck Estimation', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.locator('.deck-guess-grid')).toBeVisible();
  await page.locator('.deck-guess-btn').first().click();

  await expect(page.locator('.drill-result')).toBeVisible();
  await shot(page, 'smoke-08-deck-estimation-result');

  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();

  // ---------------------------------------------------------------
  // 8. Drills -> Flashcards: answer, feedback, Next
  // ---------------------------------------------------------------
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');

  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  await expect(page.locator('.feedback-cell')).toBeVisible();
  await shot(page, 'smoke-09-flashcards-feedback');

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.feedback-cell')).not.toBeVisible();

  await page.locator('.drill-back-btn', { hasText: 'Back' }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();

  // ---------------------------------------------------------------
  // 9. Drills -> Deviation Quiz: answer (Decline-insurance or Stand,
  //    conditional -- mirrors drills.spec.ts's own quiz specs), assert label,
  //    back to Home
  // ---------------------------------------------------------------
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Deviation Quiz');

  const insurancePrompt = page.locator('.quiz-insurance-prompt');
  if (await insurancePrompt.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Decline Insurance', exact: true }).click();
  } else {
    await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  }

  const quizLabel = page.locator('.quiz-label');
  await expect(quizLabel).toBeVisible();
  await expect(quizLabel).not.toHaveText('');
  await shot(page, 'smoke-10-quiz-feedback');

  await page.locator('.drill-back-btn', { hasText: 'Back' }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();

  // ---------------------------------------------------------------
  // 10. Stats: heading, the Table session, at least one drill history
  //     section rendered on screen
  // ---------------------------------------------------------------
  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await expect(page.locator('.stats-heading')).toHaveText('Stats');
  await expect(page.locator('.session-row')).not.toHaveCount(0);
  await expect(page.locator('.count-history-row').first()).toBeVisible();
  await shot(page, 'smoke-11-stats');

  // -----------------------------------------------------------------
  // TIE-TOGETHER ASSERTION: every mode walked above didn't just mount --
  // it wrote through to persistence in this ONE continuous session. This
  // is the actual point of the smoke test: a session from Table, a
  // countDrill entry, a trueCount entry, a deckEstimation entry, and
  // latencyHistory entries from Flashcards + the Deviation Quiz.
  // -----------------------------------------------------------------
  const stats = await readStats(page);
  expect(stats).not.toBeNull();

  const sessions = (stats?.sessions as unknown[] | undefined) ?? [];
  expect(sessions.length).toBeGreaterThanOrEqual(1);

  const countDrillHistory = (stats?.countDrill as { history: unknown[] } | undefined)?.history ?? [];
  expect(countDrillHistory.length).toBeGreaterThanOrEqual(1);

  const trueCountHistory = (stats?.trueCount as { history: unknown[] } | undefined)?.history ?? [];
  expect(trueCountHistory.length).toBeGreaterThanOrEqual(1);

  const deckEstimationHistory = (stats?.deckEstimation as { history: unknown[] } | undefined)?.history ?? [];
  expect(deckEstimationHistory.length).toBeGreaterThanOrEqual(1);

  const latencyHistory = (stats?.latencyHistory as unknown[] | undefined) ?? [];
  // Flashcards + the Deviation Quiz both grade through the shared latency
  // capture path, so a full journey leaves at least 2 entries.
  expect(latencyHistory.length).toBeGreaterThanOrEqual(2);
});
