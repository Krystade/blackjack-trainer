import { test, expect, type Page } from '@playwright/test';
import { withSettings, selectFieldTestCondition } from './helpers';
import { FIELD_TEST_STEPS } from '../src/diag/fieldTest';

/**
 * The drill protocol, end to end.
 *
 * WHAT IT EXISTS TO PROVE, and why no existing spec could.
 *
 * The routing protocol arms a diagnostic probe on every wheel step, and
 * `mediaSession.ts` runs `if (probe) probe(action)` and then
 * `if (!probe) handler()`. That exclusion is deliberate -- a test press must
 * not also answer a drill question -- and its consequence is that
 * press-to-action-to-audible-response, which is the entire product, had never
 * been exercised in the car or in this suite. A leg could come back green on
 * the wheel while the drill was unanswerable, and on 2026-09-29 one did:
 * every `seekforward` press in run `vfktl7` wrote
 * `handled=false why=no-screen-listening`.
 *
 * So the two assertions that matter here are:
 *   - a press reaches a real handler and the app SAYS SOMETHING BACK;
 *   - the word-discrimination step can be got wrong, and records that it was.
 *
 * The second is the one that keeps the protocol honest. Its predecessor asked
 * "could you make out the words", which is answered by somebody who has
 * already heard the line and knows what it said -- a question that cannot
 * fail. A forced choice between four lines differing in one word can.
 */

async function endRun(page: Page): Promise<void> {
  const finish = page.getByTestId('fieldtest-finish');
  await finish.click();
  await expect(finish).toHaveText('Tap again to end');
  await finish.click();
}

/**
 * A real media key cannot be synthesised from Playwright, so the handlers the
 * app registers are captured at the browser boundary and invoked directly.
 * Nothing in `src/` knows: `initMediaSession` registers exactly as it does in
 * the car, and the handler that runs is the production one -- which is the
 * whole point, because the production handler is what was never reached.
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

function press(page: Page, action: string): Promise<boolean> {
  return page.evaluate(
    (a) => (window as unknown as { __wheel?: (x: string) => boolean }).__wheel?.(a) ?? false,
    action,
  );
}

/** Everything the app has tried to say. Captured, not spoken, under ?e2e=1. */
function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window.__speechLog ?? [])]);
}

/**
 * The four lines a discrimination step draws from, in the order the app holds
 * them. Duplicated from `src/diag/fieldTest.ts` on purpose: an oracle built by
 * importing the value under test shares its source, so a line changed in one
 * place would move both sides together and the assertion would keep passing.
 */
const DRAWN_FROM = [
  'Basic hit versus dealer nine.',
  'Basic stand versus dealer nine.',
  'Basic double versus dealer nine.',
  'Basic split versus dealer nine.',
];

/**
 * Step into a discrimination step and read the word it drew.
 *
 * TWO WRONG VERSIONS PRECEDED THIS, and both passed sometimes, which is the
 * only reason they survived at all:
 *
 *  1. The first took the FIRST utterance matching the four lines.
 *     `echo-forward` says "Basic hit versus dealer nine." two steps earlier
 *     and that is itself one of the four, so the oracle read `hit` from a
 *     step the test was not looking at and agreed with the draw one time in
 *     four.
 *  2. The second took the LAST match but polled for mere EXISTENCE -- and
 *     `echo-forward`'s line already existed, so the poll resolved
 *     immediately, 1.5 seconds before the step under test said anything.
 *     A discrimination step is `measured`, so it waits out
 *     `PRE_SAMPLE_SETTLE_MS` before speaking.
 *
 * So the window is bounded at both ends: nothing said before the step was
 * entered can be considered, and the poll waits for something said after it.
 * Then the only one of the four lines in that window is the drawn one.
 */
