import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';
import { FIELD_TEST_STEPS } from '../src/diag/fieldTest';

/**
 * THE MICROPHONE BLOCK, DRIVEN PAST ITS GATE.
 *
 * Eight of the protocol's steps declare `voice: true`, and until this file
 * existed none of them was ever observed on the far side of its
 * `awaitListening` gate. No spec installed a recognition engine, headless
 * Chromium exposes the whole SpeechRecognition surface and then fires no
 * events, so every one of those steps was either seen INSIDE its ten-second
 * gate or walked past with Skip. `fieldtest-heard` -- the transcript line
 * that is the entire output of `mic-heard` -- had zero references anywhere
 * in e2e/.
 *
 * That is precisely the failure the layout spec's own header is written
 * about: "on `mic-heard` the transcript could never show and 'It never heard
 * me' became the only honest tap... The instrument was manufacturing its own
 * positive result." Two of the six cells of the 2x2 the whole protocol turns
 * on live in this block.
 *
 * The engine below is the same shape as the one in `voice-answers.spec.ts`,
 * with one addition that matters here: `end()`, which makes it do what iOS
 * actually does -- end the session after an utterance so the app restarts it.
 * That churn is what `msSinceAppLetGo` used to be measured from.
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
      aborted = false;

      constructor() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }

      start(): void {
        this.aborted = false;
        // A stalled engine: `start()` accepted, `onstart` never delivered.
        // This is the recogniser between sessions on iOS, held there.
        if ((window as unknown as { __recStall?: boolean }).__recStall) return;
        setTimeout(() => this.onstart?.(), 0);
      }

      stop(): void {
        setTimeout(() => this.onend?.(), 0);
      }

      abort(): void {
        this.aborted = true;
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
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    rec?.onresult?.({ results: [[{ transcript: text }]] });
  }, transcript);
}

/**
 * End the recognition session, as iOS does after every utterance.
 *
 * `voiceControl.ts` restarts from `onend`, so this is a restart, not a close
 * -- and telling those two apart is the whole of finding F5.
 */
async function endSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rec = (window as unknown as { __rec?: FakeRec }).__rec;
    rec?.onend?.();
  });
}

/**
 * The wheel handlers the app registers, captured at the browser boundary.
 *
 * A real media key cannot be synthesised from Playwright. `initMediaSession`
 * registers exactly as it does in the car and the handler that runs is the
 * production one; only the caller is the test. Same seam as
 * `field-test.spec.ts`, needed here because the row F5 is about -- a press
 * that lands while the microphone is open -- needs both this and an engine.
 */
async function captureWheel(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const handlers: Record<string, () => void> = {};
    (window as unknown as { __wheel: (a: string) => boolean }).__wheel = (action) => {
      const fn = handlers[action];
      if (!fn) return false;
      fn();
      return true;
    };
    const original = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action: string, handler: (() => void) | null) => {
      if (handler) handlers[action] = handler;
      else delete handlers[action];
      return original(action as never, handler as never);
    };
  });
}

/** Fire one wheel action the way the car would. Returns false if unregistered. */
function press(page: Page, action = 'nexttrack'): Promise<boolean> {
  return page.evaluate(
    (a) => (window as unknown as { __wheel?: (x: string) => boolean }).__wheel?.(a) ?? false,
    action,
  );
}

