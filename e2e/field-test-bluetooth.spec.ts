import { test, expect, type Page } from '@playwright/test';
import { withSettings, selectFieldTestCondition} from './helpers';
import { FIELD_TEST_STEPS } from '../src/diag/fieldTest';

/**
 * NO BLUETOOTH, NO WHEEL STEPS.
 *
 * `speakerphone` and `phone` run with Bluetooth off, so their wheel steps
 * asked the operator to press a button connected to nothing and offered "No
 * Bluetooth" as the answer. The first version put that answer first; the
 * 2026-09-27 drive said that was still seven steps of nothing: "the
 * bluetooth off tests need to skip the bluetooth required ones, don't just
 * put a button there." So they are off the path, the way a dormant probe
 * is, and the count says so before the run starts.
 */

async function openTest(page: Page, condition: string): Promise<void> {
  await withSettings(page, {});
  await selectFieldTestCondition(page, condition);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
}

async function start(page: Page): Promise<void> {
  const button = page.getByTestId('fieldtest-start');
  await button.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await button.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
}

async function walk(page: Page): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    seen.push((await page.getByTestId('fieldtest-title').getAttribute('data-step')) ?? '?');
    const skip = page.getByTestId('fieldtest-skip');
    if (await skip.isDisabled()) return seen;
    await skip.click();
  }
  throw new Error('the run never ended');
}

/**
 * THE ROUTING PROTOCOL'S OWN STEPS, and nothing else.
 *
 * Both oracles below predict a path length, and `onPath` drops a step whose
 * protocol does not match the leg's. This counted the whole table, so the
 * moment ten drill steps were appended it predicted 42 and 35 -- lengths no
 * leg has ever had -- while the app correctly offered 32 and 25. The
 * assertion failed on the oracle, not on the behaviour.
 *
 * The protocol filter is duplicated from `onPath` rather than imported: an
 * oracle that calls the function under test agrees with it by construction.
 */
const routing = FIELD_TEST_STEPS.filter((s) => (s.protocol ?? 'routing') === 'routing');
const wheelSteps = routing.filter((s) => s.wheel).map((s) => s.id);
const base = routing.filter((s) => !s.probe).length;

test('a condition without Bluetooth walks past every wheel step', async ({ page }) => {
  await openTest(page, 'Speakerphone');
  await expect(page.getByTestId('fieldtest-start')).toHaveText(
    `Start — ${base - wheelSteps.length} steps`,
  );
  await start(page);
  await expect(page.getByTestId('fieldtest-progress')).toContainText(
    `of ${base - wheelSteps.length}`,
  );
  // ...and the run's own boundary row counts the path, not the table.
  // (Polled: the log flushes to storage once a second.)
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
          return raw
            ? (JSON.parse(raw) as { event: string; detail?: Record<string, unknown> }[])
                .filter((e) => e.event === 'run-start')
                .map((e) => e.detail?.steps)
            : [];
        }),
      { message: 'run-start under speakerphone counts the wheel steps it skips', timeout: 5_000 },
    )
    .toEqual([base - wheelSteps.length]);

  const seen = await walk(page);
  for (const id of wheelSteps) expect(seen, `${id} was shown with no car to press into`).not.toContain(id);
  expect(seen).toContain('mic-route');
  expect(seen.at(-1)).toBe('free');
});

test('a condition with Bluetooth still runs them all', async ({ page }) => {
  await openTest(page, 'Car, parked');
  await expect(page.getByTestId('fieldtest-start')).toHaveText(`Start — ${base} steps`);
  await start(page);
  const seen = await walk(page);
  for (const id of wheelSteps) expect(seen).toContain(id);
});
