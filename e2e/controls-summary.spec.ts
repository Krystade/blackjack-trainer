import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip, readStats, withSettings } from './helpers';
import { DEFAULT_SETTINGS, EMPTY_STATS } from '../src/store/types';
import type { Settings, Stats } from '../src/store/types';
import { DEFAULT_RULES } from '../src/engine/ruleset';
import { flashSummaryLine, mixedSummaryLine, quizSummaryLine } from '../src/ui/screens/drills/summaryLine';

/**
 * W2-7: in Flashcards, the Deviation quiz and Mixed, the first answer of a
 * session folds the "what to deal" controls (and Flashcards' goal line) into
 * one summary line -- a closed disclosure button. Before it nothing changes;
 * a tap opens the controls, another closes them.
 *
 * At 375x812 with an iPhone 13 mini's insets, the space the fold gives back
 * to the hand and the answer bar is measured and the before/after frames are
 * saved (F2_SHOTS, outside the repo).
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const INSET = ':root { --safe-top: 47px; --safe-bottom: 34px; }';
const SHOTS = process.env.F2_SHOTS;

const DRILL = { scopes: ['hard', 'soft'], deck: 'chart', withCount: false } as const;
const drill: Settings['drill'] = { ...DEFAULT_SETTINGS.drill, ...DRILL } as Settings['drill'];

async function open(page: Page, name: 'Flashcards' | 'Deviation quiz' | 'Mixed') {
  await withSettings(page, { drill: DRILL });
  await page.goto('/?e2e=1');
  await page.addStyleTag({ content: INSET });
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.action-bar')).toBeVisible();
}

/** Any enabled answer: the fold follows an answer, right or wrong. */
const anAnswer = (page: Page) => page.locator('.action-bar button:enabled').first();

const summary = (page: Page) => page.getByTestId('controls-summary');
const chips = (page: Page) => page.getByRole('group', { name: 'Hands' });

/** Where the hand starts and how much room it has above the answer bar. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const controls = box('.drill-inline-controls');
    const bar = box('.action-bar');
    return { controlsBottom: controls.bottom, controlsHeight: controls.height, roomAboveBar: bar.top - controls.bottom };
  });
}

async function shotIf(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function expectToggles(page: Page, controls: () => ReturnType<Page['locator']>) {
  await expect(summary(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(controls()).toHaveCount(0);
  await summary(page).click();
  await expect(summary(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(controls()).toBeVisible();
  await summary(page).click();
  await expect(summary(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(controls()).toHaveCount(0);
}

test('Flashcards: the chips and goal line fold into one line after the first answer', async ({ page }, info) => {
  await open(page, 'Flashcards');
  // Before the first answer nothing changes.
  await expect(summary(page)).toHaveCount(0);
  await expect(chips(page)).toBeVisible();
  await expect(page.getByTestId('flash-progress')).toBeVisible();
  const before = await layout(page);
  await shotIf(page, 'f2-flash-before');

  await answerAndReadStrip(page, anAnswer(page));
  const stats = { ...EMPTY_STATS, ...(await readStats(page)) } as Stats;
  await expect(summary(page)).toHaveText(flashSummaryLine(drill, DEFAULT_RULES, stats));
  // And independently of that function: one answer counted of the 40 that
  // judging Hard and Soft needs.
  await expect(summary(page)).toHaveText('Hard + Soft · 6D H17 · 1/40');
  await expect(page.getByTestId('flash-progress')).toHaveCount(0);
  const after = await layout(page);
  await shotIf(page, 'f2-flash-after');
  info.annotations.push({ type: 'gain', description: `flashcards: controls ${before.controlsHeight} -> ${after.controlsHeight}px, hand up ${before.controlsBottom - after.controlsBottom}px` });
  expect(before.controlsBottom - after.controlsBottom).toBeGreaterThan(20);
  expect(after.roomAboveBar - before.roomAboveBar).toBeGreaterThan(20);

  // The summary fits one line: no wrap.
  const box = (await summary(page).boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(34);
  // Drawn 32px tall, it still takes a tap 44px tall: 6px above and below.
  const hit = await page.evaluate(([x, top, bottom]) => {
    const at = (y: number) => document.elementFromPoint(x, y)?.closest('[data-testid="controls-summary"]') !== null;
    return { above: at(top - 5), below: at(bottom + 5), outside: at(top - 8) };
  }, [box.x + box.width / 2, box.y, box.y + box.height]);
  expect(hit).toEqual({ above: true, below: true, outside: false });

  await expectToggles(page, () => chips(page));
  // Open, the goal line is back with the chips.
  await summary(page).click();
  await expect(page.getByTestId('flash-progress')).toBeVisible();
});

test('Deviation quiz: Ask and Index fold into one line after the first answer', async ({ page }, info) => {
  await open(page, 'Deviation quiz');
  const index = () => page.locator('.quiz-index-select');
  await expect(summary(page)).toHaveCount(0);
  await expect(index()).toBeVisible();
  const before = await layout(page);
  await shotIf(page, 'f2-quiz-before');

  await answerAndReadStrip(page, anAnswer(page));
  await expect(summary(page)).toHaveText(quizSummaryLine('All indices', DEFAULT_RULES));
  const after = await layout(page);
  await shotIf(page, 'f2-quiz-after');
  info.annotations.push({ type: 'gain', description: `quiz: controls ${before.controlsHeight} -> ${after.controlsHeight}px, hand up ${before.controlsBottom - after.controlsBottom}px` });
  expect(before.controlsBottom - after.controlsBottom).toBeGreaterThan(20);

  await expectToggles(page, index);
});

test('Mixed: the chips fold into one line after the first answer', async ({ page }, info) => {
  await open(page, 'Mixed');
  await expect(summary(page)).toHaveCount(0);
  await expect(chips(page)).toBeVisible();
  const before = await layout(page);
  await shotIf(page, 'f2-mixed-before');

  await answerAndReadStrip(page, anAnswer(page));
  await expect(summary(page)).toHaveText(mixedSummaryLine(drill, DEFAULT_RULES));
  const after = await layout(page);
  await shotIf(page, 'f2-mixed-after');
  info.annotations.push({ type: 'gain', description: `mixed: controls ${before.controlsHeight} -> ${after.controlsHeight}px, hand up ${before.controlsBottom - after.controlsBottom}px` });
  expect(before.controlsBottom - after.controlsBottom).toBeGreaterThan(10);

  await expectToggles(page, () => chips(page));
});

test('a scope changed with the controls open shows in the summary', async ({ page }) => {
  await open(page, 'Flashcards');
  await answerAndReadStrip(page, anAnswer(page));
  await summary(page).click();
  // Hard + Soft lit: a tap on Soft takes it out of the deal.
  await chips(page).getByRole('button', { name: 'Soft', exact: true }).click();
  await expect(summary(page)).toHaveText(/^Hard · /);
  await expect(summary(page)).toHaveAttribute('aria-expanded', 'true');
});
