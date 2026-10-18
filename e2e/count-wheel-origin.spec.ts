import { test, expect, type Page } from '@playwright/test';
import { withSettings, openCountOptions } from './helpers';
import { narrateReadback } from '../src/audio/narrate';

/**
 * Wave E E4 (L-4): on the wheel, the FINAL running count starts from the count
 * given at the run's last checkpoint, so the end of a long run is a press or
 * two away instead of eight. Checkpoints and distraction answers still start
 * from zero, and the readback stays absolute.
 */

async function press(page: Page, command: 'forward' | 'back', times = 1): Promise<void> {
  const handled = await page.evaluate(
    ({ c, n }) => {
      const results: boolean[] = [];
      for (let i = 0; i < n; i++) results.push(window.__wheelPress?.(c) ?? false);
      return results;
    },
    { c: command, n: times },
  );
  expect(handled, 'a press reached no screen').toEqual(Array.from({ length: times }, () => true));
}

const spoken = (page: Page): Promise<string[]> => page.evaluate(() => window.__speechLog ?? []);

/** The next readback said after `from` lines of the speech log. */
async function readbackAfter(page: Page, from: number): Promise<string> {
  let line: string | undefined;
  await expect
    .poll(async () => {
      line = (await spoken(page)).slice(from).find((l) => l.endsWith('. Correct?'));
      return line ?? null;
    }, { timeout: 4000, intervals: [100] })
    .not.toBeNull();
  return line!;
}

/** Type a signed integer on the keypad on screen and submit it. */
async function enter(page: Page, n: number): Promise<void> {
  const pad = page.locator('.numpad');
  for (const d of String(Math.abs(n))) await pad.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
  if (n < 0) await pad.getByRole('button', { name: 'Plus or minus', exact: true }).click();
  await pad.locator('.numpad-ok').click();
}

async function open(page: Page, drill: Record<string, unknown>): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0.4242;
  });
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full' },
    drill: { wheelMode: 'answer', countGroup: 1, countManual: true, ...drill },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await openCountOptions(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

type Stop = 'checkpoint' | 'distraction' | 'final';

/** Tap through the cards to the next thing that asks for a number. */
async function nextStop(page: Page): Promise<Stop> {
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.checkpoint-area').isVisible()) return 'checkpoint';
    if (await page.locator('.distraction-area').isVisible()) return 'distraction';
    if (await page.locator('.numpad').isVisible()) return 'final';
    await page.locator('.manual-tap-zone').click();
  }
  throw new Error('the run never asked for a number');
}

test('E4: a checkpoint answered +3, then the final entry: first forward reads back "plus 4"', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, { countLengthCards: 10, countCheckpoints: 'one' });

  expect(await nextStop(page)).toBe('checkpoint');
  await enter(page, 3);
  expect(await nextStop(page)).toBe('final');

  const before = (await spoken(page)).length;
  await press(page, 'forward');
  expect(await readbackAfter(page, before)).toBe(narrateReadback(4));
  // Quiet submits it, as an absolute count.
  await expect(page.locator('.result-detail')).toContainText('You entered 4;', { timeout: 6000 });
});

test('E4: checkpoints and distractions start from zero; the final starts from the LAST checkpoint', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, { countLengthCards: 20, countCheckpoints: 'few', distractionFreq: 'relentless' });

  // Entered on the wheel alone, one press each, and committed by the quiet:
  // the first checkpoint +1 (forward), the second −1 (back).
  const checkpointPress: ('forward' | 'back')[] = ['forward', 'back'];
  let checkpoints = 0;
  let distractionsAfterACheckpoint = 0;
  for (;;) {
    const stop = await nextStop(page);
    if (stop === 'final') break;
    const command = stop === 'checkpoint' ? checkpointPress[checkpoints]! : 'forward';
    const before = (await spoken(page)).length;
    await press(page, command);
    // A checkpoint and a distraction both start from 0, whatever was said at
    // an earlier checkpoint.
    expect(await readbackAfter(page, before), `${stop} after ${checkpoints} checkpoint(s)`).toBe(
      narrateReadback(command === 'forward' ? 1 : -1),
    );
    await expect(page.locator(stop === 'checkpoint' ? '.checkpoint-area' : '.distraction-area')).toBeHidden({
      timeout: 6000,
    });
    if (stop === 'checkpoint') checkpoints += 1;
    else if (checkpoints > 0) distractionsAfterACheckpoint += 1;
  }
  expect(checkpoints, 'the run was meant to stop at two checkpoints').toBe(2);
  expect(distractionsAfterACheckpoint, 'no distraction came after a checkpoint, so that case went untested').toBeGreaterThan(0);

  // The last checkpoint was −1; starting from the first (+1) would propose 0.
  // Back proposes −2; forward again brings it back to −1, which is submitted.
  let before = (await spoken(page)).length;
  await press(page, 'back');
  expect(await readbackAfter(page, before)).toBe(narrateReadback(-2));
  before = (await spoken(page)).length;
  await press(page, 'forward');
  expect(await readbackAfter(page, before)).toBe(narrateReadback(-1));
  await expect(page.locator('.result-detail')).toContainText('You entered −1;', { timeout: 6000 });
});