async function openTest(page: Page, condition: string): Promise<void> {
  await withFakeEngine(page);
  await captureWheel(page);
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

/** Skip forward to a step, by id, using the protocol as the map. */
async function goToStep(page: Page, id: string): Promise<void> {
  const want = FIELD_TEST_STEPS.find((s) => s.id === id);
  expect(want, `${id} is not in the protocol`).toBeTruthy();
  const title = page.getByTestId('fieldtest-title');
  for (let i = 0; i < FIELD_TEST_STEPS.length + 2; i++) {
    if ((await title.innerText()) === want!.title) return;
    await page.getByTestId('fieldtest-skip').click();
    // Deliberately bounded: a walk that silently asserts zero times is the
    // failure this whole review round keeps finding.
    expect(i, `never reached ${id}`).toBeLessThan(FIELD_TEST_STEPS.length + 1);
  }
  throw new Error(`never reached ${id}`);
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

/**
 * Wait for an entry, rather than reading once.
 *
 * `diagnosticLog` buffers and flushes to storage on a timer, so a read taken
 * immediately after the tap that caused an entry finds the log as it was
 * before it. Three tests in this file failed on exactly that and would have
 * been "fixed" by a sleep.
 */
async function waitForEntry(
  page: Page,
  match: (e: { event: string; detail: Record<string, unknown> }) => boolean,
  what: string,
): Promise<{ event: string; detail: Record<string, unknown> }> {
  await expect
    .poll(async () => (await entries(page)).some(match), { timeout: 15_000 })
    .toBe(true);
  const found = (await entries(page)).find(match);
  expect(found, what).toBeTruthy();
  return found!;
}

test('the microphone block actually opens the microphone', async ({ page }) => {
  await openTest(page, 'Car, parked');
  await goToStep(page, 'mic-route');

  // THE GATE RESOLVES, rather than timing out. `mic-settled` is written when
  // the recogniser reports `listening`; `mic-never-live` when the ten-second
  // bound expires. Every previous observation of this step was inside the
  // gate, so the difference was untested.
  await expect
    .poll(async () => (await entries(page)).some((e) => e.event === 'mic-settled'), {
      timeout: 15_000,
    })
    .toBe(true);
  const settled = (await entries(page)).filter((e) => e.event === 'mic-settled');
  expect(settled[0]?.detail.step, 'something else settled the microphone').toBe('mic-route');
  expect(
    (await entries(page)).some((e) => e.event === 'mic-never-live'),
    'the gate gave up instead of opening',
  ).toBe(false);

  // ...AND THE LINE GOES OUT AFTER IT, which is the reason the gate exists:
  // the 2026-09-23 drive spoke 7ms after asking for the microphone, while the
  // recogniser took 3497ms to confirm, so the sample labelled "microphone
  // open" was taken before the flip.
  await expect
    .poll(
      async () =>
        (await entries(page)).some((e) => e.event === 'say-start' && e.detail.step === 'mic-route'),
      { timeout: 15_000 },
    )
    .toBe(true);
  const all = await entries(page);
  const settleAt = all.findIndex((e) => e.event === 'mic-settled');
  const spokeAt = all.findIndex(
    (e, i) => i > settleAt && e.event === 'say-start' && e.detail.step === 'mic-route',
  );
  expect(settleAt, 'the microphone never settled').toBeGreaterThanOrEqual(0);
  expect(spokeAt, 'the step spoke before the gate opened').toBeGreaterThan(settleAt);

  // ...and the answers are live once it has spoken, which is the other half:
  // a gate that never opens leaves the step permanently unanswerable.
  await expect(page.getByTestId('fieldtest-answers').locator('button').first()).toBeEnabled({
    timeout: 15_000,
  });
});

test('what the recogniser heard reaches the screen and the answer', async ({ page }) => {
  await openTest(page, 'Car, parked');
  await goToStep(page, 'mic-heard');
  await expect(page.getByTestId('fieldtest-answers')).toBeVisible();

  // Nothing yet: the line only appears once there is a transcript, and an
  // empty panel is what made "It never heard me" the only honest answer.
  await expect(page.getByTestId('fieldtest-heard')).toHaveCount(0);

  // The word the step's own instruction names, so the panel has a ground
  // truth to be right or wrong about.
  await hear(page, 'double');
  const shown = page.getByTestId('fieldtest-heard');
  // WHATEVER THE APP MADE OF IT, but it has to say something: the whole
  // defect is that this line could never appear, which left "It never heard
  // me" -- the signature of the fault under investigation -- as the only
  // honest tap. Deliberately not pinned to the command vocabulary: what the
  // matcher does with a word is settled in unit tests, and pinning it here
  // would make this fail for a reason that has nothing to do with the
  // recogniser reaching the screen.
  await expect(shown, 'nothing the recogniser produced reached the screen').toBeVisible();
  const heardText = (await shown.innerText()).replace(/^Heard:\s*/, '').trim();
  expect(heardText, 'the transcript line is empty').not.toBe('');

  // ...and it rides along with the answer, which is what makes the step's
  // "did it hear me right" answerable in the export rather than on the day.
  await page.waitForTimeout(400);
  await page.getByTestId('fieldtest-answer-heard-right').click();
  const answer = await waitForEntry(
    page,
    (e) => e.event === 'answer' && e.detail.step === 'mic-heard',
    'the answer never reached the log',
  );
  // THE SAME TEXT THE SCREEN SHOWED, so the chain from engine to panel to
  // stamp is asserted end to end rather than in two halves that could each
  // pass against different values.
  expect(String(answer.detail.heard), 'the answer lost what the screen showed').toContain(
    heardText,
  );
});

/**
 * PAUSE IS THE APP LETTING GO. The recogniser goes down with the screen,
 * and the condition picker sits beside Resume: a leg paused on
 * `wheel-with-mic` and re-opened as Speakerphone resumes on
 * `route-after-mic`, where every after sample must say how long since the
 * microphone closed -- and said nothing, because no edge was ever seen.
 */
test('an after sample taken after Pause on a microphone step carries the offset', async ({
  page,
}) => {
  await openTest(page, 'Car, parked');
  await goToStep(page, 'wheel-with-mic');
  await expect
    .poll(async () => (await entries(page)).some((e) => e.event === 'mic-settled'), {
      timeout: 15_000,
    })
    .toBe(true);
  await page.getByTestId('fieldtest-pause').click();
  await page.getByTestId('fieldtest-open').click();
  await page.getByRole('button', { name: 'Speakerphone', exact: true }).click();
  await page.getByTestId('fieldtest-resume').click();
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'route-after-mic');

  const answers = page.getByTestId('fieldtest-answers').locator('button');
  await expect(answers.first()).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await answers.first().click();
  const answer = await waitForEntry(
    page,
    (e) => e.event === 'answer' && e.detail.step === 'route-after-mic',
    'the step was never answered',
  );
  expect(
    answer.detail.msSinceAppLetGo,
    'the pause closed the microphone and nothing recorded it',
  ).toEqual(expect.any(Number));
  expect(answer.detail.msSinceAppLetGo as number).toBeLessThan(60_000);
});

/**
 * A RELOAD RUNS NO CLEANUP AT ALL. The update check reloads the app by
 * itself, mid-drive, and an iOS kill is the same from in here: the unmount
 * that records the microphone closing never happens. The run is resumed from
 * the gate, where nothing is listening -- so the close time is put back
 * there, from `micHasBeenUp`, and only when the step being resumed onto does
 * not itself want the microphone.
 */
test('an after sample taken after a reload on a microphone step carries the offset', async ({
  page,
}) => {
  await openTest(page, 'Car, parked');
  await goToStep(page, 'wheel-with-mic');
  await expect
    .poll(async () => (await entries(page)).some((e) => e.event === 'mic-settled'), {
      timeout: 15_000,
    })
    .toBe(true);

  await page.reload();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  // ...and the leg re-opened with no Bluetooth, which snaps the pointer off
  // the wheel step it was left on.
  await page.getByRole('button', { name: 'Speakerphone', exact: true }).click();
  await page.getByTestId('fieldtest-resume').click();
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'route-after-mic');

  const answers = page.getByTestId('fieldtest-answers').locator('button');
  await expect(answers.first()).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await answers.first().click();
  const answer = await waitForEntry(
    page,
    (e) => e.event === 'answer' && e.detail.step === 'route-after-mic',
    'the step was never answered',
  );
  expect(
    answer.detail.msSinceAppLetGo,
    'the reload closed the microphone and nothing recorded it',
  ).toEqual(expect.any(Number));
  expect(answer.detail.msSinceAppLetGo as number).toBeLessThan(60_000);
});

