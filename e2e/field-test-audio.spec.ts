import { test, expect } from '@playwright/test';

/**
 * The field test against REAL clip playback.
 *
 * No `?e2e=1` here, so `speakAsync` actually resolves a clip, fetches the mp3
 * and plays it -- which is the only way to exercise the thing this spec is
 * for: the screen stating which voice spoke, taken from the app's own
 * decision rather than from the operator's ear.
 *
 * WHY THIS FILE EXISTS AT ALL. The protocol used to ASK which voice had
 * spoken, and the operator's objection was exact: "it's not like they're
 * played the same way and the code doesn't know wtf?" The code does know.
 * Under `?e2e=1` speech is swallowed before a path is ever chosen, so the
 * ordinary harness cannot see the difference between reporting the decision
 * and reporting nothing -- it passes either way. This project can.
 *
 * Audible-by-accident is guarded twice, exactly as clip-playback.spec.ts is:
 * the project's `--mute-audio` launch flag, and the element-level `muted`
 * override below. Nothing in src/ reads `.muted`, so neither changes a value
 * this spec asserts on.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
      configurable: true,
      get: () => true,
      set: () => {},
    });
    window.localStorage.setItem(
      'bjtrainer.settings.v1',
      JSON.stringify({
        version: 1,
        audio: { enabled: true, useClips: true, muted: false, volume: 1 },
      }),
    );
  });
});

async function openTest(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  // Without ?e2e=1 the collapsible sections are genuinely collapsed, so the
  // section has to be opened the way a person opens it.
  await page.locator('summary', { hasText: 'Field test' }).click();
  await page.getByTestId('fieldtest-open').click();
  if ((await page.getByTestId('fieldtest-finish').count()) > 0) {
    await page.getByTestId('fieldtest-finish').click();
    await page.getByTestId('fieldtest-open').click();
  }
  await page.getByTestId('fieldtest-start').click();
}

/**
 * Step one speaks a line that HAS a recording (pinned against the phrase
 * manifest in fieldTest.test.ts), so the screen must say so in plain words --
 * without the operator being asked to judge it.
 */
test('the screen says which voice spoke, instead of asking', async ({ page }) => {
  await openTest(page);

  const path = page.getByTestId('fieldtest-path');
  await expect(path).toBeVisible({ timeout: 20_000 });
  await expect(path).toContainText('the recorded voice');
  // ...and it is a statement, not a question: nothing on the step offers the
  // operator a way to name the voice themselves.
  await expect(page.getByTestId('fieldtest-answers')).not.toContainText('recorded voice');
});

/**
 * The calibration step plays a clipped line and then a deliberately unclipped
 * one. Both decisions have to be reported, and reported DIFFERENTLY -- a
 * screen that printed the same sentence for both would be no better than the
 * guess it replaced.
 */
test('it distinguishes the clipped line from the fallback, in its own words', async ({ page }) => {
  await openTest(page);

  for (let i = 0; i < 20; i++) {
    if ((await page.getByTestId('fieldtest-title').innerText()).includes('fallback')) break;
    await page.getByTestId('fieldtest-skip').click();
  }
  await expect(page.getByTestId('fieldtest-title')).toContainText('fallback');

  const path = page.getByTestId('fieldtest-path');
  await expect(path).toContainText('the recorded voice', { timeout: 20_000 });
  // The second line has no recording, and the screen says which of the two
  // reasons put it there rather than just "the phone voice".
  await expect(path).toContainText('no recording exists for this line', { timeout: 20_000 });
});

/**
 * The same fact, in the file that gets pasted back after a drive. The screen
 * is for the moment; the log is for the diagnosis, and before 2026-09-23
 * `speakAsync` wrote neither.
 */
test('the path reaches the diagnostic log, not just the screen', async ({ page }) => {
  await openTest(page);
  await expect(page.getByTestId('fieldtest-path')).toBeVisible({ timeout: 20_000 });

  const entries = await page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
    return raw ? (JSON.parse(raw) as { category: string; event: string; detail?: Record<string, unknown> }[]) : [];
  });
  const paths = entries.filter((e) => e.category === 'speak' && e.event === 'path');
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.some((e) => e.detail?.path === 'clip')).toBe(true);
});

/**
 * THE ORDERING BUG, pinned. Start from clips OFF -- the state a previous
 * session or a stray toggle can leave behind -- and step one must still speak
 * from a recording, because step one declares `useClips: true`.
 *
 * Two separate faults made this fail, and both were invisible without real
 * playback. The screen never called `setClipsEnabled` at all (only useAudio
 * and the Settings toggle ever did, and this screen uses neither), and even
 * once it did, it read the settings from a ref React had not yet updated --
 * so it applied the step's setup and then immediately spoke under the
 * settings from before it. Either one turns every route answer in the whole
 * protocol into a measurement of the fallback voice.
 */
