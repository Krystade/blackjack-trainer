import { test, expect, type Page } from '@playwright/test';
import { sayOnceListening, submitZero, withProfile, withSettings } from './helpers';
import { answersSentence } from '../src/guided/lines';

/**
 * Wave L (lane v): the guided session. One tap on Home runs warm-up, speed and
 * the rest back to back; each segment ends on its target and the next starts
 * through a short transition, by tap or, in Drive, by voice.
 *
 * Deterministic: a fresh profile always plans the same 5-minute session --
 * warm-up, then the two weakest drills in ladder order, speed and the running
 * count (src/guided/plan.ts) -- whose targets the spec reads from the plan
 * the app stored rather than restating them; every hand is answered with the
 * play the drill itself advertises (`data-advice`), and the one time target
 * is driven by Playwright's clock.
 */

const GUIDED_KEY = 'bjtrainer.guided.v1';
const PROGRESS_KEY = 'bjtrainer.progress.v1';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function base(page: Page): Promise<void> {
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 0 },
    drill: { countIntervalMs: 50, countManual: false, countLengthCards: 10 },
  });
}

/** A guided session already in the store, seeded once per tab (a reload keeps what the app wrote). */
async function seedGuided(page: Page, active: Record<string, unknown>): Promise<void> {
  const blob = JSON.stringify({ version: 1, active: { version: 1, startedAt: Date.now(), day: today(), ...active }, history: [], completed: 0 });
  await page.addInitScript(
    ({ key, json }) => {
      if (window.sessionStorage.getItem('e2e.guidedSeeded') === '1') return;
      window.sessionStorage.setItem('e2e.guidedSeeded', '1');
      window.localStorage.setItem(key, json);
    },
    { key: GUIDED_KEY, json: blob },
  );
}

async function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
}

type Planned = { id: string; target: { kind: 'answers'; n: number } | { kind: 'time'; ms: number } };

/** The plan of the session in progress, as the app stored it. */
async function storedPlan(page: Page): Promise<Planned[]> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').active.plan, GUIDED_KEY);
}

function answers(p: Planned): number {
  if (p.target.kind !== 'answers') throw new Error(`${p.id} has a time target`);
  return p.target.n;
}

const strip = (page: Page) => page.getByTestId('guided-strip-progress');
const running = (page: Page, seg: string) => page.locator(`[data-testid="guided-running"][data-segment="${seg}"]`);

/** Answer one hand with the drill's own advised play, and wait for the strip to count it. */
async function answerAdvised(page: Page): Promise<void> {
  const before = await strip(page).textContent();
  const bar = page.locator('.action-bar[data-advice]');
  const advice = (await bar.getAttribute('data-advice'))!;
  await bar.getByRole('button', { name: advice[0]!.toUpperCase() + advice.slice(1), exact: true }).click();
  await expect(strip(page)).not.toHaveText(before!);
}

/** Answer an answer-target segment to its target, checking the count at every step. */
async function answerSegment(page: Page, seg: string, n: number): Promise<void> {
  await expect(running(page, seg)).toBeVisible({ timeout: 8000 });
  for (let i = 1; i <= n; i++) {
    await answerAdvised(page);
    if (i < n) await expect(strip(page)).toHaveText(`${i}/${n}`);
  }
}

