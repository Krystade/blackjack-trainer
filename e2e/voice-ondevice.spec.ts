import { test, expect, type Page } from '@playwright/test';

/**
 * The offline speech model.
 *
 * The behaviour these specs exist for was measured, not assumed: Chrome's
 * `install()` can resolve FALSE, immediately, with a real user gesture,
 * without throwing and without a reason. A refusal is silent and carries no
 * explanation, so the panel must never report success on install()'s say-so
 * -- what it reports is what `available()` says afterwards.
 *
 * The real static API cannot be driven from a test (the model is a genuine
 * download), so it is stubbed per-spec to produce each state in turn.
 */

async function withModelState(
  page: Page,
  opts: { available: string; installReturns?: boolean; availableAfter?: string },
): Promise<void> {
  await page.addInitScript((o) => {
    let current = o.available;
    function FakeRecognition(this: unknown) {
      /* constructible, so capability detection still reports supported */
    }
    FakeRecognition.available = async (options: { processLocally?: boolean }) =>
      options?.processLocally ? current : 'available';
    FakeRecognition.install = async () => {
      if (o.availableAfter) current = o.availableAfter;
      return o.installReturns === true;
    };
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  }, opts);
}

async function openVoiceSettings(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const section = page.locator('.settings-section', { hasText: 'Voice control' });
  await expect(section).toBeVisible();
  return section;
}

/**
 * Ask the capability question explicitly.
 *
 * It is behind a button rather than running on mount because on some builds
 * of Chrome the query does not return -- it kills the renderer. Opening
 * Settings must never be able to close the app, so nothing asks until asked.
 */
async function checkForModel(page: Page) {
  const section = await openVoiceSettings(page);
  await section.getByRole('button', { name: 'Check for an offline model' }).click();
  return section;
}

test('nothing is asked of the browser until it is asked for by name', async ({ page }) => {
  await withModelState(page, { available: 'downloadable' });
  const section = await openVoiceSettings(page);

  // No status, because nothing has been queried: the query is the part that
  // can take the tab down, so opening Settings must not perform it.
  await expect(section).not.toContainText('downloadable');
  await expect(section.getByRole('button', { name: 'Check for an offline model' })).toBeVisible();
});

test('a model that can be fetched offers to fetch it', async ({ page }) => {
  await withModelState(page, { available: 'downloadable' });
  const section = await checkForModel(page);

  await expect(section).toContainText('downloadable');
  await expect(section.getByRole('button', { name: 'Download offline model' })).toBeVisible();
  // Nothing is claimed until it is actually installed.
  await expect(section).not.toContainText('Installed.');
});

/**
 * The case observed in a real browser. Reporting success here would put a
 * green tick on a feature that does not exist, and the operator would find
 * out in a tunnel.
 */
test('a silent refusal is reported as a refusal, not as success', async ({ page }) => {
  await withModelState(page, { available: 'downloadable', installReturns: false });
  const section = await checkForModel(page);

  await section.getByRole('button', { name: 'Download offline model' }).click();

  await expect(section).toContainText('declined to install it');
  await expect(section).not.toContainText('Installed.');
  // And it says what still happens, so this never reads as "voice is broken".
  await expect(section).toContainText('over the network');
});

test('a refusal leaves the button usable, so it can be tried again', async ({ page }) => {
  await withModelState(page, { available: 'downloadable', installReturns: false });
  const section = await checkForModel(page);
  await section.getByRole('button', { name: 'Download offline model' }).click();
  await expect(section).toContainText('declined to install it');
  await expect(section.getByRole('button', { name: 'Download offline model' })).toBeEnabled();
});

test('a successful install is reported, and the model can then be switched on', async ({ page }) => {
  await withModelState(page, {
    available: 'downloadable',
    installReturns: true,
    availableAfter: 'available',
  });
  const section = await checkForModel(page);

  await section.getByRole('button', { name: 'Download offline model' }).click();

  await expect(section).toContainText('Installed.');
  await expect(section.getByRole('checkbox', { name: 'Use the offline model' })).toBeVisible();
});

/**
 * install() saying yes means the request was ACCEPTED, not that the model has
 * arrived -- a download runs in the background and reports no progress.
 * Announcing it as installed here would send the operator into a tunnel
 * trusting a model that is still coming down.
 */
