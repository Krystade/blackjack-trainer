import { test, expect, type Page } from '@playwright/test';
import { shot } from './helpers';

/**
 * The diagnostic log, end to end.
 *
 * This exists because of a report that could not be acted on: "it rarely
 * understands me ... it also frequently doesn't hear me ... I get the request
 * to allow the mic and always accept it but it seems like the mic doesn't stay
 * active." Three different failures, identical from the driver's seat, and no
 * record of which one happened.
 *
 * So the log IS the feature here, and these tests are about the property that
 * makes it worth anything: that it is still there afterwards, with the right
 * things in it, for someone who has just stopped the car. A log that quietly
 * recorded nothing would look exactly like a drive where nothing went wrong.
 *
 * The microphone itself cannot be driven from here -- Chromium exposes the
 * whole SpeechRecognition surface and then fires no events, which is the
 * precise reason voiceControl.ts is built around an injected clock and tested
 * in node. What CAN be proven here is everything around it: that the log
 * starts itself, survives a reload, notices navigation and settings changes,
 * and can be marked, shown and cleared by someone at the side of the road.
 */

const DIAG = 'Diagnostic log';

function panel(page: Page) {
  return page
    .locator('details.settings-section')
    .filter({ has: page.locator('summary', { hasText: DIAG }) });
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(panel(page)).toBeVisible();
}

/** The log text as the operator would read it, without going near storage. */
async function logText(page: Page): Promise<string> {
  const section = panel(page);
  const show = section.getByRole('button', { name: /^(Show|Hide)$/ });
  if ((await show.innerText()) === 'Show') await show.click();
  return section.locator('pre.car-log').innerText();
}

test('the log starts itself, before anything asks it to', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openSettings(page);

  const text = await logText(page);
  // What was this running on -- the first question asked of any pasted log.
  expect(text).toContain('page-load');
  expect(text).toContain('capabilities');
  expect(text).toMatch(/recognition=(standard|webkit|none)/);
  await shot(page, '98-diagnostic-log');
});

test('it records which screen the operator was on', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await openSettings(page);

  const text = await logText(page);
  expect(text).toContain('to=drills');
  expect(text).toContain('to=settings');
});

/**
 * The one that answers "it worked yesterday". A setting changed three screens
 * ago is the usual explanation, and nothing recorded it until now.
 */
test('it records what a settings change actually changed, not that one happened', async ({
  page,
}) => {
  await page.goto('/?e2e=1');
  await openSettings(page);

  const themes = page.locator('button[data-theme-id]');
  const before = await themes.first().getAttribute('data-theme-id');
  // Pick a theme that is not the current one, so the write is a real change.
  const other = page.locator(`button[data-theme-id]:not([data-theme-id="${before}"])`).first();
  const otherId = await other.getAttribute('data-theme-id');
  await other.click();

  const text = await logText(page);
  expect(text).toContain('settings');
  // The PATH and the VALUES, which is the whole point of a diff over a dump.
  expect(text).toContain(`theme:`);
  expect(text).toContain(`-> ${otherId}`);
});

test('a change that changes nothing is not logged, so the log stays readable', async ({
  page,
}) => {
  await page.goto('/?e2e=1');
  await openSettings(page);

  const current = page.locator('button[data-theme-id][aria-pressed="true"]').first();
  await current.click();
  await current.click();

  const text = await logText(page);
  // Vacuity guard: this assertion is only meaningful because the test above
  // proves a real change IS recorded.
  expect(text).not.toContain('-> (unset)');
  expect((text.match(/set {2,}settings/g) ?? []).length).toBe(0);
});

/**
 * Mark is the control the workflow depends on: a fifteen-minute drive is a
 * long log, and "the bit where it stopped hearing me" cannot be found by
 * timestamp afterwards.
 */
test('Mark brackets an attempt so the interesting part can be pointed at', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openSettings(page);

  await panel(page).getByRole('button', { name: 'Mark' }).click();
  await panel(page).getByRole('button', { name: 'Mark' }).click();

  const text = await logText(page);
  expect((text.match(/operator-mark/g) ?? []).length).toBe(2);
});

test('the log survives a reload, which is what iOS does to a backgrounded app', async ({
  page,
}) => {
  await page.goto('/?e2e=1');
  await openSettings(page);
  await panel(page).getByRole('button', { name: 'Mark' }).click();

  await page.reload();
  await openSettings(page);

  const text = await logText(page);
  expect(text).toContain('operator-mark');
  // Two page loads, which is exactly the boundary the session id exists to show.
  expect(text).toMatch(/# \d+ entries, 2 page load\(s\)/);
});

test('Clear empties it, because it is a recording of an open microphone', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openSettings(page);
  await panel(page).getByRole('button', { name: 'Mark' }).click();

  const section = panel(page);
  await expect(section.getByText(/\d+ entries/)).toBeVisible();

  await section.getByRole('button', { name: 'Clear' }).click();
  await expect(section.getByText('nothing yet')).toBeVisible();

  // And it really is gone, not merely hidden behind a collapsed panel.
  const stored = await page.evaluate(() =>
    localStorage.getItem('bjtrainer.diagnostics.v1'),
  );
  expect(stored).toBeNull();
});

test('the panel counts what is in the log rather than guessing', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openSettings(page);
  const section = panel(page);

  const readCount = async (): Promise<number> => {
    const text = await section.getByText(/\d+ entries|nothing yet/).innerText();
    return Number(text.replace(/\D/g, '') || 0);
  };

  const before = await readCount();
  await section.getByRole('button', { name: 'Mark' }).click();
  expect(await readCount()).toBeGreaterThan(before);
});

/**
 * A profile edit changes what "correct" means -- every grading, payout and
 * dealer-behaviour surface reads the ACTIVE PROFILE rather than Settings -- so
 * a log that recorded settings but not profiles would explain half of what it
 * was asked to.
 */
test('a profile edit is logged by name, with the rule that changed', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit' }).first().click();

  // Any rule toggle will do; DAS is the one every other profile spec uses.
  await page
    .locator('.settings-toggle-row', { hasText: 'Double after split (DAS)' })
    .locator('input.settings-toggle')
    .click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await openSettings(page);
  const text = await logText(page);
  expect(text).toContain('profiles');
  // The profile NAME and the rule PATH, which is the whole point of keying the
  // diff rather than comparing the raw array -- that reported a change with
  // nothing in it.
  expect(text).toMatch(/profiles .*\.rules\.das: (true|false) -> (true|false)/);
  expect(text).not.toContain('changed="(no change)"');
});
