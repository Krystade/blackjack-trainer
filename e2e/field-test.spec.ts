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

/**
 * End a run. TWO TAPS, deliberately: Finish sits under the answer stack at
 * bottom-right, which is the easiest thing to hit with a thumb coming off the
 * wheel. One tap used to end the run outright and the gate then offered only
 * Start, from step one with no stamps -- which is how the first two runs died.
 * It keeps the position and the stamps now, so a mis-tapped Finish is
 * recoverable, and the two taps are what stop it being tapped by a bump.
 */
async function endRun(page: Page): Promise<void> {
  const finish = page.getByTestId('fieldtest-finish');
  await finish.click();
  await expect(finish).toHaveText('Tap again to end');
  await finish.click();
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
    await endRun(page);
    await page.getByTestId('fieldtest-open').click();
  }
  if (condition) await page.getByRole('button', { name: condition, exact: true }).click();
  await startRun(page);
}

/**
 * Press Start, through the arming tap when there is one.
 *
 * With a run to come back to, Start reads "Start over from step 1" and arms
 * rather than starting: it zeroes the position and empties the stamps, and it
 * sits directly under Resume on the screen an interrupted run lands on. The
 * harness has to do what an operator does, which is tap it twice.
 */
async function startRun(page: Page): Promise<void> {
  const start = page.getByTestId('fieldtest-start');
  await start.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
}

/** How many utterances the app has attempted. Captured, not spoken, under ?e2e=1. */
function saidCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__speechLog?.length ?? 0);
}

/**
 * The log WITHOUT leaving the run, straight out of storage.
 *
 * `logText` reads the rendered panel, and getting to the panel means tapping
 * Pause. That is fine for a test that is finished with the run and fatal for
 * one that is not: `pauseFieldTestRun` writes `active: false`, so re-entering
 * lands on the start gate rather than back on the step -- and a test that
 * then "presses a wheel button on a route step" is pressing it with no step
 * mounted at all. See the probe test below, which was doing exactly that.
 */
async function rawLog(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
    const all = raw
      ? (JSON.parse(raw) as {
          category: string;
          event: string;
          detail?: Record<string, unknown>;
        }[])
      : [];
    return all.map((e) => `${e.category} ${e.event} ${JSON.stringify(e.detail ?? {})}`).join('\n');
  });
}

async function logText(page: Page): Promise<string> {
  // The tab bar stands down during a run, so mid-run the way out is Pause --
  // which keeps the position and every stamp, unlike Finish.
  const pause = page.getByTestId('fieldtest-pause');
  if ((await pause.count()) > 0) await pause.click();
  else await page.getByRole('button', { name: 'Settings' }).first().click();
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

/**
 * Answer the step on screen.
 *
 * WAITS OUT THE BOUNCE GUARD FIRST. `answer()` ignores a tap in the first
 * 350ms after a step opens, because there was no debounce at all and a bump
 * on a rough road turned one press into two -- answering step N and then step
 * N+1 with whatever button happened to be under that point, with nothing able
 * to un-stamp either. A test that taps in under a millisecond is not a
 * scenario the app should serve, so the harness waits rather than the guard
 * shrinking.
 */
async function answerStep(page: Page, testId: string): Promise<void> {
  const button = page.getByTestId(testId);
  await expect(button).toBeEnabled();
  await page.waitForTimeout(400);
  await button.click();
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

  // POLLED FOR THE LINE ITSELF, not for "something was said".
  //
  // Every measured sample now has a fixed silence between its arrival chime
  // and its utterance, so the first thing in the speech log is the chime and
  // the line lands a second and a half later. Polling for a non-empty log
  // therefore stopped at the chime and then asserted against a log with no
  // line in it -- and the failure message said nothing about waiting.
  await expect
    .poll(async () => (await page.evaluate(() => window.__speechLog ?? [])).map(String), {
      timeout: 15_000,
    })
    .toContain('Basic hit versus dealer nine.');
});

test('it will say the line again, because a line missed in traffic is a step wasted', async ({
  page,
}) => {
  await withSettings(page, {});
  await openTest(page);
  // UTTERANCES, NOT SOUNDS. `__speechLog` carries chimes too, and every
  // measured step now chimes on arrival and again after the settle -- so a
  // count of everything the app emitted moved for reasons that have nothing
  // to do with the control under test.
  const lines = async () =>
    (await page.evaluate(() => window.__speechLog ?? []))
      .map(String)
      .filter((l) => !l.startsWith('chime:'));
  await expect.poll(lines, { timeout: 15_000 }).toContain('Basic hit versus dealer nine.');
  // Measured as an INCREASE rather than against a fixed count: StrictMode
  // double-invokes effects in dev, so the opening line lands once in a
  // production build and twice here. What the button has to do -- say it one
  // more time, on demand -- is the same number either way.
  const before = (await lines()).length;

  await page.getByTestId('fieldtest-again').click();

  await expect.poll(async () => (await lines()).length, { timeout: 15_000 }).toBe(before + 1);
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
  expect(titles).toContain('Wheel, after the line ends');
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

  await answerStep(page, 'fieldtest-answer-route-earpiece');

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

  await answerStep(page, 'fieldtest-answer-route-car');

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

  await answerStep(page, 'fieldtest-answer-route-car');

  await expect(page.getByTestId('fieldtest-progress')).toContainText('step 2 of');
});

/**
 * "Can't have to go back and forth and have it reset all progress."
 * The run lives outside React, so leaving the screen costs nothing.
 */
test('the run survives leaving the screen', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page);
  await answerStep(page, 'fieldtest-answer-route-car');
  await expect(page.getByTestId('fieldtest-progress')).toContainText('step 2 of');

  await page.getByTestId('fieldtest-pause').click();
  await page.getByTestId('fieldtest-open').click();

  // RESUME, ONE TAP. Pause now genuinely pauses -- it used to leave the run
  // active in module state, so re-entering skipped the start gate and mounted
  // the running screen, re-applying that step's setup. On `mic-route` that
  // opened the microphone from a single navigation tap. What "survives" means
  // is the position and the ticks, not the run running on unattended.
  await page.getByTestId('fieldtest-resume').click();
  await expect(page.getByTestId('fieldtest-progress')).toContainText('step 2 of');
});

/**
 * A RUN INTERRUPTED ON STEP ONE IS STILL A RUN.
 *
 * Resume was offered on `stepIndex > 0`, so a leg paused, reloaded or killed
 * before the first answer came back to a gate whose only button was Start --
 * a two-tap discard. Step one is where a leg is most likely to be interrupted:
 * it is the step the operator is on while still getting the car into the
 * condition, and `route-1` is the first cell of the block every other block is
 * compared against.
 */
test('a run paused on step one can be resumed rather than only restarted', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page);
  await expect(page.getByTestId('fieldtest-progress')).toContainText('step 1 of');

  await page.getByTestId('fieldtest-pause').click();
  await page.getByTestId('fieldtest-open').click();

  const resume = page.getByTestId('fieldtest-resume');
  await expect(resume).toContainText('step 1 of');
  // ...AND STARTING OVER IS STILL ONE TAP, because there is nothing to lose.
  // Gating the confirm on the same flag as Resume put a two-tap guard in front
  // of Start whose second tap read "Tap again to go back to step 1 of 23" on a
  // run already on step 1 of 23. A confirmation that names nothing teaches the
  // operator to tap through the one that costs a leg.
  // Tapped, not merely read: the label and the guard are two different
  // expressions, and only a tap tells whether the guard moved.
  await resume.click();
  await expect(page.getByTestId('fieldtest-progress')).toContainText('step 1 of');
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'route-1');

  await page.getByTestId('fieldtest-pause').click();
  await page.getByTestId('fieldtest-open').click();
  const start = page.getByTestId('fieldtest-start');
  await expect(start).toContainText('Start \u2014');
  await start.click();
  await expect(
    page.getByTestId('fieldtest-title'),
    'Start armed a confirm for a run with nothing to discard',
  ).toBeVisible();
});

test('the run is still there after a reload, which the update check can force mid-drive', async ({
  page,
}) => {
  await withSettings(page, {});
  await openTest(page);
  await answerStep(page, 'fieldtest-answer-route-car');

  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();

  /**
   * PARKED, NOT RUNNING. A restored run keeps its position but never comes
   * back active, because the running screen opens the microphone from
   * whatever step it mounts on and `mic-route` declares `voice: true`. Coming
   * back active would mean yesterday's abandoned run turning the microphone
   * on because someone opened a screen -- the orange iOS indicator with no
   * tap that asked for it, on a device that has had a stuck microphone once
   * already. The position survives, so resuming costs one deliberate tap.
   */
  const resume = page.getByTestId('fieldtest-resume');
  await expect(resume).toContainText('step 2 of');
  await resume.click();

  await expect(page.getByTestId('fieldtest-progress')).toContainText('step 2 of');
  // ...and the answer already given is still counted, not silently reset.
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'route-2');
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
  await openTest(page, 'Car, parked');

  // Asserted WHILE the step is open, because leaving now deliberately puts the
  // operator's own settings back (see the restoration test below). The banner
  // is the operator's only in-car view of what the app changed under them.
  const banner = page.getByTestId('fieldtest-setup');
  await expect(banner).toContainText(/audio on/i);
  await expect(banner).toContainText(/recorded voice/i);
  await expect(banner).toContainText(/unmuted/i);

  // ...and it is in the log, resolved rather than declared, so a run analysed
  // weeks later says what each step actually ran under.
  const text = await logText(page);
  expect(text).toMatch(/step-setup.*step=route-1/);
  expect(text).toMatch(/step-setup.*muted=false/);
});

/**
 * THE OPERATOR'S SETTINGS SURVIVE THE RUN.
 *
 * Steps write real, persisted settings. Nothing restored them, so a completed
 * run left the phone at `volume: 1.5` with `wheelMode: 'answer'` permanently
 * -- the operator's next drill ran at 150% with the wheel in the wrong mode,
 * for reasons that have nothing to do with the drill. Leaving mid-run was
 * worse: whatever partial state the last step imposed was what they kept,
 * including clips off if they stopped anywhere in the three TTS route steps.
 */
test('the run gives the settings back, however it is left', async ({ page }) => {
  await withSettings(page, { audio: { volume: 0.8, useClips: true }, drill: { wheelMode: 'talk' } });

  const stored = () =>
    page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));

  await openTest(page, 'Car, parked');
  // Deep into the run, past the steps that raise the volume and switch the
  // recorded voice off.
  await goToStep(page, 'route-after-mic-2t');
  const during = await stored();
  expect(during.audio.useClips, 'the TTS steps never switched clips off').toBe(false);

  await endRun(page);

  const after = await stored();
  expect(after.audio.volume, 'the run kept the volume it raised').toBe(0.8);
  expect(after.audio.useClips, 'the run kept the recorded voice switched off').toBe(true);
  expect(after.drill.wheelMode, 'the run kept the wheel in answer mode').toBe('talk');
});

