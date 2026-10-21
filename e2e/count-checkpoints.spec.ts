import { test, expect, type Page } from '@playwright/test';
import { withSettings, shot, openCountOptions, submitZero } from './helpers';

/**
 * RT#12 (docs/BACKLOG.md): the count drill graded ONE number at the end, so a
 * +1 slip and a -1 slip in the same run scored as a perfect count, and a wrong
 * run could not say where the count was lost.
 *
 * A checkpoint stops the flash mid-run, asks for the count so far, and says
 * NOTHING about it until the run is over — telling you there would hand back a
 * corrected count and destroy the rest of the measurement.
 */

const SHORT_RUN = {
  countLengthCards: 10,
  countGroup: 1 as const,
  countManual: true,
};

async function openCountDrill(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await openCountOptions(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

/** Tap the manual-advance zone until `until` holds, or the taps run out. */
async function advanceUntil(page: Page, until: () => Promise<boolean>, maxTaps: number) {
  for (let i = 0; i < maxTaps; i++) {
    if (await until()) return true;
    await page.locator('.manual-tap-zone').click();
  }
  return until();
}

const checkpointArea = (page: Page) => page.locator('.checkpoint-area');

/**
 * Wave A (s04): the read-back and the result print signed numbers with a real
 * minus sign ("+2", "−2", "0"). Parse either sign, and format the same way.
 */
const SIGNED = '([+−-]?\\d+)';
const parseSigned = (s: string | undefined) => Number((s ?? '').replace('−', '-').replace('+', ''));
const fmt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
/** The true running count from the result line. */
const finalCount = (detail: string) => parseSigned(new RegExp(`running count was ${SIGNED}`).exec(detail)?.[1]);
/** A first-stop row: "Cards 1–6: right. You said 0; it was +2." */
const readRow = (text: string) => ({
  said: parseSigned(new RegExp(`You said ${SIGNED}`).exec(text)?.[1]),
  was: parseSigned(new RegExp(`it was ${SIGNED}`).exec(text)?.[1]),
  after: Number(/^Cards? (?:\d+–)?(\d+):/.exec(text)?.[1]),
});
const ok = (page: Page) => page.getByRole('button', { name: 'OK', exact: true });

/** Type `n` (0-99, no sign) into whichever NumPad is on screen and submit. */
async function enterNumber(page: Page, n: number) {
  for (const d of String(n).split('')) {
    await page.getByRole('button', { name: d, exact: true }).click();
  }
  await ok(page).click();
}

/** As `enterNumber`, but handles a negative count via the NumPad's minus key. */
async function enterSignedNumber(page: Page, n: number) {
  for (const d of String(Math.abs(n)).split('')) {
    await page.getByRole('button', { name: d, exact: true }).click();
  }
  if (n < 0) await page.getByRole('button', { name: 'Plus or minus', exact: true }).click();
  await ok(page).click();
}

test('a run stops mid-count and asks for the count so far', async ({ page }) => {
  await withSettings(page, { drill: { ...SHORT_RUN, countCheckpoints: 'one' } });
  await openCountDrill(page);

  const reached = await advanceUntil(page, () => checkpointArea(page).isVisible(), 12);
  expect(reached, 'expected the run to stop at a checkpoint').toBe(true);
  await expect(page.locator('.checkpoint-prompt')).toHaveText(/Running count so far/);
});

test('the checkpoint says nothing about the answer — feedback would reset the count', async ({
  page,
}) => {
  await withSettings(page, { drill: { ...SHORT_RUN, countCheckpoints: 'one' } });
  await openCountDrill(page);
  await advanceUntil(page, () => checkpointArea(page).isVisible(), 12);

  // Answered deliberately, absurdly wrong: 99 is unreachable over ten cards.
  await enterNumber(page, 99);

  // Back to counting, with no verdict of any kind on the screen. The tap zone
  // is the positive; the verdicts are then read once, not retried -- a
  // verdict that flashed up and timed out would satisfy a retrying count(0).
  await expect(page.locator('.manual-tap-zone')).toBeVisible();
  await expect(checkpointArea(page)).toHaveCount(0);
  expect(await page.locator('.checkpoint-result').count()).toBe(0);
  expect(await page.locator('.result-correct, .result-wrong').count()).toBe(0);
});

/**
 * Pin the drill's shoe. `randomSeed()` is `Math.random()`-derived, so a
 * constant makes Start and Replay deal the SAME cards -- which is what lets
 * this test learn the true final count on one run and then reproduce that run
 * while answering a checkpoint wrong.
 */
async function pinShoe(page: Page) {
  await page.addInitScript(() => {
    Math.random = () => 0.4242;
  });
}

test('RT#12: a wrong checkpoint under a RIGHT final count is called out as errors that cancelled', async ({
  page,
}) => {
  await pinShoe(page);
  await withSettings(page, { drill: { ...SHORT_RUN, countCheckpoints: 'one' } });
  await openCountDrill(page);

  // Pass one: learn what this shoe's final count actually is.
  await advanceUntil(page, () => checkpointArea(page).isVisible(), 12);
  await submitZero(page);
  await advanceUntil(page, () => ok(page).isVisible(), 12);
  await submitZero(page);
  const detail = await page.locator('.result-detail').innerText();
  const actual = finalCount(detail);
  expect(Number.isFinite(actual), `unparsed result detail: ${detail}`).toBe(true);

  // Pass two, same shoe: drift at the checkpoint, then land the final count.
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await advanceUntil(page, () => checkpointArea(page).isVisible(), 12);
  await enterNumber(page, 99);
  await advanceUntil(page, () => ok(page).isVisible(), 12);
  await enterSignedNumber(page, actual);

  // The final count is right...
  await expect(page.locator('.result-correct')).toBeVisible();
  // ...and the run was still not clean. This exact run is what the old
  // final-count-only grading reported as perfect.
  await expect(page.locator('.checkpoint-result-score')).toHaveText('Checkpoints: 0/1');
  await expect(page.locator('.checkpoint-result-cancelled')).toBeVisible();
  await expect(page.locator('.checkpoint-result-segment')).toContainText('between cards 1 and');
});

test('a wrong final count is not called a cancellation -- it is just wrong', async ({ page }) => {
  await pinShoe(page);
  await withSettings(page, { drill: { ...SHORT_RUN, countCheckpoints: 'one' } });
  await openCountDrill(page);

  await advanceUntil(page, () => checkpointArea(page).isVisible(), 12);
  await enterNumber(page, 99);
  await advanceUntil(page, () => ok(page).isVisible(), 12);
  await enterNumber(page, 98); // unreachable over ten cards, so certainly wrong

  await expect(page.locator('.result-wrong')).toBeVisible();
  await expect(page.locator('.checkpoint-result-score')).toHaveText('Checkpoints: 0/1');
  await expect(page.locator('.checkpoint-result-cancelled')).toHaveCount(0);
  // Still localized, though -- that half is useful precisely when the run failed.
  await expect(page.locator('.checkpoint-result-segment')).toBeVisible();
});

// Wave A (s04): the row now leads with a stretch verdict; the first stop still
// states both numbers, and the words must agree with the colour.
test('the read-back states both numbers, and its colour agrees with them', async ({ page }) => {
  await withSettings(page, { drill: { ...SHORT_RUN, countCheckpoints: 'one' } });
  await openCountDrill(page);
  await advanceUntil(page, () => checkpointArea(page).isVisible(), 12);
  await submitZero(page); // 0

  await advanceUntil(page, () => ok(page).isVisible(), 12);
  await submitZero(page);

  const row = page.locator('.checkpoint-result-list li');
  await expect(row).toHaveCount(1);
  const text = await row.innerText();
  const { said, was, after } = readRow(text);
  expect(said).toBe(0);
  // Vacuity guards: a blank or unparsed row would satisfy a laxer assertion.
  expect(Number.isFinite(was), `unparsed read-back: ${text}`).toBe(true);
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(10); // never the last card — that is the final answer

  // A green row over a mismatch would be worse than no row at all.
  expect(await row.getAttribute('class')).toBe(said === was ? 'checkpoint-hit' : 'checkpoint-miss');
  // And the words say the same as the colour.
  expect(text).toContain(said === was ? ': right.' : `: off by ${fmt(said - was)}.`);
  await expect(page.locator('.checkpoint-result-segment')).toHaveCount(said === was ? 0 : 1);
});

test('two checkpoints are asked separately and both are read back', async ({ page }) => {
  await withSettings(page, { drill: { ...SHORT_RUN, countCheckpoints: 'few' } });
  await openCountDrill(page);

  for (let i = 0; i < 2; i++) {
    const reached = await advanceUntil(page, () => checkpointArea(page).isVisible(), 12);
    expect(reached, `expected checkpoint ${i + 1}`).toBe(true);
    await submitZero(page);
  }

  await advanceUntil(page, () => ok(page).isVisible(), 12);
  await submitZero(page);

  await expect(page.locator('.checkpoint-result-list li')).toHaveCount(2);
  await expect(page.locator('.checkpoint-result-score')).toContainText('/2');
});

test('checkpoints are off by default, and the run is never interrupted', async ({ page }) => {
  await withSettings(page, { drill: SHORT_RUN });
  await openCountDrill(page);

  for (let i = 0; i < 10; i++) {
    await expect(checkpointArea(page)).toHaveCount(0);
    if (await ok(page).isVisible()) break;
    await page.locator('.manual-tap-zone').click();
  }
  await submitZero(page);
  await expect(page.locator('.result-detail')).toBeVisible();
  await expect(page.locator('.checkpoint-result')).toHaveCount(0);
});

/**
 * An INDEPENDENT oracle for the checkpoint's answer.
 *
 * Every other test here takes the drill's word for what the count was. This
 * one reads the ranks off the cards as they flash and does the Hi-Lo
 * arithmetic itself, so a checkpoint that recorded the wrong number -- or
 * counted the wrong cards as shown -- fails here rather than agreeing with
 * itself.
 *
 * It searches pinned shoes for one whose count at the checkpoint is NOT zero.
 * Without that, a shoe that happens to sit at zero there makes this test agree
 * with a checkpoint that recorded nothing at all -- which is exactly what a
 * mutation run caught it doing.
 */
test('the checkpoint is graded against the cards actually shown', async ({ page }) => {
  const hiLo = (rank: string) =>
    ['2', '3', '4', '5', '6'].includes(rank) ? 1 : ['10', 'J', 'Q', 'K', 'A'].includes(rank) ? -1 : 0;

  let found: { seen: number; count: number } | null = null;
  for (const pin of [0.11, 0.29, 0.43, 0.61, 0.79, 0.93]) {
    await page.addInitScript((p) => {
      Math.random = () => p;
    }, pin);
    await withSettings(page, { drill: { ...SHORT_RUN, countCheckpoints: 'one' } });
    await openCountDrill(page);

    let seen = 0;
    let count = 0;
    for (let i = 0; i < 12 && !(await checkpointArea(page).isVisible()); i++) {
      const ranks = await page
        .locator('.count-flash-cards .card')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.card ?? ''));
      for (const c of ranks) {
        count += hiLo(c.slice(0, -1));
        seen += 1;
      }
      await page.locator('.manual-tap-zone').click();
    }
    await expect(checkpointArea(page)).toBeVisible();
    expect(seen, 'expected cards to have flashed before the checkpoint').toBeGreaterThan(0);
    if (count === 0) continue; // a zero here would not discriminate

    found = { seen, count };
    await submitZero(page); // 0, whatever the truth is
    await advanceUntil(page, () => ok(page).isVisible(), 12);
    await submitZero(page);
    break;
  }

  expect(found, 'no pinned shoe produced a non-zero count at its checkpoint').not.toBeNull();
  const text = await page.locator('.checkpoint-result-list li').innerText();
  expect(readRow(text).after).toBe(found!.seen);
  expect(text).toContain(`it was ${fmt(found!.count)}`);
});

