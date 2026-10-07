import { test, expect, type Page } from '@playwright/test';

/**
 * Do the instruments the next car run depends on actually fire?
 *
 * Every conclusion drawn from 2026-10-06 turned on log lines, and three of them
 * could not be drawn at all because the line that would settle the question did
 * not exist: the engine's session restarts were silent, the probe's level was
 * unrecorded, and a scoped copy of the log claimed to be the whole log. Each has
 * since been added -- and not one of them has been seen in a run on the phone.
 *
 * So this walks the car-bt kit the way Jack will and asserts the lines land in
 * the stored log. A missing instrument costs a drive; a failing test costs
 * nothing.
 *
 * Scope: that the lines FIRE, with the fields a reader needs. What they mean is
 * `testKitIO.test.ts` and `diagnosticLog.test.ts`.
 */
const PHONE = { width: 375, height: 812 };

/**
 * A recogniser the test drives, standing in for WebKit's.
 *
 * Exposes `__fake` so a spec can end a session the way the engine does after
 * silence. `stop()` fires `onerror` with `aborted` BEFORE `onend`, because that
 * is what WebKit does and it is the whole reason `kit-mic-abort-on-close`
 * exists -- a fake that stayed quiet there would let the test pass with the
 * feature removed.
 */
async function withFakeEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      maxAlternatives = 1;
      lang = '';
      onstart: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;

      constructor() {
        (window as unknown as { __fake: FakeRecognition }).__fake = this;
      }
      start(): void {
        // Asynchronous, as the real one is: openMic awaits onaudiostart, and
        // without it the whole spec rides out its 4s grace period per open.
        setTimeout(() => {
          this.onstart?.();
          this.onaudiostart?.();
        }, 0);
      }
      stop(): void {
        this.onerror?.({ error: 'aborted' });
        this.onend?.();
      }
      abort(): void {
        this.onerror?.({ error: 'aborted' });
        this.onend?.();
      }
      /** The engine giving up after silence, which is what it really does. */
      endBySilence(): void {
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
}

/**
 * The stored log, which is where a copied export comes from. Entries buffer for
 * FLUSH_DELAY_MS (1s) before they are written, so every read of this is polled.
 */
async function loggedEvents(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
      if (!raw) return [];
      return (JSON.parse(raw) as Array<{ event?: string }>).map((r) => r.event ?? '');
    } catch {
      return [];
    }
  });
}

async function lastDetail(page: Page, event: string): Promise<Record<string, unknown> | null> {
  return page.evaluate((wanted) => {
    try {
      const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
      if (!raw) return null;
      const rows = JSON.parse(raw) as Array<{ event?: string; detail?: Record<string, unknown> }>;
      return rows.filter((r) => r.event === wanted).pop()?.detail ?? null;
    } catch {
      return null;
    }
  }, event);
}

async function intoKit(page: Page, kit: RegExp): Promise<void> {
  await withFakeEngine(page);
  await page.setViewportSize(PHONE);
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await page.getByRole('button', { name: kit }).click();
}

/** The kit's own microphone, once it is the recogniser `__fake` points at. */
async function kitMicOpen(page: Page): Promise<void> {
  await expect.poll(() => loggedEvents(page), { timeout: 20_000 }).toContain('kit-mic-open');
}

test('the blind step records one line saying which route state the run was in', async ({ page }) => {
  test.setTimeout(90_000);
  await intoKit(page, /Bluetooth ON/);
  await expect(page.locator('[data-step="bt-blind-mic-open"]')).toBeVisible();
  const kit = page.getByTestId('testkit-screen');

  // Six blind plays, every one heard on the car speakers: the good state.
  for (let i = 0; i < 6; i++) {
    await kit.getByRole('button', { name: /^Play/ }).click();
    await kit.getByRole('button', { name: 'Car speakers' }).click();
  }
  await expect(page.getByTestId('testkit-blind-result')).toContainText('on the car speakers');
  await kit.getByRole('button', { name: 'Next', exact: true }).click();

  /*
   * THE LINE THE WHOLE RUN IS READ AGAINST. Four car runs on 2026-10-06 gave
   * two different route states, and every later step only means something once
   * you know which one it happened in. Reading that off six scattered
   * `kit-blind` lines is work a reader should not have to do -- and I got it
   * wrong once already by conflating two runs.
   */
  await expect.poll(() => loggedEvents(page), { timeout: 15_000 }).toContain('kit-route-state');
  const detail = await lastDetail(page, 'kit-route-state');
  expect(detail?.state).toBe('always');
  expect(detail?.target).toBe('Car speakers');
  expect(detail?.hits).toBe(6);
  expect(detail?.trials).toBe(6);
  // The answers themselves, so a mixed run can be read without the six lines.
  expect(detail?.answers).toEqual([
    'Car speakers',
    'Car speakers',
    'Car speakers',
    'Car speakers',
    'Car speakers',
    'Car speakers',
  ]);
});

