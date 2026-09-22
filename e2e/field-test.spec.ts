import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * The field-test protocol, end to end.
 *
 * "I think I need a set of instructions in the app to properly follow so you
 * know what the intent is vs what shows up in the log" (2026-09-16). The value
 * of the panel is entirely in what reaches the log: a set of instructions that
 * stamped nothing would be a page of prose, and the log would still be a pile
 * of events with no stated intent to read it against.
 *
 * Rewritten after the first real run (2026-09-19), which got four steps in and
 * stopped: "the field test feels so unfinished and poorly designed. I need it
 * to set the settings and maybe have a pop up that follows me into the
 * testing. Can't have to go back and forth and have it reset all progress."
 * Those are the three things asserted below -- it follows you, it sets the
 * step up itself, and the run survives navigating -- and each of them was
 * false of the old design.
 */

function diagPanel(page: Page) {
  return page
    .locator('details.settings-section')
    .filter({ has: page.locator('summary', { hasText: 'Diagnostic log' }) });
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(diagPanel(page)).toBeVisible();
}

async function startRun(page: Page, condition?: string): Promise<void> {
  await page.goto('/?e2e=1');
  await openSettings(page);
  if (condition) await page.getByRole('button', { name: condition, exact: true }).click();
  await page.getByTestId('fieldtest-start').click();
  await expect(page.getByTestId('fieldtest-hud')).toBeVisible();
}

async function logText(page: Page): Promise<string> {
  const section = diagPanel(page);
  const show = section.getByRole('button', { name: /^(Show|Hide)$/ });
  if ((await show.innerText()) === 'Show') await show.click();
  return section.locator('pre.car-log').innerText();
}

test('a stamped step reaches the log with the condition it was run under', async ({ page }) => {
  await withSettings(page, {});
  await startRun(page);

  await page.getByTestId('fieldtest-stamp-audio-out').click();

  const text = await logText(page);
  expect(text).toContain('audio-out');
  expect(text).toContain('condition=car');
});

test('switching condition changes what is recorded, not just what is shown', async ({ page }) => {
  await withSettings(page, {});
  // The control condition, which is the comparison the whole protocol is for.
  await startRun(page, 'Speakerphone, moving');

  await page.getByTestId('fieldtest-stamp-audio-out').click();

  const text = await logText(page);
  expect(text).toContain('condition=speakerphone');
  // ...and not the one it defaulted to, which a stamp that ignored the
  // selector would have written instead.
  expect(text).not.toContain('condition=car');
});

/**
 * The split's whole point, from the seat: a run picked for the road must not
 * hand the driver the steps that were deliberately kept off it. Asserted over
 * every step REACHABLE by paging to the end, not on the first screen, because
 * a filter that only hid the first wheel step would still look right there.
 */
const WHEEL_STEPS = ['press-forward', 'press-back', 'wheel-gap', 'wheel-dead', 'wheel-after-mic'];
const MIC_STEPS = ['spoke', 'spoke-over'];

/** Page through the whole run, collecting which of `ids` it ever offers. */
async function stepsOffered(page: Page, ids: string[]): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < 20; i++) {
    for (const id of ids) {
      if ((await page.getByTestId(`fieldtest-stamp-${id}`).count()) > 0 && !seen.includes(id)) {
        seen.push(id);
      }
    }
    const next = page.getByTestId('fieldtest-next');
    if (await next.isDisabled()) break;
    await next.click();
  }
  return seen;
}

test('a driving run never offers a wheel step', async ({ page }) => {
  await withSettings(page, {});
  await startRun(page, 'Freeway');

  const seen = await stepsOffered(page, [...WHEEL_STEPS, ...MIC_STEPS]);
  expect(seen.filter((id) => WHEEL_STEPS.includes(id))).toEqual([]);
  // ...and it DOES offer the steps it exists for, or the line above would
  // pass just as well against a run that contained nothing at all.
  expect(seen).toContain('spoke-over');
});

/** ...and the converse, so neither half can quietly become the whole list. */
test('a parked run never offers the microphone-in-traffic steps', async ({ page }) => {
  await withSettings(page, {});
  await startRun(page, 'Car, parked');

  const seen = await stepsOffered(page, [...WHEEL_STEPS, ...MIC_STEPS]);
  expect(seen.filter((id) => MIC_STEPS.includes(id))).toEqual([]);
  expect(seen).toContain('wheel-gap');
});

