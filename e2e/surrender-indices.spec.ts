import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip, withProfile, withSettings, withStats } from './helpers';

/**
 * RV3. The engine side is covered exhaustively by
 * src/engine/surrenderIndices.test.ts; what unit tests cannot see is the
 * WIRING — the profile flag reaching the surfaces that advise and grade. Every
 * one of those surfaces took `activeProfile.rules` before this feature and
 * still compiles if it keeps doing so, silently ignoring the toggle. So every
 * assertion here runs the same screen with the flag on and off and demands the
 * two differ.
 *
 * Note on what is deliberately NOT asserted: round-tripping the toggle through
 * a reload. `withProfile` installs its blob via addInitScript, which re-runs on
 * every navigation — so a reload restores the SEEDED profile, and such a test
 * would be measuring the helper rather than the app.
 */

const SURRENDER_ROW = '.settings-toggle-row';

/** The chip opens the profiles LIST; the editor is behind that row's Edit. */
async function openProfileEditor(page: Page) {
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit' }).first().click();
}

async function openDeviationQuiz(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills' }).first().click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
}

/** Every index the quiz offers, read off the <select> the drill is driven by. */
function indexOptions(page: Page) {
  return page.locator('.quiz-index-select option');
}

test('the toggle reflects the profile it was given', async ({ page }) => {
  await withProfile(page, { surrenderIndices: false });
  await openProfileEditor(page);
  await expect(
    page.locator(SURRENDER_ROW, { hasText: 'Surrender indices' }).locator('input'),
  ).not.toBeChecked();

  await withProfile(page, { surrenderIndices: true });
  await openProfileEditor(page);
  await expect(
    page.locator(SURRENDER_ROW, { hasText: 'Surrender indices' }).locator('input'),
  ).toBeChecked();
});

test('late surrender off disables the control instead of offering a dead setting', async ({ page }) => {
  await withProfile(page, { rules: { ls: false }, surrenderIndices: true });
  await openProfileEditor(page);

  const row = page.locator(SURRENDER_ROW, { hasText: 'Surrender indices' });
  await expect(row.locator('input')).toBeDisabled();
  // ...and it reads as off, rather than a checked box that does nothing.
  await expect(row.locator('input')).not.toBeChecked();
  await expect(page.getByText(/Needs late surrender/)).toBeVisible();
});

test('the quiz index list grows by the Fab 4 only when the flag is on', async ({ page }) => {
  await withProfile(page, { surrenderIndices: false });
  await openDeviationQuiz(page);
  // Wave A (s03): the picker names the hand and the play, not the threshold.
  const off = await indexOptions(page).allTextContents();
  expect(off.filter((t) => /\(surrender\)/.test(t))).toEqual([]);

  await withProfile(page, { surrenderIndices: true });
  await openDeviationQuiz(page);
  const on = await indexOptions(page).allTextContents();
  const surrenders = on.filter((t) => /\(surrender\)/.test(t));

  expect(surrenders).toHaveLength(6);
  expect(surrenders.join(' | ')).toContain('16 v 8 (surrender)');
  expect(surrenders.join(' | ')).toContain('15 v 10 (surrender)');
  expect(on.join(' | ')).not.toContain('TC ≥');
  // The eighteen it already had are all still there.
  expect(on.length).toBe(off.length + 6);
});

test('S17 carries four surrender indices, not the six H17 does', async ({ page }) => {
  await withProfile(page, { surrenderIndices: true, rules: { s17: true } });
  await openDeviationQuiz(page);
  const texts = (await indexOptions(page).allTextContents()).join(' | ');

  // The two cells with no S17 source must be ABSENT, not carried over from H17.
  // (Wave A s03: the picker names hand and play only, so the S17 threshold of
  // 15 v A is no longer readable here; surrenderIndices.test pins its value.)
  expect(texts).not.toContain('16 v 8 (surrender)');
  expect(texts).not.toContain('16 v 9 (surrender)');
  expect(texts).toContain('15 v A (surrender)');
});

