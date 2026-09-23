import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * The field test, end to end.
 *
 * Rewritten twice, and the second rewrite is what these assertions are about.
 * The first real run (2026-09-19) got four steps in and stopped, because the
 * run lived in a screen's React state and every step required leaving that
 * screen. The fix was a floating panel, and after the next drive
 * (2026-09-22) the verdict was: "the field test just sucked ... I didn't even
 * test any buttons ... I don't know why you haven't made the field test its
 * own thing or why we have to go to a drill in the first place."
 *
 * So what has to be true now, and is asserted below:
 *   - it is its own screen, and needs nothing else running;
 *   - it produces its own audio, so a step about sound is not a step about a
 *     drill;
 *   - it offers the wheel steps under a DRIVING condition, which is the
 *     removal the operator objected to;
 *   - it writes the whole run to the log as it happens, not just the taps;
 *   - and the run still survives navigation and reload.
 */

function diagPanel(page: Page) {
  return page
    .locator('details.settings-section')
    .filter({ has: page.locator('summary', { hasText: 'Diagnostic log' }) });
}

async function openTest(page: Page, condition?: string): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  // A run left open by an earlier part of the same spec shows the step, not
  // the condition picker -- the run is persisted on purpose, so reopening
  // resumes rather than restarts. Close it before starting a fresh one.
  if ((await page.getByTestId('fieldtest-finish').count()) > 0) {
    await page.getByTestId('fieldtest-finish').click();
    await page.getByTestId('fieldtest-open').click();
  }
  if (condition) await page.getByRole('button', { name: condition, exact: true }).click();
  await page.getByTestId('fieldtest-start').click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
}

/** How many utterances the app has attempted. Captured, not spoken, under ?e2e=1. */
function saidCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__speechLog?.length ?? 0);
}

async function logText(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  const section = diagPanel(page);
  const show = section.getByRole('button', { name: /^(Show|Hide)$/ });
  if ((await show.innerText()) === 'Show') await show.click();
  return section.locator('pre.car-log').innerText();
}

/** Page through the whole run, collecting the step ids it offers on the way. */
async function stepsOffered(page: Page): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    const answers = page.getByTestId('fieldtest-answers');
    await expect(answers).toBeVisible();
    seen.push(await page.getByTestId('fieldtest-title').innerText());
    const skip = page.getByTestId('fieldtest-skip');
    if (await skip.isDisabled()) break;
    await skip.click();
  }
  return seen;
}

test('it is its own screen, reached without going near a drill', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page);

  // A step, its instruction and something to tap — all on one screen, with no
  // drill mounted underneath it.
  await expect(page.getByTestId('fieldtest-instruction')).toBeVisible();
  await expect(page.getByTestId('fieldtest-answers').locator('button').first()).toBeVisible();
  await expect(page.locator('.flashcard, .table-felt')).toHaveCount(0);
});

/**
 * THE PREMISE OF THE REWRITE. The old protocol had no voice, so every step
 * said "start a drill and listen" -- which is why two drives produced logs
 * full of flashcard grading and no usable evidence. Under ?e2e=1 speech is
 * captured rather than spoken, so this reads what the screen tried to say.
 */
test('it speaks its own line when a step opens, with nothing else running', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page);

  await expect.poll(() => saidCount(page), { timeout: 5000 }).toBeGreaterThan(0);

  const spoken = await page.evaluate(() => window.__speechLog ?? []);
  // Not any utterance -- the exact line this step declares, which is also a
  // line that has a recorded clip (pinned in fieldTest.test.ts).
  expect(spoken).toContain('Basic hit versus dealer nine.');
});

test('it will say the line again, because a line missed in traffic is a step wasted', async ({
  page,
}) => {
  await withSettings(page, {});
  await openTest(page);
  await expect.poll(() => saidCount(page), { timeout: 5000 }).toBeGreaterThan(0);
  // Measured as an INCREASE rather than against a fixed count: StrictMode
  // double-invokes effects in dev, so the opening line lands once in a
  // production build and twice here. What the button has to do -- say it one
  // more time, on demand -- is the same number either way.
  const before = await saidCount(page);

  await page.getByTestId('fieldtest-again').click();

  await expect.poll(() => saidCount(page), { timeout: 5000 }).toBe(before + 1);
});