test('the panel says what to look for, not just what to do', async ({ page }) => {
  await withSettings(page, {});
  await startRun(page);

  // Walk to the step whose whole value is the expectation attached to it.
  for (let i = 0; i < 5; i++) {
    if ((await page.getByTestId('fieldtest-stamp-wheel-dead').count()) > 0) break;
    await page.getByTestId('fieldtest-next').click();
  }

  await expect(page.getByTestId('fieldtest-stamp-wheel-dead')).toBeVisible();
  // A step with no stated expectation cannot be checked against the log
  // afterwards, which is the one thing this panel exists to make possible.
  await expect(page.getByText(/Look for: no invoke near this stamp/).first()).toBeVisible();
});

test('a stamp is visibly taken, so a step done at a red light stays done', async ({ page }) => {
  await withSettings(page, {});
  await startRun(page);

  const btn = page.getByTestId('fieldtest-stamp-audio-out');
  await expect(btn).not.toContainText('✓');
  await btn.click();
  await expect(btn).toContainText('✓');
});

/**
 * The complaint, exactly: "Can't have to go back and forth and have it reset
 * all progress." Every step of this protocol is performed on a screen the
 * protocol is not, so a run that did not survive navigation could not be
 * followed at all.
 */
test('the run follows you off the settings screen and keeps its progress', async ({ page }) => {
  await withSettings(page, {});
  await startRun(page);

  await page.getByTestId('fieldtest-next').click();
  await page.getByTestId('fieldtest-stamp-no-audio-out').click();
  await expect(page.getByTestId('fieldtest-stamp-no-audio-out')).toContainText('✓');

  // Leave for a drill -- which is where the steps actually have to happen.
  await page.locator('.tab-bar button', { hasText: 'Drills' }).click();

  // Rendered by the app shell, so it is still here on a screen that is not
  // Settings -- which is where every step of the protocol actually happens.
  await expect(page.getByTestId('fieldtest-hud')).toBeVisible();
  // Same step, same tick. This is a guard against the run moving back into a
  // screen's React state; the reload test below is what proves the storage.
  await expect(page.getByTestId('fieldtest-stamp-no-audio-out')).toContainText('✓');
});

test('the run is still there after a reload, which the update check can force mid-drive', async ({
  page,
}) => {
  await withSettings(page, {});
  await startRun(page);
  await page.getByTestId('fieldtest-next').click();
  await page.getByTestId('fieldtest-stamp-no-audio-out').click();

  await page.reload();

  await expect(page.getByTestId('fieldtest-hud')).toBeVisible();
  await expect(page.getByTestId('fieldtest-stamp-no-audio-out')).toContainText('✓');
});

/**
 * "I need it to set the settings." A step that only DESCRIBES what it needs
 * gets run under whatever was already there, and the log cannot tell the two
 * apart afterwards.
 */
test('opening a step puts the app into the state that step needs', async ({ page }) => {
  // Start from the state a wheel step cannot survive: no audio at all, no
  // recorded voice (so no media element for the car to attach to), and the
  // wheel in the wrong mode.
  await withSettings(page, {
    audio: { enabled: false, useClips: false, muted: true },
    drill: { wheelMode: 'talk' },
  });
  await startRun(page);

  await expect(page.getByTestId('fieldtest-setup')).toContainText('audio on');
  await expect(page.getByTestId('fieldtest-setup')).toContainText('recorded voice on');

  // Not just said -- done. Read it off the controls that own those settings.
  await openSettings(page);
  await expect(page.getByLabel('Audio enabled')).toBeChecked();
  await expect(page.getByLabel('Use recorded voice (higher quality)')).toBeChecked();
});

/**
 * The toggle that decides whether a drill speaks at all, and the one the old
 * design could not reach: it lived in each drill's own React state, so step
 * one could turn audio on, the recorded voice on and the microphone off, and
 * still produce a completely silent step one.
 */
test('step one turns on the toggle that actually makes a drill speak', async ({ page }) => {
  await withSettings(page, {});
  await startRun(page);

  await page.locator('.tab-bar button', { hasText: 'Drills' }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();

  await expect(page.getByLabel('Eyes-free audio')).toBeChecked();
});

test('ending the run puts the panel away', async ({ page }) => {
  await withSettings(page, {});
  await startRun(page);

  await page.getByTestId('fieldtest-end').click();

  await expect(page.getByTestId('fieldtest-hud')).toHaveCount(0);
});
