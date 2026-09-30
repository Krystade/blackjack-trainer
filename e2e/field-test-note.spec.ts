import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';
import { FIELD_TEST_STEPS } from '../src/diag/fieldTest';

/**
 * A NOTE, FOR WHAT NO BUTTON SAYS.
 *
 * The answer stack is the record, and it is a fixed vocabulary on purpose --
 * but the first four drives each produced something the vocabulary had no
 * word for, remembered in the car park and lost by the time the log was
 * read. So every step takes a line of free text, written to the log against
 * the step and condition, and it is NOT an answer: it stamps nothing and
 * advances nothing, because a note about a step is not a reading of it.
 */

async function entries(page: Page): Promise<{ event: string; detail: Record<string, unknown> }[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
    return raw
      ? (JSON.parse(raw) as { event: string; detail?: Record<string, unknown> }[]).map((e) => ({
          event: e.event,
          detail: e.detail ?? {},
        }))
      : [];
  });
}

async function openTest(page: Page, condition = 'Car, parked'): Promise<void> {
  await withSettings(page, {});
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  await page.getByRole('button', { name: condition, exact: true }).click();
  const start = page.getByTestId('fieldtest-start');
  await start.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
}

test('a note lands in the log against the step, and is not an answer', async ({ page }) => {
  await openTest(page, 'Freeway');
  // A later step, so a hard-coded step or condition cannot pass.
  await page.getByTestId('fieldtest-skip').click();
  await page.getByTestId('fieldtest-skip').click();
  await page.getByTestId('fieldtest-skip').click();
  const progress = await page.getByTestId('fieldtest-progress').innerText();
  const step = await page.getByTestId('fieldtest-title').getAttribute('data-step');
  expect(step).not.toBe(FIELD_TEST_STEPS[0]!.id);

  const note = page.getByTestId('fieldtest-note');
  await note.fill('sounded like it came from the dash, not the doors');
  await note.press('Enter');

  await expect
    .poll(async () => (await entries(page)).find((e) => e.event === 'note')?.detail, {
      timeout: 5_000,
    })
    .toMatchObject({
      step,
      condition: 'freeway',
      text: 'sounded like it came from the dash, not the doors',
    });
  // ONCE. Enter saved and then blurred, and the blur saved again from the
  // same render, so every note typed with the keyboard landed twice.
  await page.waitForTimeout(1_500);
  expect((await entries(page)).filter((e) => e.event === 'note')).toHaveLength(1);
  // A SAVED NOTE IS NOT A DRAFT ANY MORE. The box is cleared in code, which
  // fires no `onChange`, so nothing else drops the key -- and the boot that
  // finds a draft writes it out as a recovered note, so leaving it there files
  // the same sentence a second time and puts it back in the box for a third.
  expect(
    await page.evaluate(() => localStorage.getItem('bjtrainer.fieldTestDraft.v1')),
    'the saved note is still sitting in the draft key',
  ).toBeNull();
  // Still here, nothing stamped, and the box is ready for another.
  await expect(page.getByTestId('fieldtest-progress')).toHaveText(progress);
  await expect(note).toHaveValue('');
  await expect(page.getByTestId('fieldtest-noted')).toContainText('sounded like it came from');
  expect((await entries(page)).filter((e) => e.event === 'answer')).toHaveLength(0);
});

/**
 * IN STORAGE THE MOMENT IT IS SAVED, not a second later. `diag` buffers for
 * `FLUSH_DELAY_MS`, and the draft key -- the note's only other copy -- is
 * dropped in the same breath as the row is written. A kill inside that second
 * used to take the note out of both places at once, which is the whole failure
 * this draft exists for, reopened at the moment of saving.
 *
 * Read unpolled, deliberately: every other assertion in this file waits, and a
 * wait cannot tell a flush from the flush that was going to happen anyway.
 */
test('a saved note is in storage before anything waits for it', async ({ page }) => {
  await openTest(page);
  const note = page.getByTestId('fieldtest-note');
  await note.fill('in the log or nowhere');
  await note.press('Enter');
  await expect(page.getByTestId('fieldtest-noted')).toBeVisible();

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
    return raw
      ? (JSON.parse(raw) as { event: string; detail?: { text?: string } }[]).filter(
          (e) => e.event === 'note',
        )
      : [];
  });
  expect(stored.map((e) => e.detail?.text)).toEqual(['in the log or nowhere']);
});