test('finishing puts the test away and says so in the log', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page);

  // ONE TAP DOES NOT END IT. The button arms and says so; the run is still
  // on screen. This is the assertion that keeps the guard from being quietly
  // removed as an annoyance.
  await page.getByTestId('fieldtest-finish').click();
  await expect(page.getByTestId('fieldtest-finish')).toHaveText('Tap again to end');
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();

  await page.getByTestId('fieldtest-finish').click();

  // Back on Settings, with the run closed rather than merely hidden.
  await expect(page.getByTestId('fieldtest-open')).toContainText('Open the field test');
  const text = await logText(page);
  expect(text).toContain('run-end');
});

/**
 * THE WHEEL, ACTUALLY PRESSED.
 *
 * Everything above this point navigates and answers; not one assertion ever
 * made the car send anything. Deleting `setMediaSessionProbe`, the probe
 * effect, the on-screen evidence line and the `wheel=` log payload -- the
 * whole feature the operator objected to losing -- left the entire suite
 * green. The protocol's wheel steps were, to the tests, indistinguishable
 * from steps with a `wheel: true` field nobody read.
 *
 * A real media key cannot be synthesised from Playwright, so the handlers the
 * app registers are captured at the browser boundary and invoked directly.
 * Nothing in `src/` is aware of this: `initMediaSession` registers exactly as
 * it does in the car, and the handler that runs is the production one.
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

/** Walk forward until the step with this title is showing. */
/**
 * Walk forward to a step, BY ITS ID rather than by its title.
 *
 * This matched `innerText` exactly, so rewording a step's title broke every
 * test that walked past it — and broke them in a full-suite run rather than at
 * the edit. Normalising the route block to ask its question in one wording did
 * exactly that to three of them. The id is what identifies a step in the log,
 * in the stamps and in `resolveFieldTestSetup`; it is what a harness should
 * navigate by, and the screen now carries it on the title element.
 *
 * A title is still accepted, because a few tests read better naming the step
 * the way the operator sees it.
 */
async function goToStep(page: Page, step: string): Promise<void> {
  const title = page.getByTestId('fieldtest-title');
  for (let i = 0; i < 40; i++) {
    const at = await title.evaluate((el) => ({
      id: el.getAttribute('data-step'),
      text: (el as HTMLElement).innerText,
    }));
    if (at.id === step || at.text === step) return;
    const skip = page.getByTestId('fieldtest-skip');
    if (await skip.isDisabled()) break;
    await skip.click();
  }
  throw new Error(`never reached step "${step}"`);
}

/**
 * THE CAR PRESSES BUTTONS OF ITS OWN. A head unit sends `play` by itself
 * whenever it believes playback stopped -- the 2026-09-11 drive logged nine
 * of them at five-second intervals with nobody touching anything -- and
 * `pause`/`stop` arrive unprompted too. The probe used to count every one as
 * a press: on `wheel-gap` an automatic `play` five seconds after the clip
 * read as "arrived in the silence", which is the exact signature the wheel
 * block exists to find. Only the two buttons the driver can reach are
 * presses; the rest are transport, logged as such and counted as nothing.
 */
test("the car's own play, pause and stop are transport, not presses", async ({ page }) => {
  await captureWheel(page);
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'Wheel, after the line ends');

  expect(await press(page, 'play')).toBe(true);
  await press(page, 'pause');
  await press(page, 'stop');
  await expect(page.getByTestId('fieldtest-wheel')).toContainText('Waiting');
  await expect(page.getByTestId('fieldtest-wheel')).not.toContainText('press');

  // Then a real one, so the filter is shown to let presses through.
  await press(page, 'nexttrack');
  await expect(page.getByTestId('fieldtest-wheel')).toContainText('1 press');

  await page.waitForTimeout(1_200);
  const text = await logText(page);
  const arrivals = text.split('\n').filter((l) => l.includes('field-test-arrival'));
  expect(arrivals, 'an automatic action was logged as an arrival').toHaveLength(1);
  expect(arrivals[0]).toContain('action=nexttrack');
  expect(arrivals[0]).toContain('pressIndex=1');
  const transport = text.split('\n').filter((l) => l.includes('field-test-transport'));
  expect(transport.map((l) => /action=(\w+)/.exec(l)?.[1])).toEqual(['play', 'pause', 'stop']);
  expect(transport[0]).toContain('step=wheel-gap');
});

test('a wheel press on a wheel step is caught, shown, and logged', async ({ page }) => {
  await captureWheel(page);
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'The wheel, while it is talking');

  // Registered at all. If this is false the car has nothing to press.
  expect(await press(page, 'nexttrack')).toBe(true);

  // On screen, because the operator is in a car and cannot read a console --
  // "did that land?" is the question the step exists to answer.
  await expect(page.getByTestId('fieldtest-wheel')).toContainText('1 press');
  await expect(page.getByTestId('fieldtest-wheel')).not.toContainText('Waiting');

  // A second one counts separately rather than replacing the first.
  await press(page, 'previoustrack');
  await expect(page.getByTestId('fieldtest-wheel')).toContainText('2 presses');

  // ...and both are carried into the stamp, not just onto the screen. This is
  // the payload a diagnosis is made from weeks later.
  // Past the bounce guard, as a person reading two answer labels would be.
  await page.waitForTimeout(400);
  await page.getByTestId('fieldtest-answers').getByRole('button').first().click();
  const text = await logText(page);
  expect(text).toContain('field-test-arrival');
  expect(text).toMatch(/wheel=.*nexttrack/);
  expect(text).toMatch(/wheel=.*previoustrack/);
});

test('the probe is let go when the step is not about the wheel', async ({ page }) => {
  await captureWheel(page);
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  // Through a wheel step FIRST, so the handlers are registered and the probe
  // has been set and released -- otherwise "no arrival" would pass for the
  // uninteresting reason that the car has nothing to press.
  await goToStep(page, 'The wheel, with the microphone open');
  expect(await press(page, 'nexttrack')).toBe(true);
  await expect(page.getByTestId('fieldtest-wheel')).toContainText('1 press');
  await page.getByTestId('fieldtest-skip').click();

  // Now on a route step. The handler is still registered -- the car keeps the
  // slot -- but the press must not be filed as evidence about this step. The
  // car sends `play`, `pause` and `stop` of its own accord, so a leaked probe
  // would attribute the car's own chatter to whichever step happened to be
  // open, as presses the operator never made.
  // WITHOUT LEAVING THE RUN. This used to call `logText`, which taps Pause to
  // reach the diagnostic panel -- so `active` went false, the re-entry below
  // landed on the START GATE, and the press was made with no step mounted at
  // all. `fieldtest-wheel` only exists inside the running screen, so
  // `toHaveCount(0)` held for the wrong reason entirely: a probe that really
  // did leak onto a route step passed this test.
  const before = (await rawLog(page)).split('field-test-arrival').length;
  // Still on the route step, and asserted as such before anything is pressed.
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
  const title = await page.getByTestId('fieldtest-title').innerText();
  expect(title, 'the run is not on a step any more').not.toMatch(/wheel/i);
  expect(await press(page, 'nexttrack')).toBe(true);
  await expect(page.getByTestId('fieldtest-wheel')).toHaveCount(0);

  const after = (await rawLog(page)).split('field-test-arrival').length;
  expect(after, 'a press on a non-wheel step was filed as step evidence').toBe(before);
});

/**
 * THE MEDIA SLOT, TAKEN AND GIVEN BACK.
 *
 * `holdAudioFocus('speech')` is not decoration around the wheel steps -- it
 * IS what makes the wheel reach this app at all. A phone routes a transport
 * button to whichever app it currently considers to be playing, so an app
 * that has spoken and fallen silent has already lost the button by the time
 * the driver reaches for it. That is the 2026-09-19 fault: presses that work
 * during speech and fail in the gap.
 *
 * Deleting both calls left every test green, so the suite could not tell the
 * fix from its absence.
 */
test('it holds the media slot for the run and lets go on the way out', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await endRun(page);

  const text = await logText(page);
  // Taken, and taken for the RUN rather than for one utterance -- the hold is
  // what survives the silence between two lines.
  expect(text, 'the run never claimed the media slot').toMatch(/focus\s+hold\b/);
  // ...and handed back. Keeping it leaves a silent looping element playing
  // after the operator has gone back to music: the app holding the
  // now-playing slot against a driver who did not ask it to.
  expect(text, 'the run ended still holding the media slot').toMatch(/focus\s+release\b/);
  expect(text.lastIndexOf('focus release')).toBeGreaterThan(text.indexOf('focus hold'));
});

/**
 * THE MICROPHONE, SHUT.
 *
 * `mic-route` opens it deliberately. Nothing asserted it was ever closed
 * again -- and leaving it open does not merely waste battery: an open
 * microphone holds the car in its hands-free profile, which takes the wheel
 * and drags playback to the earpiece. Ending the run in that state leaves the
 * operator's next drill quiet with dead buttons, for a reason that has
 * nothing to do with the drill. They have hit a stuck microphone once
 * already.
 */
test('the microphone is shut when the run ends, not left holding the car', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'mic-route');
  await endRun(page);

  const text = await logText(page);
  const opened = text.lastIndexOf('toggle-on');
  const closed = text.lastIndexOf('toggle-off');
  expect(opened, 'the microphone step never opened it').toBeGreaterThan(-1);
  expect(closed, 'the run ended with the microphone still on').toBeGreaterThan(opened);
});

/**
 * "I need it to set the settings." The existing version of this checked audio
 * and clips only; `voice` and `eyesFree` were declared by the steps and
 * asserted by nothing, so a step could describe a state it never entered and
 * the log would file the answer as though it had.
 */
test('a step that declares voice and eyes-free actually enters them', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'mic-route');
  await endRun(page);

  const text = await logText(page);
  // Step one declares eyes-free; the microphone step declares voice. Both are
  // session state rather than stored settings, so the log is where they show.
  expect(text, 'no step ever entered eyes-free').toContain('eyes-free-on');
  expect(text, 'the microphone step never opened the microphone').toMatch(
    /toggle-on.*field-test/,
  );
});

/**
 * THE ANSWER BUTTONS DO NOT MOVE WHEN THE EVIDENCE ARRIVES.
 *
 * The evidence region is empty when a step opens and fills at `say-end` --
 * the instant the line finishes, which is the instant the operator reaches to
 * answer where it came from. With no reserved height the whole answer stack
 * was pushed down 53px (74px for the long "the recording broke part way
 * through" text), more than one 60px button pitch. A thumb aimed at one
 * button lands on the one above it, and `answer()` stamps and advances, so
 * the run records the opposite of what was heard with no way back.
 *
 * Measured in pixels rather than asserted about CSS, because the rule that
 * was supposed to prevent this was described in a code comment for a week
 * without ever being written.
 */
