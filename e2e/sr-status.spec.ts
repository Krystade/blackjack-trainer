import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { withProfile, withSettings } from './helpers';
import { generateAllCells } from '../src/drills/flashcards';

/**
 * "I'd also like the ability to view the status of my spaced repetition
 * somehow visualized." (operator request, docs/superpowers/plans/
 * 2026-08-31-C-sr-visualization.md)
 *
 * No clock-injection hook exists (or is needed) here: every call site
 * threads a real Date.now() directly, and the existing suite already
 * manipulates the two SR-deck localStorage keys directly rather than
 * controlling wall-clock time in the browser (e2e/drills.spec.ts:437 etc.,
 * `localStorage.removeItem('bjtrainer.flashsr.v1'/'bjtrainer.quizsr.v1')`).
 * This file follows that precedent: seed a hand-built SrDeck via
 * `addInitScript` before the app's first script runs, so a card with
 * `dueAt` a day in the past is unambiguously "due" regardless of the exact
 * moment the test runs. Exact millisecond boundary correctness is the unit
 * tests' job (src/drills/srStatus.test.ts); this file only proves the
 * wiring reads and renders real deck contents correctly.
 */

interface SrCardSeed {
  box: number;
  dueAt: number;
  lastSeenAt: number;
  lapses: number;
  reviews: number;
}

function card(overrides: Partial<SrCardSeed> = {}): SrCardSeed {
  const now = Date.now();
  return { box: 0, dueAt: now - 24 * 60 * 60 * 1000, lastSeenAt: now - 48 * 60 * 60 * 1000, lapses: 0, reviews: 1, ...overrides };
}

async function seedSrDeck(
  page: Page,
  key: 'bjtrainer.flashsr.v1' | 'bjtrainer.quizsr.v1',
  deck: Record<string, SrCardSeed>,
): Promise<void> {
  await page.addInitScript(
    ({ key, json }) => window.localStorage.setItem(key, json),
    { key, json: JSON.stringify(deck) },
  );
}

async function openStatsProgressTab(page: Page): Promise<void> {
  // The bottom tab bar is hidden on drill screens (immersive mode), so
  // leaving a drill goes through its own Back button, not the nav.
  const drillBack = page.locator('.drill-back-btn').first();
  if (await drillBack.isVisible().catch(() => false)) await drillBack.click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Full stats', exact: true }).click();
  // Stats' OWN tablist -- not the bottom nav, which would leave the screen.
  await page.locator('.stats-tabs [role="tab"]', { hasText: 'Progress' }).click();
}

function flashSection(page: Page) {
  return page.locator('.stats-section', { hasText: 'Spaced repetition — Flashcards' }).first();
}

function quizSection(page: Page) {
  return page.locator('.stats-section', { hasText: 'Spaced repetition — Deviation quiz' }).first();
}

async function answerOneFlashcard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.locator('.action-bar button').first().click();
  await expect(page.locator('.message-strip')).toBeVisible();
}

test('fresh install: both spaced-repetition panels show empty state and render no bars (D3)', async ({ page }) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await openStatsProgressTab(page);

  const flash = flashSection(page);
  const quiz = quizSection(page);
  await expect(flash).toBeVisible();
  await expect(quiz).toBeVisible();
  await expect(flash).toContainText('No flashcards studied yet');
  await expect(quiz).toContainText('No deviation-quiz items studied yet');

  // The negative assertion is what actually proves the suppression rule
  // fired -- a component printing both the empty-state text AND a row of
  // seven zero-height bars would still pass a test that only checks for
  // the text.
  await expect(flash.locator('.sr-bar-row')).toHaveCount(0);
  await expect(quiz.locator('.sr-bar-row')).toHaveCount(0);
});