/**
 * THE REGRESSION GUARD FOR THE REMOVAL THE OPERATOR OBJECTED TO. When the
 * runs were split I filtered every wheel step into the parked run, so a
 * freeway run offered none: "I never said I wanted to completely drop using
 * the buttons so I don't know why they were removed from the field test."
 *
 * Asserted by paging through the ENTIRE driving run, not by looking at the
 * first screen -- a filter that dropped only the later wheel steps would pass
 * a check made at the start.
 */
test('a driving run offers the wheel steps, all of them', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Freeway');

  const titles = (await stepsOffered(page)).join(' | ');
  expect(titles).toContain('The wheel, while it is talking');
  expect(titles).toContain('The wheel, in the silence');
  expect(titles).toContain('Skip-back');
  expect(titles).toContain('The wheel, with the microphone open');
});

/** ...and the parked run is the same list, since there is no filter any more. */
test('a parked run offers exactly what the driving run does', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Freeway');
  const driving = await stepsOffered(page);

  await openTest(page, 'Car, parked');
  const parked = await stepsOffered(page);

  expect(parked).toEqual(driving);
  expect(parked.length).toBeGreaterThan(8);
});

/**
 * "I need it to record in the logs everything about the test as it happens."
 * The old protocol wrote only the taps, so a run read back as a list of
 * opinions with no record of what the app did between them.
 */
test('the whole run reaches the log, not just the taps', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page);

  await page.getByTestId('fieldtest-answer-route-earpiece').click();

  const text = await logText(page);
  expect(text).toContain('run-start');
  expect(text).toContain('step-open');
  // What the app said, and which path said it -- the pairing that makes a
  // route answer mean anything.
  expect(text).toContain('say-start');
  // And the answer itself, carrying the condition it was given under.
  expect(text).toContain('route-earpiece');
  expect(text).toContain('condition=car');
});

test('switching condition changes what is recorded, not just what is shown', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Speakerphone');

  await page.getByTestId('fieldtest-answer-route-car').click();

  const text = await logText(page);
  expect(text).toContain('condition=speakerphone');
  expect(text).not.toContain('condition=car ');
});

/**
 * Answering advances. A protocol that needed one tap to record and another to
 * move on gets half as far per red light, and the first two runs both stalled
 * partway.
 */
test('answering a step moves to the next one', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page);
  await expect(page.getByTestId('fieldtest-progress')).toContainText('step 1 of');

  await page.getByTestId('fieldtest-answer-route-car').click();

  await expect(page.getByTestId('fieldtest-progress')).toContainText('step 2 of');
});

/**
 * "Can't have to go back and forth and have it reset all progress."
 * The run lives outside React, so leaving the screen costs nothing.
 */
test('the run survives leaving the screen', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page);
  await page.getByTestId('fieldtest-answer-route-car').click();
  await expect(page.getByTestId('fieldtest-progress')).toContainText('step 2 of');

  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();

  await expect(page.getByTestId('fieldtest-progress')).toContainText('step 2 of');
});

test('the run is still there after a reload, which the update check can force mid-drive', async ({
  page,
}) => {
  await withSettings(page, {});
  await openTest(page);
  await page.getByTestId('fieldtest-answer-route-car').click();

  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();

  await expect(page.getByTestId('fieldtest-progress')).toContainText('step 2 of');
});

/**
 * "I need it to set the settings." A step that only DESCRIBES what it needs
 * gets run under whatever was already there, and the log cannot tell the two
 * apart afterwards.
 */
test('opening a step puts the app into the state that step needs', async ({ page }) => {
  // Start from the state a wheel step cannot survive: no audio, no recorded
  // voice (so no media element for the car to attach to), and muted.
  await withSettings(page, {
    audio: { enabled: false, useClips: false, muted: true },
    drill: { wheelMode: 'talk' },
  });
  await openTest(page);

  // Not just said -- done. Read it off the controls that own those settings.
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.getByLabel('Audio enabled')).toBeChecked();
  await expect(page.getByLabel('Use recorded voice (higher quality)')).toBeChecked();
});

test('finishing puts the test away and says so in the log', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page);

  await page.getByTestId('fieldtest-finish').click();

  // Back on Settings, with the run closed rather than merely hidden.
  await expect(page.getByTestId('fieldtest-open')).toContainText('Open the field test');
  const text = await logText(page);
  expect(text).toContain('run-end');
});
