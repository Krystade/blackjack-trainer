import { test, expect, type Page } from '@playwright/test';
import { withProfile, withSettings } from './helpers';

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
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
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
  const off = await indexOptions(page).allTextContents();
  expect(off.filter((t) => /surrender at TC/.test(t))).toEqual([]);

  await withProfile(page, { surrenderIndices: true });
  await openDeviationQuiz(page);
  const on = await indexOptions(page).allTextContents();
  const surrenders = on.filter((t) => /surrender at TC/.test(t));

  expect(surrenders).toHaveLength(6);
  expect(surrenders.join(' | ')).toContain('16 v 8: surrender at TC ≥ +4');
  expect(surrenders.join(' | ')).toContain('15 v 10: surrender at TC ≥ 0');
  // The eighteen it already had are all still there.
  expect(on.length).toBe(off.length + 6);
});

test('S17 carries four surrender indices, not the six H17 does', async ({ page }) => {
  await withProfile(page, { surrenderIndices: true, rules: { s17: true } });
  await openDeviationQuiz(page);
  const texts = (await indexOptions(page).allTextContents()).join(' | ');

  // The two cells with no S17 source must be ABSENT, not carried over from H17.
  expect(texts).not.toContain('16 v 8: surrender');
  expect(texts).not.toContain('16 v 9: surrender');
  // And the cell that genuinely moves between rulesets shows its S17 value.
  expect(texts).toContain('15 v A: surrender at TC ≥ +1');
  expect(texts).not.toContain('15 v A: surrender at TC ≥ −1');
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

  const rows = page.locator('.index-table tbody tr');
  await expect(rows, 'the six Fab 4 indices are drilled and tallied with no row to show it')
    .toHaveCount(24);
  await expect(page.locator('.index-table')).toContainText('15 v 10: surrender at TC');
});

test('the index table is 18 rows with the flag off, so the count is not hardcoded', async ({
  page,
}) => {
  await withProfile(page, { surrenderIndices: false });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Stats' }).first().click();
  await expect(page.locator('.index-table tbody tr')).toHaveCount(18);
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
