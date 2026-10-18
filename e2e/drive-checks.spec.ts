import { test, expect, type Page } from '@playwright/test';
import { openSettingsScreen, readStoredDiagnostics, sayOnceListening, waitForMic } from './helpers';
import { DC_LINES } from '../src/diag/driveChecks';
import { COUNT_PAUSED_LINE } from '../src/drills/countPause';

/**
 * Drive checks, end to end: reached from the field test, answered on the
 * wheel (window.__wheelPress is the same dispatch a car's media key takes),
 * and every result written as a `test drive-check` line.
 */

async function openDriveChecks(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await openSettingsScreen(page);
  await page.getByTestId('settings-testkit-open').click();
  await page.getByTestId('fieldtest-open').click();
  await page.getByTestId('fieldtest-drive-checks').click();
  await expect(page.getByTestId('drive-checks-screen')).toBeVisible();
}

const screen = (page: Page) => page.getByTestId('drive-checks-screen');

async function waitFor(page: Page, what: 'answer' | 'entry'): Promise<void> {
  await expect(screen(page)).toHaveAttribute('data-waiting', what, { timeout: 15_000 });
}

async function press(page: Page, command: 'forward' | 'back'): Promise<void> {
  const handled = await page.evaluate((c) => window.__wheelPress?.(c) ?? false, command);
  expect(handled).toBe(true);
}

async function spoke(page: Page, line: string): Promise<void> {
  await expect
    .poll(() => page.evaluate((l) => (window.__speechLog ?? []).includes(l), line), { timeout: 15_000 })
    .toBe(true);
}