test('tap: Home to summary, auto-advancing, crediting the day and "Guided start"', async ({ page }) => {
  await base(page);
  await page.goto('/?e2e=1');
  const card = page.locator('.guided-card');
  await card.getByRole('radio', { name: /^5/ }).click();
  await card.getByRole('button', { name: 'Start guided session' }).click();

  // The transition starts the segment by itself (no tap on Start now).
  await expect(page.locator('[data-testid="guided-transition"][data-segment="warmup"]')).toBeVisible();
  const plan = await storedPlan(page);
  expect(plan.map((p) => p.id)).toEqual(['warmup', 'speed', 'count']);
  const [warm, speed] = [answers(plan[0]!), answers(plan[1]!)];
  await expect(page.getByText(`${warm} answers · segment 1 of 3`)).toBeVisible();
  await answerSegment(page, 'warmup', warm);

  await expect(page.locator('[data-testid="guided-transition"][data-segment="speed"]')).toBeVisible();
  await answerSegment(page, 'speed', speed);

  await expect(running(page, 'count')).toBeVisible({ timeout: 8000 });
  await page.locator('.guided-strip').getByRole('button', { name: 'Skip', exact: true }).click();

  const summary = page.getByTestId('guided-summary');
  await expect(summary).toHaveAttribute('data-outcome', 'completed');
  await expect(page.getByTestId('guided-summary-pct')).toHaveText('100%');
  await expect(summary.locator('tr[data-segment="warmup"]')).toContainText(`${warm}/${warm}`);
  await expect(summary.locator('tr[data-segment="speed"]')).toContainText(`${speed}/${speed}`);
  await expect(summary.locator('tr[data-segment="count"]')).toContainText('skipped');

  // Credited like any drill, through the habit hooks: 25 answers today, and the achievement.
  const progress = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), PROGRESS_KEY);
  expect(progress.days[today()].answers).toBe(warm + speed);
  expect(progress.earned['guided-1']).toBeTruthy();
  const guided = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), GUIDED_KEY);
  expect(guided).toMatchObject({ active: null, completed: 1 });
});

test('time target: ends on the first answer after the time, never on the clock alone', async ({ page }) => {
  await base(page);
  await seedGuided(page, {
    preset: 5,
    drive: false,
    plan: [
      { id: 'count', minutes: 1, target: { kind: 'time', ms: 60_000 }, weak: true },
      { id: 'deviations', minutes: 1, target: { kind: 'answers', n: 5 }, weak: true, indexes: [] },
    ],
    index: 0,
    progress: [
      { answers: 0, right: 0, activeMs: 0 },
      { answers: 0, right: 0, activeMs: 0 },
    ],
    phase: 'intro',
  });
  await page.clock.install();
  await page.goto('/?e2e=1');
  await page.locator('.guided-card').getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Start now' }).click();
  await expect(running(page, 'count')).toBeVisible();

  await expect(page.locator('.numpad')).toBeVisible({ timeout: 20_000 });
  await submitZero(page);
  await expect(page.getByRole('button', { name: 'New run' })).toBeVisible();

  await page.clock.fastForward(65_000);
  await expect(strip(page)).toHaveText('0:00');
  // Time is up, but a run is not cut off: still the count segment.
  await expect(running(page, 'count')).toBeVisible();

  await page.getByRole('button', { name: 'New run' }).click();
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 20_000 });
  await submitZero(page);
  await expect(page.locator('[data-testid="guided-transition"][data-segment="deviations"]')).toBeVisible();
});

async function withFakeEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      onstart: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      constructor() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }
      start(): void {
        setTimeout(() => {
          this.onstart?.();
          this.onaudiostart?.();
        }, 0);
      }
      stop(): void {
        this.onend?.();
      }
      abort(): void {
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
}

function fire(page: Page, text: string): Promise<void> {
  return page.evaluate((t) => {
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    rec?.onresult?.({ results: [[{ transcript: t }]] });
  }, text);
}

/**
 * A command takes the drill (and its status bar) off the screen, so there is
 * no "heard" line to read back: wait for an open microphone where there is a
 * status bar, say it, and judge it by what it does. Said again only if the
 * word landed in the app's own speech and was dropped.
 */
async function sayCommand(page: Page, text: string, done: () => Promise<void>): Promise<void> {
  await expect(async () => {
    const status = page.locator('.voice-status');
    if (await status.count()) await expect(status).toHaveAttribute('data-voice-state', 'listening', { timeout: 1000 });
    await fire(page, text);
    await done();
  }).toPass({ timeout: 20_000 });
}

