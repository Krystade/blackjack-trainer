import { test, expect, type Page } from '@playwright/test';
import { withSettings, selectFieldTestCondition} from './helpers';
import { FIELD_TEST_STEPS } from '../src/diag/fieldTest';

/**
 * Round five: what the fifth pass of reviewers found, pinned.
 *
 * Every test here corresponds to a finding that survived four rounds. Several
 * of them are about the log rather than the screen, because the log IS the
 * artefact -- a protocol whose export cannot be read is a drive spent for
 * nothing.
 */

async function openTest(page: Page, condition: string): Promise<void> {
  await withSettings(page, {});
  await selectFieldTestCondition(page, condition);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('settings-testkit-open').click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  const start = page.getByTestId('fieldtest-start');
  await start.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
}

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

async function waitForEntry(
  page: Page,
  match: (e: { event: string; detail: Record<string, unknown> }) => boolean,
  what: string,
): Promise<{ event: string; detail: Record<string, unknown> }> {
  await expect.poll(async () => (await entries(page)).some(match), { timeout: 20_000 }).toBe(true);
  const found = (await entries(page)).find(match);
  expect(found, what).toBeTruthy();
  return found!;
}

async function goToStep(page: Page, id: string): Promise<void> {
  const want = FIELD_TEST_STEPS.find((s) => s.id === id);
  expect(want, `${id} is not in the protocol`).toBeTruthy();
  const title = page.getByTestId('fieldtest-title');
  for (let i = 0; i <= FIELD_TEST_STEPS.length; i++) {
    if ((await title.innerText()) === want!.title) return;
    await page.getByTestId('fieldtest-skip').click();
  }
  throw new Error(`never reached ${id}`);
}

const speechLog = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window.__speechLog ?? []).map(String));

/* ---------------------------------------------------------------------- */
/* F2 -- the acoustic run-up was correlated with the independent variable  */
/* ---------------------------------------------------------------------- */

/**
 * Only the gated steps chimed on arrival, and only the gated steps then sat
 * through 1500ms of silence before speaking -- and every gated step is a
 * post-microphone or mic-open sample. So the cells of the 2x2 differed in the
 * number of Web Audio activations before the sample and in the length of the
 * silence before it, both perfectly correlated with the factor under test. A
 * route answer is a judgement about a sound in a stream of sounds.
 */
test('every measured sample gets the same run-up: a chime, then a fixed silence', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openTest(page, 'Car, parked');

  // route-1 is the first sample of the run and has no gate of any kind: it
  // was the one utterance in the protocol with no audio before it at all.
  await waitForEntry(
    page,
    (e) => e.event === 'pre-sample-settle' && e.detail.step === 'route-1',
    'the first sample of the run still has no settle before it',
  );
  // WAIT FOR THE LINE BEFORE READING THE ORDER. The log buffers and flushes
  // on a timer, so a read taken the moment the settle appears finds the log
  // as it was before the utterance -- and the ordering assertion below would
  // then fail with a message about the settle rather than about the wait.
  await waitForEntry(
    page,
    (e) => e.event === 'say-start' && e.detail.step === 'route-1',
    'the first sample never spoke at all',
  );
  const all = await entries(page);
  const settleAt = all.findIndex((e) => e.event === 'pre-sample-settle');
  const chimeAt = all.findIndex((e) => e.event === 'chime');
  const spokeAt = all.findIndex((e) => e.event === 'say-start' && e.detail.step === 'route-1');
  expect(chimeAt, 'the step arrived in silence').toBeGreaterThanOrEqual(0);
  expect(chimeAt, 'the chime came after the settle rather than before it').toBeLessThan(settleAt);
  expect(spokeAt, 'the line went out before the settle').toBeGreaterThan(settleAt);

  // ...AND IT IS THE SAME NUMBER the post-microphone gate waits, or the two
  // halves of the crossing are still not comparable.
  const settleMs = Number(all[settleAt]!.detail.settleMs);
  expect(settleMs, 'the pre-sample settle is not a real wait').toBeGreaterThan(500);

  const stopped = await waitForEntryFromStep(page, 'route-after-mic');
  expect(
    Number(stopped.detail.settleMs),
    'the gated samples and the ungated ones wait different amounts, so the cells are not comparable',
  ).toBe(settleMs);
});

async function waitForEntryFromStep(
  page: Page,
  step: string,
): Promise<{ event: string; detail: Record<string, unknown> }> {
  await goToStep(page, step);
  return waitForEntry(
    page,
    (e) => (e.event === 'mic-stopped' || e.event === 'mic-still-live') && e.detail.step === step,
    `${step} never reported its settle`,
  );
}

/**
 * ...and a chime is in the log, which it never was.
 *
 * The only line `chime()` wrote was `chime-suspended`, so the app's own
 * sounds appeared in the export exactly when they FAILED. A chime is an audio
 * session event on iOS, and this protocol measures where an audio session
 * sends things.
 */
