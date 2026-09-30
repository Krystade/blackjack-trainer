import { test, expect, type Page } from '@playwright/test';
import { selectFieldTestCondition, withSettings } from './helpers';
import { FIELD_TEST_STEPS } from '../src/diag/fieldTest';

/**
 * ANSWERING THE PROTOCOL OUT LOUD.
 *
 * `fieldTestVoice.test.ts` proves the vocabulary: no phrase means two things
 * on one step, every answer has something to say, and no step's own spoken
 * line contains one of its answers. None of that is evidence that a word
 * said in the car reaches `stampFieldTest` -- which is the whole feature, and
 * which lives in the wiring between `useVoiceControl`, the step's offered
 * answers and the same `answer()` funnel the buttons use.
 *
 * Every test here therefore drives the real screen with a fake recognition
 * engine and reads the DIAGNOSTIC LOG, not the DOM: the log is what the drive
 * produces and what the analysis is read from, so an answer that lights the
 * screen and writes nothing is the failure worth catching.
 */

interface FakeRec {
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

async function withFakeEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;

      constructor() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }
      start(): void {
        setTimeout(() => this.onstart?.(), 0);
      }
      stop(): void {
        setTimeout(() => this.onend?.(), 0);
      }
      abort(): void {
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
}

/** Feed the app a transcript, as the engine would. */
async function hear(page: Page, transcript: string): Promise<void> {
  await page.evaluate((text) => {
    const rec = (window as unknown as { __rec?: FakeRec }).__rec;
    rec?.onresult?.({ results: [[{ transcript: text }]] });
  }, transcript);
}

/** Every diagnostic entry, straight out of storage, without leaving the run. */
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

async function answersIn(page: Page) {
  return (await entries(page)).filter((e) => e.event === 'answer');
}

/**
 * Open the field test, optionally with the spoken channel armed BEFORE the
 * run starts -- which is where the switch lives, and deliberately so.
 */
async function openTest(page: Page, { byVoice }: { byVoice: boolean }): Promise<void> {
  await withFakeEngine(page);
  await withSettings(page, {});
  // The routing protocol, named rather than inherited. This spec walks to
  // `route-1`/`mic-route`/`mic-heard`, which are routing steps: the gate's
  // default is the drill leg now, and `onPath` drops a step whose protocol
  // is not the condition's, so inheriting the default would walk past the
  // end of the protocol looking for a step that is never rendered.
  await selectFieldTestCondition(page, 'Car, parked');
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();

  const toggle = page.getByTestId('fieldtest-answer-by-voice');
  await expect(toggle, 'the switch is not on the screen it is decided from').toBeVisible();
  if (byVoice) await toggle.check();

  const start = page.getByTestId('fieldtest-start');
  await start.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
}

/** Skip forward to a step, by id, using the protocol as the map. */
async function goToStep(page: Page, id: string): Promise<void> {
  const want = FIELD_TEST_STEPS.find((s) => s.id === id);
  expect(want, `${id} is not in the protocol`).toBeTruthy();
  const title = page.getByTestId('fieldtest-title');
  for (let i = 0; i < FIELD_TEST_STEPS.length + 2; i++) {
    if ((await title.innerText()) === want!.title) return;
    await page.getByTestId('fieldtest-skip').click();
  }
  throw new Error(`never reached ${id}`);
}

/**
 * Say something until the app is actually listening to it.
 *
 * The recogniser deafens itself for the length of every line the app speaks
 * plus a tail, and a transcript arriving inside that window is dropped as
 * the app hearing itself -- measured here, 470ms was still outstanding a
 * full second after `say-end`. That is real behaviour and the operator
 * meets it too: answer the instant the line stops and the answer is
 * swallowed. (It is no longer swallowed SILENTLY -- see `isAttempt` in
 * FieldTest.tsx -- but it is still swallowed.)
 *
 * So the test repeats, as a person does, and asserts on what the app did
 * with the utterance it finally accepted rather than on a sleep long enough
 * to be lucky.
 */
