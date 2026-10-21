import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';
import { shortCellLabel } from '../src/drills/missHistory';

/**
 * F7: eyes-free, one car status line -- the hand (or the count prompt), what
 * the wheel does now, the microphone, and the session score. One row at
 * 375px, the hand giving way first, and nothing of it outside eyes-free.
 *
 * Wheel texts are written out here rather than imported: the line is what a
 * driver reads, so the spec states it.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const INSET = ':root { --safe-top: 47px; --safe-bottom: 34px; }';
const SHOTS = process.env.F7_SHOTS;

const car = (page: Page) => page.getByTestId('car-status');
const part = (page: Page, name: 'hand' | 'wheel' | 'mic' | 'score') => car(page).locator(`[data-part="${name}"]`);

async function press(page: Page, command: 'forward' | 'back') {
  const handled = await page.evaluate((c) => window.__wheelPress?.(c) ?? false, command);
  expect(handled).toBe(true);
}

async function open(page: Page, name: string, drill: Record<string, unknown> = {}) {
  await withSettings(page, { audio: { enabled: true }, drill: { wheelMode: 'answer', ...drill } });
  await page.goto('/?e2e=1');
  await page.addStyleTag({ content: INSET });
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  // The drill is up before any absence on it is asserted.
  await expect(page.getByLabel('Eyes-free audio')).toBeVisible();
}

/** One row, inside the drill gutter, with the wheel and score whole. */
async function expectOneLine(page: Page) {
  const m = await car(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const box = (sel: string) => el.querySelector(sel)!.getBoundingClientRect();
    const tops = [...el.children].map((c) => Math.round(c.getBoundingClientRect().top));
    return {
      height: r.height,
      right: r.right,
      rows: new Set(tops).size,
      wheelRight: box('[data-part="wheel"]').right,
      scoreRight: box('[data-part="score"]').right,
      overflow: el.scrollWidth - el.clientWidth,
    };
  });
  expect(m.rows).toBe(1);
  expect(m.height).toBeLessThan(28);
  expect(m.overflow).toBeLessThanOrEqual(0);
  // The drills' own 12px gutter.
  expect(m.scoreRight).toBeLessThanOrEqual(375 - 12 + 0.5);
  expect(m.wheelRight).toBeLessThanOrEqual(m.scoreRight);
}

test('Flashcards: hand, wheel, mic and score, and the wheel text follows the wheel', async ({ page }) => {
  await open(page, 'Flashcards');
  // Not in eyes-free: no line.
  await expect(car(page)).toHaveCount(0);
  await page.getByLabel('Eyes-free audio').check();
  await expect(car(page)).toBeVisible();

  const cellId = (await page.locator('.drill-screen').getAttribute('data-item-key'))!;
  await expect(part(page, 'hand')).toHaveText(shortCellLabel(cellId));
  await expect(part(page, 'wheel')).toHaveText('▶ reveal · ◀ repeat');
  await expect(part(page, 'mic')).toHaveText('mic off');
  await expect(part(page, 'score')).toHaveText('0/0');
  await expectOneLine(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f7-flash-asking.png` });

  // Forward reveals: now the buttons say whether you had it.
  await press(page, 'forward');
  await expect(part(page, 'wheel')).toHaveText('▶ yes · ◀ no');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f7-flash-reporting.png` });
  await press(page, 'forward');
  await expect(part(page, 'score')).toHaveText('1/1');
  await expect(part(page, 'wheel')).toHaveText('▶ next · ◀ repeat');
  await press(page, 'forward');
  await expect(part(page, 'wheel')).toHaveText('▶ reveal · ◀ repeat');
});

test('Flashcards in push-to-talk mode: the wheel text says so', async ({ page }) => {
  await open(page, 'Flashcards', { wheelMode: 'talk' });
  await page.getByLabel('Eyes-free audio').check();
  await expect(part(page, 'wheel')).toHaveText('▶ talk · ◀ repeat');
});

test('the hand gives way first when the row is short', async ({ page }) => {
  await open(page, 'Flashcards');
  await page.getByLabel('Eyes-free audio').check();
  await part(page, 'hand').evaluate((el) => {
    el.textContent = 'A very long hand description that cannot possibly fit on the row';
  });
  const m = await car(page).evaluate((el) => {
    const hand = el.querySelector('[data-part="hand"]') as HTMLElement;
    const wheel = el.querySelector('[data-part="wheel"]') as HTMLElement;
    return {
      handClipped: hand.scrollWidth > hand.clientWidth,
      wheelWhole: wheel.scrollWidth <= wheel.clientWidth,
      wheelText: wheel.textContent,
    };
  });
  expect(m).toEqual({ handClipped: true, wheelWhole: true, wheelText: '▶ reveal · ◀ repeat' });
  await expectOneLine(page);
});

test('Speed: the wheel answers, then goes on', async ({ page }) => {
  await open(page, 'Speed');
  await expect(car(page)).toHaveCount(0);
  await page.getByLabel('Eyes-free audio').check();
  await expect(part(page, 'wheel')).toHaveText('▶ yes · ◀ no');
  await expect(part(page, 'mic')).toHaveText('mic off');
  await expect(part(page, 'score')).toHaveText('0/0');
  await expectOneLine(page);

  await press(page, 'forward');
  // The verdict is up: the question it judged is the one the line names.
  const cellId = (await page.getByTestId('speed-result').getAttribute('data-cell-id'))!;
  await expect(part(page, 'hand')).toHaveText(new RegExp(`^${shortCellLabel(cellId)}( · TC .*)?$`));
  await expect(part(page, 'wheel')).toHaveText('▶ next · ◀ repeat');
  await expect(part(page, 'score')).toHaveText(/^[01]\/1$/);
  await expect(part(page, 'score')).toHaveText((await page.getByTestId('speed-score').textContent())!);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f7-speed-verdict.png` });
  await press(page, 'forward');
  await expect(part(page, 'wheel')).toHaveText('▶ yes · ◀ no');
});

test('Count drill: prompt, pause and resume, report, score', async ({ page }) => {
  await open(page, 'Count drill', { countLengthCards: 4, countIntervalMs: 1500, countGroup: 1, countManual: false });
  await expect(car(page)).toHaveCount(0);
  await page.getByLabel('Eyes-free audio').check();
  await expect(part(page, 'hand')).toHaveText('Ready to count');
  await expect(part(page, 'score')).toHaveText('0/0');
  await expect(part(page, 'mic')).toHaveText('mic off');

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(part(page, 'hand')).toHaveText(/^Counting \d\/4$/);
  await expect(part(page, 'wheel')).toHaveText('◀ pause');
  await expectOneLine(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f7-count-flashing.png` });
  await press(page, 'back');
  await expect(part(page, 'wheel')).toHaveText('▶ resume');
  await press(page, 'forward');
  await expect(part(page, 'wheel')).toHaveText('◀ pause');

  await expect(part(page, 'hand')).toHaveText('Did you have it?', { timeout: 15_000 });
  await expect(part(page, 'wheel')).toHaveText('▶ yes · ◀ no');
  await press(page, 'forward');
  await expect(part(page, 'hand')).toHaveText('Run done');
  await expect(part(page, 'score')).toHaveText('1/1');
  await expect(part(page, 'wheel')).toHaveText('▶ yes · ◀ repeat');
});

test('Count drill in push-to-talk mode: the wheel text says so', async ({ page }) => {
  await open(page, 'Count drill', { wheelMode: 'talk' });
  await page.getByLabel('Eyes-free audio').check();
  await expect(part(page, 'wheel')).toHaveText('▶ talk · ◀ repeat');
});
