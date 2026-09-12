import { test, expect } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * The car-controls readout in Settings.
 *
 * Media Session is the one feature that cannot be verified from a desk, and
 * the only person who can observe it is driving -- no console, no devtools.
 * So the app records what the head unit sends and reads it back here. These
 * specs seed a log shaped like a real drive and check the panel reports it.
 */

const SEEDED = [
  { at: '2026-08-19T18:40:00.000Z', kind: 'register', action: 'play', ok: true },
  { at: '2026-08-19T18:40:00.001Z', kind: 'register', action: 'previoustrack', ok: true },
  { at: '2026-08-19T18:40:00.002Z', kind: 'register', action: 'seekto', ok: false, detail: 'NotSupportedError' },
  { at: '2026-08-19T18:41:12.000Z', kind: 'invoke', action: 'nexttrack', ok: true },
  { at: '2026-08-19T18:41:20.000Z', kind: 'invoke', action: 'play', ok: true },
];

async function seed(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript((entries) => {
    window.localStorage.setItem('bjtrainer.mediaSessionLog.v1', JSON.stringify(entries));
  }, SEEDED);
}

test('reports which buttons the car sent and which the phone refused', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  const section = page.locator('.settings-section', { hasText: 'Car controls' });
  await expect(section).toBeVisible();

  // The headline: what the CAR emitted, which no desk test can produce.
  await expect(section).toContainText('nexttrack');
  await expect(section).toContainText('play');
  // And what this phone would not accept at all.
  await expect(section).toContainText('seekto');
});

test('says "none yet" before a drive rather than looking broken', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  const section = page.locator('.settings-section', { hasText: 'Car controls' });
  await expect(section).toContainText('none yet');
});

test('the full report can be revealed and cleared', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  const section = page.locator('.settings-section', { hasText: 'Car controls' });
  await section.getByRole('button', { name: 'Show detail' }).click();

  const log = page.locator('.car-log');
  await expect(log).toBeVisible();
  await expect(log).toContainText('ACTUALLY SENT BY THE CAR: nexttrack, play');
  await expect(log).toContainText('agent:');

  await section.getByRole('button', { name: 'Clear' }).click();
  await expect(section).toContainText('none yet');
});

/** The log must outlive the drive, including a mid-drive reload. */
test('the log survives a reload', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  await expect(page.locator('.settings-section', { hasText: 'Car controls' })).toContainText(
    'nexttrack',
  );
});

/* ==================================================================== */
/* The two preconditions, which no readout could otherwise explain.      */
/*                                                                       */
/* The first drive met neither: the wheel did nothing and the car showed */
/* the app as a phone call. Live speech opens no media element, so the   */
/* head unit never sees the app at all; and an open microphone switches  */
/* the Bluetooth link to its hands-free CALL route, which takes every    */
/* wheel button with it. Both are invisible from the driver's seat.      */
/* ==================================================================== */

async function openCarSection(page: import('@playwright/test').Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  return page.locator('.settings-section', { hasText: 'Car controls' });
}

test('with live speech, the panel says the wheel cannot reach the app, and why', async ({
  page,
}) => {
  await withSettings(page, { audio: { enabled: true, useClips: false } });
  const section = await openCarSection(page);

  await expect(section.locator('[data-car-ready]')).toHaveAttribute('data-car-ready', 'false');
  await expect(section).toContainText('Use recorded voice');
});

test('with the recorded voice on, the settings side reports ready', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, useClips: true } });
  const section = await openCarSection(page);

  await expect(section.locator('[data-car-ready]')).toHaveAttribute('data-car-ready', 'true');
  await expect(section).not.toContainText('Use recorded voice');
});

test('audio being off is named before anything else', async ({ page }) => {
  await withSettings(page, { audio: { enabled: false, useClips: false } });
  const section = await openCarSection(page);

  await expect(section).toContainText('Audio enabled');
  await expect(section).toContainText('Use recorded voice');
});

/**
 * The answer to "I pressed every button including hang up and nothing
 * happened" -- stated in the app, next to the readout it explains.
 */
test('the microphone conflict is stated, whatever the settings say', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, useClips: true } });
  const section = await openCarSection(page);

  await expect(section).toContainText('hands-free');
  await expect(section).toContainText('phone call');
});

/* ---------------------------------------------------------------- */
/* The button tester (audio/buttonTester.ts).                        */
/* ---------------------------------------------------------------- */

/**
 * The panel that answers "which physical button is this?" from the driver's
 * seat. A ring selector with five directions plus volume and call keys is nine
 * controls; the browser can hear at most eight Media Session names; which maps
 * to which is decided inside the head unit and is not documented anywhere.
 *
 * Driven by capturing the real registered handlers and invoking them the way a
 * car would. That is the only honest simulation available here -- Playwright
 * cannot press a steering wheel -- and it exercises the whole path: the probe
 * redirect, the press list, the "never arrived" set, and the restore on stop.
 */
async function captureHandlers(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const handlers = new Map<string, () => void>();
    (window as unknown as { __ms: Map<string, () => void> }).__ms = handlers;
    const ms = navigator.mediaSession as unknown as {
      setActionHandler: (a: string, h: (() => void) | null) => void;
    };
    const original = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action: string, handler: (() => void) | null) => {
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
      original(action, handler);
    };
  });
}

async function pressWheel(page: import('@playwright/test').Page, action: string): Promise<void> {
  await page.evaluate((a) => {
    (window as unknown as { __ms: Map<string, () => void> }).__ms.get(a)?.();
  }, action);
}

