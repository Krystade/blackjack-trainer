import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, withStats, playRoundByAdvice, openCountOptions } from './helpers';
import { ILLUSTRIOUS_18 } from '../src/engine/deviations';

const I18_IDS = ILLUSTRIOUS_18.filter((d) => d.active).map((d) => d.id);

/**
 * Wave N: daily goal, streak, freezes and achievements. The clock is fixed
 * with Playwright's clock (Wednesday 21 Oct 2026), and the habit record is
 * seeded so a single Play round crosses a threshold -- no luck loops.
 */

const NARROW = process.env.HABIT_SHOTS_320 === '1';
test.use({ viewport: NARROW ? { width: 320, height: 568 } : { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const SHOTS = process.env.HABIT_SHOTS;
const INSET = ':root { --safe-top: 47px; --safe-bottom: 34px; }';

const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (offset: number) => key(new Date(2026, 9, 21 + offset, 12));
const at = (h: number, min = 0) => new Date(2026, 9, 21, h, min);

/** Signature of an empty stats blob (habits/progress.ts statsSignature). */
const ZERO_SIG = {
  events: 0, countDrill: 0, trueCount: 0, deckEstimation: 0, timedCount: 0, pairCancel: 0,
  betSitLeave: 0, downswing: 0, produceTc: 0, betSizing: 0,
};

async function withProgress(page: Page, p: Record<string, unknown>): Promise<void> {
  const blob = JSON.stringify({
    version: 1, days: {}, answersTotal: 0, drive: { totalMs: 0, runMs: 0, bestRunMs: 0 }, earned: {},
    backfilled: true, sig: ZERO_SIG, ...p,
  });
  await page.addInitScript((json) => {
    if (window.localStorage.getItem('e2e.noReseed') === '1') return;
    window.localStorage.setItem('bjtrainer.progress.v1', json);
  }, blob);
}

/** `n` met days ending `lastOffset` days from today. */
function metDays(n: number, lastOffset: number, activeMs = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) out[day(lastOffset - i)] = { answers: 60, activeMs, met: true };
  return out;
}

async function playOneRound(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  const theme = process.env.HABIT_THEME ?? 'midnight-felt';
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  if (!NARROW) await page.addStyleTag({ content: INSET });
  await page.screenshot({ path: `${SHOTS}/${NARROW ? '320' : '375'}-${theme}-${name}.png` });
}

test('new user: an empty streak card with the goal explained', async ({ page }) => {
  await page.clock.setFixedTime(at(10));
  await page.goto('/?e2e=1');
  const card = page.getByTestId('streak-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('streak-count')).toHaveText('0');
  await expect(page.getByTestId('streak-today')).toContainText('0/10 min');
  await expect(page.getByTestId('streak-today')).toContainText('0/60 answers');
  await expect(card).toContainText('Daily goal: 10 minutes or 60 answers');
  await shot(page, 'home-new-user');
});

test('meeting the goal mid-session shows the banner and lights the card', async ({ page }) => {
  await page.clock.setFixedTime(at(10));
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page);
  await withProgress(page, { days: { [day(-1)]: { answers: 60, activeMs: 0, met: true }, [day(0)]: { answers: 59, activeMs: 0 } } });
  await page.goto('/?seed=4&e2e=1');
  await expect(page.getByTestId('streak-count')).toHaveText('1');
  await shot(page, 'home-mid-progress');
  await playOneRound(page);
  await expect(page.getByTestId('habit-toast-goal')).toHaveText(/Day 2 – goal met/);
  await shot(page, 'banner-goal-met');
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await page.locator('.report-done-btn').click();
  await expect(page.getByTestId('streak-count')).toHaveText('2');
  await expect(page.getByTestId('streak-today')).toHaveText('Goal met');
  await shot(page, 'home-goal-met');
});

test('a missed day with a freeze: streak safe, and the note says so', async ({ page }) => {
  await page.clock.setFixedTime(at(10));
  await withProgress(page, { days: metDays(7, -2) });
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('streak-count')).toHaveText('7');
  await expect(page.getByTestId('streak-freeze-used')).toHaveText('Freeze used – streak safe');
  await expect(page.getByTestId('streak-freezes')).toContainText('0');
  await shot(page, 'home-freeze-used');
});

test('a missed day without a freeze ends the streak', async ({ page }) => {
  await page.clock.setFixedTime(at(10));
  await withProgress(page, { days: metDays(6, -2) });
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('streak-count')).toHaveText('0');
  await expect(page.getByTestId('streak-freeze-used')).toHaveCount(0);
});