test('the app records the sounds it makes, not only the ones it fails to make', async ({
  page,
}) => {
  await openTest(page, 'Car, parked');
  const chimed = await waitForEntry(
    page,
    (e) => e.event === 'chime',
    'the app made no sound the log knows about',
  );
  expect(chimed.detail.kind, 'a chime is logged without saying which one').toBeTruthy();
  expect(chimed.detail.step, 'a chime is logged without saying where in the run').toBeTruthy();
});

/* ---------------------------------------------------------------------- */
/* L2 -- a silent step inherited the previous step's microphone offset     */
/* ---------------------------------------------------------------------- */

/**
 * The reset sat BELOW the `lines.length === 0` early return, so it never ran
 * on a step with no line, and the step effect did not clear it either. So
 * `wheel-after-mic` -- the step added specifically to separate "the
 * microphone took the wheel" from "the media slot lapsed" -- exported the
 * offset of `route-after-mic-3`, measured however long the operator spent
 * answering in between, on the row `grep answer=` assembles the 2x2 from.
 */
/*
 * L2's test lived here and has moved to `field-test-mic.spec.ts`.
 *
 * It walked to a silent step with Skip and asserted that its answer carried
 * no `msSinceAppLetGo`. Nothing in this project opens a microphone, so that
 * field is undefined on every step of every run -- the assertion held with
 * the fix reverted, and would have held against a build that had never had
 * it. It is now one of three cells in "a restart mid-utterance is not
 * recorded as the microphone letting go", next to a positive one.
 */

/* ---------------------------------------------------------------------- */
/* I3 -- an operator-requested reading filed as an arrival reading         */
/* ---------------------------------------------------------------------- */

