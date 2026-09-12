import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * V5-5 (docs/BACKLOG.md): how finely the discard tray is read is a setting, and
 * it reaches BOTH the Deck Estimation grid/tolerance and the produce-TC band.
 *
 * The policy is unit-tested to death in drills/depthResolution.test.ts. What
 * only a browser can check is the threading: every consumer defaults to half a
 * deck, so a view that never reads `settings.drill.depthResolution` compiles,
 * passes every unit test, and leaves the whole feature inert. That is the same
 * failure V4-3 and V5-1 both shipped with once, so every assertion here uses a
 * NON-default resolution and a verdict that has to change.
 */

/**
 * Freeze the drills' `randomSeed()` so a question is identical run to run.
 *
 * The constant is not arbitrary and must not be "tidied": `randomSeed()` runs
 * the value through `mulberry32`, so what the drill sees is nothing like the
 * value pinned here. This one puts a 1-deck Deck Estimation question at 0.6731
 * decks remaining -- 0.33 away from the 1.0 button, which is inside a half-deck
 * tolerance and outside a quarter-deck one, which is the whole point of the
 * test below. Changing it silently turns that test into a coin flip.
 */
const PINNED = 0.00009;

/**
 * A second pin, for the produce-TC drill, chosen the same way and just as load
 * bearing: it puts that drill's round at running count +5 with 1.5 decks left,
 * where a half-deck read accepts +2..+5 and a quarter-deck read accepts +2..+4.
 * Answering +5 is therefore right under one resolution and wrong under the
 * other -- which is the only assertion that can tell a grader that reads the
 * setting from one that merely prints it.
 */
const PINNED_PRODUCE = 0.000023;

async function pinRandom(page: Page, value = PINNED): Promise<void> {
  await page.addInitScript((v) => {
    Math.random = () => v;
  }, value);
}

async function openDrill(page: Page, name: string): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

function gridLabels(page: Page): Promise<string[]> {
  return page.locator('.deck-guess-btn').allInnerTexts();
}

test('the deck-estimation grid runs in halves by default', async ({ page }) => {
  await withProfile(page, { rules: { decks: 2 } });
  await openDrill(page, 'Deck Estimation');
  await expect(page.locator('.count-setup')).toBeVisible();
  // The control is there and starts where the app has always been.
  const row = page.locator('.settings-row', { hasText: 'Resolution' });
  await expect(row.locator('.segmented-btn-active')).toHaveText('Half');

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  expect(await gridLabels(page)).toEqual(['0.5', '1.0', '1.5', '2.0']);
});

