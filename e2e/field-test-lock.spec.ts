import { test, expect, type Page } from '@playwright/test';
import { withSettings, selectFieldTestCondition} from './helpers';
import { FIELD_TEST_STEPS } from '../src/diag/fieldTest';
import { LOCK_PROBE_TICK_MS } from '../src/diag/lockProbe';

/**
 * THE LOCK PROBE, DRIVEN.
 *
 * `lockProbe.test.ts` pins the arithmetic. This proves the runner actually
 * does it: the marker goes down when the STEP OPENS and claims no lock until
 * one happens, ticks are written only while hidden, a hidden/visible cycle is
 * scored from the gaps, and a page that died on the step is scored by the
 * next boot -- under the lock as `frozen-unloaded`, with no `hidden` event
 * ever delivered as `unloaded-no-hidden`.
 *
 * WHAT THE ARRIVAL MARKER COSTS, and what pins the price: the first build
 * armed on arrival and cleared only on a hidden/visible cycle, so leaving the
 * step any other way, or reloading without ever locking, scored a kill that
 * never happened. Two of those exits are held to scoring nothing below --
 * stepping back off the step, and a reload that was never hidden. The rest
 * (Pause, Finish, a skip forward, a condition change) leave through the same
 * unconditional cleanup, so the mechanism is covered and the individual exits
 * are not.
 *
 * Chromium here is never really hidden, so the "lock" is `visibilityState`
 * faked and `visibilitychange` dispatched; the page keeps ticking through it,
 * which is the NORMAL verdict. The frozen verdict is reached the way iOS
 * produces it: real time jumps, and the one tick that landed is the overdue
 * callback firing on resume.
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

async function marker(
  page: Page,
): Promise<{ session: string; onStepAt: string; hiddenAt?: string } | undefined> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.fieldTestRun.v1');
    return raw
      ? (
          JSON.parse(raw) as {
            lockProbe?: { session: string; onStepAt: string; hiddenAt?: string };
          }
        ).lockProbe
      : undefined;
  });
}

async function openTest(page: Page): Promise<void> {
  await withSettings(page, {});
  await selectFieldTestCondition(page, 'Car, parked');
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  const start = page.getByTestId('fieldtest-start');
  await start.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
}

async function goToStep(page: Page, id: string): Promise<void> {
  const want = FIELD_TEST_STEPS.find((s) => s.id === id);
  expect(want, `${id} is not in the protocol`).toBeTruthy();
  const title = page.getByTestId('fieldtest-title');
  for (let i = 0; i < FIELD_TEST_STEPS.length + 2; i++) {
    if ((await title.getAttribute('data-step')) === id) return;
    await page.getByTestId('fieldtest-skip').click();
  }
  throw new Error(`never reached ${id}`);
}

async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/**
 * Several events in ONE turn of the page, so no interval tick can land
 * between them. `jump` is the clock moving thirty seconds with the page
 * frozen -- and nothing else: a real interval on Chromium keeps firing, and
 * a wait after the jump lets one or two ticks land depending on where the
 * jump fell in the tick's phase, which made the verdict a coin toss.
 *
 * Each `jump` wraps the already-patched clock, so two of them in one burst
 * leave the page a minute ahead. Every window's own gap is still thirty
 * seconds, which is what the verdicts are read from.
 */
async function burst(page: Page, steps: ('hidden' | 'visible' | 'jump')[]): Promise<void> {
  await page.evaluate((list) => {
    for (const s of list) {
      if (s === 'jump') {
        const real = Date.now;
        Date.now = () => real() + 30_000;
        continue;
      }
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
      document.dispatchEvent(new Event('visibilitychange'));
    }
  }, steps);
}

const ticks = async (page: Page) =>
  (await entries(page)).filter((e) => e.event === 'lock-probe-tick').length;
const result = async (page: Page) =>
  (await entries(page)).find((e) => e.event === 'lock-probe-result')?.detail;