async function stepIntoDrawn(page: Page, from: string, to: string): Promise<string> {
  await goToStep(page, from);
  const before = (await spoken(page)).length;
  await page.getByTestId('fieldtest-skip').click();
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', to);

  const drawnIn = async () =>
    (await spoken(page)).slice(before).filter((line) => DRAWN_FROM.includes(line));
  await expect
    .poll(async () => (await drawnIn()).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  const said = (await drawnIn()).at(-1)!;
  return /^Basic (hit|stand|double|split) /.exec(said)![1]!;
}

async function openDrillLeg(page: Page, label: string): Promise<void> {
  await selectFieldTestCondition(page, label);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  if ((await page.getByTestId('fieldtest-finish').count()) > 0) {
    await endRun(page);
    await page.getByTestId('fieldtest-open').click();
  }
  const start = page.getByTestId('fieldtest-start');
  await start.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
}

async function goToStep(page: Page, step: string): Promise<void> {
  const title = page.getByTestId('fieldtest-title');
  for (let i = 0; i < 20; i++) {
    if ((await title.getAttribute('data-step')) === step) return;
    const skip = page.getByTestId('fieldtest-skip');
    if (await skip.isDisabled()) break;
    await skip.click();
  }
  throw new Error(`never reached step "${step}"`);
}

async function answerStep(page: Page, testId: string): Promise<void> {
  const button = page.getByTestId(testId);
  await expect(button).toBeEnabled();
  // The 350ms bounce guard: a bump on a rough road turned one press into two.
  await page.waitForTimeout(400);
  await button.click();
}

function diagPanel(page: Page) {
  return page
    .locator('details.settings-section')
    .filter({ has: page.locator('summary', { hasText: 'Diagnostic log' }) });
}

async function logText(page: Page): Promise<string> {
  const pause = page.getByTestId('fieldtest-pause');
  if ((await pause.count()) > 0) await pause.click();
  else await page.getByRole('button', { name: 'Settings' }).first().click();
  const section = diagPanel(page);
  const show = section.getByRole('button', { name: /^(Show|Hide)$/ });
  if ((await show.innerText()) === 'Show') await show.click();
  return section.locator('pre.car-log').innerText();
}

const PARKED = 'Drill — parked';

test('a wheel press reaches a real handler and the app answers out loud', async ({ page }) => {
  test.setTimeout(45_000);
  await withSettings(page, { audio: { enabled: true, useClips: true } });
  await captureWheel(page);
  await openDrillLeg(page, PARKED);

  // The leg opens on the positive control, which is also the first echo.
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'echo-forward');

  const before = (await spoken(page)).length;
  expect(await press(page, 'nexttrack'), 'the app never registered nexttrack').toBe(true);

  // THE ASSERTION THE PROTOCOL WAS REBUILT FOR: the press produced speech.
  await expect
    .poll(async () => (await spoken(page)).slice(before), { timeout: 5_000 })
    .toContain('Correct play was hit.');
  await expect(page.getByTestId('fieldtest-echo')).toContainText('Correct play was hit.');
});

test('skip-back is a separate wire and answers with its own word', async ({ page }) => {
  test.setTimeout(45_000);
  await withSettings(page, { audio: { enabled: true, useClips: true } });
  await captureWheel(page);
  await openDrillLeg(page, PARKED);
  await goToStep(page, 'echo-back');

  const before = (await spoken(page)).length;
  expect(await press(page, 'previoustrack')).toBe(true);

  // `back` falls through to `repeatLast` when no screen claims it, so a step
  // that only tested `forward` would pass while half the wheel was inert.
  await expect
    .poll(async () => (await spoken(page)).slice(before), { timeout: 5_000 })
    .toContain('Correct play was stand.');
});

test('the word step scores the tap against the line it actually drew', async ({ page }) => {
  test.setTimeout(45_000);
  await withSettings(page, { audio: { enabled: true, useClips: true } });
  await openDrillLeg(page, PARKED);

  const word = await stepIntoDrawn(page, 'echo-back', 'hear-word-1');
  await answerStep(page, `fieldtest-answer-heard-${word}`);

  const log = await logText(page);
  // The truth is on the answer row, or the tap has nothing to be scored
  // against and the step degrades into the self-report it replaced.
  expect(log).toContain(`said=${word}`);
  expect(log).toContain('correct=true');
});

/**
 * THE STEP CAN FAIL, which is the only reason it is worth running.
 *
 * A protocol whose intelligibility question is a self-report collects a pass
 * whatever happens in the cabin. This taps a word the app did NOT say and
 * asserts the log records it as wrong -- so a leg where the words cannot be
 * made out at speed produces a different export from one where they can.
 */