test('leaving the box saves it too, and an empty box saves nothing', async ({ page }) => {
  await openTest(page);
  const note = page.getByTestId('fieldtest-note');
  await note.fill('   ');
  await note.press('Enter');
  await note.fill('second try');
  // Blur, as a thumb going to the stack does.
  await page.getByTestId('fieldtest-title').click();

  await expect
    .poll(async () => (await entries(page)).filter((e) => e.event === 'note').map((e) => e.detail.text), {
      timeout: 5_000,
    })
    .toEqual(['second try']);
});

/**
 * PAUSE SAVES THE DRAFT. The screen unmounts on the way to the gate, the
 * cleanup writes what was in the box, and the row carries the run itself
 * because the context that would supply it is torn down by the same exit.
 *
 * TAPPED WITHOUT A BLUR, as iOS taps a button: Playwright's click focuses
 * the button first, which blurred the box and saved through `onBlur` while
 * the context was still up -- so the cleanup found nothing and the test
 * passed with the cleanup, or the explicit `run`, deleted.
 */
test('a draft still in the box when the run is paused is saved, with the run', async ({
  page,
}) => {
  await openTest(page);
  // Past the first step, so the run is resumable and the gate shows Resume.
  await page.getByTestId('fieldtest-skip').click();
  const step = await page.getByTestId('fieldtest-title').getAttribute('data-step');
  await page.getByTestId('fieldtest-note').fill('parked to take a call');
  await page.getByTestId('fieldtest-pause').evaluate((b) => (b as HTMLButtonElement).click());
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-resume')).toBeVisible();

  await expect
    .poll(async () => (await entries(page)).filter((e) => e.event === 'note').length, {
      timeout: 5_000,
    })
    .toBe(1);
  const note = (await entries(page)).find((e) => e.event === 'note')!;
  expect(note.detail).toMatchObject({ step, condition: 'car', text: 'parked to take a call' });
  expect(note.detail.run, 'the note does not say which run it belongs to').toEqual(
    expect.stringMatching(/^[a-z0-9]+$/),
  );
});

/** FINISH SAVES IT TOO, through the same cleanup, after the run has ended. */
test('a draft still in the box when the run is finished is saved, with the run', async ({
  page,
}) => {
  await openTest(page);
  const step = await page.getByTestId('fieldtest-title').getAttribute('data-step');
  await page.getByTestId('fieldtest-note').fill('gave up at the lights');
  const finish = page.getByTestId('fieldtest-finish');
  await finish.evaluate((b) => (b as HTMLButtonElement).click());
  await expect(finish).toHaveText('Tap again to end');
  await finish.evaluate((b) => (b as HTMLButtonElement).click());
  await expect(page.getByTestId('fieldtest-open')).toContainText('Open the field test');

  await expect
    .poll(async () => (await entries(page)).filter((e) => e.event === 'note').length, {
      timeout: 5_000,
    })
    .toBe(1);
  const note = (await entries(page)).find((e) => e.event === 'note')!;
  expect(note.detail).toMatchObject({ step, condition: 'car', text: 'gave up at the lights' });
  expect(note.detail.run, 'the note does not say which run it belongs to').toEqual(
    expect.stringMatching(/^[a-z0-9]+$/),
  );
});

/**
 * A RELOAD IS NOT AN EXIT, AND IT EATS NOTHING. The update check reloads the
 * app by itself, mid-drive; no cleanup runs, so the draft was simply gone.
 * It is written to storage on every keystroke.
 *
 * SAVED AT THE GATE, BEFORE ANYTHING IS RESUMED. That is the whole point: the
 * export taken in the car park without resuming is when the note is read, and
 * written from the running screen it would not be in it.
 */