const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);

test('scores a lock from the gaps in its own ticks, and says so', async ({ page }) => {
  await openTest(page);
  await goToStep(page, 'lock-probe');

  // Nothing is written while the screen is on: no marker, and no tick rows.
  // The clock runs, but a row every two seconds for as long as the operator
  // sits on the step is the run's own history scrolling out of the log.
  await page.waitForTimeout(4_500);
  // The marker is down from the moment the step opens -- the event a lock
  // announces itself with is one iOS can swallow -- but it claims no lock
  // until one happens.
  expect(await marker(page), 'no marker on the step at all').toBeTruthy();
  expect(
    (await marker(page))?.hiddenAt,
    'a marker claimed a lock before the phone was locked',
  ).toBeUndefined();
  expect(await ticks(page), 'tick rows while visible').toBe(0);

  await setVisibility(page, 'hidden');
  await expect
    .poll(() => marker(page), { timeout: 3_000 })
    .toMatchObject({ hiddenAt: expect.any(String) });
  await page.waitForTimeout(6_500);
  await expect.poll(() => ticks(page), { timeout: 3_000 }).toBeGreaterThanOrEqual(2);
  await setVisibility(page, 'visible');

  await expect.poll(() => result(page), { timeout: 5_000 }).toMatchObject({
    classification: 'normal',
    ticksInside: expect.any(Number),
    maxGapMs: expect.any(Number),
  });
  const r = (await result(page))!;
  expect(r.hiddenMs as number).toBeGreaterThanOrEqual(6_000);
  expect(r.ticksInside as number).toBeGreaterThanOrEqual(2);
  expect(r.maxGapMs as number).toBeLessThan(5_000);

  // The verdict is spoken as well as written: the operator has just unlocked
  // the phone and is not reading the log.
  expect(await spoken(page)).toContain('The page kept running while the phone was locked.');

  // Scored once: the lock is spent, so a second boot finds no lock to score
  // -- while the marker itself stays down, because the operator is still on
  // the step and a kill from here still happened here.
  expect((await marker(page))?.hiddenAt, 'the scored lock was left to be scored again')
    .toBeUndefined();
  expect(await marker(page), 'the step stopped saying it was open').toBeTruthy();
});

/**
 * A SECOND LOCK ON THE SAME STEP starts from a clean baseline. The ticks the
 * first verdict read are cleared; without that, a freeze scored a moment
 * ago is the "gap before hidden" of a re-lock that follows it at once, and a
 * normal second lock reads frozen.
 */
test('a re-lock straight after a frozen verdict is scored on its own', async ({ page }) => {
  await openTest(page);
  await goToStep(page, 'lock-probe');
  await page.waitForTimeout(4_500);
  // The whole first lock, its verdict and the re-lock in one turn, so no
  // tick lands anywhere in it: without the reset, the ticks before the first
  // lock sit thirty seconds behind the second and it reads frozen.
  await burst(page, ['hidden', 'jump', 'visible', 'hidden']);
  await expect
    .poll(async () => (await result(page))?.classification, { timeout: 5_000 })
    .toBe('frozen');
  await page.waitForTimeout(6_500);
  await setVisibility(page, 'visible');
  await expect
    .poll(async () => (await entries(page)).filter((e) => e.event === 'lock-probe-result').length, {
      timeout: 5_000,
    })
    .toBe(2);
  const second = (await entries(page)).filter((e) => e.event === 'lock-probe-result').at(-1)!.detail;
  expect(second.classification, 'the first lock\u2019s freeze was read into the second').toBe(
    'normal',
  );
  expect(second.gapBeforeHiddenMs as number).toBeLessThan(5_000);
});

/**
 * THE MOMENT OF THE VERDICT IS THE NEXT WINDOW'S FIRST TICK. A re-lock
 * within a tick of it, with `hidden` arriving late and the page frozen, has
 * no tick before `hidden` except the overdue one -- and with nothing to
 * start the window from it read `too-short`.
 */
