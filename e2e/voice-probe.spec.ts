import { test, expect } from '@playwright/test';

/**
 * The voice spike's panel.
 *
 * Whether recognition WORKS cannot be asserted here -- headless Chromium
 * exposes the whole SpeechRecognition surface and then fires no events,
 * because there is no microphone and no speech backend. So these specs cover
 * what is genuinely testable: that the panel reports capability honestly,
 * that the log survives, and that the summary answers the background-tab
 * question outright. The recognition itself is for the operator's devices.
 */

async function openVoicePanel(page: import('@playwright/test').Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const section = page.locator('.settings-section', { hasText: 'Voice control' });
  await expect(section).toBeVisible();
  return section;
}

test('the panel reports what this browser actually supports', async ({ page }) => {
  const section = await openVoicePanel(page);
  // Chromium exposes the unprefixed API; the panel must say so rather than
  // claiming a capability it has not checked.
  await expect(section).toContainText('supported');
  await expect(section).toContainText('nothing yet');
});

test('the vocabulary is stated, so there is nothing to guess at while driving', async ({ page }) => {
  const section = await openVoicePanel(page);
  for (const word of ['hit', 'stand', 'double', 'split', 'surrender', 'repeat']) {
    await expect(section).toContainText(word);
  }
});

test('the report leads with the background-tab answer', async ({ page }) => {
  const section = await openVoicePanel(page);
  await section.getByRole('button', { name: 'Start listening' }).click();
  await section.getByRole('button', { name: 'Show log' }).click();

  const log = page.locator('.car-log').last();
  await expect(log).toBeVisible();
  // The question the operator cannot answer by watching.
  await expect(log).toContainText('while tab hidden');
  await expect(log).toContainText('auto-restarts');
  // And the environment facts that make a report actionable.
  await expect(log).toContainText('agent=');
  await expect(log).toContainText('standalone=');
});

test('a fresh start clears the previous run rather than appending to it', async ({ page }) => {
  const section = await openVoicePanel(page);
  await section.getByRole('button', { name: 'Start listening' }).click();
  await section.getByRole('button', { name: 'Show log' }).click();

  const firstLen = (await page.locator('.car-log').last().textContent())!.length;
  await section.getByRole('button', { name: 'Stop listening' }).click();
  await section.getByRole('button', { name: 'Start listening' }).click();
  const secondLen = (await page.locator('.car-log').last().textContent())!.length;

  // A second run must not be twice as long as the first; otherwise two drives
  // would be interleaved in one timeline and neither would be readable.
  expect(secondLen).toBeLessThan(firstLen * 1.6);
});
