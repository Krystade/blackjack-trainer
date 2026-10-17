import { test, expect, type Page } from '@playwright/test';
import { sayOnceListening, waitForMic, withSettings, withProfile } from './helpers';

/**
 * B3: the Index test, eyes-free and answered out loud. The answer is a signed
 * number, so it is a proposal read back before "yes" grades it -- and a number
 * said while the correction plays must not land on the next item.
 */

test.use({ viewport: { width: 375, height: 812 } });

const H17: Record<string, number> = {
  ins: 3, '16v10': 0, '15v10': 4, TTv5: 5, TTv6: 4, '10v10': 4, '12v3': 2, '12v2': 3,
  '9v2': 1, '10vA': 3, '9v7': 3, '16v9': 4, '13v2': -1, '12v4': 0, '12v5': -2, '12v6': -3, '13v3': -2,
};

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** The phrasing COUNT_BIAS_PHRASES carries: 'zero', 'plus three', 'minus one'. */
function speakable(n: number): string {
  if (n === 0) return 'zero';
  return `${n > 0 ? 'plus' : 'minus'} ${WORDS[Math.abs(n)]}`;
}

async function withFakeEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      phrases: unknown[] = [];
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
          // Safari fires audiostart right after start; without it the app waits out AUDIOSTART_GRACE_MS.
          this.onaudiostart?.();
        }, 0);
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

/** The keypad display for a value: a real minus, no plus. */
function padText(n: number): string {
  return n < 0 ? `−${-n}` : String(n);
}

async function spoken(page: Page): Promise<string> {
  const log = await page.evaluate(
    () => (window as unknown as { __speechLog?: string[] }).__speechLog ?? [],
  );
  return log.join(' | ');
}

async function openIndexTest(page: Page, answerPauseMs = 0): Promise<void> {
  await withFakeEngine(page);
  await withProfile(page);
  await withSettings(page, { audio: { enabled: true, verbosity: 'full', answerPauseMs } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await page.getByRole('button', { name: 'Index test', exact: true }).click();
  await expect(page.getByTestId('index-test-prompt')).toBeVisible();
}

async function voiceOn(page: Page): Promise<void> {
  await page.locator('label', { hasText: 'Voice answers' }).locator('input').check();
  await waitForMic(page);
}

async function askedIndex(page: Page): Promise<number> {
  const id = (await page.getByTestId('index-test-prompt').getAttribute('data-deviation-id'))!;
  expect(id in H17, `unexpected index ${id}`).toBe(true);
  return H17[id]!;
}

test('eyes-free speaks the index question', async ({ page }) => {
  await openIndexTest(page);
  await page.getByLabel('Eyes-free audio').check();
  await expect.poll(() => spoken(page)).toMatch(/Index to|insurance index/);
});

test('a spoken number is read back, then "yes" grades it', async ({ page }) => {
  await openIndexTest(page);
  await voiceOn(page);
  const index = await askedIndex(page);
  await sayOnceListening(page, speakable(index));
  // #29: one answer state -- the proposal is in the keypad display.
  await expect(page.locator('.numpad-display')).toHaveText(padText(index));
  await expect.poll(() => spoken(page)).toContain('Correct?');
  await sayOnceListening(page, 'yes');
  await expect(page.getByTestId('index-test-result')).toContainText('Correct!');
});

test('a number said during the correction is not graded into the next item', async ({ page }) => {
  // A long pause holds the correction on screen: the window between the
  // correction ending (mic reopens) and the auto-advance is otherwise one beat,
  // and the number would race the next item instead of landing in feedback.
  await openIndexTest(page, 60_000);
  await voiceOn(page);
  const index = await askedIndex(page);
  await sayOnceListening(page, speakable(index));
  await expect(page.locator('.numpad-display')).toHaveText(padText(index));
  await sayOnceListening(page, 'yes');
  await expect(page.getByTestId('index-test-result')).toBeVisible();
  await sayOnceListening(page, 'plus five');
  // Still in the correction (its Next button), not on a new item. The strip
  // itself fades after a right answer, so it is not the marker.
  await expect(page.locator('.drill-next-btn')).toBeVisible();
  await expect(page.locator('.voice-status-heard')).toContainText('plus five');
  await expect(page.locator('.numpad-display')).toHaveCount(0);
  const perIndex = await page.evaluate(
    () => JSON.parse(localStorage.getItem('bjtrainer.stats.v1') ?? '{}').perIndex ?? {},
  ) as Record<string, { right: number; wrong: number }>;
  const total = Object.values(perIndex).reduce((n, t) => n + t.right + t.wrong, 0);
  expect(total).toBe(1);
});

/**
 * #29: a spoken number and the keypad are one answer. The proposal shows in
 * the keypad display with OK live, so a glance and a tap submit what was said;
 * there is no separate "+2?" line beside an empty "Type a number".
 */
test('a spoken number fills the keypad, and OK submits it', async ({ page }) => {
  await openIndexTest(page);
  await voiceOn(page);
  const index = await askedIndex(page);
  await sayOnceListening(page, speakable(index));
  await expect(page.locator('.numpad-display')).toHaveText(padText(index));
  await expect(page.locator('.numpad-placeholder')).toHaveCount(0);
  await expect(page.getByTestId('index-test-pending')).toHaveCount(0);
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByTestId('index-test-result')).toContainText('Correct!');
});