test('an accepted download is not reported as an installed model', async ({ page }) => {
  await withModelState(page, {
    available: 'downloadable',
    installReturns: true,
    availableAfter: 'downloading',
  });
  const section = await checkForModel(page);

  await section.getByRole('button', { name: 'Download offline model' }).click();

  await expect(section).toContainText('Downloading now');
  await expect(section).not.toContainText('Installed.');
  // And the switch stays hidden until there is something to switch to.
  await expect(section.getByRole('checkbox', { name: 'Use the offline model' })).toHaveCount(0);
});

/**
 * The mirror of the silent-refusal case, and the reason the panel re-queries
 * at all: a browser that already holds the model can decline to install and
 * be ready regardless.
 */
test('a refusal from a browser that already has the model still reports ready', async ({ page }) => {
  await withModelState(page, {
    available: 'downloadable',
    installReturns: false,
    availableAfter: 'available',
  });
  const section = await checkForModel(page);

  await section.getByRole('button', { name: 'Download offline model' }).click();

  await expect(section).toContainText('Installed.');
  await expect(section).not.toContainText('declined to install it');
});

test('an installed model offers the switch and no download', async ({ page }) => {
  await withModelState(page, { available: 'available' });
  const section = await checkForModel(page);

  await expect(section).toContainText('Installed.');
  await expect(section.getByRole('button', { name: 'Download offline model' })).toHaveCount(0);
});

test('the preference survives a reload, since remembering it opens no microphone', async ({ page }) => {
  await withModelState(page, { available: 'available' });
  let section = await checkForModel(page);

  await section.getByRole('checkbox', { name: 'Use the offline model' }).check();

  section = await checkForModel(page);
  await expect(section.getByRole('checkbox', { name: 'Use the offline model' })).toBeChecked();
});

/**
 * Where there is no local model, the panel must say what happens INSTEAD.
 * Silence here would read as "voice does not work on this device".
 */
test('a browser with no local model names the fallback', async ({ page }) => {
  await withModelState(page, { available: 'unavailable' });
  const section = await checkForModel(page);

  await expect(section).toContainText('network');
  await expect(section.getByRole('button', { name: 'Download offline model' })).toHaveCount(0);
});

/**
 * The query that does not come back.
 *
 * On Chromium 149 `available({processLocally:true})` kills the renderer: the
 * promise never settles and the page dies, so there is nothing to catch and
 * nothing to feature-detect against Chrome 152, where the identical call
 * answers "downloadable". All that is left is to notice afterwards and stop
 * asking. Here the crash is stood in for by a promise that never settles,
 * which is exactly what the page sees before it goes.
 */
test('a browser that never answers is not asked a second time', async ({ page }) => {
  await page.addInitScript(() => {
    let asked = 0;
    function FakeRecognition(this: unknown) {}
    FakeRecognition.available = (options: { processLocally?: boolean }) => {
      if (!options?.processLocally) return Promise.resolve('available');
      asked++;
      (window as unknown as { __asked: number }).__asked = asked;
      return new Promise<string>(() => {});
    };
    FakeRecognition.install = async () => false;
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });

  let section = await openVoiceSettings(page);
  await section.getByRole('button', { name: 'Check for an offline model' }).click();
  await expect(section.getByRole('button', { name: 'Checking…' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __asked?: number }).__asked)).toBe(1);

  // The next load stands in for coming back after the tab died.
  section = await openVoiceSettings(page);
  await expect(section).toContainText('closed the app the last time');
  await expect(section.getByRole('button', { name: 'Check for an offline model' })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { __asked?: number }).__asked)).toBe(undefined);
});

// A browser update can fix the underlying crash, so the guard has to be
// releasable without clearing site data.
test('the refusal to ask can be lifted by hand', async ({ page }) => {
  await withModelState(page, { available: 'available' });
  await page.addInitScript(() => {
    localStorage.setItem('bjtrainer.voiceLocalProbe.v1', 'pending');
  });

  const section = await openVoiceSettings(page);
  await expect(section).toContainText('closed the app the last time');

  await section.getByRole('button', { name: 'Ask this browser again' }).click();
  await expect(section).toContainText('Installed.');
});