test('the answer buttons hold still when the evidence appears', async ({ page }) => {
  await captureWheel(page);
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'The wheel, while it is talking');

  const firstAnswer = page.getByTestId('fieldtest-answers').getByRole('button').first();
  const evidence = page.getByTestId('fieldtest-evidence');
  await expect(evidence).toContainText('Waiting for a wheel button');

  const before = await firstAnswer.boundingBox();
  // A wheel press is the evidence line this project can actually produce:
  // under `?e2e=1` speech is swallowed before a path is chosen, so the
  // "Played from" line only ever appears in the audio project. The reserved
  // height is the same rule for both, and the wheel line is the one that
  // grows fastest once presses accumulate.
  await press(page, 'nexttrack');
  await expect(evidence).toContainText('1 press');
  await press(page, 'previoustrack');
  await expect(evidence).toContainText('2 presses');
  const after = await firstAnswer.boundingBox();

  expect(before, 'no answer button').not.toBeNull();
  expect(after).not.toBeNull();
  const moved = Math.abs((after?.y ?? 0) - (before?.y ?? 0));
  expect(moved, `the answer stack moved ${moved}px when the evidence arrived`).toBeLessThanOrEqual(
    2,
  );
});

/**
 * ...and the exits stay where they are from step to step. Finish used to
 * travel 336px across a run and land, on two steps, exactly where the
 * previous step's answer button had been -- so the thumb position trained by
 * one step was the run-ending control on the next.
 */
test('the exits stay in one place across steps with different answer counts', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  const finish = page.getByTestId('fieldtest-finish');
  const seen: number[] = [];
  for (let i = 0; i < 8; i++) {
    const box = await finish.boundingBox();
    if (box) seen.push(Math.round(box.y));
    const skip = page.getByTestId('fieldtest-skip');
    if (await skip.isDisabled()) break;
    await skip.click();
    await expect(page.getByTestId('fieldtest-answers')).toBeVisible();
  }

  const spread = Math.max(...seen) - Math.min(...seen);
  expect(spread, `Finish moved ${spread}px across steps: ${seen.join(', ')}`).toBeLessThanOrEqual(2);
});



/**
 * Controls a mutation run walked straight through.
 *
 * Every assertion below corresponds to a single-point change that broke the
 * screen and passed all 4502 tests, because no test ever pressed the control
 * in question. `Back` was the worst: flipping `- 1` to `+ 1` makes it move
 * FORWARD, so an operator who mis-taps at 70mph and reaches for Back skips
 * the step instead of returning to it, silently.
 */
test('Back goes back, and the run knows it moved', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  const title = page.getByTestId('fieldtest-title');
  const first = await title.innerText();
  await page.getByTestId('fieldtest-skip').click();
  const second = await title.innerText();
  expect(second, 'the run did not advance, so Back cannot be tested').not.toBe(first);

  await page.getByTestId('fieldtest-prev').click();
  await expect(title, 'Back did not return to the previous step').toHaveText(first);
});

test('Back is unavailable on the first step rather than wrapping round', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await expect(page.getByTestId('fieldtest-prev')).toBeDisabled();
});

/**
 * An answer reaches the export joinable to the step that produced it.
 *
 * RENAMED, and the docblock moved with the property. This used to be called
 * "an answer is recorded together with the voice that spoke the line" and to
 * claim that dropping `paths` from the stamp made every route answer
 * unattributable -- while asserting only `step=` and `answer=`, so dropping
 * `paths` left it green. The property IS covered, by the identically named
 * test in `field-test-audio.spec.ts`, which runs without `?e2e=1` and
 * asserts `paths` matches /clip|tts/ -- but two tests shared one name across
 * two projects and the one a reader greps first was the vacuous one.
 */
test('an answer reaches the log with its step and its response', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  // Answer the first route step, which speaks before it asks.
  await expect(page.getByTestId('fieldtest-answers')).toBeVisible();
  const answer = page.getByTestId('fieldtest-answers').locator('button').first();
  await expect(answer).toBeEnabled();
  await page.waitForTimeout(400);
  await answer.click();

  const text = await logText(page);
  const line = text.split('\n').find((l) => l.includes('test  answer'));
  expect(line, 'no answer was recorded at all').toBeTruthy();
  expect(line, 'the answer does not say which step it belongs to').toMatch(/step=/);
  expect(line, 'the answer does not carry the response').toMatch(/answer=/);
});

/**
 * Skipping is the operator saying "I could not do this one at speed", which
 * is the single most useful thing a run can tell the protocol's author -- and
 * it only shows up if it is recorded. Every e2e that pages the run uses Skip,
 * and none of them looked for it in the log.
 */
test('a skipped step says so in the log', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await page.getByTestId('fieldtest-skip').click();

  const text = await logText(page);
  expect(text, 'a skip left no trace').toMatch(/test\s+step-skipped/);
});

/**
 * The two-tap latch on Finish exists because Finish sits under the answer
 * stack at bottom-right, which is the easiest thing to hit with a thumb
 * coming off the wheel, and ending a run discards it. Leaving the latch armed
 * across a step change re-opens that exactly one step later.
 */
test('an armed Finish disarms when the step changes', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  const finish = page.getByTestId('fieldtest-finish');
  await finish.click();
  await expect(finish).toHaveText('Tap again to end');

  // Think better of it and carry on with the run instead.
  await page.getByTestId('fieldtest-skip').click();
  await expect(finish, 'Finish stayed armed into the next step').not.toHaveText('Tap again to end');
  // ...and the run is still up, rather than having ended on that one tap.
  await expect(page.getByTestId('fieldtest-answers')).toBeVisible();
});

/**
 * The restore has to survive the reload, which is the case it exists for.
 *
 * `restoreRef` captured the operator's settings on the running screen's first
 * render. The update check reloads the app mid-drive by design -- that is
 * what Resume is for -- and after a reload the screen mounts fresh and
 * captures the settings the PROTOCOL wrote as though they were the
 * operator's. So the restore handed back `volume: 1.5` and
 * `wheelMode: 'answer'` permanently, and the next drill ran at 150% with the
 * recorded voice off. The snapshot lives with the run now.
 */
test('the settings come back even when the app reloads mid-run', async ({ page }) => {
  await withSettings(page, { audio: { volume: 0.4, useClips: true }, drill: { wheelMode: 'talk' } });

  const stored = () =>
    page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));

  await openTest(page, 'Car, parked');
  // Past the steps that raise the volume and switch the recorded voice off,
  // so the persisted settings are the protocol's rather than the operator's.
  await goToStep(page, 'route-after-mic-2t');
  const during = await stored();
  expect(during.audio.useClips, 'the run never changed anything to restore').toBe(false);

  // The mid-drive reload. `withSettings` seeds through `addInitScript`, which
  // RE-RUNS on every navigation -- so without removing it the reload would put
  // the operator's settings back by itself and this test could not fail. The
  // real update-check reload has no such helper: it comes back to whatever the
  // protocol last wrote.
  await page.evaluate(() => window.localStorage.setItem('e2e.noReseed', '1'));
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await page.getByTestId('fieldtest-resume').click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();

  await endRun(page);

  const after = await stored();
  expect(after.audio.volume, 'the reload made the raised volume permanent').toBe(0.4);
  expect(after.audio.useClips, 'the reload made the recorded voice stay off').toBe(true);
  expect(after.drill.wheelMode, 'the reload made the wheel mode stick').toBe('talk');
});

/**
 * The mute disc is pinned bottom-left with 76px of clearance for the tab bar.
 * A running field test stands the tab bar down, which leaves that space empty
 * and drops the disc onto the run's own nav row -- so reaching bottom-left for
 * Back mutes the app instead, and the run only re-asserts `muted: false` on
 * the NEXT step change.
 */
test('nothing else is sitting on top of Back during a run', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  const back = page.getByTestId('fieldtest-prev');
  const box = await back.boundingBox();
  expect(box, 'Back is not on screen at all').toBeTruthy();

  // Sampled across the width of the target, because the overlap was only over
  // its left portion -- a single centre-point check would have missed it.
  for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const x = box!.x + box!.width * fraction;
    const y = box!.y + box!.height / 2;
    const owner = await page.evaluate(
      ([px, py]) => {
        const el = document.elementFromPoint(px as number, py as number);
        return el?.closest('[data-testid]')?.getAttribute('data-testid') ?? el?.className ?? '(none)';
      },
      [x, y],
    );
    expect(owner, `something else owns Back at ${Math.round(fraction * 100)}% across`).toBe(
      'fieldtest-prev',
    );
  }
});

/**
 * Silence is indistinguishable from the app having died.
 *
 * Six steps declare no line -- the wheel steps that only want a press, the
 * ambient measurement and the free-form one -- and the previous step's
 * cleanup cancels whatever was still playing. So answering a route step and
 * landing on one of these produced total silence, on a screen the operator is
 * explicitly not supposed to be looking at.
 */
test('a step that speaks no line still makes a sound and reads itself out', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  const before = await saidCount(page);
  await goToStep(page, 'Skip-back');
  await expect
    .poll(() => saidCount(page), { timeout: 10_000 })
    .toBeGreaterThan(before);

  const said = await page.evaluate(() => window.__speechLog ?? []);
  expect(said, 'arriving at a silent step made no sound at all').toContain('chime:good');
  // ...AND THE INSTRUCTION ITSELF, asserted separately. A bare count would be
  // satisfied by the chime alone, so the two fixes have to be distinguishable
  // or one of them can be removed with this still green.
  const instruction = await page.getByTestId('fieldtest-instruction').innerText();
  expect(
    said.some((line) => line.includes(instruction.slice(0, 24))),
    'the step was never read out, only chimed',
  ).toBe(true);
});

test('the repeat control is on every step, reading the instruction where there is no line', async ({
  page,
}) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  const again = page.getByTestId('fieldtest-again');
  await expect(again, 'the repeat control is missing on a step that speaks').toBeVisible();

  await goToStep(page, 'Skip-back');
  await expect(again, 'the repeat control vanished on a silent step').toBeVisible();
  await expect(again).toHaveText('Read it to me');

  const before = await saidCount(page);
  await again.click();
  await expect.poll(() => saidCount(page), { timeout: 10_000 }).toBeGreaterThan(before);
});

/**
 * Pause has to actually pause.
 *
 * It used to log a line and navigate, leaving `active: true` in module state.
 * `readFieldTestRun` returns that object directly, so `coerce`'s "never
 * restore as active" rule -- which only covers a read from storage after a
 * reload -- did not apply to re-entry within the same page load. Tapping the
 * Field test tab again skipped the start gate and mounted the running screen,
 * which re-applies the step's setup: on `mic-route` that opens the microphone
 * from one navigation tap, with an abandoned run as the only consent.
 */
test('pausing hands the run back rather than resuming it behind the wheel', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'Skip-back');

  await page.getByTestId('fieldtest-pause').click();
  await page.getByTestId('fieldtest-open').click();

  // The start gate, not the running screen.
  await expect(
    page.getByTestId('fieldtest-resume'),
    're-entering after Pause mounted the run instead of offering Resume',
  ).toBeVisible();
  await expect(page.getByTestId('fieldtest-answers')).toHaveCount(0);

  // ...and Resume still has the place and the ticks, which is the whole point
  // of pausing rather than finishing.
  await page.getByTestId('fieldtest-resume').click();
  await expect(page.getByTestId('fieldtest-title')).toHaveText('Skip-back');
});