test('a seeded box-3 flashcard entry shows up in the box-3 bar with the right count, others zero', async ({ page }) => {
  await withProfile(page);
  await seedSrDeck(page, 'bjtrainer.flashsr.v1', {
    'hard-16-v-9': card({ box: 3, dueAt: Date.now() - 1000 }),
  });
  await page.goto('/?e2e=1');
  await openStatsProgressTab(page);

  const flash = flashSection(page);
  await expect(flash).toBeVisible();

  const box3Col = flash.locator('.sr-bar-col', { has: page.locator('.sr-bar-label', { hasText: 'Box 3' }) });
  await expect(box3Col.locator('.sr-bar-count')).toHaveText('1');

  for (const label of ['Box 0', 'Box 1', 'Box 2', 'Box 4', 'Box 5']) {
    const col = flash.locator('.sr-bar-col', { has: page.locator('.sr-bar-label', { hasText: label }) });
    await expect(col.locator('.sr-bar-count')).toHaveText('0');
  }

  await expect(flash).toContainText('Due now');
});

test('a lapsed item appears in "Most often forgotten", using the resolved label for the quiz deck', async ({ page }) => {
  await withProfile(page);
  await seedSrDeck(page, 'bjtrainer.quizsr.v1', {
    '16v10': card({ box: 1, lapses: 3 }),
  });
  await page.goto('/?e2e=1');
  await openStatsProgressTab(page);

  const quiz = quizSection(page);
  await expect(quiz).toContainText('Most often forgotten');
  // The raw id must be resolved to its human label, not printed verbatim.
  await expect(quiz).toContainText('16 v 10: stand at TC');
  await expect(quiz).not.toContainText('16v10');
  await expect(quiz).toContainText('3 lapses');
});

test('more than 5 lapsed items caps the list at 5 and prints an accurate "+N more" line (D4)', async ({ page }) => {
  await withProfile(page);
  const deck: Record<string, SrCardSeed> = {};
  for (let i = 0; i < 7; i++) {
    deck[`hard-${10 + i}-v-9`] = card({ box: 1, lapses: 7 - i }); // distinct, descending lapse counts
  }
  await seedSrDeck(page, 'bjtrainer.flashsr.v1', deck);
  await page.goto('/?e2e=1');
  await openStatsProgressTab(page);

  const flash = flashSection(page);
  await expect(flash.locator('.sr-lapses-title')).toBeVisible();
  await expect(flash.locator('.mistake-row', { hasText: 'lapse' })).toHaveCount(5);
  await expect(flash).toContainText('+2 more');
});

test('answering one real flashcard end-to-end shows exactly one reviewed item in the panel', async ({ page }) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await page.evaluate(() => window.localStorage.removeItem('bjtrainer.flashsr.v1'));
  await answerOneFlashcard(page);

  await openStatsProgressTab(page);
  const flash = flashSection(page);
  await expect(flash).toBeVisible();

  // Exactly one reviewed item: the headline's numerator is 1, and box 0 +
  // box 1 (correct vs wrong) sum to exactly 1 across the row -- this is the
  // one test in the file that proves the WHOLE pipeline (grade path -> deck
  // write -> Stats read), not a pre-seeded fixture, guarding against the
  // panel silently reading a different key than gradeFlashcardAnswer writes.
  const headlineValue = flash.locator('.stats-headline-value');
  await expect(headlineValue).toHaveText('1');

  const box0 = flash.locator('.sr-bar-col', { has: page.locator('.sr-bar-label', { hasText: 'Box 0' }) });
  const box1 = flash.locator('.sr-bar-col', { has: page.locator('.sr-bar-label', { hasText: 'Box 1' }) });
  const box0Count = Number(await box0.locator('.sr-bar-count').innerText());
  const box1Count = Number(await box1.locator('.sr-bar-count').innerText());
  expect(box0Count + box1Count).toBe(1);
});

