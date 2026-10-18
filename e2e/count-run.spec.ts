import { test, expect, type Page } from '@playwright/test';
import { withSettings, openCountOptions, submitZero } from './helpers';

/**
 * Wave E E5 (W2-8): the count drill's result shows the dealt run under a
 * closed "Show the run" disclosure -- every card with its Hi-Lo tag and the
 * running count after it, each checkpoint pinned to its row -- and has one way
 * out, the top bar's Back.
 */

const SHOTS =
  'C:/Users/jackp/AppData/Local/Temp/claude/C--Users-jackp/5eb9dd98-f8da-490b-a046-a394be7c9a16/scratchpad/waveE/b-shots';
const PHONE = { width: 375, height: 812 };
/**
 * The 13 mini's insets. The top one is read through `--safe-top`; the drill's
 * primary bar takes the bottom one from `env(safe-area-inset-bottom)` directly,
 * which a desktop browser reports as 0, so its padding is set to what that env
 * value gives on the phone.
 */
const NOTCH = `
  :root { --safe-top: 47px; --safe-bottom: 34px; }
  .drill-primary-bar { padding-bottom: calc(0.75rem + 34px) !important; }
`;

/** Math.random pinned: Start always deals the same shoe. */
async function pinShoe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0.4242;
  });
}

async function openCountDrill(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await openCountOptions(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

const parseSigned = (s: string) => Number(s.trim().replace('−', '-').replace('+', ''));
const SIGNED = '([+−-]?\\d+)';

async function shownActual(page: Page): Promise<number> {
  const detail = await page.locator('.result-detail').innerText();
  const m = new RegExp(`running count was ${SIGNED}`).exec(detail);
  expect(m, `unparsed result detail: ${detail}`).not.toBeNull();
  return parseSigned(m![1]!);
}

async function openRun(page: Page): Promise<void> {
  const run = page.getByTestId('count-run');
  await expect(run).not.toHaveAttribute('open', '');
  await expect(page.locator('.count-run-row').first()).toBeHidden();
  await run.locator('summary').click();
  await expect(run).toHaveAttribute('open', '');
}

/** Tap the manual-advance zone until `until` holds, or the taps run out. */
async function advanceUntil(page: Page, until: () => Promise<boolean>, maxTaps: number): Promise<boolean> {
  for (let i = 0; i < maxTaps; i++) {
    if (await until()) return true;
    await page.locator('.manual-tap-zone').click();
  }
  return until();
}

/** Type `n` (non-negative) on the keypad on screen and submit it. */
async function enterNumber(page: Page, n: number): Promise<void> {
  const pad = page.locator('.numpad');
  for (const d of String(n)) await pad.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
  await pad.locator('.numpad-ok').click();
}

test('E5: a 52-card paced run lists 52 rows whose tags sum to the shown count; one Back', async ({ page }) => {
  await pinShoe(page);
  await withSettings(page, { drill: { countLengthCards: 52, countGroup: 1, countIntervalMs: 50, countManual: false } });
  await openCountDrill(page);
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 20_000 });
  await submitZero(page);
  await expect(page.locator('.drill-result')).toBeVisible();
  const actual = await shownActual(page);

  await openRun(page);
  const rows = page.locator('.count-run-row');
  await expect(rows).toHaveCount(52);
  const tags = (await page.locator('.count-run-tag').allInnerTexts()).map(parseSigned);
  const totals = (await page.locator('.count-run-total').allInnerTexts()).map(parseSigned);
  expect(tags).toHaveLength(52);
  for (const t of tags) expect([-1, 0, 1]).toContain(t);
  expect(tags.reduce((s, t) => s + t, 0)).toBe(actual);
  expect(totals.at(-1)).toBe(actual);
  // Each running total is the one before plus the row's own tag.
  totals.forEach((t, i) => expect(t).toBe((i === 0 ? 0 : totals[i - 1]!) + tags[i]!));
  // Vacuity: the shoe is not one where every count is zero.
  expect(tags.some((t) => t !== 0)).toBe(true);
  // Each row is one card, as the card face prints it.
  for (const c of await page.locator('.count-run-cards').allInnerTexts()) expect(c).toMatch(/^(10|[2-9AJQK])[♠♥♦♣]$/);
  // A real minus sign, never the ASCII hyphen.
  expect((await page.getByTestId('count-run').innerText()).includes('-')).toBe(false);

  // One way out.
  await expect(page.getByRole('button', { name: /back/i })).toHaveCount(1);
  await expect(page.getByRole('link', { name: /back/i })).toHaveCount(0);
  await expect(page.locator('.drill-primary-bar .drill-secondary-btn')).toHaveCount(0);
  await page.getByRole('button', { name: /back/i }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();
});

test('E5: each checkpoint is marked on the row it was asked after, with what was said', async ({ page }) => {
  await pinShoe(page);
  await withSettings(page, {
    drill: { countLengthCards: 12, countGroup: 1, countManual: true, countCheckpoints: 'few' },
  });
  await openCountDrill(page);

  const said = [7, 2];
  for (const n of said) {
    const reached = await advanceUntil(page, () => page.locator('.checkpoint-area').isVisible(), 14);
    expect(reached, 'expected the run to stop at a checkpoint').toBe(true);
    await enterNumber(page, n);
  }
  await advanceUntil(page, () => page.locator('.numpad').isVisible(), 14);
  await submitZero(page);
  await expect(page.locator('.drill-result')).toBeVisible();

  // Where the checkpoints were asked, as the checkpoint read-back states it:
  // "Cards 1–4: …" ends at card 4.
  const stops = (await page.locator('.checkpoint-result-list li').allInnerTexts()).map((t) =>
    Number(/^Cards? (?:\d+–)?(\d+):/.exec(t)?.[1]),
  );
  expect(stops).toHaveLength(2);
  for (const s of stops) expect(Number.isInteger(s)).toBe(true);

  await openRun(page);
  await expect(page.locator('.count-run-row')).toHaveCount(12);
  const marked = page.locator('.count-run-row:has(.count-run-cp)');
  await expect(marked).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const row = page.locator(`.count-run-row[data-row="${stops[i]}"]`);
    const cp = row.locator('.count-run-cp');
    await expect(cp, `no checkpoint marker on row ${stops[i]}`).toHaveCount(1);
    await expect(cp).toHaveAttribute('data-said', String(said[i]));
    const total = parseSigned(await row.locator('.count-run-total').innerText());
    await expect(cp).toHaveAttribute('data-was', String(total));
    await expect(cp).toContainText(`you said +${said[i]}`);
  }
  // The first stop is graded absolutely, so the read-back's "it was" is the
  // same count the run listing has on that row.
  const first = await page.locator('.checkpoint-result-list li').first().innerText();
  const was = parseSigned(new RegExp(`it was ${SIGNED}`).exec(first)?.[1] ?? 'NaN');
  await expect(page.locator(`.count-run-row[data-row="${stops[0]}"] .count-run-cp`)).toHaveAttribute('data-was', String(was));
});