/**
 * ...AND THE BEFORE BLOCK STILL HAS NO OFFSET. `micClosedAt` absent means
 * two things -- never up, or up and the moment lost -- and putting a close
 * time back on a run that never opened the microphone would give `route-1`
 * the reading that only an after step can have.
 */
test('a reload before the microphone block leaves the before samples with no offset', async ({
  page,
}) => {
  await openTest(page, 'Car, parked');
  await goToStep(page, 'route-2');
  await page.reload();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  await page.getByTestId('fieldtest-resume').click();
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'route-2');

  const answers = page.getByTestId('fieldtest-answers').locator('button');
  await expect(answers.first()).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await answers.first().click();
  const answer = await waitForEntry(
    page,
    (e) => e.event === 'answer' && e.detail.step === 'route-2',
    'the step was never answered',
  );
  expect(
    answer.detail.msSinceAppLetGo,
    'a before sample was given an after sample\u2019s reading',
  ).toBeUndefined();
});

/**
 * F5: a recogniser restart is not the microphone letting go.
 *
 * iOS ends a webkit session after every utterance and `voiceControl.ts`
 * starts a new one from `onend`. The screen watched that same `listening`
 * edge to set `micClosedAtRef`, so mic-OPEN samples exported
 * `msSinceAppLetGo` -- a field documented as "how long after the app let go",
 * and the spine of the four-point recovery curve. The earliest, most decisive
 * region of that curve was being filled with rows from the opposite cell.
 */