/**
 * Nothing the thumb reaches for may move between steps.
 *
 * Measured, not asserted about in the abstract: the stack used to travel 145px
 * across the run, because it was top-anchored under a header block whose height
 * depends on how far the instruction wraps and on whether the step has a repeat
 * button. Button pitch is 60px, so on the `wheel-gap` -> `wheel-back` pair the
 * 69px shift put a different answer under the same pixel — and `answer()`
 * stamps and advances on one tap, with no undo and no debounce.
 *
 * THE BOTTOM EDGE, NOT THE TOP, and that is the whole point of the change this
 * replaced a test for. The stack is bottom-anchored now, so a step with fewer
 * answers grows a gap ABOVE the stack rather than leaving one below it: the
 * tops measure 412 / 472 / 532 / 592 for four, three, two and one answers, and
 * a test on the top would now fail for the reason the layout is correct. What
 * has to hold still is the edge the thumb arrives at, plus the row of controls
 * below it.
 */
test('nothing the thumb reaches for moves between steps', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  const seen: { step: string; bottom: number; nav: number; slots: number[] }[] = [];
  for (let i = 0; i < 40; i += 1) {
    const answers = page.getByTestId('fieldtest-answers');
    await expect(answers).toBeVisible();
    const box = (await answers.boundingBox())!;
    // SLOTS, NOT BUTTONS. A wheel step with no answer for a slot renders a
    // held-open gap there (see `WHEEL_SLOTS`), which is the mechanism that
    // stops the answers below it moving up. Counting only buttons makes
    // "third from the bottom" mean a different position on a step with a gap
    // in it, and then this test fails for the reason the layout is right.
    const buttons = answers.locator('[data-testid^="fieldtest-answer-"]');
    const n = await buttons.count();
    // Indexed FROM THE BOTTOM, so slot 0 is the position nearest the nav row
    // on every step regardless of how many answers the step offers.
    const slots: number[] = [];
    for (let k = n - 1; k >= 0; k -= 1) {
      const b = (await buttons.nth(k).boundingBox())!;
      slots.push(Math.round(b.y + b.height / 2));
    }
    seen.push({
      step: await page.getByTestId('fieldtest-title').innerText(),
      bottom: Math.round(box.y + box.height),
      nav: Math.round((await page.getByTestId('fieldtest-skip').boundingBox())!.y),
      slots,
    });
    const skip = page.getByTestId('fieldtest-skip');
    if (await skip.isDisabled()) break;
    await skip.click();
  }

  expect(seen.length, 'the run did not page through its steps').toBeGreaterThan(15);

  const spread = (ns: number[]) => Math.max(...ns) - Math.min(...ns);
  const bottoms = spread(seen.map((t) => t.bottom));
  expect(
    bottoms,
    `the bottom of the stack moved ${bottoms}px across the run: ${JSON.stringify(
      seen.map((t) => [t.step, t.bottom]),
    )}`,
  ).toBeLessThanOrEqual(2);

  // Back and Skip are pressed on every step, so they are the two pixels that
  // matter most, and they sit below the stack rather than in it.
  const navs = spread(seen.map((t) => t.nav));
  expect(
    navs,
    `Skip moved ${navs}px across the run: ${JSON.stringify(seen.map((t) => [t.step, t.nav]))}`,
  ).toBeLessThanOrEqual(2);

  // Every step offers at least one answer, so slot 0 exists throughout and is
  // the one the thumb finds without looking.
  const nearest = spread(seen.map((t) => t.slots[0]!));
  expect(nearest, `the answer nearest the nav row moved ${nearest}px`).toBeLessThanOrEqual(2);

  // ...and so does every deeper slot a step actually has. A step with three
  // answers must put its second-from-bottom where a four-answer step put its
  // second-from-bottom, or counting up from the nav row by feel is worthless.
  const byDepth = new Map<number, number[]>();
  for (const t of seen) {
    t.slots.forEach((y, depth) => byDepth.set(depth, [...(byDepth.get(depth) ?? []), y]));
  }
  for (const [depth, ys] of byDepth) {
    expect(spread(ys), `answer slot ${depth} up from the nav row moved between steps`).toBeLessThanOrEqual(
      2,
    );
  }
});

/**
 * The narrower property the spread above exists to guarantee: no pixel the
 * operator can press may mean one thing on a step and something else on the
 * next WITHOUT the stack having moved.
 *
 * Two steps that ask different questions naturally carry different labels, and
 * no layout can prevent that. What a layout can prevent is a label arriving at
 * a pixel because the stack shifted under it, which is why this pins position
 * by depth from the nav row and reads the label back by hit-testing that point
 * rather than by trusting the DOM order.
 */
test('no answer button changes place under the operator between steps', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  /** Each answer, deepest-last, as the hit test at its own centre sees it. */
  async function stack(): Promise<{ y: number; label: string | null; gap: boolean }[]> {
    // Slots, including the held-open gaps: see the note in the test above.
    const buttons = page
      .getByTestId('fieldtest-answers')
      .locator('[data-testid^="fieldtest-answer-"]');
    const n = await buttons.count();
    const out: { y: number; label: string | null; gap: boolean }[] = [];
    for (let k = n - 1; k >= 0; k -= 1) {
      const box = (await buttons.nth(k).boundingBox())!;
      const y = box.y + box.height / 2;
      const id = (await buttons.nth(k).getAttribute('data-testid')) ?? '';
      out.push({
        y: Math.round(y),
        gap: id.startsWith('fieldtest-answer-gap-'),
        // HIT-TESTED, not read off the locator: a button the layout has pushed
        // under another element answers here with the element on top of it,
        // which is the failure a thumb actually meets.
        label: await page.evaluate(
          ([px, py]) => document.elementFromPoint(px as number, py as number)?.textContent ?? null,
          [box.x + box.width / 2, y],
        ),
      });
    }
    return out;
  }

  let previous: { y: number; label: string | null; gap: boolean }[] | null = null;
  let compared = 0;
  for (let i = 0; i < 40; i += 1) {
    await expect(page.getByTestId('fieldtest-answers')).toBeVisible();
    const current = await stack();
    for (const slot of current) {
      // A GAP ANSWERS WITH WHATEVER IS UNDER IT, by design: it takes no
      // pointer events precisely so a remembered position lands on nothing.
      if (slot.gap) continue;
      expect(slot.label, `an answer at y=${slot.y} is covered by something else`).not.toBeNull();
    }
    if (previous) {
      for (let depth = 0; depth < Math.min(current.length, previous.length); depth += 1) {
        expect(
          Math.abs(current[depth]!.y - previous[depth]!.y),
          `answer slot ${depth} up from the nav row moved between steps`,
        ).toBeLessThanOrEqual(2);
        compared += 1;
      }
    }
    previous = current;

    const skip = page.getByTestId('fieldtest-skip');
    if (await skip.isDisabled()) break;
    await skip.click();
  }

  expect(compared, 'no pair of consecutive steps was ever compared').toBeGreaterThan(20);
});

/**
 * A bump in the road must not answer two steps.
 *
 * `answer()` stamps and advances on one tap, and had no debounce anywhere, so
 * a press that bounces answers step N and then step N+1 with whatever button
 * happens to sit under that point. Nothing can un-stamp it:
 * `markFieldTestStamped` only ever increments, and Back returns to the step
 * without removing the answer, so the log ends up holding two contradictory
 * answers for a step the operator never read.
 */
test('a bounced tap does not answer the next step as well', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await expect(page.getByTestId('fieldtest-progress')).toContainText('step 1 of');

  const answers = page.getByTestId('fieldtest-answers').locator('button');
  await expect(answers.first()).toBeEnabled();
  // PAST THE GUARD ON THIS STEP, so the first tap is a real answer and the
  // second is the bounce. The window is measured from the step opening.
  await page.waitForTimeout(400);

  // The bounce: two presses inside the window a rough road produces. The
  // second lands on the NEXT step's stack, at the same pixel.
  await answers.first().click();
  await answers.first().click({ delay: 0, force: true });

  // One step advanced, not two.
  await expect(
    page.getByTestId('fieldtest-progress'),
    'the bounce answered the next step too',
  ).toContainText('step 2 of');

  // ...and the swallowed tap is recorded, because a control that silently
  // does nothing is its own diagnostic problem. TWO WAYS TO SWALLOW IT, and
  // the test accepts either: the 350ms bounce guard, and -- on a step that
  // speaks -- the answers refusing taps until the line has been heard. Both
  // write a line and both now chime; what must NOT happen is a second answer.
  const text = await logText(page);
  expect(
    text,
    'the second tap was neither refused nor ignored, so nothing swallowed it',
  ).toMatch(/test\s+answer-(ignored|blocked)/);
  const answered = text.split('\n').filter((l) => /test\s+answer /.test(l));
  expect(answered.length, `the bounce recorded ${answered.length} answers`).toBe(1);
});

/**
 * The step that measures the wheel WITH the microphone open must not be
 * answerable with the microphone shut.
 *
 * `wheel-with-mic` declares `awaitListening` and no lines. `setSpeaking(true)`
 * was guarded on `lines.length > 0`, so the one step whose entire subject is
 * the microphone left its answer stack live for the whole gate -- measured
 * headless at 9,998ms, and ~3.5s on the real drive. The operator could press
 * the wheel and stamp the answer before the recogniser had started, which is
 * the false negative the gate was added to prevent, reachable through the fix
 * for it.
 */
test('the step cannot be answered while it is still waiting for the microphone', async ({
  page,
}) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'The wheel, with the microphone open');

  // THE LABEL FIRST, AND THAT ORDER MATTERS. Arriving at the step, the answers
  // are briefly disabled by the PREVIOUS step's `speaking` before this step's
  // own state lands -- so an immediate `toBeDisabled()` passes on the stale
  // flag, resolves in milliseconds and never re-checks. Written that way round
  // it stayed green with the gate's block deleted, which is the whole defect
  // it was supposed to pin. Waiting for the label first proves the mic flag is
  // the live reason before anything is asserted about the buttons.
  await expect(page.getByTestId('fieldtest-again')).toHaveText('Waiting for the microphone…');

  const answers = page.getByTestId('fieldtest-answers').locator('button');
  await expect(
    answers.first(),
    'the answers were live while the step was still waiting for the microphone',
  ).toBeDisabled();
});

/**
 * ...and it says so immediately, not ten seconds later.
 *
 * The arrival chime sat below the gate, so on the one step with the longest
 * silence the "I am alive" cue arrived last: measured, `__speechLog` was empty
 * for 9,998ms. Silence at the wheel is indistinguishable from the app having
 * died, which is the entire reason the chime exists.
 */
test('a step that waits for the microphone still says it has arrived at once', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  await page.evaluate(() => {
    window.__speechLog = [];
  });
  await goToStep(page, 'The wheel, with the microphone open');

  // Well inside the 10s gate: if the cue is behind the gate this cannot pass.
  await expect
    .poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 2_500 })
    .toContain('chime:good');
});

/**
 * ...INCLUDING THE GATED STEPS THAT DO HAVE A LINE, which the first version of
 * that fix missed.
 *
 * `mic-route` and its pair wait up to ten seconds for the recogniser before
 * they speak, and `route-after-mic` waits for it to let go. Chiming only when
 * a step had no line at all left five steps -- the five where the operator is
 * waiting to place a sound they have not heard yet -- arriving in total
 * silence.
 */