test('a draft is written out as a note on the boot that finds it', async ({ page }) => {
  await openTest(page);
  await page.getByTestId('fieldtest-skip').click();
  const step = await page.getByTestId('fieldtest-title').getAttribute('data-step');
  await page.getByTestId('fieldtest-note').fill('truck went past mid-line');

  await page.reload();
  // The gate, and nothing tapped on it.
  await expect(page.getByTestId('fieldtest-resume')).toBeVisible();
  await expect
    .poll(
      async () =>
        (await entries(page))
          .filter((e) => e.event === 'note')
          .map((e) => ({ step: e.detail.step, text: e.detail.text, recovered: e.detail.recovered })),
      { timeout: 5_000 },
    )
    .toEqual([{ step, text: 'truck went past mid-line', recovered: true }]);
});

/**
 * ...AND THE BOX COMES BACK AS IT WAS LEFT, so the operator finishes the
 * sentence rather than starting it again. What they then type is saved on the
 * way out as its own note; the recovered row above is the partial one.
 */
test('the box comes back filled, and finishing the sentence writes one more note', async ({
  page,
}) => {
  await openTest(page);
  await page.getByTestId('fieldtest-skip').click();
  const step = await page.getByTestId('fieldtest-title').getAttribute('data-step');
  await page.getByTestId('fieldtest-note').fill('truck went past');

  await page.reload();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  await page.getByTestId('fieldtest-resume').click();
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', step!);
  await expect(page.getByTestId('fieldtest-note')).toHaveValue('truck went past');

  // NOTHING WRITTEN BY ARRIVING. The restored text is already a recovered
  // row; saving the box again on the way in would file it twice, which is
  // what React's development double-mount used to do here.
  expect(
    (await entries(page)).filter((e) => e.event === 'note' && e.detail.recovered !== true),
  ).toHaveLength(0);

  await page.getByTestId('fieldtest-note').fill('truck went past mid-line');
  await page.getByTestId('fieldtest-skip').click();
  await expect
    .poll(
      async () =>
        (await entries(page))
          .filter((e) => e.event === 'note' && e.detail.recovered !== true)
          .map((e) => ({ step: e.detail.step, text: e.detail.text })),
      { timeout: 5_000 },
    )
    .toEqual([{ step, text: 'truck went past mid-line' }]);
});

/**
 * A DRAFT FROM A RUN THAT IS OVER DOES NOT OPEN THE NEXT ONE'S BOX. `car`
 * twice over is two legs at the same step under the same condition, so the
 * step and the condition cannot tell them apart -- only the run id can, and
 * without it leg 2 opened holding leg 1's text and filed it as leg 2's note.
 */
test('a draft from the previous run does not come back in the next run\u2019s box', async ({
  page,
}) => {
  await openTest(page);
  const step = await page.getByTestId('fieldtest-title').getAttribute('data-step');
  await page.getByTestId('fieldtest-note').fill('this belongs to the leg that died');

  // The page dies on step one, so the app comes back to the tab bar rather
  // than to the run: walked in by hand, which is what the operator does.
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  // A new run: same condition, same first step, different run id.
  const start = page.getByTestId('fieldtest-start');
  await start.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', step!);

  await expect(page.getByTestId('fieldtest-note')).toHaveValue('');
  // It is not lost -- it is in the log, against the run it was typed in.
  const recovered = (await entries(page)).filter(
    (e) => e.event === 'note' && e.detail.recovered === true,
  );
  expect(recovered).toHaveLength(1);
  expect(recovered[0]!.detail.text).toBe('this belongs to the leg that died');
});

/**
 * A DRAFT WHOSE STEP THE RUN NO LONGER SITS ON is still evidence about the
 * step it was typed on, and there is no box to put it back in. The condition
 * picker sits beside Resume: a leg re-opened as one with no Bluetooth has no
 * wheel steps, so a run interrupted on `wheel-with-mic` comes back further on.
 */