/**
 * A1: the Mixed session, with a Fab 4 index pinned.
 *
 * Every other test in this file drives the standalone Deviation Quiz, which
 * threads `strategyRulesFor` correctly. Mixed drew and graded with the bare
 * `activeProfile.rules` while validating the saved filter with the augmented
 * ones -- so `sur15v10` passed the filter, reached a draw whose index set
 * does not contain it, and the resulting throw landed inside a `useState`
 * initialiser. Not a wrong answer on screen: no screen.
 */
test('the Mixed session survives a pinned surrender index', async ({ page }) => {
  await withProfile(page, { surrenderIndices: true });
  await withSettings(page, { drill: { quizIndex: 'sur15v10' } });
  // PINNED TO A SESSION THAT OPENS ON A QUIZ ITEM. The interleave is a
  // seeded coin flip, so an unpinned run opens on a flashcard about half
  // the time and never touches the draw that throws -- the test would then
  // pass on the broken build, roughly every other run. 0.42 gives
  // quiz,quiz,quiz,flash,flash,flash (pinned in src/drills/mixedSession.test.ts).
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills' }).first().click();
  await page.getByRole('button', { name: 'Mixed', exact: true }).click();

  await expect(page.locator('.drill-heading'), 'the Mixed screen never rendered').toHaveText(
    'Mixed',
  );
  // ...and it is a live drill, not an empty shell. In dev the throw shows up
  // as React recovering with a synchronous re-render and an EMPTY screen
  // rather than as the ErrorBoundary, so a heading alone is not evidence
  // that the session works.
  await expect(page.locator('.action-bar'), 'the Mixed screen rendered nothing to answer').toBeVisible();
});

/**
 * A3: the Stats screen counts the indices the profile is graded on.
 *
 * The SR denominator and the Illustrious 18 table both read the bare rules,
 * which cannot carry the flag, so both were frozen at 18 while the quiz drew
 * from 24 and wrote `sur*` keys into the same deck.
 */
test('Stats counts the surrender indices it grades and drills', async ({ page }) => {
  await withProfile(page, { surrenderIndices: true });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Stats' }).first().click();

  // Wave B2 #22 (deliberate change): the table lists the indexes the drills
  // ask, so the inactive H17 '11 v A' row is gone: 17 + the six Fab 4 = 23.
  // E7 (deliberate change): unanswered indexes are one "N not seen yet" line.
  const table = page.getByTestId('play-index-table');
  await expect(table.getByTestId('index-unseen'), 'the six Fab 4 indices are drilled and tallied with no row to show it')
    .toHaveText('23 not seen yet');
});