test('turns the recorded voice on before it speaks, even starting from off', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'bjtrainer.settings.v1',
      JSON.stringify({
        version: 1,
        audio: { enabled: true, useClips: false, muted: false, volume: 1 },
      }),
    );
  });

  await openTest(page);

  const path = page.getByTestId('fieldtest-path');
  await expect(path).toBeVisible({ timeout: 20_000 });
  await expect(path).toContainText('the recorded voice');
  await expect(path).not.toContainText('switched off');
});

/** The detail of the most recent `test` entry with this event, once flushed. */
async function readLast(
  page: import('@playwright/test').Page,
  event: string,
): Promise<Record<string, unknown> | undefined> {
  return page.evaluate((wanted) => {
    const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
    const all = raw
      ? (JSON.parse(raw) as { category: string; event: string; detail?: Record<string, unknown> }[])
      : [];
    return all.filter((e) => e.category === 'test' && e.event === wanted).at(-1)?.detail;
  }, event);
}

/**
 * THE PAIRING THE PROTOCOL EXISTS TO COLLECT.
 *
 * The screen's own header says it: pair the answer with the path that spoke
 * it. Drop `paths` from the stamp and every route answer in the export
 * becomes unattributable between the recorded voice and the phone's own --
 * so "the route follows the path", the leading hypothesis, and "the route
 * alternates at random", the null, produce identical logs. That is precisely
 * the failure the rewrite was for.
 *
 * Only provable here. Under `?e2e=1` speech is swallowed before a path is
 * chosen, so the ordinary harness sees no path either way and passes on the
 * defect.
 */
test('the answer is recorded together with the voice that spoke the line', async ({ page }) => {
  await openTest(page);
  await expect(page.getByTestId('fieldtest-path')).toBeVisible({ timeout: 20_000 });

  const answers = page.getByTestId('fieldtest-answers').locator('button');
  await expect(answers.first()).toBeEnabled({ timeout: 20_000 });
  // Past the bounce guard: a tap in the first 350ms of a step is ignored.
  await page.waitForTimeout(400);
  await answers.first().click();

  // POLLED, because the log buffers for a second before it writes -- reading
  // storage the instant after the tap races the flush.
  await expect
    .poll(() => readLast(page, 'answer'), { timeout: 10_000 })
    .not.toBeUndefined();
  const stamp = await readLast(page, 'answer');

  expect(stamp!.paths, 'the answer does not say which voice spoke').toBeTruthy();
  expect(String(stamp!.paths)).toMatch(/clip|tts/);
});

/**
 * The stamp count is how a run reports what it actually achieved. Without the
 * mark, `run-end stamped=` reads 0 for every drive, so a complete run and an
 * abandoned one are indistinguishable in the export.
 */
test('a run reports how many steps were actually answered', async ({ page }) => {
  await openTest(page);
  const answers = page.getByTestId('fieldtest-answers').locator('button');
  await expect(answers.first()).toBeEnabled({ timeout: 20_000 });
  // Past the bounce guard: a tap in the first 350ms of a step is ignored.
  await page.waitForTimeout(400);
  await answers.first().click();

  const finish = page.getByTestId('fieldtest-finish');
  await finish.click();
  await finish.click();

  await expect
    .poll(() => readLast(page, 'run-end'), { timeout: 10_000 })
    .not.toBeUndefined();
  const end = await readLast(page, 'run-end');
  expect(Number(end!.stamped), 'the answered step was not counted').toBeGreaterThan(0);
});

/**
 * A clip that made no sound used to log as a perfect utterance.
 *
 * `settleChain(chain, true)` was written by three different events -- the last
 * file's `ended`, the watchdog giving up after eight seconds, and a
 * deliberate interrupt -- and none of them logged anything. All three
 * produced a byte-identical export. A route that flips to a disconnected A2DP
 * sink makes the element accept `play()` and stall; the watchdog then reports
 * success, the log says the app spoke, and the operator's "Heard nothing" is
 * blamed on volume or car routing rather than on a clip that never rendered.
 */
