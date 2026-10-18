import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, readStats, playRoundByAdvice, statsTab } from './helpers';

/**
 * Wave I: Dealer mistakes is Off / Occasional (about 1 round in 30) /
 * Training (about 1 in 5), and a Training session is labelled on its report.
 *
 * Seed 12, found by simulating the default e2e profile (6D H17, solo, flat
 * 1-unit bet) played by the table's own advice, insurance declined: round 1
 * is 5,8,7 (20) v dealer 8,9 (17), worth +1. Its first draw on the error
 * stream is under Training's chance and over Occasional's, so Training pays
 * +2 and Occasional pays it right. Each spec asserts the round before relying
 * on it.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const SHOTS =
  'C:/Users/jackp/AppData/Local/Temp/claude/C--Users-jackp/5eb9dd98-f8da-490b-a046-a394be7c9a16/scratchpad/waveI/dm-shots';
const NOTCH = ':root { --safe-top: 47px; --safe-bottom: 34px; }';
const SEED = 12;

async function openPlay(page: Page): Promise<void> {
  await page.goto(`/?seed=${SEED}&e2e=1`);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
}

async function dealAndPlay(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  await expect(page.locator('.round-banner')).toHaveCount(1);
}

async function endWithReport(page: Page): Promise<void> {
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-screen')).toBeVisible();
}

const foul = (page: Page) => page.getByRole('button', { name: 'Foul', exact: true });
const bankroll = async (page: Page): Promise<string> =>
  ((await page.locator('.topbar-stat').first().innerText()).match(/Bankroll: ([\d.]+)/) ?? [])[1] ?? '';

type Row = { dealerErrors?: { made: number; caught: number; falseCalls: number }; dealerMistakesTraining?: boolean };
const sessionRows = async (page: Page): Promise<Row[]> => ((await readStats(page))?.sessions as Row[] | undefined) ?? [];
const savedSettings = (page: Page) =>
  page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}') as Record<string, unknown>);

async function expectSeedRound(page: Page): Promise<void> {
  const banner = page.locator('.round-banner');
  await expect(banner).toContainText('You 20');
  await expect(banner).toContainText('Dealer 17');
}

test('the selector: Off by default, Training saved and dealt live, the sheet screenshot', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page);
  await openPlay(page);
  await page.getByTestId('tab-gear-play').click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  const group = sheet.getByRole('group', { name: 'Dealer mistakes' });
  const option = (name: string) => group.getByRole('button', { name, exact: true });
  await expect(option('Off')).toHaveAttribute('aria-pressed', 'true');
  await expect(option('Occasional')).toHaveAttribute('aria-pressed', 'false');
  await expect(option('Training')).toHaveAttribute('aria-pressed', 'false');

  await option('Training').click();
  await expect(option('Training')).toHaveAttribute('aria-pressed', 'true');
  await expect(option('Off')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await savedSettings(page)).dealerMistakesMode).toBe('training');
  expect((await savedSettings(page)).dealerMistakes).toBe(true);

  // All three sit side by side at 375px, inside the sheet.
  const sheetBox = (await sheet.boundingBox())!;
  const boxes = await Promise.all(['Off', 'Occasional', 'Training'].map((n) => option(n).boundingBox()));
  for (const b of boxes) {
    expect(b!.x).toBeGreaterThanOrEqual(sheetBox.x);
    expect(b!.x + b!.width).toBeLessThanOrEqual(sheetBox.x + sheetBox.width + 0.5);
    expect(Math.abs(b!.y - boxes[0]!.y)).toBeLessThan(2);
  }
  await page.addStyleTag({ content: NOTCH });
  await group.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${SHOTS}/dm-play-sheet-training-375x812.png` });

  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await dealAndPlay(page);
  await expectSeedRound(page);
  await expect(page.locator('.round-banner')).toHaveAttribute('data-net', '2');
  await expect(foul(page)).toBeVisible();

  // Back to Off: the choice is saved, and the G2 boolean follows it.
  await page.getByTestId('tab-gear-play').click();
  await option('Off').click();
  await expect.poll(async () => (await savedSettings(page)).dealerMistakesMode).toBe('off');
  expect((await savedSettings(page)).dealerMistakes).toBe(false);
});

test('a G2 save (dealerMistakes: true) opens as Occasional, and pays the seed round right', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0, dealerMistakes: true });
  await withProfile(page);
  await openPlay(page);
  await page.getByTestId('tab-gear-play').click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  const group = sheet.getByRole('group', { name: 'Dealer mistakes' });
  await expect(group.getByRole('button', { name: 'Occasional', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await dealAndPlay(page);
  await expectSeedRound(page);
  // Occasional's chance is under the seed's first draw: paid right.
  await expect(page.locator('.round-banner')).toHaveAttribute('data-net', '1');
  expect(await bankroll(page)).toBe('101');
  await endWithReport(page);
  await expect(page.getByTestId('report-dealer-errors')).toHaveText('Dealer errors caught 0/0');
  await expect(page.getByTestId('report-dealer-training')).toHaveCount(0);
  expect((await sessionRows(page))[0]?.dealerMistakesTraining).toBeUndefined();
});

test('Training on a seeded shoe: the error is made, caught, and the session is labelled Training', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0, dealerMistakesMode: 'training' });
  await withProfile(page);
  await openPlay(page);
  await dealAndPlay(page);
  await expectSeedRound(page);
  const banner = page.locator('.round-banner');
  await expect(banner).toHaveAttribute('data-net', '2');
  expect(await bankroll(page)).toBe('102');
  await foul(page).click();
  const verdict = page.getByTestId('foul-verdict');
  await expect(verdict).toHaveAttribute('data-correct', 'true');
  await expect(verdict).toHaveAttribute('data-kind', 'overpay');
  await expect(banner).toHaveAttribute('data-net', '1');
  expect(await bankroll(page)).toBe('101');

  await endWithReport(page);
  await expect(page.getByTestId('report-dealer-training')).toHaveText(
    'Dealer mistakes training: about one round in 5 had a payout error on purpose. Missed errors stay in your bankroll.',
  );
  await expect(page.getByTestId('report-dealer-errors')).toHaveText('Dealer errors caught 1/1');
  // Unlike Hot shoe, the bankroll is kept and shown.
  await expect(page.locator('.report-summary')).toContainText('bankroll +1');
  const row = (await sessionRows(page))[0]!;
  expect(row.dealerMistakesTraining).toBe(true);
  expect(row.dealerErrors).toEqual({ made: 1, caught: 1, falseCalls: 0 });
  await page.addStyleTag({ content: NOTCH });
  await page.screenshot({ path: `${SHOTS}/dm-report-training-375x812.png` });

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Play');
  await expect(page.locator('.session-row').first().locator('.session-tag')).toContainText('Foul training');
});

test('Training, error missed: the overpay stays in the bankroll', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0, dealerMistakesMode: 'training' });
  await withProfile(page);
  await openPlay(page);
  await dealAndPlay(page);
  await expectSeedRound(page);
  await expect(page.locator('.round-banner')).toHaveAttribute('data-net', '2');
  await endWithReport(page);
  await expect(page.getByTestId('report-dealer-errors')).toHaveAttribute('data-caught', '0');
  await expect(page.locator('.report-summary')).toContainText('bankroll +2');
  await expect(page.getByTestId('report-dealer-training')).toBeVisible();
});