test('after 6 pm with the goal unmet, the streak is at risk', async ({ page }) => {
  await page.clock.setFixedTime(at(18, 30));
  await withProgress(page, { days: { ...metDays(3, -1), [day(0)]: { answers: 12, activeMs: 4 * 60_000 } } });
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('streak-at-risk')).toBeVisible();
  await shot(page, 'home-at-risk');
});

test('before 6 pm the same day is not at risk', async ({ page }) => {
  await page.clock.setFixedTime(at(17, 59));
  await withProgress(page, { days: metDays(3, -1) });
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('streak-count')).toHaveText('3');
  await expect(page.getByTestId('streak-at-risk')).toHaveCount(0);
});

test('crossing an achievement shows the unlock toast', async ({ page }) => {
  await page.clock.setFixedTime(at(10));
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page);
  await withProgress(page, { answersTotal: 99 });
  await page.goto('/?seed=4&e2e=1');
  await playOneRound(page);
  await expect(page.getByTestId('habit-toast-unlock')).toContainText('Hundred answers');
  await shot(page, 'toast-unlock');
});

test('first run earns from history, with one summary toast', async ({ page }) => {
  await page.clock.setFixedTime(at(10));
  await withStats(page, {
    mistakes: { correct: 150, 'basic-error': 0, 'missed-deviation': 0, 'phantom-deviation': 0, 'wrong-anyway': 0, timeout: 0, 'self-report': 0 },
  });
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('habit-toast-backfill')).toContainText("You’ve earned 1 achievement from your history");
});

test('the Progress screen: streaks, heatmap and the achievements grid', async ({ page }) => {
  await page.clock.setFixedTime(at(10));
  await withProgress(page, {
    days: { ...metDays(9, -1, 11 * 60_000), ...metDays(7, -11, 10 * 60_000), [day(-20)]: { answers: 20, activeMs: 3 * 60_000 } },
    answersTotal: 1200,
    earned: { 'answers-100': '2026-10-01T10:00:00.000Z', 'answers-1000': '2026-10-18T10:00:00.000Z', 'streak-3': '2026-10-14', 'streak-7': '2026-10-18',
      'days-10': '2026-10-19', 'minutes-60': '2026-10-08', 'week-goal': '2026-10-19', 'week-perfect': '2026-10-18' },
    drive: { totalMs: 12 * 60_000, runMs: 0, bestRunMs: 9 * 60_000 },
  });
  await page.goto('/?e2e=1');
  await page.getByTestId('streak-card').click();
  await expect(page.getByTestId('progress-screen')).toBeVisible();
  // 7 met, a missed day the freeze covers, then 9 more: 16.
  await expect(page.getByTestId('progress-current')).toHaveText('16');
  await expect(page.getByTestId('progress-longest')).toHaveText('16');
  await expect(page.locator('.heatmap .heat-cell.is-frozen')).toHaveCount(1);
  await expect(page.locator('.heatmap .heat-cell.l4')).toHaveCount(16);
  await expect(page.getByTestId('ach-answers-1000')).toHaveAttribute('data-earned', '1');
  await expect(page.getByTestId('ach-answers-10000')).toHaveAttribute('data-earned', '0');
  await expect(page.getByTestId('ach-freeze-full')).toContainText('Secret');
  // The freeze this fixture spent reveals its secret.
  await expect(page.getByTestId('ach-freeze-used')).toContainText('Saved by the freeze');
  await shot(page, 'progress-top');
  await page.locator('.ach-group').first().scrollIntoViewIfNeeded();
  await shot(page, 'progress-achievements');
});