async function sayUntilHeard(page: Page, transcript: string): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await page.evaluate((text) => {
      const rec = (window as unknown as { __rec?: FakeRec }).__rec;
      rec?.onresult?.({ results: [[{ transcript: text }]] });
    }, transcript);
    const landed = await page
      .waitForFunction(
        (want) => {
          const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
          const rows = JSON.parse(raw ?? '[]') as {
            event: string;
            detail?: { text?: string };
          }[];
          return rows.some((r) => r.event === 'heard-text' && r.detail?.text === want);
        },
        transcript,
        { timeout: 2000 },
      )
      .then(() => true)
      .catch(() => false);
    if (landed) return;
  }
  throw new Error(`the app never accepted "${transcript}"`);
}

/**
 * Wait until the step has finished saying its piece.
 *
 * A step begins with a settle BEFORE it speaks, so "the button does not say
 * Speaking" is briefly true at a moment when an answer would still be
 * thrown away.
 */
async function answerable(page: Page, stepId: string): Promise<void> {
  const step = FIELD_TEST_STEPS.find((s) => s.id === stepId);
  const hasLine = (step?.say?.length ?? 0) > 0 || step?.sayUnclipped !== undefined;
  if (hasLine) {
    await expect
      .poll(
        async () =>
          (await entries(page)).some((e) => e.event === 'say-end' && e.detail.step === stepId),
        { timeout: 20_000 },
      )
      .toBe(true);
  }
  const again = page.getByTestId('fieldtest-again');
  await expect(again).not.toHaveText(/Speaking|Waiting for the microphone/);
  // Past ANSWER_GUARD_MS, which is about the step opening rather than about
  // the speech.
  await page.waitForTimeout(400);
}

/**
 * THE APP'S OWN INSTRUCTION IS NOT AN ANSWER. `wheel-with-mic` has no line,
 * so its instruction is read aloud with the microphone open. Echoed back by
 * the car it went to the answer matcher -- and while "skip" was a synonym
 * for `missed` it stamped the step and started the after block before the
 * press it was asking for. Now it is heard as the app: no stamp, and no
 * not-understood chime on the one step whose own comment says a chime and
 * nothing reads as a dead microphone.
 */
test('the read-aloud instruction echoed back is heard as the app, not stamped as an answer', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openTest(page, { byVoice: true });
  await goToStep(page, 'wheel-with-mic');
  await expect
    .poll(
      async () =>
        (await entries(page)).some(
          (e) => e.event === 'instruction-spoken' && e.detail.step === 'wheel-with-mic',
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  // Past the suppression window, as an echo off the car speakers can be.
  await page.waitForTimeout(5_000);
  await hear(page, 'the microphone is still on press skip forward again');

  await expect
    .poll(
      async () =>
        (await entries(page)).some(
          (e) => e.event === 'heard-own-voice' && e.detail.step === 'wheel-with-mic',
        ),
      { timeout: 5_000 },
    )
    .toBe(true);
  expect(
    (await entries(page)).filter((e) => e.event === 'answer-unmatched'),
    'the echo went to the matcher and chimed not-understood',
  ).toHaveLength(0);
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'wheel-with-mic');
});

test('a spoken answer stamps the step, and says it was spoken', async ({ page }) => {
  await openTest(page, { byVoice: true });
  await goToStep(page, 'mic-route');
  await answerable(page, 'mic-route');

  await sayUntilHeard(page, 'that one came from the car');

  await expect
    .poll(async () => (await answersIn(page)).map((e) => e.detail.answer))
    .toContain('route-car');

  const stamped = (await answersIn(page)).find((e) => e.detail.answer === 'route-car')!;
  expect(stamped.detail.step).toBe('mic-route');
  expect(stamped.detail.via, 'nothing in the log says this answer was spoken').toBe('voice');

  // Answering IS finishing the step, by voice exactly as by thumb.
  await expect(page.getByTestId('fieldtest-title')).not.toHaveText(
    FIELD_TEST_STEPS.find((s) => s.id === 'mic-route')!.title,
  );
});

/**
 * THE CHANNEL NEVER OPENS A MICROPHONE OF ITS OWN.
 *
 * The first version of this feature enabled the recogniser on every step
 * while the switch was on -- `enabled: voiceWanted || answerByVoice` -- so a
 * leg run with it on sampled `route-1/2/3` with the microphone live. Those
 * three steps are the "before the microphone" block the whole crossing is
 * read against; with the switch on there was no before block at all, and
 * nothing on a tapped stamp said so. Opening the microphone is the one event
 * the protocol exists to measure the effect of, and a convenience must not
 * be able to perform it.
 *
 * So: switch ON, on a step that declares `voice: false`, and no microphone
 * session may start. The spoken hints are not printed either -- a hint to
 * say something on a step where nothing is listening is a glance spent on a
 * lie.
 */