test('E7: a Fab 4 answer at the table gets its row, in the published wording', async ({ page }) => {
  await withProfile(page, { surrenderIndices: true });
  await withStats(page, { perIndex: { sur15v10: { right: 1, wrong: 0 } }, tablePerIndex: { sur15v10: { right: 1, wrong: 0 } } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Stats' }).first().click();
  const table = page.getByTestId('play-index-table');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('tbody tr')).toContainText('surrender at TC');
  await expect(table.getByTestId('index-unseen')).toHaveText('22 not seen yet');
});

test('the index table is 17 rows with the flag off, so the count is not hardcoded', async ({
  page,
}) => {
  await withProfile(page, { surrenderIndices: false });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Stats' }).first().click();
  // Wave B2 #22: 17, the H17 set the drills ask (11 v A is inactive under H17).
  // E7 (deliberate change): counted on the "not seen yet" line, not as rows.
  await expect(page.getByTestId('play-index-table').getByTestId('index-unseen')).toHaveText('17 not seen yet');
});

/**
 * B2: a button that can never be right.
 *
 * `legalActions.ts` states the invariant -- "an action may only be withheld
 * when it could never be the graded-correct answer". The quiz broke its
 * inverse. Hard index items are asked with surrender UNAVAILABLE, so that
 * basic surrender cannot mask the 16v10 / 15v10 / 16v9 stand indices, and
 * the action bar was built from `rules.ls`, which lights Surrender on every
 * item. On the shipped default profile, 16 v 10 at TC -2: the button is
 * live, the table and the printed chart both say surrender, and the quiz
 * marks surrender a basic-error and teaches "hit a hard 16 versus a ten".
 */
test('the quiz offers no button the grader will refuse', async ({ page }) => {
  await withProfile(page, { surrenderIndices: false });
  await withSettings(page, { drill: { quizIndex: '16v10' } });
  await openDeviationQuiz(page);

  // `ActionBar` renders all five actions and disables the ones that are not
  // legal, which is how every other screen withholds a play -- so "not
  // offered" means disabled here, not absent.
  await expect(page.locator('.action-bar')).toBeVisible();
  await expect(
    page.locator('.action-bar button', { hasText: 'Surrender' }),
    'Surrender is live on an item asked with surrender unavailable',
  ).toBeDisabled();
  // ...and the plays that ARE on offer are still live, so this is not
  // satisfied by an action bar that disabled everything.
  await expect(page.locator('.action-bar button', { hasText: 'Stand' })).toBeEnabled();
});

/**
 * ...and the other direction: a Fab 4 item IS about surrender, so the button
 * has to be there. A fix that simply removed Surrender from the quiz would
 * pass the test above and make the whole RV3 feature unanswerable.
 */
test('a surrender index can still be answered with surrender', async ({ page }) => {
  await withProfile(page, { surrenderIndices: true });
  await withSettings(page, { drill: { quizIndex: 'sur15v10' } });
  await openDeviationQuiz(page);

  await expect(page.locator('.action-bar')).toBeVisible();
  await expect(
    page.locator('.action-bar button', { hasText: 'Surrender' }),
    'the surrender index cannot be answered with surrender',
  ).toBeEnabled();
});

/* ---------------------------------------------------------------------- */
/* F1: the eyes-free pad is the one input with no disabled state           */
/* ---------------------------------------------------------------------- */

async function openEyesFreeQuiz(page: Page, index: string) {
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'results' },
    drill: { quizIndex: index },
  });
  await openDeviationQuiz(page);
  await expect(page.locator('.dealer-area')).toBeVisible();
  await page.getByLabel('Eyes-free audio').check();
  const pad = page.locator('.zone-pad');
  await expect(pad).toBeAttached();
  await expect(page.locator('.zone-pad-quadrants')).toBeVisible();
  return pad;
}

/** The centre circle of the pad is Surrender (ZonePad.tsx). */
async function tapSurrender(page: Page, pad: ReturnType<Page['locator']>) {
  const box = await pad.boundingBox();
  if (!box) throw new Error('ZonePad has no bounding box');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
}

function speech(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__speechLog ?? []);
}

/**
 * The ActionBar disables Surrender on a stand-index item (the test above).
 * The ZonePad cannot disable anything -- it is five invisible zones on the
 * glass -- so the same refusal has to arrive as a SENTENCE. It did not: the
 * pad gated on the table's rules alone, accepted the tap, graded it against
 * an expectation computed with surrender unavailable, said "Wrong", and
 * demoted the card in the review deck.
 */