/** The clips path is the only one that opens a media element to attach to. */
const CAR_READY = { audio: { enabled: true, useClips: true } };

test('the button tester names each press and lists what never arrived', async ({ page }) => {
  await withSettings(page, CAR_READY);
  await captureHandlers(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  const section = page.locator('.settings-section', { hasText: 'Car controls' });
  await section.getByRole('button', { name: 'Start test', exact: true }).click();
  await expect(section).toContainText('Listening');

  // Three presses, as this car was observed to send on the 2026-09-11 drive.
  await pressWheel(page, 'nexttrack');
  await pressWheel(page, 'pause');
  await pressWheel(page, 'play');

  // Each one is named, in plain words rather than as a raw action string.
  await expect(section.locator('.car-press-row')).toHaveCount(3);
  await expect(section).toContainText('Skip forward. Answers yes.');
  await expect(section).toContainText('Pause. Stops the talking.');
  await expect(section).toContainText('Play. Ignored on purpose.');

  // And the more useful half: what this wheel never emitted.
  const unheard = section.locator('.settings-row', { hasText: 'Never arrived' });
  await expect(unheard).toContainText('previoustrack');
  await expect(unheard).toContainText('seekforward');
  await expect(unheard).not.toContainText('nexttrack');
});

/**
 * The safety property. A press during the test must report and go no further:
 * learning that the ring's left click is `previoustrack` must not simultaneously
 * repeat a prompt, and `nexttrack` must not answer a drill question.
 */
test('a press during the test does nothing but report itself', async ({ page }) => {
  await withSettings(page, CAR_READY);
  await captureHandlers(page);
  await page.addInitScript(() => {
    (window as unknown as { __wheel: string[] }).__wheel = [];
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  const section = page.locator('.settings-section', { hasText: 'Car controls' });
  await section.getByRole('button', { name: 'Start test', exact: true }).click();

  await pressWheel(page, 'nexttrack');
  await pressWheel(page, 'previoustrack');
  await expect(section.locator('.car-press-row')).toHaveCount(2);

  // `previoustrack` is the discriminating press: its real handler is
  // `repeatLast`, which SPEAKS. Under ?e2e=1 every utterance lands in
  // __speechLog, so the log is exactly the two names the tester said -- a third
  // entry would be the repeat firing behind the report. (`nexttrack` alone
  // could not show this: its real handler only routes a wheel command, and
  // Settings registers none, so it would look identical either way.)
  const spoken = await page.evaluate(
    () => (window as unknown as { __speechLog?: string[] }).__speechLog ?? [],
  );
  expect(spoken).toEqual(['Skip forward. Answers yes.', 'Skip back. Repeats.']);
});

/**
 * Stopping must give the buttons back. Left armed, every wheel control is
 * silently dead for the rest of the session -- the worst possible outcome for a
 * panel whose whole purpose is making the wheel work.
 */
test('stopping the test restores the real mapping', async ({ page }) => {
  await withSettings(page, CAR_READY);
  await captureHandlers(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  const section = page.locator('.settings-section', { hasText: 'Car controls' });
  await section.getByRole('button', { name: 'Start test', exact: true }).click();
  await pressWheel(page, 'previoustrack');
  await expect(section.locator('.car-press-row')).toHaveCount(1);

  await section.getByRole('button', { name: 'Stop test', exact: true }).click();
  await expect(section).not.toContainText('Listening');

  // Armed again. Proven through speech rather than the press list, because the
  // tester speaks SYNCHRONOUSLY inside the handler while a new row is an async
  // React render -- a row-count assertion would pass on the old count before
  // the stray row ever appeared. `nexttrack` is the press that separates the
  // two worlds: its real handler only routes a wheel command, which Settings
  // does not register, so it says nothing; the tester would announce it.
  await pressWheel(page, 'nexttrack');
  const spoken = await page.evaluate(
    () => (window as unknown as { __speechLog?: string[] }).__speechLog ?? [],
  );
  expect(spoken).toEqual(['Skip back. Repeats.']);
  await expect(section.locator('.car-press-row')).toHaveCount(1);
});

/** Navigating away mid-test must not strand the probe. */
test('leaving Settings mid-test releases the buttons', async ({ page }) => {
  await withSettings(page, CAR_READY);
  await captureHandlers(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  const section = page.locator('.settings-section', { hasText: 'Car controls' });
  await section.getByRole('button', { name: 'Start test', exact: true }).click();
  await expect(section).toContainText('Listening');
  await pressWheel(page, 'previoustrack');
  await expect(section.locator('.car-press-row')).toHaveCount(1);

  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();

  // THE ASSERTION THAT MATTERS. Unmounting the panel does not by itself
  // disarm the probe -- only the cleanup does -- and a stranded probe leaves
  // every wheel button dead for the rest of the session while looking fine.
  // A press from Home must now reach nobody the tester owns: the tester would
  // announce it (synchronously), so the log staying at one entry is the proof.
  await pressWheel(page, 'nexttrack');
  const spoken = await page.evaluate(
    () => (window as unknown as { __speechLog?: string[] }).__speechLog ?? [],
  );
  expect(spoken).toEqual(['Skip back. Repeats.']);

  // And back in Settings the panel is idle again rather than half-running.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const again = page.locator('.settings-section', { hasText: 'Car controls' });
  await expect(again.getByRole('button', { name: 'Start test', exact: true })).toBeVisible();
  await expect(again).not.toContainText('Listening');
});