test('Wave T: the mastery tiers are one tile per achievement, earned tiers dated, the bar on the next tier', async ({ page }) => {
  await page.clock.setFixedTime(at(10));
  const today = key(new Date(2026, 9, 21, 12));
  const entry = (right: number, n: number) => ({ recent: '0'.repeat(n - right) + '1'.repeat(right), days: Array(n).fill(today) });
  // Ten Illustrious 18 indices at 19 of their last 20 (silver's bar), the rest at 18.
  await withStats(page, {
    indexRecent: Object.fromEntries(I18_IDS.map((id, i) => [id, entry(i < 10 ? 19 : 18, 20)])),
    latencyHistory: Array.from({ length: 150 }, () => ({ category: 'pairs', elapsedMs: 900, correct: true, date: at(9).toISOString() })),
  });
  await withProgress(page, {
    earned: {
      // Stored under the ids from before the tiers: Illustrious 18 is bronze
      // now, "Hard hands sharp" (95% over 200) silver, with bronze implied.
      'index-i18': '2026-09-01T10:00:00.000Z',
      'accuracy-hard': '2026-08-15T10:00:00.000Z',
      'accuracy-soft-99': '2026-10-19T10:00:00.000Z',
      'index-fab4-90': '',
    },
  });
  await page.goto('/?e2e=1');
  await page.getByTestId('streak-card').click();
  await expect(page.getByTestId('progress-screen')).toBeVisible();
  const i18 = page.getByTestId('ach-index-i18');
  await expect(i18).toHaveAttribute('data-tier', 'bronze');
  await expect(i18).toContainText('Illustrious 18');
  await expect(page.getByTestId('ach-index-i18-90')).toHaveAttribute('data-earned', '1');
  await expect(page.getByTestId('ach-index-i18-90')).toContainText('2026');
  await expect(page.getByTestId('ach-index-i18-95')).toHaveAttribute('data-earned', '0');
  await expect(page.getByTestId('ach-index-i18-next')).toHaveText(`Silver: 10/${I18_IDS.length} indices at 19/20`);
  await expect(page.getByTestId('ach-accuracy-hard')).toHaveAttribute('data-tier', 'silver');
  await expect(page.getByTestId('ach-accuracy-hard-90')).toHaveAttribute('data-earned', '1');
  await expect(page.getByTestId('ach-accuracy-hard-next')).toHaveText('Gold: no answers in the last 180 days');
  await expect(page.getByTestId('ach-accuracy-soft')).toHaveAttribute('data-tier', 'gold');
  await expect(page.getByTestId('ach-accuracy-soft-next')).toHaveCount(0);
  await expect(page.getByTestId('ach-index-fab4-90')).toContainText('From history');
  await expect(page.getByTestId('ach-accuracy-pairs-next')).toHaveText('Bronze: 100% over the last 150');
  await expect(page.getByTestId('ach-accuracy-pairs')).toHaveAttribute('data-tier', 'none');
  // Five ladders, one tile each; the count is of tiers.
  await expect(page.locator('.ach.is-ladder')).toHaveCount(5);
  await expect(page.locator('.ach-grid > li')).toHaveCount(43);
  await expect(page.getByTestId('achievements-count')).toHaveText('7/53');
  await page.getByTestId('ach-accuracy-hard').scrollIntoViewIfNeeded();
  await shot(page, 'progress-tiers');
  await page.getByTestId('ach-index-i18').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'progress-tiers-index');
});

