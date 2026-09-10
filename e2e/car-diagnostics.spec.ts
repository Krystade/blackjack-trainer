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