test('the blind pad refuses what the screen disables, out loud', async ({ page }) => {
  await withProfile(page, { surrenderIndices: true });
  const pad = await openEyesFreeQuiz(page, '16v9');

  await tapSurrender(page, pad);
  await page.waitForFunction(
    () => (window.__speechLog ?? []).some((l) => /Surrender/i.test(l)),
    undefined,
    { timeout: 10_000 },
  );

  const log = await speech(page);
  const joined = log.join(' | ');
  expect(joined, `expected a spoken refusal in ${JSON.stringify(log)}`).toContain(
    "isn't part of this question",
  );
  // ...and it must not tell the operator their own table cannot surrender.
  expect(joined).not.toContain("isn't available on this hand");
  // Nothing was graded: no verdict, no chime, no feedback panel.
  expect(joined).not.toMatch(/Correct\.|Wrong\./);
  // Read once, not retried: a panel that did open auto-advances away within
  // seconds, so a retrying count(0) would wait for it to leave and pass.
  expect(
    await page.locator('.message-strip .result-correct, .message-strip .mistake-card, .message-strip .quiz-label').count(),
    'no correction panel',
  ).toBe(0);
  // And nothing reached Stats or the review deck, which outlive the screen.
  const graded = await page.evaluate(() => ({
    perIndex: JSON.parse(localStorage.getItem('bjtrainer.stats.v1') ?? '{}').perIndex ?? {},
    deck: JSON.parse(localStorage.getItem('bjtrainer.quizsr.v1') ?? '{}'),
  }));
  expect(graded.perIndex['16v9'], 'no Stats row for the refused tap').toBeUndefined();
  expect(graded.deck['16v9'], 'no review-deck entry for the refused tap').toBeUndefined();
});

/**
 * The other half, on the same pad: a Fab 4 item IS about surrender, so the
 * centre circle must grade. A gate that refused surrender everywhere on the
 * pad would satisfy the test above and make the feature unanswerable in the
 * only mode it is used in.
 */
test('the blind pad still takes a surrender that is the answer', async ({ page }) => {
  await withProfile(page, { surrenderIndices: true });
  const pad = await openEyesFreeQuiz(page, 'sur15v10');

  await tapSurrender(page, pad);
  await page.waitForFunction(
    () => (window.__speechLog ?? []).some((l) => /^(Correct\.|Wrong\. )/.test(l)),
    undefined,
    { timeout: 10_000 },
  );

  const joined = (await speech(page)).join(' | ');
  expect(joined).not.toContain("isn't part of this question");
});

/**
 * ...and the MIXED session, which is the one an operator actually runs in
 * the car: it alternates the two drills, and they ask different questions of
 * the same five zones. Its pad had the same single gate.
 */
test('a mixed session gates a quiz item the way the quiz does', async ({ page }) => {
  await withProfile(page, { surrenderIndices: true });
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'results' },
    drill: { quizIndex: '16v9' },
  });
  // Pinned to a session that opens on a QUIZ item -- see the Mixed test
  // above. Unpinned, half the runs open on a flashcard, where surrender is
  // legal and nothing is being tested.
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills' }).first().click();
  await page.getByRole('button', { name: 'Mixed', exact: true }).click();
  // E1 (deliberate change): a flash item shows a TC too, so `.quiz-tc` no
  // longer proves the kind; the spec-only attribute does.
  await expect(page.locator('.drill-screen'), 'this run did not open on a quiz item').toHaveAttribute('data-item-type', 'quiz');

  await page.getByLabel('Eyes-free audio').check();
  const pad = page.locator('.zone-pad');
  await expect(page.locator('.zone-pad-quadrants')).toBeVisible();
  await tapSurrender(page, pad);

  await page.waitForFunction(
    () => (window.__speechLog ?? []).some((l) => /Surrender/i.test(l)),
    undefined,
    { timeout: 10_000 },
  );
  const joined = (await speech(page)).join(' | ');
  expect(joined).toContain("isn't part of this question");
  expect(joined).not.toMatch(/Correct\.|Wrong\./);
  // The speech can only rule out a grade that was spoken. One look at the
  // strip, and the stores every grade writes, as in the quiz-picker test above.
  expect(
    await page.locator('.message-strip .result-correct, .message-strip .mistake-card, .message-strip .quiz-label').count(),
    'no correction panel',
  ).toBe(0);
  const graded = await page.evaluate(() => ({
    perIndex: JSON.parse(localStorage.getItem('bjtrainer.stats.v1') ?? '{}').perIndex ?? {},
    deck: JSON.parse(localStorage.getItem('bjtrainer.quizsr.v1') ?? '{}'),
  }));
  expect(graded.perIndex['16v9'], 'no Stats row for the refused tap').toBeUndefined();
  expect(graded.deck['16v9'], 'no review-deck entry for the refused tap').toBeUndefined();
});