test('a clip says how it ended, not merely that it did', async ({ page }) => {
  await openTest(page);
  await expect(page.getByTestId('fieldtest-path')).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
          const all = raw
            ? (JSON.parse(raw) as { category: string; event: string; detail?: Record<string, unknown> }[])
            : [];
          return all.filter((e) => e.category === 'speak' && e.event === 'clip-end').at(-1)?.detail;
        }),
      { timeout: 20_000 },
    )
    .not.toBeUndefined();

  const end = await page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
    const all = raw
      ? (JSON.parse(raw) as { category: string; event: string; detail?: Record<string, unknown> }[])
      : [];
    return all.filter((e) => e.category === 'speak' && e.event === 'clip-end').at(-1)?.detail;
  });

  // `ended` is the only reason that means the whole line was heard. The
  // others must be distinguishable from it, which is the entire point.
  expect(end!.reason, 'a clip ending carries no reason').toBeTruthy();
  expect(String(end!.reason)).toBe('ended');
  expect(Number(end!.ms), 'a stall would read as the full watchdog timeout').toBeGreaterThan(0);
});

/** Which build wrote the log, so a reader is not attributing behaviour to code that was not running. */
test('the log says which build produced it', async ({ page }) => {
  await openTest(page);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
          const all = raw
            ? (JSON.parse(raw) as { category: string; event: string; detail?: Record<string, unknown> }[])
            : [];
          return all.find((e) => e.category === 'env' && e.event === 'page-load')?.detail;
        }),
      { timeout: 20_000 },
    )
    .not.toBeUndefined();

  const env = await page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
    const all = raw
      ? (JSON.parse(raw) as { category: string; event: string; detail?: Record<string, unknown> }[])
      : [];
    return all.find((e) => e.category === 'env' && e.event === 'page-load')?.detail;
  });
  expect(env!.build, 'the log does not say which code wrote it').toBeTruthy();
  expect(String(env!.build)).not.toBe('unknown');
});


/** Every stored entry, for assertions about what the log does and does not say. */
async function allEvents(
  page: import('@playwright/test').Page,
): Promise<{ category: string; event: string; detail?: Record<string, unknown> }[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
    return raw
      ? (JSON.parse(raw) as { category: string; event: string; detail?: Record<string, unknown> }[])
      : [];
  });
}

/**
 * Leaving mid-line used to leave `say-start` with no `say-end`.
 *
 * That unclosed bracket is the signature of a stalled clip or a
 * `speechSynthesis` that never fired `end` — both live hypotheses the log
 * exists to test — and every Skip, Back, Pause and Finish manufactured one.
 * Reproduced in a single run as ten `say-start` against eight `say-end`.
 *
 * HERE RATHER THAN IN THE DEFAULT PROJECT, because under `?e2e=1` speech
 * resolves in a microtask: there is no window in which a line can be abandoned,
 * so a test there would pass without ever exercising the branch.
 */
test('a line abandoned half way says so instead of looking like a hang', async ({ page }) => {
  await openTest(page);
  // Skip while the first line is genuinely still playing.
  await page.getByTestId('fieldtest-skip').click();

  // The log buffers for FLUSH_DELAY_MS before it reaches storage, and the step
  // the skip landed on is speaking a line of its own, so a read taken the
  // instant the click returns sees neither the abandoned line nor the new one.
  // Polled to the settled state rather than slept on: what is being asserted is
  // that no bracket is left open FOREVER, which is what a stalled clip or a
  // `speechSynthesis` that never fires `end` looks like in the export.
  await expect
    .poll(
      async () => {
        const seen = await allEvents(page);
        const opened = seen.filter((e) => e.event === 'say-start').length;
        const shut = seen.filter(
          (e) => e.event === 'say-end' || e.event === 'say-cancelled',
        ).length;
        return opened > 0 && shut >= opened;
      },
      { timeout: 15_000, message: 'an utterance was left with no ending of any kind' },
    )
    .toBe(true);

  const events = await allEvents(page);
  const cancelled = events.filter((e) => e.event === 'say-cancelled');
  expect(
    cancelled.length,
    'the abandoned line closed itself as if it had finished playing',
  ).toBeGreaterThan(0);
  expect(
    cancelled.map((e) => e.detail?.why),
    'the export does not say the line was abandoned by leaving the step',
  ).toContain('left-the-step');
});

/**
 * The TTS arm of the 2x2 used to lose its `run=` stamps, and only the TTS arm.
 *
 * `say()` awaits `prewarmClips()` only when clips are ON, so the clip steps
 * yielded long enough for the ambient-context effect to land and the TTS steps
 * ran synchronously inside the step effect, while the context was down. The
 * loss was therefore systematic along the protocol's independent variable: the
 * half the protocol was restructured to add was the half that could not be
 * assembled by `grep run=`.
 */