test('the box histogram is readable: bars scale against each other, not against Unseen (regression)', async ({ page }) => {
  // Reported defect, reproduced at the same scale: a realistic 15-card
  // deck spread across all six boxes, measured against the real ~330-cell
  // universe. The original bug scaled all seven bars (six boxes + an
  // "Unseen" bar) against one shared maximum; Unseen (~315) dwarfed every
  // box (1-4 each), so every box bar rendered at ~3px in a 64px track
  // regardless of its actual relative size -- the printed-count assertions
  // in the other tests in this file all still passed throughout, which is
  // exactly why this needs its own check on RENDERED geometry, not text.
  await withProfile(page);
  const deck: Record<string, SrCardSeed> = {};
  const counts = [1, 2, 2, 3, 3, 4]; // 15 cards total, box 0 the smallest, box 5 the largest
  counts.forEach((n, box) => {
    for (let i = 0; i < n; i++) deck[`hard-${box}-${i}-v-2`] = card({ box });
  });
  await seedSrDeck(page, 'bjtrainer.flashsr.v1', deck);
  await page.goto('/?e2e=1');
  await openStatsProgressTab(page);

  const flash = flashSection(page);
  await expect(flash).toBeVisible();

  // Unseen no longer competes for a seat on the shared scale at all (the
  // required fix): the row holds exactly the six boxes, nothing else.
  await expect(flash.locator('.sr-bar-row .sr-bar-col')).toHaveCount(6);
  await expect(flash.locator('.sr-bar-label', { hasText: 'Unseen' })).toHaveCount(0);

  const heights = await flash.locator('.sr-bar-fill').evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().height),
  );
  const smallest = Math.min(...heights); // box 0: 1 item
  const largest = Math.max(...heights); // box 5: 4 items

  // The 4-item box must render several times taller than the 1-item box --
  // this is the ratio the shared-scale-with-Unseen bug destroyed (both
  // rounded to the same ~3px regardless of the real 4x difference).
  expect(largest / smallest).toBeGreaterThan(2);
  // And the smallest nonzero bar must still be comfortably visible, not a
  // rounding-error sliver next to its dominant sibling.
  expect(smallest).toBeGreaterThan(4);
});

test('the flashcard panel denominator is the live cell count, not a frozen literal', async ({ page }) => {
  // Binding reviewer override: 330 is the DENOMINATOR of this panel's
  // headline figure. If the flashcard cell universe's shape ever changes,
  // a hardcoded literal would silently go stale with every percentage on
  // the screen quietly wrong and no test failing. This test pins the
  // panel's printed denominator to generateAllCells().length -- the SAME
  // live source Stats.tsx calls -- so the two can never diverge unnoticed.
  const expected = generateAllCells().length;

  await withProfile(page);
  await seedSrDeck(page, 'bjtrainer.flashsr.v1', { 'hard-16-v-9': card({ box: 1 }) });
  await page.goto('/?e2e=1');
  await openStatsProgressTab(page);

  const flash = flashSection(page);
  await expect(flash).toContainText(`of ${expected} flashcards studied`);
});

test('the deviation-quiz panel denominator is the live Illustrious-18 count', async ({ page }) => {
  await withProfile(page);
  await seedSrDeck(page, 'bjtrainer.quizsr.v1', { '16v10': card({ box: 1 }) });
  await page.goto('/?e2e=1');
  await openStatsProgressTab(page);

  const quiz = quizSection(page);
  await expect(quiz).toContainText('of 18 deviation-quiz items studied');
});

test('the panels follow the active theme instead of a hardcoded palette', async ({ page }) => {
  // Bone & Ink is the one light theme -- exactly the case that would have
  // caught the Charts screen's real prior bug (a hardcoded dark palette
  // shadowing the theme tokens, invisible under the default dark theme and
  // only revealed under a different one). Mirrors e2e/themes.spec.ts's
  // existing pattern.
  await withProfile(page);
  await withSettings(page, { theme: 'bone-ink' });
  await seedSrDeck(page, 'bjtrainer.flashsr.v1', { 'hard-16-v-9': card({ box: 3 }) });
  await page.goto('/?e2e=1');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'bone-ink');
  await openStatsProgressTab(page);

  const flash = flashSection(page);
  await expect(flash).toBeVisible();

  const lum = (c: string) => {
    const nums = c.match(/\d+/g)!.map(Number);
    return 0.2126 * nums[0] + 0.7152 * nums[1] + 0.0722 * nums[2];
  };

  const { trackBg, ink } = await page.evaluate(() => {
    const track = document.querySelector('.sr-bar-track')!;
    const label = document.querySelector('.sr-bar-label')!;
    return {
      trackBg: getComputedStyle(track).backgroundColor,
      ink: getComputedStyle(label).color,
    };
  });

  // Light ground behind the track, dark ink for labels -- inverted from
  // every dark theme, matching the rest of the app under Bone & Ink.
  expect(lum(trackBg)).toBeGreaterThan(150);
  expect(lum(ink)).toBeLessThan(150);
});