test('a restart mid-utterance is not recorded as the microphone letting go', async ({ page }) => {
  await openTest(page, 'Car, parked');
  await goToStep(page, 'mic-route');
  await expect
    .poll(async () => (await entries(page)).some((e) => e.event === 'mic-settled'), {
      timeout: 15_000,
    })
    .toBe(true);

  // The engine ends its session, exactly as it does on a phone after an
  // utterance. The app restarts it; the step still wants the microphone.
  await endSession(page);
  await page.waitForTimeout(300);

  const answers = page.getByTestId('fieldtest-answers').locator('button');
  await expect(answers.first()).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await answers.first().click();

  const answer = await waitForEntry(
    page,
    (e) => e.event === 'answer' && e.detail.step === 'mic-route',
    'the step was never answered',
  );
  expect(
    answer.detail.msSinceAppLetGo,
    'a sample taken with the microphone OPEN reports how long since it closed',
  ).toBeUndefined();

  /*
   * THE POSITIVE CELL, WITHOUT WHICH THE ONE ABOVE PROVES NOTHING.
   *
   * `undefined` is also what a build with no offset logic at all produces,
   * and what EVERY step produces in a project where the microphone never
   * opens. Removing the entire F5 guard left this test green; so did
   * removing the L2 line that clears the offset at each step. Both were
   * asserting a field that was never going to be filled.
   *
   * So the next step -- the first route sample AFTER the microphone block,
   * taken with the microphone shut -- has to carry a real number, and the
   * silent step after that has to carry none of its own (L2: a step with no
   * utterance must not inherit the last step that had one).
   */
  await goToStep(page, 'route-after-mic');
  const spoken = page.getByTestId('fieldtest-answers').locator('button');
  await expect(spoken.first()).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await spoken.first().click();
  const afterMic = await waitForEntry(
    page,
    (e) => e.event === 'answer' && e.detail.step === 'route-after-mic',
    'the first post-microphone sample was never answered',
  );
  expect(
    typeof afterMic.detail.msSinceAppLetGo,
    'the microphone never actually opened, so the assertion above was vacuous',
  ).toBe('number');

  await goToStep(page, 'wheel-after-mic');
  const silent = page.getByTestId('fieldtest-answers').locator('button');
  await expect(silent.first()).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await silent.first().click();
  const noLine = await waitForEntry(
    page,
    (e) => e.event === 'answer' && e.detail.step === 'wheel-after-mic',
    'the silent step was never answered',
  );
  expect(
    noLine.detail.msSinceAppLetGo,
    'a step with no utterance of its own exported the previous step\u2019s offset',
  ).toBeUndefined();
});

/**
 * THE AFTER-BLOCK CLOCK RUNS FROM THE STEP THAT STOPPED ASKING.
 *
 * `msSinceAppLetGo` was set on the recogniser's listening->not edge, seen
 * on a step that no longer wants the microphone. But on iOS the recogniser
 * ends after every utterance and restarts, cycles every 45 s, and backs off
 * after an `audio-capture` error -- so at the moment `wheel-with-mic` is
 * left it is as likely to be mid-restart as listening, and then there is no
 * edge to see: every after sample lost its offset and `route-after-mic`
 * read `wasLive=false`. The declared setup is the authority for "the app
 * stopped asking", and that edge is the step change itself.
 */