test('E5: a table run lists one row per round, and its tags still sum to the count', async ({ page }) => {
  await pinShoe(page);
  await withSettings(page, {
    drill: { countManual: true, countTableMode: true, countTableRounds: 5, countLengthCards: 52 },
  });
  await page.setViewportSize(PHONE);
  await openCountDrill(page);
  await advanceUntil(page, () => page.locator('.numpad').isVisible(), 8);
  await submitZero(page);
  const actual = await shownActual(page);
  await page.addStyleTag({ content: NOTCH });
  await openRun(page);
  await expect(page.locator('.count-run-row')).toHaveCount(5);
  const tags = (await page.locator('.count-run-tag').allInnerTexts()).map(parseSigned);
  expect(tags.reduce((s, t) => s + t, 0)).toBe(actual);
  expect(parseSigned((await page.locator('.count-run-total').allInnerTexts()).at(-1)!)).toBe(actual);
  await expect(page.locator('.count-run-head')).toContainText('Cards');
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/e5-table-run-open.png` });
});

/** Every box inside the visible area between the insets, and no sideways scroll. */
async function expectNewRunOnScreen(page: Page, label: string): Promise<void> {
  const m = await page.evaluate(() => {
    const btn = [...document.querySelectorAll<HTMLElement>('.drill-primary-bar .drill-primary-btn')].find(
      (b) => b.innerText.trim() === 'New run',
    );
    const r = btn?.getBoundingClientRect();
    return {
      found: Boolean(btn),
      top: r?.top ?? -1,
      bottom: r?.bottom ?? 9999,
      right: r?.right ?? 9999,
      innerH: window.innerHeight,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(m.found, `${label}: New run is not rendered`).toBe(true);
  expect(m.top, `${label}: New run under the status bar`).toBeGreaterThanOrEqual(47);
  // Above the home indicator: the bar's own padding holds the 34px inset.
  expect(m.bottom, `${label}: New run ends at ${m.bottom}`).toBeLessThanOrEqual(m.innerH - 34);
  expect(m.right, `${label}: New run runs off the right edge`).toBeLessThanOrEqual(PHONE.width);
  expect(m.sideways, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(0);
}

test('E5: at 375x812 with the notch, New run is on screen with the run closed and open', async ({ page }) => {
  await pinShoe(page);
  await page.setViewportSize(PHONE);
  await withSettings(page, {
    drill: { countLengthCards: 52, countGroup: 1, countIntervalMs: 50, countManual: false, countCheckpoints: 'one' },
  });
  await openCountDrill(page);
  await page.addStyleTag({ content: NOTCH });
  await expect(page.locator('.checkpoint-area')).toBeVisible({ timeout: 20_000 });
  await enterNumber(page, 3);
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 20_000 });
  await submitZero(page);
  await expect(page.locator('.drill-result')).toBeVisible();

  await expectNewRunOnScreen(page, 'closed');
  await page.screenshot({ path: `${SHOTS}/e5-result-closed.png` });

  await openRun(page);
  await expect(page.locator('.count-run-row')).toHaveCount(52);
  await expectNewRunOnScreen(page, 'open');
  await page.screenshot({ path: `${SHOTS}/e5-result-open.png` });

  // The verdict at the top of the result is still reachable with the list open
  // (a centred column that overflows would cut it off above the scroll).
  await page.evaluate(() => window.scrollTo(0, 0));
  const verdictTop = await page.locator('.drill-result .result-correct, .drill-result .result-wrong').evaluate(
    (el) => el.getBoundingClientRect().top,
  );
  expect(verdictTop).toBeGreaterThanOrEqual(47);

  // Scrolled to the marked checkpoint, then to the end of the list.
  await page.locator('.count-run-cp').scrollIntoViewIfNeeded();
  await expectNewRunOnScreen(page, 'open, at the checkpoint');
  await page.screenshot({ path: `${SHOTS}/e5-result-open-checkpoint.png` });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expectNewRunOnScreen(page, 'open, scrolled to the end');
  await page.screenshot({ path: `${SHOTS}/e5-result-open-end.png` });
  // The last row clears the bar rather than sitting under it.
  const last = await page.locator('.count-run-row').last().evaluate((el) => el.getBoundingClientRect().bottom);
  const barTop = await page.locator('.drill-primary-bar').evaluate((el) => el.getBoundingClientRect().top);
  expect(last).toBeLessThanOrEqual(barTop + 0.5);
});
