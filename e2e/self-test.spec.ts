import { test, expect, type Page } from '@playwright/test';

/**
 * The test suite, run from the phone.
 *
 * Jack asked for this twice -- the second time because the first answer was
 * five device checks on the car check, which is not "all the tests you run".
 * What this spec has to establish is not that the panel goes green: a panel
 * hard-coded to say "All passed" would do that. It has to establish that the
 * panel can go RED, name what failed, and recover -- otherwise it is the exact
 * instrument I keep building by accident, the one that turns a real fault into
 * a screen full of ticks.
 */

const MINI = { width: 375, height: 812 };

test.use({ viewport: MINI });

async function openSettings(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.locator('.settings-heading')).toBeVisible();
}

async function runSuite(page: Page) {
  const button = page.getByTestId('selftest-run');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  // Either verdict row ends the run; waiting for the pass row alone would hang
  // on exactly the failure this screen exists to show.
  await expect(
    page.getByTestId('selftest-pass').or(page.getByTestId('selftest-fail')),
  ).toBeVisible({ timeout: 15000 });
}

test('the suite runs on the device and reports a count', async ({ page }) => {
  await openSettings(page);
  await runSuite(page);

  await expect(page.getByTestId('selftest-pass')).toBeVisible();
  // The dev server serves the real clips, so the recorded-voice cases run for
  // real here too. A count is only meaningful if it is a big one.
  const count = await page.getByTestId('selftest-pass').locator('.settings-value').innerText();
  const [passed, total] = count.split('/').map(Number);
  expect(total).toBeGreaterThanOrEqual(40);
  expect(passed).toBe(total);
  await expect(page.getByTestId('selftest-failures')).toHaveCount(0);
});

test('it names every group, so an empty group cannot hide inside a total', async ({ page }) => {
  await openSettings(page);
  await runSuite(page);

  const section = page.locator('.settings-section', { has: page.getByTestId('selftest-run') });
  for (const group of [
    'Basic strategy',
    'Counting',
    'True count',
    'Deviations',
    'Hands',
    'Recorded voice',
    'Settings',
  ]) {
    await expect(section.getByText(group, { exact: true })).toBeVisible();
  }
});

test('a broken setting turns the panel red and the failure is named', async ({ page }) => {
  // The whole point. Corrupt the one subject that can be corrupted from
  // outside the app -- the settings blob on disk -- and require the screen to
  // say so rather than reporting a clean run.
  await page.goto('/?e2e=1');
  await page.evaluate(() => {
    localStorage.setItem('bjtrainer.settings.v1', JSON.stringify({ version: 1, rules: {} }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.locator('.settings-heading')).toBeVisible();
  // Settings rewrites the blob on any change, so nothing may be touched
  // between the reload and the run.
  await page.evaluate(() => {
    localStorage.setItem('bjtrainer.settings.v1', JSON.stringify({ version: 1, rules: {} }));
  });

  await runSuite(page);

  await expect(page.getByTestId('selftest-fail')).toBeVisible();
  const failures = page.getByTestId('selftest-failures');
  await expect(failures).toBeVisible();
  await expect(failures).toContainText('audio');
});

test('the button says it is running, and can be run again', async ({ page }) => {
  await openSettings(page);
  await runSuite(page);
  await expect(page.getByTestId('selftest-run')).toHaveText('Run again');
  await page.getByTestId('selftest-run').click();
  await expect(
    page.getByTestId('selftest-pass').or(page.getByTestId('selftest-fail')),
  ).toBeVisible({ timeout: 15000 });
});

test('running it speaks nothing and plays nothing', async ({ page }) => {
  // It is meant to be safe to press at a red light. A suite that spoke its way
  // through forty cases would be unusable in a car and would also take the
  // audio session with it.
  await openSettings(page);
  await page.evaluate(() => {
    const w = window as unknown as { __spoke: number };
    w.__spoke = 0;
    const synth = window.speechSynthesis;
    if (synth) {
      const real = synth.speak.bind(synth);
      synth.speak = (u: SpeechSynthesisUtterance) => {
        w.__spoke += 1;
        real(u);
      };
    }
    const realPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__spoke += 1;
      return realPlay.call(this);
    };
  });

  await runSuite(page);

  expect(await page.evaluate(() => (window as unknown as { __spoke: number }).__spoke)).toBe(0);
});