test('the after-block clock starts when the step stops asking, whatever the recogniser was doing', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openTest(page, 'Car, parked');
  await goToStep(page, 'wheel-with-mic');
  await expect
    .poll(
      async () =>
        (await entries(page)).some(
          (e) => e.event === 'mic-settled' && e.detail.step === 'wheel-with-mic',
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  // The engine ends its session and the restart never lands: the recogniser
  // is not `listening` when the operator moves on.
  await page.evaluate(() => {
    (window as unknown as { __recStall?: boolean }).__recStall = true;
  });
  await endSession(page);
  await page.waitForTimeout(300);

  await goToStep(page, 'route-after-mic');
  const answers = page.getByTestId('fieldtest-answers').locator('button');
  await expect(answers.first()).toBeEnabled({ timeout: 25_000 });
  await page.waitForTimeout(400);
  await answers.first().click();
  const afterMic = await waitForEntry(
    page,
    (e) => e.event === 'answer' && e.detail.step === 'route-after-mic',
    'the first post-microphone sample was never answered',
  );
  expect(
    typeof afterMic.detail.msSinceAppLetGo,
    'the recogniser was mid-restart when the app let go, and the after clock never started',
  ).toBe('number');

  // ...and the gate row says what the recogniser was doing when the step
  // opened, so a reader can tell "mid-restart" from "never up" without
  // reading `wasLive=false` as either.
  const stopped = (await entries(page)).find(
    (e) => (e.event === 'mic-stopped' || e.event === 'mic-still-live') && e.detail.step === 'route-after-mic',
  );
  expect(stopped, 'no release-gate row for the first after step').toBeTruthy();
  expect(stopped!.detail.wasLive, 'the stalled recogniser was reported as listening').toBe(false);
  expect(
    stopped!.detail.stateAtArrival,
    'the gate row does not say the recogniser was mid-restart',
  ).toBe('restarting');
  expect(
    stopped!.detail.sinceAppLetGoAtArrivalMs,
    'the gate row does not carry the after clock as the step opened',
  ).toEqual(expect.any(Number));
  expect(Number(stopped!.detail.sinceAppLetGoAtArrivalMs)).toBeLessThan(5_000);
  expect(stopped!.detail.why, 'the gate row does not say which utterance it belongs to').toBe(
    'step-open',
  );

  // ...and a restart that was in progress when the block closed is not
  // "against" a press on `wheel-after-mic`: the churn clock clears on the
  // declared close, the after clock keeps running.
  await goToStep(page, 'wheel-after-mic');
  await page.waitForTimeout(300);
  expect(await press(page, 'nexttrack')).toBe(true);
  const arrival = await waitForEntry(
    page,
    (e) => e.event === 'field-test-arrival' && e.detail.step === 'wheel-after-mic',
    'the press on wheel-after-mic was never recorded',
  );
  expect(arrival.detail.msSinceMicRestart, 'a stalled restart from the mic block was carried into the after block').toBeUndefined();
  expect(arrival.detail.msSinceAppLetGo).toEqual(expect.any(Number));
});

/**
 * THE WINDOW OPENS WHEN THE LINE ENDS, NOT BEFORE. Arrival on `ambient` reads
 * the instruction aloud; the first seconds of a five-second window opened
 * under it would be the app's own voice, and that figure is the leg's
 * reference level. And it opens by itself: the operator was told to stay
 * quiet and then asked for a tap.
 */
test('the cabin is measured by itself once the instruction has been read, and not under it', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    (window as unknown as { __e2eSpeechDelayMs?: number }).__e2eSpeechDelayMs = 4_000;
  });
  await openTest(page, 'Car, parked');
  await goToStep(page, 'ambient');

  const measure = page.getByTestId('fieldtest-measure');
  await expect(measure).toBeVisible();
  await expect(measure, 'the cabin can be measured over the app\u2019s own voice').toBeDisabled();
  // Under the read-aloud, nothing is listening: the panel (which only
  // exists once a window has opened) would say so, and so would the button.
  await expect(page.getByTestId('fieldtest-ambient')).toHaveCount(0);
  await expect(measure).not.toHaveText(/listening/i);
  await expect
    .poll(async () => (await entries(page)).some((e) => e.event === 'instruction-spoken' && e.detail.step === 'ambient'), {
      timeout: 10_000,
    })
    .toBe(true);
  // ...and once it is over, the window opens with no tap.
  await expect(measure).toHaveText(/listening/i, { timeout: 5_000 });
  const reading = await waitForEntry(
    page,
    (e) => (e.event === 'ambient' || e.event === 'ambient-failed') && e.detail.step === 'ambient',
    'the cabin was never measured after the instruction',
  );
  expect(reading.event).toBe('ambient');
  expect(reading.detail.aborted, 'the window was cut short').toBeUndefined();
});