test('with the switch on, a step that keeps the microphone shut still keeps it shut', async ({
  page,
}) => {
  await openTest(page, { byVoice: true });
  await goToStep(page, 'route-1');
  await answerable(page, 'route-1');

  for (let i = 0; i < 4; i++) {
    await hear(page, 'that one came from the car');
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);

  const log = await entries(page);
  expect(
    log.filter((e) => e.event === 'session-start' && e.detail.step === 'route-1'),
    'the answer channel opened a microphone on a step whose whole point is that it is shut',
  ).toEqual([]);
  expect((await answersIn(page)).map((e) => e.detail.answer)).not.toContain('route-car');
  await expect(page.locator('.fieldtest-say')).toHaveCount(0);
  await expect(page.getByTestId('fieldtest-title')).toHaveText(
    FIELD_TEST_STEPS.find((s) => s.id === 'route-1')!.title,
  );
});

/**
 * THE GUARD ON THE TEST ABOVE, and the first version of it did not guard.
 *
 * It fired one transcript with the switch off and asserted nothing was
 * stamped -- which passed against a build where the switch did nothing and
 * the channel was always on, because a single utterance is swallowed by the
 * echo window anyway. The test was green for a reason that had nothing to
 * do with what it claimed.
 *
 * What actually distinguishes the two builds is the MICROPHONE. `route-1`
 * declares `voice: false`, so with the switch off nothing on this screen has
 * any reason to open one -- and a build that opens one regardless is the
 * version of this feature that quietly listens to everybody.
 */
test('with the switch off, nothing opens a microphone and nothing is stamped', async ({
  page,
}) => {
  await openTest(page, { byVoice: false });
  await goToStep(page, 'route-1');
  await answerable(page, 'route-1');

  // Said repeatedly, exactly as the accepting test does, so the difference
  // between the two is the switch and not the number of attempts.
  for (let i = 0; i < 4; i++) {
    await hear(page, 'that one came from the car');
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);

  const log = await entries(page);
  expect(
    log.filter((e) => e.event === 'session-start' && e.detail.step === 'route-1'),
    'the answer channel opened a microphone on a step that asked for none',
  ).toEqual([]);
  expect(
    log.some((e) => e.event === 'heard-text'),
    'a transcript reached the screen on a run with the channel off',
  ).toBe(false);
  expect((await answersIn(page)).map((e) => e.detail.answer)).not.toContain('route-car');
  await expect(page.getByTestId('fieldtest-voice-answers')).toHaveCount(0);
  await expect(page.getByTestId('fieldtest-title')).toHaveText(
    FIELD_TEST_STEPS.find((s) => s.id === 'route-1')!.title,
  );
});

test('an utterance with no answer in it is refused, not guessed at', async ({ page }) => {
  await openTest(page, { byVoice: true });
  await goToStep(page, 'mic-route');
  await answerable(page, 'mic-route');

  await sayUntilHeard(page, 'what on earth was that');

  await expect
    .poll(async () => (await entries(page)).some((e) => e.event === 'answer-unmatched'))
    .toBe(true);
  expect(
    (await answersIn(page)).length,
    'a transcript nobody could resolve was filed as an answer anyway',
  ).toBe(0);
});

/**
 * An answer belonging to a DIFFERENT step must not stamp this one. "radio" is
 * a real answer on the wheel steps; on a route step there is no such button,
 * and a matcher working off the global vocabulary rather than the offered one
 * would file it regardless.
 */
test('an answer from another step is not accepted here', async ({ page }) => {
  await openTest(page, { byVoice: true });
  await goToStep(page, 'mic-route');
  await answerable(page, 'mic-route');

  await sayUntilHeard(page, 'the radio changed track instead');
  await page.waitForTimeout(600);

  expect((await answersIn(page)).map((e) => e.detail.answer)).not.toContain('wheel-radio');
});

/**
 * THE RUN'S OWN ROWS CARRY THE SWITCH. The `answer-by-voice` row is written
 * from the gate, between runs as often as inside one; `run-start` and
 * `run-resume` are the rows joined to the run, and the logger's test only
 * shows it writes what it is handed.
 */