/** The settled result for one check, from the stored log. */
async function result(page: Page, check: string): Promise<Record<string, unknown>> {
  let found: Record<string, unknown> | undefined;
  await expect
    .poll(
      async () => {
        const raw = await readStoredDiagnostics(page);
        const entries = (raw ? JSON.parse(raw) : []) as { event: string; detail?: Record<string, unknown> }[];
        found = [...entries].reverse().find((e) => e.event === 'drive-check' && e.detail?.check === check)?.detail;
        return found !== undefined;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found!;
}

test('the field test gate opens Drive checks, listing all ten', async ({ page }) => {
  await openDriveChecks(page);
  for (const id of ['voice-timing', 'misheard', 'talk-back', 'speech-queue', 'wheel-speed', 'wheel-bet', 'count-pause', 'mute', 'drive-button', 'status-line']) {
    await expect(page.getByTestId(`drive-check-${id}`)).toHaveAttribute('data-status', 'pending');
  }
  await page.getByText('← Field test').click();
  await expect(page.getByTestId('fieldtest-start')).toBeVisible();
});

test('speech queue: both lines spoken, back on the wheel answers "no overlap" and passes', async ({ page }) => {
  await openDriveChecks(page);
  await page.getByTestId('drive-check-run-speech-queue').click();
  await waitFor(page, 'answer');
  await spoke(page, COUNT_PAUSED_LINE);
  await spoke(page, DC_LINES.queueQuestion);
  await press(page, 'back');
  const r = await result(page, 'speech-queue');
  expect(r).toMatchObject({ status: 'pass', overlapOrCut: 'no', n: 4 });
  await expect(page.getByTestId('drive-check-speech-queue')).toHaveAttribute('data-status', 'pass');
});

test('speech queue: forward ("they overlapped") fails', async ({ page }) => {
  await openDriveChecks(page);
  await page.getByTestId('drive-check-run-speech-queue').click();
  await waitFor(page, 'answer');
  await press(page, 'forward');
  expect(await result(page, 'speech-queue')).toMatchObject({ status: 'fail', overlapOrCut: 'yes' });
});

test('wheel Speed: the proposition is answered on the wheel, then "clear?" decides the status', async ({ page }) => {
  await openDriveChecks(page);
  await page.getByTestId('drive-check-run-wheel-speed').click();
  await spoke(page, DC_LINES.speedIntro);
  await waitFor(page, 'answer');
  await press(page, 'forward');
  await spoke(page, DC_LINES.clearQuestion);
  await waitFor(page, 'answer');
  await press(page, 'back');
  const r = await result(page, 'wheel-speed');
  expect(r).toMatchObject({ status: 'fail', saidYes: true, clear: 'no' });
  expect(typeof r.correct).toBe('boolean');
  // The verdict was spoken between the answer and the question.
  const log = await page.evaluate(() => window.__speechLog ?? []);
  const verdict = log.findIndex((l) => l === 'Correct.' || l.startsWith('Wrong. The answer is'));
  expect(verdict).toBeGreaterThan(log.indexOf(DC_LINES.speedIntro));
  expect(verdict).toBeLessThan(log.lastIndexOf(DC_LINES.clearQuestion));
});

test('wheel Bet sizing: answered and graded', async ({ page }) => {
  await openDriveChecks(page);
  await page.getByTestId('drive-check-run-wheel-bet').click();
  await spoke(page, DC_LINES.betIntro);
  await waitFor(page, 'answer');
  await press(page, 'back');
  await spoke(page, DC_LINES.clearQuestion);
  await waitFor(page, 'answer');
  await press(page, 'forward');
  expect(await result(page, 'wheel-bet')).toMatchObject({ status: 'pass', saidYes: false, clear: 'yes' });
});

test('count: pause holds, resume picks up, and the final entry starts from the checkpoint answer', async ({ page }) => {
  test.setTimeout(60_000);
  await openDriveChecks(page);
  await page.getByTestId('drive-check-run-count-pause').click();
  // Checkpoint: plus two.
  await waitFor(page, 'entry');
  await press(page, 'forward');
  await press(page, 'forward');
  await spoke(page, DC_LINES.countPauseNow);
  await waitFor(page, 'answer');
  await press(page, 'back');
  await spoke(page, COUNT_PAUSED_LINE);
  await spoke(page, DC_LINES.countResumeNow);
  await waitFor(page, 'answer');
  await press(page, 'forward');
  // Final entry: one press forward from the checkpoint's two proposes three.
  await spoke(page, DC_LINES.countFinal);
  await waitFor(page, 'entry');
  await press(page, 'forward');
  await spoke(page, DC_LINES.countQuestion);
  await waitFor(page, 'answer');
  await press(page, 'forward');
  const r = await result(page, 'count-pause');
  expect(r).toMatchObject({
    status: 'pass',
    checkpointAnswer: 2,
    paused: true,
    cardsWhilePaused: 0,
    resumedAt: 3,
    finalFromCheckpoint: true,
    finalAnswer: 3,
  });
});

test('mute: the Mute button lands mid-line, sound comes back for the question', async ({ page }) => {
  await openDriveChecks(page);
  await page.getByTestId('drive-check-run-mute').click();
  await expect(page.getByTestId('drive-checks-mute')).toBeVisible({ timeout: 15_000 });
  await spoke(page, DC_LINES.muteProtected);
  await page.getByTestId('mute-btn').click();
  await spoke(page, DC_LINES.muteBack);
  await waitFor(page, 'answer');
  await press(page, 'forward');
  const r = await result(page, 'mute');
  expect(r).toMatchObject({ pressed: true, answer: 'yes' });
  // Unmuted again, so the rest of the run can be heard.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));
  expect(stored.audio.muted).toBe(false);
});

test('parked: the status line sample shows, and the screen buttons answer', async ({ page }) => {
  await openDriveChecks(page);
  await page.getByTestId('drive-checks-parked').click();
  // 9: the Drive button question. No Drive tap in this log, so a yes cannot pass.
  await waitFor(page, 'answer');
  await page.getByTestId('drive-checks-yes').click();
  expect(await result(page, 'drive-button')).toMatchObject({ status: 'fail', answer: 'yes', tapInLog: false });
  // 10: the status line.
  await expect(page.getByTestId('drive-checks-status-sample').getByTestId('car-status')).toBeVisible();
  await waitFor(page, 'answer');
  await page.getByTestId('drive-checks-yes').click();
  expect(await result(page, 'status-line')).toMatchObject({ status: 'pass', answer: 'yes' });
});

test('Skip settles a check as skipped', async ({ page }) => {
  await openDriveChecks(page);
  await page.getByTestId('drive-check-run-speech-queue').click();
  await waitFor(page, 'answer');
  await page.getByTestId('drive-checks-skip').click();
  expect(await result(page, 'speech-queue')).toMatchObject({ status: 'skipped' });
});

test('375x812 with notch insets: the list and a live check fit without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    const add = () => {
      const s = document.createElement('style');
      s.textContent = ':root{--safe-top:47px !important;--safe-bottom:34px !important}';
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  });
  await openDriveChecks(page);
  const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noSideways()).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/drive-checks-idle.png' });
  await page.getByTestId('drive-check-run-wheel-speed').click();
  await waitFor(page, 'answer');
  expect(await noSideways()).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/drive-checks-live.png' });
  await press(page, 'forward');
  await waitFor(page, 'answer');
  await press(page, 'forward');
  await result(page, 'wheel-speed');
  await page.getByTestId('drive-check-run-status-line').click();
  await waitFor(page, 'answer');
  await page.screenshot({ path: 'e2e/screenshots/drive-checks-parked.png' });
  await page.getByTestId('drive-checks-yes').click();
  await result(page, 'status-line');
  await expect(page.getByTestId('drive-check-run-wheel-speed')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/drive-checks-done.png' });
});