test('a draft left on a step the run no longer sits on is recovered as a note', async ({ page }) => {
  test.setTimeout(90_000);
  await openTest(page);
  const title = page.getByTestId('fieldtest-title');
  for (let i = 0; i < FIELD_TEST_STEPS.length + 2; i += 1) {
    if ((await title.getAttribute('data-step')) === 'wheel-with-mic') break;
    await page.getByTestId('fieldtest-skip').click();
  }
  await expect(title).toHaveAttribute('data-step', 'wheel-with-mic');
  await page.getByTestId('fieldtest-note').fill('the wheel did nothing at all here');

  // The page dies, and the leg is re-opened with no Bluetooth: the pointer
  // snaps off the wheel step it was left on.
  await page.reload();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Speakerphone', exact: true }).click();
  await page.getByTestId('fieldtest-resume').click();
  await expect(title).not.toHaveAttribute('data-step', 'wheel-with-mic');

  await expect
    .poll(
      async () =>
        (await entries(page))
          .filter((e) => e.event === 'note' && e.detail.recovered === true)
          .map((e) => ({ step: e.detail.step, text: e.detail.text, condition: e.detail.condition })),
      { timeout: 5_000 },
    )
    .toEqual([
      {
        step: 'wheel-with-mic',
        text: 'the wheel did nothing at all here',
        // The condition it was typed under, not the one the run carries now.
        condition: 'car',
      },
    ]);
  // The box it does not belong in stayed empty.
  await expect(page.getByTestId('fieldtest-note')).toHaveValue('');
});

/**
 * THE SAME STEP UNDER A DIFFERENT CONDITION IS A DIFFERENT CELL, and the
 * condition half of that check had nothing holding it: the test above has
 * already moved the step, so it misses either way. `car` and `freeway` are
 * both Bluetooth legs, so the pointer does not move between them.
 */
test('a draft is not put back in the same step\u2019s box under another condition', async ({
  page,
}) => {
  await openTest(page);
  await page.getByTestId('fieldtest-skip').click();
  const step = await page.getByTestId('fieldtest-title').getAttribute('data-step');
  await page.getByTestId('fieldtest-note').fill('this was typed in the car park');

  await page.reload();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Freeway', exact: true }).click();
  await page.getByTestId('fieldtest-resume').click();
  // Same step, other condition.
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', step!);

  await expect(page.getByTestId('fieldtest-note')).toHaveValue('');
  await expect
    .poll(
      async () =>
        (await entries(page))
          .filter((e) => e.event === 'note' && e.detail.recovered === true)
          .map((e) => ({ step: e.detail.step, condition: e.detail.condition })),
      { timeout: 5_000 },
    )
    .toEqual([{ step, condition: 'car' }]);
});

test('the noted line clears when the step changes', async ({ page }) => {
  await openTest(page);
  const note = page.getByTestId('fieldtest-note');
  await note.fill('about the first step');
  await note.press('Enter');
  await expect(page.getByTestId('fieldtest-noted')).toBeVisible();
  await page.getByTestId('fieldtest-skip').click();
  await expect(page.getByTestId('fieldtest-noted')).toHaveCount(0);
});

/**
 * A DRAFT IS NOT LOST TO THE ANSWER TAP. On the phone the keyboard may still
 * be up when the thumb lands on an answer, and the step moves on before
 * anything blurred the box. Whatever was typed belongs to the step it was
 * typed on, and goes to the log when that step is left.
 */
test('a draft still in the box when the step is answered is saved against that step', async ({
  page,
}) => {
  await openTest(page);
  const step = await page.getByTestId('fieldtest-title').getAttribute('data-step');
  const note = page.getByTestId('fieldtest-note');
  await note.fill('half a thought');

  // The answer is taken without the box ever losing focus, which is what a
  // tap on iOS can do; the focus stays where it was.
  const answers = page.getByTestId('fieldtest-answers').locator('button');
  await expect(answers.first()).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await answers.first().evaluate((b) => (b as HTMLButtonElement).click());
  await expect(page.getByTestId('fieldtest-title')).not.toHaveAttribute('data-step', step!);

  await expect
    .poll(
      async () =>
        (await entries(page))
          .filter((e) => e.event === 'note')
          .map((e) => ({ step: e.detail.step, condition: e.detail.condition, text: e.detail.text })),
      { timeout: 5_000 },
    )
    .toEqual([{ step, condition: 'car', text: 'half a thought' }]);
  await expect(note).toHaveValue('');
});
