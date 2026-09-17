import { test, expect, type Page } from '@playwright/test';

/**
 * The field-test protocol, end to end.
 *
 * "I think I need a set of instructions in the app to properly follow so you
 * know what the intent is vs what shows up in the log" (2026-09-16). The value
 * of the panel is entirely in what reaches the log: a set of instructions that
 * stamped nothing would be a page of prose, and the log would still be a pile
 * of events with no stated intent to read it against.
 */

function diagPanel(page: Page) {
  return page
    .locator('details.settings-section')
    .filter({ has: page.locator('summary', { hasText: 'Diagnostic log' }) });
}

async function openSettings(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(diagPanel(page)).toBeVisible();
}

async function logText(page: Page): Promise<string> {
  const section = diagPanel(page);
  const show = section.getByRole('button', { name: /^(Show|Hide)$/ });
  if ((await show.innerText()) === 'Show') await show.click();
  return section.locator('pre.car-log').innerText();
}

test('a stamped step reaches the log with the condition it was run under', async ({ page }) => {
  await openSettings(page);

  await page.getByTestId('fieldtest-stamp-press-forward').click();

  const text = await logText(page);
  expect(text).toContain('press-forward');
  expect(text).toContain('condition=car');
});

test('switching condition changes what is recorded, not just what is shown', async ({ page }) => {
  await openSettings(page);

  // The control condition, which is the comparison the whole protocol is for.
  await page.getByRole('button', { name: 'Speakerphone', exact: true }).click();
  await page.getByTestId('fieldtest-stamp-spoke').click();

  const text = await logText(page);
  expect(text).toContain('condition=speakerphone');
  // ...and not the one it defaulted to, which a stamp that ignored the
  // selector would have written instead.
  expect(text).not.toContain('condition=car');
});

test('the panel says what to look for, not just what to do', async ({ page }) => {
  await openSettings(page);

  const step = page.getByTestId('fieldtest-stamp-wheel-dead');
  await expect(step).toBeVisible();
  // A step with no stated expectation cannot be checked against the log
  // afterwards, which is the one thing this panel exists to make possible.
  await expect(page.getByText(/Look for: no invoke near this stamp/)).toBeVisible();
});

test('a stamp is visibly taken, so a step done at a red light stays done', async ({ page }) => {
  await openSettings(page);

  const btn = page.getByTestId('fieldtest-stamp-good');
  await expect(btn).not.toContainText('✓');
  await btn.click();
  await expect(btn).toContainText('✓');
});