test('a frozen re-lock straight after a verdict is still scored frozen', async ({ page }) => {
  await openTest(page);
  await goToStep(page, 'lock-probe');
  await page.waitForTimeout(4_500);
  // Frozen again at once, with `hidden` delivered on the way back: the
  // first lock, its verdict, the second freeze and the late event in one
  // turn, so the only tick before the second `hidden` is the one the
  // verdict seeded.
  await burst(page, ['hidden', 'jump', 'visible', 'jump', 'hidden']);
  await expect
    .poll(async () => (await result(page))?.classification, { timeout: 5_000 })
    .toBe('frozen');
  await page.waitForTimeout(300);
  await setVisibility(page, 'visible');
  await expect
    .poll(async () => (await entries(page)).filter((e) => e.event === 'lock-probe-result').length, {
      timeout: 5_000,
    })
    .toBe(2);
  const second = (await entries(page)).filter((e) => e.event === 'lock-probe-result').at(-1)!.detail;
  expect(second.classification, 'no tick to start the window from').toBe('frozen');
  expect(second.gapBeforeHiddenMs as number).toBeGreaterThanOrEqual(27_000);
});

/**
 * THE ARRIVAL IS THE FIRST TICK. A lock taken the moment the step opens,
 * with the page frozen and `hidden` delivered late, has no interval tick
 * before it -- and with nothing to start the window from it read
 * `too-short`.
 */
test('a frozen lock taken the moment the step opens is still scored frozen', async ({ page }) => {
  await openTest(page);
  // Stop one step short, so the clock can be started immediately before the
  // press that mounts the probe's effect.
  await goToStep(page, 'ambient');
  const opened = Date.now();
  await page.getByTestId('fieldtest-skip').click();
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'lock-probe');
  await burst(page, ['jump', 'hidden']);
  // THE WHOLE POINT IS THAT NO INTERVAL TICK HAS LANDED YET: one would start
  // the window by itself and the verdict would be `frozen` with the arrival
  // seed deleted. A slow machine that let a tick through fails here rather
  // than passing against code that has no seed.
  expect(
    Date.now() - opened,
    'a tick may have landed before the lock, so this run proves nothing',
  ).toBeLessThan(LOCK_PROBE_TICK_MS);
  await page.waitForTimeout(300);
  await setVisibility(page, 'visible');
  await expect
    .poll(async () => (await result(page))?.classification, { timeout: 5_000 })
    .toBe('frozen');
  expect((await result(page))!.gapBeforeHiddenMs as number).toBeGreaterThanOrEqual(27_000);
});

/**
 * A PAGE THAT DIED ON THE STEP WITHOUT EVER GOING HIDDEN. iOS can deliver
 * `visibilitychange` late or not at all, and a force-quit with the screen on
 * looks the same from in here -- so this is not a verdict about the lock. It
 * is the row that tells "this leg has no lock reading" from "this leg never
 * reached the step", which were the same silence: nothing was written at all.
 */
test('a page that died on the step with no hidden event is scored as that, not as a lock', async ({
  page,
}) => {
  await openTest(page);
  await goToStep(page, 'lock-probe');
  const left = (await marker(page))!;
  expect(left.hiddenAt, 'the phone was never locked in this test').toBeUndefined();

  // A KILL CANNOT BE DRIVEN FROM HERE -- iOS discarding the page fires
  // nothing, and a reload is a navigation, which clears the marker on
  // purpose. So leave the step (clearing the live marker) and put back what a
  // killed page would have left: this step's own marker, under a session id
  // that is nobody's.
  await page.getByTestId('fieldtest-prev').click();
  await expect.poll(() => marker(page), { timeout: 3_000 }).toBeUndefined();
  await page.evaluate((m) => {
    const raw = localStorage.getItem('bjtrainer.fieldTestRun.v1')!;
    const run = JSON.parse(raw) as Record<string, unknown>;
    localStorage.setItem(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({ ...run, lockProbe: { ...m, session: 'dead' } }),
    );
  }, left);
  await page.reload();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();

  await expect
    .poll(async () => (await result(page))?.classification, { timeout: 5_000 })
    .toBe('unloaded-no-hidden');
  const r = (await result(page))!;
  expect(r.onStepAt).toBe(left.onStepAt);
  expect(r.hiddenAt, 'a lock was claimed where none was recorded').toBeUndefined();
  // Once, and the marker is spent.
  await page.waitForTimeout(1_500);
  expect((await entries(page)).filter((e) => e.event === 'lock-probe-result')).toHaveLength(1);
  expect(await marker(page)).toBeUndefined();
});