test('run-start and run-resume say the run answers out loud', async ({ page }) => {
  await openTest(page, { byVoice: true });
  await expect
    .poll(async () => (await entries(page)).find((e) => e.event === 'run-start')?.detail.answerByVoice, {
      timeout: 5_000,
    })
    .toBe(true);
  await page.getByTestId('fieldtest-skip').click();
  await page.getByTestId('fieldtest-pause').click();
  await page.getByTestId('fieldtest-open').click();
  await page.getByTestId('fieldtest-resume').click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
  await expect
    .poll(async () => (await entries(page)).find((e) => e.event === 'run-resume')?.detail.answerByVoice, {
      timeout: 5_000,
    })
    .toBe(true);
});

test('run-start says when the run does not answer out loud', async ({ page }) => {
  await openTest(page, { byVoice: false });
  await expect
    .poll(async () => (await entries(page)).find((e) => e.event === 'run-start')?.detail.answerByVoice, {
      timeout: 5_000,
    })
    .toBe(false);
});

/**
 * THE TEST WORD IS NOT AN ANSWER. `mic-heard` asks for "double" so the
 * transcript has a ground truth. With the switch on, that word went into the
 * answer matcher, matched nothing, and chimed the not-understood tone -- on
 * the one step whose own comment warns that a chime-and-nothing reads as a
 * dead microphone. What it hears is the evidence; the answer is tapped.
 */
test('on mic-heard what is heard is evidence, not an answer, even with the switch on', async ({
  page,
}) => {
  await openTest(page, { byVoice: true });
  await goToStep(page, 'mic-heard');
  await answerable(page, 'mic-heard');
  const before = (await entries(page)).length;

  await sayUntilHeard(page, 'double');
  await page.waitForTimeout(600);

  const since = (await entries(page)).slice(before);
  expect(
    since.find((e) => e.event === 'heard-action')?.detail.action,
    'the test word never reached the drill vocabulary, which is what the step shows',
  ).toBe('double');
  expect(since.filter((e) => e.event === 'answer-unmatched')).toEqual([]);
  expect(await answersIn(page)).toEqual([]);
  await expect(page.getByTestId('fieldtest-title')).toHaveText(
    FIELD_TEST_STEPS.find((s) => s.id === 'mic-heard')!.title,
  );
  // ...and a spoken answer is not taken here either: the step's own
  // recogniser is the thing under test.
  await sayUntilHeard(page, 'it got it right');
  await page.waitForTimeout(600);
  expect(await answersIn(page)).toEqual([]);
});

/**
 * THE INPUT PROBE FIRES ON THE ONE STEP THAT CAN AFFORD IT.
 *
 * `wheel-with-mic` is the last step with the microphone open before the
 * after block, and its own measurement is a wheel press, so a second capture
 * there restarts nothing that is sampled. The unit test pins the placement in
 * the protocol data; this proves the runner actually reads it -- a flag the
 * runner ignores is a row that never lands, and the no-move reading of the
 * crossing would then be indistinguishable from a false negative.
 */
test('the selected input is read once the microphone is live on wheel-with-mic, and not on a route step', async ({
  page,
}) => {
  await openTest(page, { byVoice: false });

  await goToStep(page, 'mic-route');
  await answerable(page, 'mic-route');
  await page.waitForTimeout(1500);
  const onRoute = (await entries(page)).filter((e) => e.event === 'input-selected');
  expect(onRoute, 'the probe ran inside the mic-open route block').toEqual([]);

  await goToStep(page, 'wheel-with-mic');
  await expect
    .poll(
      async () =>
        (await entries(page)).some(
          (e) => e.event === 'mic-settled' && e.detail.step === 'wheel-with-mic',
        ),
      { timeout: 20_000 },
    )
    .toBe(true);

  await expect
    .poll(async () => (await entries(page)).filter((e) => e.event === 'input-selected').length, {
      timeout: 5_000,
    })
    .toBe(1);
  const row = (await entries(page)).find((e) => e.event === 'input-selected')!;
  expect(row.detail.reason).toBe('mic-settled');
  expect(typeof row.detail.label, 'the row names no device').toBe('string');
  expect(row.detail.state, 'the capture failed rather than reading a label').toBeUndefined();
});
