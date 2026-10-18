import { test, expect, type Page } from '@playwright/test';
import { withSettings, withStats, openCountOptions, submitZero } from './helpers';

/**
 * G1 (L-1): the count drill's beginner aid. "Show Hi-Lo values" (off by
 * default, in Options) prints each flashed card's tag under it and opens the
 * result's run listing; "Easy first run" is offered only before any count run
 * is on record.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const SHOTS =
  'C:/Users/jackp/AppData/Local/Temp/claude/C--Users-jackp/5eb9dd98-f8da-490b-a046-a394be7c9a16/scratchpad/waveG/a-shots';
const NOTCH = `
  :root { --safe-top: 47px; --safe-bottom: 34px; }
  .drill-primary-bar { padding-bottom: calc(0.75rem + 34px) !important; }
`;
const MINUS = '\u2212';

/** The Hi-Lo tag of a card face, computed here rather than read off the app. */
function tagOf(dataCard: string): string {
  const rank = dataCard.slice(0, -1);
  if (['2', '3', '4', '5', '6'].includes(rank)) return '+1';
  if (['7', '8', '9'].includes(rank)) return '0';
  if (['10', 'J', 'Q', 'K', 'A'].includes(rank)) return `${MINUS}1`;
  throw new Error(`unknown card ${dataCard}`);
}

const ONE_RUN = { countDrill: { history: [{ date: '2026-10-16T12:00:00.000Z', cards: 52, intervalMs: 800, correct: true }] } };

async function openCountSetup(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();
}

/** Every card on screen now, with the value printed under it (or null). */
async function cardsWithValues(page: Page): Promise<{ card: string; value: string | null }[]> {
  return page.locator('.count-flash-cards .card').evaluateAll((cards) =>
    cards.map((c) => {
      const wrap = c.closest('.hilo-card');
      const v = wrap?.querySelector('.hilo-value');
      return { card: c.getAttribute('data-card') ?? '', value: v ? (v.textContent ?? '') : null };
    }),
  );
}

/** Step a manual run card by card, collecting what each step showed. */
async function stepThrough(page: Page, steps: number): Promise<{ card: string; value: string | null }[][]> {
  const seen: { card: string; value: string | null }[][] = [];
  for (let i = 0; i < steps; i++) {
    await expect(page.locator('.manual-tap-hint')).toContainText(`${i + 1}/${steps}`);
    seen.push(await cardsWithValues(page));
    await page.locator('.manual-tap-zone').click();
  }
  return seen;
}

test('option off (the default): no values under the cards, and the run listing stays closed', async ({ page }) => {
  await withSettings(page, { drill: { countLengthCards: 13, countGroup: 1, countManual: true } });
  await withStats(page, ONE_RUN);
  await openCountSetup(page);
  await openCountOptions(page);
  await expect(page.getByLabel(/Show Hi-Lo values/)).not.toBeChecked();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const seen = await stepThrough(page, 13);
  expect(seen.flat()).toHaveLength(13);
  for (const c of seen.flat()) expect(c.value).toBeNull();
  await expect(page.locator('.hilo-value')).toHaveCount(0);
  await submitZero(page);
  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.getByTestId('count-run')).not.toHaveAttribute('open', '');
});

test('option on: each card carries its own Hi-Lo value; the result lists the count after every card', async ({ page }) => {
  await withSettings(page, { drill: { countLengthCards: 26, countGroup: 1, countManual: true } });
  await withStats(page, ONE_RUN);
  await openCountSetup(page);
  await openCountOptions(page);
  await page.getByLabel(/Show Hi-Lo values/).check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.hilo-value')).toHaveCount(1);
  if (SHOTS) {
    await page.addStyleTag({ content: NOTCH });
    await page.waitForTimeout(400); // past the card's arrival
    await page.screenshot({ path: `${SHOTS}/g1-hilo-flash-375x812.png` });
  }
  const seen = (await stepThrough(page, 26)).flat();
  expect(seen).toHaveLength(26);
  for (const c of seen) expect(c.value, c.card).toBe(tagOf(c.card));
  // Vacuity: the run had all three tags in it.
  expect(new Set(seen.map((c) => c.value))).toEqual(new Set(['+1', '0', `${MINUS}1`]));

  await submitZero(page);
  await expect(page.locator('.drill-result')).toBeVisible();
  const run = page.getByTestId('count-run');
  await expect(run).toHaveAttribute('open', '');
  const totals = await page.locator('.count-run-total').allInnerTexts();
  expect(totals).toHaveLength(26);
  // The running total after each card is the sum of the values that were shown.
  let rc = 0;
  seen.forEach((c, i) => {
    rc += c.value === '+1' ? 1 : c.value === '0' ? 0 : -1;
    expect(totals[i]!.replace(MINUS, '-').replace('+', '')).toBe(String(rc));
  });
  if (SHOTS) {
    await page.addStyleTag({ content: NOTCH });
    await page.screenshot({ path: `${SHOTS}/g1-hilo-result-375x812.png` });
  }
});