test('screenshots: the checkpoint prompt and its read-back', async ({ page }) => {
  await withSettings(page, { drill: { ...SHORT_RUN, countCheckpoints: 'one' } });
  await openCountDrill(page);
  await advanceUntil(page, () => checkpointArea(page).isVisible(), 12);
  await shot(page, 'count-checkpoint-prompt');

  await enterNumber(page, 99);
  await advanceUntil(page, () => ok(page).isVisible(), 12);
  await submitZero(page);
  await expect(page.locator('.checkpoint-result')).toBeVisible();
  await shot(page, 'count-checkpoint-result');
});

/**
 * #46: one early slip used to fail every later stop. Each stretch after the
 * first is now graded from the user's own previous answer, and says so; the
 * run's verdict stays absolute, and both are shown.
 */
test('#46: after an off-by-one checkpoint, a cleanly counted last stretch is graded right (adjusted)', async ({
  page,
}) => {
  await pinShoe(page);
  await withSettings(page, { drill: { ...SHORT_RUN, countCheckpoints: 'one' } });
  await openCountDrill(page);

  // Pass one: learn the true count at the checkpoint and at the end.
  await advanceUntil(page, () => checkpointArea(page).isVisible(), 12);
  await submitZero(page);
  await advanceUntil(page, () => ok(page).isVisible(), 12);
  await submitZero(page);
  const rowText = await page.locator('.checkpoint-result-list li').innerText();
  const { was: atCheckpoint, after: seen } = readRow(rowText);
  const final = finalCount(await page.locator('.result-detail').innerText());
  expect(Number.isFinite(atCheckpoint) && Number.isFinite(final) && seen > 0).toBe(true);

  // Pass two, same shoe: one high at the checkpoint, and the stretch after it
  // counted perfectly from there, so the final answer is one high as well.
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await advanceUntil(page, () => checkpointArea(page).isVisible(), 12);
  await enterSignedNumber(page, atCheckpoint + 1);
  await advanceUntil(page, () => ok(page).isVisible(), 12);
  await enterSignedNumber(page, final + 1);

  // Absolute verdict: wrong.
  await expect(page.locator('.result-wrong')).toBeVisible();
  // Adjusted last stretch: right, over the cards after the stop, and it says
  // why in the stretch's own terms (Wave A s04: no "graded from ... adjusted").
  const last = page.locator('.checkpoint-result-final');
  await expect(last).toHaveClass(/checkpoint-hit/);
  const cards = seen + 1 === 10 ? 'card 10' : `cards ${seen + 1}–10`;
  await expect(last).toContainText(`Last stretch (${cards}): right.`);
  const move = final - atCheckpoint;
  await expect(last).toContainText(
    move === 0 ? 'Your count stayed put, as the cards did.' : `Your count moved ${fmt(move)}, as the cards did.`,
  );
});