/* ---------------------------------------------------------------------- */
/* Round 6C: the flag outliving the rule, and the index the table overrules */
/* ---------------------------------------------------------------------- */

/**
 * C1. The editor greys the checkbox out when late surrender is off, but that
 * is display only -- nothing rewrites the stored flag, and an imported or
 * hand-edited profile never passed through the editor at all. A profile
 * carrying both therefore listed six surrender indices for a table where
 * surrender cannot be taken, and the grader would have marked one correct.
 */
test('a table with no late surrender is offered no surrender indices', async ({ page }) => {
  await withProfile(page, { surrenderIndices: true, rules: { ls: false } });
  await openDeviationQuiz(page);
  const texts = await indexOptions(page).allTextContents();

  expect(
    texts.filter((t) => /surrender at TC/.test(t)),
    'the Fab 4 were drillable at a table that cannot surrender',
  ).toEqual([]);
  // ...and the eighteen that do not depend on surrender are all still there,
  // so this is a gate and not an outage.
  expect(texts.length).toBeGreaterThan(15);
});

/**
 * C2. The quiz asks every non-surrender index with surrender OFF, so that
 * basic surrender cannot mask the 16/15-vs-high-card STAND cells. At a
 * profile that DOES allow surrender that is a different table from the one
 * the operator plays -- 16 v 9 is a surrender from TC 0 up there, and the
 * stand index does not begin until +4 -- so the drill teaches a play the
 * table penalises. The engine is right; the sentence was missing.
 */
test('an index the operator table overrules says so, and one it does not stays quiet', async ({
  page,
}) => {
  await withProfile(page, { surrenderIndices: true });
  await withSettings(page, { drill: { quizIndex: '16v9' } });
  await openDeviationQuiz(page);
  // B1: the note rides on the result strip of a RIGHT answer (on a miss the
  // chart overlay's own note reconciles the two, see chart-note.spec.ts).
  // Every item is 16 v 9, so cycling the plays finds the right one.
  const plays = ['Hit', 'Stand', 'Double'];
  for (let i = 0; i < 9; i++) {
    const btn = page.locator('.action-bar button.action-btn', { hasText: plays[i % plays.length] });
    if ((await answerAndReadStrip(page, btn)) === 'ok') break;
  }
  await expect(page.locator('[data-testid="result-strip"]')).toHaveAttribute('data-tone', 'ok');

  const note = page.locator('.quiz-table-note');
  await expect(note, 'the quiz taught a play the table overrules, silently').toBeVisible();
  await expect(note).toContainText('surrender');

  // The guard: a cell both tables play the same way must not carry it, or
  // the note is decoration rather than information.
  await withProfile(page, { surrenderIndices: true });
  await withSettings(page, { drill: { quizIndex: '12v3' } });
  await openDeviationQuiz(page);
  await page.locator('.action-bar button.action-btn:not([disabled])').first().click();
  await expect(page.locator('[data-testid="result-strip"]')).toBeVisible();
  await expect(page.locator('.quiz-table-note')).toHaveCount(0);
});

/**
 * #26. "16 v 9 at +4 marked stand, with no surrender signal." The quiz asks
 * a stand index with surrender OFF at a table that offers it, so the prompt
 * has to say so before the answer -- and a Fab 4 item has to say the reverse.
 */
test('the quiz prompt shows the rules it is asked under, before any answer', async ({ page }) => {
  await withProfile(page, { surrenderIndices: true });
  await withSettings(page, { drill: { quizIndex: '16v9' } });
  await openDeviationQuiz(page);
  const chip = page.getByTestId('rules-chip');
  await expect(chip).toHaveText('No surrender');
  await expect(page.locator('[data-testid="result-strip"]')).toHaveCount(0);

  await withProfile(page, { surrenderIndices: true });
  await withSettings(page, { drill: { quizIndex: 'sur15v10' } });
  await openDeviationQuiz(page);
  await expect(chip).toHaveText('Surrender OK');
});