/**
 * A NAVIGATION UNDER THE LOCK IS NOT A KILL. The update check reloads the
 * app by itself; a reload fires `pagehide persisted=false` and then
 * `hidden`, and the marker has to be cleared on the way out or the next
 * boot scores a kill that never happened (the original B1).
 */
test('a reload while hidden clears the marker, and the next boot scores nothing', async ({
  page,
}) => {
  await openTest(page);
  await goToStep(page, 'lock-probe');
  await setVisibility(page, 'hidden');
  await expect.poll(() => marker(page), { timeout: 3_000 }).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(await marker(page), 'the navigation left the marker for the next boot').toBeUndefined();
  expect(
    (await entries(page)).filter((e) => e.event === 'lock-probe-result'),
    'a reload was scored as a kill',
  ).toHaveLength(0);
});

test('one overdue tick on resume is a frozen page, not a throttled one', async ({ page }) => {
  await openTest(page);
  await goToStep(page, 'lock-probe');
  await setVisibility(page, 'hidden');
  // One real tick lands, then the phone "sleeps" for thirty seconds: the clock
  // jumps and the next callback is the overdue one firing on resume.
  await page.waitForTimeout(2_500);
  await page.evaluate(() => {
    const real = Date.now;
    Date.now = () => real() + 30_000;
  });
  await page.waitForTimeout(2_200);
  await setVisibility(page, 'visible');

  await expect
    .poll(() => result(page), { timeout: 5_000 })
    .toMatchObject({ classification: 'frozen' });
  const r = (await result(page))!;
  expect(r.maxGapMs as number).toBeGreaterThanOrEqual(27_000);
  expect(await spoken(page)).toContain('The page was frozen while the phone was locked.');
});

/**
 * THE SCREEN FEEDS THE CLASSIFIER THE TICKS BEFORE `hidden` TOO. iOS can
 * deliver the event on the way back, with the whole lock sitting before it.
 * The clock jumps while the page is still "visible", then a 300 ms
 * hidden/visible pair arrives: a window that short read `too-short` for
 * ever. (The overdue callback landing before the late event is the
 * classifier's own case, in lockProbe.test.ts: a real interval here fires
 * one or two after the jump depending on its phase.)
 */
test('a hidden event that arrives on resume still scores the lock before it', async ({
  page,
}) => {
  await openTest(page);
  await goToStep(page, 'lock-probe');
  await page.waitForTimeout(4_500);
  await burst(page, ['jump', 'hidden']);
  await page.waitForTimeout(300);
  await setVisibility(page, 'visible');

  await expect
    .poll(() => result(page), { timeout: 5_000 })
    .toMatchObject({ classification: 'frozen' });
  const r = (await result(page))!;
  expect(r.hiddenMs as number).toBeLessThan(3_000);
  expect(r.gapBeforeHiddenMs as number).toBeGreaterThanOrEqual(27_000);
  expect(r.maxGapMs as number).toBeGreaterThanOrEqual(27_000);
  expect(await spoken(page)).toContain('The page was frozen while the phone was locked.');
});