async function fakeRecognition(page: Page): Promise<void> {
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

test('voice timing: five prompts answered, D-R6 timings summarised into the result', async ({ page }) => {
  test.setTimeout(120_000);
  await fakeRecognition(page);
  await openDriveChecks(page);
  await page.getByTestId('drive-check-run-voice-timing').click();
  for (let i = 0; i < 5; i++) {
    await expect
      .poll(() => page.evaluate((l) => (window.__speechLog ?? []).filter((x) => x === l).length, DC_LINES.voiceTimingPrompt), { timeout: 20_000 })
      .toBe(i + 1);
    // Past SPEECH_TAIL_MS, so the answer is a clean one: this pins the
    // plumbing, not the tail (the unit tests pin the tail arithmetic).
    await page.waitForTimeout(900);
    await waitForMic(page);
    await page.evaluate(() => {
      const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
      rec?.onresult?.({ results: [[{ transcript: 'hit' }]] });
    });
  }
  const r = await result(page, 'voice-timing');
  expect(r).toMatchObject({ status: 'pass', prompts: 5, timeouts: 0, tailMs: 700, answers: 5, accepted: 5, tailSuppressed: 0 });
  expect(typeof r.medianMs).toBe('number');
  expect(String(r.rows).split(',').length).toBe(r.answers);
});

test('misheard: two mumbles give tone then re-ask, read back from the log', async ({ page }) => {
  test.setTimeout(120_000);
  await fakeRecognition(page);
  await openDriveChecks(page);
  await page.getByTestId('drive-check-run-misheard').click();
  await spoke(page, DC_LINES.misheardPrompt);
  await sayOnceListening(page, 'mumble blah');
  await waitForMic(page);
  await expect
    .poll(() => page.evaluate((l) => (window.__speechLog ?? []).filter((x) => x === l).length, DC_LINES.misheardPrompt))
    .toBe(1);
  await sayOnceListening(page, 'mumble blah');
  // The re-ask: the bare question, a second time.
  await expect
    .poll(() => page.evaluate((l) => (window.__speechLog ?? []).filter((x) => x === l).length, DC_LINES.misheardPrompt), { timeout: 10_000 })
    .toBe(2);
  await spoke(page, DC_LINES.misheardQuestion);
  await waitFor(page, 'answer');
  await press(page, 'forward');
  const r = await result(page, 'misheard');
  expect(r).toMatchObject({ steps: 'tone,reask', noHint: true, answer: 'yes' });
  expect(r).toMatchObject({ toneAfterReask: true, sequenceOk: true, status: 'pass' });
});

test('a run that had to switch audio on gives it back off afterwards', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('dc-seeded')) {
      localStorage.setItem('dc-seeded', '1');
      localStorage.setItem('bjtrainer.settings.v1', JSON.stringify({ version: 1, audio: { enabled: false } }));
    }
  });
  await openDriveChecks(page);
  await page.getByTestId('drive-check-run-status-line').click();
  await waitFor(page, 'answer');
  const during = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));
  expect(during.audio.enabled).toBe(true);
  await page.getByTestId('drive-checks-yes').click();
  await result(page, 'status-line');
  await expect(page.getByTestId('drive-checks-start')).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));
  expect(after.audio.enabled).toBe(false);
});