test('a reading the operator asked for says so, on the silent steps too', async ({ page }) => {
  await openTest(page, 'Car, parked');
  await goToStep(page, 'wheel-back');
  // The silent steps read their instruction on arrival, so wait for that one
  // to be in the log before asking for another -- otherwise the assertion
  // below could be satisfied by the wrong entry.
  await waitForEntry(
    page,
    (e) => e.event === 'instruction-start' && e.detail.step === 'wheel-back',
    'the silent step never read itself out',
  );
  const again = page.getByTestId('fieldtest-again');
  await expect(again).toHaveText('Read it to me');
  await expect(again).toBeEnabled();
  await again.click();

  await expect
    .poll(
      async () =>
        (await entries(page)).filter(
          (e) =>
            e.event === 'instruction-start' &&
            e.detail.step === 'wheel-back' &&
            e.detail.why === 'asked',
        ).length,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // ...and exactly one arrival reading, not two. On the four silent WHEEL
  // steps `field-test-arrival whileSpeaking=` is read against this very
  // utterance, so a re-read filed as an arrival makes a press unplaceable.
  const arrivals = (await entries(page)).filter(
    (e) =>
      e.event === 'instruction-start' &&
      e.detail.step === 'wheel-back' &&
      e.detail.why === 'arrival',
  );
  expect(
    arrivals.length,
    'an operator-requested re-read is recorded as an automatic arrival reading',
  ).toBe(1);
});

/* ---------------------------------------------------------------------- */
/* I4 -- Finish handed the settings back twice                            */
/* ---------------------------------------------------------------------- */

test('finishing hands the settings back exactly once', async ({ page }) => {
  await openTest(page, 'Car, parked');
  // Finish is the commonest exit and the only one that writes `run-end`; the
  // test that pinned "exactly one restore" ran through Pause, which is the
  // one path where it already held.
  const finish = page.getByTestId('fieldtest-finish');
  await finish.click();
  await expect(finish).toHaveText('Tap again to end');
  await finish.click();
  await expect(page.getByTestId('fieldtest-open')).toBeVisible();

  await waitForEntry(page, (e) => e.event === 'run-end', 'the run never ended');
  // A moment for the deferred teardown to fire and flush.
  await page.waitForTimeout(1500);
  const restores = (await entries(page)).filter((e) => e.event === 'settings-restored');
  expect(
    restores.length,
    `the settings were handed back ${restores.length} times on the commonest exit in the protocol`,
  ).toBe(1);
});

/* ---------------------------------------------------------------------- */
/* I2 -- a finished run read as a paused one, to three separate readers    */
/* ---------------------------------------------------------------------- */

test('a run the operator ended does not own the next launch', async ({ page }) => {
  await openTest(page, 'Car, parked');
  // Past step one, so `stepIndex > 0` -- which is all `fieldTestRunIsResumable`
  // used to ask.
  await page.getByTestId('fieldtest-skip').click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
  const finish = page.getByTestId('fieldtest-finish');
  await finish.click();
  await finish.click();
  await expect(page.getByTestId('fieldtest-open')).toBeVisible();

  await page.evaluate(() => {
    window.__speechLog = [];
  });
  await page.goto('/?e2e=1');
  // The app used to open straight onto the field-test gate on every launch
  // for two hours after a completed run, and the gate then chimed and said
  // "The field test is paused. Resume is the first button on the screen" --
  // out loud, about a run the operator had ended on purpose.
  await expect(
    page.getByTestId('fieldtest-screen'),
    'a finished run still hijacks the opening screen',
  ).toHaveCount(0);
  const said = await speechLog(page);
  expect(said.join(' | '), 'the app says a finished run is paused').not.toContain('paused');
});

test('a run that was paused still does', async ({ page }) => {
  // The control. Pausing is the case the launch screen and the spoken cue
  // exist for, and the fix above must not take it away.
  await openTest(page, 'Car, parked');
  await page.getByTestId('fieldtest-skip').click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
  await page.getByTestId('fieldtest-pause').click();

  await page.goto('/?e2e=1');
  await expect(
    page.getByTestId('fieldtest-screen'),
    'an interrupted run no longer comes back',
  ).toBeVisible();
  await expect
    .poll(async () => (await speechLog(page)).join(' | '), { timeout: 10_000 })
    .toContain('paused');
});

/* ---------------------------------------------------------------------- */
/* I6 -- the two-tap guards stayed armed indefinitely                      */
/* ---------------------------------------------------------------------- */

test('an armed Finish disarms itself', async ({ page }) => {
  test.setTimeout(60_000);
  await openTest(page, 'Car, parked');
  const finish = page.getByTestId('fieldtest-finish');
  await finish.click();
  await expect(finish).toHaveText('Tap again to end');
  // Two ordinary actions never change the step -- tapping a modifier answer,
  // and answering on the last step, which by design does not advance -- and
  // the step effect was the only thing that disarmed this. A Finish armed by
  // a stray tap survived any number of later taps.
  await expect(finish, 'the guard stays armed for as long as the step is open').toHaveText(
    'Finish',
    { timeout: 15_000 },
  );
});

/* ---------------------------------------------------------------------- */
/* E3 / E4 -- arming and refusal were inaudible                            */
/* ---------------------------------------------------------------------- */

test('arming a mark sounds different from answering', async ({ page }) => {
  test.setTimeout(60_000);
  await openTest(page, 'Car, parked');
  // route-1 offers `route-moved`, the modifier on every route step.
  await expect(page.getByTestId('fieldtest-answer-route-moved')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('fieldtest-answer-route-moved')).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.__speechLog = [];
  });
  await page.getByTestId('fieldtest-answer-route-moved').click();
  const afterMark = await speechLog(page);
  expect(afterMark, 'arming a mark makes no sound of its own').toContain('chime:mark');
  // ...and the step did NOT advance, which is what the sound has to convey.
  await expect(page.getByTestId('fieldtest-marks')).toBeVisible();

  await page.evaluate(() => {
    window.__speechLog = [];
  });
  await page.getByTestId('fieldtest-answer-route-car').click();
  const afterAnswer = await speechLog(page);
  expect(
    afterAnswer.filter((s) => s.startsWith('chime:')),
    'answering sounds exactly like arming, so the operator cannot hear whether the step moved on',
  ).not.toContain('chime:mark');
});

test('a tap the screen throws away is audible', async ({ page }) => {
  test.setTimeout(60_000);
  await openTest(page, 'Car, parked');
  // THE STEP BEFORE A SILENT ONE, not step one. The bounce guard is the 350ms
  // after a step opens; on a step that has a line, the answers are held by
  // `still-speaking` for longer than that, so a tap there is refused for a
  // DIFFERENT reason (`answer-blocked`) and never reaches the guard at all.
  // `wheel-back` declares no line, so its answers are live the moment it
  // opens, and the only thing that can refuse a tap on it is the guard.
  await goToStep(page, 'wheel-gap');
  await page.evaluate(() => {
    window.__speechLog = [];
  });
  // ONE IN-PAGE STEP, not a Playwright click after the skip: the guard is
  // 350ms wide, and a round trip per action under suite load can be longer
  // than that, which would leave this test tapping after the window. The tap
  // is made 30ms after the step is on screen (past the effect that stamps
  // when it opened, well inside the guard).
  await page.evaluate(async () => {
    const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    q('fieldtest-skip')!.click();
    const deadline = Date.now() + 5000;
    while (q('fieldtest-title')?.getAttribute('data-step') !== 'wheel-back') {
      if (Date.now() > deadline) throw new Error('never reached wheel-back');
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 30));
    q('fieldtest-answers')!.querySelector<HTMLElement>('button')!.click();
  });
  await expect
    .poll(async () => (await speechLog(page)).join(' | '), { timeout: 5_000 })
    .toContain('chime:blocked');
  await waitForEntry(
    page,
    (e) => e.event === 'answer-ignored',
    'the tap was not actually refused, so this proves nothing',
  );
});

