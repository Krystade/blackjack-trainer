import { test, expect, type Page } from '@playwright/test';

/**
 * The car check, end to end.
 *
 * What is worth asserting here is not that five rows appeared -- it is the
 * two properties the whole design rests on: the microphone is shut while the
 * speaker and wheel checks run, and the run tells the operator what to do
 * next rather than leaving them to read ticks.
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

  const rows = page.getByTestId('carcheck-results').locator('li');
  await expect(rows).toHaveCount(5);
  // Every row reached a verdict; none is left blank.
  for (const text of await rows.allTextContents()) {
    expect(text.trim().length).toBeGreaterThan(10);
  }
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
  await expect.poll(() => readPhases(page).then((p) => p.length), { timeout: 10_000 }).toBe(2);
  const phases = await readPhases(page);

  const speaker = phases.find((p) => p.detail?.phase === 'speaker');
  const microphone = phases.find((p) => p.detail?.phase === 'microphone');
  expect(speaker?.detail?.micOpen).toBe(false);
  expect(microphone?.detail?.micOpen).toBe(true);
  // ...and the speaker phase came first, which is the only order that works.
  expect(phases.indexOf(speaker!)).toBeLessThan(phases.indexOf(microphone!));
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