/**
 * W2: the one step whose entire product is a number.
 *
 * `ambient` opens a raw microphone for five seconds and folds the frames into
 * a dBFS figure. Nothing -- unit or e2e -- asserted that a reading ever
 * reached the screen or the log: with no device and no permission,
 * `getUserMedia` rejected in milliseconds, so the tests around it exercised
 * the rejection and nothing else. The chromium project now launches with a
 * fake capture device (see playwright.config.ts).
 */
test('the cabin measurement produces a reading, on the screen and in the log', async ({ page }) => {
  test.setTimeout(60_000);
  await openTest(page, 'Car, parked');
  await goToStep(page, 'ambient');

  const measure = page.getByTestId('fieldtest-measure');
  await expect(measure).toBeVisible();
  // The first window opens by itself after the read-aloud; nothing to tap.

  // FIVE SECONDS OF FRAMES, so this is a real wait rather than a rejection.
  // FIVE SECONDS. The panel reads "listening..." until the frames are
  // folded, so waiting for it to be visible is not waiting for a reading.
  await expect
    .poll(async () => page.getByTestId('fieldtest-ambient').innerText(), { timeout: 25_000 })
    .toMatch(/-?\d+(\.\d+)?\s*dB/i);

  const reading = await waitForEntry(
    page,
    (e) => e.event === 'ambient',
    'no ambient reading reached the log',
  );
  expect(typeof reading.detail.dbfs, 'the log entry carries no level').toBe('number');
  expect(Number.isFinite(reading.detail.dbfs), 'the level is not a finite number').toBe(true);
  expect(reading.detail.band, 'the log entry carries no band').toBeTruthy();
  expect(Number(reading.detail.frames), 'the reading folded no frames').toBeGreaterThan(0);
});

/**
 * F5, where the distinction is actually written down.
 *
 * `field-test-arrival` carries both clocks: `msSinceAppLetGo` (the app let
 * the microphone go) and `msSinceMicRestart` (the recogniser ended its own
 * session and was restarted). Before the fix the second event was written
 * into the first, so presses taken with the microphone OPEN -- half the wheel
 * block -- reported a recovery time from a close that had not happened, and
 * they are the earliest, most decisive points on that curve.
 *
 * Asserted on `wheel-with-mic`, the one step that is both `voice: true` and
 * `wheel: true`. The earlier version of this test asserted on a route answer
 * instead, where the offset is captured at the line and so is undefined
 * either way: reverting the whole fix left it passing.
 */
test('a press with the microphone open is timed from the restart, not from a close', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openTest(page, 'Car, parked');
  await goToStep(page, 'wheel-with-mic');
  await expect
    .poll(async () => (await entries(page)).some((e) => e.event === 'mic-settled'), {
      timeout: 15_000,
    })
    .toBe(true);

  // iOS ends the session after an utterance; `voiceControl.ts` restarts it.
  await endSession(page);
  await page.waitForTimeout(300);

  expect(await press(page), 'the wheel reached no screen, so this proves nothing').toBe(true);

  const arrival = await waitForEntry(
    page,
    (e) => e.event === 'field-test-arrival' && e.detail.step === 'wheel-with-mic',
    'the press never arrived',
  );
  expect(
    typeof arrival.detail.msSinceMicRestart,
    'the restart was not recorded at all, so the field below is undefined for the wrong reason',
  ).toBe('number');
  expect(
    arrival.detail.msSinceAppLetGo,
    'a restart was filed as the app letting the microphone go',
  ).toBeUndefined();
});
