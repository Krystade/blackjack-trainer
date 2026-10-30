import { test, expect } from '@playwright/test';
import { readStoredDiagnostics } from './helpers';

test('the test kit opens from Home and walks into the first desk step', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await expect(page.getByTestId('testkit-screen')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/testkit-menu.png' });

  await page.getByRole('button', { name: /At my desk/ }).click();
  await expect(page.locator('[data-step="desk-baseline-element"]')).toBeVisible();
  await page.getByTestId('testkit-screen').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Loud speaker' })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/testkit-route.png' });

  await page.getByRole('button', { name: 'Loud speaker' }).click();
  await expect(page.locator('[data-step="desk-baseline-webaudio"]')).toBeVisible();
});

test('the speaker check runs six blind plays and reports each path separately', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await page.getByRole('button', { name: /Speaker check/ }).click();
  const kit = page.getByTestId('testkit-screen');

  // The two never-opened controls, then six blind plays.
  for (let i = 0; i < 8; i++) {
    await kit.getByRole('button', { name: 'Play', exact: true }).click();
    await kit.getByRole('button', { name: 'Loud speaker' }).click();
  }
  const result = page.getByTestId('testkit-blind-result');
  await expect(result).toContainText('Normal playback: 3 of 3 on the loud speaker');
  await expect(result).toContainText('Web Audio: 3 of 3 on the loud speaker');
  await page.screenshot({ path: 'e2e/screenshots/testkit-blind.png' });
});

test('the Bluetooth phone-mic kit is listed and walks inputs, probe and finger test', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await page.locator('.testkit-unanswered > summary').click();
  await expect(page.getByTestId('testkit-open-questions').locator('li')).toHaveCount(5);
  await expect(page.getByTestId('testkit-open-questions')).toContainText('Phone mic with Bluetooth on.');

  await page.getByRole('button', { name: /Bluetooth: phone mic\?/ }).click();
  const kit = page.getByTestId('testkit-screen');
  await expect(page.locator('[data-step="phone-inputs"]')).toBeVisible();

  // 1. inputs
  await kit.getByRole('button', { name: 'List inputs' }).click();
  await expect(page.getByTestId('testkit-inputs')).toContainText('chosen');
  await kit.getByRole('button', { name: 'Next', exact: true }).click();

  // 2. probe on the chosen input (fake device: a tone)
  await expect(page.locator('[data-step="phone-probe"]')).toBeVisible();
  await kit.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('testkit-probe-rows')).toContainText('Phone', { timeout: 15_000 });
  await kit.getByRole('button', { name: 'Next', exact: true }).click({ timeout: 20_000 });

  // 3. finger test: two timed windows, then a ratio
  await expect(page.locator('[data-step="phone-finger"]')).toBeVisible();
  await kit.getByRole('button', { name: 'Open the input' }).click();
  await kit.getByRole('button', { name: /Covered: start/ }).click();
  await kit.getByRole('button', { name: /Uncovered: start/ }).click({ timeout: 10_000 });
  await expect(page.getByTestId('testkit-finger-note')).toContainText('of uncovered', { timeout: 10_000 });
  await page.screenshot({ path: 'e2e/screenshots/testkit-phone-finger.png' });
  await kit.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('[data-step="phone-route"]')).toBeVisible();

  // Stop releases every stream and returns to the menu.
  await kit.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('.testkit-unanswered')).toBeVisible();
});

test('Words at speed opens on the Bluetooth question, then the word step', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await page.getByRole('button', { name: /Words at speed/ }).click();
  const kit = page.getByTestId('testkit-screen');
  await kit.getByRole('button', { name: 'Bluetooth off' }).click();
  await expect(page.locator('[data-step="speed-calibrate"]')).toBeVisible();
  await expect(kit).toContainText('If it says “Again”, say the same word once more.');
});

/**
 * A3: the phone-mic kit's wheel step must claim the media session itself.
 * Nothing on this kit plays through the clips path, which is where handlers
 * are otherwise registered, so opened straight from Home the probe sat over a
 * session with no handlers and a real press could never arrive.
 */
test('the phone-mic wheel step registers the wheel and holds focus, opened straight from Home', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const handlers: Record<string, () => void> = {};
    (window as unknown as { __wheel: (a: string) => boolean }).__wheel = (action) => {
      const fn = handlers[action];
      if (!fn) return false;
      fn();
      return true;
    };
    const original = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action: string, handler: (() => void) | null) => {
      if (handler) handlers[action] = handler;
      else delete handlers[action];
      return original(action as never, handler as never);
    };
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await page.getByRole('button', { name: /Bluetooth: phone mic\?/ }).click();
  const kit = page.getByTestId('testkit-screen');
  for (let i = 0; i < 10 && !(await page.locator('[data-step="phone-wheel"]').isVisible()); i++) {
    await kit.getByRole('button', { name: 'Skip this step' }).click();
  }
  await expect(page.locator('[data-step="phone-wheel"]')).toBeVisible();
  await kit.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(kit.getByText('Press skip-forward on the wheel now')).toBeVisible();

  const pressed = await page.evaluate(
    () => (window as unknown as { __wheel?: (a: string) => boolean }).__wheel?.('nexttrack') ?? false,
  );
  expect(pressed, 'no nexttrack handler was registered by the wheel step').toBe(true);
  await expect(page.getByTestId('testkit-wheel-result')).toContainText('Arrived: nexttrack');

  await expect
    .poll(async () => {
      const raw = await readStoredDiagnostics(page);
      const rows = raw ? (JSON.parse(raw) as Array<{ event?: string; detail?: Record<string, unknown> }>) : [];
      return {
        held: rows.some((r) => (r.event === 'hold' || r.event === 'hold-joined') && r.detail?.key === 'test-kit'),
        registered: rows.filter((r) => r.event === 'kit-wheel').pop()?.detail?.registered,
      };
    }, { timeout: 10_000 })
    .toEqual({ held: true, registered: true });
});
