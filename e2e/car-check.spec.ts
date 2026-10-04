import { test, expect, type Page } from '@playwright/test';

/**
 * The car check, end to end.
 *
 * What is worth asserting here is not how many rows appeared -- it is the two
 * properties the whole design rests on: the microphone is shut while the
 * speaker and wheel checks run, and the run tells the operator what to do
 * next rather than leaving them to read ticks. Plus the one thing a count
 * cannot say: that every named check actually reported.
 */


interface LogEntry {
  event: string;
  detail?: Record<string, unknown>;
}

async function readLog(page: Page): Promise<LogEntry[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  });
}

async function readPhases(page: Page): Promise<LogEntry[]> {
  return (await readLog(page)).filter((e) => e.event === 'car-check:phase');
}

async function openCarCheck(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  // Every collapsible section is forced open under ?e2e=1, so there is
  // nothing to expand -- the panel is already on the page.
  await expect(page.getByTestId('carcheck')).toBeVisible();
}

test('runs every check and ends with something to do next', async ({ page }) => {
  await openCarCheck(page);
  await page.getByTestId('carcheck-start').click();

  // The wheel check waits (shortened under ?e2e=1) and the ambient window
  // runs, so give the whole run room.
  await expect(page.getByTestId('carcheck-next')).toBeVisible({ timeout: 30_000 });

  /**
   * By NAME, not by count. A bare row count was the old assertion and it was
   * the weaker instrument twice over: it went red when five device checks were
   * added in 2026-10-03, which is maintenance rather than a fault, and it
   * would have stayed green if one check had quietly been replaced by another.
   * What the run must actually guarantee is that every check the panel lists
   * reaches a verdict -- a check that throws, hangs, or is dropped from the
   * list is the fault this exists to catch, and the symptom is a MISSING NAME.
   */
  const EXPECTED = [
    'clip-voice',
    'audio-out',
    'audio-graph',
    'element-volume',
    'chime-audible',
    'clip-speed',
    'media-slot',
    'wheel-press',
    'ambient',
    'output-route',
    // The capability checks (2026-10-04). Each is silently refused in
    // conditions that only exist on a phone, and each presents as the app
    // simply stopping, so each has to be asked on the phone.
    'wake-lock',
    'offline-clips',
    'storage',
    'build',
    // And the handoff pair, which is the whole earpiece question: the same
    // clip played with the microphone open and then with it shut.
    'handoff-route',
    'mic-restart',
  ];
  const rows = page.getByTestId('carcheck-results').locator('li');
  const texts = await rows.allTextContents();
  for (const id of EXPECTED) {
    expect(texts.filter((t) => t.includes(id)), `${id} should report exactly once`).toHaveLength(1);
  }
  expect(texts).toHaveLength(EXPECTED.length);
  // Every row reached a verdict; none is left blank.
  for (const text of texts) {
    expect(text.trim().length).toBeGreaterThan(10);
  }
  /*
   * NOT ASSERTING THAT THEY PASS, on purpose. Several of these report a
   * genuine absence in headless Chromium -- there is no screen to keep awake
   * and no service worker holding a clip -- and bending them to pass here
   * would mean bending them to pass on the phone too, where the same absence
   * is the fault worth knowing about. What this test guarantees is that every
   * check reaches a verdict and names itself.
   */
  const marks = texts.map((t) => t.trim()[0]);
  expect(marks.every((m) => ['✓', '✗', '?', '–'].includes(m ?? ''))).toBe(true);
});

/**
 * The invariant the two-phase split exists for, asserted from the log rather
 * than from the UI: the wheel and speaker checks must be recorded while the
 * microphone is shut. If they ever run with it open, the car has flipped to
 * its hands-free profile and the wheel check cannot pass however healthy the
 * app is -- a test that always fails is as useless as one that always passes.
 */
test('keeps the microphone shut for the speaker phase', async ({ page }) => {
  await openCarCheck(page);
  await page.getByTestId('carcheck-start').click();
  await expect(page.getByTestId('carcheck-next')).toBeVisible({ timeout: 30_000 });

  // The diagnostic log flushes on a 1s buffer, so poll rather than race it.
  await expect.poll(() => readPhases(page).then((p) => p.length), { timeout: 10_000 }).toBe(3);
  const phases = await readPhases(page);

  const speaker = phases.find((p) => p.detail?.phase === 'speaker');
  const microphone = phases.find((p) => p.detail?.phase === 'microphone');
  const handoff = phases.find((p) => p.detail?.phase === 'handoff');
  expect(speaker?.detail?.micOpen).toBe(false);
  expect(microphone?.detail?.micOpen).toBe(true);
  /*
   * AND THE HANDOFF PHASE RUNS WITH IT SHUT, which is the entire measurement.
   * It is shut in the speaker phase too, but there it has never been open;
   * here it has, and whether closing it gives the loudspeaker back is the
   * question. If this phase ever ran with the microphone open it would be
   * measuring the state it exists to escape, and would agree with
   * `output-route` every time -- a check that cannot fail.
   */
  expect(handoff?.detail?.micOpen).toBe(false);
  // The only order that works: shut, open, then shut again having been open.
  expect(phases.indexOf(speaker!)).toBeLessThan(phases.indexOf(microphone!));
  expect(phases.indexOf(microphone!)).toBeLessThan(phases.indexOf(handoff!));
});

/**
 * A wheel press nobody made must read as inconclusive, not as a fault. In
 * headless Chromium no car exists, so this is the state the run lands in --
 * and the next-steps text has to say so in those terms.
 */
test('says a missing wheel press is inconclusive, not broken', async ({ page }) => {
  await openCarCheck(page);
  await page.getByTestId('carcheck-start').click();
  await expect(page.getByTestId('carcheck-next')).toBeVisible({ timeout: 30_000 });

  await expect(page.getByTestId('carcheck-next')).toContainText('No wheel button arrived');
});

/** The run must never leave a microphone open behind it. */
test('leaves no microphone open when it finishes', async ({ page }) => {
  await openCarCheck(page);
  await page.getByTestId('carcheck-start').click();
  await expect(page.getByTestId('carcheck-next')).toBeVisible({ timeout: 30_000 });

  const live = await page.evaluate(() => {
    const w = window as unknown as { __openStreams?: number };
    return w.__openStreams ?? 0;
  });
  expect(live).toBe(0);

  await expect
    .poll(() => readLog(page).then((l) => l.some((e) => e.event === 'car-check:done')), {
      timeout: 10_000,
    })
    .toBe(true);
});