test('option on with groups of three and messy cards: one value per card, level under the tilt', async ({ page }) => {
  await withSettings(page, {
    drill: { countLengthCards: 13, countGroup: 3, countManual: true, messyCards: true, countShowHiLo: true },
  });
  await withStats(page, ONE_RUN);
  await openCountSetup(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const first = await cardsWithValues(page);
  expect(first).toHaveLength(3);
  for (const c of first) expect(c.value, c.card).toBe(tagOf(c.card));
  // The value is not inside the rotated wrapper.
  expect(await page.locator('.messy-card .hilo-value').count()).toBe(0);
  // Three cards and their values still fit across the phone.
  const boxes = await page.locator('.hilo-card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
  expect(Math.max(...boxes)).toBeLessThanOrEqual(375);
  if (SHOTS) {
    await page.addStyleTag({ content: NOTCH });
    await page.screenshot({ path: `${SHOTS}/g1-hilo-group3-messy-375x812.png` });
  }
});

test('option on in Table mode: every card of the round carries its value', async ({ page }) => {
  await withSettings(page, {
    drill: { countTableMode: true, countTableRounds: 5, countManual: true, countShowHiLo: true },
  });
  await withStats(page, ONE_RUN);
  await openCountSetup(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const table = page.getByTestId('count-table');
  await expect(table).toBeVisible();
  const cards = await table.locator('.card').evaluateAll((els) =>
    els.map((c) => ({
      card: c.getAttribute('data-card') ?? '',
      value: c.closest('.hilo-card')?.querySelector('.hilo-value')?.textContent ?? null,
    })),
  );
  expect(cards.length).toBeGreaterThanOrEqual(4);
  for (const c of cards) expect(c.value, c.card).toBe(tagOf(c.card));
  if (SHOTS) {
    await page.addStyleTag({ content: NOTCH });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/g1-hilo-table-375x812.png` });
  }
});

test('fresh storage offers Easy first run; it deals one slow deck with values shown', async ({ page }) => {
  await openCountSetup(page);
  const easy = page.getByRole('button', { name: 'Easy first run', exact: true });
  await expect(easy).toBeVisible();
  await expect(page.getByTestId('easy-first-note')).toBeVisible();
  if (SHOTS) {
    await page.addStyleTag({ content: NOTCH });
    await page.screenshot({ path: `${SHOTS}/g1-easy-first-run-setup-375x812.png` });
  }
  await easy.click();
  await expect(page.locator('.count-flash-progress')).toContainText('/ 52');
  const shown = await cardsWithValues(page);
  expect(shown).toHaveLength(1);
  expect(shown[0]!.value).toBe(tagOf(shown[0]!.card));
  // Slow: a card stays up about 2 s (the default is 0.8 s). Measured from the
  // second card's arrival to the third's, so the time to first paint is out of
  // it; a loaded machine can only make the gap longer, never shorter.
  const progress = page.locator('.count-flash-progress');
  await expect(progress).toContainText('2 / 52', { timeout: 5000 });
  const t0 = Date.now();
  await expect(progress).toContainText('3 / 52', { timeout: 5000 });
  expect(Date.now() - t0).toBeGreaterThan(1500);
  // The preset is saved, so Options shows what the run used.
  const drill = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill);
  expect(drill).toMatchObject({ countLengthCards: 52, countGroup: 1, countIntervalMs: 2000, countShowHiLo: true, countManual: false });
});

test('one count run on record hides Easy first run', async ({ page }) => {
  await withStats(page, ONE_RUN);
  await openCountSetup(page);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Easy first run', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('easy-first-note')).toHaveCount(0);
});

test('a Timed Challenge run on record hides it too', async ({ page }) => {
  await withStats(page, {
    timedCount: {
      history: [{ date: '2026-10-16T12:00:00.000Z', cards: 52, elapsedMs: 40000, secondsPerDeck: 40, tier: 'learning', correct: true }],
    },
  });
  await openCountSetup(page);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Easy first run', exact: true })).toHaveCount(0);
});

test('eyes-free: neither the option nor Easy first run is offered', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true } });
  await openCountSetup(page);
  await expect(page.getByRole('button', { name: 'Easy first run', exact: true })).toBeVisible();
  await page.getByLabel('Eyes-free audio').check();
  await expect(page.getByRole('button', { name: 'Easy first run', exact: true })).toHaveCount(0);
  await openCountOptions(page);
  await expect(page.getByLabel(/Show Hi-Lo values/)).toHaveCount(0);
});