test('a gated step with a line still says it has arrived before the wait', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  await goToStep(page, 'mic-route-2');
  await page.evaluate(() => {
    window.__speechLog = [];
  });
  // Back and forward again, so arrival at the gated step happens with the log
  // already empty.
  await page.getByTestId('fieldtest-prev').click();
  await page.getByTestId('fieldtest-skip').click();
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'mic-route-2');

  await expect
    .poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 2_500 })
    .toContain('chime:good');
  // ...and the line itself has NOT gone out yet: the cue is the cue, not the
  // sample arriving early.
  expect(
    await page.evaluate(() => window.__speechLog ?? []),
    'the measured line was spoken inside the gate',
  ).not.toContain('Basic stand versus dealer six.');
});

/**
 * A gate the operator walked out of still has to say what it saw.
 *
 * The poll loop returned straight out of `say()` on a fence bump, ahead of the
 * `mic-settled` / `mic-never-live` entry -- so a step left during the wait was
 * stamped with nothing recording whether the microphone had ever come up, and
 * the analysis had no way to know the sample was unconditioned.
 */
test('leaving a step mid-gate still records what the microphone was doing', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'The wheel, with the microphone open');

  // Leave while the gate is still running -- it waits 10s here.
  await page.getByTestId('fieldtest-prev').click();

  await expect
    .poll(
      async () => {
        const text = await logText(page);
        return text.includes('abandoned=true');
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});

/**
 * Starting over after a mid-drive reload must not adopt the protocol's own
 * settings as the operator's.
 *
 * The snapshot exists because the run seizes the volume and the recorded voice.
 * It was taken from the CURRENT settings at every start -- correct at a true
 * start, and wrong in exactly the case it exists for. After a reload the React
 * cleanup never ran, so nothing was restored, so what is on disk is the
 * protocol's state. The gate offers Resume and "Start over from step 1", and
 * Start over captured volume 1.5 and the protocol's wheel mode as the new
 * `before`. Finishing then wrote those back as the operator's, permanently,
 * poisoning every drill afterwards.
 */
test('starting over after a reload does not adopt the protocol settings as the operator\'s', async ({
  page,
}) => {
  await withSettings(page, { audio: { volume: 0.4, useClips: true }, drill: { wheelMode: 'talk' } });

  const stored = () =>
    page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));

  await openTest(page, 'Car, parked');
  await goToStep(page, 'route-after-mic-2t');
  const during = await stored();
  expect(during.audio.useClips, 'the run never changed anything to restore').toBe(false);

  // The reload, with the seeding helper disarmed so it cannot put the
  // operator's settings back by itself.
  await page.evaluate(() => window.localStorage.setItem('e2e.noReseed', '1'));
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();

  // START OVER, not Resume -- the path that used to re-snapshot. Two taps,
  // because start-over discards the run and is armed like Finish.
  await startRun(page);
  await endRun(page);

  const after = await stored();
  expect(after.audio.volume, 'starting over made the raised volume permanent').toBe(0.4);
  expect(after.audio.useClips, 'starting over made the recorded voice stay off').toBe(true);
  expect(after.drill.wheelMode, 'starting over made the wheel mode stick').toBe('talk');
});

/**
 * A setting changed somewhere else during a run must survive the restore.
 *
 * Everything outside the five fields the protocol writes came from a snapshot
 * frozen at the running screen's first render, so finishing a run wrote that
 * whole blob back -- reverting anything another tab had changed meanwhile. Two
 * tabs on a phone is trivially easy, which is why `crossTab.ts` exists; this
 * put the stale writeback back in through the fix for the volume bug.
 */
test('a setting changed elsewhere during a run is not reverted by the restore', async ({ page }) => {
  await withSettings(page, { audio: { volume: 0.4, useClips: true, rate: 1 } });

  const stored = () =>
    page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));

  await openTest(page, 'Car, parked');
  await goToStep(page, 'A short line');

  // Another tab writes a field the protocol never touches, and announces it
  // the way the real cross-tab channel does.
  await page.evaluate(() => {
    const key = 'bjtrainer.settings.v1';
    const blob = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    blob.audio = { ...blob.audio, rate: 1.4 };
    window.localStorage.setItem(key, JSON.stringify(blob));
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue: JSON.stringify(blob), storageArea: localStorage }),
    );
  });

  await endRun(page);

  const after = await stored();
  expect(after.audio.rate, "the restore reverted another tab's change").toBe(1.4);
  // ...and the fields the protocol DID take are still handed back.
  expect(after.audio.volume, 'the run kept the volume it raised').toBe(0.4);
  expect(after.audio.useClips, 'the run kept the recorded voice off').toBe(true);
});

/**
 * The closing edge of the microphone gate, on the sample that carried the
 * headline conclusion.
 *
 * `route-after-mic` was the protocol's only post-microphone route sample and
 * it was taken during the teardown: the step effect calls `setVoiceOn(false)`
 * and `say()` in one synchronous body, and `stop()` only requests the end of
 * the session -- the phone releases the hands-free link afterwards, on its own
 * schedule. So "the microphone is shut again", printed on the screen and
 * assumed by every reading of the answer, was a claim nothing had checked.
 */
test('the step after the microphone waits before it speaks', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  // Parked on the step BEFORE, so the log can be emptied with the arrival
  // still ahead of it -- walking all the way there first fills it with every
  // line spoken on the way.
  await goToStep(page, 'The wheel, with the microphone open');
  await page.evaluate(() => {
    window.__speechLog = [];
  });
  await page.getByTestId('fieldtest-skip').click();
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute(
    'data-step',
    'route-after-mic',
  );

  // Straight after arrival the line must NOT have gone out. Without the gate
  // it is spoken within a few milliseconds of the microphone being asked to
  // stop, which is the defect: the sample is taken mid-teardown and then
  // labelled "after".
  const spokenAtOnce = await page.evaluate(() => window.__speechLog ?? []);
  expect(
    spokenAtOnce,
    'the line went out before the microphone had been given time to go',
  ).not.toContain('Basic hit versus dealer nine.');

  // ...and it does still speak, once the settle is over. A gate that never
  // opens would pass the assertion above and break the protocol.
  await expect
    .poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 8_000 })
    .toContain('Basic hit versus dealer nine.');
});

/**
 * ...and the wait is written down, because it is a declared number rather than
 * an observation.
 *
 * Nothing in the browser exposes the hands-free link being released, so the
 * settle is a guess. A drive whose route still moves has to be able to tell
 * whether the guess was simply too short, which means the log has to carry it.
 */
test('the wait for the microphone to close is recorded with the sample', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'route-after-mic');
  await expect(page.getByTestId('fieldtest-again')).not.toHaveText('Waiting for the microphone…', {
    timeout: 8_000,
  });

  const text = await logText(page);
  expect(text, 'nothing in the log says the microphone was waited for').toContain('mic-stopped');
  expect(text, 'the settle was not recorded, so the sample cannot be calibrated').toContain(
    'settleMs=1500',
  );
});

/**
 * Whether the car is moving had no consumer at all.
 *
 * `motionForCondition` was exported and tested and called by nothing, so the
 * two driven conditions and the two parked ones rendered identically -- on the
 * one screen the operator reads with their eyes, before a run that seizes the
 * volume and starts talking. Starting a driven condition at speed means
 * setting up a twenty-three step protocol while moving, which is the single
 * thing the eyes-free design exists to avoid.
 */
test('a driven condition says so before the run starts', async ({ page }) => {
  await withSettings(page, {});
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  if ((await page.getByTestId('fieldtest-finish').count()) > 0) {
    await endRun(page);
    await page.getByTestId('fieldtest-open').click();
  }

  await page.getByRole('button', { name: 'Car, parked', exact: true }).click();
  await expect(
    page.getByTestId('fieldtest-motion-warning'),
    'a parked condition was warned about as though it were driven',
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Freeway', exact: true }).click();
  await expect(
    page.getByTestId('fieldtest-motion-warning'),
    'a driven condition started with nothing said about it',
  ).toBeVisible();
});

/**
 * A stamp that nothing renders cannot do the job the code says it is for:
 * "so a step done at a red light is visibly done when you next look at the
 * screen, and so a double-tap is visibly two rather than silently one."
 */
test('a stamped step is visibly stamped when you come back to the list', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await answerStep(page, 'fieldtest-answer-route-car');

  await page.getByTestId('fieldtest-pause').click();
  await page.getByTestId('fieldtest-open').click();

  await expect(
    page.getByTestId('fieldtest-tick-route-1'),
    'the step answered a moment ago does not read as done',
  ).toBeVisible();
  await expect(
    page.getByTestId('fieldtest-tick-route-2'),
    'a step never answered reads as done',
  ).toHaveCount(0);
});

test('the ticks belong to the condition they were measured under', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await answerStep(page, 'fieldtest-answer-route-car');
  await page.getByTestId('fieldtest-pause').click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-tick-route-1')).toBeVisible();

  // The operator pulls out of the car park. The place and the ticks are kept
  // on purpose -- but the car-park answer is not a freeway result.
  await page.getByRole('button', { name: 'Freeway', exact: true }).click();
  await expect(
    page.getByTestId('fieldtest-tick-route-1'),
    'an answer given parked was shown as a freeway result',
  ).toHaveCount(0);
});

/**
 * The tap had no sound, and the operator is not looking at the screen.
 *
 * Eyes-free at speed a tap that registered and a tap that missed the button
 * felt identical -- on a six-button stack, where a near miss is the known
 * hazard and the reason the bounce guard exists at all.
 */
test('answering makes a sound, and the sound follows the button', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  await page.evaluate(() => {
    window.__speechLog = [];
  });
  await answerStep(page, 'fieldtest-answer-route-car');
  await expect
    .poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 3_000 })
    .toContain('chime:attention');

  // ...and a different verdict sounds different, so hitting `bad` when `good`
  // was meant is audible rather than silently recorded.
  await goToStep(page, 'Can you hear the fallback at all?');
  await page.evaluate(() => {
    window.__speechLog = [];
  });
  await answerStep(page, 'fieldtest-answer-fallback-clear');
  await expect
    .poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 3_000 })
    .toContain('chime:good');
});


/**
 * The measure button used to latch on for the rest of the run.
 *
 * `measureWithWebAudio` RESOLVES when its signal is aborted rather than
 * throwing, so an abandoned measurement took the success path into `measure()`,
 * returned at the fence check, and never reached the `setMeasuring(false)` in
 * the `finally` — which is guarded by the same check that just failed.
 * `ambient` is the one step that cannot be performed without that control.
 */