test('Settings: the daily goal changes what Home asks for', async ({ page }) => {
  await page.clock.setFixedTime(at(10));
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).click();
  // ?e2e=1 opens every Settings section (CollapsibleSection e2eForcesOpen).
  await page.locator('[data-goal="hard"]').click();
  await expect(page.locator('[data-goal="hard"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-goal="hard"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'settings-goal');
  await page.getByRole('button', { name: 'Back to Home' }).click();
  await expect(page.getByTestId('streak-today')).toContainText('0/20 min');
  await expect(page.getByTestId('streak-today')).toContainText('0/120 answers');
});

async function eyesFreeMixedAnswer(page: Page, audio: Record<string, unknown>): Promise<string[]> {
  await page.addInitScript(() => {
    Math.random = () => 0.3;
  });
  await withSettings(page, { audio: { enabled: true, verbosity: 'full', ...audio }, drill: { wheelMode: 'answer' } });
  await withProgress(page, { days: { [day(-1)]: { answers: 60, activeMs: 0, met: true }, [day(0)]: { answers: 59, activeMs: 0 } } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mixed', exact: true }).click();
  await page.getByLabel('Eyes-free audio').check();
  const wheel = page.getByTestId('car-status').locator('[data-part="wheel"]');
  await expect(wheel).toHaveText(/reveal/);
  const press = (c: 'forward') => page.evaluate((x) => window.__wheelPress?.(x) ?? false, c);
  await press('forward');
  await expect(wheel).toHaveText(/yes/);
  await page.evaluate(() => {
    ((window as unknown as { __speechLog?: string[] }).__speechLog ?? []).length = 0;
  });
  await press('forward'); // "had it": the 60th answer of the day
  await expect(page.getByTestId('habit-toast-goal')).toBeVisible();
  // Wait for the drill to move on to its next prompt, then read what was said.
  await expect(wheel).toHaveText(/reveal/, { timeout: 15_000 });
  return page.evaluate(() => [...((window as unknown as { __speechLog?: string[] }).__speechLog ?? [])]);
}

test('eyes-free: one spoken line at the next pause, after the verdict and before the next prompt', async ({ page }) => {
  await page.clock.setFixedTime(at(10));
  const said = await eyesFreeMixedAnswer(page, {});
  const goalLines = said.filter((l) => l.includes('Daily goal done.'));
  expect(goalLines).toEqual(['Daily goal done. Two days in a row.']);
  const i = said.indexOf(goalLines[0]);
  expect(i).toBeGreaterThan(0); // the verdict came first
  expect(said.length).toBeGreaterThan(i + 1); // and the next prompt after it
});

test('eyes-free but muted: the banner shows and nothing is said', async ({ page }) => {
  await page.clock.setFixedTime(at(10));
  const said = await eyesFreeMixedAnswer(page, { muted: true });
  expect(said.filter((l) => l.includes('Daily goal'))).toEqual([]);
});

test('eyes-free count drill: the goal line follows the self-report verdict', async ({ page }) => {
  await page.clock.setFixedTime(at(10));
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 0 },
    drill: { countLengthCards: 4, countGroup: 1, countIntervalMs: 0, countManual: false },
  });
  await withProgress(page, { days: { [day(-1)]: { answers: 60, activeMs: 0, met: true }, [day(0)]: { answers: 59, activeMs: 0 } } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await openCountOptions(page);
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const yes = page.getByRole('button', { name: 'I had it' });
  await expect(yes).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => {
    ((window as unknown as { __speechLog?: string[] }).__speechLog ?? []).length = 0;
  });
  await yes.click();
  await expect(page.getByTestId('habit-toast-goal')).toBeVisible();
  const said = await page.evaluate(() => [...((window as unknown as { __speechLog?: string[] }).__speechLog ?? [])]);
  const verdict = said.indexOf('Correct.');
  expect(verdict).toBeGreaterThanOrEqual(0);
  expect(said.slice(verdict + 1).filter((l) => !l.startsWith('chime:'))[0]).toBe('Daily goal done. Two days in a row.');
});

/**
 * D16: SMALL TEXT CLEARS WCAG AA (4.5:1) IN EVERY THEME. The weekday letters
 * of days not yet reached (9.6px at 0.5 opacity) measured 2.1-2.5:1; the
 * counters on unearned achievements (at 0.85 opacity) 3.8:1 in Bone & Ink;
 * and Bone & Ink's active tab label 4.08:1 on its accent wash.
 *
 * Effective contrast: the text colour, faded by its own alpha and every
 * opacity above it, over the composite of the translucent grounds beneath.
 */
async function worstAA(page: Page, sel: string): Promise<{ worst: number; n: number }> {
  return page.evaluate((s) => {
    const rgba = (c: string) => {
      const m = c.match(/[\d.]+/g)!.map(Number);
      return [m[0]!, m[1]!, m[2]!, m[3] ?? 1];
    };
    const over = (f: number[], b: number[]) => [0, 1, 2].map((i) => f[i]! * f[3]! + b[i]! * (1 - f[3]!)).concat(1);
    const lin = (v: number) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
    let worst = Infinity;
    const els = [...document.querySelectorAll(s)];
    for (const el of els) {
      const layers: number[][] = [];
      let op = 1;
      for (let e: Element | null = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        op *= parseFloat(cs.opacity);
        const bg = rgba(cs.backgroundColor);
        if (bg[3]! > 0) layers.push(bg);
        if (bg[3]! >= 1) break;
      }
      let ground = [255, 255, 255, 1];
      for (const l of layers.reverse()) ground = over(l, ground);
      const fg = rgba(getComputedStyle(el).color);
      const text = over([fg[0]!, fg[1]!, fg[2]!, fg[3]! * op], ground);
      const [a, b] = [lum(text), lum(ground)].sort((x, y) => y - x);
      worst = Math.min(worst, (a! + 0.05) / (b! + 0.05));
    }
    return { worst, n: els.length };
  }, sel);
}

for (const theme of ['midnight-felt', 'bone-ink', 'amoled-night', 'slate-copper']) {
  test(`D16: ${theme}: streak letters, achievement counters and the active tab pass AA`, async ({ page }) => {
    await page.clock.setFixedTime(at(10));
    await withSettings(page, { theme });
    await withProgress(page, { answersTotal: 40 });
    await page.goto('/?e2e=1');
    await expect(page.getByTestId('streak-card')).toBeVisible();
    for (const sel of ['.streak-dot.is-future', '.tab-btn-active .tab-label', '.tab-btn-active .tab-glyph']) {
      const { worst, n } = await worstAA(page, sel);
      expect(n, `vacuity guard: ${sel} matched nothing`).toBeGreaterThan(0);
      expect(worst, `${theme} ${sel} ${worst.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
    await page.getByTestId('streak-card').click();
    await expect(page.getByTestId('progress-screen')).toBeVisible();
    const { worst, n } = await worstAA(page, '.ach:not(.is-earned) .ach-note');
    expect(n, 'vacuity guard: no unearned achievement note').toBeGreaterThan(0);
    expect(worst, `${theme} unearned .ach-note ${worst.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
}
