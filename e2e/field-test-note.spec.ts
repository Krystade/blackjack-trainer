import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * A NOTE, FOR WHAT NO BUTTON SAYS.
 *
 * The answer stack is the record, and it is a fixed vocabulary on purpose --
 * but the first four drives each produced something the vocabulary had no
 * word for, remembered in the car park and lost by the time the log was
 * read. So every step takes a line of free text, written to the log against
 * the step and condition, and it is NOT an answer: it stamps nothing and
 * advances nothing, because a note about a step is not a reading of it.
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

async function openTest(page: Page): Promise<void> {
  await withSettings(page, {});
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  const start = page.getByTestId('fieldtest-start');
  await start.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
}

test('a note lands in the log against the step, and is not an answer', async ({ page }) => {
  await openTest(page);
  const progress = await page.getByTestId('fieldtest-progress').innerText();
  const step = await page.getByTestId('fieldtest-title').getAttribute('data-step');

  const note = page.getByTestId('fieldtest-note');
  await note.fill('sounded like it came from the dash, not the doors');
  await note.press('Enter');

  await expect
    .poll(async () => (await entries(page)).find((e) => e.event === 'note')?.detail, {
      timeout: 5_000,
    })
    .toMatchObject({
      step,
      condition: 'car',
      text: 'sounded like it came from the dash, not the doors',
    });
  // Still here, nothing stamped, and the box is ready for another.
  await expect(page.getByTestId('fieldtest-progress')).toHaveText(progress);
  await expect(note).toHaveValue('');
  await expect(page.getByTestId('fieldtest-noted')).toContainText('sounded like it came from');
  expect((await entries(page)).filter((e) => e.event === 'answer')).toHaveLength(0);
});

test('leaving the box saves it too, and an empty box saves nothing', async ({ page }) => {
  await openTest(page);
  const note = page.getByTestId('fieldtest-note');
  await note.fill('   ');
  await note.press('Enter');
  await note.fill('second try');
  // Blur, as a thumb going to the stack does.
  await page.getByTestId('fieldtest-title').click();

  await expect
    .poll(async () => (await entries(page)).filter((e) => e.event === 'note').map((e) => e.detail.text), {
      timeout: 5_000,
    })
    .toEqual(['second try']);
});

test('the noted line clears when the step changes', async ({ page }) => {
  await openTest(page);
  const note = page.getByTestId('fieldtest-note');
  await note.fill('about the first step');
  await note.press('Enter');
  await expect(page.getByTestId('fieldtest-noted')).toBeVisible();
  await page.getByTestId('fieldtest-skip').click();
  await expect(page.getByTestId('fieldtest-noted')).toHaveCount(0);
});