test('Drive: spoken transitions, answers and commands by voice, an answer is never a skip', async ({ page }) => {
  test.setTimeout(90_000);
  await withFakeEngine(page);
  await base(page);
  await page.goto('/?e2e=1');
  const card = page.locator('.guided-card');
  await card.getByRole('radio', { name: /^5/ }).click();
  await card.getByRole('button', { name: 'Drive', exact: true }).click();

  await expect(running(page, 'warmup')).toBeVisible({ timeout: 15_000 });
  const plan = await storedPlan(page);
  const warm = answers(plan[0]!);
  expect(await spoken(page)).toEqual(
    expect.arrayContaining(['Guided session. Five minutes.', `First: warm-up. ${answersSentence(warm)}`]),
  );

  // An answer by voice is counted.
  await sayOnceListening(page, 'stand');
  await expect(strip(page)).toHaveText(`1/${warm}`);

  // "skip" heard with "split them" ranked under it is an answer, not a skip.
  await sayOnceListening(page, 'skip', ['split them']);
  await expect(running(page, 'warmup')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(running(page, 'warmup')).toBeVisible();

  await sayCommand(page, 'pause session', () => expect(page.getByTestId('guided-paused')).toBeVisible({ timeout: 1000 }));
  await expect.poll(async () => (await spoken(page)).at(-1)).toBe('Paused.');

  await sayCommand(page, 'resume', () => expect(page.getByTestId('guided-paused')).toBeHidden({ timeout: 1000 }));
  await expect(running(page, 'warmup')).toBeVisible({ timeout: 15_000 });
  expect(await spoken(page)).toContain('Resuming warm-up.');

  await sayCommand(page, 'skip segment', () => expect(page.locator('[data-segment="speed"]')).toBeVisible({ timeout: 1000 }));
  await expect.poll(() => spoken(page)).toContain(`Skipped. Next: speed. ${answersSentence(answers(plan[1]!))}`);

  // Speed in Drive is answered by voice like the warm-up, and every answer
  // counts (right or wrong); its microphone also takes the session's commands.
  await expect(running(page, 'speed')).toBeVisible({ timeout: 15_000 });
  const speedN = answers(plan[1]!);
  await sayOnceListening(page, 'stand');
  await expect(strip(page)).toHaveText(`1/${speedN}`);
  await sayOnceListening(page, 'hit');
  await expect(strip(page)).toHaveText(`2/${speedN}`);
  await sayCommand(page, 'skip segment', () => expect(page.locator('[data-segment="count"]')).toBeVisible({ timeout: 1000 }));
  await expect(running(page, 'count')).toBeVisible({ timeout: 15_000 });

  await sayCommand(page, 'end session', () => expect(page.getByTestId('guided-summary')).toBeVisible({ timeout: 1000 }));
  await expect(page.getByTestId('guided-summary')).toHaveAttribute('data-outcome', 'ended');
  await expect.poll(async () => (await spoken(page)).some((s) => s.startsWith('Guided session ended.'))).toBe(true);
  const progress = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), PROGRESS_KEY);
  expect(progress.earned?.['guided-1']).toBeUndefined();
});

test('interrupted: a reload leaves a resume point on Home, with the answers kept', async ({ page }) => {
  await base(page);
  await page.goto('/?e2e=1');
  const card = page.locator('.guided-card');
  await card.getByRole('radio', { name: /^5/ }).click();
  await card.getByRole('button', { name: 'Start guided session' }).click();
  await expect(running(page, 'warmup')).toBeVisible({ timeout: 8000 });
  const warm = answers((await storedPlan(page))[0]!);
  await answerAdvised(page);
  await expect(strip(page)).toHaveText(`1/${warm}`);
  await answerAdvised(page);
  await expect(strip(page)).toHaveText(`2/${warm}`);

  await page.reload();
  const home = page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true });
  if (!(await card.isVisible())) await home.click();
  await expect(card).toHaveAttribute('data-state', 'resume');
  await expect(card).toContainText('Warm-up, segment 1 of 3');
  await card.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText('Picking up')).toBeVisible();
  await expect(page.getByText(`2 of ${warm} answers · segment 1 of 3`)).toBeVisible();
  await expect(running(page, 'warmup')).toBeVisible({ timeout: 8000 });
  await expect(strip(page)).toHaveText(`2/${warm}`);
});