test('leaving a measurement running does not kill the measure button', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'How loud is it in here');

  const measure = page.getByTestId('fieldtest-measure');
  // The window opens by itself once the instruction has been read.
  await expect(measure).toHaveText(/listening/i, { timeout: 10_000 });
  // Leave while the five-second window is still open. The aborted window's
  // own `finally` cannot clear `measuring` (the fence has moved on), so the
  // arrival has to -- and the next step's "Say it again", which is held
  // while measuring, is where a stale `measuring` shows.
  await page.getByTestId('fieldtest-skip').click();
  await expect(page.getByTestId('fieldtest-title')).not.toHaveText('How loud is it in here');
  await expect(
    page.getByTestId('fieldtest-again'),
    'the aborted window left the next step measuring',
  ).toBeEnabled({ timeout: 10_000 });
});

/**
 * A settings change made between two legs used to be written away by the second.
 *
 * `startFieldTestRun` prefers a stored `before` over the live settings — right
 * after a mid-drive reload, wrong once the snapshot has actually been handed
 * back. Turning the recorded voice on between the car-park leg and the freeway
 * leg is the ordinary case, not the exception.
 */
test('a setting changed between two runs survives the second run', async ({ page }) => {
  await withSettings(page, { audio: { useClips: false } });
  const stored = () =>
    page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));

  await openTest(page, 'Car, parked');
  await endRun(page);
  await expect
    .poll(async () => (await stored()).audio?.useClips, { timeout: 3_000 })
    .toBe(false);

  // The operator turns the recorded voice on between the two legs. The harness
  // re-seeds settings on every navigation, so it is told not to: the whole
  // point is that this change is the operator's and survives.
  await page.evaluate(() => {
    window.localStorage.setItem('e2e.noReseed', '1');
    const raw = JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}');
    raw.audio = { ...raw.audio, useClips: true };
    window.localStorage.setItem('bjtrainer.settings.v1', JSON.stringify(raw));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await page.getByTestId('fieldtest-start').click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
  await endRun(page);

  await expect
    .poll(async () => (await stored()).audio?.useClips, {
      timeout: 3_000,
      message: 'the second run reverted a change the operator made between the two',
    })
    .toBe(true);
});

/**
 * The four steps that have a line AND a microphone gate read "Speaking…"
 * through up to ten seconds of total silence. The answers were correctly dead,
 * so the guard held; the label — the only thing telling the operator which
 * kind of not-ready they are in — said the opposite of the truth.
 */
test('a gated step with a line says it is waiting for the microphone, not speaking', async ({
  page,
}) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'mic-route');

  await expect(
    page.getByTestId('fieldtest-again'),
    'a step waiting for the microphone claimed to be speaking',
  ).toHaveText('Waiting for the microphone…');
});

/**
 * The closing gate's first wait measures a React round trip, not the
 * microphone: `controller.stop()` and `setStatus(IDLE)` are both synchronous,
 * so the reported state goes false long before the phone releases the
 * hands-free link. The entry has to say that rather than imply otherwise.
 */
test('the wait after the microphone says what it actually measured', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'route-after-mic');
  await expect(page.getByTestId('fieldtest-again')).not.toHaveText('Waiting for the microphone…', {
    timeout: 8_000,
  });

  const text = await logText(page);
  expect(text, 'nothing says the microphone was waited for').toContain('mic-stopped');
  // The declared settle, which is the only part doing real work...
  expect(text, 'the declared settle is not in the log').toContain('settleMs=1500');
  // ...and the app-side number, named for what it is.
  expect(text, 'the React round trip is still labelled as the recogniser letting go').toContain(
    'appLetGoAfterMs=',
  );
  expect(text, 'nothing records whether the recogniser was ever up').toContain('wasLive=');
});

/**
 * Everything the step effect emits used to carry no run, step or cond at all:
 * React destroys every cleanup for a commit before running any create, and the
 * context effect was declared after the step effect. The loss was systematic
 * along the protocol's independent variable, because `say()` only awaits
 * `prewarmClips()` when clips are ON — so the clip arm yielded long enough for
 * the context to land and the TTS arm did not.
 */
test('the step setup lands in the log attached to its own run and step', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  // Walk onto a clips-OFF step: the arm that used to lose its stamps.
  await goToStep(page, 'route-1t');

  const text = await logText(page);
  const setup = text.split('\n').filter((l) => l.includes('step-setup'));
  expect(setup.length, 'no step-setup reached the log').toBeGreaterThan(0);
  for (const line of setup) {
    expect(line, 'a step-setup line cannot be joined to its run').toMatch(/ run=[a-z0-9]+/);
    expect(line, 'a step-setup line does not say which condition it ran under').toMatch(
      / condition=[a-z]+/,
    );
  }
  // The `path=` half of this belongs in the real-audio project: under `?e2e=1`
  // speech is swallowed BEFORE a path is chosen, so no `path=tts` record exists
  // here to carry a run id. See field-test-audio.spec.ts.
});

/**
 * `run-start` is the line that marks a run's beginning, and it was the one line
 * that could not be joined to the run it opens: it was logged before
 * `startFieldTestRun` minted the id, from a screen with no ambient context.
 * `run-resume` wrote a 1-based ordinal into `step=`, the field every other line
 * uses for a step id.
 */
test('the lines that open and resume a run can be joined to it', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'A short line');
  await page.getByTestId('fieldtest-pause').click();
  await page.getByTestId('fieldtest-open').click();
  await page.getByTestId('fieldtest-resume').click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();

  const text = await logText(page);
  const start = text.split('\n').find((l) => l.includes('run-start'));
  expect(start, 'no run-start at all').toBeTruthy();
  expect(start, 'the run boundary cannot be joined to its own run').toMatch(/ run=[a-z0-9]+/);

  const resume = text.split('\n').find((l) => l.includes('run-resume'));
  expect(resume, 'no run-resume at all').toBeTruthy();
  expect(resume, 'run-resume put an ordinal in the step-id field').toContain('step=route-short');
  expect(resume, 'run-resume lost its position').toContain('atStep=');
});


/**
 * Marking is not answering, and the log has to carry both.
 *
 * "It moved while playing" and "it ended in the car" are both true of one
 * utterance, and the route list used to make the operator pick. The sharpest
 * evidence the protocol can collect therefore cost the reader the destination,
 * and the 2x2 the protocol is built around comes out uniform on exactly the
 * runs where something is happening.
 */
test('a mark does not answer the step, and is stamped with the answer that does', async ({
  page,
}) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  const title = await page.getByTestId('fieldtest-title').innerText();

  const moved = page.getByTestId('fieldtest-answer-route-moved');
  await expect(moved).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await moved.click();

  // Still here. A mark that advanced would be an answer by another name.
  await expect(
    page.getByTestId('fieldtest-title'),
    'marking an observation ended the step instead of noting it',
  ).toHaveText(title);
  // ...and it says so, for an operator who is not looking at the buttons.
  await expect(page.getByTestId('fieldtest-marks')).toContainText('It moved while playing');

  // The real answer ends the step and carries the mark with it.
  await page.getByTestId('fieldtest-answer-route-car').click();
  await expect(page.getByTestId('fieldtest-title')).not.toHaveText(title);

  const text = await logText(page);
  const stamped = text
    .split(String.fromCharCode(10))
    .filter((l) => l.includes(' answer ') && l.includes('answer=route-car'));
  expect(stamped.length, 'the answer never reached the log').toBeGreaterThan(0);
  expect(
    stamped.some((l) => l.includes('marks=route-moved')),
    'the answer was stamped without the observation marked alongside it',
  ).toBe(true);
});

/** A mis-tap in a moving car has to be undoable without leaving the step. */
test('a mark can be taken back with the same button', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  const moved = page.getByTestId('fieldtest-answer-route-moved');
  await expect(moved).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await moved.click();
  await expect(page.getByTestId('fieldtest-marks')).toBeVisible();
  await moved.click();
  await expect(
    page.getByTestId('fieldtest-marks'),
    'a mark armed by a bump could not be taken back',
  ).toHaveCount(0);
});


/**
 * Only the first leg of a page has a genuine "before the microphone".
 *
 * The four conditions run in one page and nothing the app does not own is torn
 * down between them — the phone's hands-free profile least of all. So from the
 * second leg on, the cells labelled "before the microphone" run in a session
 * that has already opened and closed it twice, and the protocol's headline
 * comparison is precisely before-mic against after-mic. The app cannot fix that
 * from inside the page, so it does the half it can (closes its own audio graph,
 * lets go of the media slot), says the half it cannot, and records which.
 */
test('a second leg in the same page says so, on screen and in the log', async ({ page }) => {
  await withSettings(page, {});
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();

  // Nothing to warn about on the first leg, which is the discriminating half:
  // a banner shown on every run would say nothing.
  await expect(page.getByTestId('fieldtest-session-warning')).toHaveCount(0);
  await page.getByRole('button', { name: 'Car, parked', exact: true }).click();
  await page.getByTestId('fieldtest-start').click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
  await endRun(page);

  // ...and the second leg, started WITHOUT a reload, is warned about.
  await page.getByTestId('fieldtest-open').click();
  await expect(
    page.getByTestId('fieldtest-session-warning'),
    'a leg running in a session that has already been through the microphone says nothing about it',
  ).toContainText('Force-quit');
  await page.getByTestId('fieldtest-start').click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();

  const text = await logText(page);
  const starts = text.split(String.fromCharCode(10)).filter((l) => l.includes('run-start'));
  expect(starts.length, 'both legs did not open').toBeGreaterThanOrEqual(2);
  expect(starts[0], 'the first leg is not recorded as the fresh one').toContain('legsBefore=0');
  expect(
    starts.some((l) => l.includes('legsBefore=1')),
    'the export cannot tell a fresh leg from one running in a used session',
  ).toBe(true);
  expect(text, 'nothing says how long the page had been open').toContain('sessionAgeMs=');
});


/**
 * A scriptable recogniser that actually reaches `listening`.
 *
 * Headless Chromium exposes `webkitSpeechRecognition` and then fires no events
 * at all, having no microphone and no speech backend — so with the real one
 * the app never reports the microphone as up, and the post-microphone offset is
 * correctly absent from every line. Nine other specs install this same fake for
 * the same reason.
 */
async function withFakeRecognition(page: Page): Promise<void> {
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
      start(): void {
        this.aborted = false;
        setTimeout(() => this.onstart?.(), 0);
      }
      stop(): void {
        this.onend?.();
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

/** The whole diagnostic log, as objects rather than the rendered text. */
async function events(page: Page): Promise<{ event: string; detail?: Record<string, unknown> }[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
    return raw === null
      ? []
      : (JSON.parse(raw) as { event: string; detail?: Record<string, unknown> }[]);
  });
}

/**
 * The post-microphone cells are a CURVE, and a curve needs a horizontal axis.
 *
 * One of the two hypotheses the block exists to separate is that the phone
 * comes back on a timer. Under that hypothesis the four post-microphone samples
 * differ from each other purely because of when they were taken — and with no
 * clock on them the protocol reads that difference as the route alternating,
 * which is a different conclusion with a different fix. Four readings at 1.5s,
 * 9s, 20s and 31s answer the question; four unlabelled readings do not.
 *
 * The absence on the before-microphone half matters just as much: those cells
 * are before the microphone has been up at all, so they carry no offset rather
 * than a zero that would average in as though it were a measurement.
 */