test('the fallback-voice steps record their path attached to the run', async ({ page }) => {
  await openTest(page);
  for (let i = 0; i < 12; i += 1) {
    const at = await page.getByTestId('fieldtest-title').getAttribute('data-step');
    if (at === 'route-1t') break;
    await page.getByTestId('fieldtest-skip').click();
  }
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'route-1t');
  await expect(page.getByTestId('fieldtest-path')).toBeVisible({ timeout: 20_000 });

  const tts = (await allEvents(page)).filter(
    (e) => e.category === 'speak' && e.event === 'path' && e.detail?.path === 'tts',
  );
  expect(tts.length, 'no TTS path record at all').toBeGreaterThan(0);
  for (const e of tts) {
    expect(e.detail?.run, 'a TTS path record carries no run').toBeTruthy();
    expect(e.detail?.step, 'a TTS path record carries no step').toBeTruthy();
  }
});


/** Make the car's buttons pressable from the test, as a paired car would. */
async function captureWheel(page: import('@playwright/test').Page): Promise<void> {
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

function press(page: import('@playwright/test').Page, action: string): Promise<boolean> {
  return page.evaluate(
    (a) => (window as unknown as { __wheel?: (x: string) => boolean }).__wheel?.(a) ?? false,
    action,
  );
}

/**
 * The wheel block contrasts pressing WHILE the app talks against pressing in
 * the silence, and on three of its six steps that variable was uncontrolled.
 *
 * `wheel-back`, `wheel-other` and `wheel-repeat` declare no line of their own,
 * and a step with no line has its instruction read aloud through live TTS. So
 * the step whose instruction is "press skip-BACK on the wheel once, in the
 * silence" is talking while the operator reads it and presses — and nothing in
 * the export said so, because the spoken instruction reached the log as a
 * single `instruction-spoken` with no opening bracket. A press in the first
 * second of that step and a press ten seconds later were the same record.
 *
 * HERE RATHER THAN IN THE DEFAULT PROJECT, because under `?e2e=1` speech
 * resolves in a microtask: there is no interval during which the app is
 * speaking, so a press there is always in the silence and the test could only
 * ever see one of the two states it exists to distinguish.
 */
test('a wheel press says whether the app was talking when it landed', async ({ page }) => {
  await captureWheel(page);
  await openTest(page);
  for (let i = 0; i < 14; i += 1) {
    if ((await page.getByTestId('fieldtest-title').innerText()) === 'Skip-back') break;
    await page.getByTestId('fieldtest-skip').click();
  }
  await expect(page.getByTestId('fieldtest-title')).toHaveText('Skip-back');

  // The instruction starts reading itself the moment the step opens, so this
  // press lands inside it.
  expect(await press(page, 'previoustrack')).toBe(true);
  await expect(page.getByTestId('fieldtest-wheel')).toContainText('1 press');

  // ...and this one lands after it. THE LOG IS THE SIGNAL, not the repeat
  // control: that button is no longer disabled while an instruction reads,
  // because an instruction is not a measured line and must not hold the step's
  // answers — so on a silent step there is nothing on screen that changes when
  // the reading ends. `instruction-spoken` is what actually says so.
  await expect
    .poll(
      async () => (await allEvents(page)).some((e) => e.event === 'instruction-spoken'),
      { timeout: 30_000 },
    )
    .toBe(true);
  await press(page, 'nexttrack');
  await expect(page.getByTestId('fieldtest-wheel')).toContainText('2 presses');

  const arrivals = await expect
    .poll(
      async () =>
        (await allEvents(page)).filter((e) => e.event === 'field-test-arrival').length,
      { timeout: 5_000 },
    )
    .toBeGreaterThanOrEqual(2)
    .then(async () => (await allEvents(page)).filter((e) => e.event === 'field-test-arrival'));

  expect(
    arrivals.some((e) => e.detail?.whileSpeaking === true),
    'a press made while the app was reading the instruction is not marked as such',
  ).toBe(true);
  expect(
    arrivals.some((e) => e.detail?.whileSpeaking === false),
    'a press made in the silence is not distinguishable from one made during speech',
  ).toBe(true);

  // The bracket the timing above is read against. Without the opening line a
  // reader has an end and no beginning, which is what a stalled utterance also
  // looks like.
  const events = await allEvents(page);
  expect(
    events.some((e) => e.event === 'instruction-start'),
    'the spoken instruction has no opening bracket',
  ).toBe(true);
  expect(
    events.some((e) => e.event === 'instruction-spoken'),
    'the spoken instruction has no closing bracket',
  ).toBe(true);
});
