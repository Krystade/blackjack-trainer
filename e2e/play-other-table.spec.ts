import { test, expect, type Locator, type Page } from '@playwright/test';
import { playRoundByAdvice, readStats } from './helpers';

/**
 * Owner 2026-11-10: "it shows another full table of like 6 players and says
 * what's the count of that other table". Play's Kind = Other table deals a
 * second table off its own shoe and asks its count; the main table's count
 * check that follows still asks the MAIN count, which those cards must not
 * have touched.
 *
 * The main running count is worked out here from the felt itself (every face
 * on it once each round settles), independently of the app's own figure, and
 * typed into every count check: a check graded right is the app agreeing that
 * the other table's cards never reached the main count.
 */

const TAG: Record<string, number> = { '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 0, '8': 0, '9': 0 };
const hiLo = (card: string): number => TAG[card.slice(0, -1)] ?? -1;

async function openTable(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?seed=7&e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
}

async function openGear(page: Page) {
  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  await expect(sheet).toBeVisible();
  return sheet;
}

const toggle = (sheet: Locator, label: string) =>
  sheet.getByTestId('what-to-check').getByRole('checkbox', { name: label, exact: true });

async function typeOnPad(page: Page, n: number): Promise<void> {
  const pad = page.locator('.bottom-sheet .numpad');
  if (n < 0) await pad.getByRole('button', { name: 'Plus or minus' }).click();
  for (const d of String(Math.abs(n))) await pad.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
  await pad.locator('.numpad-ok').click();
}

/** The faces on the MAIN felt: every card in the table screen but the other table's. */
async function mainFeltCards(page: Page): Promise<string[]> {
  return page
    .locator('.table-screen .card[data-card]')
    .evaluateAll((els) => els.filter((el) => !el.closest('.other-table')).map((el) => el.getAttribute('data-card')!));
}

async function setUp(page: Page, difficulty: 'Normal' | 'Expert'): Promise<void> {
  await openTable(page);
  const sheet = await openGear(page);
  await toggle(sheet, 'Count checks').check();
  await toggle(sheet, 'Distractions').check();
  const opts = sheet.getByTestId('play-distraction-options');
  // The Kind sits first under the switch, Sums by default.
  await expect(opts.locator('.settings-label').first()).toHaveText('Kind');
  await expect(opts.getByRole('button', { name: 'Sums', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await opts.getByRole('button', { name: 'Other table', exact: true }).click();
  await expect(opts.getByRole('button', { name: 'Other table', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByTestId('play-distraction-kind-note')).toHaveText('Another table to count, then back to yours.');
  await opts.getByRole('button', { name: 'Often', exact: true }).click();
  const difficultyRow = opts.locator('.settings-row', { has: page.locator('.settings-label', { hasText: /^Difficulty$/ }) });
  await difficultyRow.getByRole('button', { name: difficulty, exact: true }).click();
  await expect(difficultyRow.getByRole('button', { name: difficulty, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByTestId('play-distraction-difficulty-note')).toHaveText(
    difficulty === 'Normal' ? 'Another table: 6 players, 2 cards each.' : 'Another table, with hits, shown for 5 seconds.',
  );
  // Three Kind options still fit the 375px sheet: nothing scrolls sideways.
  const overflow = await opts.evaluate((el) => [...el.querySelectorAll('.segmented')].map((s) => s.scrollWidth - s.clientWidth));
  expect(overflow.every((d) => d <= 0), String(overflow)).toBe(true);
  await page.keyboard.press('Escape');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1')!));
  expect(settings.playDistractionType).toBe('table');
}

interface Seen {
  answer: number;
  typed: number;
  verdict: string;
  correct: string | null;
  seats: number[];
}

/**
 * Deal and play until `want` other tables have been answered. Each is read
 * off its cards and answered by `answerOf` (given the right count); every
 * count check gets the main count worked out from the felt, and must be right.
 */
async function playUntilTables(
  page: Page,
  want: number,
  answerOf: (right: number, index: number) => number,
  onTable?: (table: Locator) => Promise<string[]>,
): Promise<{ seen: Seen[]; checks: number }> {
  const seen: Seen[] = [];
  let rc = 0;
  let checks = 0;
  for (let round = 0; round < 30 && seen.length < want; round++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    // Sums never show with Kind = Other table.
    await expect(page.getByTestId('play-distraction-prompt')).toHaveCount(0);
    const table = page.getByTestId('play-other-table');
    if (await table.isVisible()) {
      await expect(page.locator('.bottom-sheet-title')).toHaveText("What's the count at this table?");
      const feltBefore = await mainFeltCards(page);
      const faces = onTable ? await onTable(table) : await table.locator('[data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')!));
      const seats = await table.getByTestId('other-table-seat').evaluateAll((els) => els.map((e) => e.querySelectorAll('.card').length));
      const right = faces.reduce((n, c) => n + hiLo(c), 0);
      const typed = answerOf(right, seen.length);
      // The other table's cards are not on the main felt.
      expect(await mainFeltCards(page)).toEqual(feltBefore);
      await typeOnPad(page, typed);
      await expect(table).toHaveCount(0);
      // Count checks are on, so the MAIN running count is asked straight after,
      // the other table's verdict above it.
      const check = page.locator('.bottom-sheet', { hasText: 'Running count?' });
      await expect(check).toBeVisible();
      const verdict = check.getByTestId('play-distraction-verdict');
      seen.push({ answer: right, typed, verdict: await verdict.innerText(), correct: await verdict.getAttribute('data-correct'), seats });
    }
    if (await page.locator('.bottom-sheet', { hasText: 'Running count?' }).isVisible()) {
      checks++;
      await typeOnPad(page, rc);
      // Graded right: no held deal, and the strip says so.
      await expect(page.getByTestId('count-held-deal')).toHaveCount(0);
      await expect(page.locator('.message-strip')).toContainText('Count ✓');
    }
    await playRoundByAdvice(page);
    rc += (await mainFeltCards(page)).reduce((n, c) => n + hiLo(c), 0);
  }
  return { seen, checks };
}

test('Kind = Other table: a 6-seat table to count, graded right and wrong, and the main count check is untouched', async ({ page }) => {
  test.setTimeout(120_000);
  await setUp(page, 'Normal');
  // The first answered one off by one (wrong), the second right.
  const { seen, checks } = await playUntilTables(page, 2, (right, i) => (i === 0 ? right + 1 : right));
  expect(seen, JSON.stringify(seen)).toHaveLength(2);
  expect(checks).toBeGreaterThanOrEqual(2);
  const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  for (const s of seen) expect(s.seats).toEqual([2, 2, 2, 2, 2, 2]);
  expect(seen[0]!.correct).toBe('false');
  expect(seen[0]!.verdict).toBe(`Other table ✗ count = ${sign(seen[0]!.answer)}`);
  expect(seen[1]!.correct).toBe('true');
  expect(seen[1]!.verdict).toBe(`Other table ✓ count = ${sign(seen[1]!.answer)}`);

  // Recorded as Play's, of the table kind, the main count kept both times.
  const stats = (await readStats(page)) as { distraction: { history: Record<string, unknown>[] } };
  const rows = stats.distraction.history.slice(-2);
  expect(rows.map((r) => [r.kind, r.source, r.answerCorrect, r.countKept])).toEqual([
    ['other-table', 'play', false, true],
    ['other-table', 'play', true, true],
  ]);
});

test('Expert: the table turns face down after about 5 seconds, and is answered from memory', async ({ page }) => {
  test.setTimeout(120_000);
  await setUp(page, 'Expert');
  const { seen } = await playUntilTables(
    page,
    1,
    (right) => right,
    async (table) => {
      const faces = await table.locator('[data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')!));
      await expect(table.getByTestId('other-table-hide-note')).toHaveText('Turns over in 5 seconds.');
      await expect(table).toHaveAttribute('data-hidden', 'false');
      const shownAt = Date.now();
      await expect(table).toHaveAttribute('data-hidden', 'true', { timeout: 8000 });
      const shownFor = Date.now() - shownAt;
      expect(shownFor).toBeGreaterThan(3000);
      // Every card is face down now, none readable, the same number of them.
      await expect(table.locator('[data-card]')).toHaveCount(0);
      await expect(table.locator('.card-back')).toHaveCount(faces.length);
      await expect(table.getByTestId('other-table-hide-note')).toHaveText('Turned over: answer from memory.');
      return faces;
    },
  );
  expect(seen, JSON.stringify(seen)).toHaveLength(1);
  expect(seen[0]!.correct).toBe('true');
  expect(seen[0]!.seats).toHaveLength(6);
  expect(seen[0]!.seats.some((n) => n > 2)).toBe(true);
});
