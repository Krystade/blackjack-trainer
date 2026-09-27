import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';
import { FIELD_TEST_STEPS } from '../src/diag/fieldTest';

/**
 * A BLOCK THAT DISAGREES WITH ITSELF, ON THE SCREEN.
 *
 * `fieldTestRun.test.ts` proves the scoring and the pointer arithmetic. This
 * proves the screen goes through them: three taps on the route block either
 * open four more steps or do not, the row lands, and the probes -- when they
 * open -- are laid out like the block they extend, so a thumb that has just
 * answered `route-3` finds the same buttons in the same places.
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

async function goToStep(page: Page, id: string): Promise<void> {
  const want = FIELD_TEST_STEPS.find((s) => s.id === id);
  expect(want, `${id} is not in the protocol`).toBeTruthy();
  const title = page.getByTestId('fieldtest-title');
  for (let i = 0; i < FIELD_TEST_STEPS.length + 2; i++) {
    if ((await title.getAttribute('data-step')) === id) return;
    await page.getByTestId('fieldtest-skip').click();
  }
  throw new Error(`never reached ${id}`);
}

async function answerStep(page: Page, responseId: string): Promise<void> {
  const button = page.getByTestId(`fieldtest-answer-${responseId}`);
  await expect(button).toBeEnabled();
  // The bounce guard measures from the step changing.
  await page.waitForTimeout(400);
  await button.click();
}

/** The block's row, once the log has flushed it (it buffers for a second). */
async function routeBlockRow(page: Page): Promise<Record<string, unknown> | undefined> {
  await expect
    .poll(async () => (await entries(page)).some((e) => e.event === 'route-block'), {
      timeout: 5_000,
    })
    .toBe(true);
  return (await entries(page)).find((e) => e.event === 'route-block')?.detail;
}

async function onStep(page: Page): Promise<string | null> {
  return page.getByTestId('fieldtest-title').getAttribute('data-step');
}

async function stackBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="fieldtest-answers"]');
    return el ? Math.round(el.getBoundingClientRect().bottom) : -1;
  });
}

test('car / loud / car opens four more of the same, laid out like the block they extend', async ({
  page,
}) => {
  await openTest(page);
  await goToStep(page, 'route-1');
  const before = await page.getByTestId('fieldtest-progress').innerText();

  await answerStep(page, 'route-car');
  expect(await onStep(page)).toBe('route-2');
  await answerStep(page, 'route-loudspeaker');
  expect(await onStep(page)).toBe('route-3');
  const blockBottom = await stackBottom(page);
  await answerStep(page, 'route-car');

  expect(await onStep(page)).toBe('route-probe-1');
  expect(await routeBlockRow(page)).toMatchObject({
    cell: 'clip / mic before',
    verdict: 'wandering',
    armed: true,
    probe: 'route-probe-1',
  });

  // Four more on the path: the count in the corner grew by four.
  const total = (s: string) => Number(/of (\d+)/.exec(s)?.[1]);
  const after = await page.getByTestId('fieldtest-progress').innerText();
  expect(total(after)).toBe(total(before) + 4);

  // Walk the four. Same answers, same bottom edge, a way to hear the line.
  for (let n = 1; n <= 4; n += 1) {
    expect(await onStep(page)).toBe(`route-probe-${n}`);
    await expect(page.getByTestId('fieldtest-title')).toHaveText(
      `A few more of the same (${n} of 4)`,
    );
    await expect(page.getByTestId('fieldtest-answer-route-car')).toBeVisible();
    await expect(page.getByTestId('fieldtest-read-step')).toBeVisible();
    expect(Math.abs((await stackBottom(page)) - blockBottom), `probe ${n} moved the stack`)
      .toBeLessThanOrEqual(2);
    await page.getByTestId('fieldtest-skip').click();
  }
  expect(await onStep(page)).toBe('route-short');

  // Back walks into them too, now that they are on the path.
  await page.getByTestId('fieldtest-prev').click();
  expect(await onStep(page)).toBe('route-probe-4');
});

test('car / car / car leaves the probes dormant, and still writes the row', async ({ page }) => {
  await openTest(page);
  await goToStep(page, 'route-1');
  const before = await page.getByTestId('fieldtest-progress').innerText();

  await answerStep(page, 'route-car');
  await answerStep(page, 'route-car');
  await answerStep(page, 'route-car');

  expect(await onStep(page)).toBe('route-short');
  expect(await routeBlockRow(page)).toMatchObject({
    cell: 'clip / mic before',
    verdict: 'uniform',
    armed: false,
  });
  const after = await page.getByTestId('fieldtest-progress').innerText();
  expect(after.replace(/step \d+/, '')).toBe(before.replace(/step \d+/, ''));

  // Back steps over the dormant four.
  await page.getByTestId('fieldtest-prev').click();
  expect(await onStep(page)).toBe('route-3');
});