test('a mixed run is classified as mixed, not as a pass', async ({ page }) => {
  test.setTimeout(90_000);
  await intoKit(page, /Bluetooth ON/);
  await expect(page.locator('[data-step="bt-blind-mic-open"]')).toBeVisible();
  const kit = page.getByTestId('testkit-screen');

  // Five on the car, one on the phone -- the shape that makes the route state
  // intermittent rather than broken, and the reading that matters most.
  for (let i = 0; i < 6; i++) {
    await kit.getByRole('button', { name: /^Play/ }).click();
    await kit.getByRole('button', { name: i === 3 ? 'Phone loud speaker' : 'Car speakers' }).click();
  }
  await kit.getByRole('button', { name: 'Next', exact: true }).click();

  await expect.poll(() => loggedEvents(page), { timeout: 15_000 }).toContain('kit-route-state');
  const detail = await lastDetail(page, 'kit-route-state');
  expect(detail?.state).toBe('mixed');
  expect(detail?.hits).toBe(5);
});

test('closing the kit microphone is logged as a close, not as an error', async ({ page }) => {
  test.setTimeout(90_000);
  await intoKit(page, /Bluetooth ON/);
  await expect(page.locator('[data-step="bt-blind-mic-open"]')).toBeVisible();
  const kit = page.getByTestId('testkit-screen');

  // The blind step holds one session across all six plays and closes it at the
  // end, which is the only deliberate close in the kit.
  for (let i = 0; i < 6; i++) {
    await kit.getByRole('button', { name: /^Play/ }).click();
    await kit.getByRole('button', { name: 'Car speakers' }).click();
  }

  /*
   * `close()` calls `rec.stop()`, and WebKit answers that with `onerror` /
   * `aborted` -- so every clean shutdown used to write `kit-mic-error
   * error=aborted` right beside `kit-mic-closed`. Jack's exports are full of
   * them, and a log that cries error on every normal close teaches its reader
   * to skip error lines, which is the opposite of what this log is for.
   */
  await expect.poll(() => loggedEvents(page), { timeout: 15_000 }).toContain('kit-mic-closed');
  const events = await loggedEvents(page);
  expect(events, 'the aborted-on-close branch never ran').toContain('kit-mic-abort-on-close');
  expect(events.filter((e) => e === 'kit-mic-error')).toEqual([]);
});

test('a session the engine ends underneath the run is recorded as a restart', async ({ page }) => {
  test.setTimeout(90_000);
  await intoKit(page, /Bluetooth ON/);
  await expect(page.locator('[data-step="bt-blind-mic-open"]')).toBeVisible();
  const kit = page.getByTestId('testkit-screen');

  await kit.getByRole('button', { name: /^Play/ }).click();
  await kitMicOpen(page);

  // The engine giving up after silence -- what sat between every failed attempt
  // and its retry in the car, and was never once written down.
  await page.evaluate(() => {
    (window as unknown as { __fake: { endBySilence(): void } }).__fake.endBySilence();
  });

  await expect.poll(() => loggedEvents(page), { timeout: 20_000 }).toContain('kit-mic-restart');
  const restart = await lastDetail(page, 'kit-mic-restart');
  // The count, so a word can be joined to the session it was said in.
  expect(restart?.n, 'the restart must say which session it opened').toBe(2);
  expect(restart?.why).toBe('engine-ended');
});

test('each word window logs its own attempt, with the session and speech counts', async ({ page }) => {
  test.setTimeout(120_000);
  /*
   * The word step itself, reached through `words-at-speed` because it is one
   * tap away: the car-bt kit runs the same component, and that kit's step ORDER
   * is covered in `testKit.test.ts` without costing a 6-second window per word.
   */
  await intoKit(page, /Words at speed/);
  const kit = page.getByTestId('testkit-screen');
  await kit.getByRole('button', { name: 'Bluetooth off' }).click();
  await expect(page.locator('[data-step="speed-calibrate"]')).toBeVisible();
  await kit.getByRole('button', { name: 'Start', exact: true }).click();

  await expect
    .poll(() => loggedEvents(page), { timeout: 60_000 })
    .toContain('kit-calibrate-attempt');

  const attempt = await lastDetail(page, 'kit-calibrate-attempt');
  /*
   * `kit-calibrate` logs the WORD's outcome, so a first attempt that heard
   * nothing left no line at all -- which is why both attempts of all twenty
   * words of the 2026-10-06 run are missing from its export. These three fields
   * are what separate "between sessions", "live but dropped" and "deaf while
   * open", and those want opposite fixes.
   */
  expect(attempt?.attempt).toBe(1);
  expect(attempt?.offered).toBe(0);
  // Nobody spoke, so this window is the deaf-while-open shape -- and it must be
  // recorded as that rather than left absent.
  expect(attempt?.speech).toBe(0);
  expect(attempt?.sessionsAtOpen, 'the window ran with no engine session open').toBeGreaterThan(0);
  expect(typeof attempt?.sessionsAtClose).toBe('number');
  expect(typeof attempt?.tookMs).toBe('number');
});
