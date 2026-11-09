import { test, expect, type Page } from '@playwright/test';
import { withProfile, withSettings, withStats } from './helpers';
import { EMPTY_STATS } from '../src/store/types';

/**
 * T2-2B: a worked example before the first True count, Deck estimation and
 * Produce the true count run. A card on the setup the first time (history
 * empty, `?intro` under the harness), a "How it works" fold after that. D6:
 * a Drive launch (autoStart) never shows it and never marks it seen.
 */

test.use({ viewport: { width: 375, height: 812 } });

const DRILLS = [
  { name: 'True count drill', key: 'bjtrainer.intro.truecount.v1', stat: 'trueCount', text: 'True count = running count ÷ decks left.' },
  { name: 'Deck estimation', key: 'bjtrainer.intro.deckest.v1', stat: 'deckEstimation', text: 'The tray holds about 2½ decks of 6, so 3½ are left.' },
  { name: 'Produce the true count', key: 'bjtrainer.intro.producetc.v1', stat: 'produceTc', text: '+8 ÷ 4 = 2 → floor +2' },
] as const;

async function openDrill(page: Page, name: string, url = '/?e2e=1&intro=1') {
  await page.goto(url);
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

const card = (page: Page) => page.getByTestId('drill-intro');
const fold = (page: Page) => page.getByTestId('drill-intro-fold');

for (const d of DRILLS) {
  test(`${d.name}: the example shows once, Got it keeps it as a fold, and Start still works`, async ({ page }) => {
    await withProfile(page);
    await openDrill(page, d.name);
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText(d.text);
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeInViewport();

    await card(page).getByRole('button', { name: 'Got it', exact: true }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(fold(page)).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), d.key)).toBe('1');

    // Same content, behind the fold.
    await fold(page).locator('summary').click();
    await expect(fold(page)).toContainText(d.text);

    // On the next visit: no card, the fold is there.
    await openDrill(page, d.name);
    await expect(card(page)).toHaveCount(0);
    await expect(fold(page)).toBeVisible();

    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  });

  test(`${d.name}: with history on record, no card`, async ({ page }) => {
    await withProfile(page);
    const row = { date: '2026-11-01T00:00:00.000Z', correct: true };
    await withStats(page, {
      ...(EMPTY_STATS as unknown as Record<string, unknown>),
      [d.stat]: { history: [row] },
    });
    await openDrill(page, d.name);
    await expect(fold(page)).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });
}

test('True count: starting a run marks the example seen', async ({ page }) => {
  await withProfile(page);
  await openDrill(page, 'True count drill');
  await expect(card(page)).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('bjtrainer.intro.truecount.v1'))).toBe('1');
});

test("True count: the example follows the profile's rounding (truncate)", async ({ page }) => {
  await withProfile(page, { tcRounding: 'truncate' });
  await openDrill(page, 'True count drill');
  await expect(card(page)).toContainText('Your profile truncates');
  await expect(card(page)).toContainText('→ truncate −3');
  await expect(card(page)).toContainText('Below zero the rounding matters: floor would give −4.');
});

test('Produce the true count: the example follows the profile rounding', async ({ page }) => {
  await withProfile(page, { tcRounding: 'round' });
  await openDrill(page, 'Produce the true count');
  await expect(card(page)).toContainText('+8 ÷ 4 = 2 → round +2');
});

test('D6: a Drive launch shows no example and does not mark it seen', async ({ page }) => {
  await withProfile(page);
  await withSettings(page, { audio: { enabled: true }, lastDrive: { mode: 'truecount', voice: false } });
  await page.goto('/?e2e=1&intro=1');
  await page.getByRole('button', { name: 'Drive: True count drill' }).click();
  // Past setup, straight into the run.
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('bjtrainer.intro.truecount.v1'))).toBeNull();
});