test('a wrong word is recorded as wrong', async ({ page }) => {
  test.setTimeout(45_000);
  await withSettings(page, { audio: { enabled: true, useClips: true } });
  await openDrillLeg(page, PARKED);

  const word = await stepIntoDrawn(page, 'echo-back', 'hear-word-1');
  const wrong = ['hit', 'stand', 'double', 'split'].find((w) => w !== word)!;

  await answerStep(page, `fieldtest-answer-heard-${wrong}`);

  const log = await logText(page);
  expect(log).toContain(`said=${word}`);
  expect(log, 'a wrong word was recorded as correct').toContain('correct=false');
});

/**
 * A DECLINE IS NOT A WRONG GUESS. "Heard it, couldn't make out the word" is
 * the honest answer when the road wins, and scoring it as an error would
 * inflate the error rate with the operator's honesty -- while scoring it as
 * correct would hide the failure entirely. It carries no score at all.
 */
test('an honest "could not make it out" is scored as neither right nor wrong', async ({ page }) => {
  test.setTimeout(45_000);
  await withSettings(page, { audio: { enabled: true, useClips: true } });
  await openDrillLeg(page, PARKED);
  await goToStep(page, 'hear-word-2');

  await answerStep(page, 'fieldtest-answer-heard-unintelligible');

  const log = await logText(page);
  const row = log
    .split('\n')
    .find((l) => l.includes('step=hear-word-2') && l.includes('answer=heard-unintelligible'));
  expect(row, 'the decline was never stamped').toBeTruthy();
  expect(row, 'a decline was scored as a guess').not.toContain('correct=');
});

/**
 * THE STEP'S REASON IS ON SCREEN AND NOT IN THE AUDIO.
 *
 * Both halves matter and they fail in opposite directions. Without the print,
 * the operator answers ten questions with no reminder of what any of them
 * measures -- the gate's `proves` was read once, parked, twenty minutes
 * earlier. Without the silence, the purpose would be prepended to a
 * discrimination sample, and those steps measure whether one specific
 * sentence survives road noise; a clause about the experiment in front of it
 * changes the thing being measured.
 */
/**
 * IS IT ACTUALLY ON THE SCREEN, not merely in the document.
 *
 * `toBeVisible()` checks for a box and for `display`/`visibility`. It says
 * nothing about whether an ancestor with `overflow` has clipped the element
 * out of sight, and `toBeInViewport()` does not either -- the element can sit
 * inside the viewport while sitting outside the 130px panel that contains it.
 *
 * This is not hypothetical. The purpose line shipped in the first draft of
 * this feature INSIDE `.fieldtest-head`, which is `max-height: 130px;
 * overflow-y: auto`. On a 375x812 screen the head ended at y=258 and the line
 * rendered at y=264: in the DOM, returned by `innerText`, reported visible by
 * Playwright, and invisible to the person driving unless they scrolled a
 * panel nobody scrolls at speed. The test passed. A screenshot caught it.
 *
 * So: find every clipping ancestor and require the element to be inside all
 * of them.
 */
async function assertNotClipped(page: Page, testId: string): Promise<void> {
  const verdict = await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return { ok: false, why: 'not in the document' };
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const clips = [cs.overflowX, cs.overflowY].some((v) => v !== 'visible');
      if (!clips) continue;
      const pr = p.getBoundingClientRect();
      if (r.top < pr.top - 1 || r.bottom > pr.bottom + 1) {
        return {
          ok: false,
          why: `clipped by .${p.className.split(' ')[0]} (element ${Math.round(r.top)}-${Math.round(
            r.bottom,
          )}, container ${Math.round(pr.top)}-${Math.round(pr.bottom)})`,
        };
      }
    }
    return { ok: true, why: '' };
  }, testId);
  expect(verdict.ok, `${testId} is in the DOM but not on the screen: ${verdict.why}`).toBe(true);
}

