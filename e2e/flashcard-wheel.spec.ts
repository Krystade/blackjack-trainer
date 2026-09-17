import { test, expect, type Page } from '@playwright/test';
import { withSettings, goHomeAndNavigate } from './helpers';

/**
 * The two wheel buttons, on flashcards.
 *
 * The ask, verbatim (2026-09-16): "i want them both given actually useful uses
 * and uses i can check in flashcards. repeat is useful but yes is not."
 *
 * A flashcard answer is a five-way choice and the wheel has two buttons, so
 * the wheel cannot state a play. What it runs instead is the self-check:
 * forward reveals the right play, then the two buttons say whether you had it.
 * Back, everywhere, repeats -- the one thing that was asked for by name.
 */

async function press(page: Page, command: 'forward' | 'back', times = 1): Promise<void> {
  const handled = await page.evaluate(
    ({ c, n }) => {
      const results: boolean[] = [];
      for (let i = 0; i < n; i++) results.push(window.__wheelPress?.(c) ?? false);
      return results;
    },
    { c: command, n: times },
  );
  // Vacuity guard: an unclaimed wheel is a silent no-op, which is
  // indistinguishable from every assertion below simply not being reached.
  expect(handled).toEqual(Array.from({ length: times }, () => true));
}

function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__speechLog ?? []);
}

async function openFlashcards(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
}

test('forward reveals the right play and asks whether you had it', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openFlashcards(page);

  await expect(page.getByTestId('flash-selfcheck')).toHaveCount(0);
  await press(page, 'forward');

  const banner = page.getByTestId('flash-selfcheck');
  await expect(banner).toBeVisible();
  // The play named on the banner is the one the card is for, not a placeholder.
  await expect(banner.locator('strong')).toHaveText(/Hit|Stand|Double|Split|Surrender/);
  expect((await spoken(page)).join(' | ')).toContain('Had it?');
});

test('"I had it" grades as correct and "I missed it" does not', async ({ page }) => {
  // A long answer pause so the scheduled auto-advance cannot clear a
  // correction while an assertion is still retrying -- "it went away" would
  // otherwise satisfy `toHaveCount(0)` no matter which report was submitted.
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 15000 },
  });
  await openFlashcards(page);

  await press(page, 'forward'); // reveal
  await press(page, 'forward'); // I had it
  await expect(page.locator('.result-correct')).toBeVisible();
  // Graded, not merely displayed: the SR line only exists once the deck was
  // written for this cell.
  await expect(page.locator('.feedback-sr')).toContainText(/Box \d\/5/);

  await page.locator('.drill-next-btn').click();

  await press(page, 'forward'); // reveal
  await press(page, 'back'); // I missed it
  await expect(page.locator('.feedback-cell')).toBeVisible();
  await expect(page.locator('.result-correct')).toHaveCount(0);
});

/**
 * An admitted miss is filed as its own thing.
 *
 * It is not a wrong play -- no play was made -- and recording it as one would
 * put a hand the learner never chose into the mistake taxonomy. Stats is where
 * that becomes visible, so that is where it is checked.
 */
test('an admitted miss is filed apart from wrong plays', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openFlashcards(page);

  await press(page, 'forward');
  await press(page, 'back');
  await expect(page.locator('.feedback-cell')).toBeVisible();

  await goHomeAndNavigate(page, '/?e2e=1', 'Stats');
  await expect(page.locator('.stats-heading')).toHaveText('Stats');

  // Every class is listed whether or not it happened, so the LABEL proves
  // nothing -- the count is the assertion.
  const admitted = page.locator('.mistake-row', { hasText: 'Admitted misses (eyes-free)' });
  await expect(admitted.locator('span').nth(1)).toHaveText('1');
  // And it did not land in the play taxonomy: no play was made.
  const basic = page.locator('.mistake-row', { hasText: 'Basic-strategy errors' });
  await expect(basic.locator('span').nth(1)).toHaveText('0');
});

test('back repeats the hand rather than answering it', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openFlashcards(page);

  const before = (await spoken(page)).length;
  await press(page, 'back');

  // Nothing was graded and nothing was revealed...
  await expect(page.getByTestId('flash-selfcheck')).toHaveCount(0);
  await expect(page.locator('.feedback-cell')).toHaveCount(0);
  // ...but the hand was said again.
  const after = await spoken(page);
  expect(after.length).toBeGreaterThan(before);
  expect(after[after.length - 1]).toMatch(/dealer/i);
});

/**
 * The correction is its own phase, and the auto-advance must not be what
 * proves it. A self-report schedules an advance, so "the correction went away"
 * is true eventually no matter what the buttons do -- the pause is set long
 * here so the only thing that can clear it in time is the forward press, and
 * the back press is checked against the SR line, which a second grade of the
 * same card would move.
 */
test('forward advances off a correction, back repeats it without regrading', async ({ page }) => {
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 15000 },
  });
  await openFlashcards(page);

  await press(page, 'forward');
  await press(page, 'back'); // graded as a miss; a correction is on screen
  await expect(page.locator('.drill-next-btn')).toBeVisible();

  const scheduleBefore = await page.locator('.feedback-sr').innerText();
  const spokenBefore = (await spoken(page)).length;
  await press(page, 'back');
  // Said again...
  expect((await spoken(page)).length).toBeGreaterThan(spokenBefore);
  // ...and nothing else: same correction, same schedule. A second grade would
  // demote the card again and move this line.
  await expect(page.locator('.drill-next-btn')).toBeVisible();
  expect(await page.locator('.feedback-sr').innerText()).toBe(scheduleBefore);

  await press(page, 'forward');
  await expect(page.locator('.drill-next-btn')).toHaveCount(0, { timeout: 2000 });
});

/**
 * Two presses in one tick.
 *
 * A wheel press arrives from outside React, and two can land before a single
 * re-render. Handled from render closures, the second press is served by the
 * state from before the first -- which is how a reveal-then-report became a
 * reveal-then-reveal, and how the count drills' double-press restarted the
 * drill. The phase ref is what makes this pass.
 */
test('a double press reveals and then reports, in one tick', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openFlashcards(page);

  await press(page, 'forward', 2);
  await expect(page.locator('.result-correct')).toBeVisible();
});