/**
 * A `pagehide` under the lock is the one row that says whether the marker
 * was cleared by a navigation or left for the next boot -- and the boot-time
 * listener had already flushed before it was written, so on a kill it never
 * reached storage.
 */
test('a pagehide while hidden is written, and reaches storage at once', async ({ page }) => {
  await openTest(page);
  await goToStep(page, 'lock-probe');
  await setVisibility(page, 'hidden');
  await expect.poll(() => marker(page), { timeout: 3_000 }).toBeTruthy();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  });
  // No waiting on the one-second buffer: the row is flushed as it is written.
  const row = (await entries(page)).find((e) => e.event === 'lock-probe-pagehide');
  expect(row, 'the pagehide row did not reach storage').toBeTruthy();
  expect(row!.detail).toMatchObject({ step: 'lock-probe', persisted: true, hidden: true });
  // Entering the back-forward cache is not a navigation: the marker stays.
  expect(await marker(page)).toBeTruthy();
});

test('a page killed while hidden is scored by the next boot', async ({ page }) => {
  await openTest(page);
  await goToStep(page, 'lock-probe');
  await setVisibility(page, 'hidden');
  await expect.poll(() => marker(page), { timeout: 3_000 }).toBeTruthy();
  // Nothing is scored while the probe's own session is still alive.
  expect((await entries(page)).filter((e) => e.event === 'lock-probe-result')).toHaveLength(0);

  // iOS discarding the page fires nothing, so it cannot be driven from here:
  // a reload is a navigation, and a navigation is exactly what the probe
  // must NOT score (the reload-while-hidden test). What a kill leaves behind is the marker in
  // storage under a session id that is no longer anyone's; that is what the
  // next boot finds.
  const left = (await marker(page)) as { hiddenAt: string; session: string };
  // Leave the step (which clears the live marker without scoring), then put
  // back what a killed page would have left.
  await page.getByTestId('fieldtest-prev').click();
  await expect.poll(() => marker(page), { timeout: 3_000 }).toBeUndefined();
  await page.evaluate((m) => {
    const raw = localStorage.getItem('bjtrainer.fieldTestRun.v1')!;
    const run = JSON.parse(raw) as Record<string, unknown>;
    localStorage.setItem(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({ ...run, lockProbe: { ...m, session: 'dead' } }),
    );
  }, left);
  await page.reload();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();

  await expect
    .poll(async () => (await result(page))?.classification, { timeout: 5_000 })
    .toBe('frozen-unloaded');
  expect((await result(page))!.hiddenAt).toBe(left.hiddenAt);
  expect((await result(page))!.run, 'the boot row cannot be joined to its run').toEqual(
    expect.any(String),
  );
  // ...and exactly once, whatever the gate re-renders.
  await page.waitForTimeout(1_500);
  expect((await entries(page)).filter((e) => e.event === 'lock-probe-result')).toHaveLength(1);
  expect(await marker(page)).toBeUndefined();
});

test('a reload that was never hidden, and leaving the step, score nothing', async ({ page }) => {
  await openTest(page);
  await goToStep(page, 'lock-probe');
  await page.waitForTimeout(2_500);
  // The update check reloading the app, or a force-quit with the screen on.
  await page.reload();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  await page.waitForTimeout(1_500);
  expect((await entries(page)).filter((e) => e.event === 'lock-probe-result')).toHaveLength(0);

  // Back onto the step, lock, then leave it without unlocking through the
  // screen: the marker goes with the step.
  await page.getByTestId('fieldtest-resume').click();
  await expect(page.getByTestId('fieldtest-title')).toHaveAttribute('data-step', 'lock-probe');
  await setVisibility(page, 'hidden');
  await expect.poll(() => marker(page), { timeout: 3_000 }).toBeTruthy();
  await page.getByTestId('fieldtest-prev').click();
  await expect.poll(() => marker(page), { timeout: 3_000 }).toBeUndefined();
});