test('a line after the microphone records how long after it went out', async ({ page }) => {
  await withFakeRecognition(page);
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  // THE FIRST SAMPLE HAS TO HAVE BEEN TAKEN before we walk past it: this
  // test compares the offset on a before-microphone cell against a
  // post-microphone one, and every measured sample now waits a fixed silence
  // after its arrival chime before it speaks. Skipping straight through
  // route-1 left the comparison with nothing on one side.
  await expect
    .poll(
      async () =>
        (await events(page)).some((e) => e.event === 'say-start' && e.detail?.step === 'route-1'),
      { timeout: 15_000 },
    )
    .toBe(true);

  // Walk to the first post-microphone route sample and let its gate open.
  await goToStep(page, 'route-after-mic');
  await expect(page.getByTestId('fieldtest-again')).not.toHaveText('Waiting for the microphone…', {
    timeout: 12_000,
  });

  await expect
    .poll(
      async () =>
        (await events(page)).filter(
          (e) => e.event === 'say-start' && e.detail?.step === 'route-after-mic',
        ).length,
      { timeout: 12_000 },
    )
    .toBeGreaterThan(0);

  const all = await events(page);
  // The gate has to have had something to wait for, or this test is measuring
  // the fake engine failing to start rather than the offset.
  const stopped = all.find((e) => e.event === 'mic-stopped' && e.detail?.step === 'route-after-mic');
  expect(stopped?.detail?.wasLive, 'the microphone was never up, so there was no close to time from').toBe(
    true,
  );

  const before = all.find((e) => e.event === 'say-start' && e.detail?.step === 'route-1');
  const after = all.find((e) => e.event === 'say-start' && e.detail?.step === 'route-after-mic');
  expect(before, 'the before-microphone sample never spoke').toBeTruthy();
  expect(after, 'the post-microphone sample never spoke').toBeTruthy();

  expect(
    before?.detail?.msSinceAppLetGo,
    'a cell taken before the microphone was ever up reports an offset from it',
  ).toBeUndefined();
  expect(
    typeof after?.detail?.msSinceAppLetGo,
    'the post-microphone sample carries no offset, so a recovery on a timer is indistinguishable from the route alternating',
  ).toBe('number');
  // At least the declared settle: the gate waits that long on purpose, so
  // anything less would mean the clock is not counting from the close.
  expect(after?.detail?.msSinceAppLetGo as number).toBeGreaterThanOrEqual(1_400);
});

/**
 * ...and on the row the analysis is actually read from.
 *
 * The 2x2 gets assembled by `grep answer=` in a car park. An answer read by
 * itself, without the offset its utterance was sampled at, puts the reader back
 * where they started.
 */
test('the answer carries the offset its line was spoken at', async ({ page }) => {
  await withFakeRecognition(page);
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'route-after-mic');
  await expect(page.getByTestId('fieldtest-again')).not.toHaveText('Waiting for the microphone…', {
    timeout: 12_000,
  });
  const car = page.getByTestId('fieldtest-answer-route-car');
  await expect(car).toBeEnabled({ timeout: 12_000 });
  await car.click();

  await expect
    .poll(
      async () =>
        (await events(page)).find(
          (e) => e.event === 'answer' && e.detail?.step === 'route-after-mic',
        )?.detail?.msSinceAppLetGo,
      {
        timeout: 8_000,
        message:
          'the answer row carries no offset, so the 2x2 cannot be read without cross-referencing the speech log',
      },
    )
    .toBeGreaterThanOrEqual(1_400);

  // The number belongs to THIS step's utterance, not to whatever was said
  // last. `route-after-mic` is the first line after a gate that waits, so an
  // offset inherited from an earlier step would be minutes, not seconds.
  const all = await events(page);
  const answer = all.find((e) => e.event === 'answer' && e.detail?.step === 'route-after-mic');
  const line = all.find((e) => e.event === 'say-start' && e.detail?.step === 'route-after-mic');
  expect(
    answer?.detail?.msSinceAppLetGo,
    "the answer was stamped with some other line's offset",
  ).toBe(line?.detail?.msSinceAppLetGo);
});


/**
 * The press that tells the microphone apart from the clock.
 *
 * Every wheel press in the protocol used to happen before the microphone block
 * or inside it, so "the microphone takes the wheel" and "the media slot lapses
 * after a few presses, or after ten minutes" predicted the identical log —
 * and the second is the fault `wheel-repeat` exists to find. Reading them apart
 * needs the press ORDER and the press TIME, which is why the arrival line now
 * carries both: a press that works again once the microphone is confirmed down
 * says the microphone took the wheel and gave it back, and a press that does
 * not says the slot went while the microphone was innocent.
 */
test('the press after the microphone is numbered and timed from it', async ({ page }) => {
  await captureWheel(page);
  await withFakeRecognition(page);
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  // An early press, before the microphone has ever been up.
  await goToStep(page, 'wheel-talking');
  expect(await press(page)).toBe(true);

  await goToStep(page, 'wheel-after-mic');
  // The gate has to have opened, or this is a press taken mid-teardown --
  // which is the very thing the step is defined not to be.
  await expect(page.getByTestId('fieldtest-again')).not.toHaveText('Waiting for the microphone…', {
    timeout: 12_000,
  });
  expect(await press(page)).toBe(true);

  await expect
    .poll(
      async () =>
        (await events(page)).filter(
          (e) => e.event === 'field-test-arrival' && e.detail?.step === 'wheel-after-mic',
        ).length,
      { timeout: 8_000 },
    )
    .toBeGreaterThan(0);

  const arrivals = (await events(page)).filter((e) => e.event === 'field-test-arrival');
  const early = arrivals.find((e) => e.detail?.step === 'wheel-talking');
  const late = arrivals.find((e) => e.detail?.step === 'wheel-after-mic');
  expect(early, 'the early press never arrived').toBeTruthy();
  expect(late, 'the press after the microphone never arrived').toBeTruthy();

  // ORDER. "It stops working after N presses" is a claim about this number,
  // and it used to be recoverable only by counting arrivals by hand.
  expect(
    late?.detail?.pressIndex as number,
    'the press after the microphone is not numbered after the ones before it',
  ).toBeGreaterThan(early?.detail?.pressIndex as number);

  // TIME, from the one event known to move the audio session.
  expect(
    early?.detail?.msSinceAppLetGo,
    'a press from before the microphone was ever up reports an offset from it',
  ).toBeUndefined();
  expect(
    typeof late?.detail?.msSinceAppLetGo,
    'the press after the microphone is not timed from it, so it cannot be read against the route samples around it',
  ).toBe('number');
});


/** Make a swallowed utterance take long enough to observe the screen during it. */
async function withSlowSpeech(page: Page, ms = 1_500): Promise<void> {
  await page.addInitScript((delay) => {
    (window as unknown as { __e2eSpeechDelayMs?: number }).__e2eSpeechDelayMs = delay;
  }, ms);
}

/**
 * The read-aloud instruction is not a sample, and must not hold the answers.
 *
 * The answers are disabled while the app speaks, which is right for a measured
 * line: the answer is about that utterance, so it cannot be collected before
 * there is one. On the six steps that declare no line the instruction is the
 * only thing spoken — and `free`'s instruction runs about ten seconds and
 * says, in as many words, "stamp it the moment it happens". For those ten
 * seconds the stamp buttons were dead.
 */
test('a step whose only speech is its instruction can still be answered', async ({ page }) => {
  // Long enough that the check below is unambiguously inside the utterance.
  await withSlowSpeech(page, 20_000);
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  // `wheel-back` declares no line, so arriving reads the instruction aloud.
  await goToStep(page, 'wheel-back');
  await expect
    .poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 8_000 })
    .toContain('Press skip-BACK on the wheel once, in the silence.');

  // The utterance is logged synchronously inside `speakAsync`, one React commit
  // before the arriving step's state reaches the DOM -- so a read taken the
  // instant the poll returns sees the PREVIOUS step's disabled buttons. The
  // wait is for that commit, and is two orders of magnitude inside the
  // twenty-second utterance.
  await page.waitForTimeout(400);

  // READ ONCE, NOT POLLED. `toBeEnabled()` retries for five seconds, so with a
  // short utterance it passes on the button coming back AFTER the instruction
  // finishes -- which is the broken behaviour. The first version of this test
  // did exactly that and a mutant restoring the defect survived it.
  const startedAt = Date.now();
  const disabled = await page.getByTestId('fieldtest-answer-wheel-na').isDisabled();
  expect(
    Date.now() - startedAt,
    'the read took so long the utterance may already have ended',
  ).toBeLessThan(5_000);
  expect(disabled, 'the answers were dead for the whole read-aloud instruction').toBe(false);
});

/**
 * ...and the flag still guards what it is for.
 *
 * A line the operator is being asked about must not be answerable before it has
 * been heard. If this passes while the test above also passes, the two kinds of
 * speech are genuinely being told apart rather than the guard having been
 * dropped.
 */
test('a step with a measured line still holds its answers until the line is out', async ({
  page,
}) => {
  await withSlowSpeech(page, 3_000);
  await withSettings(page, {});
  await openTest(page, 'Car, parked');

  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'route-1');
  await expect
    .poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 5_000 })
    .toContain('Basic hit versus dealer nine.');
  await expect(
    page.getByTestId('fieldtest-answer-route-car'),
    'an answer could be given before the line it is about had finished',
  ).toBeDisabled();
});

/**
 * An instruction that will not speak has to say so.
 *
 * On the six silent steps this is the only audible output the app produces, and
 * the failure was swallowed: "nothing was heard" covered the operator never
 * pressing the button, speechSynthesis throwing, and the step advancing first.
 * One of those is a fault in the app.
 */
test('an instruction left half-read says so rather than going quiet', async ({ page }) => {
  await withSlowSpeech(page, 5_000);
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await goToStep(page, 'wheel-back');
  await expect
    .poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 5_000 })
    .toContain('Press skip-BACK on the wheel once, in the silence.');

  // Leave while it is still reading.
  await page.getByTestId('fieldtest-skip').click();

  await expect
    .poll(
      async () =>
        (await events(page)).some(
          (e) => e.event === 'instruction-abandoned' && e.detail?.step === 'wheel-back',
        ),
      { timeout: 8_000 },
    )
    .toBe(true);
  // ...and it is NOT recorded as having been spoken, which is what the reader
  // would otherwise conclude from the only other line available.
  const spoken = (await events(page)).filter(
    (e) => e.event === 'instruction-spoken' && e.detail?.step === 'wheel-back',
  );
  expect(spoken, 'an abandoned instruction was logged as spoken').toEqual([]);
});


/**
 * Start-over discards the run, and had no guard at all.
 *
 * Finish keeps every stamp and asks twice. This button zeroes the position and
 * empties the stamps, and it sits directly under Resume on the screen an
 * interrupted run comes back to — so the mis-tap it invites is the one that
 * costs a drive's evidence.
 */