test('every drill step prints why it exists and never speaks it', async ({ page }) => {
  test.setTimeout(45_000);
  await withSettings(page, { audio: { enabled: true, useClips: true } });
  await openDrillLeg(page, PARKED);

  const purpose = page.getByTestId('fieldtest-purpose');
  const seen: string[] = [];

  for (let i = 0; i < 20; i++) {
    await expect(purpose, 'a drill step with no stated purpose').toBeVisible();
    // ...and on the screen, not merely in the document.
    await assertNotClipped(page, 'fieldtest-purpose');
    const text = (await purpose.innerText()).trim();
    expect(text.length, 'an empty purpose line is the same as none').toBeGreaterThan(24);
    seen.push(text);

    const skip = page.getByTestId('fieldtest-skip');
    if (await skip.isDisabled()) break;
    await skip.click();
  }

  const expected = FIELD_TEST_STEPS.filter((x) => x.protocol === 'drill').length;
  expect(seen.length, 'the leg ended before its steps were walked').toBe(expected);
  // Every step's own reason, not one line carried across the whole leg.
  expect(new Set(seen).size).toBe(seen.length);

  // ...and not one word of it went to the speaker.
  const said = await spoken(page);
  for (const text of seen) {
    for (const line of said) {
      expect(line, `a purpose was spoken: ${text}`).not.toContain(text);
    }
  }
});

test('the phone-speaker leg drops the wheel steps and keeps the microphone ones', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await withSettings(page, { audio: { enabled: true, useClips: true } });
  await openDrillLeg(page, 'Drill — phone speaker');

  const seen: string[] = [];
  const title = page.getByTestId('fieldtest-title');
  for (let i = 0; i < 20; i++) {
    seen.push((await title.getAttribute('data-step')) ?? '');
    const skip = page.getByTestId('fieldtest-skip');
    if (await skip.isDisabled()) break;
    await skip.click();
  }

  // With Bluetooth off there is no wheel to press, and asking for one is the
  // mistake the routing protocol already made with six steps.
  expect(seen).not.toContain('echo-forward');
  expect(seen).not.toContain('echo-back');
  expect(seen).not.toContain('echo-after-voice');
  // ...and what the leg is actually for is still on it.
  expect(seen).toContain('hear-word-1');
  expect(seen).toContain('echo-voice-1');
  expect(seen).toContain('ambient-sweep');
});

/**
 * `__wheelPress`, not `__wheel`: the question is whether a SCREEN claimed the
 * press, and `invokeWheelCommand` returns exactly that. `press()` above goes
 * in at the media-session boundary and returns true whenever the app
 * registered the action at all, which it always does -- so it cannot tell a
 * press that answered something from one that fell on the floor.
 */
function pressWheel(page: Page, command: 'forward' | 'back'): Promise<boolean> {
  return page.evaluate((c) => window.__wheelPress?.(c as 'forward' | 'back') ?? false, command);
}

/**
 * THE WHEEL ON THE STEPS THAT ARE NOT ABOUT THE WHEEL.
 *
 * Four of the nine drill steps declare no `echo: 'wheel'`, and the effect that
 * claims the wheel returned early on all four -- so the screen released the
 * handler on arriving at `hear-word-1` and nothing took it back. On the
 * 2026-09-30 drive the operator pressed both directions there: skip-back fell
 * through to `repeatLast` and happened to re-read the line, and skip-forward
 * wrote `handled=false why=no-screen-listening`.
 *
 * That string is the signature of the fault the whole protocol is
 * investigating -- `wheelCommands.ts` says so in as many words -- and here it
 * was produced by the instrument rather than by the car. The press DID arrive;
 * the field test had simply let go of it.
 *
 * So on a step with no echo the wheel does the one wheel-shaped thing such a
 * step has, which is also the control the operator most wants without looking:
 * read it again. Both directions, because a press that does nothing is
 * indistinguishable in the cabin from a dead wheel, and the direction is
 * logged so the export can still tell them apart.
 */
test('the wheel still reaches the screen on a step that does not echo', async ({ page }) => {
  test.setTimeout(45_000);
  await withSettings(page, { audio: { enabled: true, useClips: true } });
  await openDrillLeg(page, PARKED);

  const word = await stepIntoDrawn(page, 'echo-back', 'hear-word-1');
  const before = (await spoken(page)).length;

  expect(
    await pressWheel(page, 'forward'),
    'the field test let go of the wheel on a word step',
  ).toBe(true);

  // Read again, and the SAME line -- a repeat that redrew would quietly
  // destroy the sample the step exists to take.
  await expect
    .poll(async () => (await spoken(page)).slice(before), { timeout: 5_000 })
    .toContain(`Basic ${word} versus dealer nine.`);

  const log = await logText(page);
  expect(log, 'a press the screen received was logged as reaching nobody').not.toContain(
    'no-screen-listening',
  );
});
