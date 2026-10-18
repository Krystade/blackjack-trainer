import { test, expect, type Page } from '@playwright/test';
import { readStats, withProfile, withSettings, withStats } from './helpers';
import { EMPTY_STATS } from '../src/store/types';
import type { Profile, Stats } from '../src/store/types';
import { ladder, type RungId } from '../src/ui/screens/nextStep';
import { strategyRulesFor } from '../src/store/profiles';
import { DEFAULT_SPREAD } from '../src/engine/game';
import { betAnswerLabel, correctBetAnswer, scenarioTc } from '../src/drills/betSizing';

/**
 * L-3: the drill result screens show the step progress of the Home-ladder
 * rung the drill feeds -- the rung's own label and progress, as `ladder()`
 * (the function Home builds the ladder with) returns them for the stats
 * after the answer. The expected line is composed here from `ladder()`
 * directly, never from the screen's own helper.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
const SHOTS = process.env.F3_SHOTS;
async function shotIf(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString();

async function open(page: Page, name: string, stats: Record<string, unknown>, settings: Record<string, unknown> = {}) {
  await withProfile(page, { spread: DEFAULT_SPREAD });
  await withSettings(page, { audio: { enabled: false }, ...settings });
  await withStats(page, stats);
  await page.goto('/?e2e=1');
  await page.addStyleTag({ content: ':root { --safe-top: 47px; --safe-bottom: 34px; }' });
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

/** What Home's ladder says for `id`, from the stats now saved. */
async function expectedLine(page: Page, id: RungId): Promise<string> {
  const raw = (await readStats(page)) as Partial<Stats>;
  const profile = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('bjtrainer.profiles.v1') ?? '[]') as { id: string }[];
    const active = localStorage.getItem('bjtrainer.activeProfile.v1');
    return all.find((p) => p.id === active) ?? all[0];
  });
  const stats = { ...EMPTY_STATS, ...raw } as Stats;
  const rung = ladder(stats, { sweepDone: false, rules: strategyRulesFor(profile as unknown as Profile) }).rungs.find((r) => r.id === id)!;
  return `${rung.label}: ${rung.progress}${rung.passed ? ' ✓' : ''}`;
}