test('starting over asks twice, like every other button that destroys something', async ({
  page,
}) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  // Answer one step, so there is something to lose.
  await expect(page.getByTestId('fieldtest-answer-route-car')).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await page.getByTestId('fieldtest-answer-route-car').click();
  await page.getByTestId('fieldtest-pause').click();
  await page.getByTestId('fieldtest-open').click();

  const start = page.getByTestId('fieldtest-start');
  await expect(start).toHaveText('Start over from step 1');
  await start.click();

  // Still on the gate, and the run is still there to resume.
  await expect(
    page.getByTestId('fieldtest-title'),
    'one tap discarded the run with no confirmation',
  ).toHaveCount(0);
  await expect(page.getByTestId('fieldtest-resume')).toBeVisible();
  // ...and it says what the next tap costs, rather than repeating itself.
  await expect(start).toContainText('Tap again to discard');

  await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
});

/**
 * The gate is where an interrupted run lands, and it said nothing.
 *
 * A mid-drive reload, an answered phone call or a mis-tapped Pause all end here
 * while the driver is looking at the road. The app simply stops talking, which
 * on a screen built to be used without looking is indistinguishable from the
 * app having died — and the recovery the driver then reaches for is the
 * button that discards the run.
 */
test('the gate says out loud that there is a run to come back to', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await page.getByTestId('fieldtest-skip').click();
  await page.evaluate(() => {
    window.__speechLog = [];
  });
  await page.getByTestId('fieldtest-pause').click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-resume')).toBeVisible();

  const said = await page.evaluate(() => window.__speechLog ?? []);
  expect(
    said.some((l) => /resume/i.test(l)),
    'an interrupted run came back to a silent screen',
  ).toBe(true);
  expect(said, 'nothing marked the change of state for someone not looking').toContain(
    'chime:attention',
  );
});

/** ...and it does not announce a resume on a gate that has nothing to resume. */
test('a first visit to the gate stays quiet', async ({ page }) => {
  await withSettings(page, {});
  await page.goto('/?e2e=1');
  await page.evaluate(() => {
    // THE REAL KEY. This read `bjtrainer.fieldtest.run.v1`, which is not what
    // the store writes (`fieldTestRun`, capital T), so the defensive clear
    // cleared nothing and the test passed only because Playwright hands every
    // test a fresh context anyway.
    window.localStorage.removeItem('bjtrainer.fieldTestRun.v1');
    window.__speechLog = [];
  });
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-start')).toBeVisible();
  const said = await page.evaluate(() => window.__speechLog ?? []);
  expect(said.filter((l) => /resume/i.test(l)), 'a fresh gate announced a resume').toEqual([]);
});


/**
 * A reload mid-protocol used to land on Home.
 *
 * Nothing persisted which screen was open, and the update check reloads the
 * app on purpose from a visibility change — a phone call answered and hung
 * up is enough. The operator, driving, then met the Home screen with no line
 * playing and no idea why, and the way back ran through the start gate.
 */
test('a reload in the middle of a run comes back to the run', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await page.getByTestId('fieldtest-skip').click();
  await page.getByTestId('fieldtest-skip').click();

  // Don't re-seed on the way back in: a reload has to find what was really
  // left on disk.
  await page.evaluate(() => window.localStorage.setItem('e2e.noReseed', '1'));
  await page.reload();

  await expect(
    page.getByTestId('fieldtest-screen'),
    'a reload mid-protocol dropped the operator somewhere else',
  ).toBeVisible();
  // The gate, not the running screen: a run is never restored as active,
  // because `mic-route` would open the microphone on a navigation tap.
  await expect(page.getByTestId('fieldtest-resume')).toBeVisible();
  await expect(page.getByTestId('fieldtest-title')).toHaveCount(0);
});

/** ...and an ordinary launch, with no run behind it, still opens on Home. */
test('a launch with nothing to come back to opens where it always did', async ({ page }) => {
  await withSettings(page, {});
  await page.goto('/?e2e=1');
  await page.evaluate(() => {
    window.localStorage.removeItem('bjtrainer.fieldTestRun.v1');
    window.localStorage.setItem('e2e.noReseed', '1');
  });
  await page.reload();
  await expect(
    page.getByTestId('fieldtest-screen'),
    'the field test hijacked a launch that had no run behind it',
  ).toHaveCount(0);
});


/**
 * "Read the step" says the instruction, and does not say the line.
 *
 * The distinction is the whole point. The line is the sample — speaking it
 * again is a measurement the operator asked for, and the route answer is about
 * it. The instruction is what they are being told to do, and on the seventeen
 * steps with a line it had no audio path at all while eyes-free was forced on.
 */
test('the instruction can be heard on a step that already speaks a line', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'route-1');
  await expect(page.getByTestId('fieldtest-read-step')).toBeEnabled({ timeout: 20_000 });

  /**
   * WAIT FOR THE STEP'S OWN LINE BEFORE CLEARING, or this test blames the
   * click for an utterance the step had already scheduled.
   *
   * `route-1` is `measured`, so it speaks its line only after
   * `PRE_SAMPLE_SETTLE_MS`. The read-step button enables earlier than that.
   * Clearing the log on the button alone therefore leaves a 1.5s window in
   * which the step's FIRST sample can still land -- and on a loaded machine
   * it does, after the clear, where the assertion below reads it as the
   * click having re-spoken the measured line. It failed exactly that way in
   * a full-suite run on 2026-09-30 and passes 7/7 on an idle one, which is
   * the signature of an unbounded window rather than of a real defect.
   *
   * Waiting for the line first makes the window start after the only other
   * thing that could have produced it.
   */
  await expect
    .poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 20_000 })
    .toContain('Basic hit versus dealer nine.');

  await page.evaluate(() => {
    window.__speechLog = [];
  });

  await page.getByTestId('fieldtest-read-step').click();
  await expect
    .poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 8_000 })
    .toContain('Listen to the line. Where did it come from?');
  /**
   * ...and NOT the measured line, which would be a second sample nobody asked
   * for, arriving between the one they heard and the answer they give.
   *
   * THE WAIT IS THE ASSERTION. This used to read the log in a single snapshot
   * taken the instant the instruction appeared, and a re-spoken sample cannot
   * have arrived by then: `say` on a `measured` step waits out
   * `PRE_SAMPLE_SETTLE_MS` (1500ms) first. So the absence was asserted over a
   * window in which the thing could not yet have happened, and the test was
   * unable to fail -- injecting a `say('asked')` into the button's own
   * handler left it green.
   *
   * An absence is only as strong as the time it was watched for, so the
   * window is held open past the settle it would have to come through. This
   * is one of the few places a fixed wait is the measurement rather than a
   * substitute for one.
   */
  await page.waitForTimeout(2_600);
  expect(
    await page.evaluate(() => window.__speechLog ?? []),
    'asking for the instruction re-spoke the line being measured',
  ).not.toContain('Basic hit versus dealer nine.');
});

/**
 * ...and the log says it happened, because it can land anywhere.
 *
 * An asked-for reading can arrive seconds before a route sample. It is not
 * spoken on arrival for exactly that reason, and the analysis has to be able
 * to see the ones the operator asked for rather than meeting an unexplained
 * utterance in the middle of a run.
 */
test('an instruction the operator asked for is marked as asked for', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await expect(page.getByTestId('fieldtest-read-step')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('fieldtest-read-step').click();

  await expect
    .poll(
      async () =>
        (await events(page)).some(
          (e) => e.event === 'instruction-start' && e.detail?.why === 'asked',
        ),
      { timeout: 8_000 },
    )
    .toBe(true);

  // The arrival readings on the silent steps are a different thing and say so.
  await goToStep(page, 'wheel-back');
  await expect
    .poll(
      async () =>
        (await events(page)).some(
          (e) =>
            e.event === 'instruction-start' &&
            e.detail?.step === 'wheel-back' &&
            e.detail?.why === 'arrival',
        ),
      { timeout: 8_000 },
    )
    .toBe(true);
});

/** The line is still repeatable, which is what that control is for. */
test('the repeat control still repeats the measured line', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  await expect(page.getByTestId('fieldtest-again')).toBeEnabled({ timeout: 20_000 });
  await page.evaluate(() => {
    window.__speechLog = [];
  });
  await page.getByTestId('fieldtest-again').click();
  await expect
    .poll(() => page.evaluate(() => window.__speechLog ?? []), { timeout: 8_000 })
    .toContain('Basic hit versus dealer nine.');
});

/**
 * S10: the Web Audio graph exists before the first sample, not partway
 * through the first pair.
 *
 * The shared `AudioContext` is created lazily by `chime()` or by `amplify()`,
 * and route steps play at volume 1 so they never amplify. The first chime in
 * a run was therefore the ANSWER TAP on route-1 — meaning route-1 was
 * spoken with no audio graph on the device and route-2 with one. Those two
 * are the protocol's first alternation pair, and the instruction on route-2
 * tells the reader that a difference between them is the bug.
 */
test('the audio graph is open before the first line is spoken', async ({ page }) => {
  await openTest(page, 'Car, parked');
  // THE LINE HAS TO HAVE BEEN SPOKEN before the log is read: every measured
  // sample now waits a fixed silence between its arrival chime and its
  // utterance, and `logText` pauses the run, so reading it immediately
  // caught the run mid-settle and the comparison had nothing on one side.
  await expect
    .poll(async () => (await page.evaluate(() => window.__speechLog ?? [])).map(String), {
      timeout: 15_000,
    })
    .toContain('Basic hit versus dealer nine.');
  const text = await logText(page);
  const opened = text.indexOf('audio-graph-open');
  expect(opened, 'nothing opened the audio graph at run start').toBeGreaterThan(-1);
  const firstLine = text.indexOf('say-start');
  expect(firstLine, 'no line was spoken at all').toBeGreaterThan(-1);
  expect(
    opened,
    'the first sample of the run was taken before the audio graph existed',
  ).toBeLessThan(firstLine);
});

/**
 * A run must not hand the settings back while it is starting.
 *
 * React destroys a commit's cleanups before running any of its create
 * functions, and StrictMode mounts twice in development — so the screen's
 * unmount teardown ran DURING run start. Every development export opened with
 * `focus release`, `settings-restored from=run`, a second hold and a
 * `focus refused AbortError`: the run giving the volume back a millisecond
 * after taking it, and the silent element's `play()` aborted by a pause that
 * was never meant to happen. Three false lines at the top of the artefact the
 * whole protocol exists to produce.
 *
 * Asserted against the dev server on purpose — that is where StrictMode
 * runs, and it is the build the operator's own diagnostic exports come from
 * while the protocol is being worked on.
 */
test('starting a run does not hand the settings straight back', async ({ page }) => {
  await withSettings(page, {});
  await openTest(page, 'Car, parked');
  // `logText` leaves by Pause, which is a real teardown and restores once.
  const text = await logText(page);
  const started = text.indexOf('run-start');
  expect(started, 'the run never started').toBeGreaterThan(-1);
  const after = text
    .slice(started)
    .split('\n')
    .filter((l) => l.includes('settings-restored'));
  expect(
    after.length,
    `the settings were handed back ${after.length} times: one of those is the run starting`,
  ).toBe(1);
  expect(
    text.slice(started, text.indexOf('settings-restored', started)),
    'the audio hold was refused during run start',
  ).not.toContain('focus refused');
});
