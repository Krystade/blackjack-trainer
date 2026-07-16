import type { Page } from '@playwright/test';

/** Screenshot to e2e/screenshots/<name>.png (gitignored; reviewed set lives in e2e/screenshots-reviewed/). */
export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `e2e/screenshots/${name}.png` });
}

/**
 * Write a partial Settings object into localStorage BEFORE the app's first
 * script runs, so useGame/App pick it up on initial load. The store's
 * mergeSettings() deep-merges partial blobs over DEFAULT_SETTINGS, so only
 * the fields under test need to be specified.
 */
export async function withSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify({ version: 1, ...patch });
  await page.addInitScript((settingsJson) => {
    window.localStorage.setItem('bjtrainer.settings.v1', settingsJson);
  }, json);
}

/** Navigate home, then click the named Home nav button ("Play" | "Drills" | "Stats" | "Settings"). */
export async function goHomeAndNavigate(page: Page, url: string, button: 'Play' | 'Drills' | 'Stats' | 'Settings'): Promise<void> {
  await page.goto(url);
  await page.getByRole('button', { name: button, exact: true }).click();
}

/** If the insurance modal is currently showing, resolve it (Take/Decline) and return true. */
export async function resolveInsurance(page: Page, take: boolean): Promise<boolean> {
  const modal = page.locator('.modal-backdrop', { hasText: 'Insurance?' });
  if (await modal.isVisible().catch(() => false)) {
    await modal.getByRole('button', { name: take ? 'Take' : 'Decline', exact: true }).click();
    return true;
  }
  return false;
}

/**
 * Drive a dealt round to completion by always taking the e2e advice
 * (`data-advice` on `.action-bar`), always declining insurance, and
 * dismissing any training-mode wrong-play overlay it happens to hit
 * (only possible if the advice itself changes between reads, which it
 * shouldn't — kept as a safety net). Stops once the action bar leaves
 * "actions" mode (round settled -> bet mode, or a count-check modal ->
 * hidden mode).
 */
export async function playRoundByAdvice(page: Page): Promise<void> {
  for (let guard = 0; guard < 30; guard++) {
    if (await resolveInsurance(page, false)) continue;

    const continueBtn = page.getByRole('button', { name: 'Continue', exact: true });
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      continue;
    }

    const bar = page.locator('.action-bar[data-advice]');
    if (!(await bar.isVisible().catch(() => false))) return;
    const advice = await bar.getAttribute('data-advice');
    if (!advice) return;
    const label = advice.charAt(0).toUpperCase() + advice.slice(1);
    await bar.getByRole('button', { name: label, exact: true }).click();
  }
  throw new Error('playRoundByAdvice: exceeded guard iterations without settling');
}