async function enter(page: Page, n: number) {
  for (const d of String(Math.abs(n))) await page.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
  if (n < 0) await page.getByRole('button', { name: 'Plus or minus' }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
}

const line = (page: Page) => page.getByTestId('rung-progress');

test('Count drill: the result shows the running-count rung', async ({ page }) => {
  const paced = (i: number, correct: boolean) => ({ date: day(i), cards: 52, intervalMs: 1000, correct });
  await open(page, 'Count drill', { countDrill: { history: [paced(0, true), paced(1, false)] } }, {
    drill: { countManual: true, countLengthCards: 13, countGroup: 1, countIntervalMs: 300 },
  });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (let guard = 0; guard < 20; guard++) {
    if (!(await page.locator('.manual-tap-zone').isVisible().catch(() => false))) break;
    await page.locator('.manual-tap-zone').click();
  }
  await enter(page, 3);
  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(line(page)).toHaveAttribute('data-rung', 'count');
  await expect(line(page)).toHaveText(await expectedLine(page, 'count'));
  await shotIf(page, 'f3-count');
  // Vacuity guard: the seeded runs are what the line counts.
  await expect(line(page)).toContainText('2/5');
});

test('True count drill: the strip shows the deck estimation and true count rung', async ({ page }) => {
  const row = (i: number, correct: boolean) => ({ date: day(i), runningCount: 4, decksRemaining: 2, guess: 2, correctTc: 2, correct });
  await open(page, 'True count drill', {
    trueCount: { history: [row(0, true), row(1, true), row(2, false)] },
    deckEstimation: { history: [{ date: day(0), correct: true, actualDecks: 3, guessDecks: 3 }] },
  });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible();
  await enter(page, 1);
  await expect(page.getByTestId('result-strip')).toBeVisible();
  await expect(line(page)).toHaveAttribute('data-rung', 'tc');
  await expect(line(page)).toHaveText(await expectedLine(page, 'tc'));
  await shotIf(page, 'f3-tc');
  await expect(line(page)).toContainText('TC ');
});

test('Produce the true count feeds no rung: no line', async ({ page }) => {
  await open(page, 'Produce the true count', {}, { drill: { countLengthCards: 4, countIntervalMs: 40, countGroup: 1 } });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await enter(page, 0);
  await expect(page.locator('.drill-result, [data-testid="result-strip"]').first()).toBeVisible();
  await expect(line(page)).toHaveCount(0);
  await shotIf(page, 'f3-producetc');
});

test('Speed: the strip shows the basic strategy rung for a chart question', async ({ page }) => {
  await open(page, 'Speed', { cellStats: { 'hard-16-v-10': { right: 12, wrong: 3, lastAt: '' } } });
  await page.getByTestId('speed-yes').click();
  await expect(page.getByTestId('speed-result')).toBeVisible();
  await expect(line(page)).toHaveAttribute('data-rung', 'basic');
  await expect(line(page)).toHaveText(await expectedLine(page, 'basic'));
  await shotIf(page, 'f3-speed');
});

test('Bet sizing: the strip shows the bet ramp rung', async ({ page }) => {
  await open(page, 'Bet sizing', {
    betSizing: { history: [{ date: day(0), ok: true }, { date: day(1), ok: false }, { date: day(2), ok: true }] },
  });
  const snap = page.locator('.bet-sizing-snapshot');
  const s = {
    rc: Number(await snap.getAttribute('data-rc')),
    cardsDealt: Number(await snap.getAttribute('data-cards-dealt')),
    totalDecks: Number(await snap.getAttribute('data-decks')),
  };
  const right = correctBetAnswer(scenarioTc(s), DEFAULT_SPREAD);
  await page.locator('.bet-sizing-answers').getByRole('button', { name: betAnswerLabel(right), exact: true }).click();
  await expect(page.getByTestId('result-strip')).toBeVisible();
  await expect(line(page)).toHaveAttribute('data-rung', 'betramp');
  await expect(line(page)).toHaveText(await expectedLine(page, 'betramp'));
  await expect(line(page)).toContainText('3/4');
});

test('Index test: the strip shows the deviations rung', async ({ page }) => {
  await open(page, 'Deviation quiz', { perIndex: { '16v10': { right: 6, wrong: 0 }, '15v10': { right: 5, wrong: 1 } } });
  await page.getByRole('button', { name: 'Index test', exact: true }).click();
  await expect(page.getByTestId('index-test-prompt')).toBeVisible();
  await enter(page, 0);
  await expect(page.getByTestId('index-test-result')).toBeVisible();
  await expect(line(page)).toHaveAttribute('data-rung', 'deviations');
  await expect(line(page)).toHaveText(await expectedLine(page, 'deviations'));
  await shotIf(page, 'f3-index');
});

test('Bet sizing: a passed rung is ticked', async ({ page }) => {
  // Nine right of the last nine, plus this right answer: the window is passed.
  await open(page, 'Bet sizing', { betSizing: { history: Array.from({ length: 9 }, (_, i) => ({ date: day(i), ok: true })) } });
  const snap = page.locator('.bet-sizing-snapshot');
  const s = {
    rc: Number(await snap.getAttribute('data-rc')),
    cardsDealt: Number(await snap.getAttribute('data-cards-dealt')),
    totalDecks: Number(await snap.getAttribute('data-decks')),
  };
  const right = correctBetAnswer(scenarioTc(s), DEFAULT_SPREAD);
  await page.locator('.bet-sizing-answers').getByRole('button', { name: betAnswerLabel(right), exact: true }).click();
  await expect(page.getByTestId('result-strip')).toBeVisible();
  await expect(line(page)).toHaveText(await expectedLine(page, 'betramp'));
  await expect(line(page)).toHaveText(/ ✓$/);
  await shotIf(page, 'f3-bet-passed');
});