test('choosing last-deck adds the quarter steps -- but only inside the last deck', async ({
  page,
}) => {
  await withProfile(page, { rules: { decks: 2 } });
  await openDrill(page, 'Deck Estimation');
  await page.getByRole('button', { name: 'Last deck', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // 1.25 is a quarter step that sits OUTSIDE the last deck, and must not appear
  // -- otherwise this is just a quarter grid wearing a different label.
  expect(await gridLabels(page)).toEqual(['0.25', '0.5', '0.75', '1.0', '1.5', '2.0']);
});

test('choosing quarter runs in quarters throughout', async ({ page }) => {
  await withProfile(page, { rules: { decks: 2 } });
  await openDrill(page, 'Deck Estimation');
  await page.getByRole('button', { name: 'Quarter', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  expect(await gridLabels(page)).toEqual([
    '0.25',
    '0.5',
    '0.75',
    '1.0',
    '1.25',
    '1.5',
    '1.75',
    '2.0',
  ]);
});

test('the drill-local control persists, so it is the same setting Settings edits', async ({
  page,
}) => {
  // `onSettingsChange` is App's React state only -- a control that forgets the
  // explicit saveSettings looks correct until the next reload.
  await withProfile(page, { rules: { decks: 2 } });
  await openDrill(page, 'Deck Estimation');
  await page.getByRole('button', { name: 'Quarter', exact: true }).click();

  const stored = await page.evaluate(() => {
    const raw = window.localStorage.getItem('bjtrainer.settings.v1');
    return raw ? (JSON.parse(raw) as { drill?: { depthResolution?: string } }) : null;
  });
  expect(stored?.drill?.depthResolution).toBe('quarter');

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const row = page.locator('.settings-row', { hasText: 'Depth resolution' });
  await expect(row.locator('.segmented-btn-active')).toHaveText('Quarter');
});

test('the same estimate is right at half resolution and wrong at last-deck', async ({ page }) => {
  // The verdict itself, which is the only thing that proves the tolerance moved
  // rather than just the buttons. With Math.random pinned, a 1-deck shoe always
  // asks the same question: 0.6731 decks remaining. Guessing 1 deck is 0.33 out
  // -- inside a half-deck tolerance, outside a quarter-deck one.
  await pinRandom(page);
  await withProfile(page, { rules: { decks: 1 } });

  await openDrill(page, 'Deck Estimation');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.locator('.deck-guess-btn', { hasText: /^1\.0$/ }).click();
  await expect(page.locator('.result-correct')).toBeVisible();
  await expect(page.locator('.drill-result')).toContainText('Anything within half a deck counts');

  // Same question, same answer, tighter rule. "Back to Drills" lands on the
  // picker, not this drill's setup, so the drill has to be re-entered.
  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deck Estimation', exact: true }).click();
  await page.getByRole('button', { name: 'Last deck', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.locator('.deck-guess-btn', { hasText: /^1\.0$/ }).click();
  await expect(page.locator('.result-wrong')).toBeVisible();
  await expect(page.locator('.drill-result')).toContainText(
    'Anything within a quarter deck counts',
  );
  await expect(page.locator('.drill-result')).toContainText('you were inside the last deck');
});

test('the grade records the tolerance it was given, not a constant', async ({ page }) => {
  // V5-2's lesson applied here: a stored `correct` whose rule changed is not the
  // same measurement, so the rule is stored beside it.
  await pinRandom(page);
  await withProfile(page, { rules: { decks: 1 } });
  await withSettings(page, { drill: { depthResolution: 'last-deck' } });

  await openDrill(page, 'Deck Estimation');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.locator('.deck-guess-btn', { hasText: /^0\.5$/ }).click();
  await expect(page.locator('.result-correct')).toBeVisible();

  const rows = await page.evaluate(() => {
    const raw = window.localStorage.getItem('bjtrainer.stats.v1');
    const blob = raw ? (JSON.parse(raw) as { deckEstimation?: { history?: unknown[] } }) : null;
    return (blob?.deckEstimation?.history ?? []) as { toleranceDecks?: number }[];
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.toleranceDecks).toBe(0.25);
});

test('the produce-TC band tightens with the resolution too', async ({ browser }) => {
  // The other consumer, and the one most likely to be forgotten: it has no
  // setup screen of its own, so it reads a setting configured somewhere else.
  // A fresh page per run rather than reusing one, so the two runs cannot share
  // accumulated init scripts -- same pinned round both times, only the
  // resolution differs.
  const runOnce = async (depthResolution: string) => {
    const page = await browser.newPage();
    await pinRandom(page, PINNED_PRODUCE);
    await withProfile(page, { rules: { decks: 6 } });
    await withSettings(page, {
      drill: { countLengthCards: 13, countIntervalMs: 10, countGroup: 1, depthResolution },
    });
    await openDrill(page, 'Produce the True Count');
    await expect(page.locator('.numpad')).toBeVisible();
    // +5 is the top of the half-deck band and one above the quarter-deck one.
    await page.getByRole('button', { name: '5', exact: true }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    const text = await page.locator('.drill-result .result-detail').first().innerText();
    const correct = await page.locator('.result-correct').count();
    await page.close();
    return { text, correct: correct > 0 };
  };

  const half = await runOnce('half');
  const quarter = await runOnce('quarter');

  // Control: the band sentence only renders when the band spans more than one
  // integer, so a round that collapsed it would make everything below vacuous.
  expect(half.text, 'the band collapsed; this round cannot discriminate').toContain('either way');
  expect(half.text).toContain('half a deck either way');
  expect(quarter.text).toContain('a quarter deck either way');
  expect(quarter.text, 'identical copy: the setting never reached this drill').not.toEqual(
    half.text,
  );

  // And the VERDICT moved, not just the sentence. Without this a grader that
  // still runs on a hardcoded half deck passes everything above -- the copy
  // narrows while the grade does not, which is the worse of the two bugs.
  expect(half.correct, 'the round changed: +5 should be inside the half-deck band').toBe(true);
  expect(quarter.correct, 'the grade ignored the resolution; only the copy moved').toBe(false);
});

test('a quarter-deck answer can be typed, not just tapped', async ({ page }) => {
  // The keyboard path builds its own options list, so it can go stale on its
  // own: a grid that offers 0.75 and a keyboard that refuses to submit it is a
  // silent half of the feature.
  await pinRandom(page);
  await withProfile(page, { rules: { decks: 1 } });
  await withSettings(page, { drill: { depthResolution: 'quarter' } });

  await openDrill(page, 'Deck Estimation');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.keyboard.type('0.75');
  await expect(page.locator('.deck-typed-display')).toContainText('0.75');
  // The grid highlights it, which means the typed value resolved to a real
  // option rather than to the mid-entry null.
  await expect(page.locator('.deck-guess-btn-typed')).toHaveText('0.75');
  await page.keyboard.press('Enter');
  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.drill-result')).toContainText('You guessed 0.75 decks');
});
