import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * H2 (retest story 11): in eyes-free Mixed, nothing on the car line or in the
 * voice may say which kind of item is up -- the judgment Mixed trains is
 * whether the count matters (E1).
 *
 *   - The car line's hand part carries the true count on a flashcard exactly
 *     as on an index item. A flashcard used to show the bare cell.
 *   - The wheel grade speaks the same shape for both kinds. "Correct." is said
 *     once a session (useAnswerSession's gate) -- on the FIRST correct answer,
 *     whichever kind it is, and on neither kind after that.
 *
 * Pinned interleaves (mulberry32 over Math.random * 1e9, see
 * src/drills/mixedSession.test.ts): 0.3 deals flash, quiz, flash ...;
 * 0.42 deals quiz, quiz, quiz, flash ... Every answer is "had it", so no
 * learning-step re-deal moves either.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const INSET = ':root { --safe-top: 47px; --safe-bottom: 34px; }';
const SHOTS = process.env.E2E_SHOTS_DIR;
const TC_PART = /· TC [+−]\d+$/;

const car = (page: Page) => page.getByTestId('car-status');
const part = (page: Page, name: 'hand' | 'wheel') => car(page).locator(`[data-part="${name}"]`);

async function press(page: Page, command: 'forward' | 'back') {
  const handled = await page.evaluate((c) => window.__wheelPress?.(c) ?? false, command);
  expect(handled).toBe(true);
}

async function openEyesFreeMixed(page: Page, random: number) {
  await page.addInitScript((r) => {
    Math.random = () => r;
  }, random);
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' }, drill: { wheelMode: 'answer' } });
  await page.goto('/?e2e=1');
  await page.addStyleTag({ content: INSET });
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mixed', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Mixed');
  await page.getByLabel('Eyes-free audio').check();
  await expect(part(page, 'wheel')).toHaveText(/reveal/);
}

/** Reveal, then "had it": what was said, each line of the reveal named REVEAL. */
async function gradeHadIt(page: Page): Promise<string[]> {
  await page.evaluate(() => {
    (window.__speechLog ?? []).length = 0;
  });
  await press(page, 'forward');
  await expect(part(page, 'wheel')).toHaveText(/yes/);
  await press(page, 'forward');
  await expect(part(page, 'wheel')).toHaveText(/next/);
  await expect.poll(() => page.evaluate(() => (window.__speechLog ?? []).includes('chime:good'))).toBe(true);
  const said = await page.evaluate(() => [...(window.__speechLog ?? [])]);
  return said.map((l) => (/Did you have it\?$/.test(l) ? 'REVEAL' : l));
}

async function nextItem(page: Page) {
  await press(page, 'forward');
  await expect(part(page, 'wheel')).toHaveText(/reveal/);
}

const itemType = (page: Page) => page.locator('.drill-screen').getAttribute('data-item-type');

for (const [random, first] of [
  [0.3, 'flash'],
  [0.42, 'quiz'],
] as const) {
  test(`H2: a ${first} item first -- TC on the car line, and the first grade says "Correct."`, async ({ page }) => {
    await openEyesFreeMixed(page, random);
    expect(await itemType(page)).toBe(first);
    await expect(part(page, 'hand')).toHaveText(TC_PART);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/h2-mixed-car-${first}.png` });
    // The same three lines whichever kind it is.
    expect(await gradeHadIt(page)).toEqual(['REVEAL', 'Correct.', 'chime:good']);
  });
}

test('H2: after the first, neither kind says "Correct." again, and every item shows its TC', async ({ page }) => {
  // flash, quiz, flash
  await openEyesFreeMixed(page, 0.3);
  const seen: Record<string, string[][]> = { flash: [], quiz: [] };
  for (let i = 0; i < 3; i++) {
    const type = (await itemType(page))!;
    await expect(part(page, 'hand')).toHaveText(TC_PART);
    seen[type]!.push(await gradeHadIt(page));
    await nextItem(page);
  }
  expect(seen.flash).toEqual([
    ['REVEAL', 'Correct.', 'chime:good'],
    ['REVEAL', 'chime:good'],
  ]);
  expect(seen.quiz).toEqual([['REVEAL', 'chime:good']]);
});

test('H2: quiz first, then the flashcard grades silently too', async ({ page }) => {
  // quiz, quiz, quiz, flash
  await openEyesFreeMixed(page, 0.42);
  const said: { type: string; lines: string[] }[] = [];
  for (let i = 0; i < 4; i++) {
    const type = (await itemType(page))!;
    await expect(part(page, 'hand')).toHaveText(TC_PART);
    said.push({ type, lines: await gradeHadIt(page) });
    if (i < 3) await nextItem(page);
  }
  expect(said.map((s) => s.type)).toEqual(['quiz', 'quiz', 'quiz', 'flash']);
  expect(said.map((s) => s.lines)).toEqual([
    ['REVEAL', 'Correct.', 'chime:good'],
    ['REVEAL', 'chime:good'],
    ['REVEAL', 'chime:good'],
    ['REVEAL', 'chime:good'],
  ]);
});
