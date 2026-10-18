import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * C-R3 (W10): one tap from Home back into the last eyes-free / voice drill.
 */

const speechLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);

test('no Drive button without an eyes-free or voice drill behind it', async ({ page }) => {
  await page.goto('/?e2e=1');
  await expect(page.locator('.next-step-btn')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Drive:/ })).toHaveCount(0);
});

test('running a drill eyes-free puts it on Home as Drive', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.getByLabel('Eyes-free audio').check();
  // Persisted: a fresh load of Home offers it.
  await page.evaluate(() => window.localStorage.setItem('e2e.noReseed', '1'));
  await page.goto('/?e2e=1');
  await expect(page.getByRole('button', { name: 'Drive: Flashcards' })).toBeVisible();
});

test('Drive opens the drill eyes-free and speaks from the tap itself', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true }, lastDrive: { mode: 'flash', voice: false } });
  await page.goto('/?e2e=1');
  const drive = page.getByRole('button', { name: 'Drive: Flashcards' });
  await expect(drive).toBeVisible();
  // Secondary, not a second gold primary: Start stays the only one.
  await expect(page.locator('.u-btn-primary')).toHaveCount(1);
  await expect(drive).not.toHaveClass(/u-btn-primary/);
  // Directly under Start.
  const start = await page.locator('.next-step-btn').boundingBox();
  const box = await drive.boundingBox();
  expect(box!.y).toBeGreaterThan(start!.y + start!.height - 1);
  expect(box!.y - (start!.y + start!.height)).toBeLessThan(40);

  // The first line is spoken INSIDE the click handler -- the gesture that
  // unlocks audio -- not on a later render or timer.
  const spokenInGesture = await drive.evaluate((el) => {
    const w = window as unknown as { __speechLog?: string[] };
    const before = (w.__speechLog ?? []).length;
    (el as HTMLButtonElement).click();
    return (w.__speechLog ?? []).slice(before);
  });
  expect(spokenInGesture[0]).toMatch(/Flashcards/);

  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
  await expect(page.getByLabel('Eyes-free audio')).toBeChecked();
  // And the drill itself starts talking: the first card is read out.
  await expect.poll(async () => (await speechLog(page)).some((l) => /Dealer shows/.test(l))).toBe(true);
});

test('Drive starts a setup drill without a second tap, voice restored', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true }, lastDrive: { mode: 'truecount', voice: true } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drive: True count drill' }).click();
  // Past setup: the Start button of the drill's setup screen is gone.
  await expect(page.locator('.voice-status')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  // Voice as it was last time: the microphone is up.
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', /listening|starting/);
});

/**
 * H3 (retest story 16): Speed and Bet sizing have an eyes-free mode answered
 * on the wheel (C-R1), so running one eyes-free makes it Home's Drive, and
 * Drive reopens it eyes-free and talking. They used to record nothing.
 */
for (const [picker, label, heading, firstLine] of [
  ['Speed', 'Speed', 'Speed', /^You have .+\?$/],
  ['Bet sizing', 'Bet sizing', 'Bet sizing', /^Running count .+\?$/],
] as const) {
  test(`H3: ${label} run eyes-free becomes Drive, and Drive reopens it eyes-free`, async ({ page }) => {
    await withSettings(page, { audio: { enabled: true } });
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: picker, exact: true }).click();
    await expect(page.locator('.drill-heading')).toHaveText(heading);
    await page.getByLabel('Eyes-free audio').check();
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').lastDrive))
      .toEqual({ mode: picker === 'Speed' ? 'speed' : 'betsizing', voice: false });

    // A fresh load of Home -- eyes-free is per page load, so it starts off.
    await page.evaluate(() => window.localStorage.setItem('e2e.noReseed', '1'));
    await page.goto('/?e2e=1');
    const drive = page.getByRole('button', { name: `Drive: ${label}` });
    await expect(drive).toBeVisible();
    const spokenInGesture = await drive.evaluate((el) => {
      const w = window as unknown as { __speechLog?: string[] };
      const before = (w.__speechLog ?? []).length;
      (el as HTMLButtonElement).click();
      return (w.__speechLog ?? []).slice(before);
    });
    expect(spokenInGesture[0]).toBe(`${label}.`);

    await expect(page.locator('.drill-heading')).toHaveText(heading);
    await expect(page.getByLabel('Eyes-free audio')).toBeChecked();
    // Already going: the first question is said with no further tap.
    await expect.poll(async () => (await speechLog(page)).some((l) => firstLine.test(l))).toBe(true);
  });
}
