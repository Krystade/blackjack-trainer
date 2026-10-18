import { test, expect, type Page } from '@playwright/test';
import { readStats, withStats } from './helpers';
import { trueCount } from '../src/engine/count';

/**
 * Wave E E3 (W2-12): the True count drill asks at depths Play can reach on the
 * active profile (6 decks, 75% -- the cut leaves 1.5 decks), and asks more at
 * the depths missed lately. The unit tests prove the generator; this proves
 * the screen hands it the profile's floor and the stored history.
 *
 * `Math.random` is replaced by a fixed sequence, so every run of this spec
 * asks the same 40 questions.
 */

const QUESTIONS = 40;

async function pinRandomSequence(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let s = 12345;
    Math.random = () => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return s / 4294967296;
    };
  });
}

const parseSigned = (s: string) => Number(s.replace('−', '-').replace('+', ''));

async function readQuestion(page: Page): Promise<{ rc: number; decks: number }> {
  const rcText = await page.locator('.count-flash-area .quiz-tc').innerText();
  const decksText = await page.locator('.count-flash-area .tag-guess-label').innerText();
  const rc = parseSigned(/Running count ([+−-]?\d+)/.exec(rcText)?.[1] ?? 'NaN');
  const decks = Number(/Decks remaining ([\d.]+)/.exec(decksText)?.[1] ?? 'NaN');
  expect(Number.isFinite(rc), `unparsed: ${rcText}`).toBe(true);
  expect(Number.isFinite(decks), `unparsed: ${decksText}`).toBe(true);
  return { rc, decks };
}

/** Type a signed integer on the keypad and submit it. */
async function enter(page: Page, n: number): Promise<void> {
  const pad = page.locator('.numpad');
  for (const d of String(Math.abs(n))) await pad.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
  if (n < 0) await pad.getByRole('button', { name: 'Plus or minus', exact: true }).click();
  await pad.locator('.numpad-ok').click();
}

const historyLength = async (page: Page) =>
  (((await readStats(page))?.trueCount as { history: unknown[] } | undefined)?.history ?? []).length;

test('E3: every tray is at or above the cut floor, and recent misses at 2.5 decks come up more', async ({ page }) => {
  test.setTimeout(90_000);
  await pinRandomSequence(page);
  // Three recent misses, all at 2.5 decks.
  const misses = Array.from({ length: 3 }, () => ({
    date: '2026-10-17T00:00:00.000Z',
    runningCount: 5,
    decksRemaining: 2.5,
    guess: 1,
    correctTc: 2,
    correct: false,
  }));
  await withStats(page, { trueCount: { history: misses } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True count drill', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  const depths: number[] = [];
  for (let i = 0; i < QUESTIONS; i++) {
    const q = await readQuestion(page);
    depths.push(q.decks);
    // Answered RIGHT, so the drill adds no misses of its own to the window.
    await enter(page, trueCount(q.rc, q.decks));
    await expect.poll(() => historyLength(page)).toBe(misses.length + i + 1);
  }

  const stats = (await readStats(page)) as { trueCount: { history: { correct: boolean }[] } };
  const rows = stats.trueCount.history;
  expect(rows.slice(misses.length).every((r) => r.correct), 'the answers were meant to be right').toBe(true);
  expect(Math.min(...depths), `depths: ${depths.join(', ')}`).toBeGreaterThanOrEqual(1.5);
  // Ten depths from 1.5 to 6: a uniform draw puts about 4 of 40 at 2.5.
  const at25 = depths.filter((d) => d === 2.5).length;
  expect(at25, `depths: ${depths.join(', ')}`).toBeGreaterThanOrEqual(10);
  // And the rest of the shoe is still asked about.
  expect(new Set(depths).size, `depths: ${depths.join(', ')}`).toBeGreaterThanOrEqual(6);
});