test('#46: a last stretch counted wrong is graded wrong, even when the final count is right', async ({
  page,
}) => {
  await pinShoe(page);
  await withSettings(page, { drill: { ...SHORT_RUN, countCheckpoints: 'one' } });
  await openCountDrill(page);
  await advanceUntil(page, () => checkpointArea(page).isVisible(), 12);
  await submitZero(page);
  await advanceUntil(page, () => ok(page).isVisible(), 12);
  await submitZero(page);
  const rowText = await page.locator('.checkpoint-result-list li').innerText();
  const { was: atCheckpoint } = readRow(rowText);
  const final = finalCount(await page.locator('.result-detail').innerText());

  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await advanceUntil(page, () => checkpointArea(page).isVisible(), 12);
  await enterSignedNumber(page, atCheckpoint + 2);
  await advanceUntil(page, () => ok(page).isVisible(), 12);
  await enterSignedNumber(page, final);

  await expect(page.locator('.result-correct')).toBeVisible();
  await expect(page.locator('.checkpoint-result-final')).toHaveClass(/checkpoint-miss/);
  // Two high at the stop, then the right final count: the stretch dropped 2.
  await expect(page.locator('.checkpoint-result-final')).toContainText(/Last stretch \(cards? [\d–]+\): off by −2\./);
});
