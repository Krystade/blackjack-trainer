import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';
import { FIELD_TEST_STEPS } from '../src/diag/fieldTest';

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

async function openTest(page: Page, condition = 'Car, parked'): Promise<void> {
  await withSettings(page, {});
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  await page.getByRole('button', { name: condition, exact: true }).click();
  const start = page.getByTestId('fieldtest-start');
  await start.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
}

test('a note lands in the log against the step, and is not an answer', async ({ page }) => {
  await openTest(page, 'Freeway');
  // A later step, so a hard-coded step or condition cannot pass.
  await page.getByTestId('fieldtest-skip').click();
  await page.getByTestId('fieldtest-skip').click();
  await page.getByTestId('fieldtest-skip').click();
  const progress = await page.getByTestId('fieldtest-progress').innerText();
  const step = await page.getByTestId('fieldtest-title').getAttribute('data-step');
  expect(step).not.toBe(FIELD_TEST_STEPS[0]!.id);

  const note = page.getByTestId('fieldtest-note');
  await note.fill('sounded like it came from the dash, not the doors');
  await note.press('Enter');

  await expect
    .poll(async () => (await entries(page)).find((e) => e.event === 'note')?.detail, {
      timeout: 5_000,
    })
    .toMatchObject({
      step,
      condition: 'freeway',
      text: 'sounded like it came from the dash, not the doors',
    });
  // ONCE. Enter saved and then blurred, and the blur saved again from the
  // same render, so every note typed with the keyboard landed twice.
  await page.waitForTimeout(1_500);
  expect((await entries(page)).filter((e) => e.event === 'note')).toHaveLength(1);
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

/**
 * A DRAFT IS NOT LOST TO THE ANSWER TAP. On the phone the keyboard may still
 * be up when the thumb lands on an answer, and the step moves on before
 * anything blurred the box. Whatever was typed belongs to the step it was
 * typed on, and goes to the log when that step is left.
 */
test('a draft still in the box when the step is answered is saved against that step', async ({
  page,
}) => {
  await openTest(page);
  const step = await page.getByTestId('fieldtest-title').getAttribute('data-step');
  const note = page.getByTestId('fieldtest-note');
  await note.fill('half a thought');

  // The answer is taken without the box ever losing focus, which is what a
  // tap on iOS can do; the focus stays where it was.
  const answers = page.getByTestId('fieldtest-answers').locator('button');
  await expect(answers.first()).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await answers.first().evaluate((b) => (b as HTMLButtonElement).click());
  await expect(page.getByTestId('fieldtest-title')).not.toHaveAttribute('data-step', step!);

  await expect
    .poll(
      async () =>
        (await entries(page))
          .filter((e) => e.event === 'note')
          .map((e) => ({ step: e.detail.step, condition: e.detail.condition, text: e.detail.text })),
      { timeout: 5_000 },
    )
    .toEqual([{ step, condition: 'car', text: 'half a thought' }]);
  await expect(note).toHaveValue('');
});
